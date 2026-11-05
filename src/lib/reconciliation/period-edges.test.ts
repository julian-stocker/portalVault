/**
 * The edges of a report's period (phase 4 step 5B) — regression tests for the
 * case of session 5 on Staging: a report from 5 to 28 February, 32 orders,
 * 30 exact, 2 deviating, and 3 SkyIsles sales "not comparable", one of them
 * from 1 March.
 *
 * WHAT IS INTENDED, AND STAYS SO
 *
 *   * `seller_recon_candidates` loads sales up to 3 days before and after the
 *     covered period (0172), and `matchOrders` pairs within ±3 days — so a
 *     sale recorded a day after eBay's date still finds its order.
 *   * A loaded sale that finds no order OUTSIDE the period is
 *     `not_comparable` (`before_coverage` / `after_coverage`), on the first or
 *     last day `edge_day` — never `ledger_only`, which alone says "missing
 *     from the report".
 *
 * Nothing in the matching changed with 5B; these tests pin that down.
 */
import { describe, expect, it } from "vitest";

import { ebayReport, type FixtureOrder } from "./testing/ebay-fixture";
import { ledgerSale } from "./testing/ledger-fixture";
import { rowFor, runReconciliation } from "./testing/run";
import type { LedgerSale } from "./types";
import { pairingCounts } from "./view";

const NAMES = [
  "Spyro", "Trigger Happy", "Gill Grunt", "Eruptor", "Stump Smash", "Wham-Shell", "Zap", "Zook",
  "Bash", "Cynder", "Ignitor", "Ninjini", "Stealth Elf", "Double Trouble", "Hex", "Swarm",
  "Chop Chop", "Drobot", "Boomer", "Camo", "Dino-Rang", "Drill Sergeant", "Flameslinger", "Ghost Roaster",
  "Lightning Rod", "Prism Break", "Slam Bam", "Sonic Boom", "Sunburn", "Terrafin", "Voodood", "Warnado",
];

/** 2026-02-05 + n days, as an ISO day. */
const feb = (n: number) => new Date(Date.UTC(2026, 1, 5 + n)).toISOString().slice(0, 10);

/** 32 orders from 5 to 28 February, one figure each, consecutive record numbers. */
function orders(): FixtureOrder[] {
  return NAMES.map((character, i) => ({
    ref: `55-00000-${String(i + 1).padStart(5, "0")}`,
    record: 7000 + i,
    sold: feb(Math.round((i * 23) / 31)),
    lines: [{ character, unit: 10 + i }],
  }));
}

const run = (sales: LedgerSale[], list: FixtureOrder[] = orders()) =>
  runReconciliation([{ name: "feb.csv", text: ebayReport(list) }], sales);

describe("the window around the period", () => {
  it("the fixture covers exactly 5 to 28 February", () => {
    const r = run([]);
    expect([r.coverage.firstSoldOn, r.coverage.lastSoldOn]).toEqual(["2026-02-05", "2026-02-28"]);
  });

  it("a sale recorded the day after the last report day still pairs with its order — a date deviation, not a missing order", () => {
    const last = orders().at(-1) as FixtureOrder;
    const r = run([ledgerSale({ id: 1, sold: "2026-03-01", net: 41, pieces: ["Warnado"] })], [last]);
    const row = rowFor(r, { orderRef: last.ref });
    expect(row.entry.kind).toBe("pair");
    expect(row.category).toBe("deviating");
    expect(row.diff?.findings.map((f) => f.field)).toContain("sold_on");
    expect(r.rows.some((x) => x.category === "external_only" || x.category === "ledger_only")).toBe(false);
  });

  it("a sale outside the ±3 day window never pairs, even with the same figure and amount", () => {
    const last = orders().at(-1) as FixtureOrder;
    const r = run([ledgerSale({ id: 1, sold: "2026-03-04", net: 41, pieces: ["Warnado"] })], [last]);
    expect(rowFor(r, { orderRef: last.ref }).category).toBe("external_only");
    expect(rowFor(r, { saleId: 1 })).toMatchObject({ category: "not_comparable", entry: { reason: "after_coverage" } });
  });

  it("before and after the period are told apart, and neither is SkyIsles-only", () => {
    const r = run([
      ledgerSale({ id: 1, sold: "2026-02-02", net: 99, pieces: ["Jet-Vac"] }),
      ledgerSale({ id: 2, sold: "2026-03-03", net: 98, pieces: ["Wrecking Ball"] }),
    ]);
    expect(rowFor(r, { saleId: 1 })).toMatchObject({ category: "not_comparable", entry: { reason: "before_coverage" } });
    expect(rowFor(r, { saleId: 2 })).toMatchObject({ category: "not_comparable", entry: { reason: "after_coverage" } });
  });
});

describe("session 5, rebuilt: 32 pairs and 3 unpaired candidates", () => {
  const list = orders();
  const sales: LedgerSale[] = list.map((o, i) => ledgerSale({
    id: 100 + i,
    // two deviations: the last order is recorded a day late, the fourth one euro too high
    sold: i === list.length - 1 ? "2026-03-01" : o.sold,
    net: i === 3 ? 10 + i + 1 : 10 + i,
    pieces: [NAMES[i]],
  }));
  const r = run([
    ...sales,
    ledgerSale({ id: 77, sold: "2026-03-01", net: 64.9, pieces: ["Jet-Vac"] }),      // after the period
    ledgerSale({ id: 78, sold: "2026-02-03", net: 63.9, pieces: ["Wrecking Ball"] }), // before the period
    ledgerSale({ id: 79, sold: "2026-02-28", net: 62.9, pieces: ["Pop Fizz"] }),     // on the last day
  ]);

  it("keeps the categories exactly: 30 exact, 2 deviating, 3 not comparable, nothing missing", () => {
    expect(r.summary.categories).toEqual({
      exact: 30, deviating: 2, probable: 0, ambiguous: 0, external_only: 0, ledger_only: 0, not_comparable: 3,
    });
  });

  it("names the reason of each candidate", () => {
    expect(rowFor(r, { saleId: 77 })).toMatchObject({ category: "not_comparable", entry: { reason: "after_coverage" } });
    expect(rowFor(r, { saleId: 78 })).toMatchObject({ category: "not_comparable", entry: { reason: "before_coverage" } });
    expect(rowFor(r, { saleId: 79 })).toMatchObject({ category: "not_comparable", entry: { reason: "edge_day" } });
  });

  it("the overview counts 32 pairs, 3 unpaired candidates, and 35 stored rows", () => {
    expect(pairingCounts(r.summary.categories)).toEqual({ pairs: 32, reportOnly: 0, ledgerOnly: 0, unpaired: 3, records: 35 });
  });
});
