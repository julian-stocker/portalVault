/**
 * Payment, as the application knows it (B2.1).
 *
 * Vocabulary only. Every rule that decides whether money becomes stock lives
 * in migration 0012 — `confirm_order_payment()` — because that decision has to
 * be made under row locks in one transaction, and nothing in TypeScript can
 * substitute for that.
 *
 * NOTHING HERE TALKS TO A PROVIDER
 *
 * B2.1 deliberately contains no SDK, no API call, no webhook route and no
 * secret. Stripe is the chosen provider (ADR-0051) but is wired up in B2.2 and
 * B2.3. What exists now is the contract those phases have to satisfy.
 *
 * THE PRIVILEGED PATH IS NOT THIS APPLICATION
 *
 * `confirm_order_payment()` is revoked from every client role and is called by
 * a Supabase Edge Function, which runs inside Supabase. That is what keeps a
 * service-role key out of Vercel entirely (ADR-0051). Nothing in `src/` will
 * ever call it.
 */

/**
 * The life of one attempt at paying.
 *
 *   created    opened, the provider does not know about it yet
 *   pending    the provider has a payment and the customer is with them
 *   succeeded  the money arrived
 *   failed     this try did not work — the order is still payable
 *   expired    the hold lapsed before anybody paid
 *   cancelled  the customer walked away deliberately
 *
 * Mirrored from the CHECK constraint in 0012; `payment.test.ts` reads the
 * migration and fails if the two drift.
 */
export const PAYMENT_ATTEMPT_STATUSES = [
  "created",
  "pending",
  "succeeded",
  "failed",
  "expired",
  "cancelled",
] as const;

export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

/** The two states in which a provider payment may still complete. */
export const OPEN_ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] = ["created", "pending"];

export function isAttemptOpen(status: PaymentAttemptStatus): boolean {
  return OPEN_ATTEMPT_STATUSES.includes(status);
}

/** Once an attempt reaches one of these, it is over. A retry is a new attempt. */
export function isAttemptTerminal(status: PaymentAttemptStatus): boolean {
  return !isAttemptOpen(status);
}

/**
 * What `confirm_order_payment()` answers.
 *
 *   confirmed                the order is paid and the stock is booked
 *   already_confirmed        a repeat of something already done
 *   duplicate_event          the provider delivered the same event twice
 *   amount_mismatch          the money did not match; nothing was sold
 *   late_payment_unresolved  paid, but the hold was gone; nothing was sold
 *   unknown_payment          no attempt matches this provider payment
 *
 * Only `confirmed` moves stock. The two that mean "money arrived but the
 * order cannot be filled" both set `needs_resolution` and write no inventory
 * movement — a late payment must never oversell (ADR-0050).
 */
export const PAYMENT_OUTCOMES = [
  "confirmed",
  "already_confirmed",
  "duplicate_event",
  "amount_mismatch",
  "late_payment_unresolved",
  "unknown_payment",
] as const;

export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];

/** Did this outcome take stock off the shelf? Exactly one of them does. */
export function bookedStock(outcome: PaymentOutcome): boolean {
  return outcome === "confirmed";
}

/** Does this outcome need somebody to look at the order? */
export function needsHuman(outcome: PaymentOutcome): boolean {
  return outcome === "amount_mismatch" || outcome === "late_payment_unresolved";
}

/**
 * The provider V1 uses (ADR-0051).
 *
 * A list rather than a bare string so a second provider is a typed change
 * rather than a search through string literals — but deliberately not a
 * plugin system for providers nobody has asked for.
 */
export const PAYMENT_PROVIDERS = ["stripe"] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const DEFAULT_PAYMENT_PROVIDER: PaymentProvider = "stripe";
