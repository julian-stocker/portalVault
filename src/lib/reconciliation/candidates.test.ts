/**
 * Candidates for an unmatched order (ADR-0182) — the analysis' own scoring,
 * looked at again, read-only. The case: 06-14518-99785 (April report) and
 * sale 381, created AFTER the analysis, as read on Staging on 2026-11-09:
 * seven figures, goods 31,36 − 1,35 discount = 30,01, shipping 5,49, same day.
 */
import { describe, expect, it } from "vitest";

import { CANDIDATE_LIMIT, candidatesFor, eligible, explainCandidate } from "./candidates";
import { scoreCandidate } from "./match";
import type { ExternalOrder, LedgerPiece, LedgerSale } from "./types";

const G = "Skylanders Giants Figuren - Große Auswahl | geprüft | Top Preis";
const SA = "Skylanders Spyros Adventure Figuren - Große Auswahl | geprüft | Top Preis";
const line = (name: string, unitPrice: number, title: string, quantity = 1) =>
  ({ name, title: `${title}[${name}]`, value: unitPrice * quantity, lineRef: null, variant: `[Charakter:${name}]`, quantity, listingId: "1", unitPrice });
const ORDER = {
  orderRef: "06-14518-99785", soldOn: "2026-04-16", itemsValue: 30.01, shipping: 5.49, pieces: 7,
  lines: [line("Cynder", 0.95, G), line("Zook", 7.21, G), line("Slam Bam", 8.58, G), line("Double Trouble", 3.15, G),
    line("Stump Smash", 3.15, G), line("Dino-Rang", 2.32, SA), line("Bash", 4.65, SA)],
} as unknown as Pick<ExternalOrder, "orderRef" | "soldOn" | "itemsValue" | "shipping" | "pieces" | "lines">;

const piece = (skyId: string, name: string, seriesCode: string): LedgerPiece =>
  ({ itemId: 1, skyId, name, rawName: null, seriesCode, baseSkyId: null });
const sale = (saleId: number, over: Partial<LedgerSale> = {}): LedgerSale => ({
  saleId, source: "manual", isTest: false, soldOn: "2026-04-16", itemsSubtotal: 31.36, discount: 1.35, shipping: 5.49,
  refundsTotal: 0, cancelledOn: null, externalOrderRef: null, updatedAt: "2026-11-09T11:23:29Z",
  pieces: [piece("SKY-0150", "Cynder", "G"), piece("SKY-0187", "Zook", "G"), piece("SKY-0021", "Dino-Rang", "SA"),
    piece("SKY-0173", "Slam Bam", "G"), piece("SKY-0152", "Double Trouble", "G"), piece("SKY-0180", "Stump Smash", "G"),
    piece("SKY-0007", "Bash", "SA")],
  ...over,
});
const S381 = sale(381);
/* The other April sales of that window, as on Staging: each carries ANOTHER order number, each paired. */
const PAIRED_SALES = [130, 131, 132].map((id) => sale(id, { externalOrderRef: `25-1449${id}-00000`, pieces: [piece("SKY-0063", "Stump Smash", "SA")] }));
const PAIRED = new Set([130, 131, 132]);

describe("the April case: sale 381, created after the analysis", () => {
  it("the one candidate, first, with the analysis' full score — every part equal", () => {
    const { shown, more } = candidatesFor(ORDER, [...PAIRED_SALES, S381], PAIRED);
    expect(shown.map((c) => c.saleId)).toEqual([381]);
    expect(more).toBe(0);
    const c = shown[0];
    expect(c.score).toBe(105);
    expect(c.analysisCandidate).toBe(true);
    expect(c.figures).toMatchObject({ matched: 7, reportPieces: 7, ledgerPieces: 7 });
    expect(c.figures.rows.every((r) => r.tier === "exact" && r.seriesHint === null)).toBe(true);
    expect(c.goods).toEqual({ report: 30.01, ledgerGross: 31.36, discount: 1.35, ledgerNet: 30.01, netEqual: true, grossEqual: false });
    expect(c.shipping).toEqual({ report: 5.49, ledger: 5.49, equal: true });
    expect(c.date).toEqual({ report: "2026-04-16", ledger: "2026-04-16", delta: 0 });
    expect(c.orderRef).toBeNull();
    expect(c.rivals).toEqual([]);
  });

  it("the score IS scoreCandidate's — nothing here changes it", () => {
    expect(explainCandidate(ORDER, S381).score).toBe(scoreCandidate(ORDER as ExternalOrder, S381)!.score);
  });
});

describe("who is a candidate at all", () => {
  it("never: a sale paired in this session, one with ANOTHER order number, a test, a cancelled one", () => {
    expect(eligible(ORDER, S381, new Set([381]))).toBe(false);
    expect(eligible(ORDER, sale(1, { externalOrderRef: "99-00000-00000" }), new Set())).toBe(false);
    expect(eligible(ORDER, sale(1, { isTest: true }), new Set())).toBe(false);
    expect(eligible(ORDER, sale(1, { cancelledOn: "2026-04-20" }), new Set())).toBe(false);
    expect(eligible(ORDER, sale(1, { externalOrderRef: "06-14518-99785" }), new Set())).toBe(true);
  });

  it("a date ten days off excludes nobody: listed, lower, and marked as outside the analysis' window", () => {
    const late = sale(390, { soldOn: "2026-04-26" });
    const c = explainCandidate(ORDER, late);
    expect(c.date.delta).toBe(10);
    expect(c.analysisCandidate).toBe(false);
    expect(c.score).toBeLessThan(105);
    expect(candidatesFor(ORDER, [late], new Set()).shown.map((x) => x.saleId)).toEqual([390]);
  });

  it("a sale with nothing in common is still shown — at 0, last — not silently dropped", () => {
    const other = sale(391, { itemsSubtotal: 12, discount: 0, pieces: [piece("SKY-0029", "Eruptor", "SA")] });
    const { shown } = candidatesFor(ORDER, [other, S381], new Set());
    expect(shown.map((c) => [c.saleId, c.score])).toEqual([[381, 105], [391, 0]]);
  });
});

describe("several similar candidates", () => {
  it("best first; equal scores by the smaller date distance, then the sale id; three shown, the rest counted", () => {
    const sales = [sale(400, { soldOn: "2026-04-17" }), sale(401, { soldOn: "2026-04-15" }), S381, sale(402, { soldOn: "2026-04-18" }),
      sale(403, { soldOn: "2026-04-19" })];
    const { shown, more } = candidatesFor(ORDER, sales, new Set());
    expect(shown).toHaveLength(CANDIDATE_LIMIT);
    expect(shown.map((c) => c.saleId)).toEqual([381, 400, 401]);
    expect(more).toBe(2);
    // and each one sees the others as rivals — exactly what 0180 would refuse a take-over for
    expect(shown[0].rivals.map((r) => r.saleId)).toEqual([401, 400, 402, 403]);
  });

  it("all of them on request (the search)", () => {
    const sales = [S381, sale(400), sale(401), sale(402), sale(403)];
    expect(candidatesFor(ORDER, sales, new Set(), undefined, null).shown).toHaveLength(5);
  });
});

describe("hints that are NOT part of the score", () => {
  it("the listing says Giants, SkyIsles holds the Spyro's Adventure Cynder: a series hint, the score unchanged", () => {
    const wrong = sale(410, { pieces: [piece("SKY-0020", "Cynder", "SA"), ...S381.pieces.slice(1)] });
    const c = explainCandidate(ORDER, wrong);
    expect(c.figures.rows.find((r) => r.report === "Cynder")!.seriesHint).toEqual({ listing: "G", ledger: "SA" });
    expect(c.score).toBe(scoreCandidate(ORDER as ExternalOrder, wrong)!.score);
    expect(c.score).toBe(105);
  });

  it("a variant name the analysis pairs only loosely says HOW it was paired — not 'exact'", () => {
    const fire = { ...ORDER, pieces: 1, itemsValue: 6, lines: [line("Fire Reactor (Crystal)", 6, "Skylanders Trap Team")] } as typeof ORDER;
    const c = explainCandidate(fire, sale(420, { itemsSubtotal: 6, discount: 0, pieces: [piece("SKY-0597", "Fire Reactor", "T")] }));
    expect(c.figures.matched).toBe(1);
    expect(c.figures.rows[0]).toMatchObject({ report: "Fire Reactor (Crystal)", ledger: "Fire Reactor", skyId: "SKY-0597" });
    expect(c.figures.rows[0].tier).not.toBe("exact");
  });

  it("an unpaired report name contained in an unpaired SkyIsles name is named as similar — still unpaired", () => {
    const one = { ...ORDER, pieces: 1, itemsValue: 6, lines: [line("Zap", 6, "Skylanders")] } as typeof ORDER;
    const c = explainCandidate(one, sale(421, { itemsSubtotal: 6, discount: 0, pieces: [piece("SKY-9001", "Zapper Prototype", "T")] }));
    expect(c.figures.matched).toBe(0);
    expect(c.figures.rows[0]).toMatchObject({ report: "Zap", ledger: null, similarTo: "Zapper Prototype" });
  });

  it("missing and different features: fewer pieces, other shipping, gross equal only", () => {
    const c = explainCandidate(ORDER, sale(430, { discount: 0, itemsSubtotal: 30.01 + 1.35, shipping: 4.99,
      pieces: S381.pieces.slice(0, 5) }));
    expect(c.figures).toMatchObject({ matched: 5, reportPieces: 7, ledgerPieces: 5 });
    expect(c.figures.rows.filter((r) => r.ledger === null).map((r) => r.report)).toEqual(["Stump Smash", "Bash"]);
    expect(c.goods.netEqual).toBe(false);
    expect(c.shipping.equal).toBe(false);
  });
});
