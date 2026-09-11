import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The contract of migration `0023`, read as text.
 *
 * The reported workflow it exists for: buy a label, record its number, ship
 * the next day — and occasionally cancel a label and replace it, which means
 * correcting the number on an order that has already gone out. `0018` made
 * both impossible, in two separate places (ADR-0062).
 */
const SQL = readFileSync("supabase/migrations/0023_tracking_number_is_editable.sql", "utf8");
const OLD = readFileSync("supabase/migrations/0018_admin_orders.sql", "utf8");

function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} is missing`).toBeGreaterThan(-1);
  const end = source.indexOf("\n$$;", start);
  expect(end, `${signature} is not closed`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** Statements only: `--` comments and string literals removed. */
function code(source: string): string {
  return source.replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "''");
}

describe("a number may exist before the parcel does", () => {
  it("0018 required a shipped order, and 0023 does not", () => {
    // The clause that made "record the label first" impossible.
    expect(OLD).toContain("and fulfillment_status <> 'unfulfilled'");
    const shape = SQL.slice(
      SQL.indexOf("add constraint orders_tracking_number_shape"),
      SQL.indexOf("comment on column public.orders.tracking_number"),
    );
    expect(shape).not.toContain("fulfillment_status");
  });

  it("keeps what the shape rule was actually for", () => {
    const shape = SQL.slice(
      SQL.indexOf("add constraint orders_tracking_number_shape"),
      SQL.indexOf("comment on column public.orders.tracking_number"),
    );
    expect(shape).toContain("length(tracking_number) between 1 and 64");
    expect(shape).toContain("tracking_number = btrim(tracking_number)");
  });
});

describe("the fulfilment guard stops guarding something that is not fulfilment", () => {
  const fn = body(SQL, "create or replace function public.orders_protect_fulfillment()");

  it("no longer refuses a tracking change outside the transition", () => {
    expect(OLD).toContain("a tracking number is recorded with the shipment, not edited afterwards");
    expect(fn).not.toContain("tracking_number");
  });

  it("keeps every fulfilment rule it had, line for line", () => {
    expect(fn).toContain("old.fulfillment_status = 'unfulfilled' and new.fulfillment_status = 'shipped'");
    expect(fn).toContain("fulfillment must not change needs_resolution");
    expect(fn).toContain("new.shipped_at := now();");
  });

  it("still freezes shipped_at outside the transition", () => {
    // The whole point of the requirement "editing the number must not move
    // the shipping date".
    expect(fn).toContain("new.shipped_at := old.shipped_at;");
  });
});

describe("recording and correcting is its own action", () => {
  const fn = body(SQL, "create or replace function public.admin_set_tracking_number(");

  it("checks the role in its own body", () => {
    expect(fn).toContain("if not public.is_shop_admin() then");
  });

  it("writes the number and nothing else", () => {
    const update = fn.slice(fn.indexOf("update public.orders"), fn.indexOf("insert into public.order_events"));
    expect(update).toContain("set tracking_number = v_tracking");
    // Neither may appear in the statement — the function cannot ship anything
    // even by accident, and cannot move the date even if the trigger changed.
    expect(update).not.toContain("fulfillment_status");
    expect(update).not.toContain("shipped_at");
  });

  it("records a tracking_updated event", () => {
    expect(fn).toContain("'tracking_updated'");
    expect(fn).toContain("'admin'");
  });

  it("puts no reference into the event payload", () => {
    // An event payload is read by more eyes than the order is, and the old
    // number has no purpose there.
    const payload = fn.slice(fn.indexOf("jsonb_build_object("), fn.indexOf("return case"));
    expect(payload).toContain("had_tracking");
    expect(payload).toContain("has_tracking");
    expect(payload).not.toContain("v_tracking)");
    expect(payload).not.toContain("v_before)");
  });

  it("writes nothing at all for a no-op", () => {
    expect(fn).toContain("if v_tracking is not distinct from v_before then");
    expect(fn).toContain("return 'unchanged';");
  });

  it("trims and refuses an implausible length, as 0018 did", () => {
    expect(fn).toContain("nullif(btrim(coalesce(p_tracking_number, '')), '')");
    expect(fn).toContain("length(v_tracking) > 64");
  });

  it("sends no mail — nothing here reaches the mail path", () => {
    expect(code(fn)).not.toContain("order_mail");
    expect(code(fn)).not.toContain("claim_order_mail");
    expect(code(SQL)).not.toContain("send-order-mail");
  });

  it("is closed to anon", () => {
    expect(SQL).toContain(
      "revoke all on function public.admin_set_tracking_number(text, text) from public, anon",
    );
  });
});

describe("shipping no longer discards a number already recorded", () => {
  const fn = body(SQL, "create or replace function public.admin_mark_order_shipped(");

  it("keeps what is there when none is given", () => {
    expect(fn).toContain("tracking_number    = coalesce(v_tracking, v_order.tracking_number)");
  });

  it("keeps every refusal it had", () => {
    expect(fn).toContain("only a paid order may be shipped");
    expect(fn).toContain("needs to be looked at before it can be shipped");
    expect(fn).toContain("is already %");
  });

  it("still never names a shipping date", () => {
    const update = fn.slice(fn.indexOf("update public.orders"), fn.indexOf("insert into public.order_events"));
    expect(update).not.toContain("shipped_at");
  });
});

describe("a link needs the carrier code, not its label", () => {
  it("both order documents publish it", () => {
    for (const signature of [
      "create or replace function public.admin_order(p_order_number text)",
      "create or replace function public.my_order(p_order_number text)",
    ]) {
      const fn = body(SQL, signature);
      expect(fn, signature).toContain("'shipping_method_code', v_order.shipping_method_code");
    }
  });

  it("and neither has started publishing anything else", () => {
    for (const signature of [
      "create or replace function public.admin_order(p_order_number text)",
      "create or replace function public.my_order(p_order_number text)",
    ]) {
      const fn = body(SQL, signature);
      for (const forbidden of ["client_hash", "payment_token_hash", "request_id"]) {
        expect(fn, `${signature} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("the customer's document still matches on the account alone", () => {
    const fn = body(SQL, "create or replace function public.my_order(p_order_number text)");
    expect(fn).toContain("o.user_id = (select auth.uid())");
  });
});

describe("the migration keeps the house rules", () => {
  it("every function pins an empty search_path", () => {
    const definitions = SQL.match(/create or replace function public\.[a-z_]+\(/g) ?? [];
    const pinned = SQL.match(/set search_path = ''/g) ?? [];
    expect(pinned.length).toBe(definitions.length);
  });

  it("drops no function and no table", () => {
    expect(SQL).not.toMatch(/^drop function/m);
    expect(SQL).not.toMatch(/^drop table/m);
    // Only the one constraint it replaces in place.
    expect(SQL.match(/^alter table public\.orders\n  drop constraint/gm) ?? []).toHaveLength(1);
  });

  it("leaves the commerce mode and the account state alone", () => {
    const statements = code(SQL);
    for (const untouched of [
      "commerce_settings",
      "commerce_testers",
      "commerce_checkout_allowed",
      "cart_items",
      "customer_contacts",
      "order_payment_state",
      "create_order",
      "orders_protect_immutable",
    ]) {
      expect(statements, untouched).not.toContain(untouched);
    }
  });

  it("holds no address, no key and no secret", () => {
    expect(SQL).not.toMatch(/@(gmail|googlemail|outlook|gmx|web)\./i);
    expect(SQL).not.toMatch(/sk_(test|live)_|whsec_|re_[A-Za-z0-9]{8}/);
  });
});
