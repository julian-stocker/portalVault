/**
 * The REAL preview of 0180 (PGlite), read by `selection.ts` (step 6A).
 *
 * Proves that the preview payload of the migration as committed already
 * carries what the date-gap notice needs — the sale's day and the report's —
 * so the notice needs no change to 0180.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { largeDateGapDecisions, selectionPreviewView } from "../selection";
import { RECONCILIATION_MIGRATIONS, reconciliationWorld } from "./schema";
import { analyseSpecs, decideOn, findingOf, previewSelection, seedSales, type Spec } from "./session-fixture";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const WITH_0180 = [...RECONCILIATION_MIGRATIONS, "0175_sales_recon_account_deletion.sql",
  "0176_sales_recon_validate_before_dedup.sql", "0178_sales_recon_comparison_and_pending.sql",
  "0179_sales_recon_ledger_proof.sql", "0180_sales_recon_selected_apply.sql"] as const;

const FAR = "56-00000-00001";   // deterministic, the day nine days off
const NEAR = "56-00000-00002";  // deterministic, one day off
const UNIQUE = "56-00000-00003"; // unique, one day off

const SPECS: Spec[] = [
  // An anchor on 2 March: the period starts there, so the sale of 1 March is a candidate.
  { ref: "56-00000-00009", sold: "2026-03-02", lines: [{ character: "Zook", unit: 3 }],
    ledger: { sold: "2026-03-02", subtotal: 3, pieces: ["Zook"], carriesRef: true } },
  { ref: FAR, sold: "2026-03-10", lines: [{ character: "Eruptor", unit: 9 }],
    ledger: { sold: "2026-03-01", subtotal: 9, pieces: ["Eruptor"], carriesRef: true } },
  { ref: NEAR, sold: "2026-03-12", lines: [{ character: "Zap", unit: 7 }],
    ledger: { sold: "2026-03-11", subtotal: 7, pieces: ["Zap"], carriesRef: true } },
  { ref: UNIQUE, sold: "2026-03-14", lines: [{ character: "Hex", unit: 5 }],
    ledger: { sold: "2026-03-13", subtotal: 5, pieces: ["Hex"] } },
];

let db: PGlite;
let session: number;
beforeEach(async () => {
  db = await reconciliationWorld({ migrations: WITH_0180 });
  await seedSales(db, SPECS);
  session = await analyseSpecs(db, SPECS);
});
afterEach(async () => { await db.close(); });

describe("the real preview", () => {
  it("carries both days: a deterministic correction of nine days is a large gap, one of one day is not", async () => {
    const far = await decideOn(db, await findingOf(db, session, FAR, "sold_on"), "take_external");
    const near = await decideOn(db, await findingOf(db, session, NEAR, "sold_on"), "take_external");
    const v = selectionPreviewView(await previewSelection(db, session, [far, near]));
    expect(v.admissible).toBe(true);
    expect(v.changes.map((c) => [c.decisionId, c.dateGap, c.largeDateGap])).toEqual([
      [far, { from: "2026-03-01", to: "2026-03-10", days: 9 }, true],
      [near, { from: "2026-03-11", to: "2026-03-12", days: 1 }, false],
    ]);
    expect(largeDateGapDecisions(v)).toEqual([far]);
  });

  it("a unique pair's day is refused by the database, not offered for confirmation", async () => {
    const f = await findingOf(db, session, UNIQUE, "sold_on");
    const keep = await decideOn(db, f, "keep_ledger");
    const v = selectionPreviewView(await previewSelection(db, session, [keep]));
    expect(v.changes[0]).toMatchObject({ problem: "no_change", largeDateGap: false });
    await expect(decideOn(db, f, "take_external")).rejects.toMatchObject({ code: "23514" });
  });
});
