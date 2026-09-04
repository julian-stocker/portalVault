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

/** Substring match on the name. Nothing clever — the catalog is small. */
export function matchesQuery(figure: CatalogFigure, normalizedQuery: string): boolean {
  if (normalizedQuery === "") return true;
  return normalizeForSearch(figure.name).includes(normalizedQuery);
}

export function matchesSeries(figure: CatalogFigure, seriesCode: string): boolean {
  return seriesCode === ALL_SERIES || figure.seriesCode === seriesCode;
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
