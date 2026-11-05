/**
 * The apply action AS IT WILL BEHAVE once released (0180, step 6A) — with the
 * release lock replaced for this file only. The committed lock stays `false`
 * (`selection-actions.test.ts`); this proves the released path is safe too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: Record<string, unknown> };
const MOCK = vi.hoisted(() => ({
  calls: [] as Call[],
  preview: null as unknown,
  previewError: null as unknown,
  applyError: null as unknown,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      MOCK.calls.push({ fn, args });
      if (fn === "seller_recon_preview") return { data: MOCK.preview, error: MOCK.previewError };
      if (fn === "seller_recon_apply") return { data: { applied: 1, sales: 1, appliedAt: "x" }, error: MOCK.applyError };
      return { data: null, error: { code: "XX000", message: "unexpected" } };
    },
  }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../release", () => ({ APPLY_RELEASED: true }));

const { applySelection } = await import("./actions");
const { de } = await import("@/lib/i18n/de");
const { STAGING_PROJECT_REF } = await import("@/lib/admin/catalog-source");
const errors = de.business.reconciliation.errors;

const TOKEN = "b".repeat(64);
const change = (decisionId: number, from: string, to: string) => ({
  decisionId, problem: null, findingId: decisionId * 10, matchId: decisionId * 100, saleId: decisionId, orderRef: `55-${decisionId}`,
  field: "sold_on", decision: "take_external", old: { soldOn: from }, target: { soldOn: to }, version: { analysed: "x", current: "x" },
});
const preview = (changes: unknown[], over: Record<string, unknown> = {}) => ({
  sessionId: 3, state: "open", sessionOpen: true, count: changes.length, problems: 0, admissible: true, staleSales: 0,
  token: TOKEN, changes, ...over,
});

let before: string | undefined;
beforeEach(() => {
  before = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
  Object.assign(MOCK, { calls: [], preview: preview([change(7, "2026-03-01", "2026-03-02")]), previewError: null, applyError: null });
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
    MOCK.preview = preview([{ ...change(7, "2026-03-01", "2026-03-02"), problem: "uncertain" }], { admissible: false, problems: 1 });
    expect(await applySelection(input())).toEqual({ ok: false, message: errors.notApplicable });
    for (const bad of [{ token: "x" }, { token: TOKEN.toUpperCase() }, { decisionIds: [] }, { decisionIds: [7, 7] },
      { confirmedDateGaps: "7" }, { sessionId: -3 }]) {
      expect((await applySelection(input(bad))).ok).toBe(false);
    }
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_apply")).toEqual([]);
  });

  it("a large date gap must be confirmed — exactly that decision, not 'all'", async () => {
    MOCK.preview = preview([change(7, "2026-03-01", "2026-03-10"), change(8, "2026-03-01", "2026-03-03")]);
    expect(await applySelection(input({ decisionIds: [7, 8] }))).toEqual({ ok: false, message: errors.dateGapUnconfirmed });
    expect(await applySelection(input({ decisionIds: [7, 8], confirmedDateGaps: [8] }))).toEqual({ ok: false, message: errors.dateGapUnconfirmed });
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_apply")).toEqual([]);
    expect(await applySelection(input({ decisionIds: [7, 8], confirmedDateGaps: [7] }))).toMatchObject({ ok: true });
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
