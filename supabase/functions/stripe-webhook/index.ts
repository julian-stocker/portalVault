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
  decide,
  statusForOutcome,
  type DbOutcome,
  type StripeEventShape,
} from "./event.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

/**
 * Which world this deployment belongs to.
 *
 * Staging must never act on a live event and production never on a test one.
 * The webhook secrets differ per endpoint so this should be unreachable; it is
 * the second lock, and it costs one comparison. Default `false` means a
 * deployment that forgets to say is a test deployment — fail closed.
 */
const EXPECT_LIVEMODE = Deno.env.get("STRIPE_LIVEMODE") === "true";

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
  if (!WEBHOOK_SECRET) {
    // Fail closed. A deployment without the secret cannot verify anything, and
    // must not accept anything either.
    console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET is not set");
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
  let event: StripeEventShape;
  try {
    event = (await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    )) as unknown as StripeEventShape;
  } catch (error) {
    // The message can name the tolerance window or the header shape. Neither
    // is secret, but neither is the caller's business.
    console.error("stripe-webhook signature rejected:", (error as Error).message);
    return respond(400, { error: "invalid_signature" });
  }

  // ---- 3. what this event means -------------------------------------------
  const decision = decide(event, EXPECT_LIVEMODE);

  if (decision.action === "ignore") {
    // 200 and no row. The endpoint subscribes to four types, Stripe's own
    // event log is the complete record, and `payment_events.outcome` has no
    // value meaning "seen, deliberately not acted on" — persisting one as
    // unprocessed would be indistinguishable from "seen, not yet resolved"
    // and would poison the one query that matters for monitoring.
    console.log(`stripe-webhook ignored ${event.type}: ${decision.reason}`);
    return respond(200, { received: true, ignored: decision.reason });
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

  console.log(
    `stripe-webhook ${event.type} ${maskSession(decision.sessionId)} -> ${outcome} (${status})`,
  );
  return respond(status, { received: true, outcome });
});

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

/** A code and a message, never a whole error object — as in create-payment. */
function describe(detail: unknown): string {
  if (detail instanceof Error) return detail.message;
  return String(detail);
}