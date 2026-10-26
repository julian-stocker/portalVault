/**
 * One figure, as a row (UX-01B, ADR-0148).
 *
 * THE SECOND PRESENTATION OF A FIGURE, AND NOT A MODE OF THE FIRST
 *
 * `FigureCard` is a collector's card: seven finished artworks at
 * 1007 x 1562, nine measured bands that sum to exactly 100 %, a gold glow
 * drawn in a PNG, and a heart whose position was read off an alpha channel.
 * None of that survives a turn through 90 degrees — there is no horizontal
 * artwork, no 2:3 box and no centred glow — so a `layout="row"` branch inside
 * that file would put a second coordinate system next to the measurements of
 * the first. This is a separate component for the same reason
 * `AccessoryCard` is: the shape of the thing is different, and the card
 * stays untouched.
 *
 * WHAT IS SHARED IS THE RULES, NOT THE MARKUP
 *
 *   marksOwnership · understatesCard · duplicateBadge · namesEdition   card.ts
 *   imageSrc                                                           image.ts
 *   catalogDisplayMarketPrice                                          market-boost.ts
 *   OfferLink, and therefore summarizeOffers / v1BuyableOffers         offer.ts
 *   FavoriteHeart                                                      favorite-heart.tsx
 *   the geometry, and the arithmetic that proves it fits               row-template.ts
 *
 * Nothing here computes a price, a buyability or an ownership rule of its
 * own. The offer arrives as the `trade` element the card also receives, so a
 * row and a card cannot disagree about what is for sale.
 *
 * THE LAYOUT, AND WHY IT IS FLOW RATHER THAN A STACK OF LAYERS
 *
 *   ┌────────┬─┬──────────────────────────────┬────┐
 *   │picture │ │ name                [edition]│ ♥  │
 *   │ 72 px  │ │ series · element             │    │
 *   │        │ │ MARKTWERT 4,99 €             │    │
 *   ├────────┴─┴──────────────────────────────┤    │
 *   │ Angebote ab 4,49 €                    › │    │
 *   └─────────────────────────────────────────┴────┘
 *
 * The card is built from absolutely positioned layers because its height is
 * fixed by an aspect ratio. A row's height comes from its content, so layers
 * would collapse it; everything here is in normal flow.
 *
 * The offer is a band under the identity block rather than a fourth line
 * inside it. Two reasons, and both are measurements: in the text column it
 * would have about 171 px on a 360 px phone and would wrap under the market
 * value anyway, and as a band it is a sibling of the toggle rather than a
 * child of it — which is the same separation `FigureCard` keeps between its
 * body and its trade plate, and it needs no event handling to hold.
 *
 * NO `@container`, DELIBERATELY. The card is one so that its type can scale
 * in `cqw`; this row sizes in pixels and lets the text column absorb the
 * width. That also means the row is not a containing block for a
 * `position: fixed` descendant — so the hazard that keeps the quick view out
 * of the card's subtree does not exist here either, and the dialog stays
 * where it belongs: one instance, owned by the grid (IR-001).
 *
 * POSSESSION IS THE GROUND AND THE EDGE
 *
 * Gold means possession (V3.1), and on a row it cannot mean the artwork
 * because there is none. So it is the ground (`--own-subtle`, the warm dark
 * surface that already carries `--own-ink` elsewhere), a one-pixel gold edge
 * and a soft glow outside it. No frame, no crown, no animation — and the
 * figure's own photograph is never touched: no filter, no opacity, no scale.
 */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import {
  duplicateBadge,
  marksOwnership,
  namesEdition,
  understatesCard,
  type CardOwnership,
} from "@/lib/catalog/card";
import { CARD_TYPE_LABELS } from "@/lib/catalog/card-type";
import { elementLabel } from "@/lib/catalog/element";
import { imageSrc } from "@/lib/catalog/image";
import { NO_MARKET_BOOST, catalogDisplayMarketPrice } from "@/lib/catalog/market-boost";
import type { CatalogFigure } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/**
 * The three grounds a row can stand on.
 *
 * Three and not two, and the third is the one that is easy to get wrong. A
 * surface that does not know the viewer's collection — the signed-out
 * catalogue, the figure page's siblings — must not draw every row as "not
 * yours": that says nothing about ownership and merely makes the list look
 * faded. It is the same distinction `understatesCard` was written for.
 *
 *   owned        the warm ground, a gold edge, a soft glow outside it
 *   understated  the quiet ground, one shade back from neutral
 *   neutral      the in-world stone every other block on these pages uses
 *
 * `ring-*` and `shadow-*` compose into one `box-shadow` in Tailwind v4, so
 * the edge and the glow coexist without either being written as an inline
 * style that would overwrite the other.
 */
const GROUND = {
  owned:
    "bg-own-subtle/70 ring-1 ring-own-line-strong "
    + "shadow-[0_0_18px_-8px_var(--own-line-strong)]",
  understated: "bg-deep/55 ring-1 ring-border/60 backdrop-blur-sm",
  neutral: "bg-deep/70 ring-1 ring-border-strong/60 backdrop-blur-sm",
} as const;

export function FigureRow({
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
  favoriteSlot,
  bellSlot,
  failed = false,
  knowsCollection = false,
  marketBoostPercent = NO_MARKET_BOOST,
}: {
  figure: CatalogFigure;
  /** The offer line, built by the caller. Usually an `OfferLink`. */
  trade?: ReactNode;
  /** A deep link landed on this row (`?highlight=SKY-0042`). Neutral. */
  highlighted?: boolean;
  /** Real collection state, never derived. */
  collected?: boolean;
  /** Which question this row answers about ownership. */
  ownership?: CardOwnership;
  /** How many are owned. Only ever said above one. */
  quantity?: number;
  showSeries?: boolean;
  /** Where the identity block leads. Makes it a link instead of a toggle. */
  href?: string;
  /** Makes the identity block a toggle instead of a link. */
  onToggle?: () => void;
  toggleLabel?: string;
  /** The heart, top right. Absent means no heart, never an empty one. */
  favoriteSlot?: ReactNode;
  /**
   * The availability bell, under the heart — UX-02 and migration `0150`.
   *
   * NOTHING PASSES THIS YET, AND THE SPACE IS HELD ANYWAY. The action column
   * reserves `ROW.actionSlots` touch slots whether or not they are filled
   * (`row-template.ts`), so the day the bell arrives it lands in a column
   * that already has room for it: no row grows, no text reflows, and the
   * geometry this release measured stays the geometry.
   */
  bellSlot?: ReactNode;
  /**
   * Whether the last collect attempt failed.
   *
   * A BOOLEAN AND NOT A NODE, and that is the one place this row deliberately
   * takes a different prop from the card. `FigureCard` receives a finished
   * `notice` element because its caller has to position it absolutely — the
   * card's height is an aspect ratio and a notice in flow would break the
   * grid. A row has no fixed height and must never lay one thing over
   * another, so the message belongs in flow — and where a message is placed
   * is a property of the presentation, not of the caller. The text is the
   * same key either way.
   */
  failed?: boolean;
  /** Whether this surface knows the viewer's collection (V4.6). */
  knowsCollection?: boolean;
  /**
   * The temporary catalog market-value boost, in per cent (0094).
   *
   * Explicit and zero by default, exactly as on the card: it changes the
   * printed number and nothing else, and the list of surfaces it applies to
   * is the list of call sites that pass it. The collection does not.
   */
  marketBoostPercent?: number;
}) {
  const copies = duplicateBadge(quantity);
  const owned = marksOwnership(ownership, collected);
  const understated = understatesCard(ownership, collected, knowsCollection);
  const picture = imageSrc(figure);
  /*
   * The edition, in words, because the row has no artwork to say it with.
   * `standard` says nothing and is excluded by the rule, not here.
   */
  const edition = namesEdition(figure.cardType) ? CARD_TYPE_LABELS[figure.cardType] : null;

  /** The identity block: picture, hairline, and what the figure is. */
  const identity = (
    <>
      {/*
       * THE PICTURE STAGE, AND IT IS WHITE ON PURPOSE.
       *
       * The 475 photographs are cut out on white (`--plate`), which is the
       * same stage the collection's table and the availability notices put
       * them on. The size is on the WRAPPER rather than on the `<img>`, so
       * the space is reserved before the file arrives and the row does not
       * jump as the list loads.
       *
       * `object-contain`, because a figure is a free-standing object and a
       * crop takes its head off.
       */}
      <span
        className={
          "relative flex h-18 w-18 shrink-0 items-center justify-center overflow-hidden "
          + "rounded-sky-sm bg-plate ring-1 ring-card-border/70 sm:h-22 sm:w-22"
        }
      >
        {picture ? (
          /* ADR-0026: already optimised to 640 px, content-addressed and
             served from /public, so next/image would re-optimise at runtime
             and bill image units for no gain. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={picture}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            width={640}
            height={640}
            className="h-full w-full object-contain"
          />
        ) : (
          /* 27 collectibles genuinely have no picture. An empty stage, not an
             error — and dark ink, because the stage is white. */
          <span className="px-1 text-center text-[9px] leading-tight text-on-card-muted">
            {de.catalog.noImage}
          </span>
        )}
      </span>

      {/*
       * The hairline. Its own element rather than a border on a neighbour, so
       * it spans the identity block's height whatever that turns out to be —
       * and it is gold on an owned row, where it belongs to the edge.
       */}
      <span
        aria-hidden="true"
        className={
          "w-px shrink-0 self-stretch "
          + (owned ? "bg-own-line-strong/60" : "bg-border-strong/50")
        }
      />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/*
         * THE NAME, AND THE EDITION BESIDE IT.
         *
         * `displayName`, like the card — "Legendary Bash", not "Bash". The
         * variant is part of the name since V3.6, so this line carries it;
         * the edition is a different question (which of the seven card types
         * the figure is) and gets its own chip, because the row has no
         * artwork to answer it with.
         *
         * Two lines at most and then clipped, so one long name cannot push a
         * row to three times the height of its neighbours.
         */}
        <span className="flex items-start gap-1.5">
          <span
            className="line-clamp-2 min-w-0 text-[13px] leading-[1.2] font-semibold text-foreground"
            title={figure.displayName}
          >
            {figure.displayName}
          </span>
          {edition ? (
            /*
             * Neutral, and that is a decision: gold means possession and
             * coral means wanting (V3.1). An edition is a property of the
             * object, like the variant seal on the card — which is
             * deliberately not gold for exactly the same reason.
             */
            <span
              className={
                "mt-px shrink-0 rounded-full bg-status-ground px-1.5 py-0.5 text-[10px] "
                + "leading-none font-medium text-status-ink ring-1 ring-status-line"
              }
            >
              {edition}
            </span>
          ) : null}
        </span>

        {/*
         * One line: what this is, or that it is yours.
         *
         * The same order of questions the card's `meta` band answers, and the
         * same answers — ownership wins over the series, an inactive figure
         * takes the series' place rather than adding a line, and the element
         * sits at the right end where it cannot collide with the text beside
         * it.
         */}
        <span className="flex items-baseline gap-2 text-[11px] leading-[1.25]">
          <span className={"min-w-0 truncate " + (owned ? "text-own-ink" : "text-muted")}>
            {owned ? (
              <>
                <span aria-hidden="true" className="text-[0.85em]">◆{" "}</span>
                {de.catalog.collectedBadge}
                {copies !== null ? ` · ${copies}×` : ""}
              </>
            ) : !figure.isActive ? (
              de.catalog.inactive
            ) : showSeries ? (
              figure.seriesLabel
            ) : null}
          </span>
          <span className="ml-auto shrink-0 whitespace-nowrap text-muted">
            {figure.element ? elementLabel(figure.element) : null}
          </span>
        </span>

        {/*
         * THE MARKET VALUE, LABELLED.
         *
         * The label is not decoration: the offer band below carries a price
         * too, and the two are different things that must never be read as
         * one number (ADR-0033). The boost is applied here, at the last
         * possible moment; `figure.marketPrice` leaves this component
         * unchanged in every other direction.
         */}
        <span className="flex items-baseline gap-1.5">
          <span
            className={
              "text-[9px] leading-none font-medium tracking-[0.08em] uppercase "
              + (owned ? "text-own-ink/80" : "text-muted")
            }
          >
            {de.catalog.marketValue}
          </span>
          <span
            className={
              "text-[13px] leading-none font-semibold tabular-nums whitespace-nowrap "
              + (figure.marketPrice === null ? "text-muted" : "text-foreground")
            }
          >
            {figure.marketPrice === null
              ? de.catalog.noPrice
              : formatPrice(catalogDisplayMarketPrice(figure.marketPrice, marketBoostPercent))}
          </span>
        </span>
      </span>
    </>
  );

  /** What the identity block is: a toggle, a link, or neither. */
  const identityClass =
    "focus-ring flex min-w-0 items-center gap-2 rounded-sky-sm text-left sm:gap-3";

  const block = onToggle ? (
    <button type="button" onClick={onToggle} aria-pressed={collected} className={identityClass}>
      {identity}
      {/* The state in words, for anyone the gold does not reach. The visible
          name is inside this button, so the accessible name is the figure
          and then what pressing it does. */}
      <span className="sr-only">
        {collected ? de.catalog.collected : ""} {toggleLabel}
      </span>
    </button>
  ) : href ? (
    <Link
      href={href}
      /*
       * No prefetch decision is made here, and that is deliberate.
       *
       * This branch only ever runs with a destination the CALLER chose, and
       * today that is `signInHref` — one address shared by every row on the
       * page, which is exactly the case Next's default handles well. A
       * surface that later passes a per-figure address has to pass
       * `prefetch={false}` with it, for the reason the card's own comment
       * gives: 561 rows of dynamic routes are 561 proxy round trips through
       * the auth server as they scroll into view (V3.6, A/B). Writing
       * `prefetch={undefined}` here would look like that decision had been
       * taken when it had not.
       */
      className={identityClass}
    >
      {identity}
      {owned ? <span className="sr-only">{de.catalog.collectedBadge}</span> : null}
    </Link>
  ) : (
    /* Neither: the figure page's siblings, where the row is a picture with
       words beside it and the whole surrounding card is the link. */
    <div className={"flex min-w-0 items-center gap-2 sm:gap-3"}>{identity}</div>
  );

  return (
    <article
      className={
        "relative flex items-stretch gap-2 rounded-sky-md p-2 sm:gap-3 sm:p-3 "
        + (owned ? GROUND.owned : understated ? GROUND.understated : GROUND.neutral)
        + (highlighted ? " outline outline-2 outline-offset-2 outline-nav-active-ink" : "")
      }
      /*
       * THE TRADE INKS, SWAPPED FOR A DARK GROUND.
       *
       * `OfferLink` writes in `--trade-ink` and `--trade-ink-quiet`, which
       * are near-black because on a card they sit on a silver plate the
       * artwork paints. A row has no plate and a dark ground, so both would
       * be unreadable. The project already has the pair for this case and
       * `FigureCard` already swaps to it on its two dark artworks — same
       * variables, same mechanism, no second set of colours and no change to
       * `OfferLink` itself.
       */
      style={
        {
          "--trade-ink": "var(--trade-ink-on-dark)",
          "--trade-ink-quiet": "var(--trade-ink-quiet-on-dark)",
        } as CSSProperties
      }
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {block}

        {/*
         * THE OFFER BAND — a sibling of the identity block, never a child.
         *
         * `min-h-11` is the 44 px target, and it is the reason the band is
         * worth its own row: the offer is a link, and a link inside the
         * collect toggle would be a link inside a button. The card solves the
         * same problem with a sibling layer over a fixed-height grid; a row
         * can simply put it underneath.
         *
         * `OfferLink` draws the quiet sentence when there is nothing to buy,
         * so the band is never empty and the row never changes height
         * between a figure that is for sale and one that is not.
         */}
        <div className="flex min-h-11 items-center">{trade}</div>

        {/*
         * A collect that did not stick has to say so on the row it failed on.
         *
         * In flow, and that is the point: an absolute pill here would have to
         * be laid over the offer band or over the picture, and laying one
         * thing over another is precisely what a row must not do. It costs a
         * line of height on an error path and guarantees nothing overlaps.
         */}
        {failed ? (
          <p role="alert" className="text-[10px] leading-tight font-medium text-danger">
            {de.catalog.collectFailed}
          </p>
        ) : null}
      </div>

      {/*
       * THE ACTION COLUMN.
       *
       * 44 px wide, and tall enough for two touch slots whether or not both
       * are filled — see `bellSlot` above. `justify-start`, so the heart sits
       * at the top where it is on the card, and the reserved space grows
       * downward into the row rather than pushing the heart around.
       */}
      {favoriteSlot || bellSlot ? (
        /* `w-11` is `ROW.touch`, `min-h-22` is `ROW_ACTION_HEIGHT` — two touch
           slots, held open whether or not both are filled. A test holds both
           class names against those constants. */
        <div className="flex min-h-22 w-11 shrink-0 flex-col items-center justify-start gap-1">
          {favoriteSlot}
          {bellSlot}
        </div>
      ) : null}
    </article>
  );
}
