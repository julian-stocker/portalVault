import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  attentionOf,
  canShip,
  normaliseTracking,
  shipBlocker,
  TRACKING_MAX_LENGTH,
  trackingTooLong,
} from "./orders";

/**
 * Admin Orders V1.
 *
 * Two things are worth testing hard here, and neither is the layout: **which
 * orders may be shipped**, and **that shipping touches nothing else**. Sending
 * an unpaid order gives goods away; sending a flagged one hands over stock the
 * ledger still counts as present.
 */

const order = (over: Partial<Parameters<typeof shipBlocker>[0]> = {}) => ({
  payment_status: "paid",
  fulfillment_status: "unfulfilled",
  needs_resolution: false,
  ...over,
});

describe("only a paid, unflagged, unshipped order may be shipped", () => {
  it("ships the ordinary case", () => {
    expect(shipBlocker(order())).toBeNull();
    expect(canShip(order())).toBe(true);
  });

  it("refuses an unpaid order", () => {
    for (const status of ["pending", "expired", "failed", "cancelled"]) {
      expect(canShip(order({ payment_status: status })), status).toBe(false);
      expect(shipBlocker(order({ payment_status: status }))).toBe("not_paid");
    }
  });

  it("refuses a flagged order even though it IS paid", () => {
    /*
     * The late payment from ADR-0050: money arrived, the hold had lapsed, no
     * reservation was converted and no stock was booked. Shipping it would
     * hand over goods the inventory still counts as present.
     */
    expect(canShip(order({ needs_resolution: true }))).toBe(false);
  });

  it("reports the flag rather than the payment status, and that order matters", () => {
    // Such an order is paid. Saying "not paid" would send the operator looking
    // for a problem that is not there.
    expect(shipBlocker(order({ needs_resolution: true, payment_status: "paid" }))).toBe(
      "needs_resolution",
    );
    expect(shipBlocker(order({ needs_resolution: true, payment_status: "pending" }))).toBe(
      "needs_resolution",
    );
  });

  it("refuses an order that has already gone", () => {
    for (const status of ["shipped", "completed", "cancelled", "preparing"]) {
      expect(shipBlocker(order({ fulfillment_status: status })), status).toBe("already_shipped");
    }
  });
});

describe("the attention buckets are the order of the list", () => {
  it("names each level", () => {
    expect(attentionOf(0)).toBe("needs_resolution");
    expect(attentionOf(1)).toBe("to_ship");
    expect(attentionOf(2)).toBe("in_flight");
    expect(attentionOf(3)).toBe("settled");
  });

  it("treats anything unknown as settled rather than urgent", () => {
    // A new bucket must not quietly claim the top of the list.
    expect(attentionOf(99)).toBe("settled");
    expect(attentionOf(-1)).toBe("settled");
  });
});

describe("a tracking number is stored as pasted, minus the whitespace", () => {
  it("trims and empties to null", () => {
    expect(normaliseTracking("  00340434161234567890 ")).toBe("00340434161234567890");
    expect(normaliseTracking("   ")).toBeNull();
    expect(normaliseTracking("")).toBeNull();
    expect(normaliseTracking(null)).toBeNull();
    expect(normaliseTracking(undefined)).toBeNull();
  });

  it("changes nothing else about it", () => {
    // No upper-casing, no dash removal, no carrier detection: DHL, Hermes and
    // DPD disagree, and a validator that knows one would reject the others.
    for (const raw of ["abc-123-XY", "1Z999AA10123456784", "0034 0434 1612", "H1000123456789"]) {
      expect(normaliseTracking(raw)).toBe(raw);
    }
  });

  it("knows the ceiling the database enforces", () => {
    expect(TRACKING_MAX_LENGTH).toBe(64);
    expect(trackingTooLong("x".repeat(64))).toBe(false);
    expect(trackingTooLong("x".repeat(65))).toBe(true);
    expect(trackingTooLong(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("migration 0018", () => {
  const sql = readFileSync("supabase/migrations/0018_admin_orders.sql", "utf8");
  const code = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  function fn(name: string): string {
    const start = code.indexOf(`create or replace function public.${name}(`);
    expect(start, `function ${name} is missing`).toBeGreaterThan(-1);
    const open = code.indexOf("as $$", start);
    return code.slice(open, code.indexOf("$$;", open));
  }

  it("adds one column and creates no table", () => {
    expect(code).toContain("add column if not exists tracking_number text");
    expect(code).not.toMatch(/create table/i);
  });

  it("ties shipped_at and the tracking number to the fulfilment state", () => {
    expect(code).toContain("check (shipped_at is null or fulfillment_status <> 'unfulfilled')");
    expect(code).toContain("length(tracking_number) between 1 and 64");
    expect(code).toContain("tracking_number = btrim(tracking_number)");
  });

  it("every admin function asks is_shop_admin in its own body", () => {
    // public-surface.test.ts classifies on exactly this. A wrapper that checked
    // elsewhere would make these count as public surface.
    for (const name of ["admin_orders", "admin_order", "admin_mark_order_shipped"]) {
      expect(fn(name), name).toContain("public.is_shop_admin()");
    }
  });

  it("pins search_path and is a definer everywhere", () => {
    const defined = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map(
      (m) => m[1],
    );
    expect(defined).toEqual([
      "orders_protect_fulfillment",
      "admin_orders",
      "admin_order",
      "admin_mark_order_shipped",
    ]);
    for (const name of defined) {
      const head = code.slice(
        code.indexOf(`create or replace function public.${name}(`),
        code.indexOf("as $$", code.indexOf(`create or replace function public.${name}(`)),
      );
      expect(head, `${name} does not pin search_path`).toContain("set search_path = ''");
      if (name !== "orders_protect_fulfillment") {
        expect(head, `${name} is not a definer`).toContain("security definer");
      }
    }
  });

  it("grants execute to authenticated and to nobody else", () => {
    for (const signature of [
      "public.admin_orders(boolean, integer, integer)",
      "public.admin_order(text)",
      "public.admin_mark_order_shipped(text, text)",
    ]) {
      expect(code).toContain(`revoke all on function ${signature}`);
      expect(code).toContain(`grant execute on function ${signature} to authenticated;`);
    }
    // The trigger function is nobody's to call.
    expect(code).toContain("revoke all on function public.orders_protect_fulfillment()");
    expect(code).not.toMatch(/grant execute on function public\.orders_protect_fulfillment/);
    expect(code).not.toMatch(/grant[\s\S]{0,60}to\s+anon/);
  });

  it("returns no abuse fingerprint, capability hash or internal id", () => {
    for (const forbidden of ["client_hash", "payment_token_hash", "request_id"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // `o.id` is used to join and to lock, never returned.
    const detail = fn("admin_order");
    expect(detail).not.toMatch(/'order_id'|'id',\s*v_order\.id/);
  });
});

describe("the fulfilment guard is narrow on purpose", () => {
  const sql = readFileSync("supabase/migrations/0018_admin_orders.sql", "utf8");
  const guard = sql.slice(
    sql.indexOf("create or replace function public.orders_protect_fulfillment()"),
    sql.indexOf("comment on function public.orders_protect_fulfillment()"),
  );

  it("allows exactly one transition", () => {
    expect(guard).toContain(
      "if not (old.fulfillment_status = 'unfulfilled' and new.fulfillment_status = 'shipped') then",
    );
  });

  it("refuses to let fulfilment change needs_resolution", () => {
    // The flag means "a human must look at this". Clearing it as a side effect
    // of pressing a shipping button is exactly the accident to prevent.
    expect(guard).toContain("if new.needs_resolution is distinct from old.needs_resolution then");
    expect(guard).toContain("fulfillment must not change needs_resolution");
  });

  it("owns shipped_at, so no caller can name a shipping date", () => {
    expect(guard).toContain("new.shipped_at := now();");
    expect(guard).toContain("new.shipped_at := old.shipped_at;");
  });

  it("fires on update only, so create_order() is untouched", () => {
    expect(sql).toContain("before update on public.orders");
    expect(sql).not.toMatch(/before insert[\s\S]{0,40}on public\.orders/);
  });

  it("does not repeat the business rules", () => {
    // Defence in depth, not a second copy. The trigger knows nothing about
    // payment or administrators.
    expect(guard).not.toContain("is_shop_admin");
    expect(guard).not.toContain("payment_status");
  });
});

describe("shipping moves no money and no stock", () => {
  const sql = readFileSync("supabase/migrations/0018_admin_orders.sql", "utf8");
  const ship = sql.slice(
    sql.indexOf("create or replace function public.admin_mark_order_shipped("),
    sql.indexOf("comment on function public.admin_mark_order_shipped"),
  );

  it("touches no inventory, reservation or payment table", () => {
    for (const forbidden of [
      "shop_inventory",
      "inventory_movements",
      "order_reservations",
      "payment_attempts",
      "payment_events",
      "convert_order_reservations",
      "record_inventory_movement",
    ]) {
      expect(ship, forbidden).not.toContain(forbidden);
    }
  });

  it("updates only the two fulfilment columns", () => {
    expect(ship).toContain("set fulfillment_status = 'shipped'");
    expect(ship).toContain("tracking_number    = v_tracking");
    // shipped_at is absent here: the trigger sets it.
    expect(ship).not.toContain("shipped_at =");
    expect(ship).not.toContain("needs_resolution =");
    expect(ship).not.toContain("payment_status =");
  });

  it("refuses unpaid, flagged and already-shipped orders", () => {
    expect(ship).toContain("if v_order.payment_status <> 'paid' then");
    expect(ship).toContain("if v_order.needs_resolution then");
    expect(ship).toContain("if v_order.fulfillment_status <> 'unfulfilled' then");
  });

  it("takes the row lock before deciding", () => {
    expect(ship).toContain("for update");
  });

  it("records the administrator as the actor", () => {
    expect(ship).toContain("'order_shipped', 'admin', (select auth.uid())");
  });

  it("writes no tracking number into the event payload", () => {
    // The journal says whether there is one, not what it is.
    expect(ship).toContain("'has_tracking', true");
    expect(ship).not.toMatch(/jsonb_build_object\([^)]*v_tracking/);
  });
});

describe("the application never reaches around the functions", () => {
  const files = [
    "src/lib/admin/order-queries.ts",
    "src/lib/admin/order-actions.ts",
    "src/app/(admin)/admin/orders/page.tsx",
    "src/app/(admin)/admin/orders/[orderNumber]/page.tsx",
    "src/components/admin/ship-order-form.tsx",
  ].map((path) => [path, readFileSync(path, "utf8")] as const);

  it("uses no service-role key anywhere", () => {
    for (const [path, text] of files) {
      expect(text, path).not.toContain("SERVICE_ROLE");
      expect(text, path).not.toContain("service_role");
    }
  });

  it("selects no commerce table directly", () => {
    // Everything goes through the three functions; a direct `.from("orders")`
    // would be answered by RLS with the admin's own orders and nothing else,
    // which would look like it worked.
    for (const [path, text] of files) {
      expect(text, path).not.toMatch(/\.from\("(orders|order_lines|order_events|order_addresses)"/);
    }
  });

  it("authorises through is_shop_admin, never an email or a user id", () => {
    for (const [path, text] of files) {
      expect(text, path).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
      expect(text, path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    }
    expect(files.find(([p]) => p.endsWith("order-actions.ts"))![1]).toContain("isAdmin()");
  });
});
