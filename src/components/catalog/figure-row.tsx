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
import { bannerType } from "@/lib/catalog/catalog-type";
import { InfoLink } from "@/components/catalog/info-link";
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
  adminSlot,
  dimmed = false,
  priceSlot,
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
   * NOTHING PASSES THIS YET, AND NO SPACE IS HELD FOR IT. What UX-01D added
   * is its PLACE and its CONDITION, which is all "prepare it architecturally"
   * can honestly mean while `0150` is unapplied:
   *
   *   place      first in the action bar, left of the info mark and the
   *              heart — `[bell] [info] [heart]`
   *   condition  only on a row that CANNOT be bought right now. The bell
   *              answers "tell me when this is available", which is a
   *              question about a figure with no offer, so it hangs on
   *              `!offered` — the same flag, inverted, that dresses the
   *              offer chip. No second rule and no second source.
   *
   * A row with an offer therefore reads `[info] [heart]` even if a caller
   * passed a bell. And no caller passes one: `CatalogCard` hands over no
   * `bellSlot`, so no production route shows a control that cannot work.
   * The bar costs the row nothing while it is absent — the two marks that
   * exist set its width, and a third would add 44 px to the bar and take
   * them from the name, which `row-template.ts` already accounts for.
   */
  bellSlot?: ReactNode;
  /**
   * Die Admin-Handlungen — Stift und Auge (UX-01G).
   *
   * EIN DRITTER PLATZ IN DERSELBEN LEISTE, und das ist die ganze Änderung an
   * dieser Datei. Die Leiste ist eine Reihe von 44-px-Feldern; ein
   * Adminkonto bekommt `[Info] [Stift] [Auge]`, ein Sammler
   * `[Glocke] [Info] [Herz]`. Dieselbe Geometrie, dieselbe Berührungsfläche,
   * dieselbe Rechnung in `row-template.ts` — nur andere Felder.
   *
   * WER WAS BEKOMMT, ENTSCHEIDET DIESE DATEI NICHT. Sie zeichnet, was ihr
   * übergeben wird; die Rolle kennt `CatalogCard`, und geprüft wird sie in
   * der Datenbank (`admin_set_catalog_status` fragt `is_platform_admin()`
   * selbst).
   */
  adminSlot?: ReactNode;
  /**
   * Gedämpft zeichnen — eine versteckte Figur in der Adminansicht (CAT-09).
   *
   * WAS GEDÄMPFT WIRD UND WAS NICHT. Bild, Name und Marktwert bekommen
   * weniger Deckkraft und weniger Sättigung; die AKTIONSLEISTE nicht. Ein
   * ausgegrauter Knopf sähe aus wie ein abgeschalteter, und das Auge ist
   * genau der Knopf, den man jetzt drücken will.
   *
   * ES IST EINE DARSTELLUNG, KEINE REGEL. Welche Zeilen überhaupt geladen
   * werden, entscheidet die Route (`fetchCatalog({ includeHidden: admin })`);
   * ein Sammler- oder Betriebskonto sieht sie gar nicht. Und ein ENTWURF ist
   * nicht „versteckt": er stand noch nie öffentlich, also setzt `CatalogCard`
   * dieses Kennzeichen für ihn nicht.
   */
  dimmed?: boolean;
  /**
   * Der Stift am Marktwert — die Inlinebearbeitung (CAT-09).
   *
   * EIN SLOT UND KEINE LOGIK: diese Datei zeichnet die Zeile, der Aufrufer
   * bringt die Bearbeitung mit. Steht er auf `null`, ist die Zeile Zeichen
   * für Zeichen die von vorher — dieselbe Höhe, dieselbe Schrift, dieselbe
   * Stelle.
   *
   * ER ERSETZT DEN BETRAG, WENN ER OFFEN IST. Im Normalzustand steht er
   * daneben; während der Eingabe übernimmt der Aufrufer die ganze Zelle, weil
   * ein Eingabefeld neben dem Betrag die Zeile sprengen würde.
   */
  priceSlot?: ReactNode;
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
   * caption line; it is a banderole across the foot of the picture now.
   *
   * SEIT CAT-10 IST DIE QUELLE DER SICHTBARE TYPE (`0163`) und nicht mehr
   * `card_type`: der EINE Type, den ein Administrator aus der hinterlegten
   * Menge ausgewaehlt hat. `bannerType()` ist die eine Stelle, die ihn
   * liest, und sie leitet nichts ab — weder aus der Menge noch aus der
   * Prioritaet. Ohne Auswahl kein Banner, und die Zeile ist genauso hoch.
   */
  const banner = bannerType(figure);

  return (
    <article
      className={
        /*
         * THE 520 px CEILING LIVES HERE, NOT IN THE GRID'S TRACK (UX-01E
         * correction). Putting it in `minmax(…, 520px)` made `auto-fill`
         * count by 520 instead of by 360 — two tracks at best, one on a
         * normal laptop window — because the repetition count uses the
         * track's maximum whenever that maximum is definite. The grid's
         * tracks are `1fr` now, and this is what keeps a lone tile from
         * stretching: at most 520 px wide, centred in whatever track it got.
         */
        "relative mx-auto flex w-full max-w-[520px] items-stretch gap-1.5 "
        + "rounded-sky-md px-1.5 py-1.5 sm:gap-2.5 "
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
          /*
           * THE COLUMN, NOT THE PICTURE. Since UX-01E the edition's strip
           * sits under the photograph rather than over it, so the rounding
           * and the edge belong to the pair: one plate, a white stage with a
           * dark label beneath it. `overflow-hidden` is what rounds the
           * strip's bottom corners along with the picture's top ones.
           *
           * `self-start`, so a row that grew for a two-line name keeps the
           * column at the top rather than floating it in the middle.
           */
          "flex shrink-0 self-start flex-col overflow-hidden rounded-sky-sm "
          + "ring-1 ring-card-border/70"
          /*
           * CAT-09 — GEDÄMPFT, NICHT VERSTECKT. Eine versteckte Figur soll
           * man an der ganzen Kachel erkennen, und zwar zurückhaltend: 55 %
           * Deckkraft und 35 % Sättigung nehmen dem Bild die Stimme, ohne
           * ihm die Form zu nehmen. Der Rahmen bleibt, damit die Kachel ihre
           * Kante behält.
           */
          + (dimmed ? " opacity-55 saturate-[0.35]" : "")
        }
      >
        <span
          /*
           * The stage, and it is white on purpose: the 475 photographs are
           * cut out on `--plate`, the same ground the collection's table and
           * the availability notices put them on. The size is on this
           * wrapper rather than on the `<img>`, so the space is reserved
           * before the file arrives and the row does not jump as the list
           * loads. 64 px of picture, and all 64 of it is picture — nothing
           * is cropped to make room for the label.
           */
          className="flex h-16 w-16 items-center justify-center bg-plate sm:h-18 sm:w-18"
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
         * THE EDITION, IN A STRIP OF ITS OWN UNDER THE PICTURE.
         *
         * NO OVERLAY ON THE ARTWORK — the operator's decision after the
         * desktop review — and the picture is not cropped or shrunk for it
         * either. 13 px below a 64 px square is 77, and the text block beside
         * it needs 90 anyway, so the strip still costs the row NO height and
         * a tile with an edition is exactly as tall as one without.
         *
         * `EditionBanner` zeichnet ohne sichtbaren Type nichts, und genau
         * deshalb ist hier nichts reserviert.
         */}
        <EditionBanner type={banner} />
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
         * LINE A — WHO IT IS, AND WHAT CAN BE DONE WITH IT.
         *
         * The element's mark, the name, and then the action bar hard right. Before
         * UX-01D the actions stood in a 44 px column at the row's far edge, which
         * cost the text block 50 px of width for one heart. Moving them up here
         * gave that width back to the two things that needed it — the name, and the
         * price line below, which can now reach the row's own edge.
         *
         * `displayName`, like the card: "Legendary Bash", not "Bash". The variant is
         * part of the name since V3.6; the edition is a different question and wears
         * a banderole on the picture.
         *
         * THE VISIBLE OWNERSHIP MARK IS GONE, AND THE SENTENCE STAYED
         * (UX-01E). A gold diamond stood before the element; after the
         * desktop review the operator asked for the top left to be the
         * element and the name and nothing else, and for the gold highlight
         * to carry ownership on its own. It does — ground, edge and glow,
         * three signals, and none of them costs a pixel of width.
         *
         * THE HIDDEN SENTENCE IS NOT REMOVED WITH IT. It is the only place on
         * this row that says how many copies are owned, and it is invisible,
         * so dropping it would cost a screen reader information while
         * changing nothing on screen. It also survives a forced-colours
         * display, where the gold is repainted away and the diamond would
         * have been the last visible trace.
         */}
        <div className="flex min-w-0 items-center gap-1.5">
          {owned ? (
            <span className="sr-only">
              {de.catalog.collectedBadge}
              {copies !== null ? ` · ${de.collection.copies(copies)}` : ""}
            </span>
          ) : null}
          {/*
           * NO ELEMENT MARK HERE ANY MORE (UX-01E correction).
           *
           * The row showed the element as an abstract rune — one shape in ten
           * colours, a placeholder, because the project has no element
           * artwork and inventing ten emblems was not a decision anybody had
           * made. At the desktop review the operator asked for it to go for
           * now, so the top left is the name alone.
           *
           * `element-icon.tsx` STAYS. It is the documented swap point for
           * real files, the element data is untouched, and every other
           * surface still spells the element out in words — the figure page's
           * `ElementChip`, the card, the collection's table, the quick view.
           * Nothing about the element was removed; one placeholder came off
           * one surface.
           *
           * The name is 20 px wider for it: the mark and its gap were all
           * that stood between the tile's edge and the first letter.
           */}
          <span
            /*
             * BIGGER AND BOLDER (UX-01E): 13 px semibold became 14 px bold.
             *
             * ONE PIXEL AND NOT TWO, and that is arithmetic rather than
             * taste. On a 360 px phone a tile with no offer shows three marks
             * in the bar — bell, info, heart — which take 132 px, and the
             * name is left about 81. At 14 px that is roughly ten characters
             * a line and twenty over the two it is allowed; at 15 px it would
             * be nine and eighteen, and the share of catalogue names that fit
             * whole falls from 82 % to 75 %. One pixel of type is not worth
             * seven per cent of names.
             *
             * Clipped, never overlapping: `min-w-0` with `line-clamp-2`
             * against a `shrink-0` bar means the NAME gives way and keeps its
             * full text in `title`, and the info mark leads to the page that
             * spells it out. From 390 px up, and on every desktop tile, there
             * is room for far more than the longest name.
             */
            className={"line-clamp-2 min-w-0 text-[14px] leading-[1.2] font-bold "
              /* CAT-09: derselbe gedämpfte Ton wie Bild und Betrag — und
                 weiter lesbar, denn `text-muted` ist eine Textfarbe dieses
                 Entwurfs und keine Verdünnung. */
              + (dimmed ? "text-muted" : "text-foreground")}
            title={figure.displayName}
          >
            {figure.displayName}
          </span>

          {/*
           * THE ACTION BAR — compact, horizontal, and it never meets the name.
           *
           * `shrink-0` on the bar, `min-w-0` with `line-clamp-2` on the name: when a
           * name is too long for the room left over, the NAME gives way and clips at
           * two lines with its full text in `title`. The bar cannot be pushed,
           * overlapped or crowded, which is what was asked for — and the arithmetic
           * says what that costs: at 360 px a name has about 17 characters a line,
           * so the longest name in the catalogue (39 characters) clips on its second
           * line and is whole again from 390 px up.
           *
           * EVERY INTERACTIVE MARK IS A 44 px BOX. The heart brings its own
           * (`h-11 w-11`), `InfoLink` carries the same one deliberately, and they
           * stand side by side so the two glyphs are 44 px apart — no overlap, so no
           * ambiguity about which one a thumb hit.
           *
           * EACH SLOT IS POSITIONED AND THE BAR IS NOT, the same fix as the offer
           * chip and for the same real defect: a positioned bar would paint its empty
           * space above the row's collect overlay and eat taps that belong to the
           * row. Only the 44 px that hold a control sit above it.
           */}
          <span className="ml-auto flex shrink-0 items-center">
            {/* The bell comes first, and only where there is nothing to buy.
                Nothing passes one yet — see the prop's own note. */}
            {!offered && bellSlot ? <span className="relative">{bellSlot}</span> : null}
            <span className="relative">
              <InfoLink slug={figure.slug} name={figure.displayName} />
            </span>
            {/* Nach der Info, weil Info jede Rolle hat und die beiden
                Admin-Handlungen nur eine — so steht dieselbe Marke bei allen
                an derselben Stelle. */}
            {adminSlot ? <span className="relative flex">{adminSlot}</span> : null}
            {favoriteSlot ? <span className="relative">{favoriteSlot}</span> : null}
          </span>
        </div>

        {/*
         * LINE B — THE MARKET VALUE, AND THE OFFER AT THE ROW'S EDGE.
         *
         * ONE LINE WHERE THERE WERE TWO. `MARKTWERT` used to caption a line of its
         * own, 18 px above the amount it names and sharing that line with the
         * series; the amount and the chip then had the line below. The label and the
         * amount are ONE piece of information, so they are now one block: the
         * caption sits 1 px above its number, and "deutlich näher" is the whole of
         * the change.
         *
         * It also made the row SHORTER rather than taller. Two lines of 44 px — the
         * bar's touch target, then the chip's — instead of 16 + 16 + 44, so the text
         * block went from 80 px to 90; and a two-line name, which used to add 16 px,
         * now costs nothing at all, because 32 px still fits inside the bar's 44.
         *
         * The series keeps the middle, where it has the room the chip gave up by
         * getting shorter. It is only ever here on `/shop`, which mixes all six
         * games; the catalogue has a series tab selected and passes `showSeries`
         * false, so on the main surface this line is the market value and the offer
         * and nothing between them.
         */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 flex-col gap-px">
            <span
              className={
                "text-[8px] leading-none font-medium tracking-[0.08em] uppercase "
                + (owned ? "text-own-ink/80" : "text-muted")
              }
            >
              {de.catalog.marketValue}
            </span>
            {/*
              * CAT-09 — DER BETRAG, UND DANEBEN DER STIFT.
              *
              * `priceSlot` übernimmt die ganze Zelle, sobald er etwas
              * zeichnet: im Normalzustand steht der Betrag mit einem kleinen
              * Stift dahinter, während der Eingabe das Feld allein. Beides
              * entscheidet der Aufrufer — diese Datei hält nur den Platz, und
              * ohne Slot ist die Zeile Zeichen für Zeichen die von vorher.
              */}
            {priceSlot ?? (
              <span
                className={
                  "text-[17px] leading-none font-semibold tabular-nums whitespace-nowrap "
                  + (figure.marketPrice === null || dimmed
                       ? "text-muted" : "text-foreground")
                }
              >
                {figure.marketPrice === null
                  ? de.catalog.noPrice
                  : formatPrice(
                      catalogDisplayMarketPrice(figure.marketPrice, marketBoostPercent))}
              </span>
            )}
          </span>

          {!figure.isActive || showSeries ? (
            <span className="min-w-0 truncate text-[11px] leading-none text-muted">
              {!figure.isActive ? de.catalog.inactive : figure.seriesLabel}
            </span>
          ) : null}

          {/*
           * THE OFFER CHIP — VISIBLY COMPACT, 44 px TO THE THUMB, AT THE EDGE.
           *
           * `ml-auto` and nothing to its right any more: with the action column
           * gone, the row's own padding is all that stands between this chip and the
           * card's edge, which is where it was asked to be.
           *
           * The ring and the ground are drawn by the inset layer below, 24 px tall
           * and vertically centred, while the LINK fills the full 44 px of this
           * wrapper and is what a finger actually hits. A 44 px pill read as a button
           * in a list of ninety; a 24 px chip with a 44 px target reads as a chip and
           * behaves like a control.
           *
           * `relative` HERE AND NOT ON THE LINE — the fix to a real defect. With the
           * whole line positioned, its empty half painted above the row's collect
           * overlay and swallowed every tap that landed there.
           *
           * The treatment is on the wrapper, never on `OfferLink`: that component is
           * shared with the vertical card, where it sits on the artwork's silver
           * plate. Its link, destination, accessible name, chevron, quick-view
           * interception and `data-perf` marker are untouched; the caller asks it for
           * the short label and that is all.
           */}
          {/* NO HORIZONTAL PADDING HERE. `OfferLink` brings its own
               (`px-1.5 sm:px-2`), and doubling it pushed the chip to 133 px — wide
               enough that the price line wrapped on EVERY phone row instead of only
               on the expensive ones. Found by the arithmetic, not by looking. */}
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

    </article>
  );
}
