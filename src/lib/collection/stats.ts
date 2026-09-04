/**
 * Collection metrics.
 *
 * Always computed, never stored: when a central market price changes, the
 * displayed value follows without anything having to be kept in sync
 * (ADR-0010).
 */
import type { CollectionEntry } from "@/lib/catalog/types";

export type CollectionStats = {
  /** Distinct figures owned, regardless of quantity. */
  distinctFigures: number;
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
};

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * `quantity` is honoured from the start, even though V1.5 has no UI for it
 * (ADR-0027). When quantities arrive in V1.6 the value is already right.
 */
export function collectionStats(
  entries: readonly CollectionEntry[],
  catalogTotal: number,
): CollectionStats {
  let totalPieces = 0;
  let estimatedValue = 0;
  let withoutPrice = 0;
  let inactiveOwned = 0;

  for (const entry of entries) {
    totalPieces += entry.quantity;
    if (entry.figure.marketPrice === null) {
      withoutPrice += 1;
    } else {
      estimatedValue += entry.quantity * entry.figure.marketPrice;
    }
    if (!entry.figure.isActive) inactiveOwned += 1;
  }

  return {
    distinctFigures: entries.length,
    totalPieces,
    catalogTotal,
    progress: catalogTotal > 0 ? entries.length / catalogTotal : 0,
    estimatedValue: roundToCents(estimatedValue),
    withoutPrice,
    inactiveOwned,
  };
}
