/**
 * Deciding, previewing and the apply WITH THE EMERGENCY STOP SET on the
 * server (0180, step 6A).
 *
 * The actions are called for real; Supabase, the role check and the cache
 * are replaced, and every database call is recorded. The apply is committed
 * released (ADR-0178, 2026-11-08); this file sets the emergency stop
 * (`APPLY_RELEASED = false`) for itself and proves it still locks
 * everything. The released path has its own file
 * (`selection-actions-released.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: Record<string, unknown> };
const MOCK = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Call[],
  answer: null as ((fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }) | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      MOCK.calls.push({ fn, args });
      return MOCK.answer ? MOCK.answer(fn, args) : { data: null, error: { code: "XX000", message: "unexpected" } };
    },
  }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => MOCK.allowed }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// The emergency stop, for this file only.
vi.mock("../release", () => ({ APPLY_RELEASED: false }));

const { applySelection, confirmReconciliation, decideFinding, previewSelection } = await import("./actions");
const { de } = await import("@/lib/i18n/de");
const { STAGING_PROJECT_REF } = await import("@/lib/admin/catalog-source");
const errors = de.business.reconciliation.errors;

const TOKEN = "a".repeat(64);
/** What a careless database text might carry. */
const LEAK = "kaeuferin@example.invalid 55-00000-00001 49.99";

function previewAnswer(over: Record<string, unknown> = {}, changes: unknown[] = [{
  decisionId: 7, problem: null, findingId: 70, matchId: 700, saleId: 5, orderRef: "55-00000-00001", field: "sold_on",
  decision: "take_external", old: { soldOn: "2026-03-01" }, target: { soldOn: "2026-03-02" },
  version: { analysed: "x", current: "x" },
}]) {
  return { sessionId: 3, state: "open", sessionOpen: true, count: changes.length, problems: 0, admissible: true,
    staleSales: 0, token: TOKEN, changes, ...over };
}

let before: string | undefined;
beforeEach(() => {
  before = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
  Object.assign(MOCK, { allowed: true, calls: [], answer: null });
});
afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = before; vi.restoreAllMocks(); });

const decision = { findingId: 70, decision: "take_external" as const, shownLedger: "2026-03-01", shownExternal: "2026-03-02" };

describe("the gates hold for every new action", () => {
  it("not Staging, not the seller operator: no database call", async () => {
    for (const setup of [() => { process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"; },
      () => { MOCK.allowed = false; }]) {
      Object.assign(MOCK, { allowed: true, calls: [] });
      process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
      setup();
      for (const r of [await decideFinding(decision), await previewSelection(3, [7]),
        await applySelection({ sessionId: 3, decisionIds: [7], token: TOKEN, confirmedDateGaps: [] })]) {
        expect(r.ok).toBe(false);
      }
      expect(MOCK.calls).toEqual([]);
    }
  });
});

describe("deciding", () => {
  it("refuses manual and any free value before the database is asked", async () => {
    for (const input of [{ ...decision, decision: "manual" }, { ...decision, manualValue: { value: "2026-03-09" } },
      { ...decision, decision: "keep_ledger", manualValue: null }]) {
      const r = await decideFinding(input as never);
      expect(r).toEqual({ ok: false, message: errors.manualRetired });
    }
    expect(MOCK.calls).toEqual([]);
  });

  it("refuses a malformed decision without a call", async () => {
    for (const input of [{ ...decision, findingId: 0 }, { ...decision, findingId: "70" }, { ...decision, decision: "apply" },
      { ...decision, shownLedger: { x: 1 } }, { ...decision, reason: "x".repeat(501) }, null]) {
      expect((await decideFinding(input as never)).ok).toBe(false);
    }
    expect(MOCK.calls).toEqual([]);
  });

  it("sends the three allowed decisions with no manual value and the shown values unchanged", async () => {
    MOCK.answer = () => ({ data: 11, error: null });
    for (const d of ["take_external", "keep_ledger", "defer"] as const) {
      expect(await decideFinding({ ...decision, decision: d, reason: d === "keep_ledger" ? null : undefined })).toEqual({ ok: true, decisionId: 11 });
    }
    expect(MOCK.calls.map((c) => [c.fn, c.args.p_decision, c.args.p_manual_value, c.args.p_shown_ledger, c.args.p_shown_external]))
      .toEqual(["take_external", "keep_ledger", "defer"].map((d) => ["seller_recon_decide", d, null, "2026-03-01", "2026-03-02"]));
  });
});

describe("previewing", () => {
  it("refuses a selection that is not one — empty, doubled, too long, not ids — without a call", async () => {
    for (const ids of [[], [7, 7], Array.from({ length: 501 }, (_, i) => i + 1), [0], [-1], [1.5], ["7"], null]) {
      expect(await previewSelection(3, ids as never)).toEqual({ ok: false, message: errors.selectionInvalid });
    }
    expect(await previewSelection(0, [7])).toEqual({ ok: false, message: errors.selectionInvalid });
    expect(MOCK.calls).toEqual([]);
  });

  it("asks for exactly the selected ids, sorted, and returns the checked preview", async () => {
    MOCK.answer = () => ({ data: previewAnswer(), error: null });
    const r = await previewSelection(3, [9, 7]);
    expect(MOCK.calls).toEqual([{ fn: "seller_recon_preview", args: { p_session_id: 3, p_decision_ids: [7, 9] } }]);
    expect(r.ok && r.preview.token).toBe(TOKEN);
    expect(r.ok && r.confirmDateGaps).toEqual([]);
  });

  it("names a large date gap of a deterministic correction for confirmation", async () => {
    MOCK.answer = () => ({ data: previewAnswer({}, [{ decisionId: 7, problem: null, findingId: 70, matchId: 700, saleId: 5,
      orderRef: "55-1", field: "sold_on", decision: "take_external", old: { soldOn: "2026-03-01" }, target: { soldOn: "2026-03-10" },
      version: { analysed: "x", current: "x" } }]), error: null });
    const r = await previewSelection(3, [7]);
    expect(r.ok && r.confirmDateGaps).toEqual([7]);
    expect(r.ok && r.preview.changes[0].dateGap).toEqual({ from: "2026-03-01", to: "2026-03-10", days: 9 });
  });

  it("on Staging 0179 the function is missing: a sentence, not a broken page", async () => {
    for (const code of ["PGRST202", "42883"]) {
      MOCK.answer = () => ({ data: null, error: { code, message: "Could not find the function public.seller_recon_preview" } });
      expect(await previewSelection(3, [7])).toEqual({ ok: false, message: errors.notMigrated });
    }
  });

  it("an answer of another shape is refused, not guessed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    MOCK.answer = () => ({ data: previewAnswer({ admissible: true, problems: 1 }), error: null });
    expect(await previewSelection(3, [7])).toEqual({ ok: false, message: errors.loadFailed });
    expect(log.mock.calls.flat().join(" ")).not.toContain("55-00000");
  });

  it.each(["42501", "PT409", "23514", "23001", "0A000", "XX000"])("database error %s: a fixed sentence; the log carries the code only", async (code) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    MOCK.answer = () => ({ data: null, error: { code, message: LEAK } });
    const r = await previewSelection(3, [7]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(([...Object.values(errors), ...Object.values(de.admin)] as unknown[]).includes(r.message)).toBe(true);
      expect(r.message).not.toContain("kaeuferin");
    }
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/kaeuferin|55-00000|49\.99/);
  });
});

describe("the emergency stop (APPLY_RELEASED = false) still locks the apply", () => {
  it("answers with a sentence and calls NO database function — not the preview, not either apply", async () => {
    MOCK.answer = () => ({ data: previewAnswer(), error: null });
    const r = await applySelection({ sessionId: 3, decisionIds: [7], token: TOKEN, confirmedDateGaps: [] });
    expect(r).toEqual({ ok: false, message: errors.applyNotReleased });
    expect(MOCK.calls).toEqual([]);
  });

  it("the confirmation of „Abgleichen“ writes nothing either — not even a decision", async () => {
    MOCK.answer = () => ({ data: 1, error: null });
    const r = await confirmReconciliation({ sessionId: 5, items: [
      { findingId: 1, field: "shipping", decision: "take_external", shownLedger: 4.99, shownExternal: 5.49 }] });
    expect(r).toEqual({ ok: false, message: errors.applyNotReleased });
    expect(MOCK.calls).toEqual([]);
  });
});
