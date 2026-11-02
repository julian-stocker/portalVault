// @vitest-environment jsdom
/**
 * Jede Aktion trifft die Position, die man anklickt — auch in Serienblöcken (V2).
 *
 * Seit `fetchPurchase()` die Positionen nach Serie ordnet, ist die Reihenfolge
 * auf dem Schirm nicht mehr die Reihenfolge der Positionsnummern. Eine Aktion,
 * die sich am PLATZ in der Liste orientierte, würde jetzt eine andere Position
 * treffen. Dieser Test klickt Zeilen, die nicht oben stehen, und prüft, welche
 * `id` bei der Server-Aktion ankommt. Die Aktionen selbst sind Doppelgänger:
 * hier zählt der Weg vom Klick zur Kennung, nicht die Datenbank.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { fn: string; args: unknown[] }[]);
vi.mock("@/lib/orderbook/actions", () => {
  const record = (fn: string) => async (...args: unknown[]) => {
    calls.push({ fn, args });
    return { ok: true, movementId: 1 };
  };
  return {
    bookPurchaseItem: record("book"),
    unbookPurchaseItem: record("unbook"),
    removePurchaseItem: record("remove"),
    setPurchaseItemSky: record("sky"),
    setPurchaseItemState: record("state"),
  };
});

import { de } from "@/lib/i18n/de";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import type { PurchaseItem } from "@/lib/orderbook/queries";
import { sortPurchaseItemsBySeries } from "@/lib/orderbook/series-order";
import { addPurchaseFigure, type PurchaseDraftLine } from "@/lib/orderbook/purchase-draft";
import { PurchaseDraftList } from "./purchase-draft-list";
import { PurchaseItems } from "./purchase-items";

const copy = de.business.orderbook;
const POSITIONS = new Map([["SA", 0], ["G", 1], ["SF", 2], ["T", 3], ["SC", 4], ["I", 5]]);

function item(id: number, position: number, name: string, seriesCode: string | null,
  extra: Partial<PurchaseItem> = {}): PurchaseItem {
  return {
    id, position, skyId: seriesCode === null ? null : `SKY-${String(id).padStart(4, "0")}`,
    name, rawName: null, seriesCode, seriesLabel: seriesCode, condition: "loose",
    state: "arrived", marketPrice: 10, priceIsFrozen: false, movementId: null,
    legacyConditionFlag: null, legacyBookedFlag: null, sourceRow: null, ...extra,
  };
}

/* Erfasst in dieser Reihenfolge (Position 1 … 5), angezeigt nach Serie. */
const ERFASST: PurchaseItem[] = [
  item(501, 1, "King Pen", "I"),
  item(502, 2, "Wash Buckler", "T"),
  item(503, 3, "Spyro", "SA"),
  item(504, 4, "Punch Pop Fizz", "G"),
  item(505, 5, "Portal", null),
];
const ANGEZEIGT = sortPurchaseItemsBySeries(ERFASST, POSITIONS);

const CATALOG: FigureChoice[] = [
  { skyId: "SKY-0900", name: "Pop Fizz", series: "G", marketPrice: 5, image: null },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(items: PurchaseItem[]) {
  act(() => {
    root.render(createElement(PurchaseItems, { purchaseId: 77, items, catalog: CATALOG }));
  });
}

/* Die Titelzeile jeder Position: „<Positionsnummer>. <Name>". */
const titles = () => [...container.querySelectorAll("ul > li span.font-medium")]
  .map((n) => n.textContent ?? "").filter((t) => /^\d+\. /.test(t));
const rowOf = (name: string) => [...container.querySelectorAll<HTMLLIElement>("ul > li")]
  .find((li) => [...li.querySelectorAll("span.font-medium")]
    .some((n) => /^\d+\. /.test(n.textContent ?? "") && n.textContent!.endsWith(` ${name}`)))!;
const button = (li: HTMLElement, text: string) => [...li.querySelectorAll("button")]
  .find((b) => b.textContent?.trim() === text)!;

async function click(el: HTMLElement) {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}

describe("Positionsidentität in Serienblöcken", () => {
  it("die Anzeige ist nach Serie, die Positionsnummern bleiben die erfassten", () => {
    render(ANGEZEIGT);
    const titel = titles();
    expect(titel).toEqual(["3. Spyro", "4. Punch Pop Fizz", "2. Wash Buckler", "1. King Pen", "5. Portal"]);
  });

  it("Einbuchen trifft die angeklickte Position, nicht den Listenplatz", async () => {
    render(ANGEZEIGT);
    await click(button(rowOf("Wash Buckler"), copy.book));
    expect(calls).toEqual([{ fn: "book", args: [502, 77] }]);
  });

  it("ein Zustandswechsel ebenso", async () => {
    render(ANGEZEIGT);
    await click(button(rowOf("King Pen"), copy.states.ordered));
    expect(calls).toEqual([{ fn: "state", args: [501, "ordered", 77] }]);
  });

  it("Entfernen ebenso", async () => {
    render(ANGEZEIGT);
    await click(button(rowOf("Punch Pop Fizz"), copy.figures.remove));
    expect(calls).toEqual([{ fn: "remove", args: [504, 77] }]);
  });

  it("Figur ändern (Bearbeiten) ebenso — die Suche unter DIESER Zeile schreibt DIESE id", async () => {
    render(ANGEZEIGT);
    await click(button(rowOf("King Pen"), copy.figures.change));
    const feld = rowOf("King Pen").querySelector<HTMLInputElement>('input[type="search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(feld, "Pop Fizz"); feld.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => {
      feld.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(calls).toEqual([{ fn: "sky", args: [501, "SKY-0900", 77, false] }]);
  });

  it("nach dem Nachladen (Buchung) steht dieselbe Zeile an derselben Stelle und trägt den neuen Zustand", async () => {
    render(ANGEZEIGT);
    await click(button(rowOf("Wash Buckler"), copy.book));
    /* So kommt die Liste nach `router.refresh()` zurück: frisch sortiert. */
    const nachher = sortPurchaseItemsBySeries(ERFASST.map((i) =>
      i.id === 502 ? { ...i, state: "booked" as const, movementId: 9001 } : i), POSITIONS);
    render(nachher);
    const titel = titles();
    expect(titel).toEqual(["3. Spyro", "4. Punch Pop Fizz", "2. Wash Buckler", "1. King Pen", "5. Portal"]);
    expect(rowOf("Wash Buckler").textContent).toContain(copy.booked);
    expect(rowOf("Spyro").textContent).not.toContain(copy.booked);
    /* Und die Rücknahme trifft wieder genau sie. */
    await click(button(rowOf("Wash Buckler"), copy.unbook));
    await click(button(rowOf("Wash Buckler"), copy.errors.unbookYes));
    expect(calls.at(-1)).toEqual({ fn: "unbook", args: [502, 77] });
  });
});

/* ===================================================================== */
describe("Erfassung: neueste oben, jede Handlung an ihrer Zeile", () => {
  const F = (skyId: string, name: string, series: string): FigureChoice =>
    ({ skyId, name, series, marketPrice: 1, image: null });
  const SPYRO = F("SKY-0001", "Spyro", "SA");
  const POP = F("SKY-0142", "Pop Fizz", "G");
  const PEN = F("SKY-0500", "King Pen", "I");
  let latest: PurchaseDraftLine[] = [];

  function renderList(lines: PurchaseDraftLine[], prefilled?: ReadonlySet<number>) {
    act(() => {
      root.render(createElement(PurchaseDraftList, {
        lines, catalog: [SPYRO, POP, PEN], prefilled,
        onChange: (next: PurchaseDraftLine[]) => { latest = next; },
      }));
    });
  }
  const shownNames = () => [...container.querySelectorAll(
    `ul[aria-label="${de.business.orderbook.figures.selected}"] > li span[title]`)]
    .map((n) => n.textContent);

  it("die zuletzt hinzugefügte Figur steht oben", () => {
    const lines = [SPYRO, POP, PEN].reduce<PurchaseDraftLine[]>((l, c) => addPurchaseFigure(l, c), []);
    renderList(lines);
    expect(shownNames()).toEqual(["King Pen", "Pop Fizz", "Spyro"]);
  });

  it("Entfernen in der obersten Zeile entfernt die NEUESTE, nicht die erste erfasste", () => {
    const lines = [SPYRO, POP, PEN].reduce<PurchaseDraftLine[]>((l, c) => addPurchaseFigure(l, c), []);
    renderList(lines);
    const oben = container.querySelector<HTMLElement>(
      `ul[aria-label="${de.business.orderbook.figures.selected}"] > li`)!;
    const weg = [...oben.querySelectorAll("button")]
      .find((b) => b.getAttribute("aria-label") === de.business.orderbook.figures.removeOne("King Pen"))!;
    act(() => { weg.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(latest.map((l) => l.skyId)).toEqual(["SKY-0001", "SKY-0142"]);
  });

  it("Abtrennen: die neue Zeile erscheint direkt neben ihrer Ausgangszeile", () => {
    let lines = [SPYRO, POP, POP, PEN].reduce<PurchaseDraftLine[]>((l, c) => addPurchaseFigure(l, c), []);
    renderList(lines);
    const knopf = [...container.querySelectorAll("button")]
      .find((b) => b.getAttribute("aria-label") === de.business.orderbook.figures.splitOne("Pop Fizz"))!;
    act(() => { knopf.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    lines = latest;
    renderList(lines);
    expect(shownNames()).toEqual(["King Pen", "Pop Fizz", "Pop Fizz", "Spyro"]);
  });
});
