/**
 * Collection metrics.
 *
 * Always computed, never stored: when a central market price changes, the
 * displayed value follows without anything having to be kept in sync
 * (ADR-0010).
 */
import { isCollectible } from "@/lib/catalog/collectible";
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
): CollectionStats {
  let distinctFigures = 0;
  let countedFigures = 0;
  let totalPieces = 0;
  let estimatedValue = 0;
  let withoutPrice = 0;
  let inactiveOwned = 0;
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
    if (entry.figure.isActive) countedFigures += 1;
    totalPieces += entry.quantity;
    if (entry.figure.marketPrice === null) {
      withoutPrice += 1;
    } else {
      estimatedValue += entry.quantity * entry.figure.marketPrice;
    }
    if (!entry.figure.isActive) inactiveOwned += 1;
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
    nonCollectibleOwned,
  };
}
