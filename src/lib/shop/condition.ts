/**
 * German for the two conditions.
 *
 * Lived in `shop-action.tsx` until V3.2, which imported a client component
 * for one string. The buy pill that file existed for is gone — the catalog
 * card now links to the figure's offers instead of selling from the grid —
 * so the label moved to where a label belongs.
 */
import type { OfferCondition } from "@/lib/shop/offer";
import { de } from "@/lib/i18n/de";

export function conditionLabel(condition: OfferCondition): string {
  return condition === "boxed" ? de.shop.conditionBoxed : de.shop.conditionLoose;
}
