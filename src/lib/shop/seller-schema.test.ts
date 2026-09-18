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
    /*
     * ONE EXCEPTION since 0041, and it is the opposite of a marketplace:
     * `seller_operators.seller_id` names which shop an ACCOUNT may operate
     * (ADR-0077). A membership, not a partition of commerce. Its own file
     * checks that it reaches no commerce table.
     *
     * `0051` reads that same membership and nothing else: it asks whether an
     * account still operates an active seller before letting a dotted username
     * stand, and compares `seller_id` only to exclude the row being withdrawn
     * from that count. No commerce table gains a column, and the check below
     * confirms it touches none.
     */
    const everything = readdirSync(MIGRATIONS)
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          !f.startsWith("0041_") &&
          !f.startsWith("0042_") &&
          !f.startsWith("0051_"),
      )
      .map((f) => readFileSync(`${MIGRATIONS}/${f}`, "utf8"))
      .join("\n")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .replace(/'(?:[^']|'')*'/g, "''");
    expect(everything).not.toContain("seller_id");
  });

  it("and 0051's exemption really is only the membership", () => {
    /*
     * The exemption above is a hole in a guard, so it gets its own floor:
     * 0051 may name `seller_id` on `seller_operators` and nowhere else. If it
     * ever reached a commerce table, this fails even though the file is
     * skipped above.
     */
    const sql051 = readFileSync(`${MIGRATIONS}/0051_admin_predicate_and_business_usernames.sql`, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .replace(/'(?:[^']|'')*'/g, "''");

    for (const commerce of [
      "shop_inventory", "inventory_movements", "orders", "order_lines",
      "shop_offers", "order_addresses", "invoices", "payment_attempts",
    ]) {
      expect(sql051, commerce).not.toContain(commerce);
    }
    // Every seller_id it does name belongs to the membership table.
    for (const match of sql051.matchAll(/(\w+)\.seller_id/g)) {
      expect(["o", "old", "new"], match[0]).toContain(match[1]);
    }
  });

  it("says in its own comment that it is not a relation", () => {
    // The comment is the thing a later reader finds first, so it carries the
    // warning rather than only this test.
    const comment = sql.slice(sql.indexOf("comment on function public.seller_public()"));
    expect(comment).toContain("identity, not a relation");
    expect(comment).toContain("no table carries a seller_id");
  });
});
