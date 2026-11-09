/**
 * The server side of the candidates (ADR-0182, 0185): the order comes from
 * the STORED session, the search reads one chosen period, the assignment
 * forwards order, sale and version — and refusals come back in words.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown> }[],
  answer: null as { data: unknown; error: { code: string; message?: string } | null } | null, session: "ok" as string }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
    MOCK.calls.push({ name, args });
    if (name === "seller_recon_aliases") return { data: {}, error: null };
    if (name === "seller_recon_candidates") return { data: [
      { saleId: 381, source: "manual", isTest: false, soldOn: "2026-04-16", itemsSubtotal: 6, discount: 0, shipping: 5.49, refundsTotal: 0,
        cancelledOn: null, externalOrderRef: null, updatedAt: "v1", pieces: [{ itemId: 1, skyId: "SKY-0150", name: "Cynder", rawName: null, seriesCode: "G", baseSkyId: null }] },
      { saleId: 382, source: "manual", isTest: false, soldOn: "2026-02-01", itemsSubtotal: 6, discount: 0, shipping: 5.49, refundsTotal: 0,
        cancelledOn: null, externalOrderRef: null, updatedAt: "v1", pieces: [] }], error: null };
    return MOCK.answer ?? { data: { status: "assigned", sale_id: 381 }, error: null };
  } }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => true }));
vi.mock("@/lib/admin/catalog-source", () => ({ isStagingProjectUrl: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("./queries", () => ({
  fetchReconciliationSessionAll: async () => (MOCK.session === "ok" ? { status: "ok", page: { session: { channel: "ebay" } }, complete: true, matches: [
    { id: 229, category: "external_only", sale: null, order: { id: 204, orderRef: "06-14518-99785", soldOn: "2026-04-16", itemsValue: 6,
      shipping: 5.49, pieces: 1, lines: [{ name: "Cynder", title: "Giants", quantity: 1, unitPrice: 6, value: 6 }] } },
    { id: 230, category: "exact", sale: { id: 130 }, order: { id: 205, orderRef: "x", soldOn: "2026-04-16", lines: [] } },
  ] } : { status: "not_found" }),
}));

const { assignSaleToReport, confirmWithExclusions, searchCandidates } = await import("./candidate-actions");
const { de } = await import("@/lib/i18n/de");
const t = de.business.reconciliation.candidates;

beforeEach(() => { MOCK.calls = []; MOCK.answer = null; MOCK.session = "ok"; });

describe("the search", () => {
  it("reads the chosen period only and scores by the analysis' rule", async () => {
    const r = await searchCandidates(12, 229, "2026-04-01", "2026-04-30");
    expect(r.ok && r.candidates.map((c) => [c.saleId, c.score])).toEqual([[381, 105]]);
    expect(MOCK.calls.find((c) => c.name === "seller_recon_candidates")!.args).toEqual({ p_channel: "ebay", p_from: "2026-04-01", p_to: "2026-04-30" });
  });

  it("a period of more than 92 days, or reversed, is refused before anything is read", async () => {
    expect(await searchCandidates(12, 229, "2026-01-01", "2026-05-01")).toEqual({ ok: false, message: t.searchRange });
    expect(await searchCandidates(12, 229, "2026-04-30", "2026-04-01")).toEqual({ ok: false, message: t.searchRange });
    expect(MOCK.calls).toEqual([]);
  });

  it("only for an unmatched order of the stored session", async () => {
    expect((await searchCandidates(12, 230, "2026-04-01", "2026-04-30")).ok).toBe(false);
  });
});

describe("the assignment", () => {
  it("forwards the order id FROM THE SESSION, the sale and the version", async () => {
    expect(await assignSaleToReport(12, 229, 381, "v1")).toEqual({ ok: true, status: "assigned", saleId: 381 });
    expect(MOCK.calls).toEqual([{ name: "seller_recon_assign_sale", args: { p_order_id: 204, p_sale_id: 381, p_expected_updated_at: "v1" } }]);
  });

  it("no version, no assignment — and a card that is not unmatched is refused", async () => {
    expect(await assignSaleToReport(12, 229, 381, null)).toEqual({ ok: false, message: t.assignErrors.rejected });
    expect(await assignSaleToReport(12, 230, 130, "v1")).toEqual({ ok: false, message: t.assignErrors.not_unmatched });
    expect(MOCK.calls).toEqual([]);
  });

  it.each([
    [{ code: "PT409" }, t.assignErrors.stale],
    [{ code: "PGRST202" }, t.assignErrors.notAvailable],
    [{ code: "23514", message: "this sale cannot be assigned (rival_sale)" }, t.assignErrors.rival_sale],
    [{ code: "23514", message: "this sale cannot be assigned (ref_present)" }, t.assignErrors.ref_present],
    [{ code: "23514", message: "this sale cannot be assigned (paired)" }, t.assignErrors.paired],
    [{ code: "23505", message: "duplicate key" }, t.assignErrors.ref_taken],
  ])("a refusal (%o) in words", async (error, text) => {
    MOCK.answer = { data: null, error };
    expect(await assignSaleToReport(12, 229, 381, "v1")).toEqual({ ok: false, message: text });
  });
});

describe("the assignment despite rivals (0186)", () => {
  const EX = { sales: [{ id: 158, updatedAt: "v158" }, { id: 160, updatedAt: "v160" }], orders: [] };

  it("an unmatched order: forwards order FROM THE SESSION, sale, version, each rival with its version, the reason", async () => {
    MOCK.answer = { data: { status: "confirmed", sale_id: 381 }, error: null };
    expect(await confirmWithExclusions(12, 229, 381, "v1", EX, "  158 und 160 sind Mai-Verkäufe  ")).toEqual({ ok: true, status: "assigned", saleId: 381 });
    expect(MOCK.calls).toEqual([{ name: "seller_recon_confirm_order_ref", args: {
      p_order_id: 204, p_sale_id: 381, p_expected_updated_at: "v1", p_excluded: EX, p_note: "158 und 160 sind Mai-Verkäufe" } }]);
  });

  it("a pair: only with its OWN sale", async () => {
    MOCK.answer = { data: { status: "confirmed", sale_id: 130 }, error: null };
    expect((await confirmWithExclusions(12, 230, 130, "v1", EX, "geprüft")).ok).toBe(true);
    expect(await confirmWithExclusions(12, 230, 131, "v1", EX, "geprüft")).toEqual({ ok: false, message: t.exclude.errors.not_assignable });
  });

  it.each([
    ["no reason", [12, 229, 381, "v1", EX, "   "]],
    ["no version", [12, 229, 381, null, EX, "x"]],
    ["no rival at all", [12, 229, 381, "v1", { sales: [], orders: [] }, "x"]],
    ["a rival sale without its version", [12, 229, 381, "v1", { sales: [{ id: 158 }], orders: [] }, "x"]],
    ["a rival sale with an empty version", [12, 229, 381, "v1", { sales: [{ id: 158, updatedAt: "" }], orders: [] }, "x"]],
    ["extra keys", [12, 229, 381, "v1", { ...EX, all: true }, "x"]],
    ["a reason of more than 500 characters", [12, 229, 381, "v1", EX, "x".repeat(501)]],
  ])("refused before anything is sent: %s", async (_, args) => {
    expect(await (confirmWithExclusions as (...a: unknown[]) => Promise<unknown>)(...args)).toEqual({ ok: false, message: t.exclude.errors.rejected });
    expect(MOCK.calls).toEqual([]);
  });

  it.each([
    [{ code: "23514", message: "this order number cannot be confirmed (rivals_changed)" }, t.exclude.errors.rivals_changed],
    [{ code: "23514", message: "this order number cannot be confirmed (no_rivals)" }, t.exclude.errors.no_rivals],
    [{ code: "23514", message: "this order number cannot be confirmed (ref_present)" }, t.exclude.errors.ref_present],
    [{ code: "PT409" }, t.assignErrors.stale],
    [{ code: "23505" }, t.assignErrors.ref_taken],
    [{ code: "PGRST202" }, t.exclude.errors.notAvailable],
  ])("a refusal (%o) in words", async (error, text) => {
    MOCK.answer = { data: null, error };
    expect(await confirmWithExclusions(12, 229, 381, "v1", EX, "geprüft")).toEqual({ ok: false, message: text });
  });
});
