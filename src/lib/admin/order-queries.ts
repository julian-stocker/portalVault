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
import type { AdminOrderDetail, AdminOrderRow } from "@/lib/admin/orders";
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

/** One order as a document, or null when there is no such order. */
export async function fetchAdminOrder(orderNumber: string): Promise<AdminOrderDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_order", { p_order_number: orderNumber });
  if (error || data === null || typeof data !== "object") return null;
  return data as AdminOrderDetail;
}
