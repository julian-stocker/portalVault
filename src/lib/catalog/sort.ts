/**
 * Catalog order.
 *
 * Series, then category, then figure — the order the owner defined in the
 * legacy spreadsheet (docs/SKYLANDERS_DATA.md, section 3). Not alphabetical
 * across everything: the block order carries meaning.
 *
 * Within a category, a figure sorts by its BASE name so variants sit next to
 * the figure they belong to (ADR-0030). All 55 recognised variants share the
 * category of their base, so this never fights the block order.
 */
import type { CatalogFigure } from "@/lib/catalog/types";

const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });

export function compareFigures(a: CatalogFigure, b: CatalogFigure): number {
  if (a.seriesPosition !== b.seriesPosition) return a.seriesPosition - b.seriesPosition;
  if (a.categoryPosition !== b.categoryPosition) return a.categoryPosition - b.categoryPosition;

  // Base name first, so a family stays together even when another figure
  // starts with the same word: Bash, Bash (Legendary), then Bash Junior.
  const byBase = collator.compare(a.sortBaseName, b.sortBaseName);
  if (byBase !== 0) return byBase;

  // Within one family the base figure comes before its variants.
  const aIsVariant = a.sortVariantLabel !== null;
  const bIsVariant = b.sortVariantLabel !== null;
  if (aIsVariant !== bIsVariant) return aIsVariant ? 1 : -1;
  if (aIsVariant && bIsVariant) {
    return collator.compare(a.sortVariantLabel!, b.sortVariantLabel!);
  }

  // Same base, both plain: identical names in one category are possible.
  return collator.compare(a.name, b.name);
}

/** Returns a sorted copy; the input is left alone. */
export function sortFigures(figures: readonly CatalogFigure[]): CatalogFigure[] {
  return [...figures].sort(compareFigures);
}
