/**
 * What the administration area reads about orders.
 *
 * Both calls go through `security definer` functions that ask
 * `public.is_shop_admin()` themselves (migration 0018). The session is the
 * administrator's own — anon key plus their JWT — so **no service-role key is
 * involved and none may be.** A request that reaches PostgREST without the
 * admin area gets `insufficient_privilege` from the database, not from here.
 *
 * This is the only read path that exists for orders beyond a customer's own:
 * `0010` revokes the commerce tables from every client role and grants back
 * only `*_select_own`.
 */
import { cache } from "react";

import {
  NO_OPEN_ORDERS,
  openOrderCounts,
  type AdminOrderDetail,
  type AdminOrderRow,
  type OpenOrderCounts,
} from "@/lib/admin/orders";
import { isAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The list, already ordered by how much attention each row needs.
 *
 * The ordering is the database's, not this file's — one rule, in one place
 * (migration 0018). Sorting again here would be a second copy of it.
 */
export async function fetchAdminOrders(openOnly = false): Promise<AdminOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_orders", { p_open_only: openOnly });
  if (error || !Array.isArray(data)) return [];
  return data as AdminOrderRow[];
}

/**
 * How much work is waiting — for the navigation badge and the admin home.
 *
 * WHY IT ASKS `isAdmin()` FIRST
 *
 * This runs in the shared layouts, which render for everybody. For a visitor
 * or an ordinary collector there is nothing to count and no call to make:
 * `admin_orders()` would raise `insufficient_privilege`, correctly, and that
 * exception is not something to generate on every catalog page view. The
 * database remains the boundary either way — this only avoids asking a
 * question whose answer is already known.
 *
 * `cache()` memoises per request, so a layout and the page inside it share one
 * round trip, exactly as `fetchOffers()` and `isAdmin()` already do. It is one
 * extra query per navigation **for the operator alone**, and the operator is
 * one person.
 *
 * Never throws: a badge that cannot be computed is a badge that is absent, and
 * that must not be able to take a page down with it.
 */
export const fetchOpenOrderCounts = cache(async (): Promise<OpenOrderCounts> => {
  if (!(await isAdmin())) return NO_OPEN_ORDERS;

  // `p_open_only` is `attention <= 1` in SQL — precisely the two buckets that
  // are counted, so nothing that is already settled is fetched to be ignored.
  const rows = await fetchAdminOrders(true);
  return openOrderCounts(rows);
});

/** One order as a document, or null when there is no such order. */
export async function fetchAdminOrder(orderNumber: string): Promise<AdminOrderDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_order", { p_order_number: orderNumber });
  if (error || data === null || typeof data !== "object") return null;
  return data as AdminOrderDetail;
}
