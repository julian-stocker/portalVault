/** @vitest-environment jsdom */
/**
 * "Fehlende Position ergänzen" with the REAL catalogue search (2026-11-09).
 *
 * The Staging test of sale 152 showed "Der Katalog konnte nicht geladen
 * werden." under the add search: the catalogue was loaded on focus only, but
 * an empty, not-yet-loaded catalogue disables the search field — and a
 * disabled field never gets focus. `sale-items-correction.test.tsx` mocks
 * the search away and could not see it; this file does not.
 *
 *   - the catalogue loads when the page shows an add search — no focus needed
 *   - the field is usable, Fire Reactor (Crystal) is found and picked
 *   - two picks, two saves: two added lines, each with the sale's NEW version
 *   - a failed load is ONE attempt (the message), not a loop
 *   - a read-only imported sale loads nothing
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: unknown[] };
const MOCK = vi.hoisted(() => ({ calls: [] as Call[], version: 1, loads: 0, fail: false }));
vi.mock("@/lib/orderbook/sales-actions", () => {
  const record = (fn: string) => async (...args: unknown[]) => {
    MOCK.calls.push({ fn, args });
    MOCK.version += 1;
    return { ok: true, sale: { sale: { updated_at: `v${MOCK.version}` }, items: null } };
  };
  return {
    correctLegacySaleItem: record("correctLegacySaleItem"), addLegacySaleItem: record("addLegacySaleItem"),
    removeLegacyAddedItem: record("removeLegacyAddedItem"),
    addSaleItem: record("addSaleItem"), removeSaleItem: record("removeSaleItem"), setSaleItemSky: record("setSaleItemSky"),
    announceSaleItemReturn: record("x"), bookSaleItem: record("x"), holdSaleItem: record("x"), receiveSaleItemReturn: record("x"),
    restockSaleItem: record("x"), shipSaleItem: record("x"), returnSaleItem: record("x"), setSaleItemNotShipped: record("x"),
    settleSaleItem: record("x"),
    loadOrderbookFigures: async () => {
      MOCK.loads += 1;
      if (MOCK.fail) throw new Error("network");
      return [
        { skyId: "SKY-0597", name: "Fire Reactor", series: "TT", marketPrice: null },
        { skyId: "SKY-0598", name: "Fire Reactor (Crystal)", series: "TT", marketPrice: null },
        { skyId: "SKY-0612", name: "Water Armor", series: "TT", marketPrice: null },
      ];
    },
    loadSaleItemCorrections: async () => [],
  };
});

const { SaleItems } = await import("./sale-items");
const { de } = await import("@/lib/i18n/de");
const search = de.business.orderbook.figures;

const workbook = (id: number, position: number, sky: string, name: string) => ({
  id, position, sky_id: sky, name, raw_name: name, series_code: "TT", market_price: null, source_row: 650 + position,
  legacy_stock_flag: "x", legacy_shipped_flag: "x", movement_id: null, return_movement_id: null, returned_at: null,
  return_announced_at: null, settled_at: null, not_shipped_at: null, held: false,
});
const ITEMS_152 = [workbook(518, 1, "SKY-0612", "Water Armor"), workbook(519, 2, "SKY-0590", "Dark Pyramid"),
  workbook(520, 3, "SKY-0597", "Fire Reactor")];

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => { MOCK.calls = []; MOCK.version = 1; MOCK.loads = 0; MOCK.fail = false; });
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); root = null; container = null; });

async function mount(props: Record<string, unknown> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(SaleItems, {
      saleId: 152, items: ITEMS_152, historical: true, frozen: true, internal: false, cancelled: false,
      correctable: true, updatedAt: "v1", corrections: [], ...props,
    } as never));
  });
}
const addBox = () => document.querySelector<HTMLElement>("[data-add-legacy]")!;
const field = () => addBox().querySelector<HTMLInputElement>('input[type="search"]')!;
async function type(text: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function pick(name: string) {
  const option = [...addBox().querySelectorAll<HTMLButtonElement>("li button")].find((b) => b.textContent?.includes(name));
  expect(option, `no result "${name}"`).toBeDefined();
  await act(async () => { option!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
}
const save = () => act(async () => { document.querySelector<HTMLElement>("[data-save-correction]")!.click(); });

describe("Fehlende Position ergänzen — the real catalogue search", () => {
  it("loads the catalogue on its own: no focus needed, the field is usable, no failure message", async () => {
    await mount();
    expect(MOCK.loads).toBe(1);
    expect(field().disabled).toBe(false);
    expect(addBox().textContent).not.toContain(search.noCatalog);
  });

  it("Fire Reactor (Crystal) found, picked, saved — twice: two added lines, each with the new version", async () => {
    await mount();
    for (let i = 0; i < 2; i += 1) {
      await type("Crystal");
      await pick("Fire Reactor (Crystal)");
      expect(MOCK.calls).toHaveLength(i); // only marked
      await save();
    }
    expect(MOCK.calls).toEqual([
      { fn: "addLegacySaleItem", args: [152, "SKY-0598", null, "v1"] },
      { fn: "addLegacySaleItem", args: [152, "SKY-0598", null, "v2"] },
    ]);
    expect(MOCK.loads).toBe(1);
  });

  it("a failed load is one attempt and says so — no loop", async () => {
    MOCK.fail = true;
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(MOCK.loads).toBe(1);
    expect(addBox().textContent).toContain(search.noCatalog);
  });

  it("an imported sale that is not correctable shows no search and loads nothing", async () => {
    await mount({ correctable: false });
    expect(document.querySelector("[data-add-legacy]")).toBeNull();
    expect(MOCK.loads).toBe(0);
  });
});
