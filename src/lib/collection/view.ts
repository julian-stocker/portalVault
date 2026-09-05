/**
 * The collection as a view over the whole catalog.
 *
 * A collection page that only lists what someone owns cannot answer the
 * question collectors actually have — what is missing. So every collectible
 * gets a row, with the quantity owned, and zero means missing.
 *
 * Everything here is pure. The page does the fetching, the component does the
 * rendering, and these functions decide what the numbers mean.
 */
import { isCollectible } from "@/lib/catalog/collectible";
import type { CatalogFigure, CollectionEntry, SeriesOption } from "@/lib/catalog/types";

/** One collectible and how many of it are owned. Zero means missing. */
export type CollectionRow = {
  figure: CatalogFigure;
  /** Current quantity, including an optimistic change that is still in flight. */
  quantity: number;
  /** What the server last said. Distinguishes "just removed" from "never owned". */
  initialQuantity: number;
};

export type CollectionStatus = "all" | "owned" | "missing" | "duplicates";

export const COLLECTION_STATUSES: readonly CollectionStatus[] = [
  "all",
  "owned",
  "missing",
  "duplicates",
];

/**
 * One row per collectible, plus anything collectible that is owned but no
 * longer offered.
 *
 * The second part matters: a figure that left the catalog must not disappear
 * from the collection of someone who owns it. It appears at the end, keeps
 * its quantity, and is counted apart from the completion figures.
 *
 * Console games are the exception. They are not part of the collector surface
 * at all — the catalog does not list them and their detail page is a 404
 * (ADR-0029) — so an owned game gets no card here either. It is not lost:
 * `collectionStats` counts it in `nonCollectibleOwned`, and the overview says
 * so in a sentence.
 */
export function buildCollectionRows(
  catalog: readonly CatalogFigure[],
  owned: readonly CollectionEntry[],
): CollectionRow[] {
  const quantities = new Map(owned.map((entry) => [entry.figure.skyId, entry.quantity]));
  const inCatalog = new Set(catalog.map((figure) => figure.skyId));

  const rows: CollectionRow[] = catalog.map((figure) => {
    const quantity = quantities.get(figure.skyId) ?? 0;
    return { figure, quantity, initialQuantity: quantity };
  });

  for (const entry of owned) {
    if (inCatalog.has(entry.figure.skyId)) continue;
    if (!isCollectible(entry.figure)) continue;
    rows.push({
      figure: entry.figure,
      quantity: entry.quantity,
      initialQuantity: entry.quantity,
    });
  }

  return rows;
}

export function matchesStatus(row: CollectionRow, status: CollectionStatus): boolean {
  switch (status) {
    case "owned":
      return row.quantity > 0;
    case "missing":
      return row.quantity === 0;
    // A duplicate is simply a second copy. It says nothing about selling,
    // trading or stock — that stays private collection data (ADR-0032).
    case "duplicates":
      return row.quantity > 1;
    case "all":
      return true;
  }
}

export function filterCollection(
  rows: readonly CollectionRow[],
  status: CollectionStatus,
): CollectionRow[] {
  return rows.filter((row) => matchesStatus(row, status));
}

/** What the collection statistics need: the owned rows, as entries. */
export function ownedEntries(rows: readonly CollectionRow[]): CollectionEntry[] {
  return rows
    .filter((row) => row.quantity > 0)
    .map((row) => ({ figure: row.figure, quantity: row.quantity }));
}

export type SeriesProgress = {
  code: string;
  label: string;
  owned: number;
  total: number;
  /** 0 to 1. Zero for a series with no collectibles, never NaN. */
  ratio: number;
};

/**
 * How complete each series is.
 *
 * Counts collectibles the catalog currently offers, so numerator and
 * denominator describe the same set. A figure that is owned but no longer
 * active belongs to neither — it is reported separately, not folded in here
 * where it could push a series past 100 %.
 */
export function seriesProgress(
  rows: readonly CollectionRow[],
  series: readonly SeriesOption[],
): SeriesProgress[] {
  const owned = new Map<string, number>();
  const total = new Map<string, number>();

  for (const row of rows) {
    if (!isCollectible(row.figure) || !row.figure.isActive) continue;
    const code = row.figure.seriesCode;
    total.set(code, (total.get(code) ?? 0) + 1);
    if (row.quantity > 0) owned.set(code, (owned.get(code) ?? 0) + 1);
  }

  return series.map((option) => {
    const count = owned.get(option.code) ?? 0;
    const size = total.get(option.code) ?? 0;
    return {
      code: option.code,
      label: option.label,
      owned: count,
      total: size,
      ratio: size > 0 ? count / size : 0,
    };
  });
}
