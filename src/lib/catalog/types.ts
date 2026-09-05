/**
 * The shape the catalog UI works with.
 *
 * Deliberately flat and narrow: only what a card or a detail page renders.
 * Whatever the database grows, the browser keeps receiving this and nothing
 * more (ADR-0026).
 */
import type { Element } from "@/lib/catalog/character";

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
  /** Content-addressed WebP file name, or null when no image exists. */
  imageFile: string | null;
  isActive: boolean;
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
