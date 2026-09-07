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
 * What the automatic price of a figure would be — exactly as the database
 * computes it.
 *
 * THIS IS NOT THE PRICE THAT IS CHARGED. `public.shop_price()` is, and it is
 * the only thing that ever decides what an offer costs (ADR-0045). This
 * mirror exists for two jobs that cannot ask the database:
 *
 *   the admin card   "what would this cost without its manual override?"
 *   verify:shop      an independent expectation to compare the projection
 *                    against — one that must not simply call shop_price(),
 *                    or the comparison would prove nothing
 *
 * EXACT, NOT FLOATING POINT. `16.65 × 90 %` is 14.985, which rounds to 14.99;
 * `Math.round(16.65 * 90) / 100` gives 14.98, because 16.65 × 90 is
 * 1498.4999999999998 in binary. That was a real defect in the verifier and in
 * the admin preview, found by the verifier's own price check on live data.
 *
 * So the arithmetic runs on integers: cents × hundredths-of-a-percent,
 * divided by 10 000, rounded half away from zero — which is what
 * `round(numeric, 2)` does in Postgres. Values arrive with at most two
 * decimals (`numeric(10,2)`, `numeric(6,2)`), so scaling them by 100 and
 * rounding recovers the exact integer they represent.
 */
export function automaticShopPrice(
  marketPrice: number | null,
  percentage: number | null,
): number | null {
  if (marketPrice === null || percentage === null) return null;
  if (!Number.isFinite(marketPrice) || !Number.isFinite(percentage)) return null;
  if (marketPrice <= 0 || percentage <= 0) return null;

  const cents = Math.round(marketPrice * 100);
  const hundredths = Math.round(percentage * 100);
  // Both operands are positive, so "half away from zero" is "+ half, floor".
  return Math.floor((cents * hundredths + 5000) / 10000) / 100;
}

/** What can actually be bought right now. Listed but empty is not an offer. */
export function buyableOffers(offers: readonly Offer[]): Offer[] {
  return sortOffers(offers.filter((offer) => offer.available));
}

/**
 * What a card should say about a figure, if anything.
 *
 * `none`    nothing can be bought right now. The card shows **no shop area
 *           at all** — not a disabled button, not "Nicht auf Lager", not a
 *           greyed-out surface. The catalog is a collector's catalog first
 *           (ADR-0025); an article that cannot be bought is an article the
 *           collector catalog has nothing to say about, and most of the 561
 *           are in that state. Sold-out and listing status belong on a shop
 *           surface of their own, later.
 * `single`  one price to pay — either a single buyable condition, or two at
 *           the same price. Adding is one tap.
 * `from`    buyable at more than one price: "ab 4,49 €", and the condition
 *           is chosen when the button is pressed.
 *
 * Two conditions at the same price stays `single`: "ab 4,49 €" beside
 * nothing cheaper than 4,49 € reads as though something were being withheld.
 */
export type OfferSummary =
  | { kind: "none" }
  | { kind: "single"; price: number; condition: OfferCondition }
  | { kind: "from"; price: number };

export function summarizeOffers(offers: readonly Offer[]): OfferSummary {
  const buyable = offers.filter((offer) => offer.available);
  if (buyable.length === 0) return { kind: "none" };

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
