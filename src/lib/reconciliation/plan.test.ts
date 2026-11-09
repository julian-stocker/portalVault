/**
 * What "Abgleichen" preselects, offers and only shows (`plan.ts`):
 *
 *   - a missing order number is preselected as an addition
 *   - an equal value needs nothing
 *   - two different amounts need a choice — and nothing is sent without one
 *   - an unsure pairing, a refund, a changed sale: nothing offered
 *   - the day, figures, pieces and the total are never sent
 *   - extra candidates of the search window are not orders of the report
 */
import { describe, expect, it } from "vitest";

import {
  appliedCount, bulkOrderNumbers, byOutcome, classifyFinding, confirmItems, confirmSummary, fieldState, financialPlan, initialChoices, isExtraCandidate,
  isReassessed, isRelevant, missingOrderNumber, openConflicts, orderNumberEntry, orderOutcome, outcomeCounts, planMatch, workState,
} from "./plan";
import { liveDifferences } from "./live";
import type { AtAnalysisValue, Finding, LedgerField, Match } from "./view";

const current = (over: Record<string, unknown> = {}) => ({
  soldOn: "2026-02-10", itemsSubtotal: 12.5, discount: 0, itemsNet: 12.5, shipping: 4.99, refundsTotal: 0,
  cancelledOn: null, expectedTotal: 17.49, pieces: 1, externalOrderRef: null, isTest: false, ...over,
});
const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 1, key: "external_order_ref", field: "external_order_ref", kind: "addition",
  shown: { ledger: null, external: "06-14260-71832" }, delta: null, causes: [],
  allowedDecisions: ["take_external", "keep_ledger", "defer"], decision: null, applied: false, lock: null, ...over,
});
const shipping = (over: Partial<Finding> = {}) =>
  finding({ id: 2, key: "shipping", field: "shipping", kind: "deviation", shown: { ledger: 4.99, external: 5.49 }, delta: -0.5, ...over });
const soldOn = (over: Partial<Finding> = {}) =>
  finding({ id: 3, key: "sold_on", field: "sold_on", kind: "deviation", shown: { ledger: "2026-02-10", external: "2026-02-09" }, delta: 1, ...over });
const figure = (over: Partial<Finding> = {}) =>
  finding({ id: 4, key: "figure:0", field: "figure", kind: "deviation",
    shown: { ledger: "Spyro – Giants", external: "Spyro – Spyro's Adventure" }, ...over });

const match = (over: Partial<Match> = {}, ledger: Record<string, unknown> = {}): Match => ({
  id: 50, category: "deviating", certainty: "deterministic", score: 1, dateDelta: 0, competitors: [], reason: null,
  order: { orderRef: "06-14260-71832" } as Match["order"],
  sale: { id: 64 } as Match["sale"],
  ledger: { state: "unchanged", version: { analysed: "v", current: "v" }, current: current(ledger),
    atAnalysis: {} as NonNullable<Match["ledger"]>["atAnalysis"] },
  findings: [], ...over,
});

describe("one field, one state", () => {
  it("a missing order number is an addition of the card — but NOT of 'Angaben abgleichen' (its own act since 2026-11-09)", () => {
    const m = match({ certainty: "unique", category: "exact", findings: [finding()] });
    expect(classifyFinding(m, m.findings[0])).toEqual({ state: "MISSING_IN_SKYISLES", reason: null });
    const plan = planMatch(m);
    // the separate act finds it …
    expect(orderNumberEntry(plan)?.finding.id).toBe(1);
    expect(missingOrderNumber(m)?.id).toBe(1);
    // … while the financial dialog has nothing to show and nothing to send
    expect(isRelevant(plan)).toBe(false);
    const plans = [financialPlan(plan)];
    expect(confirmItems(plans, initialChoices(plans))).toEqual([]);
    // and even an unfiltered plan sends no order number: it is not a confirm field
    expect(confirmItems([plan], initialChoices([plan]))).toEqual([]);
  });

  it("the missing number is found in a CLOSED session too (only 0186 can write it then) — never when SkyIsles has one now", () => {
    const closed = match({ certainty: "unique", category: "exact", findings: [finding({ lock: "session_not_open" })] });
    expect(orderNumberEntry(planMatch(closed))).toBeNull();
    expect(missingOrderNumber(closed)?.id).toBe(1);
    expect(missingOrderNumber(match({ certainty: "probable", category: "probable", findings: [finding()] }))).toBeNull();
  });

  it("the summary counts what the financial confirmation writes: a taken CSV value a correction, a kept one kept — per sale", () => {
    const m = match({ findings: [shipping(), finding({ id: 5, key: "items_net", field: "items_net", kind: "deviation",
      shown: { ledger: 12.5, external: 13 }, delta: -0.5 })] });
    const plans = [financialPlan(planMatch(m))];
    const item = (findingId: number, field: "shipping" | "items_net", decision: "take_external" | "keep_ledger") =>
      ({ findingId, field, decision, shownLedger: null, shownExternal: null });
    expect(confirmSummary(plans, [item(2, "shipping", "take_external"), item(5, "items_net", "keep_ledger")]))
      .toEqual({ additions: 0, corrections: 1, kept: 1, sales: 1 });
    expect(confirmSummary(plans, [item(5, "items_net", "keep_ledger")])).toEqual({ additions: 0, corrections: 0, kept: 1, sales: 0 });
  });

  it("an equal value needs nothing — no entry, nothing sent", () => {
    const m = match({ category: "exact", findings: [] });
    const plans = [planMatch(m)];
    expect(isRelevant(plans[0])).toBe(false);
    expect(fieldState(m, "shipping")).toBe("EQUAL");
    expect(confirmItems(plans, initialChoices(plans))).toEqual([]);
    // Taken over earlier: equal now, never sent again.
    const applied = match({ findings: [shipping({ applied: true })] });
    expect(classifyFinding(applied, applied.findings[0]).state).toBe("EQUAL");
    expect(confirmItems([planMatch(applied)], initialChoices([planMatch(applied)]))).toEqual([]);
  });

  it("two present, different amounts are a conflict — nothing is sent until one side is chosen", () => {
    const m = match({ findings: [shipping()] });
    expect(classifyFinding(m, m.findings[0])).toEqual({ state: "CONFLICT", reason: null });
    const plans = [planMatch(m)];
    const choices = initialChoices(plans);
    expect(openConflicts(plans, choices)).toBe(1);
    expect(confirmItems(plans, choices)).toEqual([]);
    const chosen = { ...choices, conflicts: new Map([[2, "keep_ledger" as const]]) };
    expect(openConflicts(plans, chosen)).toBe(0);
    expect(confirmItems(plans, chosen)).toEqual([{ findingId: 2, field: "shipping", decision: "keep_ledger", shownLedger: 4.99, shownExternal: 5.49 }]);
    // 0,00 € is a value: a conflict, never a "missing" amount.
    const zero = match({ findings: [shipping({ shown: { ledger: 0, external: 5.49 } })] });
    expect(classifyFinding(zero, zero.findings[0]).state).toBe("CONFLICT");
  });

  it("an unsure pairing offers nothing — neither an addition nor a correction", () => {
    for (const over of [{ category: "probable", certainty: "probable" }, { category: "ambiguous", certainty: "ambiguous" }] as const) {
      const m = match({ ...over, findings: [finding(), shipping()] });
      const plan = planMatch(m);
      expect(plan.supplements).toEqual([]);
      expect(plan.conflicts).toEqual([]);
      expect(plan.checks.map((e) => e.state)).toEqual(["UNCERTAIN", "UNCERTAIN"]);
      expect(confirmItems([plan], initialChoices([plan]))).toEqual([]);
    }
  });

  it("unique: only the order number; a refund blocks amounts; a changed or test sale blocks everything", () => {
    const unique = match({ certainty: "unique", findings: [finding(), shipping()] });
    expect(planMatch(unique).supplements).toHaveLength(1);
    expect(planMatch(unique).checks.map((e) => e.reason)).toEqual(["unique_ref_only"]);
    const refunded = match({ findings: [finding(), shipping()] }, { refundsTotal: 3 });
    expect(planMatch(refunded).supplements).toHaveLength(1);
    expect(planMatch(refunded).checks.map((e) => e.reason)).toEqual(["refunded"]);
    const stale = match({ findings: [finding({ lock: "stale" })] });
    expect(planMatch(stale).checks.map((e) => e.reason)).toEqual(["stale"]);
    const test = match({ findings: [finding()] }, { isTest: true });
    expect(planMatch(test).checks.map((e) => e.reason)).toEqual(["test_sale"]);
    // An order number SkyIsles already has is never overwritten.
    const present = match({ findings: [finding({ shown: { ledger: "01-00000-00001", external: "06-14260-71832" } })] });
    expect(planMatch(present).checks.map((e) => e.reason)).toEqual(["ref_present"]);
  });

  it("the day is shown, never sent — not even with an earlier take-over decision", () => {
    const decided = { id: 9, decision: "take_external" as const, manualValue: null, reason: null, decidedAt: "" };
    const m = match({ findings: [soldOn({ decision: decided })] });
    expect(classifyFinding(m, m.findings[0])).toEqual({ state: "READ_ONLY_DIFFERENCE", reason: "date" });
    const plans = [planMatch(m)];
    expect(plans[0].checks).toHaveLength(1);
    expect(confirmItems(plans, initialChoices(plans))).toEqual([]);
  });

  it("figures, pieces and the total are shown, never sent — the Orderbuch corrects them", () => {
    const m = match({ findings: [figure(), finding({ id: 5, field: "pieces", kind: "deviation", shown: { ledger: 1, external: 2 } }),
      finding({ id: 6, field: "total", kind: "deviation", shown: { ledger: 17.49, external: 0 } })] });
    const plan = planMatch(m);
    expect(plan.checks.map((e) => [e.finding.field, e.state, e.reason])).toEqual([
      ["figure", "READ_ONLY_DIFFERENCE", "positions"], ["pieces", "READ_ONLY_DIFFERENCE", "positions"],
      ["total", "READ_ONLY_DIFFERENCE", "total"]]);
    // Even a forced choice for a figure finds no item.
    const forced = { conflicts: new Map([[4, "take_external" as const]]), skipped: new Set<number>() };
    expect(confirmItems([plan], forced)).toEqual([]);
  });

  it("an addition kept or deferred earlier stays unselected; an earlier choice is preset", () => {
    const kept = { id: 8, decision: "keep_ledger" as const, manualValue: null, reason: null, decidedAt: "" };
    const plans = [planMatch(match({ findings: [finding({ decision: kept }), shipping({ decision: { ...kept, id: 9 } })] }))];
    const choices = initialChoices(plans);
    expect([...choices.skipped]).toEqual([1]);
    expect(confirmItems(plans, choices)).toEqual([{ findingId: 2, field: "shipping", decision: "keep_ledger", shownLedger: 4.99, shownExternal: 5.49 }]);
  });
});

describe("the report's orders, not the search window", () => {
  it("a SkyIsles sale outside the period is an extra candidate, not an order of the report", () => {
    const extra = match({ category: "not_comparable", reason: "after_coverage", order: null, certainty: null, findings: [] });
    expect(isExtraCandidate(extra)).toBe(true);
    expect(isRelevant(planMatch(extra))).toBe(false);
    for (const c of ["exact", "deviating", "probable", "ambiguous", "external_only", "ledger_only"] as const) {
      expect(isExtraCandidate(match({ category: c }))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// One outcome per order (2026-11-08): Abweichung > Ergänzen > Identisch
// ---------------------------------------------------------------------------

describe("one outcome per order", () => {
  const proven = (): Record<LedgerField, AtAnalysisValue> => ({
    soldOn: { value: "2026-02-10", basis: "derived" },
    itemsNet: { value: 12.5, basis: "derived" },
    shipping: { value: 4.99, basis: "derived" },
    expectedTotal: { value: 17.49, basis: "derived" },
    pieces: { value: 1, basis: "derived" },
  });
  const order = { orderRef: "06-14260-71832", soldOn: "2026-02-10", itemsValue: 12.5, shipping: 4.99, total: 17.49, pieces: 1, lines: [] };
  const pair = (over: Partial<Match> = {}, ledger: Record<string, unknown> = {}, at = proven()): Match => match({
    category: "exact", order: order as unknown as Match["order"], ...over,
    ledger: { state: "unchanged", version: { analysed: "v", current: "v" }, current: current({ externalOrderRef: "06-14260-71832", ...ledger }), atAnalysis: at },
  });

  it("a certain pair, every value proven equal, nothing missing: Identisch", () => {
    expect(orderOutcome(pair())).toBe("identical");
  });

  it("only the order number is missing: Ergänzen — never Identisch", () => {
    expect(orderOutcome(pair({ findings: [finding()] }, { externalOrderRef: null }))).toBe("supplement");
  });

  it("missing number AND another date: Abweichung wins — and the number stays an addition of its plan", () => {
    const m = pair({ category: "deviating", findings: [finding(), soldOn()] }, { externalOrderRef: null },
      { ...proven(), soldOn: { value: "2026-02-10", basis: "stored" } });
    expect(orderOutcome(m)).toBe("deviation");
    expect(planMatch(m).supplements.map((e) => e.finding.field)).toEqual(["external_order_ref"]);
  });

  it("a conflict, a figure or a date alone: Abweichung", () => {
    for (const f of [shipping(), figure(), soldOn()]) {
      expect(orderOutcome(pair({ category: "deviating", findings: [f] })), f.field).toBe("deviation");
    }
  });

  it("an unsure pair, a changed sale or a value the database could not prove: never Identisch", () => {
    expect(orderOutcome(pair({ category: "probable", certainty: "probable" }))).toBe("deviation");
    expect(orderOutcome(pair({ category: "ambiguous", certainty: "ambiguous" }))).toBe("deviation");
    expect(orderOutcome(pair({}, {}, { ...proven(), itemsNet: { value: null, basis: "unknown" } }))).toBe("deviation");
    expect(orderOutcome({ ...pair(), ledger: null })).toBe("deviation");
  });

  it("one side only: Nicht zugeordnet; a candidate of the search window: extra — neither counted as Identisch", () => {
    expect(orderOutcome(match({ category: "external_only", sale: null, ledger: null }))).toBe("unmatched");
    expect(orderOutcome(match({ category: "ledger_only", order: null }))).toBe("unmatched");
    expect(orderOutcome(match({ category: "not_comparable", order: null }))).toBe("extra");
  });

  it("everything taken over: Identisch again, and the order counts as done", () => {
    const m = pair({ findings: [finding({ applied: true })] });
    expect(orderOutcome(m)).toBe("identical");
    expect(appliedCount(m)).toBe(1);
  });

  it("the outcome is the data's: a missing number in a closed session is still Ergänzen; a date there still Abweichung", () => {
    const closed = (f: Finding) => ({ ...f, lock: "session_not_open" as const });
    expect(orderOutcome(pair({ findings: [closed(finding())] }, { externalOrderRef: null }))).toBe("supplement");
    expect(orderOutcome(pair({ category: "deviating", findings: [closed(soldOn())] },
      {}, { ...proven(), soldOn: { value: "2026-02-10", basis: "stored" } }))).toBe("deviation");
  });

  it("counts and order: what needs work first, every order exactly once", () => {
    const list = [pair({ id: 1 }), pair({ id: 2, findings: [finding()] }, { externalOrderRef: null }),
      pair({ id: 3, category: "deviating", findings: [shipping()] }), match({ id: 4, category: "external_only", sale: null, ledger: null }),
      match({ id: 5, category: "not_comparable", order: null })];
    expect(outcomeCounts(list)).toEqual({ deviation: 1, supplement: 1, identical: 1, unmatched: 1, extra: 1 });
    expect(byOutcome(list).map((m) => m.id)).toEqual([3, 2, 4, 1, 5]);
  });
});

// ---------------------------------------------------------------------------
// Corrected in the Orderbuch: judged again on the sale as it is now (`live.ts`)
// ---------------------------------------------------------------------------

describe("a sale changed since the analysis", () => {
  const order = { orderRef: "06-14260-71832", recordNo: 1, soldOn: "2026-02-18", paidOn: null, shippedOn: null,
    itemsValue: 54.3, shipping: 15.99, total: 70.29, pieces: 9, combined: false, destinationCountry: null,
    shippingService: null, sourceFile: "feb.csv", lines: [] };
  const at = { soldOn: { value: "2026-02-17", basis: "stored" }, itemsNet: { value: 54.3, basis: "derived" },
    shipping: { value: 15.99, basis: "derived" }, expectedTotal: { value: 70.29, basis: "derived" },
    pieces: { value: 9, basis: "derived" } } as Record<LedgerField, AtAnalysisValue>;
  /** Sale 64 as in session 5: number taken over, then the date corrected (or not). */
  const sale64 = (now: Record<string, unknown>, state: "changed" | "applied" | "unchanged" = "changed",
    findings: Finding[] = [soldOn({ id: 61, shown: { ledger: "2026-02-17", external: "2026-02-18" }, lock: state === "changed" ? "stale" : null }),
      finding({ id: 62, applied: true })]) => match({
    id: 50, category: "deviating", certainty: "unique", order: order as unknown as Match["order"], findings,
    ledger: { state, version: { analysed: "v", current: state === "changed" ? "w" : "v" }, atAnalysis: at,
      current: current({ soldOn: "2026-02-17", itemsSubtotal: 54.3, itemsNet: 54.3, shipping: 15.99, refundsTotal: 0,
        expectedTotal: 70.29, pieces: 9, externalOrderRef: "06-14260-71832", ...now }) },
  });

  it("before the correction: the number is done, the date still differs — Abweichung, partly done", () => {
    const m = sale64({}, "applied");
    expect(orderOutcome(m)).toBe("deviation");
    expect(workState(m)).toBe("partial");
  });

  it("date corrected in the Orderbuch: every value equal now — Identisch, done; the old date finding is resolved", () => {
    const m = sale64({ soldOn: "2026-02-18" });
    expect(liveDifferences(m)).toEqual(new Set());
    expect(orderOutcome(m)).toBe("identical");
    expect(workState(m)).toBe("done");
    expect(planMatch(m).checks).toEqual([]);
    expect(isReassessed(m)).toBe(true);
  });

  it("changed, but to another wrong day: still Abweichung — and the date line stays", () => {
    const m = sale64({ soldOn: "2026-02-20" });
    expect(liveDifferences(m)).toEqual(new Set(["sold_on"]));
    expect(orderOutcome(m)).toBe("deviation");
    expect(planMatch(m).checks.map((e) => e.finding.field)).toEqual(["sold_on"]);
  });

  it("a NEW difference made in the Orderbuch is seen, though the analysis had no finding for it", () => {
    const m = sale64({ soldOn: "2026-02-18", shipping: 9.99, expectedTotal: 64.29 });
    expect(liveDifferences(m)).toEqual(new Set(["shipping", "total"]));
    expect(orderOutcome(m)).toBe("deviation");
  });

  it("a stored figure finding is never resolved by the live values — figures cannot be re-read", () => {
    const m = sale64({ soldOn: "2026-02-18" }, "changed", [figure({ id: 63 })]);
    expect(orderOutcome(m)).toBe("deviation");
    expect(planMatch(m).checks.map((e) => e.finding.field)).toEqual(["figure"]);
  });

  it("the number still missing after a correction: Ergänzen — but this session cannot add it (stale)", () => {
    const m = sale64({ soldOn: "2026-02-18", externalOrderRef: null }, "changed",
      [finding({ id: 62, lock: "stale" })]);
    expect(orderOutcome(m)).toBe("supplement");
    expect(planMatch(m).supplements).toEqual([]);
    expect(planMatch(m).checks[0].reason).toBe("stale");
  });

  it("an unchanged sale is not judged again — the stored findings are the current ones", () => {
    expect(liveDifferences(sale64({}, "unchanged"))).toBeNull();
    expect(liveDifferences(sale64({}, "applied"))).toBeNull();
  });

  it("nothing done yet, a date to correct: Abweichung, open", () => {
    const m = sale64({ externalOrderRef: null }, "unchanged", [soldOn({ id: 61, shown: { ledger: "2026-02-17", external: "2026-02-18" } })]);
    expect(workState(m)).toBe("open");
  });
});

describe("Eindeutige Bestellnummern übernehmen — what goes in, what is skipped and why", () => {
  const pair = (id: number, over: Partial<Match> = {}, f: Partial<Finding> = {}, ledger: Record<string, unknown> = {}) =>
    match({ id, certainty: "unique", category: "exact", order: { orderRef: `05-${id}` } as Match["order"],
      sale: { id: 500 + id } as Match["sale"], findings: [finding({ id, ...f })], ...over }, ledger);

  it("the whole session: certain pairs without number in; rivals, competitors, changed, closed, uncertain named; done ones not at all", () => {
    const { takeable, skipped } = bulkOrderNumbers([
      pair(1), pair(2),
      pair(3, { rivals: [{ saleId: 158, soldOn: "2026-05-01", shared: ["Camo"], pieces: ["Camo"], updatedAt: "v" }] }),
      pair(4, { rivalOrders: [{ orderId: 9, orderRef: "x", soldOn: "2026-05-01", shared: ["Camo"] }] }),
      pair(5, { competitors: [{}] as unknown as Match["competitors"] }),
      pair(6, {}, { lock: "stale" }),
      pair(7, {}, { lock: "session_not_open" }),
      pair(8, {}, { applied: true }),               // taken over earlier: not listed
      pair(9, {}, {}, { externalOrderRef: "05-9" }), // typed in since: not listed
      pair(10, { certainty: "probable", category: "probable" }), // not a certain pair: not listed
      match({ id: 11, category: "external_only", sale: null, findings: [] }),
    ]);
    expect(takeable).toEqual([{ matchId: 1, orderRef: "05-1", saleId: 501 }, { matchId: 2, orderRef: "05-2", saleId: 502 }]);
    expect(skipped.map((c) => [c.matchId, c.reason])).toEqual([[3, "rivals"], [4, "rivals"], [5, "competitors"], [6, "stale"], [7, "closed"]]);
  });

  it("38 orders: in one pass, no financial finding among them", () => {
    const many = Array.from({ length: 38 }, (_, k) => pair(k + 1, { findings: [finding({ id: k + 1 }), shipping({ id: 1000 + k })] }));
    expect(bulkOrderNumbers(many).takeable).toHaveLength(38);
  });
});
