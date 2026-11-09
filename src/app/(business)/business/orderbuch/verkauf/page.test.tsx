/**
 * The sales list, opened from the sales reconciliation (2026-11-08): the way
 * back is shown only for checked parts, built from them — and the list
 * behaves as before without them.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ ledger: [] as Record<string, unknown>[] }));
vi.mock("@/lib/orderbook/sales-queries", () => ({
  fetchSales: async () => ({ sales: [{ id: 64 }], summary: {}, counts: { normal: 1, incomplete: 0, open: 0, test: 0 } }),
  fetchSaleYears: async () => [2026],
}));
vi.mock("@/lib/reconciliation/server/queries", () => ({ reconciliationEnvironment: () => true }));
// The ledger is a client block; here only the props it receives matter.
vi.mock("@/components/business/sales-ledger", () => ({
  SalesLedger: (props: Record<string, unknown>) => { MOCK.ledger.push(props); return null; },
}));
vi.mock("@/components/business/orderbook-nav", () => ({ OrderbookNav: () => null, StatusFilter: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const { default: SalesPage } = await import("./page");
const { de } = await import("@/lib/i18n/de");
const back = de.business.reconciliation.result.backToReconciliation;

const render = async (q: Record<string, string> = {}) =>
  renderToStaticMarkup(await SalesPage({ searchParams: Promise.resolve(q) }));
const returnLinks = (html: string) => [...html.matchAll(/<a href="([^"]+)" data-return-to-reconciliation=""/g)].map((m) => m[1]);

beforeEach(() => { MOCK.ledger = []; });

describe("opened normally", () => {
  it("no way back to a reconciliation, and the ledger gets the plain address — as before", async () => {
    const html = await render({ verkauf: "64" });
    expect(html).not.toContain(back);
    expect(returnLinks(html)).toEqual([]);
    expect(MOCK.ledger[0].backHref).toBe("/business/orderbuch/verkauf");
    expect(MOCK.ledger[0].returnHref).toBeNull();
    expect(MOCK.ledger[0].openSale).toBe(64);
  });
});

describe("opened from the reconciliation", () => {
  it("shows 'Zurück zum Abgleich' to the same session, filter and order card", async () => {
    const html = await render({ verkauf: "64", abgleich: "5", bestellung: "50", ansicht: "abweichung" });
    expect(html).toContain(back);
    expect(returnLinks(html)).toEqual(["/business/orderbuch/abgleich/5?ansicht=abweichung#recon-match-50"]);
    expect(MOCK.ledger[0].returnHref).toBe("/business/orderbuch/abgleich/5?ansicht=abweichung#recon-match-50");
  });

  it("closing the edit dialog keeps the way back: the ledger's own address carries the checked parts", async () => {
    await render({ verkauf: "64", abgleich: "5", bestellung: "50" });
    expect(MOCK.ledger[0].backHref).toBe("/business/orderbuch/verkauf?abgleich=5&bestellung=50");
  });

  it.each([
    [{ abgleich: "https://evil.example", bestellung: "50" }],
    [{ abgleich: "//evil.example", bestellung: "50" }],
    [{ abgleich: "5", bestellung: "javascript:alert(1)" }],
    [{ abgleich: "0", bestellung: "50" }],
    [{ abgleich: "5;drop", bestellung: "50" }],
    [{ abgleich: "5" }],
    [{ bestellung: "50" }],
  ])("refuses a way back that is not two plain ids (%o): nothing shown, nothing echoed", async (q) => {
    const html = await render({ verkauf: "64", ...q });
    expect(returnLinks(html)).toEqual([]);
    expect(html).not.toMatch(/evil\.example|javascript:/);
    expect(MOCK.ledger[0].returnHref).toBeNull();
    expect(MOCK.ledger[0].backHref).toBe("/business/orderbuch/verkauf");
  });

  it("an unknown filter word is dropped — the way back then leads to 'Alle'", async () => {
    const html = await render({ abgleich: "5", bestellung: "50", ansicht: "../../admin" });
    expect(returnLinks(html)).toEqual(["/business/orderbuch/abgleich/5#recon-match-50"]);
    expect(html).not.toContain("admin");
  });
});
