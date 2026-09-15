import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * `0027` — the seller's trade name becomes readable.
 *
 * This migration opens the first public door onto `sellers`, so the tests are
 * about what stays shut. The door is an allow-list; the risk is that somebody
 * later widens it with `s.*`, or adds a column to `sellers` and expects the
 * projection to keep quiet about it, or reads `seller.id` as evidence that
 * SkyIsles became a marketplace.
 */
const MIGRATIONS = "supabase/migrations";
const MIGRATION = `${MIGRATIONS}/0027_seller_public.sql`;

const sql = readFileSync(MIGRATION, "utf8");

/** Executable SQL: comment lines removed, string literals blanked. */
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .replace(/'(?:[^']|'')*'/g, "''");

/** The body of the projection, between its `$$` markers. */
const body = (() => {
  const start = code.indexOf("create or replace function public.seller_public(");
  expect(start, "seller_public is missing").toBeGreaterThan(-1);
  const open = code.indexOf("as $$", start);
  return code.slice(open, code.indexOf("$$;", open));
})();

/** Signature and flags: everything from the name to the body. */
const head = (() => {
  const start = code.indexOf("create or replace function public.seller_public(");
  return code.slice(start, code.indexOf("as $$", start));
})();

describe("seller_public() publishes an allow-list and nothing more", () => {
  it("names its two columns literally", () => {
    expect(body).toContain("select s.id, s.display_name");
    expect(head).toContain("id           bigint");
    expect(head).toContain("display_name text");
  });

  it("never selects the whole row", () => {
    // `active_seller()` does exactly that, which is why it is revoked from
    // everybody. This door must not become a second one of those.
    expect(body).not.toContain("s.*");
    expect(body).not.toContain("select *");
  });

  it("publishes no private field", () => {
    for (const field of [
      "contact_email",
      "transactional_reply_to",
      "updated_by",
      "created_at",
      "updated_at",
    ]) {
      expect(head, `${field} must not be in the signature`).not.toContain(field);
      expect(body, `${field} must not be selected`).not.toContain(field);
    }
  });

  it("returns only the active seller", () => {
    expect(body).toContain("where s.is_active");
  });

  it("is a definer function with a pinned search path", () => {
    expect(head).toContain("security definer");
    expect(head).toContain("set search_path = ''");
    expect(head).toContain("stable");
  });

  it("is granted to visitors, because the catalogue is public", () => {
    expect(code).toContain("revoke all on function public.seller_public() from public;");
    expect(code).toMatch(/grant\s+execute on function public\.seller_public\(\)\s+to anon, authenticated;/);
  });
});

describe("0027 opens one door and touches nothing else", () => {
  it("leaves active_seller(), admin_seller() and shop_offers() alone", () => {
    for (const untouched of ["active_seller", "admin_seller", "shop_offers"]) {
      expect(code, `${untouched} must not be redefined here`).not.toContain(
        `function public.${untouched}(`,
      );
    }
  });

  it("changes no table, no policy and no grant on sellers", () => {
    expect(code).not.toContain("alter table");
    expect(code).not.toContain("create table");
    expect(code).not.toContain("create policy");
    expect(code).not.toContain("drop policy");
    expect(code).not.toMatch(/grant[^;]*on public\.sellers/);
  });

  it("is additive, so its rollback is one statement", () => {
    expect(code).not.toContain("drop function");
    expect(code).not.toContain("delete from");
    expect(code).not.toContain("truncate");
    expect(sql).toContain("drop function if exists public.seller_public();");
  });
});

describe("this is an identity, not a marketplace", () => {
  /**
   * The guard ADR-0064 asks for, stated as an assertion. `seller.id` becomes
   * visible to a browser with this migration, and the mistake it invites is
   * concluding that offers are keyed by seller. They are not: no table carries
   * a `seller_id`, and `sellers_one_active` guarantees there is one seller to
   * be.
   */
  it("adds no seller_id anywhere", () => {
    expect(code).not.toContain("seller_id");
  });

  it("is not smuggled into another migration either", () => {
    /*
     * Executable SQL only. Several migrations mention `seller_id` — in prose
     * and inside `comment on … is '…'` strings — and every one of them says
     * it does not exist. Matching raw text would fail on the very statements
     * that promise the thing this test is checking for.
     */
    const everything = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(`${MIGRATIONS}/${f}`, "utf8"))
      .join("\n")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .replace(/'(?:[^']|'')*'/g, "''");
    expect(everything).not.toContain("seller_id");
  });

  it("says in its own comment that it is not a relation", () => {
    // The comment is the thing a later reader finds first, so it carries the
    // warning rather than only this test.
    const comment = sql.slice(sql.indexOf("comment on function public.seller_public()"));
    expect(comment).toContain("identity, not a relation");
    expect(comment).toContain("no table carries a seller_id");
  });
});
