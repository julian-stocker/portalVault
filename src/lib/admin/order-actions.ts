/**
 * Marking an order as shipped.
 *
 * The only write fulfilment has in V1, and a thin wrapper like every other
 * editorial action: `admin_mark_order_shipped()` asks `is_shop_admin()`
 * itself, re-checks that the order is paid, unflagged and unshipped, and sets
 * `shipped_at` from the server clock. This file cannot weaken any of that.
 *
 * `isAdmin()` is asked first for the same reason as in `actions.ts`: to answer
 * in German instead of surfacing a Postgres error, and to keep a pointless
 * round trip out. It is not the boundary.
 *
 * **Nothing here touches stock, reservations, payment or `needs_resolution`.**
 * The sale was booked when `confirm_order_payment()` converted the
 * reservation; this records that a parcel left.
 */
"use server";

import { revalidatePath } from "next/cache";

import { normaliseTracking, trackingTooLong } from "@/lib/admin/orders";
import { isAdmin } from "@/lib/auth/admin";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

export type ShipResult = { ok: true } | { ok: false; message: string };

/** Postgres codes `admin_mark_order_shipped()` raises for a refusal. */
const REFUSED = new Set(["23514", "check_violation", "P0002", "no_data_found"]);
const NOT_ADMIN = new Set(["42501", "insufficient_privilege"]);

export async function markOrderShipped(
  orderNumber: string,
  trackingNumber: string | null,
): Promise<ShipResult> {
  if (!(await isAdmin())) return { ok: false, message: de.admin.notAllowed };

  const tracking = normaliseTracking(trackingNumber);
  if (trackingTooLong(tracking)) {
    return { ok: false, message: de.admin.orders.trackingTooLong };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_mark_order_shipped", {
    p_order_number: orderNumber,
    p_tracking_number: tracking,
  });

  if (error) {
    const code = error.code ?? "";
    if (NOT_ADMIN.has(code)) return { ok: false, message: de.admin.notAllowed };
    // A refusal is a fact about the order, not a fault: unpaid, flagged, or
    // already gone. The page re-reads and shows which.
    if (REFUSED.has(code)) return { ok: false, message: de.admin.orders.shipRefused };
    return { ok: false, message: de.admin.orders.shipFailed };
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNumber}`);
  return { ok: true };
}
