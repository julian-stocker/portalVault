/**
 * How the catalogue draws its figures (UX-01C, ADR-0148).
 *
 * Two presentations of the same figure, and the switch between them is a
 * question about DRAWING, never about narrowing: it changes no filter, no
 * search, no series, no sort and no grouping. That is why it sits in the
 * toolbar beside the count and not inside the filter sheet — the same rule
 * `src/lib/ui/browse.test.ts` already holds the collection to.
 *
 *   cards  the collector's card on its artwork  (FigureCard)
 *   rows   the horizontal row                  (FigureRow)
 *
 * ITS OWN KEY, AND NOT THE COLLECTION'S. `skyisles.collection.view` chooses
 * between CARDS AND A TABLE; this chooses between TWO KINDS OF CARD. Sharing
 * one value would force "table" to mean something in the catalogue, which is
 * a feature nobody asked for — and a stored value from one surface would
 * arrive at the other meaning something else. Two keys, two questions.
 */
import { createViewStore } from "@/lib/ui/view-store";

/** The two presentations, in display order. */
export const CATALOG_VIEWS = ["cards", "rows"] as const;
export type CatalogView = (typeof CATALOG_VIEWS)[number];

/**
 * What the catalogue opens on.
 *
 * THE CLASSIC CARD, by the operator's decision. The collection defaults to
 * its table because a large collection is read before it is browsed; the
 * catalogue is the opposite — it is a vitrine, and the card is what a
 * collector comes to see. Anyone who prefers the list gets it back on every
 * later visit.
 */
export const DEFAULT_CATALOG_VIEW: CatalogView = "cards";

/** The one place the catalogue's choice is remembered. */
export const catalogViewStore = createViewStore<CatalogView>({
  key: "skyisles.catalog.view",
  values: CATALOG_VIEWS,
  fallback: DEFAULT_CATALOG_VIEW,
});

/**
 * Which presentation `CatalogCard` should draw.
 *
 * A function rather than a cast, because the two vocabularies are allowed to
 * differ: this module names a VIEW ("cards", "rows") and the card names a
 * LAYOUT ("card", "row"). They happen to map one to one today, and a rename
 * on either side should fail here rather than silently in the markup.
 */
export function layoutFor(view: CatalogView): "card" | "row" {
  return view === "rows" ? "row" : "card";
}
