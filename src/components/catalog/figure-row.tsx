/**
 * One figure, as a compact row (UX-01B/01C, ADR-0148).
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
 * ---------------------------------------------------------------------------
 * THE LAYOUT
 *
 *   ┌────────┬─┬──────────────────────────────────────┬────┐
 *   │        │ │ ◆ ● Slobber Tooth                    │ ♥  │
 *   │ 64 px  │ │ MARKTWERT 4,99 €          [Prestige] │    │
 *   │        │ │              ( Angebote ab 4,49 € › )│ 🔔 │
 *   └────────┴─┴──────────────────────────────────────┴────┘
 *     picture  ‖            text block                 heart
 *                                                      bell
 *
 * 92 px on a phone with one line of name, against 138 px for the first
 * version — and the picture is BIGGER than it was (64 against 72 px, which
 * only sounds like a contradiction until you see that the text block decides
 * the height). Where the air went:
 *
 *   1. THE OFFER CAME INSIDE. It used to be a band of its own under the
 *      picture, 44 px plus a 6 px gap, spanning the whole row. It is now the
 *      last line of the text block, right-aligned and dressed as a pill —
 *      which is also where a reader looks for the next step.
 *   2. THE BELL RESERVATION WENT. The heart's column was forced to 88 px to
 *      hold a slot for a control that did not exist. The column is as tall
 *      as what is in it; a bell only appears where one belongs, and only
 *      then does the row grow for it.
 *   3. THE PICTURE STOPPED DECIDING THE HEIGHT. At 72 px it was the tallest
 *      thing in the row; the text block needs 80 px anyway.
 *   4. THE ELEMENT BECAME A MARK. The word "Technologie" held the left of
 *      the meta line; a 14 px rune in front of the name gives that whole
 *      line to the market value, which is why the value could move up to
 *      where it is read.
 *
 * THREE STEPS DOWN ONE LEFT EDGE: name, then value, then the offer. That is
 * the hierarchy, and it is why the value sits under the name rather than at
 * the right end of a line it shares.
 *
 * THE HEART HAS ITS OWN COLUMN, and that is geometry rather than taste. Its
 * touch area is 44 px (`FavoriteHeart`, unchanged) and the offer sits at the
 * bottom right of the text block. Two right-aligned targets stacked inside
 * one column would either overlap — a tap meant for the offer landing on the
 * heart — or force the row to be 44 + 44 px tall. In its own column the
 * heart's box can never meet the offer's, whatever either one's height.
 *
 * THE OFFER AND THE MARKET VALUE ARE ON DIFFERENT LINES, and that is also
 * measurement: side by side they need 215 px and a phone's text block has
 * 179. The value shares the meta line, where it has the room; the offer
 * keeps the bottom line to itself. Both stay labelled, because they are two
 * different numbers and must never read as one (ADR-0033).
 *
 * NO `@container` ON THE ROW, DELIBERATELY. The card is one so that its type
 * can scale in `cqw`; this row sizes in pixels and lets the text block absorb
 * the width. That also means the row is not a containing block for a
 * `position: fixed` descendant — so the hazard that keeps the quick view out
 * of the card's subtree does not exist here either, and the dialog stays
 * where it belongs: one instance, owned by the grid (IR-001).
 *
 * POSSESSION IS THE GROUND AND THE EDGE
 *
 * Gold means possession (V3.1), and on a row it cannot mean the artwork
 * because there is none. So it is the ground (`--own-subtle`, the warm dark
 * surface that already carries `--own-ink` elsewhere), a one-pixel gold edge,
 * a soft glow outside it and a gold diamond in front of the name. No frame,
 * no crown, no animation — and the figure's own photograph is never touched:
 * no filter, no opacity, no scale.
 */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import {
  duplicateBadge,
  marksOwnership,
  understatesCard,
  type CardOwnership,
} from "@/lib/catalog/card";
import { EditionBanner } from "@/components/catalog/edition-banner";
import { ElementIcon } from "@/components/catalog/element-icon";
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
  offered = false,
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
  /**
   * Whether anything can actually be bought — the caller's
   * `hasQuickViewOffer()`, which resolves to `v1BuyableOffers`.
   *
   * IT CHANGES NOTHING ABOUT THE OFFER ITSELF, only how its pill is dressed:
   * a silver action when there is something to press, a quiet chip when
   * `OfferLink` is drawing "Aktuell kein Angebot". No buyability is computed
   * here and no second rule exists — the flag is handed down from the one
   * place that already asks the question.
   *
   * It is also the condition UX-02's bell hangs on, inverted: a bell belongs
   * to a figure that CANNOT be bought right now. That the same flag answers
   * both is a sign it is the right flag.
   */
  offered?: boolean;
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
   * The availability bell — UX-02 and migration `0150`.
   *
   * NOTHING PASSES THIS YET, AND NO SPACE IS HELD FOR IT. The first version
   * forced the heart's column to two touch slots, which made every row 44 px
   * taller for a control that does not exist. The column is as tall as what
   * is in it; when the bell arrives it goes beside or below the heart, and
   * the row grows at that point rather than in advance.
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
   * THE EDITION IS NOT A VALUE HERE ANY MORE. It used to be a chip on the
   * caption line; it is a banderole across the foot of the picture now, and
   * `EditionBanner` reads `card_type` itself and draws nothing for a
   * `standard` figure. The rule is still `namesEdition()` — one rule, one
   * place — it is simply asked one level further in.
   */

  return (
    <article
      className={
        "relative flex items-stretch gap-1.5 rounded-sky-md px-1.5 py-1.5 sm:gap-2.5 "
        + (owned ? GROUND.owned : understated ? GROUND.understated : GROUND.neutral)
        + (highlighted ? " outline outline-2 outline-offset-2 outline-nav-active-ink" : "")
      }
      /*
       * THE TRADE INKS, SWAPPED FOR A DARK GROUND.
       * (see the stacking note at the overlay below)
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
      {/*
       * THE WHOLE ROW IS THE COLLECT TOGGLE — an overlay, FIRST in the DOM.
       *
       * Since ADR-0038 the card's body IS the toggle, and the row keeps that:
       * tapping it collects the figure, tapping it again gives it up.
       *
       * AN OVERLAY RATHER THAN A WRAPPER, because the heart and the offer are
       * controls of their own: nested inside a button they would be invalid
       * markup and an ambiguous target. And the STACKING is the whole trick,
       * so it is written down rather than discovered later —
       *
       *   static children  picture, hairline, text  painted first
       *   positioned, in DOM order:
       *     1. this overlay            covers the row, takes every tap
       *     2. the offer line          `relative`, so it paints ABOVE and
       *                                keeps its own clicks
       *     3. the heart's column      `relative`, same
       *
       * That is why exactly two elements below carry `relative`, and why no
       * `z-index` and no `pointer-events-none` layer is needed. A negative
       * `z-index` on the overlay would have been the obvious alternative and
       * is wrong: it paints behind the article's own background, and the
       * article then wins the hit test.
       *
       * The accessible name is the figure and then what pressing it does; a
       * sighted reader takes the name from the line above.
       */}
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={collected}
          className="focus-ring absolute inset-0 h-full w-full rounded-sky-md"
        >
          <span className="sr-only">
            {figure.displayName} — {collected ? de.catalog.collected : ""} {toggleLabel}
          </span>
        </button>
      ) : href ? (
        <Link
          href={href}
          /*
           * No prefetch decision is made here, and that is deliberate. This
           * branch only ever runs with a destination the CALLER chose, and
           * today that is `signInHref` — one address shared by every row on
           * the page, which is what Next's default handles well. A surface
           * that later passes a per-figure address has to pass
           * `prefetch={false}` with it, for the reason the card's own comment
           * gives: 561 rows of dynamic routes are 561 proxy round trips
           * through the auth server as they scroll into view.
           */
          className="focus-ring absolute inset-0 h-full w-full rounded-sky-md"
        >
          <span className="sr-only">
            {figure.displayName}
            {owned ? ` — ${de.catalog.collectedBadge}` : ""}
          </span>
        </Link>
      ) : null}

      {/*
       * THE PICTURE STAGE, AND IT IS WHITE ON PURPOSE.
       *
       * The 475 photographs are cut out on white (`--plate`), which is the
       * same stage the collection's table and the availability notices put
       * them on. The size is on the WRAPPER rather than on the `<img>`, so
       * the space is reserved before the file arrives and the row does not
       * jump as the list loads.
       *
       * `self-start`, so a row that grew for a two-line name keeps the
       * picture at the top rather than floating it in the middle.
       */}
      <span
        className={
          "relative flex h-16 w-16 shrink-0 self-start items-center justify-center "
          + "overflow-hidden rounded-sky-sm bg-plate ring-1 ring-card-border/70 "
          + "sm:h-18 sm:w-18"
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

        {/*
         * THE EDITION, ACROSS THE FOOT OF THE PICTURE.
         *
         * Inside the stage, which is already `relative overflow-hidden`, so
         * it costs the row NO height and cannot escape the rounded corners.
         * It covers the bottom 13 px of 64 — a fifth, at the end where a
         * figure has its base. The photograph is untouched.
         */}
        <EditionBanner cardType={figure.cardType} />
      </span>

      {/*
       * The hairline. Its own element rather than a border on a neighbour, so
       * it spans the row's height whatever that turns out to be — and it is
       * gold on an owned row, where it belongs to the edge.
       */}
      <span
        aria-hidden="true"
        className={
          "w-px shrink-0 self-stretch "
          + (owned ? "bg-own-line-strong/60" : "bg-border-strong/50")
        }
      />

      {/*
       * THE TEXT BLOCK — three lines, and the row's height comes from here.
       *
       * `min-w-0` so it can shrink to nothing rather than pushing the row
       * sideways; `flex-1` so it absorbs every width the grid hands over.
       */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/*
         * LINE 1 — the element's mark, then the name.
         *
         * `displayName`, like the card: "Legendary Bash", not "Bash". The
         * variant is part of the name since V3.6; the edition is a different
         * question and gets its chip on the line below, where it can crowd
         * neither the name nor the price.
         *
         * THE OWNERSHIP MARK IS A DIAMOND AND A HIDDEN SENTENCE. "◆ In
         * deiner Sammlung" as visible text would take a line of its own. The
         * gold ground, the gold edge and this diamond say it three times over
         * for anyone who can see them; the sentence stays in the markup for
         * anyone who cannot, and for a forced-colours display where the gold
         * is repainted away.
         */}
        <p className="flex min-w-0 items-center gap-1.5">
          {owned ? (
            <>
              <span aria-hidden="true" className="shrink-0 text-[11px] text-own-ink">◆</span>
              <span className="sr-only">
                {de.catalog.collectedBadge}
                {copies !== null ? ` · ${de.collection.copies(copies)}` : ""}
              </span>
            </>
          ) : null}
          <ElementIcon element={figure.element} className="h-3.5 w-3.5" />
          <span
            className="line-clamp-2 min-w-0 text-[13px] leading-[1.2] font-semibold text-foreground"
            title={figure.displayName}
          >
            {figure.displayName}
          </span>
        </p>

        {/*
         * LINE 2 — THE LABEL, AND THE TWO SOFTER FACTS.
         *
         * `MARKTWERT` stands ABOVE the amount, not beside it. That is the
         * hierarchy the operator settled on, and it is the reason this line
         * exists: the label names the number below it and must not compete
         * with it, so it is small and quiet.
         *
         * The rest of the line was empty, so the two facts with nowhere
         * better to be share it:
         *
         *   NOT IN THE CATALOGUE  rare, administrator-facing, and it takes
         *                         precedence over the game
         *   THE SERIES            only where the surface asks for it — the
         *                         catalogue has a series tab selected, while
         *                         `/shop` mixes all six games
         *
         * The edition used to have a chip at the right of this line. It is a
         * banderole on the picture now, which is why the line is quieter and
         * why the series has the whole of it to itself.
         */}
        <p className="flex min-w-0 items-center gap-2">
          <span
            className={
              "shrink-0 text-[8px] leading-none font-medium tracking-[0.08em] uppercase "
              + (owned ? "text-own-ink/80" : "text-muted")
            }
          >
            {de.catalog.marketValue}
          </span>

          {!figure.isActive || showSeries ? (
            <span className="min-w-0 truncate text-[11px] leading-none text-muted">
              {!figure.isActive ? de.catalog.inactive : figure.seriesLabel}
            </span>
          ) : null}
        </p>

        {/*
         * LINE 3 — THE AMOUNT, AND THE OFFER BESIDE IT.
         *
         * The market value at the left, prominent at 17 px, with its label
         * directly above it. The offer at the right, as a compact chip.
         *
         * `flex-wrap` IS THE RESPONSIVE FALLBACK the operator asked for, and
         * the width it has to work in was widened for it: taking the edition
         * chip off the caption line did nothing for THIS line, so the row's
         * horizontal padding went from 8 to 6 px and its column gaps from 8
         * to 6, which buys the text block 10 px. Measured at 189 px on a
         * 360 px phone: an ordinary "49,99 €" beside "Angebote ab 4,49 €"
         * needs 179 and fits; a three-digit "189,50 €" needs 193 and the chip
         * drops to its own line. Nothing is truncated and no price is shrunk,
         * and only the figures that need it pay a line.
         */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span
            className={
              "shrink-0 text-[17px] leading-none font-semibold tabular-nums whitespace-nowrap "
              + (figure.marketPrice === null ? "text-muted" : "text-foreground")
            }
          >
            {figure.marketPrice === null
              ? de.catalog.noPrice
              : formatPrice(catalogDisplayMarketPrice(figure.marketPrice, marketBoostPercent))}
          </span>

          {/*
           * THE OFFER CHIP — VISIBLY COMPACT, 44 px TO THE THUMB.
           *
           * The two may differ, and here they do: the ring and the ground are
           * drawn by the inset layer below, 26 px tall and vertically
           * centred, while the LINK fills the full 44 px of this wrapper and
           * is what a finger actually hits. A 44 px pill read as a button in
           * a list of ninety; a 26 px chip with a 44 px target reads as a
           * chip and behaves like a control.
           *
           * `relative` HERE AND NOT ON THE LINE — the fix to a real defect.
           * With the whole line positioned, its empty half painted above the
           * row's collect overlay and swallowed every tap that landed there.
           * Only the chip has to be above the overlay.
           *
           * The treatment is on the wrapper, never on `OfferLink`: that
           * component is shared with the vertical card, where it sits on the
           * artwork's silver plate. Its link, label, chevron, quick-view
           * interception and `data-perf` marker are untouched.
           */}
          {/* NO HORIZONTAL PADDING HERE. `OfferLink` brings its own
               (`px-1.5 sm:px-2`), and doubling it pushed the chip to 133 px —
               wide enough that the price line wrapped on EVERY phone row
               instead of only on the expensive ones. Found by the arithmetic,
               not by looking. */}
          <span className="group relative ml-auto inline-flex min-h-11 shrink-0 items-center">
            <span
              aria-hidden="true"
              className={
                "pointer-events-none absolute inset-x-0 inset-y-[10px] rounded-full "
                + "transition-colors "
                + (offered
                  ? "bg-trade-solid/12 ring-1 ring-trade-line "
                    + "group-hover:bg-trade-solid/22 group-focus-within:bg-trade-solid/22 "
                    + "group-focus-within:ring-trade-line-strong"
                  : "bg-deep/40 ring-1 ring-border/50")
              }
            />
            {trade}
          </span>
        </div>

        {/*
         * A collect that did not stick has to say so on the row it failed on.
         *
         * In flow, and that is the point: an absolute pill here would have to
         * be laid over the offer or over the picture, and laying one thing
         * over another is precisely what a row must not do.
         */}
        {failed ? (
          <p role="alert" className="text-[10px] leading-tight font-medium text-danger">
            {de.catalog.collectFailed}
          </p>
        ) : null}
      </div>

      {/*
       * THE ACTION COLUMN — two positions, one x.
       *
       * The heart at the top, the availability bell underneath it, both 44 px
       * and both centred in a 44 px column, so the two marks line up however
       * tall the row becomes. `justify-between` only when a bell is there;
       * otherwise the heart sits at the top and the column stays as short as
       * the heart. NOTHING HOLDS SPACE OPEN.
       *
       * THE COLUMN ITSELF IS NOT POSITIONED, AND EACH SLOT IS — the same fix
       * as the offer chip, for the same real defect. A positioned column
       * painted its empty lower half above the collect overlay and ate every
       * tap that landed there; now only the 44 px that actually hold a
       * control sit above the overlay, and the rest falls through to the row.
       */}
      {favoriteSlot || bellSlot ? (
        <div
          className={
            "flex w-11 shrink-0 flex-col items-center self-stretch "
            + (bellSlot ? "justify-between" : "justify-start")
          }
        >
          {favoriteSlot ? <span className="relative">{favoriteSlot}</span> : null}
          {bellSlot ? <span className="relative">{bellSlot}</span> : null}
        </div>
      ) : null}

    </article>
  );
}
