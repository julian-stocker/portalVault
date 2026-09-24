/**
 * Cancelling a position, and taking one back (0095).
 *
 * TWO ACTS THAT MOVE STOCK AND NO MONEY. The repayment is separate and stays
 * separate: `recordRefund()` documents what the operator did in Stripe, and
 * nothing here calls it, suggests it or waits for it.
 *
 * WHAT THE BROWSER SENDS. Two answers, and they are independent: why it was
 * cancelled (`reasonCode`, one of a fixed set since 0097) and whether the
 * goods are physically there (`present` or `missing`). Only the second one
 * has anything to do with stock. Whether the
 * position ever left stock is a technical fact the database reads from
 * `order_reservations.movement_id`, and the outcome (`restocked`, `shortfall`
 * or `none`) is decided there, never here. A tampered request can therefore
 * ask for the wrong answer to the physical question, which is a lie an
 * operator could also tell out loud; it cannot produce a movement the stock
 * ledger would refuse.
 */
"use server";

import { revalidatePath } from "next/cache";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { isCancelReason, type CancelReason, type StockPresence }
  from "@/lib/commerce/order-lines";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

export type LineActionResult =
  | { ok: true; stockOutcome: string; orderCancelled: boolean }
  | { ok: false; message: string };

const copy = de.admin.orders.lineActions;

/** The refusals worth a sentence. Everything else is the generic one. */
function message(error: { code?: string; message?: string }): string {
  const text = error.message ?? "";
  if (error.code === "42501" || text.includes("seller operator role required")) {
    return de.admin.notAllowed;
  }
  if (text.includes("are still open") || text.includes("are still out")) return copy.tooMany;
  if (text.includes("only an unfulfilled order")) return copy.alreadyShipped;
  if (text.includes("only a shipped order")) return copy.notShipped;
  if (text.includes("never left stock")) return copy.neverBooked;
  if (text.includes("only a paid order")) return copy.notPaid;
  if (text.includes("unknown cancellation reason")) return copy.reasonMissing;
  if (text.includes("different commerce mode")) return copy.wrongMode;
  if (text.includes("reverted as a test order")) return copy.sandboxReverted;
  console.error(`order line action: unmapped ${error.code ?? "?"} ${text}`);
  return de.admin.writeFailed;
}

function paths(orderNumber: string): string[] {
  return [
    `/business/orders/${orderNumber}`,
    "/business/orders",
    "/business/widerrufe",
    // The shelf changed, or deliberately did not — either way the overview
    // above the stock list is now a different number.
    "/business/inventory",
  ];
}

/**
 * Cancels a quantity of one position before dispatch.
 *
 * `orderNumber` is only used to revalidate; the database identifies the
 * position by its id and reads the order from it, so a caller cannot pair a
 * line with somebody else's order.
 */
export async function cancelOrderLine(input: {
  orderNumber: string;
  orderLineId: number;
  quantity: number;
  presence: StockPresence;
  /** Why it was cancelled. Says nothing about the shelf — see CANCEL_REASONS. */
  reasonCode: CancelReason;
  reason?: string;
}): Promise<LineActionResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { ok: false, message: copy.quantityInvalid };
  }
  if (input.presence !== "present" && input.presence !== "missing") {
    return { ok: false, message: copy.presenceMissing };
  }
  /* Refused here and again by the CHECK on the column: the set of reasons is
     not a matter of what a browser happens to send. */
  if (!isCancelReason(input.reasonCode)) {
    return { ok: false, message: copy.reasonMissing };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_cancel_order_line", {
    p_order_line_id: input.orderLineId,
    p_quantity: input.quantity,
    p_stock_presence: input.presence,
    p_reason_code: input.reasonCode,
    p_reason: input.reason?.trim() || null,
  });
  if (error) return { ok: false, message: message(error) };

  for (const path of paths(input.orderNumber)) revalidatePath(path);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    stockOutcome: String(row.stock_outcome ?? "none"),
    orderCancelled: row.order_cancelled === true,
  };
}

/** Books a quantity of one shipped position back into stock. */
export async function receiveOrderReturn(input: {
  orderNumber: string;
  orderLineId: number;
  quantity: number;
  reason?: string;
}): Promise<LineActionResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { ok: false, message: copy.quantityInvalid };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("seller_receive_order_return", {
    p_order_line_id: input.orderLineId,
    p_quantity: input.quantity,
    p_reason: input.reason?.trim() || null,
  });
  if (error) return { ok: false, message: message(error) };

  for (const path of paths(input.orderNumber)) revalidatePath(path);
  return { ok: true, stockOutcome: "restocked", orderCancelled: false };
}
