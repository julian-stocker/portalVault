/**
 * `createSaleWithDetails` and the reservation mode (0184): `hold: false` is
 * sent explicitly; `hold: true` — the normal path — sends exactly the call of
 * before 0184 (no `p_hold`), so it works on a database without 0184 too.
 * A duplicate order number and a database without 0184 are said in words.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown> }[],
  answer: { data: 412 as unknown, error: null as { code: string; message?: string } | null } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: async (name: string, args: Record<string, unknown>) => { MOCK.calls.push({ name, args }); return MOCK.answer; } }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { createSaleWithDetails } = await import("./sales-actions");
const { de } = await import("@/lib/i18n/de");

const input = (hold: boolean) => ({
  channel: "ebay", soldAt: "2026-04-16", country: "DE", reference: "06-14518-99785", buyer: null, note: null, isTest: false,
  subtotal: 30.01, shipping: 5.49, discount: 0, items: [{ sky_id: "SKY-0150" }], fees: [], refunds: [], adjustments: [], hold,
});

beforeEach(() => { MOCK.calls = []; MOCK.answer = { data: 412, error: null }; });

describe("the reservation mode reaches the database unambiguously", () => {
  it("hold false: p_hold false is sent", async () => {
    expect(await createSaleWithDetails(input(false))).toMatchObject({ ok: true, id: 412 });
    expect(MOCK.calls[0].name).toBe("seller_create_sale_with_details");
    expect(MOCK.calls[0].args.p_hold).toBe(false);
  });

  it("hold true (the normal path): exactly the call of before 0184 — no p_hold at all", async () => {
    await createSaleWithDetails(input(true));
    expect("p_hold" in MOCK.calls[0].args).toBe(false);
    expect(Object.keys(MOCK.calls[0].args).sort()).toEqual(["p_adjustments", "p_buyer_ref", "p_channel", "p_country",
      "p_discount_amount", "p_external_ref", "p_fees", "p_is_test", "p_items", "p_items_subtotal", "p_note", "p_payout_amount",
      "p_payout_ref", "p_shipping_charged", "p_sold_at"]);
  });

  it("anything but a boolean is refused before the database is asked", async () => {
    expect((await createSaleWithDetails({ ...input(false), hold: undefined as unknown as boolean })).ok).toBe(false);
    expect(MOCK.calls).toEqual([]);
  });
});

describe("what the database refuses, in words", () => {
  it("a duplicate order number (0171's index)", async () => {
    MOCK.answer = { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "sales_external_order_ref_per_channel"' } };
    expect(await createSaleWithDetails(input(false))).toEqual({ ok: false, message: de.business.sales.errors.duplicateOrderRef });
  });

  it("no 0184 on this database: without reservation is refused LOUDLY — never quietly with one", async () => {
    MOCK.answer = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    expect(await createSaleWithDetails(input(false))).toEqual({ ok: false, message: de.business.sales.errors.holdOptionUnavailable });
    expect(MOCK.calls).toHaveLength(1);
  });
});
