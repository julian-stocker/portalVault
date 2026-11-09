/** @vitest-environment jsdom */
/**
 * The sale dialog, edited in place (2026-11-08).
 *
 *   one field, one place   every sale field appears once — as a value while
 *                          reading, as an input at the same spot while editing;
 *                          no second block below
 *   the flow               Bearbeiten → Speichern / Abbrechen in the header;
 *                          Abbrechen resets; Speichern sends exactly the typed
 *                          values, once, and returns to reading
 *   leaving                Schließen, Escape/backdrop and "Zurück zum Abgleich"
 *                          ask first while something typed would be lost
 *   from the reconciliation  opens in edit mode, the way back stays
 *
 * Plus the historical-date case: sale 64 on Staging, a frozen workbook row,
 * gets its day corrected by hand — and nothing else rides along.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CALLS = vi.hoisted(() => ({ meta: [] as unknown[][], other: [] as string[], pushed: [] as string[] }));
vi.mock("@/lib/orderbook/sales-actions", () => {
  const other = (name: string) => async () => { CALLS.other.push(name); return { ok: true }; };
  return {
    updateSaleMeta: async (...args: unknown[]) => { CALLS.meta.push(args); return { ok: true }; },
    loadSaleAudit: async () => [],
    addSaleFee: other("addSaleFee"), addSaleRefund: other("addSaleRefund"),
    removeSaleFee: other("removeSaleFee"), removeSaleRefund: other("removeSaleRefund"),
    shipSale: other("shipSale"), swapSaleDailyIndex: other("swapSaleDailyIndex"),
    updateSaleFee: other("updateSaleFee"),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: (href: string) => { CALLS.pushed.push(href); } }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const { SaleDetails } = await import("./sale-details");
const { de } = await import("@/lib/i18n/de");
const modal = de.business.sales.detailsModal;
const columns = de.business.sales.columns;
const BACK = "/business/orderbuch/abgleich/5#recon-match-50";

/* Sale 64 on Staging, as the list hands it over: a frozen workbook row. */
const SALE_64 = {
  id: 64, channel: "ebay", source: "excel_order_2026", orderId: null, orderNumber: null,
  soldAt: "2026-02-17", dailyIndex: 5, stockReleasedAt: null, shippedAt: null, cancelledAt: null,
  country: "DE", buyerRef: "buyer-x", buyerLabel: "buyer-x", buyerRepeat: false,
  externalOrderRef: "06-14260-71832", note: "checked", updatedAt: "2026-11-08T12:27:20.815543+00:00",
  itemsSubtotal: 0, shippingCharged: 0, discountAmount: 0, refunded: 70.29, expectedPayout: 0,
  fulfillmentStatus: null, matchItems: [],
};
const DETAIL = { sale: { source: "excel_order_2026" }, fees: [], refunds: [], adjustments: [] };

let root: Root | null = null;
let container: HTMLElement | null = null;
let saved = 0;
let closed = 0;

beforeEach(() => { CALLS.meta = []; CALLS.other = []; CALLS.pushed = []; saved = 0; closed = 0; });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
});

const props = (sale: Record<string, unknown>, returnHref: string | null) => ({
  sale: sale as never, detail: DETAIL, open: true, returnHref,
  onClose: () => { closed += 1; }, onSaved: () => { saved += 1; },
});
async function open(returnHref: string | null = null, sale: Record<string, unknown> = SALE_64) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(SaleDetails, props(sale, returnHref))); });
}
/* The list refreshes after a save: the same dialog, the sale as stored now. */
async function refresh(sale: Record<string, unknown>, returnHref: string | null = null) {
  await act(async () => { root!.render(createElement(SaleDetails, props(sale, returnHref))); });
}
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const click = (el: HTMLElement | null | undefined) => act(async () => { el!.click(); });
const dateInput = () => document.querySelector<HTMLInputElement>('input[type="date"]');
/* The "Verkauf" section's text — values and labels as a reader sees them. */
const saleSection = () => document.querySelector("section")!;
const count = (text: string) => (saleSection().textContent ?? "").split(text).length - 1;
const labelled = (label: string) =>
  [...saleSection().querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent === label)
    ?.querySelector("input") as HTMLInputElement | undefined;

/* React listens for `input` on a controlled field; set the value the way a browser does. */
async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("one field, one place", () => {
  it("reading: each value once, no inputs", async () => {
    await open();
    expect(saleSection().querySelectorAll("input")).toHaveLength(0);
    for (const label of [columns.date, columns.country, modal.buyer, modal.reference, de.business.sales.note]) {
      expect(count(label), label).toBe(1);
    }
    expect(count("06-14260-71832")).toBe(1);
    expect(count("17.02.2026")).toBe(1);
  });

  it("editing: the same labels once each, now as inputs at their place — no second block, no stray value", async () => {
    await open();
    await click(button(modal.edit));
    for (const label of [columns.date, columns.country, modal.buyer, modal.reference, de.business.sales.note]) {
      expect(count(label), label).toBe(1);
      expect(labelled(label), label).toBeDefined();
    }
    expect(count("17.02.2026")).toBe(0);
    expect(labelled(columns.date)!.value).toBe("2026-02-17");
    expect(labelled(modal.reference)!.value).toBe("06-14260-71832");
    // The order stays: date before country before buyer before reference before note.
    const order = [...saleSection().querySelectorAll("label > span:first-child")].map((s) => s.textContent);
    expect(order).toEqual([columns.date, columns.country, modal.buyer, modal.reference, de.business.sales.note]);
  });

  it("what is not editable stays text: channel, place of the day, shipping state", async () => {
    await open();
    await click(button(modal.edit));
    expect(count(modal.channel)).toBe(1);
    expect(count(modal.dailyIndex)).toBe(1);
    expect(count(modal.shippingState)).toBe(1);
    expect(saleSection().querySelectorAll("input")).toHaveLength(5);
  });

  it("an internal sale (Commerce owns it) offers no Bearbeiten", async () => {
    await open(null, { ...SALE_64, orderId: 9, source: "manual" });
    expect(button(modal.edit)).toBeUndefined();
  });
});

describe("Bearbeiten → Speichern / Abbrechen", () => {
  it("the header switches: Bearbeiten while reading; Speichern and Abbrechen while editing — no 'Fertig'", async () => {
    await open();
    expect(button(modal.edit)).toBeDefined();
    expect(button(modal.save)).toBeUndefined();
    await click(button(modal.edit));
    expect(button(modal.save)).toBeDefined();
    expect(button(modal.cancel)).toBeDefined();
    expect(button(modal.edit)).toBeUndefined();
    expect(button(modal.done)).toBeUndefined();
  });

  it("nothing is written by opening, editing or typing", async () => {
    await open();
    await click(button(modal.edit));
    await type(dateInput()!, "2026-02-18");
    expect(CALLS.meta).toEqual([]);
    expect(saved).toBe(0);
  });

  it("Speichern sends exactly the typed values, once, with the opened token — and returns to reading", async () => {
    await open();
    await click(button(modal.edit));
    await type(dateInput()!, "2026-02-18");
    await type(labelled(modal.reference)!, "06-14260-71832-B");
    await click(button(modal.save));
    expect(CALLS.meta).toHaveLength(1);
    const [id, fields, token] = CALLS.meta[0] as [number, Record<string, unknown>, string];
    expect(id).toBe(64);
    expect(fields).toEqual({ soldAt: "2026-02-18", country: "DE", buyerRef: "buyer-x", externalRef: "06-14260-71832-B", note: "checked" });
    expect(token).toBe("2026-11-08T12:27:20.815543+00:00");
    expect(saved).toBe(1);
    expect(dateInput()).toBeNull();
  });

  it("after the refresh the new value stands at the same place", async () => {
    await open();
    await click(button(modal.edit));
    await type(dateInput()!, "2026-02-18");
    await click(button(modal.save));
    await refresh({ ...SALE_64, soldAt: "2026-02-18", updatedAt: "2026-11-08T19:00:00+00:00" });
    expect(count("18.02.2026")).toBe(1);
    expect(count("17.02.2026")).toBe(0);
  });

  it("an unchanged day is not sent at all", async () => {
    await open();
    await click(button(modal.edit));
    await click(button(modal.save));
    expect(CALLS.meta).toHaveLength(1);
    expect("soldAt" in (CALLS.meta[0][1] as object)).toBe(false);
  });

  it("Abbrechen discards: back to reading, nothing written, and the next Bearbeiten starts from the stored sale", async () => {
    await open();
    await click(button(modal.edit));
    await type(dateInput()!, "2026-02-18");
    await type(labelled(modal.buyer)!, "someone-else");
    await click(button(modal.cancel));
    expect(dateInput()).toBeNull();
    expect(count("17.02.2026")).toBe(1);
    expect(CALLS.meta).toEqual([]);
    await click(button(modal.edit));
    expect(dateInput()!.value).toBe("2026-02-17");
    expect(labelled(modal.buyer)!.value).toBe("buyer-x");
  });

  it("no money, refund, fee, stock or shipping action rides along a save", async () => {
    await open();
    await click(button(modal.edit));
    await type(dateInput()!, "2026-02-18");
    await click(button(modal.save));
    expect(CALLS.other).toEqual([]);
  });
});

describe("leaving with unsaved input", () => {
  it("typed but not saved is said", async () => {
    await open();
    await click(button(modal.edit));
    expect(document.querySelector("[data-unsaved]")).toBeNull();
    await type(dateInput()!, "2026-02-18");
    expect(document.querySelector("[data-unsaved]")?.textContent).toBe(modal.unsaved);
  });

  it("Schließen warns instead of dropping; 'Weiter bearbeiten' keeps the input", async () => {
    await open();
    await click(button(modal.edit));
    await type(dateInput()!, "2026-02-18");
    await click(button(modal.close));
    expect(closed).toBe(0);
    expect(document.querySelector("[data-leave-warning]")?.textContent).toContain(modal.unsavedLeave);
    await click(button(modal.keepEditing));
    expect(document.querySelector("[data-leave-warning]")).toBeNull();
    expect(dateInput()!.value).toBe("2026-02-18");
    expect(closed).toBe(0);
  });

  it("'Verwerfen und schließen' closes — without writing", async () => {
    await open();
    await click(button(modal.edit));
    await type(dateInput()!, "2026-02-18");
    await click(button(modal.close));
    await click(button(modal.discardClose));
    expect(closed).toBe(1);
    expect(CALLS.meta).toEqual([]);
  });

  it("Escape (the modal's own close) asks the same", async () => {
    await open();
    await click(button(modal.edit));
    await type(dateInput()!, "2026-02-18");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(closed).toBe(0);
    expect(document.querySelector("[data-leave-warning]")).not.toBeNull();
  });

  it("without changes Schließen just closes, in both modes", async () => {
    await open();
    await click(button(modal.close));
    expect(closed).toBe(1);
    await click(button(modal.edit));
    await click(button(modal.close));
    expect(closed).toBe(2);
  });

  it("a fee typed but not added counts as unsaved too", async () => {
    await open();
    await click(button(modal.edit));
    const amount = document.querySelector<HTMLInputElement>(`input[aria-label="${modal.amount}"]`)!;
    await type(amount, "1,50");
    await click(button(modal.close));
    expect(closed).toBe(0);
    expect(document.querySelector("[data-leave-warning]")).not.toBeNull();
  });
});

describe("from the reconciliation", () => {
  it("opens in edit mode at once — still nothing written until Speichern", async () => {
    await open(BACK);
    expect(dateInput()?.value).toBe("2026-02-17");
    expect(button(modal.save)).toBeDefined();
    expect(CALLS.meta).toEqual([]);
  });

  it("opened normally from the Orderbuch, the dialog starts as a reading view — as before", async () => {
    await open(null);
    expect(dateInput()).toBeNull();
    expect(document.querySelector("a[data-return-to-reconciliation]")).toBeNull();
  });

  it("the way back stays after saving, and leads to the session and order", async () => {
    await open(BACK);
    await type(dateInput()!, "2026-02-18");
    await click(button(modal.save));
    await refresh({ ...SALE_64, soldAt: "2026-02-18" }, BACK);
    const back = document.querySelector<HTMLAnchorElement>("a[data-return-to-reconciliation]");
    expect(back?.getAttribute("href")).toBe(BACK);
  });

  it("with unsaved input the way back asks first; 'Verwerfen und zurück' then goes there", async () => {
    await open(BACK);
    await type(dateInput()!, "2026-02-18");
    const back = document.querySelector<HTMLAnchorElement>("a[data-return-to-reconciliation]")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => { back.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(CALLS.pushed).toEqual([]);
    await click(button(modal.discardBack));
    expect(CALLS.pushed).toEqual([BACK]);
    expect(CALLS.meta).toEqual([]);
  });

  it("without changes the way back is a plain link", async () => {
    await open(BACK);
    const back = document.querySelector<HTMLAnchorElement>("a[data-return-to-reconciliation]")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    back.addEventListener("click", (e) => e.preventDefault()); // keep jsdom from navigating
    await act(async () => { back.dispatchEvent(event); });
    expect(document.querySelector("[data-leave-warning]")).toBeNull();
  });
});

describe("Positionen bearbeiten (2026-11-08)", () => {
  const ITEMS = "/business/orderbuch/verkauf/64?zurueck=%2Fbusiness%2Forderbuch%2Fverkauf#positionen";
  async function openWith(itemsHref: string | null, returnHref: string | null = null) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root!.render(createElement(SaleDetails, { ...props(SALE_64, returnHref), itemsHref })); });
  }

  it("the dialog names the way to the positions — the figures are kept there, not here", async () => {
    await openWith(ITEMS);
    expect(document.querySelector("a[data-items-link]")?.getAttribute("href")).toBe(ITEMS);
    expect(document.querySelector("a[data-items-link]")?.textContent).toBe(de.business.sales.correction.itemsLink);
  });

  it("not for an internal sale (Commerce owns its lines)", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root!.render(createElement(SaleDetails, { ...props({ ...SALE_64, orderId: 9 }, null), itemsHref: ITEMS })); });
    expect(document.querySelector("a[data-items-link]")).toBeNull();
  });

  it("with unsaved input it asks first, then goes", async () => {
    await openWith(ITEMS, BACK);
    await type(dateInput()!, "2026-02-18");
    const link = document.querySelector<HTMLAnchorElement>("a[data-items-link]")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => { link.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await click(button(modal.discardItems));
    expect(CALLS.pushed).toEqual([ITEMS]);
    expect(CALLS.meta).toEqual([]);
  });
});
