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
  type AdminOrderDetail,
  type AdminOrderRow,
  type OpenOrderCounts,
} from "@/lib/admin/orders";
import { ACTIVE_WINDOW_DAYS, type OrderMonth } from "@/lib/admin/order-archive";
import { canOperateSeller } from "@/lib/auth/capabilities";
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
 * How much work is waiting — for the navigation badge and the shop home.
 *
 * AN AGGREGATE, NOT A PAGE. This used to count the rows `fetchAdminOrders(true)`
 * returned, and that call is capped at 100. The badge was therefore never a
 * count of open orders; it was a count of the first hundred of them, and a
 * shop with 130 flagged orders said 100 forever. `seller_open_order_counts()`
 * asks the database for three numbers (ADR-0082). Same predicate, same three
 * buckets, no cap, and one row over the wire instead of a hundred.
 *
 * WHY IT ASKS `canOperateSeller()` FIRST
 *
 * This runs in the shared layouts, which render for everybody. For a visitor
 * or an ordinary collector there is nothing to count and no call to make: the
 * function would raise `insufficient_privilege`, correctly, and that exception
 * is not something to generate on every catalog page view. The database
 * remains the boundary either way — this only avoids asking a question whose
 * answer is already known.
 *
 * `cache()` memoises per request, so a layout and the page inside it share one
 * round trip.
 *
 * Never throws: a badge that cannot be computed is a badge that is absent, and
 * that must not be able to take a page down with it.
 */
export const fetchOpenOrderCounts = cache(async (): Promise<OpenOrderCounts> => {
  if (!(await canOperateSeller())) return NO_OPEN_ORDERS;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_open_order_counts");
  // A database without 0045 yields zeroes, which renders as no badge at all —
  // the same thing an empty shop shows, and nothing broken.
  if (error || data === null || typeof data !== "object") return NO_OPEN_ORDERS;

  const row = data as Record<string, unknown>;
  const count = (value: unknown) => (typeof value === "number" && value >= 0 ? value : 0);
  return {
    needsResolution: count(row.needs_resolution),
    toShip: count(row.to_ship),
    inFlight: count(row.in_flight),
  };
});

/** One order as a document, or null when there is no such order. */
export async function fetchAdminOrder(orderNumber: string): Promise<AdminOrderDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_order", { p_order_number: orderNumber });
  if (error || data === null || typeof data !== "object") return null;
  return data as AdminOrderDetail;
}

/* ----------------------------------------------------------------- archive */

/**
 * The active section: recent orders, plus every order still open whatever its
 * age (ADR-0082).
 *
 * A separate call from `fetchAdminOrders()` rather than a filter on top of it,
 * because the filtering is the part that must happen in the database. Fetching
 * a lifetime of orders in order to keep fifteen days of them is the shape this
 * whole round exists to avoid.
 */
export async function fetchActiveOrders(
  days: number = ACTIVE_WINDOW_DAYS,
): Promise<AdminOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_orders_active", { p_days: days });
  if (error || !Array.isArray(data)) return [];
  return data as AdminOrderRow[];
}

/**
 * One Berlin month.
 *
 * `archivedOnly` is the difference between the two views: drawing the working
 * view's archive section (true — what is above must not repeat below) and
 * answering a seller who asked for that month (false — the month, all of it).
 */
export async function fetchOrdersForMonth(
  year: number,
  month: number,
  archivedOnly: boolean,
): Promise<AdminOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_orders_month", {
    p_year: year,
    p_month: month,
    p_archived_only: archivedOnly,
    p_days: ACTIVE_WINDOW_DAYS,
  });
  if (error || !Array.isArray(data)) return [];
  return data as AdminOrderRow[];
}

/**
 * Month headings and their counts — never the orders inside them.
 *
 * At most twelve rows per year the shop has traded. This is what lets the
 * archive name every month it has without loading a single historical order:
 * the rows arrive only when a month is actually opened.
 */
export const fetchOrderCalendar = cache(async (): Promise<OrderMonth[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_order_calendar", {
    p_days: ACTIVE_WINDOW_DAYS,
  });
  if (error || !Array.isArray(data)) return [];
  return data as OrderMonth[];
});

/* ------------------------------------------------------------ test orders */

/** One test order, as `seller_test_orders()` returns it. */
export type TestOrderRow = AdminOrderRow & {
  /** When it was put away, or null while it is still in the active list. */
  sandbox_archived_at: string | null;
};

/**
 * The shop's test orders — sandbox only, and nothing else ever (ADR-0084).
 *
 * A separate call rather than a flag on the live list, because the two are not
 * the same list with a filter: one is the seller's work and the other is the
 * record of how the checkout behaved. Mixing them is what this round undid.
 */
export async function fetchTestOrders(includeArchived = false): Promise<TestOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_test_orders", {
    p_include_archived: includeArchived,
  });
  if (error || !Array.isArray(data)) return [];
  return data as TestOrderRow[];
}
