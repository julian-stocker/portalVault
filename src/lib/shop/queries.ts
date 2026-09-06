/**
 * Reading the public shop.
 *
 * One query for the whole product: `shop_offers()` returns every listed offer
 * in one call. The catalog decorates 561 cards from it and the cart checks a
 * handful of lines against it, and both get the same answer from the same
 * round trip — a per-figure lookup would be 561 requests to a question that
 * has one answer (ADR-0037).
 *
 * `cache()` memoises it per request, so a page that needs offers in two
 * places asks the database once.
 *
 * There is no write path here, and there will not be one in V1: the cart is
 * local to the browser and reserves nothing (ADR-0043).
 */
import { cache } from "react";

import { isOfferCondition, type Offer, type OfferIndex } from "@/lib/shop/offer";
import { createClient } from "@/lib/supabase/server";

type OfferRow = {
  sky_id: string;
  condition: string;
  sale_price: string | number | null;
  available: boolean;
};

/** PostgREST's code for "no function by that name". See `fetchOffers`. */
const FUNCTION_MISSING = "PGRST202";

/**
 * Every public offer, grouped by SKY-ID.
 *
 * An empty index is a completely ordinary answer: nothing is listed yet, and
 * that is what the shop looked like the day before the first listing. It is
 * also the answer while migration 0006 has not been applied to an environment
 * — the one error that is swallowed here, deliberately and narrowly, because
 * "the shop has no offers" is exactly true in that state and a catalog that
 * refused to render because of it would be a worse answer. Every other
 * failure is raised.
 */
export const fetchOffers = cache(async (): Promise<OfferIndex> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("shop_offers");

  if (error) {
    if (error.code === FUNCTION_MISSING) return new Map();
    throw new Error(`shop offers: ${error.message}`);
  }

  const index = new Map<string, Offer[]>();

  for (const row of (data ?? []) as OfferRow[]) {
    // `numeric` arrives as a string from PostgREST. A price that will not
    // parse is dropped rather than shown as NaN or as 0 — the same rule the
    // catalog follows for market_price (ADR-0010).
    const price = typeof row.sale_price === "string" ? Number(row.sale_price) : row.sale_price;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    if (!isOfferCondition(row.condition)) continue;

    const offer: Offer = {
      skyId: row.sky_id,
      condition: row.condition,
      price,
      available: row.available === true,
    };

    const existing = index.get(offer.skyId);
    if (existing) existing.push(offer);
    else index.set(offer.skyId, [offer]);
  }

  return index;
});
