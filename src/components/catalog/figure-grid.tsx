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
 */
import type { ReactNode } from "react";

export function FigureGrid({
  children,
  /** The collection shows fewer figures, so it gives them more room. */
  dense = true,
}: {
  children: ReactNode;
  dense?: boolean;
}) {
  return (
    <div
      className={
        "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 " +
        (dense ? "xl:grid-cols-5" : "")
      }
    >
      {children}
    </div>
  );
}
