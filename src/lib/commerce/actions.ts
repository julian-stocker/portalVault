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

import { randomUUID } from "node:crypto";

import { draftPayload, validateDraft, type DraftProblem, type OrderDraft } from "@/lib/commerce/order";
import { createClient } from "@/lib/supabase/server";

export type PlaceOrderResult =
  | { ok: true; orderNumber: string }
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
 * @param requestId Idempotency for the checkout button. The same id returns
 *   the order it already created rather than a second one, which is what makes
 *   a double submit — or a retry after a dropped connection — harmless.
 *   Generated here when the caller has none.
 */
export async function placeOrder(
  draft: OrderDraft,
  requestId?: string,
): Promise<PlaceOrderResult> {
  const problems = validateDraft(draft);
  if (problems.length > 0) return { ok: false, reason: "invalid", problems };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_order", {
      p_request_id: requestId ?? randomUUID(),
      ...draftPayload(draft),
    });

    if (error) {
      // Three different things, and the interface says something different
      // about each: the article is gone, the customer is holding too much
      // already, or we are broken.
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

    return { ok: true, orderNumber };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
