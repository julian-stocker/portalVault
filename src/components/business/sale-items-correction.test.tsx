/** @vitest-environment jsdom */
/**
 * The positions of an imported workbook sale, corrected by hand (0181) — in
 * the existing position list, not a second editor.
 *
 *   - "Figur korrigieren" and "Fehlende Position ergänzen" only MARK; only
 *     "Speichern" calls the database, with the sale's version; "Abbrechen"
 *     sends nothing
 *   - the version moves on with every save (the next call carries the new one)
 *   - "Entfernen" only for a line a correction added — never a workbook line
 *   - a corrected line names what the workbook said; an added one says so
 *   - a normal sale keeps the normal actions; an imported one never calls them
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: unknown[] };
const MOCK = vi.hoisted(() => ({ calls: [] as Call[], version: 1, corrections: [] as unknown[] }));
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
    loadOrderbookFigures: async () => [],
    loadSaleItemCorrections: async () => MOCK.corrections,
  };
});
/* The search, reduced to what it hands back: one pick, one typed name. */
vi.mock("./figure-search", () => ({
  FigureSearch: ({ onSelect, onFree, label }: { onSelect: (c: unknown) => void; onFree?: (n: string) => void; label?: string }) =>
    createElement("div", { "data-search": label ?? "add" },
      createElement("button", { type: "button", "data-pick": "", onClick: () => onSelect({ skyId: "SKY-0598", name: "Fire Reactor (Crystal)" }) }, "pick"),
      onFree ? createElement("button", { type: "button", "data-free": "", onClick: () => onFree("Portal 84148790") }, "free") : null),
}));

const { SaleItems } = await import("./sale-items");
const { de } = await import("@/lib/i18n/de");
const t = de.business.sales.correction;

const workbook = (id: number, position: number, sky: string, name: string) => ({
  id, position, sky_id: sky, name, raw_name: name, series_code: "TT", market_price: null, source_row: 650 + position,
  legacy_stock_flag: "x", legacy_shipped_flag: "x", movement_id: null, return_movement_id: null, returned_at: null,
  return_announced_at: null, settled_at: null, not_shipped_at: null, held: false,
});
const ITEMS_152 = [workbook(518, 1, "SKY-0612", "Water Armor"), workbook(519, 2, "SKY-0590", "Dark Pyramid"),
  workbook(520, 3, "SKY-0597", "Fire Reactor")];
const ADDED = { ...workbook(530, 4, "SKY-0598", "Fire Reactor (Crystal)"), source_row: null, legacy_stock_flag: null,
  legacy_shipped_flag: null, raw_name: null };

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => { MOCK.calls = []; MOCK.version = 1; MOCK.corrections = []; });
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); root = null; container = null; });

async function mount(props: Record<string, unknown>) {
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
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T & HTMLElement>(sel);
const click = (el: HTMLElement | null) => act(async () => { el!.click(); });

describe("an imported sale: correct, add, remove — only with Speichern", () => {
  it("'Figur korrigieren' on a workbook line; the pick is only marked; Speichern writes it with the version", async () => {
    await mount({});
    expect(document.querySelectorAll("[data-correct-item]")).toHaveLength(3);
    await click(q('[data-correct-item="520"]'));
    await click(q("[data-search] [data-pick]"));
    expect(MOCK.calls).toEqual([]);
    expect(q("[data-pending-correction]")?.textContent).toContain(t.replace(3, "Fire Reactor", "Fire Reactor (Crystal)"));
    await click(q("[data-save-correction]"));
    expect(MOCK.calls).toEqual([{ fn: "correctLegacySaleItem", args: [520, "SKY-0598", 152, "v1"] }]);
    expect(q("[data-pending-correction]")).toBeNull();
  });

  it("'Abbrechen' sends nothing", async () => {
    await mount({});
    await click(q('[data-correct-item="520"]'));
    await click(q("[data-search] [data-pick]"));
    await click(q("[data-cancel-correction]"));
    expect(MOCK.calls).toEqual([]);
    expect(q("[data-pending-correction]")).toBeNull();
  });

  it("a missing line: picked or typed, marked, then added — each save carries the NEW version", async () => {
    await mount({});
    const add = q("[data-add-legacy]")!;
    expect(add.textContent).toContain(t.addHint);
    await click(add.querySelector<HTMLElement>("[data-pick]"));
    expect(MOCK.calls).toEqual([]);
    await click(q("[data-save-correction]"));
    await click(add.querySelector<HTMLElement>("[data-free]"));
    await click(q("[data-save-correction]"));
    expect(MOCK.calls).toEqual([
      { fn: "addLegacySaleItem", args: [152, "SKY-0598", null, "v1"] },
      { fn: "addLegacySaleItem", args: [152, null, "Portal 84148790", "v2"] },
    ]);
  });

  it("'Entfernen' only for a line a correction added; marked first, then removed", async () => {
    await mount({ items: [...ITEMS_152, ADDED] });
    expect([...document.querySelectorAll("[data-remove-added]")].map((b) => b.getAttribute("data-remove-added"))).toEqual(["530"]);
    await click(q('[data-remove-added="530"]'));
    expect(MOCK.calls).toEqual([]);
    await click(q("[data-save-correction]"));
    expect(MOCK.calls).toEqual([{ fn: "removeLegacyAddedItem", args: [530, 152, "v1"] }]);
  });

  it("a line with an operation on it offers no correction", async () => {
    await mount({ items: [{ ...ITEMS_152[0], settled_at: "2026-05-01" }, { ...ITEMS_152[1], held: true }, ITEMS_152[2]] });
    expect([...document.querySelectorAll("[data-correct-item]")].map((b) => b.getAttribute("data-correct-item"))).toEqual(["520"]);
  });

  it("the origin stays visible: what the workbook said, and what was added", async () => {
    await mount({
      items: [ITEMS_152[0], ITEMS_152[1], { ...ITEMS_152[2], sky_id: "SKY-0598", name: "Fire Reactor (Crystal)" }, ADDED],
      corrections: [
        { id: 1, saleItemId: 520, action: "replace", position: 3, sourceRow: 653, oldSkyId: "SKY-0597", oldRawName: "Fire Reactor",
          newSkyId: "SKY-0598", newRawName: "Fire Reactor", correctedAt: "x" },
        { id: 2, saleItemId: 530, action: "add", position: 4, sourceRow: null, oldSkyId: null, oldRawName: null,
          newSkyId: "SKY-0598", newRawName: null, correctedAt: "x" },
      ],
    });
    expect(q("[data-corrected]")?.textContent).toBe(t.corrected("Fire Reactor (SKY-0597)"));
    expect(q("[data-added]")?.textContent).toBe(t.added);
  });
});

describe("the other sales keep their rules", () => {
  it("an imported sale that is not correctable (cancelled, internal): read-only, as before", async () => {
    await mount({ correctable: false });
    expect(document.querySelectorAll("[data-correct-item], [data-remove-added], [data-add-legacy]")).toHaveLength(0);
    expect(document.body.textContent).toContain(de.business.sales.detailsModal.imported);
  });

  it("a normal sale uses the normal actions and never the correction", async () => {
    const own = ITEMS_152.map((i) => ({ ...i, source_row: null, legacy_stock_flag: null, legacy_shipped_flag: null }));
    await mount({ items: own, historical: false, frozen: false, correctable: false });
    expect(document.querySelectorAll("[data-correct-item], [data-add-legacy]")).toHaveLength(0);
    await click(document.querySelector<HTMLElement>("[data-search] [data-pick]"));
    expect(MOCK.calls.map((c) => c.fn)).toEqual(["addSaleItem"]);
  });
});
