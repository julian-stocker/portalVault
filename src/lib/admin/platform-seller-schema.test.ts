import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * `0026` — the platform and the seller are two subjects (ADR-0064).
 *
 * These tests exist for one reason: the phase is easy to overshoot. Adding a
 * `sellers` table is the correct move; adding a `seller_id` to anything is a
 * marketplace, and the distance between the two is one word. The guards from
 * ADR-0064 are written here as assertions rather than as intentions.
 *
 * The second thing they hold: `mail_contact_settings()` keeps its name, its
 * signature and its return shape, so the deployed `send-order-mail` needs no
 * redeploy. That is a promise about a function nobody is going to rebuild, and
 * it is invisible in a diff.
 */
const MIGRATIONS = "supabase/migrations";
const MIGRATION = `${MIGRATIONS}/0026_platform_and_seller.sql`;

const sql = readFileSync(MIGRATION, "utf8");

/** Executable SQL: comment lines removed, string literals blanked. */
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .replace(/'(?:[^']|'')*'/g, "''");

/** The body of one function, between its `$$` markers. */
function fn(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing`).toBeGreaterThan(-1);
  const open = code.indexOf("as $$", start);
  return code.slice(open, code.indexOf("$$;", open));
}

/** Everything from a function's name to its body — signature and flags. */
function head(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing`).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf("as $$", start));
}

// ---------------------------------------------------------------------------

describe("guard 1 — no table carries a seller", () => {
  it("`seller_id` appears in no migration, as an identifier", () => {
    /*
     * Against executable SQL only. 0026's banner and its table comment say the
     * word while explaining the boundary — prose may name the idea, schema may
     * not introduce it. This is the single word that separates an identity
     * record from a marketplace.
     *
     * ONE EXCEPTION, and it is the opposite of a marketplace: since 0041
     * `seller_operators.seller_id` names which shop an ACCOUNT may operate
     * (ADR-0077). It is a membership, not a partition of commerce — no order,
     * no inventory row and no catalog row gains a seller. That distinction is
     * why the guard below still sweeps every other migration.
     *
     * `0051` joins that list for the same reason and no other: it reads the
     * membership to decide whether an account may hold a dotted username, and
     * names `seller_id` only to exclude the grant being withdrawn from the
     * count of those remaining. `seller-schema.test.ts` proves it reaches no
     * commerce table.
     */
    const MEMBERSHIP = [
      "0041_three_account_authorization.sql",
      "0042_strict_account_types.sql",
      "0051_admin_predicate_and_business_usernames.sql",
    ];
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !MEMBERSHIP.includes(f))) {
      const body = readFileSync(`${MIGRATIONS}/${file}`, "utf8")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .replace(/'(?:[^']|'')*'/g, "''");
      expect(body, `${file} introduces seller_id`).not.toMatch(/seller_id/i);
    }
  });

  it("0041's seller_id is a membership and reaches no commerce table", () => {
    // Raw: this file's prose contains apostrophes, and stripping string
    // literals across them would swallow the schema it is meant to read.
    const body = readFileSync(`${MIGRATIONS}/0041_three_account_authorization.sql`, "utf8");
    // It exists only on the membership table and the predicate that reads it.
    for (const commerce of ["orders", "order_lines", "shop_inventory", "skylanders"]) {
      expect(
        body,
        `0041 puts seller_id on ${commerce}`,
      ).not.toMatch(new RegExp(`alter table public\\.${commerce}[^;]*seller_id`, "i"));
    }
    expect(body).toContain("constraint seller_operators_pk primary key (seller_id, user_id)");
  });

  it("adds no column to any existing table", () => {
    expect(code).not.toMatch(/add column/i);
  });
});

describe("guard 2 — at most one active seller, enforced by the database", () => {
  it("is a partial unique index, not a convention", () => {
    expect(code).toContain("create unique index if not exists sellers_one_active");
    expect(code).toContain("on public.sellers ((true))");
    expect(code).toContain("where is_active");
  });

  it("the writer addresses the active seller and never an id", () => {
    const setter = fn("admin_set_seller_contact");
    expect(setter).toContain("update public.sellers");
    expect(setter).toContain("where is_active");
    expect(head("admin_set_seller_contact")).not.toMatch(/p_id|p_seller/);
  });
});

describe("guard 3 — no commerce function is touched", () => {
  it("defines none of them", () => {
    for (const name of [
      "create_order",
      "authorize_order_payment",
      "confirm_order_payment",
      "start_payment_attempt",
      "shop_offers",
      "convert_order_reservations",
      "release_order_reservations",
      "expire_stale_checkouts",
      "merge_guest_cart",
      "apply_inventory_movement",
    ]) {
      expect(code, `${name} must not appear`).not.toContain(name);
    }
  });

  it("touches no commerce or catalogue table", () => {
    for (const table of [
      "shop_inventory",
      "inventory_movements",
      "orders",
      "order_lines",
      "order_reservations",
      "payment_attempts",
      "cart_items",
      "commerce_settings",
      "skylanders",
    ]) {
      expect(code, `${table} must not appear`).not.toContain(table);
    }
  });

  it("alters exactly one table, and it is the one being renamed", () => {
    const altered = [...code.matchAll(/^alter table (\S+)/gm)].map((m) => m[1]);
    expect(new Set(altered)).toEqual(
      new Set(["public.business_settings", "public.platform_settings", "public.sellers"]),
    );
  });
});

describe("guard 4 — being a seller is not a permission", () => {
  it("links no account to a seller", () => {
    /*
     * `updated_by` is an audit column and points at whoever last edited the
     * record, exactly as it does on platform_settings. What must not exist is
     * a column or table that makes an account INTO a seller.
     */
    expect(code).not.toMatch(/seller_accounts|seller_users|seller_admins/i);
    expect(code).not.toMatch(/is_seller|seller_for|current_seller\(/i);
  });

  it("keeps every gate on is_shop_admin()", () => {
    for (const name of [
      "admin_seller",
      "admin_set_seller_contact",
      "admin_platform_settings",
      "admin_set_platform_contact",
    ]) {
      expect(fn(name), `${name} must ask is_shop_admin()`).toContain(
        "if not public.is_shop_admin() then",
      );
    }
  });

  it("creates no policy — RLS on, no way in but a function", () => {
    expect(code).toContain("alter table public.sellers enable row level security");
    expect(code).toContain("revoke all on public.sellers from anon, authenticated");
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/grant\s+(select|insert|update|delete)\s+on\s+public\.sellers/i);
  });

  it("never authorises by e-mail address (ADR-0059)", () => {
    expect(code).not.toMatch(/where\s+.*contact_email\s*=\s*\w/i);
    expect(code).not.toMatch(/if\s+.*contact_email\s*=\s*auth/i);
  });
});

describe("guard 5 — active_seller() is the only read path", () => {
  it("exists, and is the seam the comment says it is", () => {
    expect(code).toContain("create or replace function public.active_seller()");
    expect(fn("active_seller")).toContain("where s.is_active");
  });

  it("every seller reader goes through it", () => {
    for (const name of ["mail_contact_settings", "admin_seller"]) {
      expect(fn(name), `${name} must read through active_seller()`).toContain(
        "public.active_seller()",
      );
      expect(fn(name), `${name} must not select from sellers directly`).not.toMatch(
        /from public\.sellers\b/,
      );
    }
  });

  it("is the only FUNCTION that selects from the table", () => {
    /*
     * The seed and the pre-drop interlock read it too, but they are top-level
     * statements that run once. What matters is that no reusable code path
     * grows a second definition of "the seller".
     */
    const readers = [...code.matchAll(/create or replace function public\.(\w+)\(/g)]
      .map((m) => m[1])
      .filter((name) => /from\s+public\.sellers\b/.test(fn(name)));
    expect(readers).toEqual(["active_seller"]);
  });

  it("is closed to every client role", () => {
    expect(code).toContain(
      "revoke all on function public.active_seller()                          from public, anon, authenticated",
    );
    expect(code).not.toMatch(/grant execute on function public\.active_seller\(\)\s+to/);
  });
});

describe("guard 6 — no field without a reader", () => {
  it("adds no legal or tax column ahead of the legal block", () => {
    for (const premature of [
      "legal_name",
      "vat_id",
      "tax_id",
      "tax_regime",
      "street",
      "postal_code",
      "address_line",
      "phone",
      "logo",
      "iban",
    ]) {
      expect(code, `${premature} has no reader yet`).not.toContain(premature);
    }
  });

  it("the seller holds exactly the three facts that exist today", () => {
    const table = code.slice(
      code.indexOf("create table if not exists public.sellers ("),
      code.indexOf("comment on table public.sellers"),
    );
    for (const column of ["display_name", "contact_email", "transactional_reply_to"]) {
      expect(table).toContain(column);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the seed is copied, never typed", () => {
  it("takes both addresses from the row that already holds them", () => {
    const seed = sql.slice(
      sql.indexOf("insert into public.sellers"),
      sql.indexOf("-- 4. The interlock"),
    );
    expect(seed).toContain("from public.business_settings b");
    expect(seed).toContain("b.contact_email");
    expect(seed).toContain("b.transactional_reply_to");
  });

  it("hardcodes the trade name and nothing else", () => {
    /*
     * The one named exception to ADR-0059's "no company datum in source": a
     * publicly used trade name, argued in the ADR-0059 addendum. No address
     * may join it.
     */
    const literals = [...sql.matchAll(/'([^']{3,})'/g)].map((m) => m[1]);
    expect(literals).toContain("yulez.collectibles");
    for (const literal of literals) {
      expect(literal, `${literal} looks like an address`).not.toMatch(
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      );
    }
  });

  it("refuses to drop anything before the copy is verified", () => {
    const interlock = sql.indexOf("expected exactly one seller after the seed");
    const drop = sql.indexOf("drop column if exists transactional_reply_to");
    expect(interlock).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(interlock);
    expect(sql).toContain("the contact address was not carried over");
    expect(sql).toContain("the reply-to was not carried over");
  });
});

describe("send-order-mail needs no redeploy", () => {
  const signature = head("mail_contact_settings");

  it("keeps the name and the argument list", () => {
    expect(code).toContain("create or replace function public.mail_contact_settings()");
  });

  it("keeps the return shape, column for column and in order", () => {
    expect(signature).toContain("contact_email          text");
    expect(signature).toContain("transactional_reply_to text");
    expect(signature.indexOf("contact_email")).toBeLessThan(
      signature.indexOf("transactional_reply_to"),
    );
  });

  it("only its source changed", () => {
    expect(fn("mail_contact_settings")).toContain("public.active_seller()");
  });

  it("stays service-role only", () => {
    expect(code).toContain(
      "revoke all on function public.mail_contact_settings()                  from public, anon, authenticated",
    );
  });
});

describe("the platform keeps its own address and its literal projection", () => {
  it("renames the table rather than leaving the ambiguous name", () => {
    expect(code).toContain("alter table public.business_settings rename to platform_settings");
  });

  it("gives up the Reply-To, because it was never the platform's", () => {
    expect(code).toContain("drop column if exists transactional_reply_to");
  });

  it("names its published columns literally, never `select p.*`", () => {
    const projection = fn("platform_settings_public");
    expect(projection).toContain("select p.contact_email");
    expect(projection).not.toContain("p.*");
    expect(head("platform_settings_public")).not.toContain("transactional_reply_to");
  });

  it("is still granted to nobody", () => {
    expect(code).not.toMatch(/grant execute on function public\.platform_settings_public\(\)\s+to/);
  });

  it("has a writer that cannot reach a seller field", () => {
    const setter = fn("admin_set_platform_contact");
    expect(setter).toContain("update public.platform_settings");
    expect(setter).not.toContain("sellers");
    expect(setter).not.toContain("transactional_reply_to");
    expect(setter).not.toContain("display_name");
  });

  it("and a seller writer that cannot reach a platform field", () => {
    const setter = fn("admin_set_seller_contact");
    expect(setter).toContain("update public.sellers");
    expect(setter).not.toContain("platform_settings");
  });
});
