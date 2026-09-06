/**
 * One figure.
 *
 * Shows `displayName`, the derived spelling — "Astroblast (Legendary)" where
 * the canonical name is "Legendary Astroblast" (ADR-0030). The raw name stays
 * in the database untouched, and no name is parsed here.
 *
 * The card is the lit display piece in a dark room (ADR-0038, V3): sky →
 * ivory card → white plate. It is ivory in both colour schemes, exactly as
 * the plate is white in both — "cards brighter than their surround" is the
 * whole composition, and a card that inverted with the theme would take that
 * away. Its text therefore uses the fixed `--on-card` ink rather than the
 * theme-following `--foreground`.
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
import { CollectedCrown } from "@/components/catalog/collected-crown";
import {
  cardSurfaceClass,
  duplicateBadge,
  marksOwnership,
  type CardOwnership,
} from "@/lib/catalog/card";
import { elementChipClass, elementLabel } from "@/lib/catalog/element";
import { imageSrc } from "@/lib/catalog/image";
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
  nameSlot,
  statusBadge,
  offerSlot,
  interactive = true,
  muted = false,
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
  /**
   * Replaces the name with something else — the administrator's inline
   * editor (ADR-0042). The card keeps its layout; only what stands in the
   * name's place changes.
   */
  nameSlot?: ReactNode;
  /** A chip over the image, beside where the crown sits. "Verborgen". */
  statusBadge?: ReactNode;
  /**
   * What SkyIsles asks for this figure, under the market value (ADR-0043).
   *
   * A slot rather than the offer itself, so the card stays a description of
   * a figure: the catalog fills it, the collection and the related figures
   * beside a detail page leave it empty, and this file never learns what an
   * offer is.
   */
  offerSlot?: ReactNode;
  /**
   * Whether the body is a link or a toggle at all. An administrator's card
   * is neither: its actions are named controls in the footer, so nothing
   * happens by tapping the picture (ADR-0042).
   */
  interactive?: boolean;
  /** Dims the card without changing its layout — used for a hidden figure. */
  muted?: boolean;
}) {
  const copies = duplicateBadge(quantity);
  const framed = marksOwnership(ownership, collected);

  const inner = (
    <>
      <div className="relative">
        <FigureImage src={imageSrc(figure)} name={figure.displayName} />
        {/* The seal, catalog only — `marksOwnership` is the same rule the
            frame follows, so the two can never disagree. */}
        {framed ? <CollectedCrown /> : null}
        {statusBadge}
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
        {nameSlot ?? (
          <span
            className="line-clamp-2 text-sm leading-snug font-semibold text-on-card"
            title={figure.displayName}
          >
            {figure.displayName}
          </span>
        )}

        {/* Pinned to the bottom of the text area, so price and metadata line
            up across a row whether a name took one line or two. */}
        <div className="mt-auto flex flex-col gap-1">
          {/* A reference market value, not a shop price (ADR-0033). */}
          <span
            className={
              "text-base leading-none font-semibold tabular-nums " +
              (figure.marketPrice === null ? "text-on-card-muted" : "text-on-card")
            }
          >
            {figure.marketPrice === null ? de.catalog.noPrice : formatPrice(figure.marketPrice)}
          </span>

          {/* Directly under the market value, because that is the comparison
              being offered: what it is worth, and what SkyIsles asks. Two
              facts, never one price correcting the other (ADR-0033). */}
          {offerSlot}

          {showSeries || figure.element ? (
            <span className="flex min-w-0 items-baseline gap-1.5 text-[11px] leading-tight">
              {showSeries ? (
                <span className="min-w-0 truncate text-on-card-muted">{figure.seriesLabel}</span>
              ) : null}
              {showSeries && figure.element ? (
                <span aria-hidden="true" className="text-card-border">
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
            <span className="text-[11px] text-on-card-muted">{de.catalog.inactive}</span>
          )}
        </div>
      </div>
    </>
  );

  // `relative` so the content sits above the owned card's inner light,
  // which is painted by ::after on the article.
  const bodyClass = "relative flex flex-1 flex-col gap-2.5 text-left";

  return (
    /* h-full + flex-col so a row of cards ends at the same height, and the
       footer lands on one line no matter how long the names above it are. */
    <article
      className={
        // `overflow-hidden` is gone: the owned frame draws inset rings via
        // ::before/::after, and clipping would cut their corners.
        "group relative flex h-full flex-col rounded-sky-lg p-2.5 " +
        "shadow-card transition-shadow hover:shadow-raised " +
        cardSurfaceClass(ownership, collected) +
        (highlighted ? " ring-2 ring-accent" : "") +
        // Dimmed, not hidden: the administrator has to be able to see and
        // reach a figure they took out of the public catalog.
        (muted ? " opacity-60" : "")
      }
    >
      {!interactive ? (
        /* Static body: the picture is a picture. An administrator's actions
           are named controls in the footer, never a tap on the card
           (ADR-0042) — on a phone that would be one mis-tap away from hiding
           a figure from the public catalog. */
        <div className={bodyClass}>{inner}</div>
      ) : onToggle ? (
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

      {footer ? <div className="relative mt-2.5">{footer}</div> : null}
    </article>
  );
}
