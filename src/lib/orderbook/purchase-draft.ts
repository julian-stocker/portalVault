/**
 * The draft of a NEW purchase: one compact line per group of units, each with
 * its own state.
 *
 * WHY THIS SITS BESIDE `draft.ts` INSTEAD OF INSIDE IT.
 *
 * `DraftLine`, `addFigure` and `draftPayload` are shared with the SALE form
 * (`new-sale.tsx`) and with the calculator. A purchase item has a state; a
 * sale item has nothing of the kind, and `seller_create_sale_with_items` would
 * be handed a field it does not model. Widening the shared type would push a
 * purchase-only concept through two unrelated screens — so the purchase draft
 * is its own model, and `PurchaseDraftLine` extends `DraftLine` so that
 * `draftValue()` and `draftUnitCount()` keep working on it unchanged.
 *
 * WHY LINES CARRY A `key`.
 *
 * In `draft.ts` a line IS a figure: identity is the SKY-ID, and adding the
 * same figure twice raises the quantity. That is right for a sale and wrong
 * here, because two copies of one figure can arrive in different conditions —
 * one fine, one broken. Identity is therefore the line, not the figure, and a
 * `key` says so. The key is derived from the lines themselves rather than from
 * a module counter, so the functions stay pure and give the same answer on the
 * server and in the browser.
 *
 * ANGEKOMMEN IS NOT EINGEBUCHT. None of these five states moves stock.
 * `Einbuchen` writes an inventory movement, happens one unit at a time in
 * `seller_book_purchase_item`, and is reached from the purchase's detail page
 * after it exists. Nothing in this file books anything.
 */
import { MAX_DRAFT_UNITS, draftUnitCount, type DraftLine } from "@/lib/orderbook/draft";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import {
  valuePurchase, type PurchaseValue, type ValuedItem,
} from "@/lib/orderbook/purchase";

/**
 * The states a brand-new purchase item may start in.
 *
 * Five of the eight the column allows. Missing on purpose:
 *
 *   `booked`            means "an inventory movement exists". Only
 *                       `seller_book_purchase_item` creates one, so claiming
 *                       the state here would claim a movement nobody made.
 *   `reconciled_legacy` means "already inside the historical stock figure".
 *                       A purchase being entered now cannot be that.
 *   `settled`           belongs to the non-catalog path from 0069.
 *
 * The order is the order of the dropdown, and it is the order of the parcel:
 * ordered first because that is what every line starts as.
 */
export const PURCHASE_DRAFT_STATES = [
  "ordered",
  "arrived",
  "damaged",
  "missing",
  "showcase",
] as const;

export type PurchaseDraftState = (typeof PURCHASE_DRAFT_STATES)[number];

/** What a new purchase item starts as, here and in the database default. */
export const DEFAULT_PURCHASE_DRAFT_STATE: PurchaseDraftState = "ordered";

export function isPurchaseDraftState(value: string): value is PurchaseDraftState {
  return (PURCHASE_DRAFT_STATES as readonly string[]).includes(value);
}

/** One figure, how many of it, and what shape those units are in. */
export type PurchaseDraftLine = DraftLine & {
  /** Stable within one draft. Identity of the LINE, never of the figure. */
  key: number;
  state: PurchaseDraftState;
};

/** The next free key. Derived, so the function stays pure. */
function nextKey(lines: readonly PurchaseDraftLine[]): number {
  return lines.reduce((high, line) => Math.max(high, line.key), 0) + 1;
}

function lineFrom(
  choice: FigureChoice,
  key: number,
  quantity: number,
  state: PurchaseDraftState,
): PurchaseDraftLine {
  return {
    key,
    skyId: choice.skyId,
    /*
     * The DISPLAY name, which after 0117 is the unambiguous one. `rawName`
     * is deliberately not carried into the draft: it is provenance, and for a
     * figure picked out of the catalog there is no earlier source to record.
     */
    name: choice.name,
    series: choice.series,
    marketPrice: choice.marketPrice,
    quantity,
    state,
  };
}

/**
 * Add one unit.
 *
 * It joins an existing `ordered` line of the same figure rather than appearing
 * as a second row — two identical rows side by side would each need their own
 * quantity control and would read as a mistake. It does NOT join a line that
 * has been set to something else: the operator said those units are damaged,
 * and a new unit is not.
 */
export function addPurchaseFigure(
  lines: readonly PurchaseDraftLine[],
  choice: FigureChoice,
): PurchaseDraftLine[] {
  if (draftUnitCount(lines) >= MAX_DRAFT_UNITS) return [...lines];
  const open = lines.findIndex(
    (line) => line.skyId === choice.skyId && line.state === DEFAULT_PURCHASE_DRAFT_STATE,
  );
  if (open === -1) {
    return [...lines, lineFrom(choice, nextKey(lines), 1, DEFAULT_PURCHASE_DRAFT_STATE)];
  }
  return lines.map((line, i) =>
    i === open ? { ...line, quantity: line.quantity + 1 } : line,
  );
}

/**
 * Einen Entwurf aus Figur-und-Menge-Paaren bauen (Calculator V3, ADR-0132).
 *
 * WOFUER. Eine gespeicherte Kalkulation liefert SKY-IDs und Stückzahlen. Das
 * bestehende Formular soll sie vorfinden, als wären sie dort eingetippt
 * worden — und „als wären" ist hier wörtlich zu nehmen.
 *
 * DESHALB FALTET DIESE FUNKTION ÜBER `addPurchaseFigure`, Stück für Stück,
 * statt Zeilen selbst zu bauen. Damit entstehen genau die Zeilen, die ein
 * Mensch durch Klicken erzeugt hätte: dieselben Schlüssel, derselbe
 * Anfangszustand, dasselbe Zusammenfassen gleicher Figuren, dieselbe Decke
 * (`MAX_DRAFT_UNITS`). Eine zweite Bauanleitung für dasselbe wäre genau die
 * Sorte Unterschied, die später niemand findet.
 *
 * DIE ANZEIGEDATEN KOMMEN AUS DEM KATALOG, NICHT AUS DER KALKULATION. Name,
 * Serie und Marktwert nimmt `lineFrom` aus dem `FigureChoice` — also aus
 * derselben Quelle wie beim Tippen. Der Schnappschuss der Kalkulation ist
 * eine Erinnerung daran, womit gerechnet wurde (ADR-0131), und nicht die
 * Wahrheit über den Artikel von heute.
 *
 * WAS SIE NICHT FINDET, LÄSST SIE WEG. Eine SKY-ID, die der Katalog nicht
 * führt — deaktiviert, umgezogen —, erzeugt keine Zeile und keinen Fehler.
 * Das Formular zeigt dann weniger Positionen als die Kalkulation, und das
 * ist die ehrliche Auskunft: diese Figur kann das Orderbuch heute nicht
 * zuordnen. Die Zahl der weggelassenen gibt `purchaseDraftGap` zurück.
 */
export function purchaseDraftFromUnits(
  catalog: readonly FigureChoice[],
  units: readonly { skyId: string; quantity: number }[],
): PurchaseDraftLine[] {
  const index = new Map(catalog.map((choice) => [choice.skyId, choice]));
  let lines: PurchaseDraftLine[] = [];
  for (const unit of units) {
    const choice = index.get(unit.skyId);
    if (choice === undefined) continue;
    /* Stück für Stück durch denselben Weg wie ein Klick. */
    for (let i = 0; i < unit.quantity; i += 1) {
      lines = addPurchaseFigure(lines, choice);
    }
  }
  return lines;
}

/**
 * Wie viele Stück die Vorbelegung NICHT übernehmen konnte.
 *
 * Gezählt, nicht verschwiegen: wer dreißig Figuren kalkuliert hat und
 * achtundzwanzig im Formular sieht, muss erfahren können, warum. Die
 * Oberfläche nennt die Zahl; der Grund ist immer derselbe — der Katalog
 * führt die SKY-ID nicht mehr.
 */
export function purchaseDraftGap(
  catalog: readonly FigureChoice[],
  units: readonly { skyId: string; quantity: number }[],
): number {
  const known = new Set(catalog.map((choice) => choice.skyId));
  let fehlt = 0;
  for (const unit of units) {
    if (!known.has(unit.skyId)) fehlt += unit.quantity;
  }
  return fehlt;
}

/** Drop one line and every unit in it. */
export function removePurchaseLine(
  lines: readonly PurchaseDraftLine[],
  key: number,
): PurchaseDraftLine[] {
  return lines.filter((line) => line.key !== key);
}

/**
 * How many units this line holds.
 *
 * Zero or less removes it, which is what the `−` control does at one: stepping
 * down from a single unit means "not this one after all".
 */
export function setPurchaseQuantity(
  lines: readonly PurchaseDraftLine[],
  key: number,
  quantity: number,
): PurchaseDraftLine[] {
  if (!Number.isFinite(quantity) || quantity <= 0) return removePurchaseLine(lines, key);
  const capped = Math.min(Math.floor(quantity), MAX_DRAFT_UNITS);
  return lines.map((line) => (line.key === key ? { ...line, quantity: capped } : line));
}

/**
 * Set the state of one WHOLE line.
 *
 * NOTHING IS MERGED HERE, and that is deliberate. Folding a line into another
 * one that happens to share its state would make the list jump under the hand
 * that just split it, and splitting then changing is exactly the two-step
 * gesture this screen offers. Two lines of the same figure in the same state
 * are untidy; a row vanishing while you look at it is worse.
 */
export function setPurchaseLineState(
  lines: readonly PurchaseDraftLine[],
  key: number,
  state: PurchaseDraftState,
): PurchaseDraftLine[] {
  return lines.map((line) => (line.key === key ? { ...line, state } : line));
}

/**
 * Split one unit off a line so it can get its own state.
 *
 * THE TOTAL NEVER CHANGES. A line of three becomes a line of two and a line of
 * one; the parcel still holds three. A line of one cannot be split — there is
 * nothing to separate, and its own dropdown already answers the question.
 *
 * The new unit keeps the state it had. Moving it to `ordered` would be a
 * second, unasked-for change, and a split out of a damaged line is most often
 * the start of "this one, though, is fine".
 */
export function splitPurchaseUnit(
  lines: readonly PurchaseDraftLine[],
  key: number,
): PurchaseDraftLine[] {
  const index = lines.findIndex((line) => line.key === key);
  if (index === -1) return [...lines];
  const line = lines[index];
  if (line.quantity <= 1) return [...lines];
  const split: PurchaseDraftLine = { ...line, key: nextKey(lines), quantity: 1 };
  const kept: PurchaseDraftLine = { ...line, quantity: line.quantity - 1 };
  return [...lines.slice(0, index), kept, split, ...lines.slice(index + 1)];
}

/**
 * What goes to `seller_create_purchase_with_items`.
 *
 * One element per physical unit, in draft order, each carrying its state. The
 * quantity exists only in the browser and reaches nothing — the database
 * counts rows, not multipliers, because a movement belongs to one unit.
 */
export function purchaseDraftPayload(
  lines: readonly PurchaseDraftLine[],
): { sky_id: string; state: PurchaseDraftState }[] {
  const payload: { sky_id: string; state: PurchaseDraftState }[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i++) {
      payload.push({ sky_id: line.skyId, state: line.state });
    }
  }
  return payload;
}

/**
 * The draft as the value calculator sees it: one entry per unit, WITH ITS
 * STATE.
 *
 * WHY THIS CANNOT REUSE `draftUnits()`.
 *
 * That function hands every unit the state `ordered`, which was exactly right
 * while a draft had no states: `ordered` is what `seller_add_purchase_item`
 * gives a new row, so the screen valued the draft the way the database would
 * value the purchase.
 *
 * Since 0120 a draft line can say `damaged` or `missing`, and `valuePurchase`
 * credits those with 0 EUR (`creditsNoValue`, D4) — the loss does not vanish,
 * it makes the parcel expensive. Passing `ordered` for them would show a
 * market value the saved purchase does not have, and a factor that drops the
 * moment the purchase exists. The screen and the database must not be able to
 * disagree about what a parcel was worth.
 */
export function purchaseDraftUnits(lines: readonly PurchaseDraftLine[]): ValuedItem[] {
  const units: ValuedItem[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i++) {
      units.push({ state: line.state, marketPrice: line.marketPrice });
    }
  }
  return units;
}

/**
 * Marktwert und Faktor des Entwurfs, mit derselben Arithmetik wie der Ledger.
 *
 * `valuePurchase` wird nicht nachgebaut, und das ist der Punkt: unbekannt ist
 * nicht null, ein Marktwert von null ergibt `null` statt unendlich, und
 * `purchase_market_value()` rechnet genauso.
 */
export function purchaseDraftValue(
  totalCost: number,
  lines: readonly PurchaseDraftLine[],
): PurchaseValue {
  return valuePurchase(totalCost, purchaseDraftUnits(lines));
}

/**
 * How many units sit in each state — for the one summary line above the
 * submit button, so the operator can see what they are about to save without
 * reading every row.
 */
export function purchaseDraftStateCounts(
  lines: readonly PurchaseDraftLine[],
): Record<PurchaseDraftState, number> {
  const counts = {
    ordered: 0, arrived: 0, damaged: 0, missing: 0, showcase: 0,
  } as Record<PurchaseDraftState, number>;
  for (const line of lines) counts[line.state] += line.quantity;
  return counts;
}

/**
 * The idempotency token of ONE draft.
 *
 * Generated once when the form opens, never per submit — that is the whole
 * point: a second submit of the same draft carries the same token, and
 * `seller_create_purchase_with_items` answers with the purchase it already
 * made instead of making another.
 *
 * Lowercase, because the column's CHECK accepts lowercase hex only and the
 * database lowercases what it receives; agreeing here means the value that
 * comes back is the value that was sent.
 */
export function newDraftToken(): string {
  return crypto.randomUUID().toLowerCase();
}
