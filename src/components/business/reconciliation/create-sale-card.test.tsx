/**
 * The card of an unmatched order (0184): "Externen Verkauf anlegen" opens the
 * EXISTING create dialog (`/verkauf/neu`) with the way back to this session
 * and card — no second editor on the card. A sale that carries the order's
 * number is linked instead; if that lookup did not run, nothing is offered.
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
const t = de.business.reconciliation.createSale;
type Match = import("@/lib/reconciliation/view").Match;

const unmatched = (over: Partial<Match> = {}): Match => ({
  id: 229, category: "external_only", certainty: null, score: null, dateDelta: null, competitors: [], reason: null,
  order: { id: 204, orderRef: "06-14518-99785", recordNo: 1556, soldOn: "2026-04-16", paidOn: "2026-04-16", shippedOn: "2026-04-16",
    itemsValue: 30.01, shipping: 5.49, total: 35.5, pieces: 7, combined: true, destinationCountry: "DE",
    shippingService: "Hermes Päckchen", sourceFile: "april.csv",
    lines: [{ lineRef: null, listingId: "1", title: "x", variant: null, name: "Cynder", quantity: 7, unitPrice: 1, value: 7 }] } as unknown as Match["order"],
  sale: null, ledger: null, findings: [], ...over,
} as Match);
const render = (m: Match) =>
  renderToStaticMarkup(createElement(MatchCard, { match: m, back: { sessionId: 12, view: null } }));

describe("an unmatched order on its card", () => {
  it("no sale with this number: a LINK into the existing create dialog, with the way back — no dialog of its own", () => {
    const html = render(unmatched({ createdSaleId: null }));
    expect(html).toContain(`href="/business/orderbuch/verkauf/neu?abgleich=12&amp;bestellung=229" data-create-sale=""`);
    expect(html).toContain(t.button);
    expect(html).not.toContain("<dialog");
  });

  it("a sale carries the number: linked — and not offered again", () => {
    const html = render(unmatched({ createdSaleId: 412 }));
    expect(html).not.toContain("data-create-sale");
    expect(html).toContain(t.onCard(412));
    expect(html).toContain('href="/business/orderbuch/verkauf/412" data-created-link=""');
  });

  it("the lookup did not run (fail closed): nothing offered", () => {
    expect(render(unmatched())).not.toContain("data-create-sale");
  });
});
