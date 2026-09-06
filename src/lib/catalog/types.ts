/**
 * The shape the catalog UI works with.
 *
 * Deliberately flat and narrow: only what a card or a detail page renders.
 * Whatever the database grows, the browser keeps receiving this and nothing
 * more (ADR-0026).
 */
import type { Element } from "@/lib/catalog/character";
import type { CatalogGroup } from "@/lib/catalog/group";

export type CatalogFigure = {
  /** Permanent identity. Every relation hangs off this, never off the slug. */
  skyId: string;
  name: string;
  /** Navigation only (ADR-0011). */
  slug: string;
  seriesCode: string;
  seriesLabel: string;
  /** Display order of the series, 0-based. */
  seriesPosition: number;
  /** Display order of the category within its series. */
  categoryPosition: number;
  /** Category name, verbatim from the legacy source. Decides collectibility. */
  categoryName: string;
  /** Numeric category id. Only the admin area needs it. */
  categoryId: number;
  /**
   * What kind of collectible this is (ADR-0041), from its category.
   *
   * `null` means the category has not been classified — a state, not a
   * default: such a figure stays visible under "Alle" and is never filed
   * under a group it was not given.
   *
   * Says nothing about specials and nothing about completion.
   */
  catalogGroup: CatalogGroup | null;
  /**
   * What the collector area shows: "Astroblast (Legendary)" where the raw
   * name is "Legendary Astroblast". Equals `name` when no variant is
   * recognised. Derived at read time — the database keeps the raw name
   * (src/lib/catalog/variant.ts).
   */
  displayName: string;
  /** Base figure of a variant, or the name itself. Used for sorting. */
  sortBaseName: string;
  /** Variant label, or null for a base figure. Sorts after the base. */
  sortVariantLabel: string | null;
  /** Pre-normalised text a search matches against, covering every spelling. */
  searchIndex: string;
  /** null means "no known market price" — never 0 (ADR-0010). */
  marketPrice: number | null;
  /** Content-addressed WebP file name from the import, or null (ADR-0009). */
  imageFile: string | null;
  /**
   * An administrator's uploaded picture, or null (ADR-0046).
   *
   * A path inside the public `catalog` storage bucket. It wins over
   * `imageFile`, which stays exactly as the import left it — resolve both
   * through `imageSrc()` and never by hand.
   */
  imageOverridePath: string | null;
  isActive: boolean;
  /**
   * Editorial visibility (ADR-0039). False hides the figure from the public
   * catalog, from search and from both halves of completion — while the
   * collection rows of everyone who owns it stay untouched.
   */
  catalogVisible: boolean;
  /** The imported canonical name, for the admin area. Never rewritten. */
  canonicalName: string;
  /** Admin-chosen public name, or null when the derivation applies. */
  displayNameOverride: string | null;
  /**
   * The curated character's element, or null.
   *
   * Comes only from `characters.element` by way of `characterId` — never
   * from the name, the category or the series (ADR-0034). Null is the normal
   * case, not missing data.
   */
  element: Element | null;
  /**
   * Curated character link, or null.
   *
   * NULL is the normal case, not missing data: traps, vehicles, crystals and
   * magic items are not characters at all, and only a curated subset of the
   * figures is assigned so far. Never derived from the name (ADR-0034).
   */
  characterId: number | null;
};

export type SeriesOption = {
  code: string;
  label: string;
  position: number;
};

/** A figure in someone's collection, with the quantity they own. */
export type CollectionEntry = {
  figure: CatalogFigure;
  quantity: number;
};
