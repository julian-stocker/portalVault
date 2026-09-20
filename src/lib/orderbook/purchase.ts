/**
 * What a purchase is worth, and what that is worth saying (ADR-0088).
 *
 * Pure: no database, no browser. The same arithmetic the SQL does, so a screen
 * can recompute a factor without a round trip and a test can check the edges
 * without a fixture.
 */

/** The states one physical thing can be in. Mirrors purchase_items_state_known. */
export const ITEM_STATES = [
  "ordered",
  "arrived",
  "damaged",
  "missing",
  "booked",
  "reconciled_legacy",
  /*
   * The ending for something that is not a catalog figure (0069). A portal
   * arrived and is accounted for; it has no place in figure inventory, so
   * `booked` — which needs a sky_id and writes a movement — can never be
   * its ending. The database refuses `settled` for any row that HAS a
   * sky_id, so this cannot become a way past the inventory ledger.
   */
  "settled",
] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/** The four the Quickbox may set freely. `booked` is reached by booking, not
 *  by picking, and `settled` only through `canSettle` — see below. */
export const QUICK_STATES: readonly ItemState[] = ["ordered", "arrived", "damaged", "missing"];

/**
 * Whether this item can be accepted into stock right now.
 *
 * `damaged` and `missing` are deliberately excluded: a damaged figure is not
 * sellable and one that never arrived is not present. Both stay on the
 * purchase — the money was still spent — but neither reaches the shelf without
 * the operator first saying it is in fact fine.
 */
export function canBook(item: { state: ItemState; skyId: string | null }): boolean {
  if (item.skyId === null) return false;
  return item.state === "ordered" || item.state === "arrived";
}

/**
 * Whether this item can be marked `Erledigt` right now (0069).
 *
 * THE MIRROR IMAGE OF `canBook`, and deliberately not its negation.
 *
 *   a catalog figure   never. It ends by being booked, and offering any
 *                      other ending would be offering a way to close a
 *                      position while the stock it represents goes missing.
 *                      The database refuses it too; this only keeps the
 *                      button away from a press that would fail.
 *   arrived only       `Bestellt -> Angekommen -> Erledigt`. Filing away
 *                      something that has not turned up yet would be a
 *                      statement nobody can make.
 */
export function canSettle(item: { state: ItemState; skyId: string | null }): boolean {
  if (item.skyId !== null) return false;
  return item.state === "arrived";
}

export type ValuedItem = {
  state: ItemState;
  /** Frozen price if booked, live catalog price if not, null if neither exists. */
  marketPrice: number | null;
};

export type PurchaseValue = {
  /** Sum over the items whose value is known. */
  knownValue: number;
  knownItems: number;
  /** Items counted at all — `missing` ones are not part of what arrived. */
  countedItems: number;
  /** Items counted but with no price. */
  unknownItems: number;
  /** cost / knownValue, or null when nothing is known. */
  factor: number | null;
  /** factor × 100, rounded to one decimal. */
  percent: number | null;
  /** True when the figure describes every counted item. */
  complete: boolean;
};

/**
 * Value a purchase.
 *
 * UNKNOWN IS NOT ZERO. A figure with no catalog price contributes nothing to
 * the sum and one to `unknownItems`, so the screen can say "Faktor 0,40 · 2
 * Artikel ohne Marktpreis" rather than quietly presenting a factor computed
 * over less than the parcel.
 *
 * A market value of zero yields `null`, not infinity: "we do not know what this
 * is worth" and "this is worth nothing" are different statements and only one
 * of them is ever true here.
 */
export function valuePurchase(totalCost: number, items: readonly ValuedItem[]): PurchaseValue {
  const counted = items.filter((i) => i.state !== "missing");
  const known = counted.filter((i) => i.marketPrice !== null);
  const knownValue = known.reduce((sum, i) => sum + (i.marketPrice ?? 0), 0);
  const factor = knownValue > 0 ? totalCost / knownValue : null;

  return {
    knownValue: Math.round(knownValue * 100) / 100,
    knownItems: known.length,
    countedItems: counted.length,
    unknownItems: counted.length - known.length,
    factor: factor === null ? null : Math.round(factor * 10000) / 10000,
    percent: factor === null ? null : Math.round(factor * 1000) / 10,
    complete: counted.length > 0 && known.length === counted.length,
  };
}

/**
 * Progress through a parcel.
 *
 * `booked` counts only units that actually own an inventory movement — the
 * same thing `purchase_market_value()` counts, so the two can never tell
 * different stories about one purchase.
 *
 * `settled` is the wider question the ledger row wants: how much of this
 * parcel still needs a decision. A historical row needs none — it was
 * reconciled long ago — so it is settled without being booked. The pilot made
 * the difference visible: 14 historical items displayed as "0 von 14
 * eingebucht" read as fourteen pieces of outstanding work.
 */
export function bookingProgress(items: readonly { state: ItemState }[]): {
  booked: number;
  settled: number;
  open: number;
  total: number;
} {
  const booked = items.filter((i) => i.state === "booked").length;
  const settled = items.filter(
    (i) => i.state === "booked" || i.state === "reconciled_legacy",
  ).length;
  return { booked, settled, open: items.length - settled, total: items.length };
}

/** True when this purchase came out of the legacy workbook. */
export function isHistorical(source: string): boolean {
  return source === "excel_order_2026";
}

/**
 * What the item-level correction controls may touch (0064).
 *
 * THE SCREEN AND THE DATABASE SAY THE SAME THING, and the database is the one
 * that decides. `seller_remove_purchase_item` refuses every case below; this
 * exists so the control is not offered in the first place, because an action
 * that is always refused is worse than an absent one.
 */
export type CorrectableItem = {
  state: ItemState;
  /** Present exactly when this unit owns an inventory movement. */
  movementId: number | null;
  legacyConditionFlag: string | null;
  legacyBookedFlag: string | null;
};

/**
 * May this item be removed from its purchase?
 *
 * Four refusals, each for its own reason:
 *
 *   in stock        the movement names this unit; removing the row would
 *                   orphan it, and the foreign key says so too.
 *   imported parent an imported purchase owns imported lines. Nobody can add
 *                   one here, so nobody may take one away either.
 *   reconciled      the workbook's own state for a line already accounted
 *                   for in stock.
 *   legacy markers  what the old spreadsheet believed about this line.
 *                   Provenance, and no importer will regenerate it — this
 *                   project does not re-import.
 *
 * NOT a judgement about whether the figure is right. Correcting THAT stays
 * possible for every unbooked item including a historical one — see
 * `canRemapItem` and 0054.
 */
export function canRemoveItem(purchaseSource: string, item: CorrectableItem): boolean {
  if (item.movementId !== null || item.state === "booked") return false;
  if (isHistorical(purchaseSource)) return false;
  if (item.state === "reconciled_legacy") return false;
  return item.legacyConditionFlag === null && item.legacyBookedFlag === null;
}

/**
 * May which figure this item IS be corrected?
 *
 * Booking is the only bar. A historical line may absolutely be remapped —
 * that is what 0054 exists for, a workbook name matched to the wrong SKY-ID
 * has to be fixable — and doing so changes a classification while the line,
 * its row number and its provenance stay exactly where they are.
 */
export function canRemapItem(item: Pick<CorrectableItem, "state" | "movementId">): boolean {
  return item.movementId === null && item.state !== "booked";
}
