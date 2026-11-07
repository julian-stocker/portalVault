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
  classifyFinding, confirmItems, confirmSummary, fieldState, initialChoices, isExtraCandidate, isRelevant, openConflicts,
  planMatch,
} from "./plan";
import type { Finding, Match } from "./view";

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
  it("a missing order number is preselected as an addition — and sent as a take-over without a click", () => {
    const m = match({ certainty: "unique", category: "exact", findings: [finding()] });
    expect(classifyFinding(m, m.findings[0])).toEqual({ state: "MISSING_IN_SKYISLES", reason: null });
    const plans = [planMatch(m)];
    expect(confirmItems(plans, initialChoices(plans))).toEqual([{
      findingId: 1, field: "external_order_ref", decision: "take_external", shownLedger: null, shownExternal: "06-14260-71832",
    }]);
    expect(confirmSummary(plans, confirmItems(plans, initialChoices(plans)))).toEqual({ additions: 1, corrections: 0, kept: 0, sales: 1 });
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
