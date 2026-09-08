/**
 * Placing an order.
 *
 * A server action, the pattern this product already uses for anything decided
 * server-side (`collection/actions.ts`, `admin/actions.ts`). It is a thin
 * wrapper on purpose: it validates the shape of a draft, then hands it to
 * `create_order()`, which does everything that matters in one transaction —
 * re-reads prices, re-checks eligibility, writes the order and its snapshots,
 * and holds the stock.
 *
 * WHAT THE BROWSER CANNOT DECIDE
 *
 * Prices, totals, discounts, availability and the reservation's expiry. None
 * of them are in the payload, and none of them would be read if they were. A
 * cart that has been sitting open for an hour produces an order at today's
 * price, not yesterday's.
 *
 * GUESTS
 *
 * `auth.uid()` may be NULL and that is a supported outcome, not an error. The
 * cart works without an account (ADR-0043), so requiring one at the last step
 * would put the highest hurdle at the most expensive moment. The contact
 * address is stored either way — it is what carries the order when there is no
 * account, or when the account is later deleted.
 *
 * NO PAYMENT HAPPENS HERE. Phase A ends with a reserved, unpaid order.
 */
"use server";

import { isPaymentToken, type CheckoutCredentials } from "@/lib/commerce/capability";
import { draftPayload, validateDraft, type DraftProblem, type OrderDraft } from "@/lib/commerce/order";
import { isShippingMethod, type ShippingOption } from "@/lib/commerce/shipping";
import { createClient } from "@/lib/supabase/server";

export type PlacedOrder = {
  orderNumber: string;
  itemsSubtotal: number;
  shippingAmount: number;
  totalAmount: number;
};

export type PlaceOrderResult =
  | { ok: true; order: PlacedOrder }
  | { ok: false; reason: "invalid"; problems: DraftProblem[] }
  /** The database refused: withdrawn, sold out, or no longer priced. */
  | { ok: false; reason: "unavailable" }
  /**
   * This customer is already holding as many open checkouts as they may.
   * A limit, not a fault — and deliberately a different answer from
   * "unavailable", because the article is fine and the basket is not lost.
   */
  | { ok: false; reason: "too_many_checkouts" }
  | { ok: false; reason: "failed" };

/**
 * Postgres' `insufficient_privilege`, raised by `create_order()` when a repeat
 * of a request id arrives without the capability that order was created with.
 */
const NOT_YOURS = new Set(["42501", "insufficient_privilege"]);

/**
 * What the checkout renders beside each carrier.
 *
 * Display only. The amount is what `shipping_amount_for()` says this goods
 * value would pay, and `create_order()` charges what the same function says
 * about the goods value **it** computed — so a tampered subtotal can change
 * what is shown and never what is billed.
 */
export async function shippingOptions(itemsSubtotal: number): Promise<ShippingOption[]> {
  const subtotal = Number.isFinite(itemsSubtotal) && itemsSubtotal > 0 ? itemsSubtotal : 0;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("shipping_quote", {
      p_items_subtotal: subtotal,
    });
    if (error || !Array.isArray(data)) return [];

    return data.flatMap((row: { code: string; name: string; amount: unknown; is_default: boolean }) => {
      const amount = typeof row.amount === "string" ? Number(row.amount) : row.amount;
      if (!isShippingMethod(row.code) || typeof amount !== "number" || !Number.isFinite(amount)) {
        return [];
      }
      return [{ code: row.code, name: row.name, amount, isDefault: row.is_default === true }];
    });
  } catch {
    return [];
  }
}

/** Postgres codes `create_order()` raises for a draft that cannot be filled. */
const UNAVAILABLE = new Set(["23514", "P0002", "no_data_found", "check_violation"]);

/**
 * `too_many_connections` (53300), raised by `enforce_checkout_limits()`.
 *
 * The limit lives in the database rather than here on purpose: this action
 * reaches PostgREST with the anon key and the visitor's session, so a browser
 * calling the RPC directly arrives as the same role. A check in this file
 * would be bypassed by one request; a check in SQL cannot be.
 */
const THROTTLED = new Set(["53300", "too_many_connections"]);

/**
 * @param credentials Generated **by the browser**, once per checkout attempt,
 *   and stable across retries. The request id makes a repeat harmless; the
 *   payment capability is what proves, on that repeat, that this is the same
 *   customer — and what later lets a guest pay for the order at all.
 *
 *   Both travel forward only. Neither is ever returned, so a lost response
 *   cannot destroy either of them (see `capability.ts`).
 */
export async function placeOrder(
  draft: OrderDraft,
  credentials: CheckoutCredentials,
): Promise<PlaceOrderResult> {
  // A malformed capability would be refused by the database anyway; catching
  // it here keeps a broken client from spending a round trip.
  if (!credentials || !isPaymentToken(credentials.paymentToken)) {
    return { ok: false, reason: "failed" };
  }
  const problems = validateDraft(draft);
  if (problems.length > 0) return { ok: false, reason: "invalid", problems };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_order", {
      p_request_id: credentials.requestId,
      p_payment_token: credentials.paymentToken,
      ...draftPayload(draft),
    });

    if (error) {
      // Three different things, and the interface says something different
      // about each: the article is gone, the customer is holding too much
      // already, or we are broken.
      // A repeated request id without the matching capability: somebody
      // else's checkout, or a client that regenerated its own credentials.
      if (NOT_YOURS.has(error.code ?? "")) return { ok: false, reason: "failed" };
      if (THROTTLED.has(error.code ?? "")) return { ok: false, reason: "too_many_checkouts" };
      if (UNAVAILABLE.has(error.code ?? "")) return { ok: false, reason: "unavailable" };
      return { ok: false, reason: "failed" };
    }

    // `returns table` arrives as an array of one row.
    const row = Array.isArray(data) ? data[0] : data;
    const orderNumber = row?.order_number;
    if (typeof orderNumber !== "string" || orderNumber === "") {
      return { ok: false, reason: "failed" };
    }

    // `numeric` arrives as a string from PostgREST, exactly as it does for
    // shop prices.
    const money = (value: unknown): number =>
      typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;

    const order: PlacedOrder = {
      orderNumber,
      itemsSubtotal: money(row.items_subtotal),
      shippingAmount: money(row.shipping_amount),
      totalAmount: money(row.total_amount),
    };
    if (!Number.isFinite(order.totalAmount)) return { ok: false, reason: "failed" };

    return { ok: true, order };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
