/**
 * The trade zone — the silver plate at the foot of a card (V3.3).
 *
 * SELLER-NEUTRAL, ON PURPOSE
 *
 * "Angebote ab 4,49 €" says somebody is offering, without claiming who. True
 * today with one seller and true whatever happens later, so this row never has
 * to be redesigned to stay honest. It is a wording decision, NOT multi-seller
 * preparation: nothing in the data model knows a seller, and the figure's own
 * offer section is where `active_seller()` will be named once there is a
 * granted way to read it.
 *
 * A LINK, NOT A BUY BUTTON
 *
 * It leads to `/skylanders/<slug>#angebote`, where condition, price and
 * availability are visible before anything is bought. Nothing is added to a
 * basket from the grid. The chevron is the promise of a destination.
 *
 * TWO STATES, ONE GEOMETRY
 *
 * With an offer it is a link; without one it is a quiet sentence. The plate is
 * painted into the card either way, so the row never changes the card's size —
 * and "Aktuell kein Angebot" is dimmed by weight and size, never by contrast:
 * it still reads 5.4:1 on the plate.
 *
 * SIZE, MEASURED RATHER THAN GUESSED
 *
 * The plate is painted at a fixed share of the card, so it is 34.8 px tall at
 * a 268 px desktop tile and 22.5 px at a 173 px phone one — already inside the
 * 34–38 px a desktop card wants, and correctly smaller when the card is.
 *
 * BOTH STATES STAY ON ONE LINE. `whitespace-nowrap` on each, and the
 * horizontal padding gives way before the text does: 6 px on a phone, 8 px
 * above `sm:`. At the real grid width the plate is 169 px wide and the longer
 * of the two labels needs about 101 px of it.
 *
 * 9 px at the floor, 11 px at the widest card. It steps back a size from the
 * name and the price on purpose — the plate is where you go next, not what
 * the card is about.
 *
 * The TARGET is not the plate: `FigureCard` gives this row `min-h-11`, 44 px,
 * and lets it overflow the plate into paper that carries nothing else.
 */
import Link from "next/link";

import { summarizeOffers, type Offer } from "@/lib/shop/offer";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/*
 * TWO STATES, TOLD APART BY ONE THING: DARK OR GREY (V3.2).
 *
 * An earlier draft gave the buyable state its own polished surface — a
 * highlight, a gradient, a shadow. On the real artwork that read as worse,
 * not better: the plate is already a painted surface, and a second one laid
 * over it muddied the text it was meant to lift.
 *
 * So the difference is ink alone. Both states share the same silver plate,
 * the same size and the same position; one is nearly black and one is grey.
 * Silver stays silver — gold means ownership, and a buyable offer is not
 * something you own (V3.1).
 *
 * Measured against the plate the artwork actually paints, sampled from both
 * templates at the trade band (silver #c2c8cd, gold #bec2c8):
 *
 *   offer  #11161c   10.76 : 1  silver   10.16 : 1  gold
 *   quiet  #474f5b    4.90 : 1  silver    4.63 : 1  gold
 *
 * Both clear AA on both plates, and they still differ by a factor of 2.2 —
 * the quiet state is passive because it is grey against near-black, not
 * because it was dimmed until it stopped being readable.
 *
 * WHY THESE ARE INLINE STYLES AND NOT CLASSES
 *
 * They were `text-[#11161c]` and `text-[#474f5b]`. Both classes generate
 * correctly and both sit on the element that renders the text — and the
 * browser still showed the inherited near-white of the dark page, which is
 * what a card falls back to when no colour rule reaches it.
 *
 * A class can only paint if its rule arrives. An inline style carries the
 * value itself: it needs nothing generated, nothing scanned, nothing shipped
 * alongside, and it outranks every stylesheet rule that is not `!important`
 * — and nothing in this project marks a colour `!important`. The card
 * already sets `gridArea`, `aspectRatio` and the window inset this way, so
 * the mechanism is the one this component already uses for values it cannot
 * afford to have go missing.
 *
 * Weight, size and spacing stay in Tailwind. Only the two colours moved.
 *
 * WHY THEY ARE NOW VARIABLES AND STILL INLINE (V3.6)
 *
 * The literals were correct on the four light artworks and wrong on the two
 * dark ones: `#474f5b` on `dark.png` left "Aktuell kein Angebot" barely
 * visible. The card root already swaps `--template-ink` when it draws on dark
 * stock, so these join that swap rather than growing a mechanism of their own.
 *
 * Still inline, for exactly the reason above: an inline style outranks every
 * stylesheet rule that is not `!important`, and `var()` inside one resolves
 * against the ancestor that set it. The fallback is the old literal, so the
 * component keeps working wherever no card defines the variable — which is
 * the case in `collection-action.tsx`, the one other consumer.
 */
export const INK_OFFER = "var(--trade-ink, #11161c)";
export const INK_QUIET = "var(--trade-ink-quiet, #474f5b)";

export function OfferLink({
  offers,
  slug,
  name,
  onOpen,
}: {
  offers: readonly Offer[];
  slug: string;
  /** For the accessible name: "Angebote für Bouncer ansehen". */
  name: string;
  /**
   * Opens the quick view instead of navigating (IR-001).
   *
   * Optional, and the element stays a real `<Link>` either way. That is not
   * decoration: without it a middle click, a Cmd-click and a browser with no
   * JavaScript would all have nothing to act on, and the accessible name of
   * a link says where it leads. With it, an ordinary left click is
   * intercepted and the catalog stays put.
   */
  onOpen?: () => void;
}) {
  const summary = summarizeOffers(offers);

  if (summary.kind === "none") {
    return (
      <span
        className={
          /*
           * Deliberately passive: no surface of its own, no highlight, normal
           * weight. It says what is true and asks for nothing.
           */
          /*
           * Inactive: the same plate, no surface of its own, no hover, and
           * nothing to press. Grey is the whole of the signal.
           */
          `flex h-full w-full items-center justify-center whitespace-nowrap px-1.5 sm:px-2 ` +
          `text-[clamp(9px,4.8cqw,11px)] leading-none font-normal tracking-wide`
        }
        style={{ color: INK_QUIET }}
      >
        {de.shop.noOffer}
      </span>
    );
  }

  return (
    <Link
      href={`/skylanders/${slug}#angebote`}
      /*
       * A marker for performance measurement, and only when this link opens
       * the quick view rather than navigating (ADR-0073).
       *
       * It carries an interaction key and nothing else — no SKY-ID, no slug,
       * no name. Telemetry is mounted only for accounts holding
       * `performance_tracking`, so for everybody else this attribute is inert
       * markup that nothing reads.
       *
       * It also keeps the navigation numbers honest. This element is an
       * anchor whose click handler calls `preventDefault()` in the bubble
       * phase, while the telemetry listener runs in the capture phase before
       * it — so without the marker a quick view open looked exactly like the
       * start of a navigation to the detail page, and the navigation that
       * never came would be charged against the next real one.
       */
      {...(onOpen ? { "data-perf": "quick_view_open" } : {})}
      /*
       * Not prefetched (V3.6, A/B).
       *
       * One of these stands on every card that has an offer, so a screen of
       * catalog is a screen of links to dynamic routes. Next prefetches a
       * link as it enters the viewport, every one of those requests passes
       * through `src/proxy.ts`, and the proxy validates the session against
       * the auth server before it knows the request is a prefetch nobody
       * asked for. Scrolling the catalog therefore bought a round trip per
       * offer — for pages most visitors never open.
       *
       * The navigation between the main sections keeps its prefetch: that is
       * where someone actually goes next, and it is a fixed handful of links
       * rather than one per card.
       */
      prefetch={false}
      onClick={(event) => {
        if (!onOpen) return;
        /*
         * Only a plain left click opens the dialog. Cmd/Ctrl, Shift and the
         * middle button all mean "somewhere else, please" — a new tab or a
         * new window — and intercepting those would take away a navigation
         * the visitor deliberately asked for.
         */
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.button !== 0) return;
        event.preventDefault();
        onOpen();
      }}
      aria-label={de.shop.offersFor(name)}
      className={
        /*
         * Active: near-black on the painted plate, and nothing else. The
         * whole line is semibold so it holds its own at 9 px on the narrowest
         * card; the price is bolder still, because that is the number being
         * scanned for. Hover and press are a touch of ink, not a surface.
         */
        `focus-ring group/offer flex h-full w-full items-center justify-center gap-1 ` +
        `whitespace-nowrap px-1.5 sm:px-2 ` +
        `text-[clamp(9px,4.8cqw,11px)] leading-none font-semibold ` +
        `transition-opacity hover:opacity-75 active:opacity-60`
      }
      style={{ color: INK_OFFER }}
    >
      {/* The price is the fact somebody is scanning for, so it is the heavier
          of the two. The label stays light and does not compete. */}
      <span>{de.shop.offersFromLabel}</span>
      <span className="font-bold tabular-nums">{formatPrice(summary.price)}</span>
      <span aria-hidden="true" className="shrink-0 text-[13px] leading-none">
        ›
      </span>
    </Link>
  );
}
