/**
 * One sale's page — the positions (figures and count) — opened from the CSV
 * reconciliation (2026-11-08, 0181): "Zurück zum Abgleich" only for checked
 * parts, built from them; the hand correction only for an imported, external,
 * not cancelled sale; and the page as before without any of it.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  sale: {} as Record<string, unknown>,
  order: null as Record<string, unknown> | null,
  correctionsRead: [] as number[],
}));
vi.mock("@/lib/orderbook/sales-queries", () => ({
  fetchSale: async () => ({ sale: MOCK.sale, order: MOCK.order, items: [{ id: 518 }], is_test: false, expected_payout: 10 }),
}));
vi.mock("@/lib/orderbook/sales-actions", () => ({
  loadSaleItemCorrections: async (id: number) => { MOCK.correctionsRead.push(id); return [{ id: 1 }]; },
}));
vi.mock("@/components/business/sale-items", () => ({
  SaleItems: (props: Record<string, unknown>) => { MOCK.items.push(props); return null; },
}));
vi.mock("@/components/business/test-flag", () => ({ TestFlag: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const { default: SalePage } = await import("./page");
const { de } = await import("@/lib/i18n/de");
const back = de.business.reconciliation.result.backToReconciliation;

const WORKBOOK = { id: 152, channel: "ebay", source: "excel_order_2026", stock_released_at: null, cancelled_at: null,
  sold_at: "2026-04-24", updated_at: "2026-11-08T10:00:00+00:00", items_subtotal: 30, shipping_charged: 5.49, discount_amount: 0 };
const render = async (q: Record<string, string> = {}) =>
  renderToStaticMarkup(await SalePage({ params: Promise.resolve({ id: "152" }), searchParams: Promise.resolve(q) }));
const returnLinks = (html: string) => [...html.matchAll(/<a href="([^"]+)" data-return-to-reconciliation=""/g)].map((m) => m[1]);

/* 0181 lies on Staging only (Production release F0, `schema-features.ts`). */
const STAGING = "https://qqxcpesbwfxzgytkdsac.supabase.co";
const PRODUCTION = "https://zmiwxswrpkmizvqsgype.supabase.co";

beforeEach(() => {
  MOCK.items = []; MOCK.sale = { ...WORKBOOK }; MOCK.order = null; MOCK.correctionsRead = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", STAGING);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("opened from the reconciliation", () => {
  it("'Zurück zum Abgleich' to the same session, filter and order card", async () => {
    const html = await render({ abgleich: "12", bestellung: "191", ansicht: "abweichung" });
    expect(returnLinks(html)).toEqual(["/business/orderbuch/abgleich/12?ansicht=abweichung#recon-match-191"]);
  });

  it.each([
    [{ abgleich: "//evil.example", bestellung: "191" }],
    [{ abgleich: "12", bestellung: "javascript:alert(1)" }],
    [{ abgleich: "12" }],
  ])("refuses anything but two plain ids (%o)", async (q) => {
    const html = await render(q);
    expect(returnLinks(html)).toEqual([]);
    expect(html).not.toMatch(/evil\.example|javascript:/);
  });

  it("opened normally: no way back to a reconciliation — the page as before", async () => {
    const html = await render();
    expect(html).not.toContain(back);
    expect(html).toContain(de.business.sales.backToLedger);
  });
});

describe("the hand correction (0181)", () => {
  it("an imported external sale: correctable, with its version and its corrections", async () => {
    await render();
    expect(MOCK.items[0]).toMatchObject({ correctable: true, historical: true, updatedAt: "2026-11-08T10:00:00+00:00", corrections: [{ id: 1 }] });
    expect(MOCK.correctionsRead).toEqual([152]);
  });

  it("a normal sale, a cancelled imported one, an internal one: not correctable, no corrections read", async () => {
    for (const setup of [
      () => { MOCK.sale = { ...WORKBOOK, source: "manual" }; },
      () => { MOCK.sale = { ...WORKBOOK, cancelled_at: "2026-04-25" }; },
      () => { MOCK.order = { id: 9, lines: [], paid_at: "2026-04-24" }; },
    ]) {
      MOCK.items = []; MOCK.correctionsRead = []; MOCK.sale = { ...WORKBOOK }; MOCK.order = null;
      setup();
      await render();
      expect(MOCK.items[0].correctable).toBe(false);
      expect(MOCK.correctionsRead).toEqual([]);
    }
  });

  it.each([["Production", PRODUCTION], ["no URL", ""], ["an unknown host", "https://example.invalid"]])(
    "without 0181 (%s): the imported sale is shown as before 0181 — not correctable, no corrections read", async (_label, url) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      const html = await render();
      expect(MOCK.items[0]).toMatchObject({ correctable: false, historical: true, corrections: [] });
      expect(MOCK.correctionsRead).toEqual([]);
      expect(html).not.toContain(de.business.sales.errors.legacyCorrectionUnavailable);
    });
});
