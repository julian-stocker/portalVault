/**
 * May this visitor check out at all?
 *
 * The commerce mode lives in `commerce_settings`, which no client role may
 * read — so the interface asks `commerce_access()` instead, which answers the
 * one question a page needs and nothing more. It never returns the mode: a
 * visitor learns that checkout is off, not that a sandbox is running.
 *
 * **This is not the enforcement.** `create_order()` asks the same question
 * again, in the database, on a path that is reachable over PostgREST with the
 * anon key. What this module decides is only whether to offer a button — a
 * caller who ignores it and posts the RPC directly is refused there.
 */
import { createClient } from "@/lib/supabase/server";

/**
 * Why checkout is or is not available.
 *
 * - `open` — go ahead.
 * - `testers_only` — the shop is in sandbox and this visitor is not a named
 *   tester (a signed-out visitor always lands here, because sandbox has no
 *   guest checkout).
 * - `closed` — nobody is buying anything right now.
 */
export type CheckoutAccessReason = "open" | "testers_only" | "closed";

export type CheckoutAccess = {
  mayCheckout: boolean;
  reason: CheckoutAccessReason;
};

/** What a caller gets when the question cannot be answered. */
export const CHECKOUT_CLOSED: CheckoutAccess = { mayCheckout: false, reason: "closed" };

function isReason(value: unknown): value is CheckoutAccessReason {
  return value === "open" || value === "testers_only" || value === "closed";
}

/**
 * Shapes one row from `commerce_access()`.
 *
 * Anything unexpected becomes "closed" rather than an optimistic guess: an
 * interface that offers a checkout nobody can complete is worse than one that
 * says so up front.
 */
export function readAccess(row: unknown): CheckoutAccess {
  if (typeof row !== "object" || row === null) return CHECKOUT_CLOSED;
  const raw = row as { may_checkout?: unknown; reason?: unknown };
  if (raw.may_checkout !== true) {
    // "open" is not a reason a refusal may carry. A row that says both would
    // be contradictory, and the interface must not resolve that in favour of
    // the permissive half.
    const reason = isReason(raw.reason) && raw.reason !== "open" ? raw.reason : "closed";
    return { mayCheckout: false, reason };
  }
  return { mayCheckout: true, reason: "open" };
}

export async function checkoutAccess(): Promise<CheckoutAccess> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("commerce_access");
    if (error) return CHECKOUT_CLOSED;
    // `returns table` arrives as an array of one row.
    return readAccess(Array.isArray(data) ? data[0] : data);
  } catch {
    return CHECKOUT_CLOSED;
  }
}
