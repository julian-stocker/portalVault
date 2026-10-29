/**
 * The grid.
 *
 * Layout only since V2.1: the cards differ between catalog and collection —
 * one is a toggle, the other carries a remove action — but the geometry is
 * the same, and it used to be written out twice.
 *
 * Two columns on the narrowest phones, growing with the viewport. No
 * virtualisation: 600 cards with lazily loaded images measured fine, and
 * adding it before a problem exists would be optimising a guess (ADR-0026).
 *
 * Five columns is the ceiling. A sixth was measured and dropped: the
 * container is capped at max-w-6xl, so a 2xl step would only shrink each
 * card from 214 px to 177 px without using any extra width.
 *
 * SINCE UX-01C IT ALSO LAYS OUT ROWS (ADR-0148), and it is still layout only:
 * which presentation a figure gets is `CatalogCard`'s business, and this
 * decides nothing but how many of them stand beside each other.
 */
import type { ReactNode } from "react";

/** What is being laid out. The two geometries have nothing in common. */
export type GridMode = "cards" | "rows";

/**
 * The cards, unchanged — and the string is unchanged on purpose.
 *
 * `src/lib/catalog/accessory-grid.test.ts` holds `accessory-view.tsx` against
 * this exact literal, so that the accessory area and the figure catalogue
 * cannot drift apart. Splitting it into pieces would break that check
 * without changing a pixel.
 */
const CARDS = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4";

/**
 * The rows.
 *
 * A CONTAINER QUERY, NOT A VIEWPORT BREAKPOINT (UX-01C, Designkorrektur).
 *
 * The question "one column or two" is about how wide a ROW would be, and
 * that is the container's width — not the screen's. A viewport breakpoint
 * answers it correctly only as long as this grid happens to span the page;
 * put the same list in a narrower column on some later surface and `lg:`
 * would promise two columns in 400 px. `@container` asks the box itself.
 *
 * NO BREAKPOINT AT ALL SINCE UX-01E, AND THAT IS THE BETTER ANSWER TO THE
 * SAME QUESTION. A container query still asks at ONE threshold: 52 rem, two
 * columns, and nothing in between. `repeat(auto-fill, …)` asks continuously —
 * it fits as many tiles of at least `TILE_MIN` as the real width holds, at
 * every width, with no number to keep in step with the page's own layout.
 *
 * THE FIRST ATTEMPT PUT THE 520 px CAP IN THE TRACK, AND THAT WAS THE BUG.
 * `minmax(min(360px,100%), 520px)` reads as "between 360 and 520", but it
 * also decides HOW MANY tracks there are — and `auto-fill` counts repetitions
 * by the track's MAXIMUM sizing function whenever that maximum is definite.
 * 520 px is definite, so the browser asked how many 520 px tiles fit, not how
 * many 360 px ones:
 *
 *     container 1120 → floor((1120+12) / (520+12)) = 2
 *     container  968 → floor(( 968+12) / 532)      = 1
 *
 * and three tracks would have needed 3 × 520 + 2 × 12 = 1584 px of container,
 * which `max-w-6xl` never gives. So on a normal laptop window the grid drew
 * ONE tile of 520, centred by `justify-center`, with the rest of the page
 * empty either side. Exactly what the desktop review found — and the
 * arithmetic meant to prevent it had divided by the MINIMUM, so it confirmed
 * a model the browser does not use.
 *
 * THE CAP THEREFORE BELONGS TO THE TILE, NOT TO THE TRACK. Two statements:
 *
 *   min(360px, 100%)  a tile is never narrower than 360 px, and never wider
 *                     than its container either — which is what stops a
 *                     360 px track from overflowing a 328 px phone. With the
 *                     maximum left indefinite, THIS is the figure `auto-fill`
 *                     counts by, which is what was wanted all along.
 *   1fr               the tracks share the row equally and use all of it, so
 *                     no `justify-content` is needed and nothing is left over
 *                     to centre.
 *
 * The 520 px ceiling lives on `FigureRow` itself (`mx-auto max-w-[520px]`),
 * where it caps the TILE and not the count: a lone tile in a 736 px container
 * is 520 and centred in its own track, and a tile in a three-column row is
 * 365 because the track is.
 *
 * WHAT THAT GIVES, measured against `max-w-6xl` (the page's own ceiling, so
 * the container never exceeds 1120 px):
 *
 *   phone 328–382      1 tile, full width
 *   600                1 track of 600, tile capped to 520 and centred in it
 *   736  (tablet 768)  2 tiles of 362
 *   968  (laptop)      2 tiles of 478
 *   992  (1024)        2 tiles of 490
 *   1120 (1280, 1600)  3 tiles of 365
 *
 * THREE IS THE CEILING because the page is: `max-w-6xl` leaves 1120 px, and
 * a fourth tile would be 271 px — far below the 360 a tile needs. The
 * constant says 3; the arithmetic is what enforces it.
 *
 * A wider column gap than row gap: side by side, tiles need a seam the eye
 * reads as a gutter (12 px); stacked, they are separated by their own
 * grounds and edges, so 8 px is enough and 90 rows of catalogue stay short.
 */
const ROWS =
  "grid gap-x-3 gap-y-2 "
  + "grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]";

export function FigureGrid({
  children,
  /** The collection shows fewer figures, so it gives them more room. */
  dense = true,
  /**
   * Cards or rows (UX-01C).
   *
   * Defaults to `cards`, so every surface that does not pass it — the
   * collection, the accessory area, the figure page's siblings — lays out
   * exactly what it laid out before.
   */
  mode = "cards",
}: {
  children: ReactNode;
  dense?: boolean;
  mode?: GridMode;
}) {
  if (mode === "rows") {
    /*
     * ONE ELEMENT SINCE UX-01E. The container-query wrapper existed because
     * a query needs a subject to measure; `auto-fill` measures the grid
     * itself, so the grid IS the subject and the extra box had nothing left
     * to do. Still a width answered by the box rather than by the viewport —
     * put this list in a narrower column on some later surface and it lays
     * out for that column, which is the whole point of the question.
     */
    return <div className={ROWS}>{children}</div>;
  }

  return <div className={CARDS + (dense ? " xl:grid-cols-5" : "")}>{children}</div>;
}
