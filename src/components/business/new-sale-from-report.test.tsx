/** @vitest-environment jsdom */
/**
 * The EXISTING create dialog (`NewSale`), opened from the CSV reconciliation
 * (0184) — and unchanged without it.
 *
 *   from the report  channel eBay, date, order number, country, goods value
 *                    and shipping as starting values, every one editable;
 *                    buyer empty; the report's articles as orientation only;
 *                    "Bestand sofort reservieren" OFF; saved only on
 *                    "Anlegen", with the mode said (`hold: false`); back to
 *                    the reconciliation card; "Abbrechen" a plain link
 *   normal           no orientation, no switch, `hold: true`, to the ledger
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[], pushed: [] as string[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: (h: string) => { MOCK.pushed.push(h); }, refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/orderbook/sales-actions", () => ({
  createSaleWithDetails: async (input: Record<string, unknown>) => { MOCK.sent.push(input); return { ok: true, id: 412, refund: "none" }; },
}));

const { NewSale } = await import("./new-sale");
const { de } = await import("@/lib/i18n/de");
const { formatPrice } = await import("@/lib/format");
const t = de.business.sales.create.fromReport;

const FROM = {
  back: { sessionId: 12, matchId: 229, view: null }, orderRef: "06-14518-99785", soldAt: "2026-04-16", country: "DE",
  subtotal: 30.01, shipping: 5.49,
  lines: [{ name: "Cynder", quantity: 1, unitPrice: 0.95 }, { name: "Dino-Rang", quantity: 2, unitPrice: 2.32 }],
};

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => { MOCK.sent = []; MOCK.pushed = []; });
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); root = null; container = null; });

async function mount(props: Record<string, unknown>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(NewSale, props as never)); });
}
const inputs = () => [...document.querySelectorAll<HTMLInputElement>("form input")];
const byValue = (v: string) => inputs().find((i) => i.value === v);
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => { document.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("opened from the CSV reconciliation", () => {
  it("the report's values as starting values in the ordinary fields; buyer empty; channel eBay", async () => {
    await mount({ fromReport: FROM });
    expect(byValue("2026-04-16")?.type).toBe("date");
    expect(byValue("06-14518-99785")).toBeDefined();
    expect(byValue("DE")).toBeDefined();
    expect(byValue("30,01")).toBeDefined();
    expect(byValue("5,49")).toBeDefined();
    expect(document.querySelector<HTMLSelectElement>("form select")!.value).toBe("ebay");
    expect(document.querySelector("[data-from-report]")!.textContent).toContain(t.intro("06-14518-99785"));
  });

  it("the report's articles only as orientation — no figure is added to the sale", async () => {
    await mount({ fromReport: FROM });
    expect([...document.querySelectorAll("[data-report-lines] li")].map((l) => l.textContent))
      .toEqual([t.line(1, "Cynder", formatPrice(0.95)), t.line(2, "Dino-Rang", formatPrice(2.32))]);
    await submit();
    expect(MOCK.sent[0].items).toEqual([]);
  });

  it("'Bestand sofort reservieren' is OFF — saved with hold false; edited values are what is saved; back to the card", async () => {
    await mount({ fromReport: FROM });
    expect((document.querySelector("[data-hold]") as HTMLInputElement).checked).toBe(false);
    await type(byValue("30,01")!, "28,00");
    await type(byValue("06-14518-99785")!, "06-14518-99786");
    expect(MOCK.sent).toEqual([]); // nothing before "Anlegen"
    await submit();
    expect(MOCK.sent).toHaveLength(1);
    expect(MOCK.sent[0]).toMatchObject({ channel: "ebay", soldAt: "2026-04-16", reference: "06-14518-99786", country: "DE",
      buyer: null, subtotal: 28, shipping: 5.49, hold: false });
    expect(MOCK.pushed).toEqual(["/business/orderbuch/abgleich/12#recon-match-229"]);
  });

  it("the operator may switch reserving on: then hold true", async () => {
    await mount({ fromReport: FROM });
    await act(async () => { (document.querySelector("[data-hold]") as HTMLInputElement).click(); });
    await submit();
    expect(MOCK.sent[0].hold).toBe(true);
  });

  it("'Abbrechen' is a link back to the card — it writes nothing", async () => {
    await mount({ fromReport: FROM });
    const cancel = document.querySelector("[data-cancel-to-reconciliation]")!;
    expect(cancel.tagName).toBe("A");
    expect(cancel.getAttribute("href")).toBe("/business/orderbuch/abgleich/12#recon-match-229");
    expect(MOCK.sent).toEqual([]);
  });
});

describe("the normal create dialog stays as it was", () => {
  it("no orientation, no switch, empty fields but the country; saved with hold true; to the ledger", async () => {
    await mount({});
    expect(document.querySelector("[data-from-report]")).toBeNull();
    expect(document.querySelector("[data-hold]")).toBeNull();
    expect(document.querySelector("[data-cancel-to-reconciliation]")).toBeNull();
    await type(inputs().find((i) => i.type === "date")!, "2026-05-02");
    await submit();
    expect(MOCK.sent[0]).toMatchObject({ soldAt: "2026-05-02", reference: null, country: "DE", hold: true });
    expect(MOCK.pushed).toEqual(["/business/orderbuch/verkauf?verkauf=412"]);
  });
});
