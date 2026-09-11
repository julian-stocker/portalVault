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

/** The three mails, as `order_mail.kind` spells them. */
export type MailKind = "payment_confirmation" | "shipping_confirmation" | "resolution_alert";

export type MailResult =
  | { ok: true; outcome: string }
  | { ok: false; message: string };

/**
 * Ask the Edge Function to send one mail.
 *
 * WHY IT IS NOT SENT FROM HERE
 *
 * `RESEND_API_KEY` is a Supabase secret and never reaches Vercel (ADR-0051,
 * ADR-0059). This deployment holds no key that can send anything; it asks the
 * one function that can.
 *
 * `functions.invoke()` attaches the signed-in administrator's access token,
 * which `send-order-mail` verifies and then checks against `shop_admins`. A
 * caller who is not an administrator is refused there, not here.
 *
 * NEVER THROWS. Every caller is a write that has already succeeded — an order
 * that is shipped, a setting that is saved. A mail that did not go out is
 * recorded in `order_mail` and shown on the order; it is not a reason to tell
 * the operator their action failed.
 */
async function sendOrderMail(
  orderNumber: string,
  kind: MailKind,
  force = false,
): Promise<MailResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.functions.invoke("send-order-mail", {
      body: { orderNumber, kind, force },
    });
    if (error) return { ok: false, message: de.admin.orders.mail.sendFailed };
    const outcome = typeof data?.outcome === "string" ? data.outcome : "unknown";
    return { ok: true, outcome };
  } catch {
    return { ok: false, message: de.admin.orders.mail.sendFailed };
  }
}

/**
 * The administrator's retry, for a mail that did not go out.
 *
 * There is deliberately no way to resend a mail that DID go out: `sent` is
 * terminal in `claim_order_mail()`, and Resend's idempotency window is 24
 * hours — past it, a second send is a second message in the customer's inbox
 * and no flag makes that acceptable.
 *
 * `force` is for the ambiguous case only, and only ever from a human who has
 * looked at the record: a 409 on the idempotency key or a crashed request
 * might mean the mail went out. The interface asks before it passes this.
 */
export async function retryOrderMail(
  orderNumber: string,
  kind: MailKind,
  acknowledgeUnresolved = false,
): Promise<MailResult> {
  if (!(await isAdmin())) return { ok: false, message: de.admin.notAllowed };

  const result = await sendOrderMail(orderNumber, kind, acknowledgeUnresolved);

  revalidatePath(`/admin/orders/${orderNumber}`);
  return result;
}

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

  // The parcel is recorded as gone. Telling the customer comes next, and it
  // is deliberately not part of that fact: a mail provider having a bad minute
  // must not make a shipped order look unshipped.
  await sendOrderMail(orderNumber, "shipping_confirmation");

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNumber}`);
  return { ok: true };
}
