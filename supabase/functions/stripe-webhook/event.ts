/**
 * Everything `stripe-webhook` decides that does not need the network (B2.3).
 *
 * Deliberately free of Deno APIs, `fetch`, secrets and the Stripe SDK, so that
 * `tsc` typechecks it and Vitest can execute it. `index.ts` is the only file
 * that talks to anything, and it is excluded from `tsc` because it is Deno.
 *
 * WHAT THIS FILE IS FOR
 *
 * The signature check belongs to Stripe's own SDK (ADR-0054) and the business
 * logic belongs to the database (`confirm_order_payment()`,
 * `fail_payment_attempt()`). What is left in between — and what lives here —
 * is exactly three decisions:
 *
 *   1. Is this event one we act on, and does it really say what we think?
 *   2. Which database call does it become, with which arguments?
 *   3. What HTTP status does the outcome deserve?
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * `metadata` is never truth. We wrote `order_id` and `payment_attempt_id` into
 * the Checkout Session ourselves; Stripe stores and returns them without
 * checking anything. The identity of a payment is the session id (`cs_…`)
 * matched against `payment_attempts.provider_payment_id`, and nothing else.
 * The amount is `amount_total`, the currency is `currency`, both from the
 * signed event body.
 */

/** The four event types V1 subscribes to. Anything else is not our business. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
] as const;

export type HandledEvent = (typeof HANDLED_EVENTS)[number];

/** What a Checkout Session looks like, in the fields we are allowed to read. */
export type CheckoutSession = {
  id: string;
  object: string;
  status: string | null;
  payment_status: string | null;
  amount_total: number | null;
  currency: string | null;
};

export type StripeEventShape = {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: unknown };
};

/* ------------------------------------------------------------------ money */

/**
 * `931` → `"9.31"`. The inverse of `euroStringToCents()` in create-payment.
 *
 * A string, and integer arithmetic only, for the same reason the other
 * direction exists: `confirm_order_payment(p_amount numeric)` compares against
 * `payment_attempts.amount`, which is `numeric(10,2)`. A JavaScript float has
 * already lost the exact decimal before PostgREST sees it, and an amount
 * comparison that is off by a representation error would close the attempt as
 * `amount_mismatch` and flag a perfectly good order for a human.
 */
export function centsToAmountString(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error("a provider amount must be an integer number of minor units");
  }
  if (!Number.isSafeInteger(cents)) {
    throw new Error("amount is out of range");
  }
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.trunc(absolute / 100);
  const fraction = absolute % 100;
  return `${negative ? "-" : ""}${whole}.${String(fraction).padStart(2, "0")}`;
}

/* ------------------------------------------------------------- the routing */

/** What `index.ts` should do with one event. */
export type Decision =
  | {
      action: "confirm";
      sessionId: string;
      amount: string;
      currency: string;
      eventId: string;
      eventType: string;
    }
  | {
      action: "fail";
      sessionId: string;
      /** The status the attempt is closed as. Never 'succeeded'. */
      status: "expired" | "failed";
      eventId: string;
      eventType: string;
      /** An unmatched session here needs no retry — see `unknownIsFinal`. */
      unknownIsFinal: boolean;
    }
  | { action: "ignore"; reason: IgnoreReason };

export type IgnoreReason =
  | "not_a_handled_type"
  | "not_a_checkout_session"
  | "session_incomplete"
  | "awaiting_async_payment"
  | "no_payment_required"
  | "no_amount"
  | "livemode_mismatch"
  | "malformed";

function asSession(object: unknown): CheckoutSession | null {
  if (typeof object !== "object" || object === null) return null;
  const raw = object as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  return {
    id: raw.id,
    object: typeof raw.object === "string" ? raw.object : "",
    status: typeof raw.status === "string" ? raw.status : null,
    payment_status: typeof raw.payment_status === "string" ? raw.payment_status : null,
    amount_total: typeof raw.amount_total === "number" ? raw.amount_total : null,
    currency: typeof raw.currency === "string" ? raw.currency : null,
  };
}

/**
 * The whole routing decision, from a verified event to a database call.
 *
 * `expectLivemode` is the environment's own answer, not the event's: a staging
 * deployment must refuse a live event even if it were somehow signed. In
 * practice the webhook secrets differ per endpoint so it cannot happen — this
 * is the second lock on the same door, and it costs one comparison.
 *
 * WHY `completed` IS NOT ENOUGH ON ITS OWN
 *
 * With an asynchronous payment method Stripe fires
 * `checkout.session.completed` with `status: "complete"` and
 * `payment_status: "unpaid"` — the customer finished the checkout, the money
 * has not arrived. Confirming on the event type alone would convert stock and
 * write a sale for money that may never come. `payment_status === "paid"` is
 * the decisive field; `status === "complete"` is the sanity check beside it.
 *
 * V1 disables asynchronous methods in the Stripe Dashboard, so this branch
 * should not fire in practice. It is implemented anyway, because "should not"
 * is not a guarantee and the failure mode is selling goods for nothing.
 */
export function decide(event: StripeEventShape, expectLivemode: boolean): Decision {
  if (typeof event.id !== "string" || event.id === "" || typeof event.type !== "string") {
    return { action: "ignore", reason: "malformed" };
  }
  if (event.livemode !== expectLivemode) {
    return { action: "ignore", reason: "livemode_mismatch" };
  }
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) {
    return { action: "ignore", reason: "not_a_handled_type" };
  }

  const session = asSession(event.data?.object);
  if (!session) return { action: "ignore", reason: "malformed" };

  // Every handled type carries a Checkout Session. A payment_intent object
  // reaching this point means the endpoint is subscribed to something it
  // should not be, and it must not be matched against a `cs_` identity.
  if (session.object !== "checkout.session" || !session.id.startsWith("cs_")) {
    return { action: "ignore", reason: "not_a_checkout_session" };
  }

  const common = { sessionId: session.id, eventId: event.id, eventType: event.type };

  if (event.type === "checkout.session.expired") {
    return {
      action: "fail",
      status: "expired",
      // An expired session we never attached needs nothing done and nothing
      // retried. create-payment expires orphaned sessions at Stripe itself,
      // and their expiry events legitimately match no attempt.
      unknownIsFinal: true,
      ...common,
    };
  }

  if (event.type === "checkout.session.async_payment_failed") {
    return { action: "fail", status: "failed", unknownIsFinal: false, ...common };
  }

  // completed and async_payment_succeeded share one path — there is exactly
  // one way for money to become stock, and this is it.
  if (event.type === "checkout.session.completed" && session.status !== "complete") {
    return { action: "ignore", reason: "session_incomplete" };
  }
  if (session.payment_status === "no_payment_required") {
    // A zero-amount checkout. V1 cannot produce one — every order carries
    // shipping — and treating it as paid would book a sale against no money.
    return { action: "ignore", reason: "no_payment_required" };
  }
  if (session.payment_status !== "paid") {
    return { action: "ignore", reason: "awaiting_async_payment" };
  }
  if (session.amount_total === null || session.currency === null || session.currency === "") {
    return { action: "ignore", reason: "no_amount" };
  }

  return {
    action: "confirm",
    amount: centsToAmountString(session.amount_total),
    // Lower case, as Stripe sends it. confirm_order_payment() upper-cases
    // before comparing, so no normalisation is needed or wanted here.
    currency: session.currency,
    ...common,
  };
}

/* ------------------------------------------------------------ the response */

/**
 * Every outcome the two database functions can return.
 *
 * `confirm_order_payment()` answers with the first six; `fail_payment_attempt()`
 * with `duplicate_event`, `unknown_payment`, `already_closed` or `closed`.
 */
export type DbOutcome =
  | "confirmed"
  | "already_confirmed"
  | "amount_mismatch"
  | "late_payment_unresolved"
  | "duplicate_event"
  | "unknown_payment"
  | "attempt_failed"
  | "already_closed"
  | "closed";

/**
 * What to answer Stripe.
 *
 * The rule has one job: **make Stripe retry exactly when a retry can help.**
 *
 * `unknown_payment` is the case that matters. `confirm_order_payment()` records
 * the event as seen and deliberately leaves `processed_at` NULL, because the
 * commonest reason for an unmatched session is that `attach_provider_payment()`
 * has not committed yet. Answering 2xx there would throw away the delivery that
 * would have worked, and the order would never be paid. So it is a 500.
 *
 * Everything else is finished business, including `amount_mismatch` and
 * `late_payment_unresolved`: both are recorded, both flag the order for a
 * human, and neither improves by being delivered again.
 */
export function statusForOutcome(outcome: DbOutcome, unknownIsFinal: boolean): number {
  if (outcome === "unknown_payment") return unknownIsFinal ? 200 : 500;
  return 200;
}

/* -------------------------------------------- the commerce mode cross-check */

/**
 * Which Stripe world a commerce mode belongs to.
 *
 * `closed` maps to test, not to "either". A live event arriving at a shop
 * that is not live is wrong in every reading of it, and the safe answer to a
 * wrong live event is to refuse it.
 */
export function expectedLivemode(mode: string | null | undefined): boolean {
  return mode === "live";
}

/**
 * Does this deployment's own configuration agree with itself?
 *
 * `STRIPE_LIVEMODE` is what the endpoint was told; the commerce mode is what
 * the database knows. They describe the same thing, so a disagreement is a
 * misconfiguration rather than a decision to make — and the only safe
 * response to it is to process nothing at all.
 *
 * Returns a short reason to log, or `null` when the two agree.
 */
export function livemodeConfigConflict(
  mode: string | null | undefined,
  expectLivemodeFromEnv: boolean,
): string | null {
  if (mode !== "closed" && mode !== "sandbox" && mode !== "live") {
    return `unknown_commerce_mode:${String(mode)}`;
  }
  return expectedLivemode(mode) === expectLivemodeFromEnv
    ? null
    : `commerce_mode_${mode}_but_STRIPE_LIVEMODE_${expectLivemodeFromEnv}`;
}
