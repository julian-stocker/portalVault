/**
 * Catalog search and filtering.
 *
 * Runs entirely in the browser: the whole catalog is 13.6 KB gzipped, so a
 * round trip per keystroke would be slower than the filtering itself
 * (ADR-0026).
 */
import type { CatalogFigure } from "@/lib/catalog/types";

/** Every series, as the "Alle" option in the series tabs. */
export const ALL_SERIES = "all";

/**
 * Folds a string into a comparable form.
 *
 * Umlauts are spelled out the same way the slug rule does, so searching for
 * "fuer" finds "für" and vice versa. Apostrophes vanish so "Spyros" finds
 * "Spyro's".
 */
export function normalizeForSearch(text: string): string {
  return text
    .replace(/ä/gi, "ae")
    .replace(/ö/gi, "oe")
    .replace(/ü/gi, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .trim();
}

/**
 * Substring match. Nothing clever — the catalog is small.
 *
 * Matches against `searchIndex`, which already holds every spelling of the
 * name: the canonical one, the displayed one and the plain word order in
 * between. So "Legendary Bash", "Bash (Legendary)" and "Bash Legendary" all
 * find the same figure (ADR-0030).
 */
export function matchesQuery(figure: CatalogFigure, normalizedQuery: string): boolean {
  if (normalizedQuery === "") return true;
  return figure.searchIndex.includes(normalizedQuery);
}

/** Builds the pre-normalised haystack stored on each figure. */
export function buildSearchIndex(forms: readonly string[]): string {
  return forms.map(normalizeForSearch).join(" | ");
}

export function matchesSeries(figure: CatalogFigure, seriesCode: string): boolean {
  return seriesCode === ALL_SERIES || figure.seriesCode === seriesCode;
}

/**
 * Narrows the catalog to what someone already owns (ADR-0038, V4.2).
 *
 * Applied to the pool *before* search and series, so one narrowing feeds
 * every view the catalog has — the grid and the cross-series search results
 * alike. Doing it inside the search instead would leave a second path that
 * could forget it.
 *
 * Display only. Nothing here writes, and ownership is still marked on every
 * card by the gold frame whether the filter is on or off.
 */
export function ownedFigures(
  figures: readonly CatalogFigure[],
  ownedSkyIds: ReadonlySet<string>,
): CatalogFigure[] {
  return figures.filter((figure) => ownedSkyIds.has(figure.skyId));
}

/** Applies search and series filter together. Order of the input is kept. */
export function filterFigures(
  figures: readonly CatalogFigure[],
  options: { query?: string; seriesCode?: string },
): CatalogFigure[] {
  const normalized = normalizeForSearch(options.query ?? "");
  const series = options.seriesCode ?? ALL_SERIES;
  return figures.filter(
    (figure) => matchesSeries(figure, series) && matchesQuery(figure, normalized),
  );
}

/**
 * A catalog search that does not lose figures behind the active tab.
 *
 * The catalog always has one game selected (ADR-0038), which used to mean a
 * search only ever looked inside it: typing "Robot" while Spyro's Adventure
 * was active hid every Robot in the other five games, with nothing on screen
 * to say so.
 *
 * Now the chosen game answers first and the others follow as their own
 * sections. The tab does **not** change — switching it silently would take
 * the visitor somewhere they did not ask to go, and clearing the search has
 * to return them to exactly the view they left.
 */
export type SearchGroup = {
  code: string;
  label: string;
  figures: CatalogFigure[];
  /** True for the group the active tab points at. */
  active: boolean;
};

export function groupSearchResults(
  figures: readonly CatalogFigure[],
  options: {
    query: string;
    /** The active tab. Its group comes first, whether or not it has hits. */
    seriesCode: string;
    /** Series in database order; only those with hits are returned. */
    series: readonly { code: string; label: string }[];
  },
): SearchGroup[] {
  const normalized = normalizeForSearch(options.query);
  const hits = new Map<string, CatalogFigure[]>();

  for (const figure of figures) {
    if (!matchesQuery(figure, normalized)) continue;
    const list = hits.get(figure.seriesCode);
    if (list) list.push(figure);
    else hits.set(figure.seriesCode, [figure]);
  }

  const ordered = [
    ...options.series.filter((one) => one.code === options.seriesCode),
    ...options.series.filter((one) => one.code !== options.seriesCode),
  ];

  return ordered
    .map((one) => ({
      code: one.code,
      label: one.label,
      figures: hits.get(one.code) ?? [],
      active: one.code === options.seriesCode,
    }))
    // The active group is kept even when empty: "nothing here, but three in
    // Giants" is the answer, and dropping it would hide the question.
    .filter((group) => group.figures.length > 0 || group.active);
}
