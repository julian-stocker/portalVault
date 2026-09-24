/**
 * The order behind a withdrawal form, when the caller is allowed to see it.
 *
 * WHY THE PARAMETER IS ONLY A POINTER. `/widerrufen?bestellung=SKY-…` says
 * WHICH order to look at and proves nothing about who is asking. The proof is
 * `authorize_order_payment()` inside the database: either the order belongs to
 * the signed-in account, or the caller holds the guest payment token. A
 * stranger with somebody else's order number gets `null`, and the form falls
 * back to the empty one — the statutory function keeps working, and the page
 * has told nobody whether that order exists.
 *
 * NOTHING IS TAKEN FROM THE URL. The name comes from the order's own shipping
 * address and the address from the order itself, both read server-side. A
 * `?name=` would be a field an attacker fills in.
 *
 * THE GUEST PATH IS UNTOUCHED. Somebody who arrives at `/widerrufen` with no
 * parameter — from the footer, as § 356a requires — sees exactly the form they
 * saw before and identifies themselves with the order number and the e-mail
 * address on the order.
 */
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type WithdrawalContext = {
  orderNumber: string;
  customerEmail: string;
  /** From the shipping address. Null when the order carries none. */
  consumerName: string | null;
  placedAt: string;
  /** A declaration for this order already exists. */
  declared: boolean;
};

/** Order numbers have one shape, and a pointer that does not fit it is not one. */
const ORDER_NUMBER = /^[A-Za-z0-9-]{1,32}$/;

export const fetchWithdrawalContext = cache(
  async (orderNumber: string | undefined): Promise<WithdrawalContext | null> => {
    const wanted = (orderNumber ?? "").trim();
    if (wanted === "" || !ORDER_NUMBER.test(wanted)) return null;

    try {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("order_withdrawal_context", {
        p_order_number: wanted,
        p_token: null,
      });
      if (error || data === null || typeof data !== "object") return null;

      const row = data as Record<string, unknown>;
      if (typeof row.order_number !== "string" || typeof row.customer_email !== "string") {
        return null;
      }
      return {
        orderNumber: row.order_number,
        customerEmail: row.customer_email,
        consumerName: typeof row.consumer_name === "string" ? row.consumer_name : null,
        placedAt: String(row.placed_at ?? ""),
        declared: row.declared === true,
      };
    } catch {
      // A database without 0095 answers nothing, which is the empty form.
      return null;
    }
  },
);
