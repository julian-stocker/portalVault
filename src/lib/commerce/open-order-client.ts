/**
 * Asking the database about an open order, from the browser.
 *
 * Split from `open-order.ts` so the decision rules stay pure and testable and
 * only this thin wrapper needs a Supabase client. The capability is sent when
 * this browser holds one; a signed-in owner needs none, because
 * `order_payment_state()` accepts their verified `auth.uid()`.
 */
"use client";

import { recallPaymentToken } from "@/lib/commerce/capability";
import { readPaymentState, type OpenOrderView } from "@/lib/commerce/open-order";
import type { Principal } from "@/lib/auth/principal";
import { createClient } from "@/lib/supabase/client";

export type { OpenOrderView };

/**
 * Null means "this caller may not see this order", and the interface treats it
 * as "there is no open order" — which it is, from where they are standing. An
 * unknown order and somebody else's answer the same (0017).
 */
export async function readOpenOrderState(
  principal: Principal,
  orderNumber: string,
): Promise<OpenOrderView | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("order_payment_state", {
      p_order_number: orderNumber,
      p_token: recallPaymentToken(principal, orderNumber),
    });
    if (error) return null;
    return readPaymentState(Array.isArray(data) ? data[0] : data);
  } catch {
    return null;
  }
}
