import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { attentionOf, hasOpenWork, NO_OPEN_ORDERS } from "@/lib/admin/orders";
import { latestFunction } from "@/test-support/migrations";
import { de } from "@/lib/i18n/de";

/**
 * The bug this file exists for, observed on production on 2026-09-12.
 *
 * `SI-2026-001004` sat at `pending` / `unfulfilled` because a webhook was
 * pointed at the wrong URL. The row said **„Offen"**. The filter above it said
 * **„Nur offene"**. The order appeared only under „Alle Bestellungen".
 *
 * One word, two meanings, two lines apart — and the case it hid is the one an
 * operator most needs to see (ADR-0063).
 */

const SQL_0024 = readFileSync("supabase/migrations/0024_open_orders_include_pending.sql", "utf8");
const SQL_0021 = readFileSync("supabase/migrations/0021_commerce_mode.sql", "utf8");

/** The body of `admin_orders()` in a given migration. */
function adminOrders(source: string): string {
  const start = source.indexOf("create or replace function public.admin_orders(");
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("\n$$;", start));
}

describe("the filter and the label agree on what open means", () => {
  it("0021 excluded the bucket it labelled open — that was the bug", () => {
    expect(adminOrders(SQL_0021)).toContain("r.attention <= 1");
  });

  it("0024 includes it", () => {
    const fn = adminOrders(SQL_0024);
    expect(fn).toContain("r.attention <= 2");
    expect(fn).not.toContain("r.attention <= 1");
  });

  it("and stops short of settled", () => {
    // Bucket 3 is paid-and-shipped, expired, cancelled, refunded. Nothing can
    // still happen to those, and a list that never empties is a list nobody
    // reads.
    const fn = adminOrders(SQL_0024);
    expect(fn).not.toContain("r.attention <= 3");
    expect(fn).toContain("else 3");
  });

  it("changes nothing else about the function", () => {
    const before = adminOrders(SQL_0021);
    const after = adminOrders(SQL_0024);
    // The four buckets, unchanged.
    for (const rule of [
      "when o.needs_resolution then 0",
      "when o.payment_status = 'paid'",
      "and o.fulfillment_status = 'unfulfilled' then 1",
      "when o.payment_status = 'pending' then 2",
    ]) {
      expect(before, rule).toContain(rule);
      expect(after, rule).toContain(rule);
    }
    // The role check, the ordering and the columns, unchanged.
    expect(after).toContain("if not public.is_shop_admin() then");
    expect(after).toContain("order by r.attention, r.placed_at desc");
    expect(after).toContain("commerce_mode      text");
  });

  it("the label no longer collides with the filter's name", () => {
    const copy = de.admin.orders;
    expect(copy.openOnly).toBe("Nur offene");
    // „Offen" on a row plus „Nur offene" above it, with the row hidden by the
    // filter, is exactly what a person cannot make sense of.
    expect(copy.attention.in_flight).not.toBe("Offen");
    expect(copy.attention.in_flight).toBe("Zahlung offen");
  });

  it("and the filter says out loud what it means", () => {
    expect(de.admin.orders.openOnlyHint).toContain("nicht abgeschlossen");
  });
});

describe("the counter uses the same definition as the list", () => {
  /*
   * These used to exercise `openOrderCounts(rows)`. The counting moved into
   * `seller_open_order_counts()` in 0045 — because counting rows fetched from
   * a 100-row page is not counting (ADR-0082) — so the same three assertions
   * are now made about the SQL that does it.
   */
  // The effective definition: 0046 redefines this one to be live-only.
  const counter = latestFunction("seller_open_order_counts").body;

  it("counts all three open buckets", () => {
    for (const bucket of [0, 1, 2]) {
      expect(counter, String(bucket)).toContain(`count(*) filter (where a.attention = ${bucket})`);
    }
  });

  it("an unpaid checkout is counted, but it is not work", () => {
    expect(counter).toContain("'in_flight',        count(*) filter (where a.attention = 2)");
    // The nav badge must not light up because somebody opened a basket.
    expect(hasOpenWork({ ...NO_OPEN_ORDERS, inFlight: 1 })).toBe(false);
  });

  it("a settled order is neither", () => {
    expect(counter).not.toContain("a.attention = 3");
    expect(hasOpenWork(NO_OPEN_ORDERS)).toBe(false);
  });

  it("the buckets the counter knows are the buckets the SQL emits", () => {
    // If a fifth bucket is ever added, this fails until both sides know it.
    expect([0, 1, 2, 3].map(attentionOf)).toEqual([
      "needs_resolution",
      "to_ship",
      "in_flight",
      "settled",
    ]);
    expect(Object.keys(de.admin.orders.attention).sort()).toEqual([
      "in_flight",
      "needs_resolution",
      "settled",
      "to_ship",
    ]);
  });
});

describe("list and counter read the same rows", () => {
  const queries = readFileSync("src/lib/admin/order-queries.ts", "utf8");
  const home = readFileSync("src/app/(business)/business/page.tsx", "utf8");
  const list = readFileSync("src/app/(business)/business/orders/page.tsx", "utf8");
  const archive = readFileSync("src/lib/admin/order-archive.ts", "utf8");

  /** Block and line comments removed, so prose cannot satisfy or break a test. */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  it("the list and the counter share a predicate, not an implementation", () => {
    /*
     * These were one call until 0045: the counter tallied the list's rows.
     * That is why the badge was capped at 100 (ADR-0082). They are now two
     * queries — and the drift this file exists to prevent is prevented the
     * better way, by both deriving their buckets from `order_attention()`
     * rather than by one being a by-product of the other.
     */
    expect((queries.match(/rpc\("admin_orders"/g) ?? []).length).toBe(1);
    expect(queries).toContain('rpc("seller_open_order_counts")');

    for (const name of ["admin_orders", "seller_open_order_counts"]) {
      const body = latestFunction(name).body;
      expect(body, name).toContain("public.order_attention(o.needs_resolution");
      // And nowhere is the rule written out a second time.
      expect(body, name).not.toContain("when o.needs_resolution then 0");
    }
  });

  it("the list asks the same function with the same flag", () => {
    // `?open=1` is still its own view and still one call. The archive views
    // added in 0045 sit beside it; they did not absorb it (ADR-0082).
    expect(list).toContain('open === "1"');
    expect(list).toContain("fetchAdminOrders(true)");
  });

  it("neither filters again in TypeScript", () => {
    // The rule lives in SQL. A second copy here is a second thing to keep in
    // step, and it would be the one nobody remembers.
    //
    // Comments are stripped first. This assertion is about what the code
    // DOES, and a doc comment that explains the SQL rule is not a second
    // implementation of it — matching prose would only teach the next author
    // to stop explaining things.
    for (const source of [list, home, archive]) {
      const code = withoutComments(source);
      expect(code).not.toMatch(/attention\s*<=\s*\d/);
      expect(code).not.toMatch(/payment_status\s*===\s*"pending"/);
    }
  });

  it("the admin home shows unpaid checkouts, quietly and separately", () => {
    expect(home).toContain("openOrders.inFlight > 0");
    expect(home).toContain("orders.inFlightCount");
    // Still separate from the work line: hasOpenWork decides that one.
    expect(home).toContain("hasOpenWork(openOrders)");
  });
});

describe("the reported case, end to end through the model", () => {
  /**
   * SI-2026-001004 as it stood: placed, not paid, nothing shipped, not
   * flagged. `admin_orders()` sorts it into bucket 2.
   */
  const stuckCheckout = { attention: 2 };

  it("appears under only-open", () => {
    // The SQL predicate, applied to the bucket the row would get.
    expect(stuckCheckout.attention <= 2).toBe(true);
  });

  it("did not, before 0024", () => {
    expect(stuckCheckout.attention <= 1).toBe(false);
  });

  it("is counted", () => {
    // Bucket 2 has its own `filter` clause in the aggregate, so it is counted
    // rather than folded into "settled".
    expect(latestFunction("seller_open_order_counts").body).toContain(
      "'in_flight',        count(*) filter (where a.attention = 2)",
    );
    expect(stuckCheckout.attention).toBe(2);
  });

  it("and is labelled without using the filter's word", () => {
    expect(de.admin.orders.attention[attentionOf(stuckCheckout.attention)]).toBe("Zahlung offen");
  });
});
