/**
 * The figures of a purchase that does not exist yet (0064).
 *
 * Pure: no database, no browser, no React. The create screen holds one of
 * these in state, and NOTHING is written until the operator presses the
 * button — clicking a search result must not bring a half-made purchase into
 * being that they then have to find and delete.
 *
 * ONE LINE PER FIGURE, ONE ROW PER UNIT
 *
 * The draft groups by SKY-ID and carries a quantity; persistence expands it
 * again, one `purchase_items` row per physical unit. Both halves of that
 * matter:
 *
 *   grouping      is what makes "I bought three Wash Bucklers" three taps
 *                 instead of three searches, and keeps a fifteen-unit parcel
 *                 readable on a phone.
 *   expanding     is what keeps the database model intact. A purchase item IS
 *                 one object — it is booked individually, it can be damaged
 *                 individually, and it owns at most one inventory movement.
 *                 A `quantity` column would be a second way to say how many
 *                 there are, and two ways to say one thing eventually
 *                 disagree.
 *
 * So `draftPayload` is the only place the two representations meet, and it
 * expands. Nothing downstream ever sees a quantity.
 *
 * CHANGING A LINE CHANGES ALL OF ITS UNITS. Three Wash Bucklers corrected to
 * Dark Wash Buckler become three Dark Wash Bucklers. That is the common case
 * — the operator misread the variant on the whole handful — and the other
 * case is served by lowering the quantity and adding the other variant
 * separately. Splitting a line in place would need a second selection model
 * for a rarer mistake than the one it complicates.
 */

import type { FigureChoice } from "./figure-search";
import { valuePurchase, type PurchaseValue, type ValuedItem } from "./purchase";

/** One canonical figure and how many of it the parcel holds. */
export type DraftLine = {
  skyId: string;
  name: string;
  series: string;
  /** `null` is "no market price known". Never coerced to zero. */
  marketPrice: number | null;
  /** Physical units. Always at least 1 — a line at zero is removed instead. */
  quantity: number;
};

/** A parcel may be large, but not unbounded. Mirrors 0064's own ceiling. */
export const MAX_DRAFT_UNITS = 200;

function lineFrom(choice: FigureChoice, quantity: number): DraftLine {
  return {
    skyId: choice.skyId,
    name: choice.name,
    series: choice.series,
    marketPrice: choice.marketPrice,
    quantity,
  };
}

/**
 * Add one unit of a figure.
 *
 * An existing line gains a unit rather than a duplicate line appearing: two
 * identical rows side by side would each need their own quantity control and
 * would read as a mistake.
 */
export function addFigure(lines: readonly DraftLine[], choice: FigureChoice): DraftLine[] {
  if (draftUnitCount(lines) >= MAX_DRAFT_UNITS) return [...lines];
  const existing = lines.findIndex((l) => l.skyId === choice.skyId);
  if (existing === -1) return [...lines, lineFrom(choice, 1)];
  return lines.map((l, i) => (i === existing ? { ...l, quantity: l.quantity + 1 } : l));
}

/** Drop a figure and every unit of it. */
export function removeFigure(lines: readonly DraftLine[], skyId: string): DraftLine[] {
  return lines.filter((l) => l.skyId !== skyId);
}

/**
 * Set how many units of a figure the parcel holds.
 *
 * Zero or less removes the line, which is what the `−` control does at one:
 * stepping down from a single unit means "not this one after all", and making
 * the operator then find a separate × would be a second gesture for the same
 * intent.
 */
export function setQuantity(
  lines: readonly DraftLine[], skyId: string, quantity: number,
): DraftLine[] {
  if (!Number.isFinite(quantity) || quantity <= 0) return removeFigure(lines, skyId);
  const capped = Math.min(Math.floor(quantity), MAX_DRAFT_UNITS);
  return lines.map((l) => (l.skyId === skyId ? { ...l, quantity: capped } : l));
}

/**
 * Correct which figure a line is, keeping its units and its position.
 *
 * MERGES when the replacement is already in the draft: correcting a line to a
 * figure that is already there means the parcel holds that many more of it,
 * not that there are now two lines for one figure. The surviving line keeps
 * the EARLIER of the two positions, so nothing jumps down the list under the
 * operator's finger.
 */
export function replaceFigure(
  lines: readonly DraftLine[], skyId: string, choice: FigureChoice,
): DraftLine[] {
  const from = lines.findIndex((l) => l.skyId === skyId);
  if (from === -1) return [...lines];
  if (choice.skyId === skyId) {
    // Same figure: refresh the display fields, change nothing else.
    return lines.map((l, i) => (i === from ? lineFrom(choice, l.quantity) : l));
  }

  const into = lines.findIndex((l) => l.skyId === choice.skyId);
  const moving = lines[from].quantity;
  if (into === -1) {
    return lines.map((l, i) => (i === from ? lineFrom(choice, moving) : l));
  }

  const survivor = Math.min(from, into);
  return lines
    .map((l, i) =>
      i === survivor
        ? lineFrom(choice, Math.min(lines[from].quantity + lines[into].quantity, MAX_DRAFT_UNITS))
        : l)
    .filter((_, i) => i === survivor || (i !== from && i !== into));
}

/** Physical units across every line — what the purchase will actually hold. */
export function draftUnitCount(lines: readonly DraftLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/**
 * The draft as the value calculator sees it: one entry per unit.
 *
 * `ordered` is the state `seller_add_purchase_item` gives a new row, so the
 * screen values the draft exactly as the database will value the purchase the
 * moment it exists.
 */
export function draftUnits(lines: readonly DraftLine[]): ValuedItem[] {
  const units: ValuedItem[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i++) {
      units.push({ state: "ordered", marketPrice: line.marketPrice });
    }
  }
  return units;
}

/**
 * Marktwert and Faktor for the draft, by the same arithmetic the ledger uses.
 *
 * `valuePurchase` is not reimplemented here, and that is the point: unknown
 * is not zero, a market value of zero yields a `null` factor rather than
 * infinity, and the screen and the database therefore cannot disagree about
 * what a parcel was worth.
 */
export function draftValue(totalCost: number, lines: readonly DraftLine[]): PurchaseValue {
  return valuePurchase(totalCost, draftUnits(lines));
}

/**
 * What goes to `seller_create_purchase_with_items`.
 *
 * One element per physical unit, in draft order. This is the expansion — the
 * quantity exists only in the browser and reaches nothing.
 */
export function draftPayload(lines: readonly DraftLine[]): { sky_id: string }[] {
  const payload: { sky_id: string }[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i++) payload.push({ sky_id: line.skyId });
  }
  return payload;
}
