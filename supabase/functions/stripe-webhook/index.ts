/**
 * stripe-webhook — the only thing allowed to say that money arrived (B2.3).
 *
 * It runs inside Supabase for the same reason `create-payment` does: the
 * service-role key and the Stripe secrets never have to exist in the web
 * deployment (ADR-0051).
 *
 * HOW LITTLE THIS FILE DOES, AND WHY THAT IS THE POINT
 *
 * Signature verification belongs to Stripe's own SDK. Idempotency, locking,
 * reservation conversion and stock booking belong to the database functions
 * from `0012`/`0015`. What is left here is: read the raw body, verify, route,
 * call one RPC, map the answer to a status code. Everything of consequence
 * already exists and is already tested (ADR-0054).
 *
 * **Nothing in this file writes to `shop_inventory`, `inventory_movements` or
 * `order_reservations`.** The only writes it can cause are the ones inside
 * `confirm_order_payment()` and `fail_payment_attempt()`.
 *
 * NO CORS, DELIBERATELY
 *
 * Stripe is not a browser. There is no `Access-Control-*` header and no
 * OPTIONS branch, because there is no origin to allow — a CORS block here
 * would be decoration that implies a protection it does not provide. What
 * authenticates a request is the signature, and only the signature.
 *
 * DEPLOY WITH JWT VERIFICATION OFF
 *
 * `config.toml` sets `verify_jwt = false`. Stripe sends no Supabase JWT, so
 * the platform check would reject every delivery before this code ran.
 */

import Stripe from "npm:stripe@18";

import {
  attemptWorldConflict,
  decide,
  eventWorldConflict,
  expectedLivemode,
  statusForOutcome,
  type DbOutcome,
  type StripeEventShape,
  type WebhookMode,
} from "./event.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET_LIVE = Deno.env.get("STRIPE_WEBHOOK_SECRET_LIVE");
const WEBHOOK_SECRET_SANDBOX = Deno.env.get("STRIPE_WEBHOOK_SECRET_SANDBOX");
const MAIL_SECRET = Deno.env.get("MAIL_FUNCTION_SECRET");

/**
 * The two endpoints this one URL serves, and the order they are tried in.
 *
 * Sandbox first because it is the one that fires during development, and the
 * cost of a failed verification is one HMAC. A secret that is not configured
 * is skipped, so a deployment holding only the sandbox secret accepts sandbox
 * events and rejects live ones outright — which is the state we deliberately
 * sit in while live payment is being prepared.
 */
const ENDPOINT_SECRETS: ReadonlyArray<readonly [WebhookMode, string | undefined]> = [
  ["sandbox", WEBHOOK_SECRET_SANDBOX],
  ["live", WEBHOOK_SECRET_LIVE],
];

/**
 * No API key is configured and none is needed.
 *
 * The signed event body is authoritative — the signature proves both origin
 * and integrity — so there is nothing to re-fetch. Not holding a Stripe secret
 * key here also means this function cannot charge, refund or expire anything,
 * which is a property worth having in the one endpoint the public internet can
 * reach.
 *
 * No `apiVersion` either: it selects the shape of API *responses*, and this
 * function makes no API call. Pinning one would be an unverified constant
 * doing nothing.
 */
const stripe = new Stripe("sk_unused_webhook_only");
const cryptoProvider = Stripe.createSubtleCryptoProvider();

/** Never the body, never the signature, never a full session id. */
function maskSession(id: string): string {
  const separator = id.lastIndexOf("_");
  return `${separator > 0 ? id.slice(0, separator + 1) : ""}…${id.slice(-4)}`;
}

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return respond(405, { error: "method_not_allowed" });
  }
  if (!ENDPOINT_SECRETS.some(([, secret]) => secret)) {
    // Fail closed. A deployment without any secret cannot verify anything, and
    // must not accept anything either.
    console.error("stripe-webhook: neither STRIPE_WEBHOOK_SECRET_LIVE nor _SANDBOX is set");
    return respond(503, { error: "not_configured" });
  }

  // ---- 1. the raw body -----------------------------------------------------
  //
  // Read as text and used as text. Parsing first and re-serialising would
  // change whitespace and key order, and the signature is over the exact
  // bytes Stripe sent. This is the single most common way to break a webhook.
  const rawBody = await req.text();
  const signature = req.headers.get("Stripe-Signature");

  if (!signature) {
    return respond(400, { error: "missing_signature" });
  }

  // ---- 2. Stripe verifies it, not us --------------------------------------
  //
  // constructEventAsync with the SubtleCrypto provider: the synchronous
  // variant reaches for Node's crypto and does not work in this runtime.
  // Timestamp tolerance, multiple v1 signatures during secret rotation and the
  // constant-time comparison are all the SDK's job (ADR-0054).
  //
  // AND THE SECRET THAT VERIFIES IS THE WORLD. Each Stripe endpoint secret
  // belongs to exactly one account in exactly one mode, and only Stripe can
  // produce a body that verifies against it — so this identifies the world
  // without trusting one byte the sender chose. No URL, no query parameter,
  // no header, no field in the body.
  let event: StripeEventShape | null = null;
  let mode: WebhookMode | null = null;
  let lastFailure = "no secret matched";

  for (const [candidate, secret] of ENDPOINT_SECRETS) {
    if (!secret) continue;
    try {
      event = (await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        secret,
        undefined,
        cryptoProvider,
      )) as unknown as StripeEventShape;
      mode = candidate;
      break;
    } catch (error) {
      // The message can name the tolerance window or the header shape.
      // Neither is secret, but neither is the caller's business.
      lastFailure = (error as Error).message;
    }
  }

  if (!event || !mode) {
    console.error("stripe-webhook signature rejected:", lastFailure);
    return respond(400, { error: "invalid_signature" });
  }

  // ---- 2b. do the event and the secret agree about the world? -------------
  //
  // Stripe signs `livemode` along with everything else, so this cannot be
  // forged; a disagreement means a test secret is configured against a live
  // endpoint or the reverse. 503 rather than 200, because Stripe keeps the
  // event and retries — fixing the configuration recovers the delivery
  // instead of losing it.
  const worldConflict = eventWorldConflict(event.livemode, mode);
  if (worldConflict !== null) {
    console.error(`stripe-webhook refusing event: ${worldConflict}`);
    return respond(503, { error: "not_configured" });
  }

  // ---- 3. what this event means -------------------------------------------
  const decision = decide(event, expectedLivemode(mode));

  if (decision.action === "ignore") {
    // 200 and no row. The endpoint subscribes to four types, Stripe's own
    // event log is the complete record, and `payment_events.outcome` has no
    // value meaning "seen, deliberately not acted on" — persisting one as
    // unprocessed would be indistinguishable from "seen, not yet resolved"
    // and would poison the one query that matters for monitoring.
    console.log(`stripe-webhook ignored ${event.type}: ${decision.reason}`);
    return respond(200, { received: true, ignored: decision.reason });
  }

  // ---- 3b. and does the order it names live in that world? ----------------
  //
  // The lock that makes "a sandbox event can never change a live order" a
  // fact rather than a probability. Checked before either database function
  // is reached, so a mismatch changes nothing at all.
  let attemptMode: string | null;
  try {
    attemptMode = await readAttemptMode(decision.sessionId);
  } catch (error) {
    console.error("stripe-webhook cannot read the attempt's world:", describe(error));
    return respond(503, { error: "not_configured" });
  }
  const crossWorld = attemptWorldConflict(attemptMode, mode);
  if (crossWorld !== null) {
    console.error(
      `stripe-webhook refusing ${maskSession(decision.sessionId)}: ${crossWorld}`,
    );
    return respond(503, { error: "not_configured" });
  }

  // ---- 4. the database decides everything else ----------------------------
  let outcome: DbOutcome;
  try {
    outcome = await callDatabase(decision);
  } catch (error) {
    console.error(`stripe-webhook ${decision.action} failed:`, describe(error));
    // A 500 so Stripe retries: a database that was briefly unavailable must
    // not cost us the delivery.
    return respond(500, { error: "internal" });
  }

  const unknownIsFinal = decision.action === "fail" ? decision.unknownIsFinal : false;
  const status = statusForOutcome(outcome, unknownIsFinal);

  /*
   * ---- 5. the mail, and deliberately after everything that matters --------
   *
   * The payment is committed by now. This call cannot change that, cannot
   * change the status Stripe is about to read, and cannot throw out of here:
   * a mail provider having a bad minute must never turn a confirmed payment
   * into a webhook Stripe retries.
   *
   * `outcome` is what makes it exactly-once. `confirm_order_payment()` returns
   * `confirmed` for one delivery of one event and never again — a replay gets
   * `duplicate_event` or `already_confirmed`, neither of which is in this map.
   * The delivery row behind `claim_order_mail()` is the second guard.
   */
  await mailFor(outcome, decision.sessionId);

  console.log(
    `stripe-webhook ${event.type} ${maskSession(decision.sessionId)} -> ${outcome} (${status})`,
  );
  return respond(status, { received: true, outcome });
});

/** Which mail, if any, an outcome deserves. Anything absent sends nothing. */
const MAIL_FOR_OUTCOME: Record<string, string> = {
  /*
   * Money arrived and stock was booked. The customer gets the ORDER
   * CONFIRMATION — which under the contract model settled in 0047 is the
   * seller's acceptance, and therefore the moment the contract exists
   * (docs/LEGAL.md). Until this mail goes out there is an offer and a payment
   * and no contract, which is exactly why the two flagged outcomes below get
   * no customer mail at all.
   *
   * The kind was called `payment_confirmation` until 0047. That named the
   * trigger rather than the act.
   */
  confirmed: "order_confirmation",
  // Money arrived and nothing was booked, or the amount did not match. The
  // customer gets NO confirmation — the order is not one we can fulfil yet —
  // and the operator gets woken up instead (ADR-0050).
  late_payment_unresolved: "resolution_alert",
  amount_mismatch: "resolution_alert",
};

/**
 * Which order a Stripe session belongs to.
 *
 * `confirm_order_payment()` answers with an outcome, not an order, so the
 * order has to be looked up. Read-only and service-role only, and shared by
 * the invoice and the mail so the two can never disagree about which order
 * they are acting on.
 */
async function orderNumberFor(sessionId: string): Promise<string | null> {
  const lookup = await fetch(`${SUPABASE_URL}/rest/v1/rpc/order_number_for_payment`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_provider: "stripe", p_provider_payment_id: sessionId }),
  });
  const orderNumber = await lookup.json();
  return lookup.ok && typeof orderNumber === "string" && orderNumber !== "" ? orderNumber : null;
}

/**
 * Issue the invoice for a confirmed payment.
 *
 * Never throws and never blocks the response: a payment that is confirmed in
 * the database stays confirmed even if the document could not be written, and
 * the operator can re-issue. The 200 to Stripe must not depend on it.
 */
async function issueInvoice(sessionId: string): Promise<void> {
  try {
    const orderNumber = await orderNumberFor(sessionId);
    if (!orderNumber) return;

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/issue_invoice`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_order_number: orderNumber }),
    });
    if (!response.ok) {
      console.error(`stripe-webhook: issue_invoice answered ${response.status}`);
    }
  } catch (error) {
    console.error(`stripe-webhook: invoice failed: ${describe(error)}`);
  }
}

/**
 * Hand the mail to `send-order-mail`, or do nothing at all.
 *
 * Never throws. Every failure path here ends in a log line, because the only
 * thing worse than a missing confirmation mail is a payment that gets retried
 * because the confirmation mail was missing.
 */
async function mailFor(outcome: DbOutcome, sessionId: string): Promise<void> {
  const kind = MAIL_FOR_OUTCOME[outcome];
  if (!kind) return;

  /*
   * THE INVOICE IS ISSUED BEFORE THE ACCEPTANCE IS SENT, so the confirmation
   * can carry its number — the customer gets one message, not a promise of a
   * document that follows.
   *
   * Only for `confirmed`: a flagged order has no accepted contract and
   * therefore nothing to invoice. `issue_invoice()` is idempotent, so a
   * redelivered webhook re-reads the invoice it already made.
   */
  if (outcome === "confirmed") await issueInvoice(sessionId);

  if (!MAIL_SECRET) {
    console.error("stripe-webhook: MAIL_FUNCTION_SECRET missing, no mail sent");
    return;
  }

  try {
    const orderNumber = await orderNumberFor(sessionId);
    if (!orderNumber) {
      console.error(`stripe-webhook: no order for ${maskSession(sessionId)}, no mail sent`);
      return;
    }

    const sent = await fetch(`${SUPABASE_URL}/functions/v1/send-order-mail`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-skyisles-mail-secret": MAIL_SECRET,
      },
      // No `force`: only a verified administrator may overrule an unresolved
      // record, and a webhook is not one.
      body: JSON.stringify({ orderNumber, kind }),
    });
    if (!sent.ok) {
      console.error(`stripe-webhook: send-order-mail answered ${sent.status} for ${kind}`);
    }
  } catch (error) {
    console.error(`stripe-webhook: mail dispatch failed: ${describe(error)}`);
  }
}

/* ------------------------------------------------------------------ plumbing */

/**
 * One RPC, called over PostgREST with the service-role key.
 *
 * Deliberately a bare `fetch` rather than the Supabase client: this needs one
 * POST to one function, and the amount travels as a JSON **string** so that
 * PostgreSQL parses the exact decimal instead of receiving a float.
 */
async function callDatabase(
  decision: Extract<ReturnType<typeof decide>, { action: "confirm" | "fail" }>,
): Promise<DbOutcome> {
  const fn = decision.action === "confirm" ? "confirm_order_payment" : "fail_payment_attempt";

  const body =
    decision.action === "confirm"
      ? {
          p_provider: "stripe",
          p_provider_payment_id: decision.sessionId,
          p_amount: decision.amount,
          p_currency: decision.currency,
          p_provider_event_id: decision.eventId,
          p_event_type: decision.eventType,
        }
      : {
          p_provider: "stripe",
          p_provider_payment_id: decision.sessionId,
          p_status: decision.status,
          p_provider_event_id: decision.eventId,
          p_event_type: decision.eventType,
        };

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${fn}: ${payload?.code ?? response.status} ${payload?.message ?? ""}`);
  }
  return payload as DbOutcome;
}

/**
 * The world the order behind one provider payment belongs to.
 *
 * Same transport as `callDatabase()` — a plain POST with the service key —
 * because this function holds no supabase-js client and needs none for one
 * scalar. `null` means no attempt carries this payment id, which is the
 * ordinary unknown-payment case and not a refusal. A failure throws, and the
 * caller turns that into a 503.
 */
async function readAttemptMode(sessionId: string): Promise<string | null> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/payment_attempt_mode`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_provider: "stripe", p_provider_payment_id: sessionId }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `payment_attempt_mode: ${payload?.code ?? response.status} ${payload?.message ?? ""}`,
    );
  }
  return typeof payload === "string" ? payload : null;
}

/** A code and a message, never a whole error object — as in create-payment. */
function describe(detail: unknown): string {
  if (detail instanceof Error) return detail.message;
  return String(detail);
}