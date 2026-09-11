/**
 * A customer's own orders.
 *
 * Two functions behind this, both added by 0022: `my_orders()` for the list
 * and `my_order()` for one. Neither is a table read — a grant is column-blind
 * and `orders` carries `client_hash`, `payment_token_hash` and `request_id`,
 * none of which has any business in a browser.
 *
 * Only orders with a `user_id`. A guest order belongs to whoever holds its
 * capability, not to whoever happens to have typed the same address at
 * sign-up (ADR-0032).
 */
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * One line in the list. Both status axes folded into one word, because a
 * customer wants to know where their parcel is, not which of two state
 * machines it is in.
 */
export type MyOrderStatus =
  | "awaiting_payment"
  | "paid"
  | "shipped"
  | "needs_attention"
  | "closed";

export type MyOrderRow = {
  orderNumber: string;
  placedAt: string;
  totalAmount: number;
  lineCount: number;
  commerceMode: string;
  status: MyOrderStatus;
};

/**
 * The two axes, as one answer.
 *
 * Order matters: a flagged order is flagged whatever else is true of it, and
 * a shipped one is shipped whether or not the payment row says `paid`.
 */
export function customerStatus(
  paymentStatus: string,
  fulfillmentStatus: string,
  needsResolution: boolean,
): MyOrderStatus {
  if (needsResolution) return "needs_attention";
  if (fulfillmentStatus === "shipped" || fulfillmentStatus === "completed") return "shipped";
  if (paymentStatus === "paid") return "paid";
  if (["cancelled", "refunded", "partially_refunded", "expired"].includes(paymentStatus)) {
    return "closed";
  }
  if (fulfillmentStatus === "cancelled") return "closed";
  return "awaiting_payment";
}

type Row = {
  order_number?: unknown;
  placed_at?: unknown;
  payment_status?: unknown;
  fulfillment_status?: unknown;
  needs_resolution?: unknown;
  total_amount?: unknown;
  line_count?: unknown;
  commerce_mode?: unknown;
};

export function readMyOrders(rows: unknown): MyOrderRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): MyOrderRow[] => {
    if (typeof row !== "object" || row === null) return [];
    const raw = row as Row;
    if (typeof raw.order_number !== "string" || raw.order_number === "") return [];
    const total = Number(raw.total_amount);
    return [{
      orderNumber: raw.order_number,
      placedAt: typeof raw.placed_at === "string" ? raw.placed_at : "",
      totalAmount: Number.isFinite(total) ? total : 0,
      lineCount: typeof raw.line_count === "number" ? raw.line_count : 0,
      commerceMode: typeof raw.commerce_mode === "string" ? raw.commerce_mode : "live",
      status: customerStatus(
        typeof raw.payment_status === "string" ? raw.payment_status : "",
        typeof raw.fulfillment_status === "string" ? raw.fulfillment_status : "",
        raw.needs_resolution === true,
      ),
    }];
  });
}

export const fetchMyOrders = cache(async (): Promise<MyOrderRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_orders", { p_limit: 50 });
  if (error) return [];
  return readMyOrders(data);
});

/** One order as a document, or null when it is not this account's. */
export const fetchMyOrder = cache(async (orderNumber: string): Promise<unknown | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_order", { p_order_number: orderNumber });
  if (error || !data) return null;
  return data;
});
