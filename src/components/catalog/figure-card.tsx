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
 * Design V2 took the frame off: no border, no colour cap, no check badge, no
 * bordered pill. V2.1 gave one back, and only one — a warm amber frame around
 * a figure that is owned **in the catalog**. A collected piece should look
 * like a piece in a case, and a frame says that without a word of interface
 * text. The chip that used to spell it out is gone: on a narrow card it
 * truncated, and it said in six words what the frame says at a glance.
 *
 * The frame is a catalog answer to "do I already have this one?", so
 * `ownership` says which question the card is being asked rather than the
 * card inferring it. In the showcase every figure is owned, and framing all
 * of them would water the frame down to decoration (ADR-0038).
 *
 * The body is either a link or a toggle, never both, and the footer action is
 * a sibling rather than a child — so nothing is nested inside anything
 * clickable and no event has to be stopped from bubbling.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { FigureImage } from "@/components/catalog/figure-image";
import {
  cardSurfaceClass,
  duplicateBadge,
  marksOwnership,
  type CardOwnership,
} from "@/lib/catalog/card";
import { elementChipClass, elementLabel } from "@/lib/catalog/element";
import type { CatalogFigure } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export function FigureCard({
  figure,
  footer,
  highlighted = false,
  collected = false,
  ownership = "showcase",
  quantity,
  showSeries = true,
  href,
  onToggle,
  toggleLabel,
}: {
  figure: CatalogFigure;
  /** Sits below the body, as a sibling — never inside the clickable area. */
  footer?: ReactNode;
  highlighted?: boolean;
  /**
   * Real collection state, never derived. Drives `aria-pressed`, and the
   * vitrine frame where `ownership` asks for it.
   */
  collected?: boolean;
  /**
   * Which question this card answers about ownership. Only the catalog draws
   * the frame; the default leaves cards neutral.
   */
  ownership?: CardOwnership;
  /**
   * How many are owned. Only shown above one: a "1×" on every card would be
   * noise, and in the showcase every card is owned anyway.
   */
  quantity?: number;
  /**
   * The catalog switches this off: a series is always selected there, so the
   * label would repeat the active tab on all 102 cards. The collection and
   * the related figures on a detail page mix series, and keep it.
   */
  showSeries?: boolean;
  /** Where the body leads. Defaults to the figure's detail page. */
  href?: string;
  /**
   * Makes the body a toggle button instead of a link. `collected` then also
   * drives `aria-pressed`, and `toggleLabel` states what a press would do.
   */
  onToggle?: () => void;
  toggleLabel?: string;
}) {
  const copies = duplicateBadge(quantity);
  const framed = marksOwnership(ownership, collected);

  const inner = (
    <>
      <div className="relative">
        <FigureImage file={figure.imageFile} name={figure.displayName} />
        {copies !== null ? (
          /* The only thing ever drawn over a figure, and only when it says
             something a label cannot: that there is more than one. Stays in
             the showcase, where the frame does not. */
          <span
            className={
              "absolute right-2 bottom-2 rounded-full bg-on-plate/85 px-2 py-0.5 " +
              "text-[11px] leading-none font-medium text-plate tabular-nums"
            }
          >
            <span aria-hidden="true">{copies}×</span>
            <span className="sr-only">{de.collection.copies(copies)}</span>
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-0.5">
        {/* Two lines at most. `title` keeps the full name reachable — the
            longest in the catalog is 39 characters. */}
        <span className="line-clamp-2 text-sm leading-snug font-medium" title={figure.displayName}>
          {figure.displayName}
        </span>

        {/* Pinned to the bottom of the text area, so price and metadata line
            up across a row whether a name took one line or two. */}
        <div className="mt-auto flex flex-col gap-1">
          {/* A reference market value, not a shop price (ADR-0033). */}
          <span
            className={
              "text-[15px] leading-none font-semibold tabular-nums " +
              (figure.marketPrice === null ? "text-muted" : "")
            }
          >
            {figure.marketPrice === null ? de.catalog.noPrice : formatPrice(figure.marketPrice)}
          </span>

          {showSeries || figure.element ? (
            <span className="flex min-w-0 items-baseline gap-1.5 text-[11px] leading-tight">
              {showSeries ? (
                <span className="min-w-0 truncate text-muted">{figure.seriesLabel}</span>
              ) : null}
              {showSeries && figure.element ? (
                <span aria-hidden="true" className="text-border-strong">
                  ·
                </span>
              ) : null}
              {figure.element ? (
                /* Named, never a bare coloured dot — the element has to be
                   readable without colour perception. */
                <span className={`shrink-0 font-medium ${elementChipClass(figure.element)}`}>
                  {elementLabel(figure.element)}
                </span>
              ) : null}
            </span>
          ) : null}

          {figure.isActive ? null : (
            <span className="text-[11px] text-muted">{de.catalog.inactive}</span>
          )}
        </div>
      </div>
    </>
  );

  const bodyClass = "flex flex-1 flex-col gap-2.5 text-left";

  return (
    /* h-full + flex-col so a row of cards ends at the same height, and the
       footer lands on one line no matter how long the names above it are. */
    <article
      className={
        "group relative flex h-full flex-col overflow-hidden rounded-sky-lg p-2.5 " +
        "shadow-card transition-shadow hover:shadow-raised " +
        // A warm ring and a slightly warmer surface, not a success state: no
        // green, no glow, no second border weight. Catalog only.
        cardSurfaceClass(ownership, collected) +
        (highlighted ? " ring-2 ring-accent" : "")
      }
    >
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-pressed={collected} className={bodyClass}>
          {inner}
          {/* The state in words, for anyone who cannot see the frame. The
              visible content stays the accessible name; this is added to it
              rather than replacing it with an aria-label. */}
          <span className="sr-only">
            {collected ? de.catalog.collected : ""} {toggleLabel}
          </span>
        </button>
      ) : (
        <Link href={href ?? `/skylanders/${figure.slug}`} className={bodyClass}>
          {inner}
          {/* The textual equivalent of the frame, and only where the frame is:
              in the showcase it would repeat on every card. */}
          {framed ? <span className="sr-only">{de.catalog.collectedBadge}</span> : null}
        </Link>
      )}

      {footer ? <div className="mt-2.5">{footer}</div> : null}
    </article>
  );
}
