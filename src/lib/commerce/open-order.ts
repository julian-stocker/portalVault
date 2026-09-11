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
 * Statuses that end the matter. None of them may show a start-or-retry
 * button: money has either arrived or the order is closed, and inviting a
 * second payment would be inviting a second charge.
 */
const SETTLED = new Set(["paid", "cancelled", "refunded", "partially_refunded"]);

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
  return attempts > 0 ? "retry" : "start";
}
