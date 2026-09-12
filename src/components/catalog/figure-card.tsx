/**
 * One figure, as a collector's card.
 *
 * TWO LAYERS, AND A GRID THAT DECIDES EVERYTHING
 *
 * `designs/cards/silver.png` and `gold.png` are finished artwork — frame,
 * paper, gold, crown, the diamond rule, the silver plate. This component
 * draws none of that. What it does is put the dynamic parts in the bands the
 * artwork already marks out.
 *
 * Those bands are `ROWS` in `card-template.ts`: nine rows measured off the
 * templates that sum to exactly 100 %. Everything is placed by grid area —
 * there is no `margin-top` anywhere in this file, no `justify-between` down
 * the page, no leftover space for a long name to push into. A two-line name
 * fills its own row and moves nothing.
 *
 * THE STACK, BOTTOM TO TOP
 *
 *   1  under-grid    white window fill, then the figure
 *   2  the template  frame, paper, gold, crown, rule, plate
 *   3  over-grid     variant seal, status, copies, and every text
 *
 * Two grids rather than one, because the template has to sit BETWEEN the
 * figure and the badges. Both are built from the same `ROWS`, so their
 * geometry cannot drift apart.
 *
 * POSSESSION IS THE WHOLE CARD: `gold.png` when it is yours, `silver.png`
 * when it is not. Nothing else in the layout changes between the two.
 *
 * The body is either a link or a toggle, never both, and the trade row is a
 * sibling rather than a child — so nothing is nested inside anything
 * clickable and no event has to be stopped from bubbling.
 */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { VariantSeal } from "@/components/catalog/variant-seal";
import {
  CARD_ASPECT,
  GRID_AREAS,
  GRID_ROWS,
  INSET,
  LAYOUT_DEBUG,
  TEMPLATE,
  WINDOW_FILL,
  type CardArea,
} from "@/lib/catalog/card-template";
import { duplicateBadge, marksOwnership, type CardOwnership } from "@/lib/catalog/card";
import { elementLabel } from "@/lib/catalog/element";
import { imageSrc } from "@/lib/catalog/image";
import type { CatalogFigure } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/** Both grid layers, from one set of measurements. */
const GRID: CSSProperties = {
  gridTemplateRows: GRID_ROWS,
  gridTemplateAreas: GRID_AREAS,
};

/**
 * A slot. `data-slot` is what the debug mode paints, and what a test can find.
 *
 * `minHeight: 0` on every one of them: a grid row with a fixed height will
 * otherwise be stretched by content that does not fit, which is exactly the
 * failure this grid exists to prevent. Anything too big is clipped and seen,
 * rather than silently pushing its neighbours.
 */
function Slot({
  area,
  className = "",
  children,
}: {
  area: CardArea;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot={area}
      className={`relative min-h-0 ${className}`}
      style={{ gridArea: area }}
    >
      {children}
    </div>
  );
}

export function FigureCard({
  figure,
  trade,
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
  notice,
  interactive = true,
  muted = false,
}: {
  figure: CatalogFigure;
  /** What stands on the silver plate. Its row is painted into the artwork. */
  trade?: ReactNode;
  /** A deep link landed on this card (`?highlight=SKY-0042`). Neutral. */
  highlighted?: boolean;
  /** Real collection state, never derived. Decides which template is drawn. */
  collected?: boolean;
  /** Which question this card answers about ownership. */
  ownership?: CardOwnership;
  /** How many are owned. Only shown above one. */
  quantity?: number;
  showSeries?: boolean;
  /** Where the body leads. Defaults to the figure's detail page. */
  href?: string;
  /** Makes the body a toggle instead of a link. */
  onToggle?: () => void;
  toggleLabel?: string;
  /** Replaces the name — the administrator's inline editor (ADR-0042). */
  nameSlot?: ReactNode;
  /** A chip over the window: "Verborgen". */
  statusBadge?: ReactNode;
  /** Something that went wrong and has to be said on this card. */
  notice?: ReactNode;
  /** Whether the body is interactive at all. An admin card is not (ADR-0042). */
  interactive?: boolean;
  /** Dims the card without changing its layout — a hidden figure. */
  muted?: boolean;
}) {
  const copies = duplicateBadge(quantity);
  const owned = marksOwnership(ownership, collected);
  const template = owned ? TEMPLATE.owned : TEMPLATE.plain;
  const picture = imageSrc(figure);

  const body = (
    <>
      {/*
       * LAYER 1 — under the template.
       *
       * The white is not in the grid: the window is a real hole with a soft
       * edge, and the fill has to bleed past it on every side (`WINDOW_FILL`).
       * A grid row would cut it to the row.
       */}
      <div
        className="absolute bg-template-window"
        style={{
          top: WINDOW_FILL.top,
          right: WINDOW_FILL.right,
          bottom: WINDOW_FILL.bottom,
          left: WINDOW_FILL.left,
        }}
        aria-hidden="true"
      />

      <div className="absolute inset-0 grid" style={GRID}>
        <Slot area="image" className="px-[10.8%]">
          {picture ? (
            /* ADR-0026: already optimised to 640 px, content-addressed and
               served from /public, so next/image would re-optimise at runtime
               and bill image units for no gain. Sizing untouched. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={picture}
              alt={figure.displayName}
              loading="lazy"
              decoding="async"
              width={640}
              height={640}
              className="h-full w-full object-contain"
            />
          ) : (
            /* 27 collectibles genuinely have no picture. An empty window, not
               an error — and dark ink, because the window is white. */
            <span className="flex h-full w-full items-center justify-center text-[11px] text-template-ink-muted">
              {de.catalog.noImage}
            </span>
          )}
        </Slot>
      </div>

      {/*
       * LAYER 2 — the artwork. Frame, paper, gold, crown, rule, plate.
       * `pointer-events-none` so it never eats a tap meant for the card.
       */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={template.src}
        srcSet={`${template.small} 400w, ${template.src} 640w`}
        sizes="(max-width: 640px) 50vw, 220px"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
      />

      {/* LAYER 3 — everything that goes ON the artwork. */}
      <div
        className="pointer-events-none absolute inset-0 grid"
        style={GRID}
        data-card-layout-debug={LAYOUT_DEBUG ? "" : undefined}
      >
        <Slot area="image" className="px-[10.8%]">
          {figure.sortVariantLabel ? <VariantSeal label={figure.sortVariantLabel} /> : null}
          {statusBadge}
          {copies !== null && !owned ? (
            /*
             * Only where the meta line does not already carry it. In the
             * catalog an owned card says "◆ In deiner Sammlung · 2×" in
             * words; in the showcase nothing is marked as owned, so the chip
             * over the picture is the only place the count can go.
             */
            <span
              className={
                "absolute bottom-1 left-[12%] rounded-full bg-black/70 px-1.5 py-0.5 " +
                "text-[10px] leading-none font-semibold text-white tabular-nums"
              }
            >
              <span aria-hidden="true">{copies}×</span>
              <span className="sr-only">{de.collection.copies(copies)}</span>
            </span>
          ) : null}
          {notice}
        </Slot>

        {/*
         * The name owns its row and nothing else. Two lines at most, centred
         * in the row whether it needs one line or two — which is why the
         * market value below starts at the same height on every card.
         */}
        {/* Empty by design, and present so the debug mode can show that they
            are: `pad` is the air under the window, `sep` is where the artwork
            paints its diamond rule. Reserving them as rows is what keeps text
            off the ornament. */}
        <Slot area="pad" />
        <Slot area="sep" />

        <Slot area="name" className="flex items-center justify-center px-[13%]">
          {nameSlot ?? (
            /* The base name: the finish is on the seal over the window, so
               "Bash" rather than "Bash (Legendary)". `title` keeps the full
               spelling reachable. */
            <span
              className="line-clamp-2 text-center text-[clamp(9px,6.2cqw,15px)] leading-[1.15] font-semibold text-template-ink"
              title={figure.displayName}
            >
              {figure.sortBaseName}
            </span>
          )}
        </Slot>

        {/*
         * The market value: a small label over a large number, centred in its
         * own row. Labelled because the plate at the foot carries a price too,
         * and the two must never be read as one figure (ADR-0033).
         *
         * `justify-end` inside the row: the block sits at the foot of its
         * band, just above the painted rule, rather than floating in it.
         */}
        <Slot area="market" className="flex flex-col justify-end gap-[4%] px-[13%] pb-[3%] text-center">
          <span className="block text-[clamp(7px,4.1cqw,9.5px)] leading-none font-medium tracking-[0.1em] text-template-ink-muted uppercase">
            {de.catalog.marketValue}
          </span>
          <span
            className={
              "block text-[clamp(11px,7cqw,16px)] leading-none font-bold whitespace-nowrap tabular-nums " +
              // A missing price is a genuinely muted state; a known one is not.
              (figure.marketPrice === null ? "text-template-ink-muted" : "text-template-ink")
            }
          >
            {figure.marketPrice === null ? de.catalog.noPrice : formatPrice(figure.marketPrice)}
          </span>
        </Slot>

        {/*
         * One line: ownership at the left, element at the right.
         *
         * `minmax(0, 1fr) auto` — the ownership column may shrink, the element
         * never does, and the two cannot overlap however narrow the card gets.
         * Both are `nowrap`; the type shrinks with the card instead.
         */}
        <Slot area="meta" className="px-[13%] text-[clamp(8px,4.6cqw,10.5px)] leading-[1.1] font-medium text-template-ink">
          <div
            className="grid h-full items-center gap-[4%]"
            style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}
          >
            {/*
             * `truncate` is the last resort and never fires at a real width —
             * at the narrowest card the line still has 11 px to spare. It is
             * here so that "no overlap is possible" is a guarantee rather
             * than an arithmetic result: the column may shrink to nothing,
             * and the element beside it still cannot be reached.
             */}
            <span className="min-w-0 truncate text-left whitespace-nowrap">
              {owned ? (
                <>
                  {/* Smaller than the words it marks: every pixel the bullet
                      takes is one the ownership text needs. */}
                  <span aria-hidden="true" className="text-[0.8em]">
                    ◆{" "}
                  </span>
                  {de.catalog.collectedBadge}
                  {copies !== null ? ` · ${copies}×` : ""}
                </>
              ) : !figure.isActive ? (
                /* Out of range. Rare, administrator-facing, and it takes the
                   series' place rather than adding a line. */
                de.catalog.inactive
              ) : showSeries ? (
                figure.seriesLabel
              ) : null}
            </span>
            <span className="whitespace-nowrap">
              {figure.element ? elementLabel(figure.element) : null}
            </span>
          </div>
        </Slot>
      </div>
    </>
  );

  const bodyClass = "absolute inset-0 block text-left";

  return (
    <article
      // `@container` so every `cqw` above is a share of THIS card's width.
      // The grid is four columns from 768 px and five from 1280 px, where a
      // card is as narrow as on a phone — a viewport breakpoint would size
      // the type for a screen the card does not have.
      className={
        "@container group relative w-full " +
        (highlighted ? "rounded-sky-lg outline outline-2 outline-offset-2 outline-nav-active-ink " : "") +
        // Dimmed, not hidden: the administrator has to be able to see and
        // reach a figure they took out of the public catalog.
        (muted ? "opacity-60" : "")
      }
      style={{ aspectRatio: CARD_ASPECT }}
    >
      {!interactive ? (
        /* Static body: the picture is a picture. An administrator's actions
           are named controls, never a tap on the card (ADR-0042). */
        <div className={bodyClass}>{body}</div>
      ) : onToggle ? (
        <button type="button" onClick={onToggle} aria-pressed={collected} className={bodyClass}>
          {body}
          <span className="sr-only">
            {collected ? de.catalog.collected : ""} {toggleLabel}
          </span>
        </button>
      ) : (
        <Link href={href ?? `/skylanders/${figure.slug}`} className={bodyClass}>
          {body}
          {owned ? <span className="sr-only">{de.catalog.collectedBadge}</span> : null}
        </Link>
      )}

      {/*
       * The trade row, in its own grid so it stays a sibling of the body and
       * therefore its own target. Same `ROWS`, so it lands exactly on the
       * plate the artwork paints — and it can never move anything above it.
       */}
      <div
        className="pointer-events-none absolute inset-0 grid"
        style={GRID}
        data-card-layout-debug={LAYOUT_DEBUG ? "" : undefined}
      >
        <Slot area="trade" className="pointer-events-auto px-[10.1%]">
          {trade}
        </Slot>
      </div>
    </article>
  );
}
