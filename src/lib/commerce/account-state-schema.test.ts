import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The contract of migration `0022`, read as text.
 *
 * Same discipline as `schema.test.ts` and `commerce-mode-schema.test.ts`: the
 * file is applied by hand against a database this machine cannot reach, so
 * the only check that runs before it is applied is a careful read of what it
 * says. Each assertion names a way the fix could be quietly wrong.
 */
const SQL = readFileSync("supabase/migrations/0022_account_state.sql", "utf8");

function body(signature: string): string {
  const start = SQL.indexOf(signature);
  expect(start, `${signature} is missing`).toBeGreaterThan(-1);
  const end = SQL.indexOf("\n$$;", start);
  expect(end, `${signature} is not closed`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

/**
 * Statements only: `--` comments and string literals removed.
 *
 * Several assertions below say "this must not mention X", and every one of
 * them means the code — the comments explain precisely why X is absent, and
 * a test that failed on its own explanation would teach the next person to
 * delete the explanation.
 */
function code(source: string): string {
  return source.replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "''");
}

/** Every policy on one table, as one string. */
function policies(table: string): string {
  return SQL.split("\n")
    .filter((line) => line.includes(`on public.${table}`) || line.includes("(select auth.uid())"))
    .join("\n");
}

describe("a basket belongs to an account, enforced by a policy", () => {
  it("is keyed by the account and the article, so two accounts cannot share a row", () => {
    expect(SQL).toContain("constraint cart_items_pk primary key (user_id, sky_id, condition)");
  });

  it("has all four owner policies and no other", () => {
    const created = [...SQL.matchAll(/create policy (cart_items_\w+) on public\.cart_items/g)].map(
      (m) => m[1],
    );
    expect(new Set(created)).toEqual(
      new Set([
        "cart_items_select_own",
        "cart_items_insert_own",
        "cart_items_update_own",
        "cart_items_delete_own",
      ]),
    );
  });

  it("every one of them names auth.uid() and nothing else", () => {
    const block = SQL.slice(
      SQL.indexOf("create policy cart_items_select_own"),
      SQL.indexOf("revoke all on public.cart_items from anon"),
    );
    // Four USING/WITH CHECK clauses, all the same comparison.
    // select · insert · update (USING and WITH CHECK) · delete = five clauses.
    expect((block.match(/\(select auth\.uid\(\)\) = user_id/g) ?? []).length).toBe(5);
    expect(block).not.toMatch(/email|username|true\)/i);
  });

  it("turns RLS on and gives a guest nothing", () => {
    expect(SQL).toContain("alter table public.cart_items enable row level security");
    expect(SQL).toContain("revoke all on public.cart_items from anon");
    expect(SQL).toContain("grant select, insert, update, delete on public.cart_items to authenticated");
  });

  it("still reserves nothing", () => {
    // A basket is an intention. Only create_order() turns one into a hold.
    const statements = code(SQL);
    expect(statements).not.toContain("shop_inventory");
    expect(statements).not.toContain("inventory_movements");
    expect(statements).not.toContain("order_reservations");
    expect(statements).not.toMatch(/\breserved\b/);
  });
});

describe("saved delivery details are the owner's alone", () => {
  it("is its own table, not columns on the profile", () => {
    // A profile is the public half of an identity; this is a postal address.
    expect(SQL).toContain("create table if not exists public.customer_contacts");
    expect(SQL).not.toMatch(/alter table public\.profiles/);
  });

  it("has the same four owner policies", () => {
    const created = [
      ...SQL.matchAll(/create policy (customer_contacts_\w+) on public\.customer_contacts/g),
    ].map((m) => m[1]);
    expect(new Set(created)).toEqual(
      new Set([
        "customer_contacts_select_own",
        "customer_contacts_insert_own",
        "customer_contacts_update_own",
        "customer_contacts_delete_own",
      ]),
    );
    expect(SQL).toContain("alter table public.customer_contacts enable row level security");
    expect(SQL).toContain("revoke all on public.customer_contacts from anon");
  });

  it("goes when the account goes", () => {
    const table = SQL.slice(
      SQL.indexOf("create table if not exists public.customer_contacts"),
      SQL.indexOf("comment on table public.customer_contacts"),
    );
    expect(table).toContain("on delete cascade");
  });

  it("cannot reach an order", () => {
    // The whole reason these are two tables: editing a saved default must
    // never rewrite what an old order says was agreed.
    const table = code(
      SQL.slice(
        SQL.indexOf("create table if not exists public.customer_contacts"),
        SQL.indexOf("revoke all on public.customer_contacts from anon"),
      ),
    );
    expect(table).not.toContain("order_addresses");
    expect(table).not.toMatch(/\borders\b/);
  });

  it("changes nothing about the order snapshot", () => {
    // 0022 adds tables and readers. It must not touch create_order(), the
    // address table or the trigger that freezes them.
    expect(code(SQL)).not.toContain("create or replace function public.create_order");
    expect(code(SQL)).not.toContain("orders_protect_immutable");
    expect(SQL).not.toMatch(/alter table public\.order_addresses/);
    expect(SQL).not.toMatch(/update public\.order_addresses/);
  });
});

describe("the guest basket is folded in, deterministically", () => {
  const fn = body("create or replace function public.merge_guest_cart(p_lines jsonb)");

  it("needs an account and refuses without one", () => {
    expect(fn).toContain("if v_user is null then");
    expect(fn).toContain("insufficient_privilege");
  });

  it("sums quantities and caps them where the shop already caps them", () => {
    expect(fn).toContain("least(cart_items.quantity + excluded.quantity, v_max)");
    expect(fn).toContain("public.max_cart_quantity()");
  });

  it("writes only the calling account's rows", () => {
    expect(fn).toContain("(user_id, sky_id, condition, quantity, price_at_add)");
    expect(fn).toContain("values (v_user,");
    // No p_user_id parameter exists to forge.
    expect(fn).not.toContain("p_user_id");
  });

  it("skips a malformed line instead of failing the sign-in", () => {
    expect(fn).toContain("continue when");
    // NULL-safe: `null not in (...)` is NULL, and `continue when NULL` does
    // not continue — the line would reach the INSERT and trip a CHECK.
    expect(fn).toContain("coalesce(v_cond, '') not in ('loose', 'boxed')");
  });
});

describe("the payment state says how many attempts there have been", () => {
  const fn = body("create or replace function public.order_payment_state(");

  it("returns the count the button needs", () => {
    expect(fn).toContain("attempts         integer");
    expect(fn).toContain("from public.payment_attempts a where a.order_id = o.id");
  });

  it("still answers nobody it has not authorised", () => {
    // This is what stops one account seeing another's open order at all.
    expect(fn).toContain("public.authorize_order_payment(o.id, (select auth.uid()), p_token)");
  });

  it("publishes no more than it did before", () => {
    for (const forbidden of ["client_hash", "payment_token_hash", "request_id", "customer_email", "user_id"]) {
      expect(fn, forbidden).not.toContain(forbidden);
    }
  });
});

describe("a customer's own orders", () => {
  it("match on the account, never on an address", () => {
    const list = body("create or replace function public.my_orders(");
    const one = body("create or replace function public.my_order(p_order_number text)");
    for (const fn of [list, one]) {
      expect(fn).toContain("(select auth.uid())");
      expect(fn).not.toContain("customer_email =");
      expect(fn).not.toContain("p_email");
    }
  });

  it("are functions rather than a table read, because a grant is column-blind", () => {
    const list = body("create or replace function public.my_orders(");
    const one = body("create or replace function public.my_order(p_order_number text)");
    for (const fn of [list, one]) {
      for (const forbidden of ["client_hash", "payment_token_hash", "request_id"]) {
        expect(fn, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("show the address as it was agreed, not as the account holds it today", () => {
    const one = body("create or replace function public.my_order(p_order_number text)");
    expect(one).toContain("from public.order_addresses a");
    expect(one).not.toContain("customer_contacts");
  });

  it("answer the same for an unknown order and somebody else's", () => {
    const one = body("create or replace function public.my_order(p_order_number text)");
    expect(one).toContain("return null;");
  });

  it("are closed to anon", () => {
    expect(SQL).toContain("revoke all on function public.my_orders(integer) from public, anon");
    expect(SQL).toContain("revoke all on function public.my_order(text) from public, anon");
  });
});

describe("the migration keeps the house rules", () => {
  it("every function pins an empty search_path", () => {
    const definitions = SQL.match(/create or replace function public\.[a-z_]+\(/g) ?? [];
    const pinned = SQL.match(/set search_path = ''/g) ?? [];
    expect(pinned.length).toBe(definitions.length);
  });

  it("drops only the signature that cannot grow in place", () => {
    const drops = (SQL.match(/^drop function .*/gm) ?? []);
    expect(drops).toEqual(["drop function if exists public.order_payment_state(text, text);"]);
  });

  it("holds no address, no key and no secret", () => {
    expect(SQL).not.toMatch(/@(gmail|googlemail|outlook|gmx|web)\./i);
    expect(SQL).not.toMatch(/sk_(test|live)_|whsec_|re_[A-Za-z0-9]{8}/);
  });

  it("leaves the commerce mode alone", () => {
    // 0021 is built on, not rolled back.
    const statements = code(SQL);
    expect(statements).not.toContain("commerce_settings");
    expect(statements).not.toContain("commerce_testers");
    expect(statements).not.toContain("commerce_checkout_allowed");
  });
});
