/**
 * "Bestellnummer übernehmen" (2026-11-09): the order number of a certain pair
 * is its own act, no longer part of "Angaben abgleichen". It goes the 0180
 * way — decide, preview, apply with the preview's token — for exactly ONE
 * finding, built from the STORED session: the browser names only the card.
 * Nothing financial travels with it; rivals still refuse (0180, unchanged).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: Record<string, unknown> };
const TOKEN = "b".repeat(64);
const MOCK = vi.hoisted(() => ({ calls: [] as Call[], decideError: null as unknown, matches: [] as unknown[], session: "ok" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      MOCK.calls.push({ fn, args });
      if (fn === "seller_recon_decide") return MOCK.decideError ? { data: null, error: MOCK.decideError } : { data: 700, error: null };
      if (fn === "seller_recon_preview") return { data: {
        sessionId: 12, state: "open", sessionOpen: true, count: 1, problems: 0, admissible: true, staleSales: 0, token: "b".repeat(64),
        changes: [{ decisionId: 700, problem: null, findingId: 1, matchId: 50, saleId: 64, orderRef: "06-14260-71832",
          field: "external_order_ref", decision: "take_external", old: { externalOrderRef: null },
          target: { externalOrderRef: "06-14260-71832" }, version: { analysed: "v", current: "v" } }] }, error: null };
      if (fn === "seller_recon_apply") return { data: { applied: 1, sales: 1, appliedAt: "x" }, error: null };
      return { data: null, error: { code: "XX000", message: "unexpected" } };
    },
  }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../release", () => ({ APPLY_RELEASED: true }));
vi.mock("./queries", async (orig) => ({
  ...(await orig<typeof import("./queries")>()),
  fetchReconciliationSessionAll: async () => (MOCK.session === "ok"
    ? { status: "ok", page: { session: { channel: "ebay" } }, complete: true, matches: MOCK.matches } : { status: "not_found" }),
}));

const { takeOrderNumber } = await import("./actions");
const { de } = await import("@/lib/i18n/de");
const { STAGING_PROJECT_REF } = await import("@/lib/admin/catalog-source");
type Finding = import("../view").Finding;
type Match = import("../view").Match;
const errors = de.business.reconciliation.errors;

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 1, key: "external_order_ref", field: "external_order_ref", kind: "addition",
  shown: { ledger: null, external: "06-14260-71832" }, delta: null, causes: [],
  allowedDecisions: ["take_external", "keep_ledger", "defer"], decision: null, applied: false, lock: null, ...over,
});
const shipping = finding({ id: 2, key: "shipping", field: "shipping", kind: "deviation", shown: { ledger: 4.99, external: 5.49 }, delta: -0.5 });
const match = (over: Partial<Match> = {}): Match => ({
  id: 50, category: "deviating", certainty: "unique", score: 1, dateDelta: 0, competitors: [], reason: null,
  order: { orderRef: "06-14260-71832" } as Match["order"], sale: { id: 64 } as Match["sale"],
  ledger: { state: "unchanged", version: { analysed: "v", current: "v" },
    current: { soldOn: "2026-02-10", itemsSubtotal: 12.5, discount: 0, itemsNet: 12.5, shipping: 4.99, refundsTotal: 0,
      cancelledOn: null, expectedTotal: 17.49, pieces: 1, externalOrderRef: null, isTest: false },
    atAnalysis: {} as NonNullable<Match["ledger"]>["atAnalysis"] },
  findings: [finding(), shipping], ...over,
} as Match);

let before: string | undefined;
beforeEach(() => {
  before = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
  Object.assign(MOCK, { calls: [], decideError: null, matches: [match()], session: "ok" });
});
afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = before; });

describe("Bestellnummer übernehmen", () => {
  it("decides ONLY the order number — from the stored finding, never the shipping beside it — then preview and apply with the token", async () => {
    expect(await takeOrderNumber(12, 50)).toEqual({ ok: true, applied: 1, sales: 1 });
    expect(MOCK.calls).toEqual([
      { fn: "seller_recon_decide", args: { p_finding_id: 1, p_decision: "take_external", p_manual_value: null, p_reason: null,
        p_shown_ledger: null, p_shown_external: "06-14260-71832" } },
      { fn: "seller_recon_preview", args: { p_session_id: 12, p_decision_ids: [700] } },
      { fn: "seller_recon_apply", args: { p_session_id: 12, p_decision_ids: [700], p_token: TOKEN } },
    ]);
  });

  it("a rival refuses as before (0180's rule, unchanged) — nothing previewed, nothing applied", async () => {
    MOCK.decideError = { code: "23514", message: "this take-over is not allowed (rival_sale)" };
    expect((await takeOrderNumber(12, 50)).ok).toBe(false);
    expect(MOCK.calls.map((c) => c.fn)).toEqual(["seller_recon_decide"]);
  });

  it.each([
    ["the number is there already", [match({ ledger: { ...match().ledger!, current: { ...match().ledger!.current, externalOrderRef: "x" } } })]],
    ["taken over earlier", [match({ findings: [finding({ applied: true })] })]],
    ["only probable, not certain", [match({ certainty: "probable", category: "probable" })]],
    ["locked (closed session)", [match({ findings: [finding({ lock: "session_not_open" })] })]],
    ["no such card", [match({ id: 51 })]],
  ])("nothing to take — %s: refused before anything is sent", async (_, matches) => {
    MOCK.matches = matches;
    expect(await takeOrderNumber(12, 50)).toEqual({ ok: false, message: errors.notTakeable });
    expect(MOCK.calls).toEqual([]);
  });

  it("a session that cannot be read, or a malformed id, sends nothing", async () => {
    MOCK.session = "missing";
    expect((await takeOrderNumber(12, 50)).ok).toBe(false);
    MOCK.session = "ok";
    expect((await takeOrderNumber(-1, 50)).ok).toBe(false);
    expect(MOCK.calls).toEqual([]);
  });
});
