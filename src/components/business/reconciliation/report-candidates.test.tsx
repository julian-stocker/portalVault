/** @vitest-environment jsdom */
/**
 * The candidates on the card of an unmatched order (ADR-0182, 0185):
 *
 *   - each candidate compared feature by feature, with the score as a recommendation
 *   - "Diesem Verkauf zuordnen" only after the explicit check; it sends the
 *     card, the sale and the version read — nothing else
 *   - with rivals: no button, the reason instead (0180's rule, unchanged)
 *   - after the assignment: the sale that carries the number, compared again
 *   - the search: a chosen period, the shown three left out
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ assigned: [] as unknown[][], searched: [] as unknown[][], refreshed: 0,
  answer: { ok: true, status: "assigned", saleId: 381 } as Record<string, unknown>, found: [] as unknown[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => { MOCK.refreshed += 1; }, push: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/reconciliation/server/actions", () => ({ confirmReconciliation: async () => ({ ok: true }) }));
vi.mock("@/lib/reconciliation/server/candidate-actions", () => ({
  assignSaleToReport: async (...args: unknown[]) => { MOCK.assigned.push(args); return MOCK.answer; },
  searchCandidates: async (...args: unknown[]) => { MOCK.searched.push(args); return { ok: true, candidates: MOCK.found, capped: false }; },
}));

const { MatchCard } = await import("./match-comparison");
const { AssignSale, CandidateSearch } = await import("./candidate-actions");
const { de } = await import("@/lib/i18n/de");
const t = de.business.reconciliation.candidates;
type Match = import("@/lib/reconciliation/view").Match;
type C = import("@/lib/reconciliation/candidates").CandidateExplanation;

const cand = (saleId: number, over: Partial<C> = {}): C => ({
  saleId, score: 105, analysisCandidate: true,
  figures: { matched: 1, reportPieces: 1, ledgerPieces: 1,
    rows: [{ report: "Cynder", ledger: "Cynder", skyId: "SKY-0150", tier: "exact", seriesHint: null, similarTo: null }] },
  goods: { report: 30.01, ledgerGross: 31.36, discount: 1.35, ledgerNet: 30.01, netEqual: true, grossEqual: false },
  shipping: { report: 5.49, ledger: 5.49, equal: true }, date: { report: "2026-04-16", ledger: "2026-04-16", delta: 0 },
  orderRef: null, rivals: [], rivalOrders: [], updatedAt: "2026-11-09T11:23:29Z", ...over,
});
const unmatched = (over: Partial<Match>): Match => ({
  id: 229, category: "external_only", certainty: null, score: null, dateDelta: null, competitors: [], reason: null,
  order: { id: 204, orderRef: "06-14518-99785", soldOn: "2026-04-16", paidOn: null, shippedOn: null, itemsValue: 30.01, shipping: 5.49,
    total: 35.5, pieces: 1, combined: false, destinationCountry: "DE", shippingService: null, sourceFile: "a.csv",
    lines: [{ lineRef: null, listingId: "1", title: "Giants [Cynder]", variant: null, name: "Cynder", quantity: 1, unitPrice: 30.01, value: 30.01 }] } as unknown as Match["order"],
  sale: null, ledger: null, findings: [], createdSaleId: null, ...over,
} as Match);
const BACK = { sessionId: 12, matchId: 229, view: null };

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => { MOCK.assigned = []; MOCK.searched = []; MOCK.refreshed = 0; MOCK.found = []; MOCK.answer = { ok: true, status: "assigned", saleId: 381 }; });
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); root = null; container = null; });
async function mount(el: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(el); });
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel);

describe("the card", () => {
  const html = (m: Match) => renderToStaticMarkup(createElement(MatchCard, { match: m, back: { sessionId: 12, view: null } }));

  it("candidates: compared feature by feature, the score a recommendation, a link to the sale, the assign button", () => {
    const out = html(unmatched({ candidates: { shown: [cand(381)], more: 2 } }));
    expect(out).toContain('data-candidate="381"');
    expect(out).toContain(t.score(105));
    expect(out).toContain(t.hint);
    expect(out).toContain('href="/business/orderbuch/verkauf/381?abgleich=12&amp;bestellung=229#positionen" data-candidate-link=""');
    expect(out).toContain('data-assign="381"');
    expect(out).toContain(t.more(2));
    // the creation stays possible — a candidate is not an identity
    expect(out).toContain("data-create-sale");
  });

  it("with rivals: not the plain assignment — the exclusion of each rival (0186) instead", () => {
    const out = html(unmatched({ candidates: { shown: [cand(381, { rivals: [{ saleId: 400, soldOn: "2026-04-17", shared: ["Cynder"], pieces: ["Cynder"], updatedAt: "v4" }] })], more: 0 } }));
    expect(out).not.toContain("data-assign=");
    expect(out).toContain('data-exclude-open="381"');
  });

  it("after the assignment: the sale with the number, compared again — no candidates any more", () => {
    const out = html(unmatched({ createdSaleId: 381, linkedComparison: cand(381, { orderRef: "06-14518-99785", shipping: { report: 5.49, ledger: 4.99, equal: false } }) }));
    expect(out).toContain("data-linked-comparison");
    expect(out).toContain(t.linkedTitle(381));
    expect(out).not.toContain("data-candidates");
    expect(out).not.toContain("data-assign=");
  });

  it("hints are shown, not scored: another series, a similar name", () => {
    const c = cand(410, { figures: { matched: 1, reportPieces: 2, ledgerPieces: 1, rows: [
      { report: "Cynder", ledger: "Cynder", skyId: "SKY-0020", tier: "exact", seriesHint: { listing: "G", ledger: "SA" }, similarTo: null },
      { report: "Zap", ledger: null, skyId: null, tier: null, seriesHint: null, similarTo: "Zapper" }] } });
    const out = html(unmatched({ candidates: { shown: [c], more: 0 } }));
    expect(out).toContain(t.seriesHint("G", "SA"));
    expect(out).toContain(t.similar("Zapper"));
    expect(out).toContain(t.onlyReport);
  });
});

describe("Diesem Verkauf zuordnen — only after the explicit check", () => {
  it("confirm panel; disabled without the check; sends card, sale and version; refreshes", async () => {
    await mount(createElement(AssignSale, { c: cand(381), orderRef: "06-14518-99785", back: BACK }));
    await act(async () => { q('[data-assign="381"]')!.click(); });
    expect(q("[data-assign-confirm]")!.textContent).toContain(t.assignWhat);
    expect((q("[data-assign-go]") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { q("[data-assign-check]")!.click(); });
    await act(async () => { q("[data-assign-go]")!.click(); });
    expect(MOCK.assigned).toEqual([[12, 229, 381, "2026-11-09T11:23:29Z"]]);
    expect(q('[role="status"]')!.textContent).toBe(t.assigned(381));
    expect(MOCK.refreshed).toBe(1);
  });

  it("a refusal is said; 'Abbrechen' sends nothing", async () => {
    MOCK.answer = { ok: false, message: t.assignErrors.stale };
    await mount(createElement(AssignSale, { c: cand(381), orderRef: "06-14518-99785", back: BACK }));
    await act(async () => { q('[data-assign="381"]')!.click(); });
    await act(async () => { q("[data-assign-check]")!.click(); });
    await act(async () => { q("[data-assign-go]")!.click(); });
    expect(q('[role="alert"]')!.textContent).toBe(t.assignErrors.stale);
    expect(MOCK.refreshed).toBe(0);
  });

  it("a sale that already carries the number offers nothing to do", async () => {
    await mount(createElement(AssignSale, { c: cand(381, { orderRef: "06-14518-99785" }), orderRef: "06-14518-99785", back: BACK }));
    expect(q("[data-assign]")).toBeNull();
    expect(document.body.textContent).toContain(t.assignBlockedRef);
  });
});

describe("Weitere Verkäufe suchen", () => {
  it("searches the chosen period for this card and leaves out the three already shown", async () => {
    MOCK.found = [cand(381), cand(500, { score: 40 })];
    await mount(createElement(CandidateSearch, { orderRef: "06-14518-99785", soldOn: "2026-04-16", back: BACK, exclude: [381] }));
    await act(async () => { q("[data-search-go]")!.click(); });
    expect(MOCK.searched).toEqual([[12, 229, "2026-03-17", "2026-05-16"]]);
    expect([...document.querySelectorAll("[data-candidate]")].map((e) => e.getAttribute("data-candidate"))).toEqual(["500"]);
  });
});
