/**
 * The synthetic scenario `tools/verify-sales-reconciliation.mts` runs on
 * Staging — and that the tests run locally, so both see the same thing.
 *
 * THE NINE KNOWN DEVIATIONS, plus one exact order on each edge of the period.
 * Every value is invented. Three properties keep it away from real data:
 *
 *   * ALL DAYS LIE IN 2001. SkyIsles' business begins in 2026; no real sale
 *     can be a candidate for these orders.
 *   * EVERY SALE IS A TEST SALE (`is_test`), with a note naming the run.
 *   * THE CANDIDATES ARE FILTERED TO THE RUN'S OWN SALE IDS (`ownCandidates`)
 *     before anything is matched. Even a stray real sale in 2001 could never
 *     enter a session. (The matcher skips test sales on purpose; this run
 *     treats exactly its own as the ledger — and nothing else.)
 *
 * Pieces carry raw names only, no SKY-ID: creating these sales therefore
 * places no hold and touches no stock (`hold_sale_item` → `not_a_figure`).
 */

import { ebayReport, type FixtureOrder } from "./ebay-fixture.ts";
import type { LedgerSale } from "../types.ts";

export type ScenarioSale = {
  key: string;
  sold: string;
  subtotal: number;
  discount: number;
  shipping: number;
  pieces: string[];
};

export type ScenarioCase = {
  key: string;
  order: Omit<FixtureOrder, "record" | "ref">;
  sale: ScenarioSale;
  /** What the operator decides for each deviating field. */
  decide: { field: string; decision: "take_external" | "manual"; manual?: Record<string, unknown>; reason?: string }[];
};

const s = (key: string, sold: string, subtotal: number, pieces: string[], o: Partial<ScenarioSale> = {}): ScenarioSale =>
  ({ key, sold, subtotal, discount: 0, shipping: 5.49, pieces, ...o });

const clarify = (field: string) => ({ field, decision: "manual" as const, manual: { action: "clarify" }, reason: "Bestand pruefen (Testlauf)" });

export const SCENARIO: readonly ScenarioCase[] = [
  { key: "anchor-first", order: { sold: "2001-02-01", lines: [{ character: "Zap", unit: 3.5 }] },
    sale: s("anchor-first", "2001-02-01", 3.5, ["Zap"]), decide: [] },
  { key: "case-1-date", order: { sold: "2001-02-18", shipping: 15.99, lines: [{ character: "Hex", unit: 30.3 }, { character: "Cynder", unit: 24 }] },
    sale: s("case-1-date", "2001-02-17", 54.3, ["Hex", "Cynder"], { shipping: 15.99 }), decide: [{ field: "sold_on", decision: "take_external" }] },
  { key: "case-2-date", order: { sold: "2001-02-18", shipping: 10.74, lines: [{ character: "Bash", unit: 3.35 }, { character: "Trigger Happy", unit: 3 }] },
    sale: s("case-2-date", "2001-02-17", 6.35, ["Bash", "Trigger Happy"], { shipping: 10.74 }), decide: [{ field: "sold_on", decision: "take_external" }] },
  { key: "case-3-date", order: { sold: "2001-06-05", lines: [{ character: "Sonic Boom", unit: 6.1 }, { character: "Voodood", unit: 4 }] },
    sale: s("case-3-date", "2001-06-02", 10.2, ["Sonic Boom", "Voodood"], { discount: 0.1 }), decide: [{ field: "sold_on", decision: "take_external" }] },
  { key: "case-4-paid", order: { sold: "2001-06-26", paid: "2001-06-28", shipped: "2001-06-28", lines: [{ character: "Camo", unit: 37.83 }] },
    sale: s("case-4-paid", "2001-06-28", 37.83, ["Camo"]), decide: [{ field: "sold_on", decision: "take_external" }] },
  { key: "case-5-pieces", order: { sold: "2001-04-27", lines: [{ character: "Water Armor (Crystal)", unit: 5.41 },
      { character: "Dark Pyramid (Crystal)", unit: 22.53 }, { character: "Fire Reactor (Crystal)", unit: 1.8, qty: 3 }] },
    sale: s("case-5-pieces", "2001-04-27", 35.1, ["Water Armor", "Dark Pyramid", "Fire Reactor"], { discount: 1.76 }),
    decide: [clarify("pieces"), clarify("figure")] },
  { key: "case-6-figure", order: { sold: "2001-04-24", lines: [{ character: "Chopper", unit: 2.1 }, { character: "Scorp", unit: 1.71 }] },
    sale: s("case-6-figure", "2001-04-24", 3.81, ["Chopper", "Scorpion Striker Catapult"]), decide: [clarify("figure")] },
  { key: "case-7-portal", order: { sold: "2001-04-21", lines: [{ character: "Portal 84148790 (Wireless)", unit: 14.69, title: "Skylanders Portale" }] },
    sale: s("case-7-portal", "2001-04-21", 14.69, ["83973080A Wireless (SA)"]), decide: [clarify("figure")] },
  { key: "case-8-cancel", order: { sold: "2001-09-29", shipping: 5.99, total: 0, shipped: null, lines: [{ character: "Wildfire", unit: 43.19 }] },
    sale: s("case-8-cancel", "2001-09-29", 43.19, ["Wildfire"], { shipping: 5.99 }),
    decide: [{ field: "total", decision: "manual", manual: { action: "cancel", cancelled_on: "2001-09-29" }, reason: "laut Bericht storniert (Testlauf)" }] },
  { key: "case-9-refund", order: { sold: "2001-09-26", shipping: 5.99, total: 13.56, lines: [{ character: "Pop Fizz", unit: 7 }, { character: "Gusto", unit: 7.56 }] },
    sale: s("case-9-refund", "2001-09-26", 14.56, ["Pop Fizz", "Gusto"], { shipping: 5.99 }),
    decide: [{ field: "total", decision: "manual", manual: { action: "refund", amount: 6.99, reason: "versandkorrektur", occurred_on: "2001-09-27" }, reason: "Teilerstattung laut Bericht (Testlauf)" }] },
  { key: "anchor-last", order: { sold: "2001-09-30", lines: [{ character: "Zook", unit: 2.5 }] },
    sale: s("anchor-last", "2001-09-30", 2.5, ["Zook"]), decide: [] },
];

/** The categories the analysis must find for the scenario. */
export const EXPECTED_CATEGORIES = { exact: 2, deviating: 8, probable: 1, ambiguous: 0, external_only: 0, ledger_only: 0 } as const;

/** Order number of a case in one run: unique per run, recognisably synthetic. */
export const orderRef = (run: string, index: number): string => `VR${run}-${String(index + 1).padStart(4, "0")}`;

/** The run's synthetic eBay report. */
export function scenarioReport(run: string): string {
  let record = 100;
  const orders: FixtureOrder[] = SCENARIO.map((c, i) => ({ ...c.order, ref: orderRef(run, i), record: 0 }))
    .sort((a, b) => a.sold.localeCompare(b.sold))
    .map((o) => {
      record += o.lines.length > 1 ? o.lines.length + 1 : 1;
      return { ...o, record };
    });
  return ebayReport(orders);
}

/**
 * The ledger for the matcher: ONLY the run's own sales, and with their test
 * flag lifted for the comparison (the matcher skips test sales by design).
 * Anything else the database returned is dropped here, before matching.
 */
export function ownCandidates(candidates: readonly LedgerSale[], own: ReadonlySet<number>): LedgerSale[] {
  return candidates.filter((c) => own.has(c.saleId)).map((c) => ({ ...c, isTest: false }));
}

/** Every day of the scenario lies in 2001 — far from any real sale. */
export const SCENARIO_PERIOD = { from: "2001-01-01", to: "2001-12-31" } as const;
