/**
 * Whether an unmatched order already stands as a sale (2026-11-09): the
 * ORDER NUMBER decides, not the date. Within ±3 days the candidates settle
 * it; beyond, `seller_sales` is asked by the number, and only an exact match
 * on channel and number counts. A failed lookup offers nothing (fail closed).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code: string } | null }>;
const MOCK = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown> }[], rpc: null as unknown as Rpc }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (name: string, args: Record<string, unknown>) => { MOCK.calls.push({ name, args }); return MOCK.rpc(name, args); } }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => true }));
vi.mock("@/lib/admin/catalog-source", () => ({ isStagingProjectUrl: () => true }));

const { attachOrderContext } = await import("./queries");
type Match = import("../view").Match;

const REF = "06-14518-99785";
const unmatched = (): Match => ({
  id: 229, category: "external_only", certainty: null, score: null, dateDelta: null, competitors: [], reason: null,
  order: { id: 204, orderRef: REF, soldOn: "2026-04-16", lines: [] } as unknown as Match["order"],
  sale: null, ledger: null, findings: [],
} as Match);
const candidate = (saleId: number, soldOn: string, externalOrderRef: string | null) => ({
  saleId, source: "manual", isTest: false, soldOn, itemsSubtotal: 0, discount: 0, shipping: 0, refundsTotal: 0,
  cancelledOn: null, externalOrderRef, updatedAt: null, pieces: [],
});
const sales = (rows: Record<string, unknown>[]) => ({ data: { sales: rows, summary: {}, counts: {} }, error: null });

beforeEach(() => { MOCK.calls = []; });

describe("an unmatched order and the sale that carries its number", () => {
  it("within the window: found among the candidates, no further lookup", async () => {
    MOCK.rpc = async (name) => (name === "seller_recon_candidates" ? { data: [candidate(412, "2026-04-16", REF)], error: null }
      : name === "seller_recon_aliases" ? { data: {}, error: null } : sales([]));
    const [m] = await attachOrderContext("ebay", [unmatched()]);
    expect(m.createdSaleId).toBe(412);
    expect(MOCK.calls.map((c) => c.name).sort()).toEqual(["seller_recon_aliases", "seller_recon_candidates"]);
  });

  it("beyond three days: found by the number itself — exact number, same channel", async () => {
    MOCK.rpc = async (name) => (name === "seller_recon_candidates" ? { data: [], error: null }
      : sales([{ id: 9, channel: "ebay", external_order_ref: `${REF}-X` }, { id: 7, channel: "kleinanzeigen", external_order_ref: REF },
        { id: 413, channel: "ebay", external_order_ref: REF, sold_at: "2026-05-30" }]));
    const [m] = await attachOrderContext("ebay", [unmatched()]);
    expect(m.createdSaleId).toBe(413);
    expect(MOCK.calls.find((c) => c.name === "seller_sales")).toEqual({ name: "seller_sales", args: { p_year: null, p_month: null, p_search: REF, p_undated: false,
      p_scope: "external", p_open_payout: false, p_status: "any" } });
  });

  it("nowhere: null — the creation may be offered", async () => {
    MOCK.rpc = async (name) => (name === "seller_recon_candidates" ? { data: [], error: null } : sales([{ id: 9, channel: "ebay", external_order_ref: `${REF}-X` }]));
    expect((await attachOrderContext("ebay", [unmatched()]))[0].createdSaleId).toBeNull();
  });

  it("the lookup fails: not known — nothing offered (fail closed)", async () => {
    MOCK.rpc = async (name) => (name === "seller_recon_candidates" ? { data: [], error: null } : { data: null, error: { code: "XX000" } });
    expect((await attachOrderContext("ebay", [unmatched()]))[0].createdSaleId).toBeUndefined();
  });
});

describe("the candidates of an unmatched order (ADR-0182)", () => {
  const piece = (skyId: string, name: string) => ({ itemId: 1, skyId, name, rawName: null, seriesCode: "G", baseSkyId: null });
  const withLines = (): Match => ({ ...unmatched(), order: { id: 204, orderRef: REF, soldOn: "2026-04-16", itemsValue: 6, shipping: 5.49,
    total: 11.49, pieces: 1, lines: [{ name: "Cynder", title: "Giants [Cynder]", quantity: 1, unitPrice: 6, value: 6 }] } as unknown as Match["order"] });

  it("ONE read of ±14 days for the page; a sale created after the analysis is the first candidate", async () => {
    MOCK.rpc = async (name) => (name === "seller_recon_candidates"
      ? { data: [{ ...candidate(381, "2026-04-16", null), itemsSubtotal: 6, shipping: 5.49, pieces: [piece("SKY-0150", "Cynder")] }], error: null }
      : name === "seller_recon_aliases" ? { data: {}, error: null } : sales([]));
    const [m] = await attachOrderContext("ebay", [withLines()]);
    expect(MOCK.calls.find((c) => c.name === "seller_recon_candidates")!.args).toEqual({ p_channel: "ebay", p_from: "2026-04-05", p_to: "2026-04-27" });
    expect(m.createdSaleId).toBeNull();
    expect(m.candidates!.shown.map((c) => [c.saleId, c.score])).toEqual([[381, 105]]);
  });

  it("a sale that carries the number now: no candidates, but the comparison judged again", async () => {
    MOCK.rpc = async (name) => (name === "seller_recon_candidates"
      ? { data: [{ ...candidate(381, "2026-04-17", REF), itemsSubtotal: 6, shipping: 4.99, pieces: [piece("SKY-0150", "Cynder")] }], error: null }
      : name === "seller_recon_aliases" ? { data: {}, error: null } : sales([]));
    const [m] = await attachOrderContext("ebay", [withLines()]);
    expect(m.createdSaleId).toBe(381);
    expect(m.candidates).toBeUndefined();
    expect(m.linkedComparison).toMatchObject({ saleId: 381, shipping: { equal: false }, date: { delta: 1 }, orderRef: REF });
  });
});
