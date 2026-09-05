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
 * The scope: which game is being looked at. `COLLECTION_ALL` or a series code.
 *
 * V4.2 split this from the duplicate filter. "Duplikate" sat in the same bar
 * as the six games and behaved like a seventh, which meant you could look at
 * duplicates or at Giants but never at the duplicates *in* Giants — and a
 * duplicate is not a game (ADR-0038).
 */
export const COLLECTION_ALL = "all";

/** A series code, or `COLLECTION_ALL`. */
export type CollectionScope = string;

/** What narrows the scope further. One flag today, room for more. */
export type CollectionFilters = {
  /** Only figures held more than once. */
  duplicatesOnly: boolean;
};

export const NO_FILTERS: CollectionFilters = { duplicatesOnly: false };

/** The rows the showcase may display at all: what is actually owned. */
export function showcaseRows(rows: readonly CollectionRow[]): CollectionRow[] {
  return rows.filter((row) => row.quantity > 0);
}

export function matchesScope(row: CollectionRow, scope: CollectionScope): boolean {
  return scope === COLLECTION_ALL || row.figure.seriesCode === scope;
}

export function matchesFilters(row: CollectionRow, filters: CollectionFilters): boolean {
  // A duplicate is simply a second copy. It says nothing about selling,
  // trading or stock — that stays private collection data (ADR-0032).
  return !filters.duplicatesOnly || row.quantity > 1;
}

/**
 * The showcase, scoped and filtered.
 *
 * Owned rows only — a figure at quantity zero never appears here, whatever
 * else is set. That is the whole point of the split: the collection shows a
 * collection, and what is missing is a question for the catalog.
 */
export function filterCollection(
  rows: readonly CollectionRow[],
  scope: CollectionScope,
  filters: CollectionFilters = NO_FILTERS,
): CollectionRow[] {
  return showcaseRows(rows).filter(
    (row) => matchesScope(row, scope) && matchesFilters(row, filters),
  );
}

/** What the collection statistics need: the owned rows, as entries. */
export function ownedEntries(rows: readonly CollectionRow[]): CollectionEntry[] {
  return rows
    .filter((row) => row.quantity > 0)
    .map((row) => ({ figure: row.figure, quantity: row.quantity }));
}

/**
 * What the collection hero says about the game the tabs have selected.
 *
 * Deliberately independent of the search box and of the filters: a hero that
 * recomputed on every keystroke would turn a stable fact — how complete Trap
 * Team is — into a number that jumps while you type, and "how complete" does
 * not change because duplicates are being shown (ADR-0038).
 */
export type SegmentSummary = {
  /** Distinct collectibles owned in the segment. */
  owned: number;
  /** Active collectibles the segment holds. */
  total: number;
  missing: number;
  /** 0 to 1, never NaN. */
  ratio: number;
  /** Sum of quantity × market price for the segment, in EUR. */
  value: number;
};

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Collectible rows only — games are outside the collector surface entirely. */
function collectibleRows(rows: readonly CollectionRow[]): CollectionRow[] {
  return rows.filter((row) => isCollectible(row.figure));
}

function inScope(rows: readonly CollectionRow[], scope: CollectionScope): CollectionRow[] {
  const considered = collectibleRows(rows);
  return scope === COLLECTION_ALL
    ? considered
    : considered.filter((row) => row.figure.seriesCode === scope);
}

export function segmentSummary(
  rows: readonly CollectionRow[],
  scope: CollectionScope,
  catalogTotal: number,
): SegmentSummary {
  let owned = 0;
  let value = 0;
  let total = 0;

  for (const row of inScope(rows, scope)) {
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
  if (scope === COLLECTION_ALL) total = catalogTotal;

  return {
    owned,
    total,
    missing: Math.max(0, total - owned),
    ratio: total > 0 ? owned / total : 0,
    value: roundToCents(value),
  };
}

/**
 * What the duplicates in the current scope come to.
 *
 * A line under the summary rather than a summary of its own (V4.2): showing
 * duplicates is a filter on the view, not a different question about the
 * collection, so completion stays on screen and this is added to it.
 */
export type DuplicateSummary = {
  /** Figures held more than once. */
  figures: number;
  /** Copies beyond the first, summed. */
  extraCopies: number;
  /**
   * What those extra copies are worth: `(quantity - 1) × market price`.
   *
   * Not the same question as the segment's value, which counts every copy. A
   * line that says "duplicates" must not quote the first copies as well.
   */
  value: number;
};

export function duplicateSummary(
  rows: readonly CollectionRow[],
  scope: CollectionScope,
): DuplicateSummary {
  let figures = 0;
  let extraCopies = 0;
  let value = 0;

  for (const row of inScope(rows, scope)) {
    if (row.quantity <= 1) continue;
    const extra = row.quantity - 1;
    figures += 1;
    extraCopies += extra;
    // A figure without a price is left out of the sum, never treated as
    // 0 € (ADR-0010) — the same rule the segment value follows.
    if (row.figure.marketPrice !== null) value += extra * row.figure.marketPrice;
  }

  return { figures, extraCopies, value: roundToCents(value) };
}

export type SeriesSection = {
  code: string;
  label: string;
  rows: CollectionRow[];
  /** Distinct active collectibles of this game that are owned. */
  owned: number;
  /** Active collectibles the game holds — the same denominator as everywhere. */
  total: number;
  /** 0 to 1, never NaN. */
  ratio: number;
};

/**
 * Groups showcase rows by game, in the order the database gives.
 *
 * The order is `series`' own — release order — so nothing is hardcoded here
 * and a seventh game would slot in wherever its position says. A game with
 * nothing owned is left out entirely: an empty section is a heading over a
 * gap, and what is missing is a catalog question (ADR-0038).
 *
 * The counts come from the same rule the rest of the collection uses: a
 * SKY-ID counts once however many copies are owned, and only what the catalog
 * currently offers is counted on either side of the fraction.
 */
export function groupBySeries(
  visibleRows: readonly CollectionRow[],
  allRows: readonly CollectionRow[],
  series: readonly { code: string; label: string }[],
): SeriesSection[] {
  const owned = new Map<string, number>();
  const total = new Map<string, number>();
  const visible = new Map<string, CollectionRow[]>();

  // The counts describe the collection, not the current search: a section
  // saying "3 / 81" because a search matched three figures would be a lie.
  for (const row of allRows) {
    if (!isCollectible(row.figure)) continue;
    if (!row.figure.isActive) continue;
    const code = row.figure.seriesCode;
    total.set(code, (total.get(code) ?? 0) + 1);
    if (row.quantity > 0) owned.set(code, (owned.get(code) ?? 0) + 1);
  }

  // The rows are whatever the grid would have shown, in the order it had —
  // minus software, which is outside the collector surface entirely
  // (ADR-0029) and must never head up under a game.
  for (const row of visibleRows) {
    if (!isCollectible(row.figure)) continue;
    const code = row.figure.seriesCode;
    const list = visible.get(code);
    if (list) list.push(row);
    else visible.set(code, [row]);
  }

  return series
    .map((option) => {
      const list = visible.get(option.code) ?? [];
      const count = owned.get(option.code) ?? 0;
      const size = total.get(option.code) ?? 0;
      return {
        code: option.code,
        label: option.label,
        rows: list,
        owned: count,
        total: size,
        ratio: size > 0 ? count / size : 0,
      };
    })
    .filter((section) => section.rows.length > 0);
}

/**
 * Is anything actually filtered?
 *
 * "Alle" with an empty box and nothing switched on is the resting state, not
 * a filter — offering to reset it there is an action with nothing to undo,
 * and it made the page look as though something were hidden (ADR-0038).
 *
 * The view mode is deliberately not part of this: choosing a table is a way
 * of looking, not a narrowing of what is shown.
 */
export function hasActiveFilter(
  scope: CollectionScope,
  query: string,
  filters: CollectionFilters = NO_FILTERS,
): boolean {
  return scope !== COLLECTION_ALL || query.trim() !== "" || filters.duplicatesOnly;
}
