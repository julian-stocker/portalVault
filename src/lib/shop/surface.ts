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
 * memoised per request. `v1BuyableOffers()` decides what V1 sells, here
 * as everywhere else.
 *
 * NO STOCK LEVELS. An offer carries a boolean, never a count (migration 0006,
 * docs/SECURITY.md), so there is nothing here that could leak one.
 */
import type { CatalogFigure } from "@/lib/catalog/types";
import { isCollectible } from "@/lib/catalog/collectible";
import { v1BuyableOffers, offersFor, type Offer, type OfferIndex } from "@/lib/shop/offer";
import { compareFigures } from "@/lib/catalog/sort";

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
 *   not buyable       `v1BuyableOffers()` — sold out, or a condition V1 does not sell
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

    const buyable = v1BuyableOffers(offersFor(offers, figure.skyId));
    if (buyable.length === 0) continue;

    entries.push({
      figure,
      offers: buyable,
      // `v1BuyableOffers()` sorts cheapest first, so the head is
      // the cheapest thing that can actually be bought.
      fromPrice: buyable[0].price,
    });
  }

  /*
   * Cheapest first; equal prices fall back to the CATALOGUE's order (V3.6).
   *
   * This used to compare `displayName`, which was harmless while a variant
   * was shown as "Bash (Legendary)" and wrong the moment it became "Legendary
   * Bash": two cards of one figure would sit under B and under L. Reusing
   * `compareFigures` costs nothing here and means the shop can never drift
   * from the catalogue again — there is no shop-only ordering to maintain.
   */
  return entries.sort(
    (a, b) => a.fromPrice - b.fromPrice || compareFigures(a.figure, b.figure),
  );
}
