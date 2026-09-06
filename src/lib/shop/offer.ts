/**
 * What SkyIsles sells, as the public sees it.
 *
 * An offer is four values and no more: which figure, in what condition, for
 * how much, and whether it can be bought right now. The stock level behind it
 * is internal and never leaves the database — `available` is a boolean, not a
 * count (docs/SECURITY.md, migration 0006).
 *
 * Two prices exist in this product and they are not the same thing (ADR-0033):
 *
 *   market_price   what the figure is worth      catalog, collection value
 *   sale_price     what SkyIsles asks for one    this file
 *
 * Nothing here derives one from the other, in either direction.
 *
 * No database import: the catalog grid, the cart and the detail page all use
 * these rules, and two of the three run in the browser.
 */

/** The two conditions V1 knows. Mirrors `shop_inventory_condition_known`. */
export const OFFER_CONDITIONS = ["loose", "boxed"] as const;

export type OfferCondition = (typeof OFFER_CONDITIONS)[number];

export function isOfferCondition(value: unknown): value is OfferCondition {
  return typeof value === "string" && (OFFER_CONDITIONS as readonly string[]).includes(value);
}

/** One thing SkyIsles offers. The projection of `shop_offers()`, unchanged. */
export type Offer = {
  skyId: string;
  condition: OfferCondition;
  /** In EUR. Never null: the database refuses to list a position without one. */
  price: number;
  /** Can it be bought right now? Deliberately not "how many are left". */
  available: boolean;
};

/** Every offer, grouped by figure. Figures without one are simply absent. */
export type OfferIndex = ReadonlyMap<string, readonly Offer[]>;

export const NO_OFFERS: OfferIndex = new Map();

export function offersFor(index: OfferIndex, skyId: string): readonly Offer[] {
  return index.get(skyId) ?? [];
}

/**
 * Offers in a stable order: buyable first, then cheapest.
 *
 * Not the database's order (sky_id, condition), because "loose" sorting
 * before "boxed" alphabetically is an accident, and an out-of-stock line
 * standing above one that can be bought is a worse accident.
 */
export function sortOffers(offers: readonly Offer[]): Offer[] {
  return [...offers].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.price !== b.price) return a.price - b.price;
    return a.condition.localeCompare(b.condition);
  });
}

/**
 * What a card should say about a figure, if anything.
 *
 * `none`        SkyIsles does not carry it. The card says nothing at all —
 *               most of the 561 are in this state and a "nicht im Angebot"
 *               line on all of them would be noise.
 * `single`      exactly one buyable offer: the price, plainly.
 * `from`        more than one buyable offer, at different prices: "ab …".
 *               Two conditions at the same price is still a single price,
 *               so it is `single` — "ab 9,90 €" beside nothing but 9,90 €
 *               reads as though something cheaper were being withheld.
 * `soldOut`     carried, but nothing available. "Nicht auf Lager" is more
 *               use than silence: it says the shop has this article.
 */
export type OfferSummary =
  | { kind: "none" }
  | { kind: "single"; price: number; condition: OfferCondition }
  | { kind: "from"; price: number }
  | { kind: "soldOut" };

export function summarizeOffers(offers: readonly Offer[]): OfferSummary {
  if (offers.length === 0) return { kind: "none" };

  const buyable = offers.filter((offer) => offer.available);
  if (buyable.length === 0) return { kind: "soldOut" };

  const cheapest = buyable.reduce((low, offer) => (offer.price < low.price ? offer : low));
  const onePrice = buyable.every((offer) => offer.price === cheapest.price);

  return onePrice
    ? { kind: "single", price: cheapest.price, condition: cheapest.condition }
    : { kind: "from", price: cheapest.price };
}

/**
 * The index as a plain object, for the server → client boundary.
 *
 * A `Map` does not survive React's serialisation of props, and silently
 * arrives as `{}` on the other side. Converting explicitly is one line and
 * makes the boundary visible.
 */
export function offerRecord(index: OfferIndex): Record<string, readonly Offer[]> {
  return Object.fromEntries(index);
}

/** The plain object back as an index, for code that works with either. */
export function offerIndex(record: Readonly<Record<string, readonly Offer[]>>): OfferIndex {
  return new Map(Object.entries(record));
}

/** The offer for one exact article, or null. The cart's lookup. */
export function findOffer(
  index: OfferIndex,
  skyId: string,
  condition: OfferCondition,
): Offer | null {
  return offersFor(index, skyId).find((offer) => offer.condition === condition) ?? null;
}
