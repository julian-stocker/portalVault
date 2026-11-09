/**
 * "Eindeutige Bestellnummern übernehmen" (2026-11-09): many missing order
 * numbers through 0180 — one problem never blocks the others, and every case
 * comes back with its outcome. A May-like session: 38 certain pairs without
 * number.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: Record<string, unknown> };
const TOKEN = "c".repeat(64);
const MOCK = vi.hoisted(() => ({
  calls: [] as Call[], matches: [] as unknown[],
  /** decide refusals by finding id */
  decideErrors: {} as Record<number, unknown>,
  /** preview problems by finding id (first preview only, unless sticky) */
  previewProblems: {} as Record<number, string>, sticky: false, previews: 0,
  /** problems that appear only in the SECOND preview */
  laterProblems: {} as Record<number, string>,
  /** a change of another field slipped into the preview */
  foreignField: false, shownChanged: false,
  applyError: null as unknown,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      MOCK.calls.push({ fn, args });
      // decision id = finding id + 1000
      if (fn === "seller_recon_decide") {
        const e = MOCK.decideErrors[Number(args.p_finding_id)];
        return e ? { data: null, error: e } : { data: Number(args.p_finding_id) + 1000, error: null };
      }
      if (fn === "seller_recon_preview") {
        MOCK.previews += 1;
        const ids = args.p_decision_ids as number[];
        const changes = ids.map((d) => {
          const f = d - 1000;
          const problem = (MOCK.previews === 1 || MOCK.sticky ? MOCK.previewProblems[f] : undefined)
            ?? (MOCK.previews === 2 ? MOCK.laterProblems[f] : undefined) ?? null;
          const ref = `05-0000-${String(f).padStart(5, "0")}`;
          return { decisionId: d, problem, findingId: f, matchId: f, saleId: f + 500, orderRef: ref,
            field: MOCK.foreignField && f === 1 ? "shipping" : "external_order_ref", decision: "take_external",
            old: MOCK.foreignField && f === 1 ? { shipping: 4.99 } : { externalOrderRef: null },
            target: MOCK.foreignField && f === 1 ? { shipping: 5.49 } : { externalOrderRef: MOCK.shownChanged && f === 2 ? "other" : ref },
            version: { analysed: "v", current: "v" } };
        });
        const problems = changes.filter((c) => c.problem !== null).length;
        return { data: { sessionId: 14, state: "open", sessionOpen: true, count: changes.length, problems,
          admissible: problems === 0, staleSales: 0, token: problems === 0 ? TOKEN : null, changes }, error: null };
      }
      if (fn === "seller_recon_apply") {
        return MOCK.applyError ? { data: null, error: MOCK.applyError }
          : { data: { applied: (args.p_decision_ids as number[]).length, sales: (args.p_decision_ids as number[]).length, appliedAt: "x" }, error: null };
      }
      return { data: null, error: { code: "XX000", message: "unexpected" } };
    },
  }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../release", () => ({ APPLY_RELEASED: true }));
vi.mock("./queries", async (orig) => ({
  ...(await orig<typeof import("./queries")>()),
  fetchReconciliationSessionAll: async () => ({ status: "ok", page: { session: { channel: "ebay" } }, complete: true, matches: MOCK.matches }),
}));

const { takeOrderNumbers } = await import("./actions");
const { de } = await import("@/lib/i18n/de");
const { STAGING_PROJECT_REF } = await import("@/lib/admin/catalog-source");
const { bulkOrderNumbers } = await import("../plan");
type Finding = import("../view").Finding;
type Match = import("../view").Match;
const errors = de.business.reconciliation.errors;

/** Pair n: match id n, finding id n, sale 500+n, order number 05-0000-0000n — certain, without number. */
const pair = (n: number, over: { ref?: string | null; applied?: boolean; lock?: Finding["lock"] } = {}): Match => {
  const ref = `05-0000-${String(n).padStart(5, "0")}`;
  return {
    id: n, category: "exact", certainty: "unique", score: 1, dateDelta: 0, competitors: [], reason: null,
    order: { orderRef: ref } as Match["order"], sale: { id: 500 + n } as Match["sale"],
    ledger: { state: "unchanged", version: { analysed: "v", current: "v" },
      current: { soldOn: "2026-05-10", itemsSubtotal: 10, discount: 0, itemsNet: 10, shipping: 4.99, refundsTotal: 0,
        cancelledOn: null, expectedTotal: 14.99, pieces: 1, externalOrderRef: over.ref ?? null, isTest: false },
      atAnalysis: {} as NonNullable<Match["ledger"]>["atAnalysis"] },
    findings: [{ id: n, key: "external_order_ref", field: "external_order_ref", kind: "addition",
      shown: { ledger: null, external: ref }, delta: null, causes: [], allowedDecisions: ["take_external", "keep_ledger", "defer"],
      decision: null, applied: over.applied ?? false, lock: over.lock ?? null },
    // a shipping deviation beside it — never part of this action
    { id: 10_000 + n, key: "shipping", field: "shipping", kind: "deviation", shown: { ledger: 4.99, external: 5.49 }, delta: -0.5,
      causes: [], allowedDecisions: ["take_external", "keep_ledger", "defer"], decision: null, applied: false, lock: null }],
  } as Match;
};
const ALL = Array.from({ length: 38 }, (_, k) => k + 1);

let before: string | undefined;
beforeEach(() => {
  before = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
  Object.assign(MOCK, { calls: [], matches: ALL.map((n) => pair(n)), decideErrors: {}, previewProblems: {}, laterProblems: {}, sticky: false,
    previews: 0, foreignField: false, shownChanged: false, applyError: null });
});
afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = before; });
const fns = () => MOCK.calls.map((c) => c.fn);
const status = (r: Awaited<ReturnType<typeof takeOrderNumbers>>) =>
  Object.fromEntries(r.outcomes.filter((o) => o.status !== "taken").map((o) => [o.matchId, [o.status, o.problem]]));

describe("38 certain pairs without number", () => {
  it("the preview counts all 38 — and the run takes all 38: 38 decisions, ONE preview, ONE apply, only order numbers", async () => {
    expect(bulkOrderNumbers(MOCK.matches as Match[]).takeable).toHaveLength(38);
    const r = await takeOrderNumbers(14, ALL);
    expect(r).toMatchObject({ ok: true, applied: 38 });
    expect(r.outcomes.every((o) => o.status === "taken")).toBe(true);
    expect(fns().filter((f) => f === "seller_recon_decide")).toHaveLength(38);
    expect(fns().filter((f) => f !== "seller_recon_decide")).toEqual(["seller_recon_preview", "seller_recon_apply"]);
    // never the shipping finding beside it
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_decide").every((c) => Number(c.args.p_finding_id) < 10_000)).toBe(true);
    expect(MOCK.calls.at(-1)!.args).toEqual({ p_session_id: 14, p_decision_ids: ALL.map((n) => n + 1000), p_token: TOKEN });
  });
});

describe("one problem never blocks the others — and is named", () => {
  it("two rivals refused at decide (rival_sale, ref_taken): the other 36 are taken, the two named", async () => {
    MOCK.decideErrors = { 7: { code: "23514", message: "this finding cannot be taken over (rival_sale)" },
      21: { code: "23514", message: "this finding cannot be taken over (ref_taken)" } };
    const r = await takeOrderNumbers(14, ALL);
    expect(r).toMatchObject({ ok: true, applied: 36 });
    expect(status(r)).toEqual({ 7: ["refused", "rival_sale"], 21: ["refused", "ref_taken"] });
    expect(MOCK.calls.at(-1)!.args.p_decision_ids).toHaveLength(36);
  });

  it("changed since the analysis (decide answers PT409) or taken over meanwhile: only that case refused, the others taken", async () => {
    MOCK.decideErrors = { 4: { code: "PT409", message: "sale 504 changed since the analysis — analyse again" },
      9: { code: "23001", message: "this finding has already been applied" } };
    const r = await takeOrderNumbers(14, ALL);
    expect(r).toMatchObject({ ok: true, applied: 36 });
    expect(status(r)).toEqual({ 4: ["refused", "stale"], 9: ["refused", "already_applied"] });
  });

  it("a session closed meanwhile is not one case: the run ends, nothing applied", async () => {
    MOCK.decideErrors = { 1: { code: "23001", message: "this session is closed — nothing more can be decided" } };
    const r = await takeOrderNumbers(14, ALL);
    expect(r.ok).toBe(false);
    expect(fns()).toEqual(["seller_recon_decide"]);
  });

  it("changed between page and confirmation (preview says stale): left out, previewed once more without it, the rest taken", async () => {
    MOCK.previewProblems = { 3: "stale" };
    const r = await takeOrderNumbers(14, ALL);
    expect(r).toMatchObject({ ok: true, applied: 37 });
    expect(status(r)).toEqual({ 3: ["refused", "stale"] });
    expect(fns().filter((f) => f === "seller_recon_preview")).toHaveLength(2);
    expect((MOCK.calls.at(-1)!.args.p_decision_ids as number[]).includes(1003)).toBe(false);
  });

  it("already taken over or a number typed in since: skipped, nothing sent for it — never taken twice", async () => {
    MOCK.matches = ALL.map((n) => (n === 5 ? pair(n, { applied: true }) : n === 6 ? pair(n, { ref: "05-9999-00006" }) : pair(n)));
    const r = await takeOrderNumbers(14, ALL);
    expect(status(r)).toEqual({ 5: ["skipped", null], 6: ["skipped", null] });
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_decide").map((c) => c.args.p_finding_id)).not.toContain(5);
    expect(MOCK.calls.filter((c) => c.fn === "seller_recon_decide").map((c) => c.args.p_finding_id)).not.toContain(6);
  });

  it("only the cases shown are sent — a pair that became takeable since the preview is not added silently", async () => {
    const r = await takeOrderNumbers(14, [1, 2]);
    expect(r.outcomes.map((o) => o.matchId)).toEqual([1, 2]);
    expect(fns().filter((f) => f === "seller_recon_decide")).toHaveLength(2);
  });

  it("all refused: nothing previewed, nothing applied — and every case says why", async () => {
    MOCK.decideErrors = { 1: { code: "23514", message: "this finding cannot be taken over (rival_order)" } };
    const r = await takeOrderNumbers(14, [1]);
    expect(r).toMatchObject({ ok: true, applied: 0 });
    expect(status(r)).toEqual({ 1: ["refused", "rival_order"] });
    expect(fns()).toEqual(["seller_recon_decide"]);
  });
});

describe("no unsafe take-over", () => {
  it("the apply fails as a whole (another change under lock): NOTHING written, every accepted case 'not_applied'", async () => {
    MOCK.applyError = { code: "PT409", message: "the selection changed" };
    MOCK.decideErrors = { 2: { code: "23514", message: "this finding cannot be taken over (rival_sale)" } };
    const r = await takeOrderNumbers(14, [1, 2, 3]);
    expect(r.ok).toBe(false);
    expect(r.outcomes.map((o) => [o.matchId, o.status])).toEqual([[1, "not_applied"], [2, "refused"], [3, "not_applied"]]);
  });

  it("refused in both previews: left out each time, the rest taken", async () => {
    MOCK.previewProblems = { 1: "stale", 2: "stale" };
    MOCK.sticky = true;
    MOCK.matches = [pair(1), pair(2), pair(3)];
    const r = await takeOrderNumbers(14, [1, 2, 3]);
    expect(r).toMatchObject({ ok: true, applied: 1 });
    expect(status(r)).toEqual({ 1: ["refused", "stale"], 2: ["refused", "stale"] });
  });

  it("a NEW problem in the second preview: no third try, no apply — the rest 'not_applied', each problem named", async () => {
    MOCK.previewProblems = { 1: "stale" };
    MOCK.laterProblems = { 3: "already_applied" };
    MOCK.matches = [pair(1), pair(2), pair(3)];
    const r = await takeOrderNumbers(14, [1, 2, 3]);
    expect(fns()).not.toContain("seller_recon_apply");
    expect(r.ok).toBe(false);
    expect(status(r)).toEqual({ 1: ["refused", "stale"], 2: ["not_applied", null], 3: ["refused", "already_applied"] });
  });

  it("anything but the order number in the preview, or another number than shown: no apply", async () => {
    MOCK.foreignField = true;
    expect((await takeOrderNumbers(14, [1, 2])).ok).toBe(false);
    MOCK.foreignField = false; MOCK.shownChanged = true; MOCK.previews = 0;
    expect(await takeOrderNumbers(14, [1, 2])).toMatchObject({ ok: false, message: errors.shownValuesChanged });
    expect(fns()).not.toContain("seller_recon_apply");
  });

  it("an unnamed database error ends the run before any apply", async () => {
    MOCK.decideErrors = { 2: { code: "42501", message: "permission denied" } };
    const r = await takeOrderNumbers(14, [1, 2, 3]);
    expect(r.ok).toBe(false);
    expect(fns()).toEqual(["seller_recon_decide", "seller_recon_decide"]);
  });

  it.each([[[]], [[1, 1]], [[0]], [[-3]], [Array.from({ length: 501 }, (_, k) => k + 1)]])("a malformed list (%o) sends nothing", async (ids) => {
    expect((await takeOrderNumbers(14, ids)).ok).toBe(false);
    expect(MOCK.calls).toEqual([]);
  });
});
