/**
 * The RELEASED apply (0180, ADR-0178 Ergänzung 2026-11-08): the operator's
 * confirmation is the authorisation. The release is pinned to `true` here so
 * the file does not depend on the committed value — which is checked
 * separately below. The emergency stop (`false`) has its own file
 * (`selection-actions.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: Record<string, unknown> };
const MOCK = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Call[],
  nextDecision: 100,
  decideError: null as unknown,
  /** A refusal for one finding only (by `p_finding_id`). */
  decideErrors: {} as Record<number, unknown>,
  preview: null as unknown,
  previewError: null as unknown,
  applyError: null as unknown,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      MOCK.calls.push({ fn, args });
      if (fn === "seller_recon_decide") {
        const own = MOCK.decideErrors[Number(args.p_finding_id)];
        if (own) return { data: null, error: own };
        return MOCK.decideError ? { data: null, error: MOCK.decideError } : { data: MOCK.nextDecision++, error: null };
      }
      if (fn === "seller_recon_preview") return { data: MOCK.preview, error: MOCK.previewError };
      if (fn === "seller_recon_apply") return { data: { applied: 1, sales: 1, appliedAt: "x" }, error: MOCK.applyError };
      return { data: null, error: { code: "XX000", message: "unexpected" } };
    },
  }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => MOCK.allowed }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../release", () => ({ APPLY_RELEASED: true }));

const { applySelection, confirmReconciliation } = await import("./actions");
const { de } = await import("@/lib/i18n/de");
const { STAGING_PROJECT_REF } = await import("@/lib/admin/catalog-source");
const errors = de.business.reconciliation.errors;

const TOKEN = "b".repeat(64);
/** A change as 0180 previews it; a day when both values are days, else shipping. */
const change = (decisionId: number, from: string | number, to: string | number, field = typeof from === "string" ? "sold_on" : "shipping") => {
  const key = ({ sold_on: "soldOn", shipping: "shipping", items_net: "itemsNet", external_order_ref: "externalOrderRef" } as Record<string, string>)[field];
  return {
    decisionId, problem: null, findingId: decisionId * 10, matchId: decisionId * 100, saleId: decisionId, orderRef: `55-${decisionId}`,
    field, decision: "take_external", old: { [key]: from }, target: { [key]: to }, version: { analysed: "x", current: "x" },
  };
};
const preview = (changes: unknown[], over: Record<string, unknown> = {}) => ({
  sessionId: 3, state: "open", sessionOpen: true, count: changes.length, problems: 0, admissible: true, staleSales: 0,
  token: TOKEN, changes, ...over,
});

let before: string | undefined;
beforeEach(() => {
  before = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
  Object.assign(MOCK, { allowed: true, calls: [], nextDecision: 100, decideError: null, decideErrors: {}, preview: preview([change(7, 4.99, 5.49)]), previewError: null, applyError: null });
});
afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = before; vi.restoreAllMocks(); });

const input = (over: Record<string, unknown> = {}) =>
  ({ sessionId: 3, decisionIds: [7], token: TOKEN, confirmedDateGaps: [], ...over }) as never;

describe("the released apply", () => {
  it("passes exactly the selection and the token, unchanged, to the 0180 apply — after one preview", async () => {
    expect(await applySelection(input())).toEqual({ ok: true, applied: 1, sales: 1 });
    expect(MOCK.calls).toEqual([
      { fn: "seller_recon_preview", args: { p_session_id: 3, p_decision_ids: [7] } },
      { fn: "seller_recon_apply", args: { p_session_id: 3, p_decision_ids: [7], p_token: TOKEN } },
    ]);
  });

  it("never falls back to the retired apply — not on a refusal, not on a missing function", async () => {
    for (const err of [{ code: "PGRST202", message: "missing" }, { code: "0A000", message: "retired" }, { code: "PT409", message: "x" }]) {
      MOCK.calls = [];
      MOCK.applyError = err;
      expect((await applySelection(input())).ok).toBe(false);
      expect(MOCK.calls.filter((c) => c.fn === "seller_recon_apply").map((c) => Object.keys(c.args).sort()))
        .toEqual([["p_decision_ids", "p_session_id", "p_token"]]);
      expect(MOCK.calls.some((c) => "p_expected" in c.args)).toBe(false);
    }
  });

  it("refuses without applying: another token, an inadmissible preview, a malformed request", async () => {
    expect(await applySelection(input({ token: "c".repeat(64) }))).toEqual({ ok: false, message: errors.selectionChanged });
    MOCK.preview = preview([{ ...change(7, 4.99, 5.49), problem: "uncertain" }], { admissible: false, problems: 1 });
    expect(await applySelection(input())).toEqual({ ok: false, message: errors.notApplicable });
    for (const bad of [{ token: "x" }, { token: TOKEN.toUpperCase() }, { decisionIds: [] }, { decisionIds: [7, 7] },
      { confirmedDateGaps: "7" }, { sessionId: -3 }]) {
      expect((await applySelection(input(bad))).ok).toBe(false);
    }
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_apply")).toEqual([]);
  });

  it("a day is never taken over — small or large, confirmed or not", async () => {
    MOCK.preview = preview([change(7, "2026-03-01", "2026-03-10"), change(8, "2026-03-01", "2026-03-03")]);
    for (const confirmedDateGaps of [[], [7], [7, 8]]) {
      expect(await applySelection(input({ decisionIds: [7, 8], confirmedDateGaps }))).toEqual({ ok: false, message: errors.dateNotTakeable });
    }
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_apply")).toEqual([]);
  });

  it("a refusal of the apply is a fixed sentence, and the selection-changed PT409 says so", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    MOCK.applyError = { code: "PT409", message: "the selection changed since the preview — nothing was applied; preview again" };
    expect(await applySelection(input())).toEqual({ ok: false, message: errors.selectionChanged });
    MOCK.applyError = { code: "23514", message: "1 of 1 selected decision(s) cannot be applied (uncertain) — nothing was applied" };
    expect(await applySelection(input())).toEqual({ ok: false, message: errors.notApplicable });
    MOCK.applyError = { code: "XX000", message: "kaeuferin@example.invalid 55-7" };
    const r = await applySelection(input());
    expect(r.ok === false && r.message).toBe(de.admin.writeFailed);
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/kaeuferin|55-7/);
  });
});

// ---------------------------------------------------------------------------
// "Abgleich bestätigen" once released
// ---------------------------------------------------------------------------

/* Since 2026-11-09 the confirmation is financial only — the goods value stands where the order number stood. */
const REF = { findingId: 11, field: "items_net", decision: "take_external", shownLedger: 29.5, shownExternal: 30.01 } as const;
const SHIP = { findingId: 12, field: "shipping", decision: "take_external", shownLedger: 4.99, shownExternal: 5.49 } as const;
const KEEP = { findingId: 13, field: "items_net", decision: "keep_ledger", shownLedger: 12.5, shownExternal: 13 } as const;
const confirmInput = (items: unknown[], over: Record<string, unknown> = {}) => ({ sessionId: 3, items, ...over }) as never;

describe("the released confirmation", () => {
  it("records each decision with the shown values, previews exactly the take-overs, applies with the preview's token", async () => {
    MOCK.preview = preview([change(100, 29.5, 30.01, "items_net"), change(101, 4.99, 5.49)]);
    expect(await confirmReconciliation(confirmInput([REF, SHIP, KEEP]))).toEqual({ ok: true, applied: 1, sales: 1 });
    expect(MOCK.calls).toEqual([
      { fn: "seller_recon_decide", args: { p_finding_id: 11, p_decision: "take_external", p_manual_value: null, p_reason: null, p_shown_ledger: 29.5, p_shown_external: 30.01 } },
      { fn: "seller_recon_decide", args: { p_finding_id: 12, p_decision: "take_external", p_manual_value: null, p_reason: null, p_shown_ledger: 4.99, p_shown_external: 5.49 } },
      { fn: "seller_recon_decide", args: { p_finding_id: 13, p_decision: "keep_ledger", p_manual_value: null, p_reason: null, p_shown_ledger: 12.5, p_shown_external: 13 } },
      { fn: "seller_recon_preview", args: { p_session_id: 3, p_decision_ids: [100, 101] } },
      { fn: "seller_recon_apply", args: { p_session_id: 3, p_decision_ids: [100, 101], p_token: TOKEN } },
    ]);
  });

  it("only notes: decisions recorded, nothing previewed or applied", async () => {
    expect(await confirmReconciliation(confirmInput([KEEP]))).toEqual({ ok: true, applied: 0, sales: 0 });
    expect(MOCK.calls.map((c) => c.fn)).toEqual(["seller_recon_decide"]);
  });

  it("a day, a figure, a total, a manual value or a malformed item: refused before any call", async () => {
    const day = { findingId: 14, field: "sold_on", decision: "take_external", shownLedger: "2026-02-10", shownExternal: "2026-02-09" };
    expect(await confirmReconciliation(confirmInput([REF, day]))).toEqual({ ok: false, message: errors.dateNotTakeable });
    for (const bad of [
      { ...SHIP, field: "figure" }, { ...SHIP, field: "total" }, { ...SHIP, field: "pieces" },
      { ...SHIP, decision: "manual" }, { ...SHIP, decision: "defer" }, { ...SHIP, manualValue: { value: 1 } },
      { ...SHIP, findingId: -1 }, { ...SHIP, shownLedger: { x: 1 } },
    ]) {
      expect(await confirmReconciliation(confirmInput([bad]))).toEqual({ ok: false, message: errors.rejected });
    }
    expect((await confirmReconciliation(confirmInput([SHIP, SHIP]))).ok).toBe(false);
    expect((await confirmReconciliation(confirmInput([]))).ok).toBe(false);
    expect((await confirmReconciliation(confirmInput([SHIP], { sessionId: 0 }))).ok).toBe(false);
    expect(MOCK.calls).toEqual([]);
  });

  it("applies nothing when the preview would write other values than shown, another field, or a day", async () => {
    for (const changes of [
      [change(100, 4.99, 6.49)],
      [change(100, 4.99, 5.49, "items_net")],
      [change(100, "2026-02-10", "2026-02-09")],
    ]) {
      MOCK.calls = [];
      MOCK.nextDecision = 100;
      MOCK.preview = preview(changes);
      expect((await confirmReconciliation(confirmInput([SHIP]))).ok).toBe(false);
      expect(MOCK.calls.filter((c) => c.fn === "seller_recon_apply")).toEqual([]);
    }
  });

  it("an inadmissible preview or a refused decision: nothing applied, a fixed sentence", async () => {
    MOCK.preview = preview([{ ...change(100, 4.99, 5.49), problem: "uncertain" }], { admissible: false, problems: 1, token: null });
    expect(await confirmReconciliation(confirmInput([SHIP]))).toEqual({ ok: false, message: errors.notApplicable });
    MOCK.calls = [];
    MOCK.decideError = { code: "PT409", message: "the values shown no longer match 55-1" };
    expect(await confirmReconciliation(confirmInput([SHIP]))).toEqual({ ok: false, message: errors.shownValuesChanged });
    expect(MOCK.calls.map((c) => c.fn)).toEqual(["seller_recon_decide"]);
  });
});

// ---------------------------------------------------------------------------
// The release itself, and what still holds once released (ADR-0178, 2026-11-08)
// ---------------------------------------------------------------------------

describe("the release: the confirmation is the authorisation", () => {
  it("is committed released — no second approval anywhere", async () => {
    const actual = await vi.importActual<typeof import("../release")>("../release");
    expect(actual.APPLY_RELEASED).toBe(true);
  });

  it("a goods value is taken over after the confirmation: decide, preview, apply — nothing else", async () => {
    MOCK.preview = preview([change(100, 29.5, 30.01, "items_net")]);
    expect(await confirmReconciliation(confirmInput([REF]))).toEqual({ ok: true, applied: 1, sales: 1 });
    expect(MOCK.calls.map((c) => c.fn)).toEqual(["seller_recon_decide", "seller_recon_preview", "seller_recon_apply"]);
    expect(MOCK.calls[2].args).toEqual({ p_session_id: 3, p_decision_ids: [100], p_token: TOKEN });
  });

  it("not Staging, or not the seller operator: no database call, even released", async () => {
    for (const setup of [
      () => { process.env.NEXT_PUBLIC_SUPABASE_URL = "https://zmiwxswrpkmizvqsgype.supabase.co"; },
      () => { delete process.env.NEXT_PUBLIC_SUPABASE_URL; },
      () => { MOCK.allowed = false; },
    ]) {
      Object.assign(MOCK, { allowed: true, calls: [] });
      process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
      setup();
      expect((await confirmReconciliation(confirmInput([REF]))).ok).toBe(false);
      expect((await applySelection(input())).ok).toBe(false);
      expect(MOCK.calls).toEqual([]);
    }
  });

  it("the database's own refusal of the account (42501): a fixed sentence, nothing applied", async () => {
    MOCK.decideError = { code: "42501", message: "not the seller operator" };
    expect(await confirmReconciliation(confirmInput([REF]))).toEqual({ ok: false, message: de.admin.notAllowed });
    expect(MOCK.calls.map((c) => c.fn)).toEqual(["seller_recon_decide"]);
  });

  it("an outdated preview token at the apply: refused, reported as changed — never as success", async () => {
    MOCK.preview = preview([change(100, 4.99, 5.49)]);
    MOCK.applyError = { code: "PT409", message: "the selection changed since the preview — nothing was applied; preview again" };
    expect(await confirmReconciliation(confirmInput([SHIP]))).toEqual({ ok: false, message: errors.selectionChanged });
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_apply")).toHaveLength(1);
  });

  it("a sale changed since the analysis: refused at the decision, nothing previewed or applied", async () => {
    MOCK.decideError = { code: "PT409", message: "sale 7 changed since the analysis — analyse again" };
    expect(await confirmReconciliation(confirmInput([SHIP]))).toEqual({ ok: false, message: errors.stale });
    expect(MOCK.calls.map((c) => c.fn)).toEqual(["seller_recon_decide"]);
  });

  it("confirming the same order again: the applied finding is refused, nothing is applied twice", async () => {
    MOCK.preview = preview([change(100, 29.5, 30.01, "items_net")]);
    expect((await confirmReconciliation(confirmInput([REF]))).ok).toBe(true);
    MOCK.calls = [];
    // 0180: `seller_recon_decide` refuses a finding that was applied (restrict_violation).
    MOCK.decideError = { code: "23001", message: "this finding has already been applied" };
    expect(await confirmReconciliation(confirmInput([REF]))).toEqual({ ok: false, message: errors.notPossible });
    expect(MOCK.calls.map((c) => c.fn)).toEqual(["seller_recon_decide"]);
  });

  it("the date stays the date: a day in the confirmation is refused before any call, even released", async () => {
    const day = { findingId: 14, field: "sold_on", decision: "take_external", shownLedger: "2026-02-10", shownExternal: "2026-02-09" };
    expect(await confirmReconciliation(confirmInput([day]))).toEqual({ ok: false, message: errors.dateNotTakeable });
    expect(MOCK.calls).toEqual([]);
  });

  it("figures and pieces are never sent on: refused before any call", async () => {
    for (const field of ["figure", "pieces", "total"]) {
      expect(await confirmReconciliation(confirmInput([{ ...SHIP, field }]))).toEqual({ ok: false, message: errors.rejected });
    }
    expect(MOCK.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The batch "35 Bestellungen abgleichen" (2026-11-08, April session 12)
// ---------------------------------------------------------------------------

describe("the batch confirmation", () => {
  /* 35 shipping corrections, findings 1001…1035, decisions 100…134 (financial only since 2026-11-09). */
  const refs = Array.from({ length: 35 }, (_, i) => ({
    findingId: 1001 + i, field: "shipping", decision: "take_external", shownLedger: 4.99, shownExternal: 5.49,
  }));
  const refChanges = () => refs.map((_r, i) => change(100 + i, 4.99, 5.49, "shipping"));
  /* What 0180's decide raises for a refused take-over (0180_sales_recon_selected_apply.sql). */
  const takeRefusal = (code: string) => ({ code: "23514", message: `this finding cannot be taken over (${code})` });

  it("35 corrections: 35 decisions, ONE preview of all 35, ONE apply with its token", async () => {
    MOCK.preview = preview(refChanges());
    expect(await confirmReconciliation(confirmInput(refs))).toEqual({ ok: true, applied: 1, sales: 1 });
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_decide")).toHaveLength(35);
    const ids = Array.from({ length: 35 }, (_, i) => 100 + i);
    expect(MOCK.calls.filter((c) => c.fn !== "seller_recon_decide")).toEqual([
      { fn: "seller_recon_preview", args: { p_session_id: 3, p_decision_ids: ids } },
      { fn: "seller_recon_apply", args: { p_session_id: 3, p_decision_ids: ids, p_token: TOKEN } },
    ]);
  });

  it("a single order sends exactly the decide the batch sends for it", async () => {
    MOCK.preview = preview(refChanges());
    await confirmReconciliation(confirmInput(refs));
    const inBatch = MOCK.calls.find((c) => c.fn === "seller_recon_decide" && c.args.p_finding_id === 1017);
    Object.assign(MOCK, { calls: [], nextDecision: 100, preview: preview([change(100, 4.99, 5.49, "shipping")]) });
    expect((await confirmReconciliation(confirmInput([refs[16]]))).ok).toBe(true);
    expect(MOCK.calls[0]).toEqual(inBatch);
  });

  it("two refused among 35: BOTH named with their code, nothing previewed, nothing applied, no success", async () => {
    MOCK.decideErrors = { 1033: takeRefusal("refunded"), 1034: takeRefusal("unique_ref_only") };
    const result = await confirmReconciliation(confirmInput(refs));
    expect(result).toEqual({
      ok: false, message: errors.notTakeable,
      refused: [{ findingId: 1033, problem: "refunded" }, { findingId: 1034, problem: "unique_ref_only" }],
    });
    // Every item was judged — the operator learns about all refusals at once.
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_decide")).toHaveLength(35);
    expect(MOCK.calls.some((c) => c.fn === "seller_recon_preview" || c.fn === "seller_recon_apply")).toBe(false);
  });

  it("the first item refused: still nothing applied, and the reason is not 'rejected'", async () => {
    MOCK.decideErrors = { 1001: takeRefusal("refunded") };
    const result = await confirmReconciliation(confirmInput(refs));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe(errors.notTakeable);
    expect(result.ok === false && result.message).not.toBe(errors.rejected);
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_apply")).toEqual([]);
  });

  it("then the other 33 alone: one preview, one apply — exactly those 33", async () => {
    const others = refs.filter((r) => r.findingId !== 1033 && r.findingId !== 1034);
    MOCK.preview = preview(others.map((_r, i) => change(100 + i, 4.99, 5.49, "shipping")));
    expect((await confirmReconciliation(confirmInput(others))).ok).toBe(true);
    const apply = MOCK.calls.find((c) => c.fn === "seller_recon_apply")!;
    expect(apply.args.p_decision_ids).toHaveLength(33);
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_decide").map((c) => c.args.p_finding_id)).not.toContain(1033);
  });

  it("an unknown code, or a refusal of another kind, ends at once with a fixed sentence — no list", async () => {
    MOCK.decideErrors = { 1002: { code: "23514", message: "this finding cannot be taken over (something_new)" } };
    expect(await confirmReconciliation(confirmInput(refs))).toEqual({ ok: false, message: errors.rejected });
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_decide")).toHaveLength(2);
    MOCK.calls = [];
    MOCK.decideErrors = { 1001: takeRefusal("refunded"), 1003: { code: "PT409", message: "sale 7 changed since the analysis — analyse again" } };
    expect(await confirmReconciliation(confirmInput(refs))).toEqual({ ok: false, message: errors.stale });
    expect(MOCK.calls.some((c) => c.fn === "seller_recon_apply")).toBe(false);
  });

  it("the refusal carries no database text and no value", async () => {
    MOCK.decideErrors = { 1001: { code: "23514", message: "this finding cannot be taken over (refunded) kaeuferin@example.invalid" } };
    const result = await confirmReconciliation(confirmInput(refs));
    expect(JSON.stringify(result)).not.toMatch(/kaeuferin|cannot be taken over/);
  });
});

// ---------------------------------------------------------------------------
// The order number is its own act since 2026-11-09 (`takeOrderNumber`, 0186)
// ---------------------------------------------------------------------------

describe("the financial confirmation carries no order number", () => {
  it("an order number in 'Ausgewählte Angaben übernehmen' is refused before any call — alone or among others", async () => {
    const number = { findingId: 21, field: "external_order_ref", decision: "take_external", shownLedger: null, shownExternal: "12-14570-08869" };
    expect(await confirmReconciliation(confirmInput([number]))).toEqual({ ok: false, message: errors.rejected });
    expect(await confirmReconciliation(confirmInput([SHIP, number]))).toEqual({ ok: false, message: errors.rejected });
    expect(MOCK.calls).toEqual([]);
  });
});
