/**
 * Catalog order.
 *
 * Series, then category, then figure — the order the owner defined in the
 * legacy spreadsheet (docs/SKYLANDERS_DATA.md, section 3). Not alphabetical
 * across everything: the block order carries meaning.
 *
 * Within a category, a figure sorts by its BASE name so variants sit next to
 * the figure they belong to (ADR-0030) — never by its display name, which
 * since V3.6 begins with the variant label ("Blue Bash") and would scatter a
 * family across the alphabet.
 *
 * Inside one family the order is by EDITION, not by label: standard, special,
 * chase, dark, legendary, prestige (ADR-0068).
 */
import { familyRank } from "@/lib/catalog/card-type";
import type { CatalogFigure } from "@/lib/catalog/types";

const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });

export function compareFigures(a: CatalogFigure, b: CatalogFigure): number {
  if (a.seriesPosition !== b.seriesPosition) return a.seriesPosition - b.seriesPosition;
  if (a.categoryPosition !== b.categoryPosition) return a.categoryPosition - b.categoryPosition;

  // Base name first, so a family stays together even when another figure
  // starts with the same word: Bash, Bash (Legendary), then Bash Junior.
  const byBase = collator.compare(a.sortBaseName, b.sortBaseName);
  if (byBase !== 0) return byBase;

  /*
   * Within one family, by edition (V3.6).
   *
   *   standard · special · chase · dark · legendary · prestige
   *
   * The operator's order, held in `FAMILY_ORDER` so this reads it rather than
   * restating it. It replaces "base figure before its variants", which could
   * only ever say two things and put a Legendary next to a seasonal repaint.
   *
   * It is the CARD TYPE that orders here, not the name: a figure whose form
   * the name does not spell out still sorts where it belongs, and a figure
   * the operator reclassifies moves with its type.
   */
  const byEdition = familyRank(a.cardType) - familyRank(b.cardType);
  if (byEdition !== 0) return byEdition;

  /*
   * THE FIGURE THE FAMILY IS NAMED AFTER COMES FIRST (V3.9a).
   *
   * Since the curated character may decide `sortBaseName` (ADR-0070b), a
   * family can hold several members that the name rule gave no label to —
   * "Eruptor", "Eruptor Light Core", "Lava Barf Eruptor" are all unlabelled.
   * The chain below could only separate them by raw name, which is
   * alphabetical luck: "Big Bubble Pop Fizz" would lead the Pop Fizz family.
   *
   * So the plain figure leads, stated rather than hoped for. It asks about
   * the DISPLAY name, which is what the visitor reads and what "this is the
   * figure itself" means to them.
   *
   * Only a tie-break. Series, category, base name and edition have all
   * already had their say, and FAMILY_ORDER is untouched.
   */
  const aIsBase = a.displayName === a.sortBaseName;
  const bIsBase = b.displayName === b.sortBaseName;
  if (aIsBase !== bIsBase) return aIsBase ? -1 : 1;

  /*
   * Same base, same edition. The label breaks the tie — there are families
   * with two chases — and the plain figure still comes before a labelled one,
   * because a base figure and its unnamed-form sibling share a rank.
   */
  const aIsVariant = a.sortVariantLabel !== null;
  const bIsVariant = b.sortVariantLabel !== null;
  if (aIsVariant !== bIsVariant) return aIsVariant ? 1 : -1;
  if (aIsVariant && bIsVariant) {
    const byLabel = collator.compare(a.sortVariantLabel!, b.sortVariantLabel!);
    if (byLabel !== 0) return byLabel;
  }

  // Last resort: identical names in one category are possible.
  return collator.compare(a.name, b.name);
}

/** Returns a sorted copy; the input is left alone. */
export function sortFigures(figures: readonly CatalogFigure[]): CatalogFigure[] {
  return [...figures].sort(compareFigures);
}
