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

import { CollectedSeal } from "@/components/catalog/collected-seal";
import { NO_MARKET_BOOST, catalogDisplayMarketPrice } from "@/lib/catalog/market-boost";
import { VariantSeal } from "@/components/catalog/variant-seal";
import {
  CARD_ASPECT,
  COLLECTED_GLOW,
  COLLECTED_GLOW_OFFSET_X,
  COLLECTED_GLOW_SCALE_X,
  COLLECTED_GLOW_SCALE_Y,
  GRID_AREAS,
  GRID_ROWS,
  INSET,
  NAME_DROP,
  ARTWORK_TONE,
  artworkFor,
  LAYOUT_DEBUG,
  WINDOW_FILL,
  type CardArea,
} from "@/lib/catalog/card-template";
import {
  duplicateBadge, marksOwnership, understatesCard, UNCOLLECTED_SCALE, type CardOwnership,
} from "@/lib/catalog/card";
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
  style,
  children,
}: {
  area: CardArea;
  className?: string;
  /**
   * Extra style for the slot — in practice the horizontal inset from `INSET`.
   *
   * A style rather than a class because a Tailwind arbitrary value has to be
   * a literal in the source to be generated: `px-[${INSET.text}]` compiles to
   * a class name with no rule behind it. The grid area is merged in below so
   * a caller cannot lose it by passing a style of its own.
   */
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot={area}
      className={`relative min-h-0 ${className}`}
      style={{ ...style, gridArea: area }}
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
  knowsCollection = false,
  marketBoostPercent = NO_MARKET_BOOST,
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
  /**
   * Whether this surface knows the viewer's collection (V4.6).
   *
   * Off by default, so a surface that cannot answer "does he own this" does
   * not answer it by accident. Only the signed-in catalog turns it on — see
   * `understatesCard`.
   */
  knowsCollection?: boolean;
  /**
   * The temporary catalog market-value boost, in per cent (0094).
   *
   * EXPLICIT, AND ZERO BY DEFAULT. This card is rendered by four surfaces and
   * only three of them are catalog surfaces: the catalog, the shop page and
   * the figure page's siblings pass the configured percentage, the COLLECTION
   * does not — there the card sits beside a collection total computed from
   * the stored price, and a boosted card would contradict it.
   *
   * A context or a module-level read would have made that distinction
   * invisible. As a prop, the list of places where the boost applies is the
   * list of call sites that pass it.
   *
   * It changes the printed number and nothing else. `figure.marketPrice` is
   * still the stored, canonical price, and it is what leaves this component
   * in every other direction.
   */
  marketBoostPercent?: number;
}) {
  const copies = duplicateBadge(quantity);
  const owned = marksOwnership(ownership, collected);
  /*
   * A figure the viewer does not own is drawn a hair smaller, on a shell
   * with the colour taken out of it. NOTHING ELSE CHANGES — see the two
   * places this is used below, and the rule in `globals.css`.
   */
  const understated = understatesCard(ownership, collected, knowsCollection);

  /*
   * WHICH CARD THIS FIGURE IS PRINTED ON (V3.6).
   *
   * The type decides the card, and that is the end of it. `figure.cardType`
   * is editorial and permanent — what the collectible IS — and nothing here
   * writes to it.
   *
   * `owned` no longer takes part. It used to pick between a pair of artworks;
   * since V3.6 it only decides whether `CollectedSeal` is drawn ON TOP, so the
   * card underneath is identical whoever is looking and nothing moves when a
   * figure is collected.
   *
   * `marksOwnership` stays exactly the boundary it already was. A surface
   * that asks for `ownership="showcase"` — the figure page's siblings — never
   * marks anything as owned, which is the same rule that kept the gold
   * template off those cards before.
   */
  const template = artworkFor(figure.cardType);
  /* One tone per card type. It follows the artwork, not the viewer. */
  const tone = ARTWORK_TONE[figure.cardType];
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
        <Slot area="image" style={{ paddingInline: INSET.image }}>
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
       *
       * THIS ELEMENT IS THE ONLY THING THE UNOWNED TREATMENT TOUCHES (V4.6).
       *
       * It is the whole shell and nothing but the shell: the frame, the
       * paper, the gilding, the crown, the struck rule and the trade plate
       * are all painted into this one PNG. Layer 1 is the white window and
       * the figure's own picture; layer 3 is the name, the variant seal, the
       * market value, the element and the copies badge; the trade row is a
       * fourth grid below. A filter here cannot reach any of them, which is
       * what makes "only the card design greys out" a structural fact rather
       * than a list of exceptions somebody has to maintain.
       */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={template.src}
        srcSet={`${template.small} 400w, ${template.src} 640w`}
        sizes="(max-width: 640px) 50vw, 220px"
        alt=""
        aria-hidden="true"
        draggable={false}
        className={
          "pointer-events-none absolute inset-0 h-full w-full select-none"
          + (understated ? " card-shell-unowned" : "")
        }
      />

      {/* LAYER 3 — everything that goes ON the artwork. */}
      <div
        className="pointer-events-none absolute inset-0 grid"
        style={GRID}
        data-card-layout-debug={LAYOUT_DEBUG ? "" : undefined}
      >
        <Slot area="image" style={{ paddingInline: INSET.image }}>
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

        <Slot area="name" className="flex items-center justify-center" style={{ paddingInline: INSET.text, transform: `translateY(${NAME_DROP})` }}>
          {nameSlot ?? (
            /*
             * THE NAME A VISITOR READS (V3.6).
             *
             * `displayName`, not `sortBaseName`. This showed the base name
             * until V3.6 — "Bash" for "Bash (Legendary)" — because the label
             * was already on the badge over the window and the two together
             * read as a stutter. Then the display rule turned round: a variant
             * is now called "Legendary Bash", the label is part of the name
             * rather than a suffix hanging off it, and showing only "Bash"
             * stopped being a tidier spelling of the same thing and started
             * being the wrong figure. A Granite Crusher is not a Crusher.
             *
             * `sortBaseName` keeps its job and only its job: it decides where
             * the card SITS, never what it SAYS. The two are deliberately
             * different values on `CatalogFigure` and must not be swapped.
             */
            <span
              className="line-clamp-2 text-center text-[clamp(9px,6.2cqw,15px)] leading-[1.15] font-semibold text-template-ink"
              title={figure.displayName}
            >
              {figure.displayName}
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
        <Slot area="market" className="flex flex-col justify-end gap-[4%] pb-[3%] text-center" style={{ paddingInline: INSET.text }}>
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
            {figure.marketPrice === null
              ? de.catalog.noPrice
              /* The boost is applied HERE, at the last possible moment, and
                 the stored price is what every other reader of this figure
                 still sees (0094). */
              : formatPrice(catalogDisplayMarketPrice(figure.marketPrice, marketBoostPercent))}
          </span>
        </Slot>

        {/*
         * One line: ownership at the left, element at the right.
         *
         * `minmax(0, 1fr) auto` — the ownership column may shrink, the element
         * never does, and the two cannot overlap however narrow the card gets.
         * Both are `nowrap`; the type shrinks with the card instead.
         */}
        <Slot area="meta" className="text-[clamp(8px,4.6cqw,10.5px)] leading-[1.1] font-medium text-template-ink" style={{ paddingInline: INSET.text }}>
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

      {/*
       * LAYER 4 — the one thing that is about the viewer rather than the
       * figure. Last, so it is above the artwork and above the picture; it
       * carries its own position and size, so every card type gets the same.
       */}
      {owned ? <CollectedSeal /> : null}
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
      /*
       * THE CARD'S OWN INK (V3.5).
       *
       * The two variables are redefined here rather than a second set of
       * classes being threaded through every slot. Everything below still
       * says `text-template-ink` and `text-template-ink-muted`; what those
       * two resolve to now depends on the artwork underneath them — because
       * `dark.png` and `legendary.png` are dark stock, and the near-black
       * default was calibrated on bright paper.
       *
       * The colours themselves stay tokens in `globals.css`. This picks a
       * pair; it does not invent one, and it carries no design role — gold
       * still means ownership, silver trade, amber commerce, and none of
       * them is set from here.
       */
      style={{
        aspectRatio: CARD_ASPECT,
        /*
         * A TRANSFORM, BECAUSE THE GRID MUST NOT MOVE (V4.6).
         *
         * A width or a margin would be layout, and layout is what the row
         * shares: one shrunken card would re-measure its column and every
         * other card in the grid would shift by a fraction. A transform is
         * paint. The cell keeps the size it had, the gaps stay identical,
         * and `scale` takes the type with it — so nothing inside the card
         * is re-laid out either, which is the one change that was asked for
         * and the only one that happens.
         *
         * `bottom` so the cards in a row stand on one line and their trade
         * rows agree. `center` horizontally, so the column reads straight.
         *
         * No transition: an instant change, as asked.
         */
        ...(understated
          ? { transform: `scale(${UNCOLLECTED_SCALE})`, transformOrigin: "center bottom" }
          : {}),
        ...(tone === "dark"
          ? ({
              "--template-ink": "var(--template-ink-on-dark)",
              "--template-ink-muted": "var(--template-ink-muted-on-dark)",
              /* The trade row sits on the same stock and needs the same
                 treatment — see `--trade-ink` in globals.css. One swap, four
                 variables, no second mechanism. */
              "--trade-ink": "var(--trade-ink-on-dark)",
              "--trade-ink-quiet": "var(--trade-ink-quiet-on-dark)",
            } as CSSProperties)
          : {}),
      } as CSSProperties}
    >
      {/*
       * LAYER 0 — the golden aura, BEHIND everything, for an owned figure.
       *
       * First child, so every later sibling paints over it: the body, the
       * template, the badges and the trade row are all `absolute inset-0`
       * further down and need no `z-index` to win. The card itself is
       * untouched — same box, same grid, same slots.
       *
       * It overflows the card on purpose. `inset-0` would hide it exactly
       * under the artwork; instead it is pinned to the card's CENTRE and
       * given a width and a height a few per cent larger. Both are
       * percentages of the card, so it scales with every breakpoint and
       * stays centred at any size — and both are still centred, so the two
       * factors change how far it reaches, never where it sits.
       *
       * `max-w-none` because Tailwind's reset caps images at 100 % of their
       * box, which is precisely the overflow this needs.
       *
       * No CSS glow anywhere: the light is drawn in the PNG.
       */}
      {owned ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={COLLECTED_GLOW.src}
          srcSet={`${COLLECTED_GLOW.small} 400w, ${COLLECTED_GLOW.src} 640w`}
          sizes="(max-width: 640px) 50vw, 220px"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
          style={{
            width: `${COLLECTED_GLOW_SCALE_X * 100}%`,
            height: `${COLLECTED_GLOW_SCALE_Y * 100}%`,
            /* The centring, plus the small correction for the artwork's own
               off-centre ring. Both in one transform, so there is one place
               that decides where this sits. */
            transform: `translate(calc(-50% + ${COLLECTED_GLOW_OFFSET_X}), -50%)`,
          }}
        />
      ) : null}

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
        <Link
          href={href ?? `/skylanders/${figure.slug}`}
          /*
           * The figure's own detail page is not prefetched (V3.6, A/B).
           *
           * This branch serves two different cards. The collection's showcase
           * passes no `href`, so every visible card falls back to its detail
           * page — one dynamic route per card, each costing a proxy round
           * trip through the auth server once it scrolls into view. A signed
           * out catalog card passes `signInHref` instead, which is a single
           * destination shared by every card on the page and stays on Next's
           * default.
           *
           * Hence the condition rather than a flat `false`: what is being
           * withdrawn is the per-figure prefetch, not prefetching.
           */
          prefetch={href ? undefined : false}
          className={bodyClass}
        >
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
        {/*
         * THE TRADE ROW, ON A PLATE THE CARD NOW DRAWS ITSELF (V3.5).
         *
         * `silver.png` and `gold.png` had the plate painted into them —
         * `SURFACE.plate` is its colour, read off the artwork. None of the
         * six new templates has one: the measured surface at this height is
         * ornament on `chase` and `prestige`, and dark stock on `dark` and
         * `legendary`.
         *
         * So the plate moves into CSS, from the same `--trade-solid` token
         * the rest of the trade language already uses. Silver stays silver
         * and means what it always meant — trade, not ownership, not
         * commerce. Nothing about the offer logic, the ink inside the row or
         * what the row can be clicked on changes; only where the metal comes
         * from.
         *
         * `rounded-sky-sm` and the hairline so it reads as a struck plate
         * rather than a grey rectangle, which is what the painted one did.
         */}
        <Slot area="trade" className="pointer-events-auto" style={{ paddingInline: INSET.trade }}>
          {/*
           * Layout only — no paint (fix round 2).
           *
           * Fix round 1 drew a silver plate here, because the six V3.5
           * artworks did not appear to carry the one `silver.png` had. They
           * do; a second plate on top of a painted one is two plates. The box
           * still centres its content and still clips it, and everything that
           * makes the row work — the link, its text, its accessible name, its
           * hover, focus and keyboard behaviour, the quick view it opens — is
           * inside `trade` and untouched.
           */}
          <div className="flex h-full w-full items-center justify-center overflow-hidden">
            {trade}
          </div>
        </Slot>
      </div>
    </article>
  );
}
