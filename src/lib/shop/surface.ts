/**
 * What SkyIsles is offering right now, as a page can render it.
 *
 * The shop had no surface of its own: a buyable figure was a gold pill on one
 * of 561 catalog cards, behind a series tab that opens on Spyro's Adventure.
 * Nothing answered "what do you sell?" — and the shop takes real money.
 *
 * NO SECOND DATA SOURCE, NO SECOND RULE
 *
 * This is a join, not a query. The catalog comes from `fetchCatalog()` and the
 * offers from `shop_offers()` — the same two calls `/` already makes, both
 * memoised per request. `buyableOffers()` decides what "available" means, here
 * as everywhere else.
 *
 * NO STOCK LEVELS. An offer carries a boolean, never a count (migration 0006,
 * docs/SECURITY.md), so there is nothing here that could leak one.
 */
import type { CatalogFigure } from "@/lib/catalog/types";
import { isCollectible } from "@/lib/catalog/collectible";
import { buyableOffers, offersFor, type Offer, type OfferIndex } from "@/lib/shop/offer";

/** One figure that can be bought, with the offers that make it buyable. */
export type ShopEntry = {
  figure: CatalogFigure;
  /** Always at least one, always `available`. Sorted cheapest first. */
  offers: readonly Offer[];
  /** The cheapest buyable price. What the grid sorts by. */
  fromPrice: number;
};

/**
 * Everything on offer, cheapest first.
 *
 * Three exclusions, and each is a rule that already exists somewhere else:
 *
 *   not buyable       `buyableOffers()` — listed but sold out is not an offer
 *   not visible       `catalogVisible` — an editorially hidden figure has no
 *                     public detail page either (ADR-0039), so it must not
 *                     appear on a public shop page
 *   not a collectible `isCollectible()` — console games are canonical rows,
 *                     not part of the collector catalog (ADR-0029)
 *
 * Sorted by price rather than by name: a shop page is read as a price list,
 * and the cheapest thing is the one most people are looking for. Ties fall
 * back to the display name so the order is stable between requests.
 */
export function shopEntries(
  catalog: readonly CatalogFigure[],
  offers: OfferIndex,
): ShopEntry[] {
  const entries: ShopEntry[] = [];

  for (const figure of catalog) {
    if (!figure.catalogVisible) continue;
    if (!isCollectible(figure)) continue;

    const buyable = buyableOffers(offersFor(offers, figure.skyId));
    if (buyable.length === 0) continue;

    entries.push({
      figure,
      offers: buyable,
      // `buyableOffers()` sorts available-first then cheapest, so the head is
      // the cheapest thing that can actually be bought.
      fromPrice: buyable[0].price,
    });
  }

  return entries.sort(
    (a, b) =>
      a.fromPrice - b.fromPrice ||
      a.figure.displayName.localeCompare(b.figure.displayName, "de"),
  );
}
