import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The contract of migration `0021`, read as text.
 *
 * The same kind of test `schema.test.ts` runs on the commerce core, and for
 * the same reason: this file is applied by hand against a database this
 * machine cannot reach, so the only check that runs before it is applied is a
 * careful read of what it says.
 *
 * These assertions are about the promises the migration makes, not its
 * formatting. Each one names a way the feature could be quietly wrong.
 */
const SQL = readFileSync("supabase/migrations/0021_commerce_mode.sql", "utf8");

/** The body of one function, from its header to its closing `$$;`. */
function body(signature: string): string {
  const start = SQL.indexOf(signature);
  expect(start, `${signature} is missing`).toBeGreaterThan(-1);
  const end = SQL.indexOf("\n$$;", start);
  expect(end, `${signature} is not closed`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe("the mode has exactly three values and defaults to the safe one", () => {
  it("is a CHECK, not an enum — the project's rule for every closed set", () => {
    expect(SQL).toContain("check (mode in ('closed', 'sandbox', 'live'))");
    expect(SQL).not.toMatch(/create type .*commerce_mode/i);
  });

  it("defaults to closed, so applying the migration opens nothing", () => {
    expect(SQL).toContain("add column if not exists mode text not null default 'closed'");
  });

  it("lives on commerce_settings, which no client role may read", () => {
    // The table was revoked in 0010 and nothing here gives it back.
    expect(SQL).not.toMatch(/grant .* on (public\.)?commerce_settings/i);
  });
});

describe("the tester list is a permission, not a role", () => {
  it("is keyed by user_id and by nothing else", () => {
    const table = SQL.slice(
      SQL.indexOf("create table if not exists public.commerce_testers"),
      SQL.indexOf("comment on table public.commerce_testers"),
    );
    expect(table).toContain("user_id    uuid        primary key");
    // The rule that has held since ADR-0032: an address identifies an
    // account, it does not authorise one.
    expect(table).not.toMatch(/\bemail\b/i);
  });

  it("disappears with the account, unlike the movement journal", () => {
    const table = SQL.slice(
      SQL.indexOf("create table if not exists public.commerce_testers"),
      SQL.indexOf("comment on table public.commerce_testers"),
    );
    expect(table).toContain("on delete cascade");
  });

  it("is unreadable by any client role", () => {
    expect(SQL).toContain("alter table public.commerce_testers enable row level security");
    expect(SQL).toContain("revoke all on public.commerce_testers from anon, authenticated");
    expect(SQL).not.toMatch(/create policy .* on public\.commerce_testers/i);
  });

  it("being an administrator grants nothing here", () => {
    const fn = body("create or replace function public.is_commerce_tester()");
    expect(fn).toContain("public.commerce_testers");
    expect(fn).not.toContain("shop_admins");
    expect(fn).not.toContain("is_shop_admin");
  });
});

describe("the predicate is the whole rule, in one place", () => {
  const fn = body("create or replace function public.commerce_checkout_allowed()");

  it("live sells to anyone", () => {
    expect(fn).toContain("when 'live'    then true");
  });

  it("sandbox needs a signed-in tester, which is also what excludes guests", () => {
    expect(fn).toContain("(select auth.uid()) is not null");
    expect(fn).toContain("public.is_commerce_tester()");
  });

  it("anything else — closed included — is false", () => {
    expect(fn).toContain("else false");
  });

  it("is not callable by a client; only the functions that gate use it", () => {
    expect(SQL).toContain(
      "revoke all on function public.commerce_checkout_allowed() from public, anon, authenticated",
    );
  });
});

describe("the public projection says the least it can", () => {
  const fn = body("create or replace function public.commerce_access()");

  it("answers may_checkout and a coarse reason", () => {
    expect(fn).toContain("returns table (may_checkout boolean, reason text)");
    expect(fn).toContain("'testers_only'");
    expect(fn).toContain("'closed'");
    expect(fn).toContain("'open'");
  });

  it("never returns the mode itself", () => {
    // 'sandbox' appears as a comparison, never as an answer: returning it
    // would tell every visitor that a test is running. Only the three reason
    // codes may come out of the CASE.
    const returned = [...fn.matchAll(/(?:then|else) '([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(returned)).toEqual(new Set(["open", "testers_only", "closed"]));
  });

  it("is the only thing here a client may call", () => {
    expect(SQL).toContain("grant execute on function public.commerce_access() to anon, authenticated");
    expect(SQL).not.toMatch(/grant execute on function public\.commerce_mode\(\)/);
    expect(SQL).not.toMatch(/grant execute on function public\.is_commerce_tester\(\)/);
  });
});

describe("create_order asks before it does anything", () => {
  const fn = body("create or replace function public.create_order(");

  it("refuses first, before the shape checks and before any price is read", () => {
    const gate = fn.indexOf("commerce_checkout_allowed()");
    const shape = fn.indexOf("a checkout needs a request id");
    const price = fn.indexOf("shop_price");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(shape);
    expect(gate).toBeLessThan(price);
  });

  it("says the same thing whichever reason applies", () => {
    // Closed, signed out, not a tester — one refusal. A caller must not be
    // able to map the message back to which of the three it was, so the
    // refusal is a single literal with nothing interpolated into it.
    const raised = fn.slice(fn.indexOf("if not public.commerce_checkout_allowed()"));
    const message = raised.slice(0, raised.indexOf("end if;"));
    expect(message).toContain("raise exception 'checkout is not open to this caller'");
    expect(message).not.toContain("%");
    expect(message).not.toMatch(/tester|sandbox|sign in|angemeldet/i);
  });

  it("stamps the mode it was told onto the order", () => {
    expect(fn).toContain("v_mode text := public.commerce_mode()");
    expect(fn).toContain("client_hash, commerce_mode,");
    expect(fn).toContain("v_client, v_mode,");
  });

  it("still reaches anon and authenticated — the gate is inside, not the grant", () => {
    expect(SQL).toContain(
      "grant execute on function public.create_order(text, text, jsonb, jsonb, text, text) to anon, authenticated",
    );
  });
});

describe("the stamp on the order cannot be rewritten", () => {
  it("existing orders are backfilled truthfully, and the column gets no default", () => {
    expect(SQL).toContain("update public.orders set commerce_mode = 'sandbox' where commerce_mode is null");
    expect(SQL).toContain("alter column commerce_mode set not null");
    // A default would let a future insert that forgets the mode look correct.
    expect(SQL).not.toMatch(/commerce_mode text (not null )?default/);
  });

  it("is frozen by the same trigger that freezes the amounts", () => {
    const fn = body("create or replace function public.orders_protect_immutable()");
    expect(fn).toContain("new.commerce_mode   is distinct from old.commerce_mode");
    // And the rest of that trigger is still there.
    expect(fn).toContain("new.total_amount    is distinct from old.total_amount");
    expect(fn).toContain("an order cannot be reassigned to another account");
    expect(fn).toContain("the client fingerprint cannot be changed, only cleared");
  });
});

describe("the payment path asks again", () => {
  it("a withdrawn tester cannot pay for the checkout they already opened", () => {
    const fn = body("create or replace function public.authorize_order_payment(");
    expect(fn).toContain("public.commerce_mode() <> 'sandbox'");
    expect(fn).toContain("public.is_commerce_tester_for(o.user_id)");
    // The 0013 contract is still intact.
    expect(fn).toContain("o.payment_token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')");
  });

  it("an order may only be paid in the world it was placed in", () => {
    const fn = body("create or replace function public.start_payment_attempt(");
    expect(fn).toContain("v_order.commerce_mode is distinct from public.commerce_mode()");
    expect(fn).toContain("was placed in a different commerce mode");
    // Raised as check_violation, which create-payment already maps to 409.
    const guard = fn.slice(fn.indexOf("was placed in a different commerce mode"));
    expect(guard.slice(0, 200)).toContain("check_violation");
  });

  it("keeps every refusal it already had", () => {
    const fn = body("create or replace function public.start_payment_attempt(");
    expect(fn).toContain("and cannot be paid");
    expect(fn).toContain("needs to be looked at before it can be paid");
    expect(fn).toContain("the hold on order % has lapsed");
  });
});

describe("the admin surface authorises by account, never by address", () => {
  const ADMIN_FUNCTIONS = [
    "create or replace function public.admin_commerce_state()",
    "create or replace function public.admin_find_accounts(p_query text)",
    "create or replace function public.admin_set_commerce_mode(p_mode text)",
    "create or replace function public.admin_set_commerce_tester(",
    "create or replace function public.admin_revert_sandbox_stock(p_order_number text)",
  ];

  it.each(ADMIN_FUNCTIONS)("%s checks is_shop_admin() in its own body", (signature) => {
    expect(body(signature)).toContain("if not public.is_shop_admin() then");
  });

  it("granting takes a user_id and refuses anything else", () => {
    const fn = body("create or replace function public.admin_set_commerce_tester(");
    expect(fn).toContain("p_user_id uuid");
    expect(fn).toContain("a tester is named by account, never by address");
    expect(fn).not.toMatch(/p_email|by email|u\.email/);
  });

  it("the search returns a user_id, and reading an address is all it does with one", () => {
    const fn = body("create or replace function public.admin_find_accounts(p_query text)");
    expect(fn).toContain("user_id   uuid");
    expect(fn).toContain("limit 10");
    expect(fn).toContain("length(v_query) < 3");
    // It reads auth.users to FIND. It must not decide anything from it.
    expect(fn).not.toContain("insert into");
    expect(fn).not.toContain("update ");
    expect(fn).not.toContain("delete ");
  });

  it("only the mode switch may write the setting", () => {
    const writes = SQL.match(/update public\.commerce_settings/g) ?? [];
    expect(writes.length).toBe(1);
  });
});

describe("putting sandbox stock back is a movement, never an edit", () => {
  const fn = body("create or replace function public.admin_revert_sandbox_stock(p_order_number text)");

  it("refuses any order that was not placed in sandbox", () => {
    expect(fn).toContain("if v_order.commerce_mode <> 'sandbox' then");
    expect(fn).toContain("was not placed in sandbox");
  });

  it("books return movements through the existing path", () => {
    expect(fn).toContain("public.apply_inventory_movement(");
    expect(fn).toContain("'return',");
    // No second inventory architecture, and nothing edited in place.
    expect(fn).not.toMatch(/update public\.shop_inventory/);
    expect(fn).not.toMatch(/delete from public\.inventory_movements/);
  });

  it("puts back only what actually left the shelf", () => {
    // A late payment converts fewer positions than the order has lines.
    // Reverting by order_lines would invent goods that were never sold.
    expect(fn).toContain("r.state = 'converted'");
    expect(fn).not.toContain("from public.order_lines");
  });

  it("is idempotent through an order event", () => {
    expect(fn).toContain("e.event_type = 'sandbox_stock_reverted'");
    expect(fn).toContain("return 0;");
  });
});

describe("the operator can see which world an order came from", () => {
  it("the document says so, and whether the stock is back", () => {
    const fn = body("create or replace function public.admin_order(p_order_number text)");
    expect(fn).toContain("'commerce_mode',      v_order.commerce_mode");
    expect(fn).toContain("'stock_reverted',");
    // And the 0019 mail block survived the rewrite.
    expect(fn).toContain("public.order_mail_effective_state(m.state, m.claimed_at)");
  });

  it("the list says so too", () => {
    const fn = body("create or replace function public.admin_orders(");
    expect(fn).toContain("commerce_mode      text");
    expect(fn).toContain("r.commerce_mode");
  });

  it("neither leaks what they never leaked", () => {
    for (const signature of [
      "create or replace function public.admin_order(p_order_number text)",
      "create or replace function public.admin_orders(",
    ]) {
      const fn = body(signature);
      expect(fn).not.toContain("client_hash");
      expect(fn).not.toContain("payment_token_hash");
      expect(fn).not.toContain("request_id");
    }
  });
});

describe("the migration keeps the house rules", () => {
  it("every function pins an empty search_path", () => {
    const definitions = SQL.match(/create or replace function public\.[a-z_]+\(/g) ?? [];
    const pinned = SQL.match(/set search_path = ''/g) ?? [];
    expect(pinned.length).toBe(definitions.length);
  });

  it("adds no policy to a table that has none", () => {
    expect(SQL).not.toMatch(/create policy/i);
  });

  it("drops nothing but the one signature that cannot grow in place", () => {
    const drops = SQL.match(/^drop .*/gm) ?? [];
    expect(drops).toEqual(["drop function if exists public.admin_orders(boolean, integer, integer);"]);
  });

  it("holds no address, no key and no secret", () => {
    expect(SQL).not.toMatch(/@(gmail|googlemail|outlook|gmx|web)\./i);
    expect(SQL).not.toMatch(/sk_(test|live)_|rk_(test|live)_|whsec_|re_[A-Za-z0-9]{8}/);
  });
});
