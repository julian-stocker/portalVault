/**
 * "Only figures somebody is actually offering" (V3.3).
 *
 * A dimension of its own, deliberately not a third option beside
 * `Alle / In Besitz / Fehlend`. Owning a figure and being able to buy one are
 * independent facts, and the combinations people want are exactly the ones a
 * merged control would make impossible — "missing AND buyable" is the whole
 * reason somebody opens a catalog with money in mind.
 *
 * WHAT COUNTS AS BUYABLE
 *
 * Not `offers.length > 0`. A position can be listed and out of stock, and the
 * shop already has a word for the difference: `shop_offers()` returns an
 * `available` boolean, and `summarizeOffers()` folds it into the answer the
 * card's trade row shows (`kind: "none"` when nothing can be bought).
 *
 * This filter asks THAT function. Not a re-implementation of it, not a
 * similar-looking predicate: the same call the card makes, so a figure the
 * filter keeps is exactly a figure whose card says "Angebote ab …".
 *
 * AND IT LOADS NOTHING. The offers are already in the browser — `fetchOffers()`
 * put them there in the render that drew the grid (ADR-0043), and the quick
 * view reads the same object. Filtering by them costs an array pass.
 */
import { hasV1BuyableOffer, type Offer } from "@/lib/shop/offer";

export const AVAILABILITY_MODES = ["all", "available"] as const;

export type AvailabilityMode = (typeof AVAILABILITY_MODES)[number];

export const DEFAULT_AVAILABILITY: AvailabilityMode = "all";

export function isAvailabilityMode(value: unknown): value is AvailabilityMode {
  return typeof value === "string" && (AVAILABILITY_MODES as readonly string[]).includes(value);
}

/** True when the filter is doing something — what the badge counts. */
export function isAvailabilityActive(mode: AvailabilityMode): boolean {
  return mode !== DEFAULT_AVAILABILITY;
}

/**
 * Is anything buyable for this figure right now?
 *
 * One call through to `hasV1BuyableOffer`, which is what the card's trade row,
 * the quick view, the figure page and the shop grid all resolve to as well.
 * "Mit Angebot" and "opens a quick view" are therefore the SAME answer in V1
 * — they differed once, and a boxed-only figure fell between them (V3.3).
 */
export function hasBuyableOffer(offers: readonly Offer[] | undefined): boolean {
  return hasV1BuyableOffer(offers);
}

/** Does this figure pass the availability filter in this mode? */
export function matchesAvailability(
  offers: readonly Offer[] | undefined,
  mode: AvailabilityMode,
): boolean {
  return mode === "all" || hasBuyableOffer(offers);
}
