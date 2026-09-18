/**
 * The shop's year, in two numbers (ADR-0081, corrected by ADR-0083).
 *
 * Aggregated in the database, never in the page: `seller_year_to_date()`
 * returns a count and a sum, so rendering "127" costs one round trip instead
 * of a year of orders — and no customer address travels to a screen that only
 * wants a total.
 *
 * ORDER ACTIVITY, NOT MONEY RECEIVED. Both numbers come from one predicate:
 * a genuine live order placed since 1 January in Berlin. Payment timing
 * decides nothing — which is why the amount is a Bestellwert and is labelled
 * as one. An earlier draft required `paid`, and that figure was a hybrid: an
 * order placed on 30 December and paid on 2 January counted toward neither
 * year.
 *
 * A cancelled or refunded order still counts in the year it was placed;
 * undoing an order is a later event belonging to a later period, and those
 * events are not recorded anywhere yet (see `0045`).
 */
import { cache } from "react";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

export type ShopYearToDate = {
  orderCount: number;
  /** Euro. `total_amount` is items + shipping − discount, frozen per order. */
  orderValue: number;
};

/** What a shop with no qualifying orders has, and what any failure shows. */
export const NO_YEAR_TO_DATE: ShopYearToDate = { orderCount: 0, orderValue: 0 };

export const fetchShopYearToDate = cache(async (): Promise<ShopYearToDate> => {
  // Asked before the database, like every other seller reader. The function
  // refuses anyway; this saves the round trip for a collector.
  if (!(await canOperateSeller())) return NO_YEAR_TO_DATE;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_year_to_date");
  // A database without 0044 shows zeroes rather than breaking the shop home.
  if (error || data === null || typeof data !== "object") return NO_YEAR_TO_DATE;

  const row = data as Record<string, unknown>;
  /*
   * `orderValue` arrives as a string: PostgREST would otherwise hand a numeric
   * to a float and lose the last cent on a large enough total. It is parsed
   * once, here, and formatted by `formatPrice` like every other amount.
   */
  const orderValue =
    typeof row.order_value === "string" ? Number(row.order_value) : row.order_value;

  return {
    orderCount: typeof row.order_count === "number" ? row.order_count : 0,
    orderValue: typeof orderValue === "number" && Number.isFinite(orderValue) ? orderValue : 0,
  };
});
