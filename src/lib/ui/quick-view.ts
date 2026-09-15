/**
 * What the quick view shows — decided, not rendered.
 *
 * The catalog already holds everything this panel needs: `fetchCatalog()` put
 * the figure in the browser and `fetchOffers()` put the offers there, both in
 * the same render that drew the card (ADR-0043). So opening the quick view
 * loads nothing. This function is the proof of that: it takes what the card
 * was given and returns what the panel draws, and it cannot reach a network
 * if it wanted to.
 *
 * Pure, and therefore testable without a renderer — the same split
 * `lib/cart/add.ts` uses, and for the same reason: the rules are here, the
 * React is elsewhere.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No seller, no rating, no delivery estimate, no shipping cost. None of the
 * four exists in the data:
 *
 *   seller    `sellers` is readable only by an administrator — `active_seller()`
 *             is revoked from anon and authenticated (0026) and the app holds
 *             no service-role key (ADR-0051). Naming yulez.collectibles here
 *             would mean a second source of truth for a trade name, which
 *             ADR-0059 forbids.
 *   rating    there is no such table, and there is one seller.
 *   shipping  the amount depends on the whole basket, not on this article —
 *             free from 75 € of goods — and lives in migration 0011 alone,
 *             deliberately never mirrored into the application.
 *
 * An invented value in any of those places would be a claim the product
 * cannot keep.
 */
import type { CatalogFigure } from "@/lib/catalog/types";
import type { Element } from "@/lib/catalog/character";
import { imageSrc } from "@/lib/catalog/image";
import { sortOffers, type Offer, type OfferCondition } from "@/lib/shop/offer";

/**
 * The one condition the quick view trades in.
 *
 * A product decision, not a technical one: the quick view exists for browsing
 * and buying quickly, and a boxed copy is a more deliberate purchase that
 * deserves the whole figure page. Boxed offers keep existing, keep being
 * listed, and keep being buyable — on `/skylanders/<slug>`, where there is
 * room to say what "OVP" means for a twelve-year-old toy.
 *
 * Stated here, once, rather than as a condition buried in the renderer: every
 * surface that asks this module what the quick view trades gets the same
 * answer, including the catalog card that decides whether to offer the dialog
 * at all.
 */
export const QUICK_VIEW_CONDITION: OfferCondition = "loose";

/**
 * What the quick view can sell for a figure: loose, in stock, cheapest first.
 *
 * Returns a list although the schema allows only one. `shop_inventory` carries
 * a unique index on `(sky_id, condition)`, so one figure has at most one loose
 * position and this can hold at most one entry today. It is a list because the
 * shape is what a second seller would arrive into, and because a caller that
 * assumed "exactly one" would have to be found and rewritten at that point.
 */
export function quickBuyOffers(offers: readonly Offer[] | undefined): Offer[] {
  const loose = (offers ?? []).filter(
    (offer) => offer.available && offer.condition === QUICK_VIEW_CONDITION,
  );
  // `sortOffers` puts buyable first and then cheapest; everything here is
  // buyable, so what is left is ascending price.
  return sortOffers(loose);
}

export type QuickViewModel = {
  /** Permanent identity, shown as such. */
  skyId: string;
  /** The derived spelling — "Bash (Legendary)" (ADR-0030). */
  name: string;
  /** Navigation only, for the secondary action (ADR-0011). */
  slug: string;
  seriesLabel: string;
  /** Verbatim from the legacy source, or null when the row carries none. */
  categoryName: string | null;
  /** From the curated character, never guessed from a name (ADR-0034). */
  element: Element | null;
  /** null means "no known market price" — never 0 (ADR-0010). */
  marketPrice: number | null;
  /** Already resolved through the override rule (ADR-0046). */
  imageSrc: string | null;
  /**
   * The loose offers, cheapest first. Never empty — a model exists only when
   * there is something to buy.
   *
   * No seller, no rating, no stock count and no shipping: none of the four is
   * in `shop_offers()`, which returns `sky_id`, `condition`, `price` and an
   * availability boolean and nothing else.
   */
  offers: readonly Offer[];
};

/**
 * The model for one figure, or `null` when there is nothing to quick-buy.
 *
 * `null` is the important half. A card with no buyable offer shows no trade
 * link at all (`OfferLink` renders a plain span), so the panel should never
 * be reachable for one — and if a future caller reaches it anyway, it opens
 * nothing rather than an empty shop surface. Sold-out state belongs to a shop
 * surface of its own, not to a dialog that promised an offer (V7).
 */
export function quickViewModel(
  figure: CatalogFigure | undefined | null,
  offers: readonly Offer[] | undefined,
): QuickViewModel | null {
  if (!figure) return null;

  // Loose, in stock, cheapest first. A figure whose only listing is boxed has
  // nothing for this dialog and gets none — the card then leads to the figure
  // page, where the boxed offer is.
  const buyable = quickBuyOffers(offers);
  if (buyable.length === 0) return null;

  return {
    skyId: figure.skyId,
    name: figure.displayName,
    slug: figure.slug,
    seriesLabel: figure.seriesLabel,
    // Empty string and null both mean "nothing to show", and the panel should
    // not have to know the difference.
    categoryName: figure.categoryName ? figure.categoryName : null,
    element: figure.element,
    marketPrice: figure.marketPrice,
    imageSrc: imageSrc(figure),
    offers: buyable,
  };
}
