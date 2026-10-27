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
 * THE RULE BEHIND THE NUMBER: a row in two columns must never be narrower
 * than a row on the largest phone. 52 rem is 832 px (`TWO_COLUMN_AT_REM`),
 * which splits into two rows of 410 px and 241 px of text block — just above
 * the 237 px a 414 px phone gives. So a tablet at 768 px stays one column,
 * not because two would be unusable there but because they would be narrower
 * than the phone this design is tuned for.
 *
 * TWO IS THE CEILING, on purpose. A third column at `max-w-6xl` would leave
 * each row 373 px — narrower than the two-column case it replaced — and four
 * horizontal rows side by side stop being a list and become a worse grid of
 * cards. The cards already do that job better.
 *
 * Tighter gaps than the cards: rows are separated by their own grounds and
 * edges, so the air between them is a seam rather than a margin.
 */
const ROWS =
  "grid grid-cols-1 gap-2 @min-[52rem]:grid-cols-2 @min-[52rem]:gap-3";

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
     * Two elements, because a container query needs something to measure.
     * `@container` turns the outer box into the query's subject; the grid
     * inside it asks about that box rather than about the viewport.
     *
     * The wrapper draws nothing and is not a stacking hazard for the quick
     * view: the dialog is a sibling of this grid, owned by the page, never a
     * descendant of it (IR-001).
     */
    return (
      <div className="@container">
        <div className={ROWS}>{children}</div>
      </div>
    );
  }

  return <div className={CARDS + (dense ? " xl:grid-cols-5" : "")}>{children}</div>;
}
