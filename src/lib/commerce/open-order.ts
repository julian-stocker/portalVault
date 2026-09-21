/**
 * What the payment button should say, decided by what actually happened.
 *
 * The bug this exists for: `/checkout` offered "Zahlung erneut starten" to a
 * customer who had never started one. The wording was chosen by "is there an
 * order", which is not the question — an order that has never been paid for
 * and an order whose payment failed look identical from the browser, and only
 * the second one is a retry.
 *
 * `order_payment_state()` answers it since 0022: it returns how many payment
 * attempts an order has, alongside its status. Both come from the database,
 * for a caller the database has authorised — so this is also what stops one
 * account being shown another's open order, because an unauthorised order
 * returns no row at all.
 */

/** Exactly what `order_payment_state()` returns. */
export type PaymentStateRow = {
  order_number: string;
  payment_status: string;
  needs_resolution: boolean;
  total_amount: string | number | null;
  attempts: number;
};

export type OpenOrderView = {
  orderNumber: string;
  paymentStatus: string;
  needsResolution: boolean;
  totalAmount: number | null;
  attempts: number;
  /**
   * - `start` — the order exists and nobody has tried to pay yet
   * - `retry` — at least one attempt has been made and it did not settle
   * - `none` — nothing to offer: paid, cancelled, refunded, or flagged
   */
  cta: "start" | "retry" | "none";
};

/**
 * Statuses where money is involved. None of them may show a start-or-retry
 * button — inviting a second payment would be inviting a second charge — and
 * the customer must keep seeing the order, because it is their money.
 */
const SETTLED = new Set(["paid", "refunded", "partially_refunded"]);

/**
 * Statuses where nothing was charged and nothing can still be done.
 *
 * `start_payment_attempt()` refuses any order that is not `pending`, so an
 * `expired`, `failed` or `cancelled` order can never be paid — not now, not
 * after a reload, not ever. It was still being offered `Zahlung erneut
 * starten`, which is exactly the button the comment above says not to offer:
 * one the database cannot honour.
 *
 * Worse than the dead button was the dead end behind it. The checkout panel
 * replaces the form, so an order in this state occupied `/checkout`
 * indefinitely — and the message it printed, "lege den Artikel erneut in den
 * Warenkorb", could not be acted on, because refilling the cart still landed
 * on the same remembered order.
 *
 * The rule and what was rejected with it: ADR-0101.
 *
 * So these are not merely button-less: they are not resumed at all. Nothing
 * is written and nothing is deleted — the order stays exactly as it is, and
 * the browser simply stops treating it as the one it is in the middle of.
 */
const ABANDONED = new Set(["expired", "failed", "cancelled"]);

/**
 * May the browser stop treating this order as its open one?
 *
 * A flagged order never qualifies, whatever its status says: somebody is
 * looking at it, the customer's money may already be with us, and it must
 * stay visible.
 */
export function isAbandoned(paymentStatus: string, needsResolution: boolean): boolean {
  if (needsResolution) return false;
  return ABANDONED.has(paymentStatus);
}

export function readPaymentState(row: unknown): OpenOrderView | null {
  if (typeof row !== "object" || row === null) return null;
  const raw = row as Partial<PaymentStateRow>;
  if (typeof raw.order_number !== "string" || raw.order_number === "") return null;
  if (typeof raw.payment_status !== "string" || raw.payment_status === "") return null;

  const attempts =
    typeof raw.attempts === "number" && Number.isFinite(raw.attempts) && raw.attempts > 0
      ? Math.trunc(raw.attempts)
      : 0;
  const needsResolution = raw.needs_resolution === true;
  const total = raw.total_amount === null || raw.total_amount === undefined
    ? null
    : Number(raw.total_amount);

  return {
    orderNumber: raw.order_number,
    paymentStatus: raw.payment_status,
    needsResolution,
    totalAmount: total !== null && Number.isFinite(total) ? total : null,
    attempts,
    cta: ctaFor(raw.payment_status, attempts, needsResolution),
  };
}

export function ctaFor(
  paymentStatus: string,
  attempts: number,
  needsResolution: boolean,
): OpenOrderView["cta"] {
  // A flagged order is waiting for a person, and `start_payment_attempt()`
  // refuses it anyway. Offering a button that cannot work is worse than
  // offering none.
  if (needsResolution) return "none";
  if (SETTLED.has(paymentStatus)) return "none";
  // Never payable again, so never a button. See ABANDONED.
  if (ABANDONED.has(paymentStatus)) return "none";
  return attempts > 0 ? "retry" : "start";
}
