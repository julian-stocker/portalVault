/**
 * "Figuren / Stückzahl bearbeiten" on an order card (2026-11-08): only where
 * figures or count differ — stored, or judged again — and straight to the
 * sale's positions with the way back to this session, filter and card.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/reconciliation/server/actions", () => ({ confirmReconciliation: async () => ({ ok: true }) }));

const { MatchCard } = await import("./match-comparison");
const { de } = await import("@/lib/i18n/de");
type Match = import("@/lib/reconciliation/view").Match;
type Finding = import("@/lib/reconciliation/view").Finding;

const finding = (over: Partial<Finding>): Finding => ({
  id: 1, key: "pieces", field: "pieces", kind: "deviation", shown: { ledger: 3, external: 5 }, delta: -2, causes: [],
  allowedDecisions: ["keep_ledger", "defer"], decision: null, applied: false, lock: null, ...over,
});
const match = (findings: Finding[]): Match => ({
  id: 191, category: "deviating", certainty: "unique", score: 80, dateDelta: 0, competitors: [], reason: null,
  order: { id: 176, orderRef: "12-14520-00152", recordNo: 1, soldOn: "2026-04-24", paidOn: null, shippedOn: null,
    itemsValue: 30, shipping: 5.49, total: 35.49, pieces: 5, combined: false, destinationCountry: "DE",
    shippingService: null, sourceFile: "april.csv", lines: null } as unknown as Match["order"],
  sale: { id: 152, soldOn: "2026-04-24" } as Match["sale"],
  ledger: { state: "unchanged", version: { analysed: "v", current: "v" },
    atAnalysis: { soldOn: { value: "2026-04-24", basis: "stored" }, itemsNet: { value: 30, basis: "derived" },
      shipping: { value: 5.49, basis: "derived" }, expectedTotal: { value: 35.49, basis: "derived" },
      pieces: { value: 3, basis: "derived" } } as unknown as NonNullable<Match["ledger"]>["atAnalysis"],
    current: { soldOn: "2026-04-24", itemsSubtotal: 30, discount: 0, itemsNet: 30, shipping: 5.49, refundsTotal: 0,
      cancelledOn: null, expectedTotal: 35.49, pieces: 3, externalOrderRef: "12-14520-00152", isTest: false } },
  findings,
});
const links = (html: string) => [...html.matchAll(/<a href="([^"]+)" data-orderbook-items=""/g)].map((m) => m[1]);
const render = (m: Match) => renderToStaticMarkup(createElement(MatchCard, { match: m, back: { sessionId: 12, view: "deviation" } }));

describe("Figuren / Stückzahl bearbeiten", () => {
  it("a count or figure difference: to the sale's positions, with the way back", () => {
    const html = render(match([finding({}), finding({ id: 2, key: "figure:3", field: "figure", shown: { ledger: null, external: "Fire Reactor (Crystal)" } })]));
    expect(links(html)).toEqual(["/business/orderbuch/verkauf/152?abgleich=12&amp;bestellung=191&amp;ansicht=abweichung#positionen"]);
    expect(html).toContain(de.business.reconciliation.reconcile.positions);
  });

  it("no figure or count difference: no such link — the edit dialog stays the way for date and values", () => {
    const html = render(match([finding({ id: 3, key: "sold_on", field: "sold_on", shown: { ledger: "2026-04-23", external: "2026-04-24" }, delta: 1 })]));
    expect(links(html)).toEqual([]);
    expect(html).toContain("data-orderbook=\"\"");
  });
});
