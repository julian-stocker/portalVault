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
 * A BASE FIGURE AND ITS VARIANTS ARE ONE BLOCK (CAT-17, ADR-0169). Where a
 * row names its base (`base_sky_id`), it is not compared against the rest of
 * the catalogue at all: the block is placed by its base, and inside it the
 * base comes first and the variants follow by `VARIANT_SORT_ORDER`. Nothing
 * about a variant — its name, its SKY-ID, when it was created — can move it
 * in front of its base or into another figure's block.
 */
import { VARIANT_SORT_ORDER, variantTier } from "@/lib/catalog/catalog-type";
import type { CatalogFigure } from "@/lib/catalog/types";

const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });

/**
 * Where a figure stands in `VARIANT_SORT_ORDER`, counting the plain figure
 * as 0.
 *
 * `untypedLast` decides what a figure WITHOUT a variant type is. Next to
 * other figures it is the plain one and leads (0). Inside a base's block it
 * is a variant nobody has classified yet — Silver Boomer, the Mini and Sensei
 * repaints — and goes to the end, after every classified one, rather than
 * being given a tier the data does not state.
 */
export function variantRank(figure: CatalogFigure, untypedLast = false): number {
  const tier = variantTier(figure);
  if (tier === null) return untypedLast ? VARIANT_SORT_ORDER.length + 1 : 0;
  return VARIANT_SORT_ORDER.indexOf(tier) + 1;
}

/**
 * Two figures, each standing for itself.
 *
 * What places one BLOCK against another in `sortFigures()`, and the
 * tie-break the shop uses under its price order. It knows nothing about
 * `base_sky_id`; `sortFigures()` does.
 */
export function compareFigures(a: CatalogFigure, b: CatalogFigure): number {
  if (a.seriesPosition !== b.seriesPosition) return a.seriesPosition - b.seriesPosition;
  if (a.categoryPosition !== b.categoryPosition) return a.categoryPosition - b.categoryPosition;

  // Base name first, so a family stays together even when another figure
  // starts with the same word: Bash, Bash (Legendary), then Bash Junior.
  const byBase = collator.compare(a.sortBaseName, b.sortBaseName);
  if (byBase !== 0) return byBase;

  /*
   * Within one family, by tier (ADR-0169; before that by card type,
   * ADR-0068). It is the TYPE that orders here, not the name: a figure whose
   * form the name does not spell out still sorts where it belongs, and a
   * figure the operator reclassifies moves with its type.
   */
  const byTier = variantRank(a) - variantRank(b);
  if (byTier !== 0) return byTier;

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
   */
  const aIsBase = a.displayName === a.sortBaseName;
  const bIsBase = b.displayName === b.sortBaseName;
  if (aIsBase !== bIsBase) return aIsBase ? -1 : 1;

  /*
   * Same base, same tier. The label breaks the tie — there are families
   * with two chases — and the plain figure still comes before a labelled one.
   */
  const aIsVariant = a.sortVariantLabel !== null;
  const bIsVariant = b.sortVariantLabel !== null;
  if (aIsVariant !== bIsVariant) return aIsVariant ? 1 : -1;
  if (aIsVariant && bIsVariant) {
    const byLabel = collator.compare(a.sortVariantLabel!, b.sortVariantLabel!);
    if (byLabel !== 0) return byLabel;
  }

  // Identical names in one category are possible; the SKY-ID is permanent,
  // so the order never depends on the order rows arrived in.
  return collator.compare(a.name, b.name) || (a.skyId < b.skyId ? -1 : a.skyId > b.skyId ? 1 : 0);
}

/**
 * Two variants of the same base: by tier, then by what the visitor reads,
 * then by SKY-ID — only ever to break a tie INSIDE the block.
 */
function compareVariants(a: CatalogFigure, b: CatalogFigure): number {
  return variantRank(a, true) - variantRank(b, true)
    || collator.compare(a.displayName, b.displayName)
    || collator.compare(a.name, b.name)
    || (a.skyId < b.skyId ? -1 : a.skyId > b.skyId ? 1 : 0);
}

/**
 * Returns a sorted copy; the input is left alone.
 *
 * Every figure is filed into a block: its own, or its base's. A variant
 * joins its base's block only within the same series AND category — the
 * category boundary is the owner's and wins; a variant filed elsewhere sorts
 * there, on its own. A block whose base is not in the list (a draft, hidden,
 * or not owned in a collection) keeps its variants together and is placed by
 * the first of them.
 */
export function sortFigures(figures: readonly CatalogFigure[]): CatalogFigure[] {
  const blocks = new Map<string, { head: CatalogFigure | null; variants: CatalogFigure[] }>();
  const keyOf = (f: CatalogFigure, skyId: string) => `${f.seriesCode}|${f.categoryPosition}|${skyId}`;
  const block = (key: string) => {
    let entry = blocks.get(key);
    if (!entry) blocks.set(key, (entry = { head: null, variants: [] }));
    return entry;
  };

  /* Figures that cannot head a block: the same SKY-ID twice in one list. They
     stand on their own rather than replace the first — nothing is dropped. */
  const loose: CatalogFigure[][] = [];

  for (const figure of figures) {
    if (figure.baseSkyId && figure.baseSkyId !== figure.skyId) {
      block(keyOf(figure, figure.baseSkyId)).variants.push(figure);
    } else {
      const own = block(keyOf(figure, figure.skyId));
      if (own.head === null) own.head = figure;
      else loose.push([figure]);
    }
  }

  const ordered = [...blocks.values(), ...loose.map((one) => ({ head: one[0], variants: [] }))].map(({ head, variants }) => {
    const sorted = variants.sort(compareVariants);
    return head === null ? sorted : [head, ...sorted];
  });
  ordered.sort((a, b) => compareFigures(a[0], b[0]));
  return ordered.flat();
}
