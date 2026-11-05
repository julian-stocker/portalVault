/**
 * The synthetic scenario of `tools/verify-recon-0180.mts` (step 6A) — and of
 * its local tests, so both see the same thing.
 *
 * The rules of `staging-scenario.ts` hold unchanged: every day in 2001, every
 * sale a TEST SALE (`is_test`) with a note naming the run, raw names only (no
 * hold, no stock), and the candidates filtered to the run's own sale ids.
 *
 * WHAT A TEST SALE CAN PROVE UNDER 0180. 0180 refuses every take-over on a
 * test sale (`test_sale`) — on purpose: a test sale is never changed. So on
 * these sales the run proves the REFUSALS of 0180 and that nothing moved;
 * the positive path (an applied correction, a reference added, two applies
 * at once) needs a sale that is not a test sale. Whether the run may use one
 * is the operator's decision (`POSITIVE_PATH_BLOCKED`) — it is not taken here.
 */

import { ebayReport, type FixtureOrder } from "./ebay-fixture.ts";

export type Case0180 = {
  key: "det-date" | "unique-ref" | "cancel-total";
  order: Omit<FixtureOrder, "record" | "ref">;
  sale: { sold: string; subtotal: number; shipping: number; pieces: string[]; carriesRef: boolean };
};

export const SCENARIO_0180: readonly Case0180[] = [
  // deterministic: the sale carries the order number, the day is one off
  { key: "det-date", order: { sold: "2001-05-10", lines: [{ character: "Eruptor", unit: 9 }] },
    sale: { sold: "2001-05-09", subtotal: 9, shipping: 5.49, pieces: ["Eruptor"], carriesRef: true } },
  // unique: equal, only the order number is missing
  { key: "unique-ref", order: { sold: "2001-05-12", lines: [{ character: "Zap", unit: 7 }] },
    sale: { sold: "2001-05-12", subtotal: 7, shipping: 5.49, pieces: ["Zap"], carriesRef: false } },
  // the report says cancelled (total 0): an event — never through the reconciliation
  { key: "cancel-total", order: { sold: "2001-05-14", total: 0, shipped: null, lines: [{ character: "Hex", unit: 5 }] },
    sale: { sold: "2001-05-14", subtotal: 5, shipping: 5.49, pieces: ["Hex"], carriesRef: true } },
];

/** Category and certainty the analysis must give each case. */
export const EXPECTED_0180: Record<Case0180["key"], [string, string]> = {
  "det-date": ["deviating", "deterministic"],
  "unique-ref": ["exact", "unique"],
  "cancel-total": ["deviating", "deterministic"],
};

/** Order number of a case in one run: unique per run, recognisably synthetic. */
export const orderRef0180 = (run: string, index: number): string => `VS${run}-${String(index + 1).padStart(4, "0")}`;

export function scenarioReport0180(run: string): string {
  let record = 500;
  return ebayReport(SCENARIO_0180.map((c, i) => ({ ...c.order, ref: orderRef0180(run, i), record: (record += 1) })));
}

export const SCENARIO_0180_PERIOD = { from: "2001-05-01", to: "2001-05-31" } as const;

/**
 * What the run CANNOT prove on test sales, said as a list and never counted
 * as passed. Each item is proven locally on PostgreSQL
 * (`src/lib/reconciliation/sql/selected-apply-0180.test.ts`); on Staging it
 * waits for the operator's decision on a non-test sale.
 */
export const POSITIVE_PATH_BLOCKED = [
  "eine ausgewählte deterministic-Korrektur wird übernommen (Vorschau, Token, ein Schreibvorgang)",
  "Wiederholschutz: dieselbe Übernahme ein zweites Mal schreibt nichts",
  "zwei gleichzeitige Übernahmen über zwei echte Verbindungen: genau eine schreibt",
  "unique: die fehlende Bestellnummer wird ergänzt, sonst nichts",
  "erneute Analyse: danach deterministic, erst dann Datum und Beträge",
] as const;
