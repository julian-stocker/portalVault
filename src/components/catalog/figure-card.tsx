/**
 * One figure.
 *
 * Shows `displayName`, the derived spelling — "Astroblast (Legendary)" where
 * the canonical name is "Legendary Astroblast" (ADR-0030). The raw name stays
 * in the database untouched, and no name is parsed here.
 *
 * The card is the vitrine (ADR-0035): canvas → surface → plate. The middle
 * tone matters most in the dark theme, where a light plate straight on the
 * near-black canvas has nothing to sit on.
 *
 * Shared by the catalog, the collection and the related figures on a detail
 * page. Every context-specific part arrives as a prop — the action, whether
 * the figure is collected, whether it is highlighted — so the card never
 * assumes where it is being rendered.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { FigureImage } from "@/components/catalog/figure-image";
import { elementAccentClass, elementChipClass, elementLabel } from "@/lib/catalog/element";
import type { CatalogFigure } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export function FigureCard({
  figure,
  action,
  highlighted = false,
  collected = false,
  quantity,
}: {
  figure: CatalogFigure;
  action?: ReactNode;
  highlighted?: boolean;
  /**
   * Comes from the real collection state the caller already holds. The card
   * neither reads nor writes anything — it only shows what it is given.
   */
  collected?: boolean;
  /**
   * How many are owned. Only shown above one: a "1×" on every card would be
   * noise, and the check badge already says "owned".
   */
  quantity?: number;
}) {
  return (
    /* h-full + flex-col so a row of cards ends at the same height, and the
       action lands on one line no matter how long the names above it are. */
    <article
      className={
        "relative flex h-full flex-col gap-2 overflow-hidden rounded-sky-lg border " +
        "bg-surface p-2 shadow-card " +
        (highlighted ? "border-accent ring-2 ring-accent" : "border-border")
      }
    >
      {figure.element ? (
        /* A 2 px cap, nothing more. It sits on the card rather than on the
           plate, because the plate is light in both themes while these
           tokens follow the theme. A figure without a curated element simply
           has no cap — that is the standard card, not a lesser one. */
        <span
          aria-hidden="true"
          className={`absolute inset-x-0 top-0 h-0.5 ${elementAccentClass(figure.element)}`}
        />
      ) : null}
      {/* The whole card leads to the detail page; the action sits outside the
          link so a tap on it cannot navigate away by accident. */}
      <Link href={`/skylanders/${figure.slug}`} className="flex flex-1 flex-col gap-2">
        <div className="relative">
          <FigureImage file={figure.imageFile} name={figure.displayName} />
          {collected ? (
            /* Readable while scrolling, without a second big action and
               without covering the figure. A glyph plus a dark pill, not
               colour alone — and `--on-plate` is fixed because the plate is
               light in both themes. */
            <span className="absolute top-1.5 right-1.5 rounded-full bg-on-plate/90 px-1.5 py-0.5 text-[11px] leading-none font-medium text-plate">
              <span aria-hidden="true">✓</span>
              <span className="sr-only">{de.catalog.collectedBadge}</span>
              {quantity !== undefined && quantity > 1 ? (
                <span className="ml-1 tabular-nums">
                  <span aria-hidden="true">{quantity}×</span>
                  <span className="sr-only">, {de.collection.copies(quantity)}</span>
                </span>
              ) : null}
            </span>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-1">
          {/* Two lines at most. `title` keeps the full name reachable — the
              longest in the catalog is 39 characters. */}
          <span
            className="line-clamp-2 text-sm leading-snug font-medium"
            title={figure.displayName}
          >
            {figure.displayName}
          </span>

          {/* Pinned to the bottom of the text area, so price and series line
              up across a row whether a name took one line or two. */}
          <div className="mt-auto flex flex-col items-start gap-1">
            <div className="flex w-full items-center justify-between gap-2">
              {/* A reference market value, not a shop price (ADR-0033): same
                  size as the name, no emphasis, tabular figures so a column
                  of them reads as a column. */}
              <span
                className={
                  "text-sm tabular-nums " + (figure.marketPrice === null ? "text-muted" : "")
                }
              >
                {figure.marketPrice === null ? de.catalog.noPrice : formatPrice(figure.marketPrice)}
              </span>

              {figure.element ? (
                /* Named, never a bare coloured dot — the element has to be
                   readable without colour perception. Sits opposite the
                   collected badge, which is up on the plate, so the two
                   never crowd each other. */
                <span
                  className={
                    "shrink-0 rounded-full border border-current/40 px-1.5 py-0.5 " +
                    "text-[11px] leading-none font-medium " +
                    elementChipClass(figure.element)
                  }
                >
                  {elementLabel(figure.element)}
                </span>
              ) : null}
            </div>

            <span className="max-w-full truncate rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted">
              {figure.seriesLabel}
            </span>

            {figure.isActive ? null : (
              <span className="text-[11px] text-muted">{de.catalog.inactive}</span>
            )}
          </div>
        </div>
      </Link>

      {action ? <div className="mt-auto">{action}</div> : null}
    </article>
  );
}
