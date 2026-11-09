/**
 * `/verkauf/neu` opened from the CSV reconciliation (0184): the order is read
 * from the stored session — the address names only session and card — and
 * only an unmatched order whose number is on no sale becomes starting values.
 * Without the parameters the page is what it was.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ props: [] as Record<string, unknown>[], matches: [] as Record<string, unknown>[],
  created: null as number | null | undefined, status: "ok" as string }));
vi.mock("@/components/business/new-sale", () => ({ NewSale: (p: Record<string, unknown>) => { MOCK.props.push(p); return null; } }));
vi.mock("@/lib/orderbook/queries", () => ({ fetchOrderbookCatalog: async () => [] }));
vi.mock("@/lib/reconciliation/server/queries", () => ({
  fetchReconciliationSessionAll: async () => (MOCK.status === "ok"
    ? { status: "ok", page: { session: { channel: "ebay" } }, matches: MOCK.matches, complete: true } : { status: MOCK.status }),
  attachOrderContext: async (_c: string, ms: Record<string, unknown>[]) => ms.map((m) => ({ ...m, createdSaleId: MOCK.created })),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const { default: Page } = await import("./page");
const { de } = await import("@/lib/i18n/de");

const ORDER = { id: 204, orderRef: "06-14518-99785", soldOn: "2026-04-16", destinationCountry: "DE", itemsValue: 30.01, shipping: 5.49,
  total: 35.5, lines: [{ name: "Cynder", quantity: 1, unitPrice: 0.95, title: "x" }] };
const render = async (q: Record<string, string>) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve(q) }));
beforeEach(() => {
  MOCK.props = []; MOCK.status = "ok"; MOCK.created = null;
  MOCK.matches = [{ id: 229, category: "external_only", sale: null, order: ORDER }];
});

describe("from the reconciliation", () => {
  it("an unmatched order: its report values as starting values, the way back to the card", async () => {
    const html = await render({ abgleich: "12", bestellung: "229" });
    expect(MOCK.props[0].fromReport).toEqual({
      back: { sessionId: 12, matchId: 229, view: null }, orderRef: "06-14518-99785", soldAt: "2026-04-16", country: "DE",
      subtotal: 30.01, shipping: 5.49, lines: [{ name: "Cynder", quantity: 1, unitPrice: 0.95 }],
    });
    expect(html).toContain('href="/business/orderbuch/abgleich/12#recon-match-229" data-back-to-reconciliation=""');
  });

  it("a sale already carries the number: linked, and NO form — nothing to create twice", async () => {
    MOCK.created = 412;
    const html = await render({ abgleich: "12", bestellung: "229" });
    expect(MOCK.props).toEqual([]);
    expect(html).toContain(de.business.sales.create.fromReport.exists(412));
  });

  it("a paired order, an unknown card, an unreadable session: the plain form, said so — never someone else's values", async () => {
    for (const setup of [
      () => { MOCK.matches = [{ id: 229, category: "exact", sale: { id: 5 }, order: ORDER }]; },
      () => { MOCK.matches = []; },
      () => { MOCK.status = "not_found"; },
    ]) {
      MOCK.props = []; MOCK.status = "ok"; MOCK.matches = [{ id: 229, category: "external_only", sale: null, order: ORDER }];
      setup();
      const html = await render({ abgleich: "12", bestellung: "229" });
      expect(MOCK.props[0].fromReport).toBeNull();
      expect(html).toContain("data-report-unusable");
    }
  });

  it("anything but two plain ids is ignored", async () => {
    await render({ abgleich: "//evil", bestellung: "229" });
    expect(MOCK.props[0].fromReport).toBeNull();
  });
});

describe("opened normally", () => {
  it("the page as before: no starting values, back to the ledger, ?test=1 still a default", async () => {
    const html = await render({ test: "1" });
    expect(MOCK.props[0]).toMatchObject({ defaultTest: true, fromReport: null });
    expect(html).toContain(de.business.sales.backToLedger);
  });
});
