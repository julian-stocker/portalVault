/**
 * create-payment — the privileged bootstrap for one Stripe Checkout Session.
 *
 * Phase B2.2b. This is the first code in SkyIsles that talks to a payment
 * provider, and it runs inside Supabase rather than on Vercel for one reason:
 * the service-role key and the Stripe secret never have to exist in the web
 * deployment at all (ADR-0051).
 *
 * WHAT IT DOES NOT DO
 *
 * It does not mark anything paid. A returned checkout URL means a customer
 * has somewhere to pay, and nothing more. Only B2.3's webhook, acting on what
 * the server saw at the provider, may confirm a payment — and only
 * `confirm_order_payment()` may turn that into stock.
 *
 * It also converts no reservation, writes no inventory movement and touches
 * no amount. The order was priced by `create_order()` and snapshotted by
 * `start_payment_attempt()`; this function reads those figures and hands them
 * to Stripe.
 *
 * DEPLOY WITH JWT VERIFICATION OFF
 *
 * Supabase verifies the JWT before the function runs by default, which would
 * reject every guest checkout outright. `config.toml` sets
 * `verify_jwt = false`, and the verification below is done here instead —
 * which is also the only way to tell "no user" apart from "invalid user".
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  allowedRequestHeadersValue,
  assertItemsMatchAuthoritativeTotal,
  buildLineItems,
  buildSessionForm,
  idempotencyKey,
  parseAllowlist,
  parsePaymentRequest,
  redirectUrls,
  resolveAllowedOrigin,
  sessionExpiresAt,
  type OrderLine,
  type OrderSummary,
  type PaymentAttempt,
} from "./session.ts";

const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";

/**
 * No `Stripe-Version` header is sent, and that is a decision rather than an
 * omission. Without it Stripe uses the account's default version, which is
 * the documented behaviour and is set in Workbench.
 *
 * Pinning would be better practice, but only to a version that has been
 * verified — and the pin belongs with B2.3 rather than here, because a
 * webhook endpoint carries its own version and the two should match. Choosing
 * one now, before the endpoint exists, would mean guessing twice.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SITE_URL = Deno.env.get("SITE_URL") ?? "http://localhost:3000";

/**
 * Entirely environment-driven, with **no built-in origin**.
 *
 * A production origin compiled into the source would be wrong in the one
 * place it matters: this function is deployed per environment, and a staging
 * deployment that trusted `https://skyisles.app` would let the live shop
 * start test-mode payments against the staging database. Each deployment
 * names its own callers.
 *
 * Unset therefore means "refuse every cross-origin request" — a
 * misconfiguration fails closed rather than open.
 */
const ALLOWED_ORIGINS = parseAllowlist(Deno.env.get("ALLOWED_ORIGINS"));

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = resolveAllowedOrigin(origin, ALLOWED_ORIGINS);
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // Shared with the test, never retyped: supabase-js sends x-client-info on
    // every call, and a name missing here makes the browser drop the request
    // before the function is entered. See ALLOWED_REQUEST_HEADERS.
    "Access-Control-Allow-Headers": allowedRequestHeadersValue(),
    "Access-Control-Max-Age": "86400",
  };
  // No wildcard: the request carries an Authorization header and a payment
  // capability, so any page on the internet must not be able to send it.
  if (allowed) headers["Access-Control-Allow-Origin"] = allowed;
  return headers;
}

/**
 * Only a code and a message, never a whole error object.
 *
 * A PostgREST error carries `details` and `hint` as well, and those can echo
 * fragments of the failing statement. The capability travels as a parameter
 * to `authorize_order_payment()`, so a logged raw error is one plausible way
 * for it to reach a log line. This makes that impossible by construction.
 */
function describe(detail: unknown): string {
  if (detail instanceof Error) return detail.message;
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail !== null) {
    const e = detail as { code?: unknown; message?: unknown };
    return `${String(e.code ?? "?")}: ${String(e.message ?? "")}`;
  }
  return String(detail);
}

/**
 * One shape for every failure, so nothing internal escapes.
 *
 * The client learns a stable code and a German sentence. It never learns
 * whether an order exists, who owns it, what the database said, or anything
 * about Stripe. `detail` is logged, never returned.
 */
function fail(
  status: number,
  code: string,
  message: string,
  origin: string | null,
  detail?: unknown,
): Response {
  if (detail !== undefined) {
    // Never the token, never the body: a code and a short reason, nothing else.
    console.error(`create-payment ${code}:`, describe(detail));
  }
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return fail(405, "method_not_allowed", "Nicht erlaubt.", origin);
  }
  if (origin !== null && resolveAllowedOrigin(origin, ALLOWED_ORIGINS) === null) {
    return fail(403, "origin_not_allowed", "Nicht erlaubt.", origin);
  }
  if (!STRIPE_SECRET_KEY) {
    return fail(503, "provider_unconfigured", "Zahlung ist derzeit nicht verfügbar.", origin,
      "STRIPE_SECRET_KEY is not set");
  }

  // ---- 1. the request ------------------------------------------------------
  let parsed;
  try {
    parsed = parsePaymentRequest(await req.json());
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return fail(400, "invalid_request", "Diese Anfrage ist ungültig.", origin);
  }
  const { orderId, paymentToken } = parsed;

  // ---- 2. who is asking ----------------------------------------------------
  //
  // The user id comes from a verified token or it does not exist. It is never
  // read from the body — see parsePaymentRequest().
  let userId: string | null = null;
  const authorization = req.headers.get("Authorization");
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (bearer && bearer !== ANON_KEY) {
    const reader = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await reader.auth.getUser(bearer);
    if (!error && data.user) userId = data.user.id;
  }

  if (userId === null && paymentToken === null) {
    return fail(401, "unauthorized", "Diese Bestellung gehört zu einer anderen Sitzung.", origin);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- 3. may this caller pay for this order? ------------------------------
  //
  // The existing contract from 0013, unchanged. Not the order number, not the
  // email, not the request id — all guessable, public, or both.
  const authorised = await admin.rpc("authorize_order_payment", {
    p_order_id: orderId,
    p_user_id: userId,
    p_token: paymentToken,
  });
  if (authorised.error) {
    return fail(500, "internal", "Das hat gerade nicht geklappt.", origin, authorised.error);
  }
  if (authorised.data !== true) {
    // Same answer whether the order is missing or simply not theirs.
    return fail(403, "unauthorized", "Diese Bestellung gehört zu einer anderen Sitzung.", origin);
  }

  // ---- 4. open or reuse the attempt ---------------------------------------
  //
  // Every refusal that matters lives in here: the order must be pending, must
  // not need a human, and must still hold every line it ordered.
  const started = await admin.rpc("start_payment_attempt", { p_order_id: orderId });
  if (started.error) {
    const code = started.error.code ?? "";
    if (code === "23514" || code === "check_violation") {
      return fail(409, "order_not_payable",
        "Diese Bestellung kann nicht mehr bezahlt werden.", origin, started.error.message);
    }
    return fail(500, "internal", "Das hat gerade nicht geklappt.", origin, started.error);
  }
  const attempt = (Array.isArray(started.data) ? started.data[0] : started.data) as
    | PaymentAttempt
    | undefined;
  if (!attempt) {
    return fail(500, "internal", "Das hat gerade nicht geklappt.", origin, "no attempt returned");
  }

  // ---- 5. already has a session? then hand that one back -------------------
  //
  // The commonest way to create a second payable session is to call Stripe
  // again on a retry. This removes it entirely.
  if (attempt.reused && attempt.provider_checkout_url) {
    return new Response(
      JSON.stringify({ url: attempt.provider_checkout_url, reused: true }),
      { status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
    );
  }

  // ---- 6. what the payment page should show -------------------------------
  //
  // Money is read as text: PostgREST serialises `numeric` as a JSON number,
  // and a float would lose the exact decimal before any code here saw it.
  const orderRow = await admin
    .from("orders")
    .select(
      "order_number,currency,customer_email,shipping_method_name," +
        "shipping_amount_text:shipping_amount::text,discount_amount_text:discount_amount::text",
    )
    .eq("id", orderId)
    .single();
  const lineRows = await admin
    .from("order_lines")
    .select(
      "sky_id,condition,quantity,name_snapshot," +
        "unit_price_text:unit_price::text,line_total_text:line_total::text",
    )
    .eq("order_id", orderId)
    .order("id", { ascending: true });

  if (orderRow.error || lineRows.error || !orderRow.data) {
    return fail(500, "internal", "Das hat gerade nicht geklappt.", origin,
      orderRow.error ?? lineRows.error ?? "order vanished");
  }

  let form: URLSearchParams;
  try {
    const items = buildLineItems(
      orderRow.data as unknown as OrderSummary,
      (lineRows.data ?? []) as unknown as OrderLine[],
    );
    // The figure Stripe charges must be the figure the order carries. A
    // mismatch stops here, before a customer is asked for money — rather than
    // afterwards, as confirm_order_payment()'s amount_mismatch.
    assertItemsMatchAuthoritativeTotal(items, attempt.amount_cents);

    const { successUrl, cancelUrl } = redirectUrls(
      SITE_URL,
      (orderRow.data as unknown as OrderSummary).order_number,
    );
    form = buildSessionForm({
      items,
      currency: attempt.currency,
      orderNumber: (orderRow.data as unknown as OrderSummary).order_number,
      orderId,
      attemptId: attempt.attempt_id,
      customerEmail: (orderRow.data as unknown as OrderSummary).customer_email,
      successUrl,
      cancelUrl,
      expiresAt: sessionExpiresAt(attempt.created_at, Date.now()),
    });
  } catch (error) {
    return fail(500, "internal", "Das hat gerade nicht geklappt.", origin, error);
  }

  // ---- 7. Stripe ----------------------------------------------------------
  let session: { id?: string; url?: string };
  try {
    const response = await fetch(STRIPE_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Bound to the attempt, so a retry replays the same session instead
        // of creating a second payable one.
        "Idempotency-Key": idempotencyKey(attempt.attempt_id),
      },
      body: form.toString(),
    });
    const payload = await response.json();
    if (!response.ok) {
      return fail(502, "provider_error", "Die Zahlung konnte nicht gestartet werden.", origin,
        payload?.error?.message ?? response.status);
    }
    session = payload;
  } catch (error) {
    return fail(502, "provider_unreachable", "Die Zahlung konnte nicht gestartet werden.",
      origin, error);
  }

  if (!session.id || !session.url) {
    return fail(502, "provider_error", "Die Zahlung konnte nicht gestartet werden.", origin,
      "session without id or url");
  }

  // ---- 8. record it, or undo it -------------------------------------------
  const attached = await admin.rpc("attach_provider_payment", {
    p_attempt_id: attempt.attempt_id,
    p_provider_payment_id: session.id,
    p_checkout_url: session.url,
  });

  if (attached.error) {
    // Did a CONCURRENT request already attach this very session?
    //
    // Two requests for the same order are serialised by the order row lock
    // inside start_payment_attempt(), so both receive the same attempt — and
    // therefore the same idempotency key, and therefore the same Stripe
    // session. The second one's attach then fails against
    // `provider_payment_id is null`, which is correct and is NOT an orphan.
    //
    // Expiring here would kill the session the winner just attached and
    // published to the customer. So look before undoing.
    const recheck = await admin.rpc("start_payment_attempt", { p_order_id: orderId });
    const current = (Array.isArray(recheck.data) ? recheck.data[0] : recheck.data) as
      | PaymentAttempt
      | undefined;
    if (
      !recheck.error &&
      current?.provider_payment_id === session.id &&
      current.provider_checkout_url
    ) {
      return new Response(
        JSON.stringify({ url: current.provider_checkout_url, reused: true }),
        { status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
      );
    }

    // Genuinely orphaned: a payable session Stripe knows about and we do not.
    // Expire it rather than leave it — an unattached session that gets paid
    // arrives at confirm_order_payment() as `unknown_payment` and needs a
    // human.
    try {
      await fetch(`${STRIPE_API}/${session.id}/expire`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
          },
      });
    } catch (error) {
      console.error("create-payment orphaned session, expire failed:", session.id, error);
    }
    return fail(500, "internal", "Das hat gerade nicht geklappt.", origin, attached.error);
  }

  // ---- 9. only what the browser needs -------------------------------------
  return new Response(
    JSON.stringify({ url: session.url, reused: false }),
    { status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
  );
});
