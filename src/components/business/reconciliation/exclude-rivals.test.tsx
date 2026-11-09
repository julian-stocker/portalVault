/** @vitest-environment jsdom */
/**
 * The two order-number acts of a card (2026-11-09, 0186, ADR-0183):
 *
 *   - "Bestellnummer übernehmen" without rivals: one explicit check, then only
 *     the card goes to the server — the finding is read from the stored session
 *   - with rivals (155/157 against 158/160): every rival listed on its own,
 *     each to be ticked, a reason required; sent with the version seen
 *   - a rival without a known version can never be confirmed
 *   - a closed session without rivals: nothing to press, the reason instead
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ confirmed: [] as unknown[][], taken: [] as unknown[][], refreshed: 0,
  answer: { ok: true, status: "assigned", saleId: 157 } as Record<string, unknown> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => { MOCK.refreshed += 1; }, push: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/reconciliation/server/actions", () => ({
  confirmReconciliation: async () => ({ ok: true }),
  takeOrderNumber: async (...args: unknown[]) => { MOCK.taken.push(args); return { ok: true, applied: 1, sales: 1 }; },
}));
vi.mock("@/lib/reconciliation/server/candidate-actions", () => ({
  assignSaleToReport: async () => ({ ok: true }), searchCandidates: async () => ({ ok: true, candidates: [], capped: false }),
  confirmWithExclusions: async (...args: unknown[]) => { MOCK.confirmed.push(args); return MOCK.answer; },
}));

const { ExcludeRivals, TakeOrderNumber } = await import("./candidate-actions");
const { ReconcileProvider } = await import("./reconcile-context");
const { de } = await import("@/lib/i18n/de");
const t = de.business.reconciliation.candidates;

const BACK = { sessionId: 12, matchId: 191, view: null };
const R158 = { saleId: 158, soldOn: "2026-05-01", shared: ["Dino Rang"], pieces: ["Eruptor", "Trigger Happy", "Drobot", "Dino Rang"], updatedAt: "v158" };
const R160 = { saleId: 160, soldOn: "2026-05-01", shared: ["Camo"], pieces: ["Camo", "Bash"], updatedAt: "v160" };
const RIVAL_ORDER = { orderId: 77, orderRef: "01-0000-0001", soldOn: "2026-05-01", shared: ["Camo"] };

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => { MOCK.confirmed = []; MOCK.taken = []; MOCK.refreshed = 0; MOCK.answer = { ok: true, status: "assigned", saleId: 157 }; });
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); root = null; container = null; });
async function mount(el: ReturnType<typeof createElement>, sessionOpen = true) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(ReconcileProvider, { sessionId: 12, sessionOpen, applyReleased: true } as never, el)); });
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const go = () => q("[data-exclude-go]") as HTMLButtonElement;
async function typeNote(text: string) {
  const area = q("[data-exclude-note]") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { setter.call(area, text); area.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("Zuordnung trotz Konkurrenz — sale 157 against 158 and 160", () => {
  const el = (over: Record<string, unknown> = {}) => createElement(ExcludeRivals,
    { back: BACK, saleId: 157, version: "v157", orderRef: "12-14570-08869", rivals: [R158, R160], rivalOrders: [RIVAL_ORDER], ...over });

  it("each rival on its own line; only all ticked AND a reason open the button; sends every rival with its version", async () => {
    await mount(el());
    await act(async () => { q('[data-exclude-open="157"]')!.click(); });
    expect(q("[data-exclude-what]")!.textContent).toBe(t.exclude.what("12-14570-08869", 157));
    expect(q('[data-exclude-sale="158"]')).not.toBeNull();
    expect(q('[data-exclude-sale="160"]')).not.toBeNull();
    expect(q('[data-exclude-order="77"]')).not.toBeNull();
    expect(go().disabled).toBe(true);
    await act(async () => { q('[data-exclude-sale="158"]')!.click(); q('[data-exclude-sale="160"]')!.click(); });
    expect(go().disabled).toBe(true); // the rival order is still unticked
    await act(async () => { q('[data-exclude-order="77"]')!.click(); });
    expect(go().disabled).toBe(true); // no reason yet
    await typeNote("   ");
    expect(go().disabled).toBe(true); // blanks are no reason
    await typeNote("158 und 160 sind Mai-Verkäufe");
    expect(go().disabled).toBe(false);
    await act(async () => { go().click(); });
    expect(MOCK.confirmed).toEqual([[12, 191, 157, "v157",
      { sales: [{ id: 158, updatedAt: "v158" }, { id: 160, updatedAt: "v160" }], orders: [{ id: 77 }] }, "158 und 160 sind Mai-Verkäufe"]]);
    expect(MOCK.refreshed).toBe(1);
  });

  it("un-ticking one rival closes the button again", async () => {
    await mount(el({ rivalOrders: [] }));
    await act(async () => { q('[data-exclude-open="157"]')!.click(); });
    await act(async () => { q('[data-exclude-sale="158"]')!.click(); q('[data-exclude-sale="160"]')!.click(); });
    await typeNote("geprüft");
    expect(go().disabled).toBe(false);
    await act(async () => { q('[data-exclude-sale="160"]')!.click(); });
    expect(go().disabled).toBe(true);
  });

  it("a rival whose version is unknown can never be confirmed", async () => {
    await mount(el({ rivals: [R158, { ...R160, updatedAt: null }], rivalOrders: [] }));
    await act(async () => { q('[data-exclude-open="157"]')!.click(); });
    await act(async () => { q('[data-exclude-sale="158"]')!.click(); q('[data-exclude-sale="160"]')!.click(); });
    await typeNote("geprüft");
    expect(go().disabled).toBe(true);
  });

  it("changed rivals: the refusal is said, nothing is refreshed", async () => {
    MOCK.answer = { ok: false, message: t.exclude.errors.rivals_changed };
    await mount(el({ rivalOrders: [] }));
    await act(async () => { q('[data-exclude-open="157"]')!.click(); });
    await act(async () => { q('[data-exclude-sale="158"]')!.click(); q('[data-exclude-sale="160"]')!.click(); });
    await typeNote("geprüft");
    await act(async () => { go().click(); });
    expect(q('[role="alert"]')!.textContent).toBe(t.exclude.errors.rivals_changed);
    expect(MOCK.refreshed).toBe(0);
  });
});

describe("Bestellnummer übernehmen — a certain pair without number", () => {
  const el = (over: Record<string, unknown> = {}) => createElement(TakeOrderNumber,
    { back: BACK, saleId: 381, version: "v381", orderRef: "06-14518-99785", rivals: [], rivalOrders: [], ...over });

  it("no rivals: one explicit check, then ONLY the card is sent — session and card, nothing else", async () => {
    await mount(el());
    await act(async () => { q('[data-take-number="381"]')!.click(); });
    expect((q("[data-take-go]") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { q("[data-take-check]")!.click(); });
    await act(async () => { q("[data-take-go]")!.click(); });
    expect(MOCK.taken).toEqual([[12, 191]]);
    expect(q('[role="status"]')!.textContent).toBe(t.takeNumber.done);
    expect(MOCK.confirmed).toEqual([]);
  });

  it("with rivals: the plain take-over is not offered — the exclusion of each rival instead", async () => {
    await mount(el({ saleId: 155, rivals: [R158] }));
    expect(q("[data-take-number]")).toBeNull();
    expect(q('[data-exclude-open="155"]')).not.toBeNull();
  });

  it("a closed session without rivals: nothing to press, the reason instead", async () => {
    await mount(el(), false);
    expect(q("[data-take-number]")).toBeNull();
    expect(q("[data-take-closed]")!.textContent).toBe(t.takeNumber.closedNoRivals);
  });
});
