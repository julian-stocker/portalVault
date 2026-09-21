import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  PURCHASE_REASONS, SALE_REASONS, dayOf, draftDelta, draftFloor, mergeHistory,
  tradeCounters, type LegacyEvent, type OperativeMovement,
} from "./stock-history";

const legacy = (over: Partial<LegacyEvent> & { occurredAt: string }): LegacyEvent => ({
  eventType: "purchase", quantity: 1, marketPriceSnapshot: 9.49,
  sourceSheet: "Order 2026", sourceRow: 100, note: null, ...over,
});
const movement = (over: Partial<OperativeMovement> & { id: number }): OperativeMovement => ({
  delta: 1, reason: "correction", unitCost: null, note: null,
  createdAt: "2026-09-18T10:00:00.000Z", ...over,
});

describe("the two sources become one list, oldest first", () => {
  it("interleaves them by date rather than by source", () => {
    const entries = mergeHistory(
      [legacy({ occurredAt: "2026-01-01", eventType: "opening_balance", quantity: 5 }),
       legacy({ occurredAt: "2026-08-07", eventType: "sale", quantity: -2 })],
      [movement({ id: 7, createdAt: "2026-03-23T09:00:00.000Z" })],
    );
    expect(entries.map((e) => e.date)).toEqual(["2026-01-01", "2026-03-23", "2026-08-07"]);
    expect(entries.map((e) => e.source)).toEqual(["legacy", "operative", "legacy"]);
  });

  it("puts the newest entry last, because that is where the card parks", () => {
    const entries = mergeHistory([], [
      movement({ id: 2, createdAt: "2026-09-21T10:00:00.000Z" }),
      movement({ id: 1, createdAt: "2026-09-18T10:00:00.000Z" }),
    ]);
    // `admin_inventory_movements` returns newest first; the merge reverses it.
    expect(entries.map((e) => e.key)).toEqual(["movement:1", "movement:2"]);
  });

  it("places a reconstruction above a booking made the same day", () => {
    // The one day both can occur is the migration cut, and what was
    // reconstructed describes the time before SkyIsles booked anything.
    const entries = mergeHistory(
      [legacy({ occurredAt: "2026-01-01", eventType: "opening_balance", quantity: 3 })],
      [movement({ id: 4, createdAt: "2026-01-01T08:00:00.000Z" })],
    );
    expect(entries.map((e) => e.source)).toEqual(["legacy", "operative"]);
  });

  it("gives every entry a key the other source cannot collide with", () => {
    const entries = mergeHistory(
      [legacy({ occurredAt: "2026-02-01" }), legacy({ occurredAt: "2026-02-01" })],
      [movement({ id: 1 })],
    );
    expect(new Set(entries.map((e) => e.key)).size).toBe(3);
  });

  it("names the workbook line a reconstructed row came from", () => {
    const [entry] = mergeHistory(
      [legacy({ occurredAt: "2026-03-01", sourceSheet: "Order 2026", sourceRow: 1635 })], []);
    expect(entry.sourceRef).toBe("Order 2026!1635");
  });

  it("gives no source to a technical value or an operative movement", () => {
    const [technical] = mergeHistory(
      [legacy({ occurredAt: "2026-01-01", eventType: "opening_balance", quantity: 5,
                sourceSheet: null, sourceRow: null })], []);
    expect(technical.sourceRef).toBeNull();
    const [booked] = mergeHistory([], [movement({ id: 1 })]);
    expect(booked.sourceRef).toBeNull();
  });

  it("reduces a timestamp to the day, because the workbook knows no hour", () => {
    expect(dayOf("2026-09-21T15:35:23.888130+00:00")).toBe("2026-09-21");
    expect(dayOf("2026-01-01")).toBe("2026-01-01");
  });
});

describe("no running balance is offered, deliberately", () => {
  /**
   * ADR-0102 gave up the historical curve: for fifteen figures the
   * reconstruction's intermediate sums go negative, because the legacy data
   * cannot support a defensible one. A "stock after" column would present
   * that gap as a fact, so this module must not even expose the number.
   */
  it("exposes no per-entry balance", () => {
    const [entry] = mergeHistory([legacy({ occurredAt: "2026-01-01" })], []);
    expect(Object.keys(entry).sort())
      .toEqual(["date", "key", "kind", "marketValue", "note", "quantity", "source", "sourceRef"]);
  });
});

describe("the market value is only ever one that was recorded", () => {
  it("takes the legacy snapshot as it stands", () => {
    const [entry] = mergeHistory([legacy({ occurredAt: "2026-03-01", marketPriceSnapshot: 14.49 })], []);
    expect(entry.marketValue).toBe(14.49);
  });

  it("keeps NULL null instead of inventing a price", () => {
    const [entry] = mergeHistory([legacy({ occurredAt: "2026-03-01", marketPriceSnapshot: null })], []);
    expect(entry.marketValue).toBeNull();
  });

  it("leaves an operative movement without one, because none is stored", () => {
    // `inventory_movements` has `unit_cost` — a cost basis, not a market
    // value — and no market snapshot at all. Today's price is not a
    // historical price (ADR-0102).
    const [entry] = mergeHistory([], [movement({ id: 1, unitCost: 7.5, reason: "purchase" })]);
    expect(entry.marketValue).toBeNull();
  });
});

describe("Eingekauft and Verkauft are two complete aggregates, added", () => {
  const legacy = { purchasedUnits: 10, soldUnits: 8 };

  it("adds the reconstruction and the operative ledger", () => {
    expect(tradeCounters(legacy, { purchasedUnits: 1, soldUnits: 1 }))
      .toEqual({ purchased: 11, sold: 9 });
  });

  it("works when only one half exists", () => {
    expect(tradeCounters(legacy, undefined)).toEqual({ purchased: 10, sold: 8 });
    expect(tradeCounters(undefined, { purchasedUnits: 4, soldUnits: 2 }))
      .toEqual({ purchased: 4, sold: 2 });
  });

  it("works for a position neither half knows", () => {
    expect(tradeCounters(undefined, undefined)).toEqual({ purchased: 0, sold: 0 });
  });

  /*
   * THE REGRESSION THIS FUNCTION EXISTS TO PREVENT.
   *
   * The operative half used to be summed from the movement list the card
   * happened to hold, and that list is capped — `p_limit`, hard-limited to
   * 500 by the database. A position past that undercounted its own lifetime
   * with nothing on screen to say so. The signature is now the guard: a
   * timeline cannot be passed in, so a cap cannot reach the counters.
   */
  it("takes no timeline and therefore cannot be truncated by one", () => {
    expect(tradeCounters.length).toBe(2);
    const source = readFileSync("src/lib/admin/stock-history.ts", "utf8");
    const body = source.slice(source.indexOf("export function tradeCounters"));
    const fn = body.slice(0, body.indexOf("\n}"));
    // No iteration, no reason test, no delta — nothing that only a row has.
    expect(fn).not.toMatch(/for\s*\(|\.reduce\(|\.filter\(|\.map\(/);
    expect(fn).not.toContain("PURCHASE_REASONS");
    expect(fn).not.toContain("SALE_REASONS");
    expect(fn).not.toContain("delta");
  });

  it("counts a position with more than 500 movements in full", () => {
    /*
     * 12 000 purchases and 9 000 sales on one position. A 500-row window
     * would have reported 500-ish of them; the aggregate reports all of
     * them, because the database summed them and no list was involved.
     */
    expect(tradeCounters(undefined, { purchasedUnits: 12_000, soldUnits: 9_000 }))
      .toEqual({ purchased: 12_000, sold: 9_000 });
  });

  it("is unchanged by how many timeline rows a card happens to show", () => {
    // Same position, three different display limits, one answer.
    const operative = { purchasedUnits: 700, soldUnits: 650 };
    const shown = [0, 20, 500].map(() => tradeCounters(legacy, operative));
    expect(new Set(shown.map((c) => JSON.stringify(c))).size).toBe(1);
    expect(shown[0]).toEqual({ purchased: 710, sold: 658 });
  });

  it("gives the legacy sums alone while the operative ledger is empty", () => {
    // Production semantics right after the pre-go-live cutover (ADR-0103):
    // `inventory_movements` is 0, so `seller_business_trade_totals()`
    // returns no row for any position and the card reads that as zero.
    expect(tradeCounters(legacy, undefined)).toEqual({ purchased: 10, sold: 8 });
    expect(tradeCounters(legacy, { purchasedUnits: 0, soldUnits: 0 }))
      .toEqual({ purchased: 10, sold: 8 });
  });

  it("keeps the two vocabularies where a reader can check them", () => {
    // The arithmetic is in SQL now; these stay as the readable statement of
    // the split, and `stock-card.test.ts` holds them in step with 0086.
    expect([...PURCHASE_REASONS]).toEqual(["purchase"]);
    expect([...SALE_REASONS].sort()).toEqual(["sale", "sale_external", "sale_skyisles"]);
  });
});

describe("the draft the stepper holds", () => {
  it("books the net difference, not one movement per tap", () => {
    expect(draftDelta(5, 3)).toBe(2);
    expect(draftDelta(1, 4)).toBe(-3);
  });

  it("writes nothing when the draft is back where it started", () => {
    expect(draftDelta(3, 3)).toBe(0);
  });

  it("floors at what is reserved, never at zero when something is promised", () => {
    expect(draftFloor(0)).toBe(0);
    expect(draftFloor(2)).toBe(2);
  });

  it("never returns a negative floor", () => {
    expect(draftFloor(-1)).toBe(0);
  });
});
