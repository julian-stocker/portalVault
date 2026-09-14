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

/** Ink on the plate. 5.4:1 on the darker of the two templates. */
const INK = "text-[#39424d]";

export function OfferLink({
  offers,
  slug,
  name,
}: {
  offers: readonly Offer[];
  slug: string;
  /** For the accessible name: "Angebote für Bouncer ansehen". */
  name: string;
}) {
  const summary = summarizeOffers(offers);

  if (summary.kind === "none") {
    return (
      <span
        className={
          `flex h-full w-full items-center justify-center whitespace-nowrap px-1.5 sm:px-2 ` +
          `text-[clamp(9px,4.8cqw,11px)] leading-none ` +
          `font-medium tracking-wide ${INK} opacity-80`
        }
      >
        {de.shop.noOffer}
      </span>
    );
  }

  return (
    <Link
      href={`/skylanders/${slug}#angebote`}
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
      aria-label={de.shop.offersFor(name)}
      className={
        `focus-ring group/offer flex h-full w-full items-center justify-center gap-1 ` +
        `whitespace-nowrap px-1.5 sm:px-2 ` +
        `text-[clamp(9px,4.8cqw,11px)] leading-none font-semibold tabular-nums ${INK} ` +
        `transition-opacity hover:opacity-80`
      }
    >
      <span>{de.shop.offersFrom(formatPrice(summary.price))}</span>
      <span aria-hidden="true" className="shrink-0 text-[13px] leading-none">
        ›
      </span>
    </Link>
  );
}
