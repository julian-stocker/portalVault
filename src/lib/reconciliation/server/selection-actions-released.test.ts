/**
 * The apply action AS IT WILL BEHAVE once released (0180, step 6A) — with the
 * release lock replaced for this file only. The committed lock stays `false`
 * (`selection-actions.test.ts`); this proves the released path is safe too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: Record<string, unknown> };
const MOCK = vi.hoisted(() => ({
  calls: [] as Call[],
  nextDecision: 100,
  decideError: null as unknown,
  preview: null as unknown,
  previewError: null as unknown,
  applyError: null as unknown,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      MOCK.calls.push({ fn, args });
      if (fn === "seller_recon_decide") return MOCK.decideError ? { data: null, error: MOCK.decideError } : { data: MOCK.nextDecision++, error: null };
      if (fn === "seller_recon_preview") return { data: MOCK.preview, error: MOCK.previewError };
      if (fn === "seller_recon_apply") return { data: { applied: 1, sales: 1, appliedAt: "x" }, error: MOCK.applyError };
      return { data: null, error: { code: "XX000", message: "unexpected" } };
    },
  }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => true }));
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
  Object.assign(MOCK, { calls: [], nextDecision: 100, decideError: null, preview: preview([change(7, 4.99, 5.49)]), previewError: null, applyError: null });
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

const REF = { findingId: 11, field: "external_order_ref", decision: "take_external", shownLedger: null, shownExternal: "55-1" } as const;
const SHIP = { findingId: 12, field: "shipping", decision: "take_external", shownLedger: 4.99, shownExternal: 5.49 } as const;
const KEEP = { findingId: 13, field: "items_net", decision: "keep_ledger", shownLedger: 12.5, shownExternal: 13 } as const;
const confirmInput = (items: unknown[], over: Record<string, unknown> = {}) => ({ sessionId: 3, items, ...over }) as never;

describe("the released confirmation", () => {
  it("records each decision with the shown values, previews exactly the take-overs, applies with the preview's token", async () => {
    MOCK.preview = preview([change(100, null as never, "55-1", "external_order_ref"), change(101, 4.99, 5.49)]);
    expect(await confirmReconciliation(confirmInput([REF, SHIP, KEEP]))).toEqual({ ok: true, applied: 1, sales: 1 });
    expect(MOCK.calls).toEqual([
      { fn: "seller_recon_decide", args: { p_finding_id: 11, p_decision: "take_external", p_manual_value: null, p_reason: null, p_shown_ledger: null, p_shown_external: "55-1" } },
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
