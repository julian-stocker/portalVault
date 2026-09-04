/**
 * The shape the catalog UI works with.
 *
 * Deliberately flat and narrow: only what a card or a detail page renders.
 * Whatever the database grows, the browser keeps receiving this and nothing
 * more (ADR-0026).
 */
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
  /** null means "no known market price" — never 0 (ADR-0010). */
  marketPrice: number | null;
  /** Content-addressed WebP file name, or null when no image exists. */
  imageFile: string | null;
  isActive: boolean;
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
