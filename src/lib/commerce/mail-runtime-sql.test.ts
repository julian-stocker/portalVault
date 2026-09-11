import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A static check on the runtime suite, because I cannot execute it.
 *
 * `0019_transactional_mail_runtime.sql` runs in the Supabase SQL editor, on a
 * database this machine has no connection to — so every mistake in it is found
 * by a person pasting it in, one error message at a time. Two were, and both
 * were the same shape: a broad edit that hit one line more or one line fewer
 * than intended.
 *
 * This does the reading a compiler would. It is not a PL/pgSQL parser and does
 * not pretend to be; it checks the three things that have actually gone wrong.
 */
const FILES = [
  "supabase/tests/0019_transactional_mail_runtime.sql",
  "supabase/tests/0020_order_events_anonymisation_runtime.sql",
  "supabase/tests/0023_tracking_runtime.sql",
] as const;

const SQL = readFileSync(FILES[0], "utf8");

/**
 * Each `do $$ … $$;` block, split at its FIRST `begin` only.
 *
 * `split()` was wrong here: these blocks contain nested `begin … exception …
 * end` guards, so splitting on every occurrence and taking the first two parts
 * threw away everything after the second `begin` — which made a variable used
 * late in a block look unused.
 */
function blocks(file: string = FILES[0]): { head: string; body: string; index: number }[] {
  const source_ = readFileSync(file, "utf8");
  return [...source_.matchAll(/do \$\$([\s\S]*?)\$\$;/g)].map((match, index) => {
    const source = match[1];
    const start = source.search(/\n\s*begin\n/);
    return {
      head: start === -1 ? source : source.slice(0, start),
      body: start === -1 ? "" : source.slice(start),
      index: index + 1,
    };
  });
}

/** Declarations, whether one per line or several on one. */
function declared(head: string): Set<string> {
  return new Set(
    [...head.matchAll(/\b(v_[a-z_]+)\s+(?:bigint|text|jsonb|boolean|integer|timestamptz|interval|uuid|record|public\.)/g)].map(
      (m) => m[1],
    ),
  );
}

/** Uses, with comments and string literals removed first. */
function used(body: string): Set<string> {
  const clean = body.replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "''");
  return new Set([...clean.matchAll(/\b(v_[a-z_]+)\b/g)].map((m) => m[1]));
}

describe("every block declares what it uses", () => {
  it.each(FILES)("%s — every variable is declared", (file) => {
    for (const block of blocks(file)) {
      const missing = [...used(block.body)].filter((name) => !declared(block.head).has(name));
      expect(missing, `block ${block.index} uses undeclared: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it.each(FILES)("%s — declares nothing it does not use", (file) => {
    for (const block of blocks(file)) {
      const unused = [...declared(block.head)].filter((name) => !used(block.body).has(name));
      expect(unused, `block ${block.index} declares unused: ${unused.join(", ")}`).toEqual([]);
    }
  });
});

describe("the delete guard is switched off only to clean up, never to be proven", () => {
  /**
   * The mistake this exists for: a blanket edit put the `disable trigger`
   * into the assertion that the trigger fires, so the suite proved the
   * opposite of what it claimed.
   */
  it("every disable is matched by an enable", () => {
    expect((SQL.match(/disable trigger order_mail_no_delete/g) ?? []).length).toBe(
      (SQL.match(/enable trigger order_mail_no_delete/g) ?? []).length,
    );
  });

  it("no disable sits inside an exception-guarded block", () => {
    /*
     * A `begin … exception … end` in this suite always means "this must be
     * refused". Switching a guard off inside one is switching off the thing
     * being tested.
     */
    // The innermost guards only: a `begin` with no further `begin` before its
    // `exception`. Matching the block's own outer `begin` would sweep in the
    // whole section and say nothing.
    for (const guarded of SQL.matchAll(/\n\s*begin\n((?:(?!\bbegin\b)[\s\S])*?)\n\s*exception/g)) {
      expect(guarded[1]).not.toContain("disable trigger");
    }
  });

  it("the delete that must fail runs against a live trigger", () => {
    const section = SQL.slice(SQL.indexOf("-- SECTION 5"), SQL.indexOf("-- SECTION 6"));
    const assertion = section.slice(section.indexOf("THE GUARD ITSELF"));
    expect(assertion).toContain("delete from public.order_mail");
    expect(assertion).not.toContain("disable trigger");
    expect(assertion).toContain("a delivery record was deleted");
  });
});

describe("the suite cannot be run against production by accident", () => {
  it("refuses a database that does not look like staging", () => {
    expect(SQL).toContain("This does not look like staging");
  });

  it("leaves nothing behind: every section that writes is rolled back", () => {
    const begins = (SQL.match(/^begin;$/gm) ?? []).length;
    const rollbacks = (SQL.match(/^rollback;$/gm) ?? []).length;
    expect(begins).toBe(rollbacks);
    expect(SQL).not.toMatch(/^commit;$/m);
  });

  it("pins the agreed business_settings columns", () => {
    expect(SQL).toContain(
      "array['id', 'contact_email', 'transactional_reply_to', 'updated_at', 'updated_by']",
    );
  });
});
