/**
 * Finding one figure among eight hundred, while holding it (0064).
 *
 * Pure: no database, no browser. The catalog arrives with the page — that
 * decision is `fetchOrderbookCatalog`'s and predates this file — so searching
 * is a filter over an array that is already in memory. There is no request
 * per keystroke, which is why there is nothing here to debounce and no
 * response that can arrive out of order and overwrite a newer one.
 *
 * WHY RANKING AND NOT JUST `includes`
 *
 * The old add-item box did `name.toLowerCase().includes(q)` and showed the
 * first twelve in catalog order. Type `wash` and `Dark Wash Buckler` can
 * appear above `Wash Buckler`, because the catalog is ordered by SKY-ID and
 * nothing said otherwise. The operator is holding the plain one. Picking the
 * wrong variant is the mistake this whole workflow exists to make cheap to
 * undo, and it is cheaper still not to invite it.
 *
 * So: a word that STARTS with what you typed beats a word that merely
 * contains it, and an exact name wins outright.
 *
 * VARIANTS NEED NO VARIANT SYSTEM. `Free Ranger`, `Legendary Free Ranger` and
 * `Dark Wash Buckler` are separate catalog rows with separate SKY-IDs and
 * separate market prices. The distinguishing information is already there —
 * name, series, id, price — so this ranks canonical rows and invents no
 * metadata about them.
 */

/** One catalog row, as the screens receive it from `fetchOrderbookCatalog`. */
export type FigureChoice = {
  skyId: string;
  name: string;
  /** The canonical `series_code`: `SA`, `G`, `SF`, `TT`, `SC`, `I`. */
  series: string;
  /** `null` is "no price known" and is never treated as zero. */
  marketPrice: number | null;
};

/** Below this, a query matches too much to be worth showing. */
export const MIN_QUERY = 2;

/** How many results one list shows. Enough to choose from, few enough to scan. */
export const MAX_RESULTS = 8;

/**
 * Rank buckets, lowest first. Named rather than inlined so the order is
 * legible at the call site and a test can assert on the reason, not a number.
 */
const EXACT_NAME = 0;
const NAME_PREFIX = 1;
const WORD_PREFIX = 2;
const NAME_CONTAINS = 3;
const ID_MATCH = 4;

function normalise(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Which bucket this row falls in, or `null` when it does not match at all.
 *
 * The SKY-ID is searchable because the operator sometimes has it — off a
 * label, out of the ledger, from a previous screen — and typing `0212` should
 * find `SKY-0212` rather than nothing.
 */
export function rankFigure(choice: FigureChoice, query: string): number | null {
  const q = normalise(query);
  if (q.length < MIN_QUERY) return null;

  const name = normalise(choice.name);
  if (name === q) return EXACT_NAME;
  if (name.startsWith(q)) return NAME_PREFIX;
  // `wash` finds `Dark Wash Buckler` at word level, below a real prefix hit.
  if (name.split(/\s+/).some((word) => word.startsWith(q))) return WORD_PREFIX;
  if (name.includes(q)) return NAME_CONTAINS;
  if (normalise(choice.skyId).includes(q)) return ID_MATCH;
  return null;
}

/**
 * The results for one query, best first.
 *
 * Ties break by name so the list is stable: the same query always produces
 * the same order, which is what makes the keyboard path (`Enter` takes the
 * first) safe to rely on.
 */
export function searchFigures(
  catalog: readonly FigureChoice[],
  query: string,
  limit: number = MAX_RESULTS,
): FigureChoice[] {
  if (normalise(query).length < MIN_QUERY) return [];
  const ranked: { choice: FigureChoice; rank: number }[] = [];
  for (const choice of catalog) {
    const rank = rankFigure(choice, query);
    if (rank !== null) ranked.push({ choice, rank });
  }
  ranked.sort((a, b) =>
    a.rank !== b.rank ? a.rank - b.rank : a.choice.name.localeCompare(b.choice.name, "de-AT"));
  return ranked.slice(0, Math.max(0, limit)).map((r) => r.choice);
}

/** What the search box should say right now. One state, decided in one place. */
export type SearchState = "idle" | "tooShort" | "empty" | "noCatalog" | "results";

export function searchState(
  catalog: readonly FigureChoice[], query: string, results: readonly FigureChoice[],
): SearchState {
  if (catalog.length === 0) return "noCatalog";
  if (query.trim() === "") return "idle";
  if (normalise(query).length < MIN_QUERY) return "tooShort";
  return results.length === 0 ? "empty" : "results";
}

/**
 * Where the keyboard highlight goes next.
 *
 * Clamped rather than wrapped: at the bottom of eight results `ArrowDown`
 * should stay put, not silently jump back to the first one the operator has
 * already rejected.
 */
export function moveHighlight(current: number, delta: number, count: number): number {
  if (count === 0) return 0;
  return Math.min(count - 1, Math.max(0, current + delta));
}
