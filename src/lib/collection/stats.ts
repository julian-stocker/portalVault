/**
 * Collection metrics.
 *
 * Always computed, never stored: when a central market price changes, the
 * displayed value follows without anything having to be kept in sync
 * (ADR-0010).
 */
import { isCollectible } from "@/lib/catalog/collectible";
import { NO_MARKET_BOOST, catalogDisplayMarketPrice } from "@/lib/catalog/market-boost";
import type { CollectionEntry } from "@/lib/catalog/types";

export type CollectionStats = {
  /** Distinct collectibles owned, regardless of quantity. */
  distinctFigures: number;
  /**
   * Owned collectibles that the catalog currently offers — the numerator of
   * the progress.
   *
   * Differs from `distinctFigures` only for figures that left the catalog.
   * They stay in the collection and stay counted in `distinctFigures`, but
   * the denominator counts active collectibles only, so including them here
   * could push completion past 100 %.
   */
  countedFigures: number;
  /** Total pieces owned, quantities included. */
  totalPieces: number;
  /** Active figures in the catalog — the denominator of the progress. */
  catalogTotal: number;
  /** 0 to 1. Zero when the catalog is empty, never NaN. */
  progress: number;
  /** Sum of quantity times market price, in EUR. */
  estimatedValue: number;
  /** Owned figures with no known price. Excluded from the value, shown apart. */
  withoutPrice: number;
  /** Owned figures that are no longer active in the catalog. */
  inactiveOwned: number;
  /**
   * Owned figures an administrator has hidden from the public catalog.
   *
   * Counted apart for the same reason as `inactiveOwned`: the figure stays in
   * the collection and in its value, but it is in neither half of the
   * completion fraction (ADR-0040).
   */
  hiddenOwned: number;
  /** Owned entries that are not collectible items — console games. */
  nonCollectibleOwned: number;
};

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Two rules decide every number here:
 *
 *   completion counts a SKY-ID once, however many copies are owned — three
 *   Drobots are one figure out of 561, not three;
 *
 *   value counts every copy, because owning three of them is worth three
 *   times as much.
 *
 * A collectible without a market price is left out of the sum and reported in
 * `withoutPrice` instead. It is never treated as 0 € (ADR-0010).
 */
export function collectionStats(
  entries: readonly CollectionEntry[],
  catalogTotal: number,
  /**
   * The temporary catalog market-value boost, in per cent (0094, ADR-0105).
   *
   * The collection is valued at what the catalog SAYS a figure is worth, so
   * it follows the same percentage — a collection that contradicted the
   * cards it is made of would be worse than either number alone.
   *
   * It is a display valuation and stops here: the shop price, the buy-in
   * factor, every snapshot and the whole Business side keep reading the
   * stored price. Default 0, which is the stored price exactly.
   */
  boostPercent: number = NO_MARKET_BOOST,
): CollectionStats {
  let distinctFigures = 0;
  let countedFigures = 0;
  let totalPieces = 0;
  let estimatedValue = 0;
  let withoutPrice = 0;
  let inactiveOwned = 0;
  let hiddenOwned = 0;
  let nonCollectibleOwned = 0;

  for (const entry of entries) {
    // Console games are still shown in a collection someone built, but they
    // count towards nothing: the catalog does not offer them, so including
    // them would make 100 % unreachable and the value misleading.
    if (!isCollectible(entry.figure)) {
      nonCollectibleOwned += 1;
      continue;
    }

    distinctFigures += 1;
    // Completion counts what the public catalog currently offers. A figure
    // that left the source (`isActive`) or was hidden editorially
    // (`catalogVisible`) is in neither half — which is what makes
    // "owned > total" impossible (ADR-0040).
    if (entry.figure.isActive && entry.figure.catalogVisible) countedFigures += 1;
    totalPieces += entry.quantity;
    if (entry.figure.marketPrice === null) {
      withoutPrice += 1;
    } else {
      /*
       * THE UNIT PRICE IS ROUNDED FIRST, THEN MULTIPLIED.
       *
       * 4.99 at 5 % is 5.24 on the card, so three copies must be 15.72 —
       * not 4.99 x 3 x 1.05 = 15.7185, which would round to 15.72 here but
       * disagrees with the cards as soon as the numbers are less kind. One
       * unit price, shown and summed.
       */
      estimatedValue +=
        entry.quantity * (catalogDisplayMarketPrice(entry.figure.marketPrice, boostPercent) ?? 0);
    }
    if (!entry.figure.isActive) inactiveOwned += 1;
    if (!entry.figure.catalogVisible) hiddenOwned += 1;
  }

  return {
    distinctFigures,
    countedFigures,
    totalPieces,
    catalogTotal,
    progress: catalogTotal > 0 ? countedFigures / catalogTotal : 0,
    estimatedValue: roundToCents(estimatedValue),
    withoutPrice,
    inactiveOwned,
    hiddenOwned,
    nonCollectibleOwned,
  };
}
