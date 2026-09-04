/**
 * Catalog order.
 *
 * Series, then category, then name — the order the owner defined in the
 * legacy spreadsheet (docs/SKYLANDERS_DATA.md, section 3). Not alphabetical
 * across everything: the block order carries meaning.
 */
import type { CatalogFigure } from "@/lib/catalog/types";

const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });

export function compareFigures(a: CatalogFigure, b: CatalogFigure): number {
  if (a.seriesPosition !== b.seriesPosition) return a.seriesPosition - b.seriesPosition;
  if (a.categoryPosition !== b.categoryPosition) return a.categoryPosition - b.categoryPosition;
  return collator.compare(a.name, b.name);
}

/** Returns a sorted copy; the input is left alone. */
export function sortFigures(figures: readonly CatalogFigure[]): CatalogFigure[] {
  return [...figures].sort(compareFigures);
}
