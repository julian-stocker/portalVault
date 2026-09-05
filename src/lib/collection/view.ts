/**
 * The collection, and the catalog it is measured against.
 *
 * `buildCollectionRows` still covers every collectible, because completion
 * and series progress need a denominator: 448 of 561 is only meaningful if
 * both halves count the same set. What changed in V2 is what reaches the
 * screen — `showcaseRows` and `filterCollection` hand out owned rows only,
 * so the collection page shows a collection and the catalog answers what is
 * missing (ADR-0038).
 *
 * Everything here is pure. The page does the fetching, the component does the
 * rendering, and these functions decide what the numbers mean.
 */
import { isCollectible } from "@/lib/catalog/collectible";
import type { CatalogFigure, CollectionEntry } from "@/lib/catalog/types";

/** One collectible and how many of it are owned. Zero means missing. */
export type CollectionRow = {
  figure: CatalogFigure;
  /** Current quantity, including an optimistic change that is still in flight. */
  quantity: number;
  /** What the server last said. Distinguishes "just removed" from "never owned". */
  initialQuantity: number;
};

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

/**
 * What the showcase is filtered by.
 *
 * One value, not two: the bar offers "Alle", the six series and "Duplikate"
 * side by side, because they answer the same question — which slice of my
 * collection am I looking at. "Gesammelt" and "Fehlend" are gone with the
 * catalog/collection split (ADR-0038): in a view that only holds what you
 * own, "collected" is every row and "missing" is none of them.
 */
export const COLLECTION_ALL = "all";
export const COLLECTION_DUPLICATES = "duplicates";

/** `COLLECTION_ALL`, `COLLECTION_DUPLICATES`, or a series code. */
export type CollectionFilter = string;

/** The rows the showcase may display at all: what is actually owned. */
export function showcaseRows(rows: readonly CollectionRow[]): CollectionRow[] {
  return rows.filter((row) => row.quantity > 0);
}

export function matchesCollectionFilter(row: CollectionRow, filter: CollectionFilter): boolean {
  if (filter === COLLECTION_ALL) return true;
  // A duplicate is simply a second copy. It says nothing about selling,
  // trading or stock — that stays private collection data (ADR-0032).
  if (filter === COLLECTION_DUPLICATES) return row.quantity > 1;
  return row.figure.seriesCode === filter;
}

/**
 * The showcase, filtered.
 *
 * Owned rows only — a figure at quantity zero never appears here, whatever
 * the filter says. That is the whole point of the split: the collection shows
 * a collection, and what is missing is a question for the catalog.
 */
export function filterCollection(
  rows: readonly CollectionRow[],
  filter: CollectionFilter,
): CollectionRow[] {
  return showcaseRows(rows).filter((row) => matchesCollectionFilter(row, filter));
}

/** What the collection statistics need: the owned rows, as entries. */
export function ownedEntries(rows: readonly CollectionRow[]): CollectionEntry[] {
  return rows
    .filter((row) => row.quantity > 0)
    .map((row) => ({ figure: row.figure, quantity: row.quantity }));
}

/**
 * What the collection hero says about the segment the tabs have selected.
 *
 * The hero used to describe the whole collection whatever the filter said,
 * with six series progress cards underneath repeating the same thing in
 * miniature. V2.1 (ADR-0038) merges the two: one tab bar selects the segment,
 * and the hero is that segment's summary.
 *
 * Deliberately independent of the search box. A hero that recomputed on every
 * keystroke would turn a stable fact — how complete Trap Team is — into a
 * number that jumps while you type.
 */
export type SegmentSummary =
  | {
      kind: "completion";
      /** Distinct collectibles owned in the segment. */
      owned: number;
      /** Active collectibles the segment holds. */
      total: number;
      missing: number;
      /** 0 to 1, never NaN. */
      ratio: number;
      /** Sum of quantity × market price for the segment, in EUR. */
      value: number;
    }
  | {
      kind: "duplicates";
      /** Figures held more than once. */
      figures: number;
      /** Copies beyond the first, summed. */
      extraCopies: number;
      /**
       * What those extra copies are worth: `(quantity - 1) × market price`.
       *
       * Not the same question as `collectionStats.estimatedValue`, which
       * values the whole collection and counts every copy. A hero that says
       * "duplicates" must not quote the value of the first copies as well.
       */
      value: number;
    };

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Collectible rows only — games are outside the collector surface entirely. */
function collectibleRows(rows: readonly CollectionRow[]): CollectionRow[] {
  return rows.filter((row) => isCollectible(row.figure));
}

export function segmentSummary(
  rows: readonly CollectionRow[],
  filter: CollectionFilter,
  catalogTotal: number,
): SegmentSummary {
  const considered = collectibleRows(rows);

  if (filter === COLLECTION_DUPLICATES) {
    let figures = 0;
    let extraCopies = 0;
    let value = 0;
    for (const row of considered) {
      if (row.quantity <= 1) continue;
      const extra = row.quantity - 1;
      figures += 1;
      extraCopies += extra;
      // A figure without a price is left out of the sum, never treated as
      // 0 € (ADR-0010) — the same rule collectionStats follows.
      if (row.figure.marketPrice !== null) value += extra * row.figure.marketPrice;
    }
    return { kind: "duplicates", figures, extraCopies, value: roundToCents(value) };
  }

  const inSegment =
    filter === COLLECTION_ALL
      ? considered
      : considered.filter((row) => row.figure.seriesCode === filter);

  let owned = 0;
  let value = 0;
  let total = 0;
  for (const row of inSegment) {
    // The denominator counts what the catalog currently offers, so a figure
    // that left it cannot push completion past 100 %.
    if (row.figure.isActive) {
      total += 1;
      if (row.quantity > 0) owned += 1;
    }
    // The value counts what is owned, active or not: owning it is owning it.
    if (row.quantity > 0 && row.figure.marketPrice !== null) {
      value += row.quantity * row.figure.marketPrice;
    }
  }

  // "Alle" measures against the authoritative catalog count from the database
  // rather than against however many rows this page happened to load.
  if (filter === COLLECTION_ALL) total = catalogTotal;

  return {
    kind: "completion",
    owned,
    total,
    missing: Math.max(0, total - owned),
    ratio: total > 0 ? owned / total : 0,
    value: roundToCents(value),
  };
}
