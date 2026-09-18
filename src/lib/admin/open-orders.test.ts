import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { hasOpenWork, NO_OPEN_ORDERS } from "@/lib/admin/orders";
import { latestFunction } from "@/test-support/migrations";

/**
 * How much work is waiting.
 *
 * Until 0045 this was `openOrderCounts(rows)` — a TypeScript tally of the rows
 * `admin_orders(p_open_only => true)` returned. Those tests are now assertions
 * about SQL, because that is where the counting moved and why: the call they
 * counted is capped at 100 rows, so the badge was a count of the first page
 * rather than a count of the work (ADR-0082).
 */

const QUERIES = readFileSync("src/lib/admin/order-queries.ts", "utf8");

/** The effective definition, wherever in the history it now lives. */
function fn(name: string): string {
  return latestFunction(name).body;
}

describe("the badge counts instead of listing", () => {
  const counter = fn("seller_open_order_counts");

  it("separates the three open buckets", () => {
    expect(counter).toContain("'needs_resolution', count(*) filter (where a.attention = 0)");
    expect(counter).toContain("'to_ship',          count(*) filter (where a.attention = 1)");
    expect(counter).toContain("'in_flight',        count(*) filter (where a.attention = 2)");
  });

  it("counts an unpaid checkout rather than dropping it", () => {
    // Until 0024 this row was counted nowhere AND filtered out of the list
    // that calls itself "only open" — so a payment that hung because a webhook
    // never arrived was visible in neither place (ADR-0063).
    expect(fn("order_attention")).toContain("when p_payment_status = 'pending' then 2");
    expect(counter).toContain("a.attention = 2");
  });

  it("ignores settled rows", () => {
    // Bucket 3 has no `filter` clause at all, so it is counted into nothing.
    expect(counter).not.toContain("a.attention = 3");
    expect(counter).not.toContain("a.attention <= 3");
  });

  it("uses the one attention definition, not a second copy of it", () => {
    expect(counter).toContain("public.order_attention(o.needs_resolution, o.payment_status");
    expect(counter).not.toContain("when o.needs_resolution then 0");
  });
});

describe("the count is not capped", () => {
  it("has no limit, no offset and no page", () => {
    const counter = fn("seller_open_order_counts");
    expect(counter).not.toContain("limit");
    expect(counter).not.toContain("offset");
  });

  it("so a shop with more than a hundred open orders reports all of them", () => {
    /*
     * The defect this replaces, exactly: `admin_orders()` clamps to
     * `least(coalesce(p_limit, 100), 500)`. Counting its rows could therefore
     * never return more than 100 — a shop with 130 flagged orders said 100,
     * and would have said 100 at 1300.
     */
    expect(fn("admin_orders")).toContain("least(coalesce(p_limit, 100), 500)");
    expect(QUERIES).toContain('rpc("seller_open_order_counts")');
    // And the badge no longer reads the capped call at all.
    const badge = QUERIES.slice(QUERIES.indexOf("export const fetchOpenOrderCounts"));
    expect(badge.slice(0, badge.indexOf("});"))).not.toContain("fetchAdminOrders");
  });

  it("the defect, in arithmetic: 130 open orders used to be reported as 100", () => {
    /*
     * The old implementation was `openOrderCounts(await fetchAdminOrders(true))`,
     * and `fetchAdminOrders` passes no `p_limit`, so the RPC returned its
     * default page. Reconstructed here so the failure is a number rather than
     * a worry.
     */
    const LIMIT = 100;
    const open = [...Array(130)].map((_, i) => ({ attention: i < 7 ? 0 : 1 }));

    const oldAnswer = open.slice(0, LIMIT).filter((o) => o.attention === 1).length;
    const truth = open.filter((o) => o.attention === 1).length;
    expect(oldAnswer).toBe(93);
    expect(truth).toBe(123);
    expect(oldAnswer).not.toBe(truth);

    // The new one cannot lose them: the aggregate has no page to fall off.
    const counter = fn("seller_open_order_counts");
    expect(counter).not.toMatch(/limit\s/);
    expect(counter).toContain("count(*) filter (where a.attention = 1)");
  });

  it("and the flagged bucket survives the same growth", () => {
    // Seven flagged orders behind a hundred shippable ones were visible only
    // because they sort first. The count must not depend on that.
    const counter = fn("seller_open_order_counts");
    expect(counter).not.toContain("order by");
    expect(counter).toContain("count(*) filter (where a.attention = 0)");
  });

  it("the row counter is gone rather than left behind unused", () => {
    const orders = readFileSync("src/lib/admin/orders.ts", "utf8");
    expect(orders).not.toContain("export function openOrderCounts");
    // The reason it went is written where it was, so it does not come back.
    expect(orders).toContain("It was removed in 0045");
  });

  it("but the predicate that decides what is open did not change", () => {
    // Same three buckets, same boundary. Only the arithmetic moved.
    expect(fn("admin_orders")).toContain("r.attention <= 2");
    for (const bucket of [0, 1, 2]) {
      expect(fn("seller_open_order_counts")).toContain(`a.attention = ${bucket}`);
    }
  });
});

describe("a count that cannot be read is no badge, not a broken page", () => {
  it("falls back to zeroes", () => {
    expect(QUERIES).toContain("return NO_OPEN_ORDERS;");
    expect(NO_OPEN_ORDERS).toEqual({ needsResolution: 0, toShip: 0, inFlight: 0 });
  });

  it("and a negative or non-numeric answer counts as none", () => {
    expect(QUERIES).toContain('typeof value === "number" && value >= 0');
  });

  it("an account without the capability is never asked", () => {
    expect(QUERIES).toContain("if (!(await canOperateSeller())) return NO_OPEN_ORDERS;");
    expect(fn("seller_open_order_counts")).toContain(
      "if not public.can_operate_active_seller() then",
    );
  });
});

describe("hasOpenWork — is there something for a person to do?", () => {
  it("is false only when both actionable buckets are empty", () => {
    expect(hasOpenWork(NO_OPEN_ORDERS)).toBe(false);
    expect(hasOpenWork({ needsResolution: 0, toShip: 1, inFlight: 0 })).toBe(true);
    expect(hasOpenWork({ needsResolution: 1, toShip: 0, inFlight: 0 })).toBe(true);
  });

  it("stays false for a checkout in flight", () => {
    // It is open, and it needs nobody. Saying "you have work" about it would
    // make the sentence untrue every time somebody opens a basket.
    expect(hasOpenWork({ needsResolution: 0, toShip: 0, inFlight: 3 })).toBe(false);
  });
});

/**
 * The badge exists for one reason: a flagged order is paid, unbooked and
 * shipping-locked (ADR-0050). It must survive being mixed into a list where
 * everything else is ordinary work — and now also a shop big enough that the
 * old implementation would have stopped counting.
 */
describe("the flagged bucket is never diluted", () => {
  it("is counted on its own, not as a share of the rest", () => {
    expect(fn("seller_open_order_counts")).toContain(
      "'needs_resolution', count(*) filter (where a.attention = 0)",
    );
    expect(hasOpenWork({ needsResolution: 1, toShip: 4000, inFlight: 0 })).toBe(true);
  });
});
