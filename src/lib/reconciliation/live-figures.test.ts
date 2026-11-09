/**
 * Figures and count judged again after a correction in the Orderbuch
 * (2026-11-08, 0181) — on the sale's CURRENT positions (`livePieces`), by the
 * analysis' own rules (`matchPieces` → `diffPair`).
 *
 * The case is sale 152 of the April session, simulated: the report sold
 * Water Armor, Dark Pyramid and three Fire Reactor (Crystal); SkyIsles held
 * three lines with a plain Fire Reactor. The analysis stored a count finding
 * (3 vs 5) and figure findings.
 */
import { describe, expect, it } from "vitest";

import { analysedPieces, judgesFigures, liveDifferences, needsReassessment } from "./live";
import { isReassessed, orderOutcome, planMatch, workState } from "./plan";
import type { LedgerPiece } from "./types";
import type { Finding, Match } from "./view";

const line = (name: string, quantity = 1) =>
  ({ lineRef: null, listingId: "1", title: name, variant: null, name, quantity, unitPrice: 6, value: 6 * quantity });
const ORDER = {
  id: 176, orderRef: "12-14520-00152", recordNo: 1, soldOn: "2026-04-24", paidOn: null, shippedOn: null,
  itemsValue: 30, shipping: 5.49, total: 35.49, pieces: 5, combined: false, destinationCountry: "DE",
  shippingService: null, sourceFile: "april.csv",
  lines: [line("Water Armor"), line("Dark Pyramid"), line("Fire Reactor (Crystal)", 3)],
} as unknown as NonNullable<Match["order"]>;

const piece = (itemId: number, skyId: string | null, name: string | null, rawName: string | null = name): LedgerPiece =>
  ({ itemId, skyId, name, rawName, seriesCode: "TT", baseSkyId: null });
const WORKBOOK = [piece(518, "SKY-0612", "Water Armor"), piece(519, "SKY-0590", "Dark Pyramid"), piece(520, "SKY-0597", "Fire Reactor")];
const CRYSTAL = (id: number) => piece(id, "SKY-0598", "Fire Reactor (Crystal)", null);

const finding = (over: Partial<Finding>): Finding => ({
  id: 1, key: "pieces", field: "pieces", kind: "deviation", shown: { ledger: 3, external: 5 }, delta: -2, causes: [],
  allowedDecisions: ["keep_ledger", "defer"], decision: null, applied: false, lock: null, ...over,
});
/* What the analysis stored: the count, and the report's two crystal pieces SkyIsles lacked. */
const STORED: Finding[] = [
  finding({}),
  finding({ id: 144, key: "figure:3", field: "figure", shown: { ledger: null, external: "Fire Reactor (Crystal)" }, delta: null }),
  finding({ id: 145, key: "figure:4", field: "figure", shown: { ledger: null, external: "Fire Reactor (Crystal)" }, delta: null }),
];

const sale152 = (pieces: readonly LedgerPiece[] | undefined, state: "changed" | "unchanged" = "changed",
  over: Partial<Match> = {}): Match => ({
  id: 191, category: "deviating", certainty: "unique", score: 80, dateDelta: 0, competitors: [], reason: null,
  order: ORDER, sale: { id: 152 } as Match["sale"],
  ledger: { state, version: { analysed: "v", current: state === "changed" ? "w" : "v" },
    atAnalysis: {} as NonNullable<Match["ledger"]>["atAnalysis"],
    current: { soldOn: "2026-04-24", itemsSubtotal: 30, discount: 0, itemsNet: 30, shipping: 5.49, refundsTotal: 0,
      cancelledOn: null, expectedTotal: 35.49, pieces: pieces?.length ?? 3, externalOrderRef: "12-14520-00152", isTest: false } },
  findings: STORED,
  ...(pieces ? { livePieces: { pieces, aliases: [] } } : {}),
  ...over,
});

describe("when the figures are judged again", () => {
  it("the analysed count is the stored count finding, else the order's", () => {
    expect(analysedPieces(sale152(undefined))).toBe(3);
    expect(analysedPieces({ order: ORDER, findings: [] })).toBe(5);
  });

  it("a changed sale, or a different count of positions (an add does not move updated_at), needs it", () => {
    expect(needsReassessment(sale152(undefined))).toBe(true);
    expect(needsReassessment(sale152([...WORKBOOK, CRYSTAL(900)], "unchanged"))).toBe(true);
    expect(needsReassessment(sale152(undefined, "unchanged"))).toBe(false);
  });

  it("only with the current positions AND the order's lines — purged snapshots keep the stored findings", () => {
    expect(judgesFigures(sale152([...WORKBOOK]))).toBe(true);
    expect(judgesFigures(sale152(undefined))).toBe(false);
    expect(judgesFigures(sale152([...WORKBOOK], "changed", { order: { ...ORDER, lines: null } }))).toBe(false);
  });
});

describe("sale 152 after the correction", () => {
  const corrected = [WORKBOOK[0], WORKBOOK[1], { ...WORKBOOK[2], skyId: "SKY-0598", name: "Fire Reactor (Crystal)" }, CRYSTAL(901), CRYSTAL(902)];

  it("figure corrected and two lines added: nothing differs now — Identisch, Erledigt; the stored findings are resolved", () => {
    const m = sale152(corrected);
    expect(liveDifferences(m)).toEqual(new Set());
    expect(orderOutcome(m)).toBe("identical");
    expect(workState(m)).toBe("done");
    expect(planMatch(m).checks).toEqual([]);
    expect(planMatch(m).done).toBe(3);
    expect(isReassessed(m)).toBe(true);
  });

  it("only one line added: the count still differs — Abweichung, partly done", () => {
    const m = sale152([...corrected.slice(0, 4)]);
    expect(liveDifferences(m)?.has("pieces")).toBe(true);
    expect(orderOutcome(m)).toBe("deviation");
    expect(workState(m)).toBe("partial");
  });

  it("five lines but one of them the wrong figure: the figure still differs", () => {
    const m = sale152([...corrected.slice(0, 4), piece(903, "SKY-0590", "Dark Pyramid")]);
    const live = liveDifferences(m)!;
    expect(live.has("figure")).toBe(true);
    expect(live.has("pieces")).toBe(false);
    expect(orderOutcome(m)).toBe("deviation");
    expect(planMatch(m).checks.some((e) => e.finding.field === "figure")).toBe(true);
  });

  it("an add without updated_at moving (a normal sale) is caught by the count alone", () => {
    const m = sale152(corrected, "unchanged");
    expect(orderOutcome(m)).toBe("identical");
  });

  it("without the current positions nothing is claimed: the stored figure findings stand", () => {
    const m = sale152(undefined);
    expect(orderOutcome(m)).toBe("deviation");
    expect(planMatch(m).checks.filter((e) => e.finding.field === "figure")).toHaveLength(2);
  });

  it("the same rule as the analysis: a name known only as an alias pairs by the alias", () => {
    const aliased = { ...WORKBOOK[0], name: "Wasser-Rüstung", rawName: "Wasser-Rüstung" };
    const without = sale152([aliased, WORKBOOK[1], ...corrected.slice(2)]);
    const withAlias = sale152([aliased, WORKBOOK[1], ...corrected.slice(2)], "changed",
      { livePieces: { pieces: [aliased, WORKBOOK[1], ...corrected.slice(2)], aliases: [["SKY-0612", ["Water Armor"]]] } });
    expect(liveDifferences(without)?.has("figure")).toBe(true);
    expect(liveDifferences(withAlias)?.has("figure")).toBe(false);
  });
});
