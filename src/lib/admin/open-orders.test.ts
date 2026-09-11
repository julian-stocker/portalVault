import { describe, expect, it } from "vitest";

import { hasOpenWork, NO_OPEN_ORDERS, openOrderCounts } from "@/lib/admin/orders";

/** `attention` as migration 0018 emits it: 0 flagged, 1 to ship, 2, 3. */
const row = (attention: number) => ({ attention });

describe("openOrderCounts", () => {
  it("counts nothing for an empty list", () => {
    expect(openOrderCounts([])).toEqual(NO_OPEN_ORDERS);
  });

  it("separates the two buckets", () => {
    expect(openOrderCounts([row(0), row(0), row(1)])).toEqual({
      needsResolution: 2,
      toShip: 1,
    });
  });

  it("ignores settled and in-flight rows", () => {
    // `p_open_only` filters these out in SQL; an unfiltered list must still
    // produce the same answer.
    expect(openOrderCounts([row(0), row(2), row(3), row(9)])).toEqual({
      needsResolution: 1,
      toShip: 0,
    });
  });

  it("treats an unknown attention value as settled, never as urgent", () => {
    expect(openOrderCounts([row(7), row(-1)])).toEqual(NO_OPEN_ORDERS);
  });
});

describe("hasOpenWork", () => {
  it("is false only when both buckets are empty", () => {
    expect(hasOpenWork(NO_OPEN_ORDERS)).toBe(false);
    expect(hasOpenWork({ needsResolution: 0, toShip: 1 })).toBe(true);
    expect(hasOpenWork({ needsResolution: 1, toShip: 0 })).toBe(true);
  });
});

/**
 * The badge exists for one reason: a flagged order is paid, unbooked and
 * shipping-locked (ADR-0050). It must survive being mixed into a list where
 * everything else is ordinary work.
 */
describe("the flagged bucket is never diluted", () => {
  it("stays visible among many shippable orders", () => {
    const rows = [...Array(40)].map(() => row(1)).concat(row(0));
    const counts = openOrderCounts(rows);
    expect(counts.needsResolution).toBe(1);
    expect(counts.toShip).toBe(40);
  });
});
