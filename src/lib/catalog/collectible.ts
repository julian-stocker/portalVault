/**
 * What counts as collectible.
 *
 * The catalog holds console games alongside the figures: 39 of the 600
 * entries are software for Wii, Xbox, PlayStation, 3DS and Switch. They are
 * canonical data — they exist in the legacy spreadsheet, they have SKY-IDs
 * and prices — but nobody collects them, and counting them would distort
 * every progress figure.
 *
 * THE RULE: an entry is collectible unless its category says otherwise.
 *
 * This is the category structure the owner defined, not a name blacklist over
 * individual figures (docs/SKYLANDERS_DATA.md, section 3). Verified against
 * the real data on 2026-09-04:
 *
 *   - exactly 6 categories are named "Spiele", one per series, all at
 *     position 0
 *   - they hold exactly 39 entries, every one of them console software
 *   - no game-like entry exists in any other category (0 false negatives)
 *   - nothing collectible sits inside them (0 false positives)
 *   - independent corroboration: all 39 have NO image, while 534 of the 561
 *     collectible entries do. The legacy image pipeline never gave software a
 *     picture, which is a second signal pointing at the same set.
 *
 * COUPLING TO BE AWARE OF: the category names come from the legacy project
 * (etl/categories.py). Renaming "Spiele" there would silently let software
 * back into the catalog. The test in collectible.test.ts and the note in
 * docs/SKYLANDERS_DATA.md exist so that coupling is visible rather than
 * discovered later.
 */
import type { CatalogFigure } from "@/lib/catalog/types";

/** Category names whose entries are not collectible items. */
export const NON_COLLECTIBLE_CATEGORIES: ReadonlySet<string> = new Set(["Spiele"]);

export function isCollectibleCategory(categoryName: string): boolean {
  return !NON_COLLECTIBLE_CATEGORIES.has(categoryName);
}

export function isCollectible(figure: Pick<CatalogFigure, "categoryName">): boolean {
  return isCollectibleCategory(figure.categoryName);
}

/** Keeps only the collectible entries, order untouched. */
export function collectibleOnly<T extends Pick<CatalogFigure, "categoryName">>(
  figures: readonly T[],
): T[] {
  return figures.filter(isCollectible);
}
