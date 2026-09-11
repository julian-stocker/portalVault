/**
 * What the customer is told after paying (B2.4).
 *
 * Pure and dependency-free, so the one decision that matters here — when may
 * a page say "paid"? — is testable without a database, a browser or Stripe.
 *
 * THE RULE
 *
 * Only `payment_status = 'paid'` with `needs_resolution = false` is a success.
 * Nothing else is, and in particular **the redirect is not**. Stripe sends the
 * customer to `/checkout/erfolg` when the Checkout Session completes, which is
 * not the same event as the money arriving — and a URL a customer can type is
 * not evidence of anything. The only source is `order_payment_state()`.
 *
 * `session_id` from that URL is not read anywhere in this codebase. It
 * authorises nothing and identifies nothing we do not already have: the order
 * number identifies, the capability authorises.
 *
 * WHY `needs_resolution` OVERRIDES A PAID ORDER
 *
 * `confirm_order_payment()` sets both when money arrives for an order whose
 * hold had already lapsed (ADR-0050): paid, but nothing reserved and nothing
 * booked. Telling that customer "your order is confirmed and on its way" would
 * be a lie of the expensive kind — the goods may be gone. They are told the
 * truth instead: the money arrived and a person is looking at it.
 */

/** The canonical values `orders.payment_status` may hold (migration 0010). */
export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

/** What `order_payment_state()` returns. Four columns, no ids, no PII. */
export type OrderPaymentState = {
  order_number: string;
  payment_status: string;
  needs_resolution: boolean;
  total_amount: string | number;
};

/**
 * What the page should show. Deliberately a small, closed set: every screen the
 * customer can land on has a name, so none of them is an accident.
 */
export type PaymentView =
  /** Money confirmed, stock booked. The only success. */
  | "confirmed"
  /** Paid, but the order needs a human before anything ships. */
  | "needs_attention"
  /** The webhook has not arrived yet. Ordinary, and usually brief. */
  | "awaiting_confirmation"
  /** The hold lapsed, or somebody closed the order. Nothing was charged. */
  | "expired"
  /** Refunded in whole or in part. */
  | "refunded"
  /** No order came back: wrong capability, wrong number, or none at all. */
  | "unknown";

export function viewFor(state: OrderPaymentState | null): PaymentView {
  if (!state) return "unknown";

  // Checked before `paid`, on purpose. A flagged order is never a success
  // message, whatever its payment status says.
  if (state.needs_resolution) return "needs_attention";

  switch (state.payment_status) {
    case "paid":
      return "confirmed";
    case "pending":
      return "awaiting_confirmation";
    case "expired":
    case "cancelled":
    case "failed":
      return "expired";
    case "refunded":
    case "partially_refunded":
      return "refunded";
    default:
      // An unknown value is not optimistically treated as success.
      return "unknown";
  }
}

/**
 * Whether the browser should look again by itself.
 *
 * True only while the answer can still change on its own, which is exactly
 * `awaiting_confirmation`: the webhook is in flight. Every other view is
 * settled, and refreshing it would be a request that can only return what it
 * already has.
 */
export function shouldAutoRefresh(view: PaymentView): boolean {
  return view === "awaiting_confirmation";
}

/**
 * When to look again, in milliseconds after the page appeared.
 *
 * Three attempts and then silence. A webhook that has not arrived in ten
 * seconds is not going to be caught by a fourth request either — at that point
 * something is wrong at the provider or in the function, and the honest
 * interface is a button the customer presses, not a page that keeps asking.
 *
 * This is deliberately an array of moments rather than an interval: an
 * interval is a loop, a loop is a thing that can be left running, and a
 * background loop against the database is the polling infrastructure ADR-0054
 * says not to build.
 */
export const AUTO_REFRESH_DELAYS_MS = [2_000, 5_000, 10_000] as const;

/**
 * Whether a capability may be forgotten.
 *
 * The token is kept only to read this one order's state back. Once the order
 * has settled there is nothing left to read, so holding the secret any longer
 * is exposure without purpose. `awaiting_confirmation` and `unknown` are the
 * two views where it is still needed — the first because the answer will
 * change, the second because it may have been the wrong token and a retry with
 * the right one must still be possible.
 */
export function isTerminal(view: PaymentView): boolean {
  return view === "confirmed" || view === "needs_attention" || view === "expired" ||
    view === "refunded";
}
