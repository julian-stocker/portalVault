/**
 * Everything `create-payment` decides that does not need the network (B2.2b).
 *
 * Deliberately free of Deno APIs, `fetch`, secrets and the Supabase client, so
 * that `tsc` typechecks it and Vitest can execute it. `index.ts` is the only
 * file that talks to anything, and it is excluded from `tsc` because it is
 * Deno, not Next.js.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * The browser names no amount. Every figure here comes from the database:
 * the authoritative total from `start_payment_attempt()`, the individual
 * lines from `order_lines`. What this file adds is the arithmetic that turns
 * them into Stripe's minor units — and the assertion that the two agree
 * before anybody is asked to pay.
 */

/** What `start_payment_attempt()` returns (migration 0015). */
export type PaymentAttempt = {
  attempt_id: number;
  amount: string | number;
  amount_cents: number;
  currency: string;
  status: string;
  reused: boolean;
  created_at: string;
  provider_payment_id: string | null;
  provider_checkout_url: string | null;
};

/** One order line, with money read as text so no float ever exists. */
export type OrderLine = {
  sky_id: string;
  condition: string;
  quantity: number;
  name_snapshot: string;
  unit_price_text: string;
  line_total_text: string;
};

/** The order fields the payment page needs, money again as text. */
export type OrderSummary = {
  order_number: string;
  currency: string;
  customer_email: string;
  shipping_amount_text: string;
  discount_amount_text: string;
  shipping_method_name: string | null;
};

export type StripeLineItem = {
  name: string;
  unitAmount: number;
  quantity: number;
};

/* ------------------------------------------------------------------ money */

/**
 * `"14.99"` → `1499`. Integer arithmetic only; never parses a float.
 *
 * The authoritative total is converted in PostgreSQL by `amount_to_cents()`
 * and arrives ready-made. This exists for the *lines*, which are read as text
 * precisely so that the conversion here can be exact rather than a rounding
 * decision: PostgREST serialises `numeric` as a JSON number, and by the time
 * a float has been created the exact decimal is already gone.
 */
export function euroStringToCents(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new Error("amount is not a plain two-decimal figure");
  }
  const [, sign, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new Error("amount is out of range");
  }
  return sign === "-" ? -cents : cents;
}

/* ------------------------------------------------------- the line items */

/**
 * The order, as Stripe should display it.
 *
 * One item per order line plus, when it is charged, one for shipping. Prices
 * are inline `price_data`: no Stripe Product and no Stripe Price is created,
 * so a SKY-ID never becomes an identity in a third system (ADR-0034).
 *
 * Shipping is a line item rather than a Stripe shipping option on purpose.
 * It is already part of the order total that `start_payment_attempt()`
 * snapshotted; letting Stripe compute its own would charge it twice.
 */
export function buildLineItems(order: OrderSummary, lines: OrderLine[]): StripeLineItem[] {
  if (lines.length === 0) {
    throw new Error("an order with no lines cannot be paid for");
  }

  const items: StripeLineItem[] = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new Error("an order line has an impossible quantity");
    }
    return {
      name: line.name_snapshot,
      unitAmount: euroStringToCents(line.unit_price_text),
      quantity: line.quantity,
    };
  });

  const shipping = euroStringToCents(order.shipping_amount_text);
  if (shipping < 0) {
    throw new Error("shipping cannot be negative");
  }
  if (shipping > 0) {
    items.push({
      name: order.shipping_method_name
        ? `Versand · ${order.shipping_method_name}`
        : "Versand",
      unitAmount: shipping,
      quantity: 1,
    });
  }

  // V1 has no discounts, and Stripe has no negative line item. If one ever
  // appears, stop here rather than quietly charging the undiscounted total.
  if (euroStringToCents(order.discount_amount_text) !== 0) {
    throw new Error("a discounted order cannot be billed as line items");
  }

  return items;
}

/** What the line items add up to, in minor units. */
export function lineItemsTotal(items: StripeLineItem[]): number {
  return items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
}

/**
 * The check that has to hold before a customer is sent to pay.
 *
 * Loud, not forgiving. A mismatch means the page would show one figure and
 * the order carries another, and there is no version of that worth charging
 * for. `confirm_order_payment()` would catch it afterwards as an
 * `amount_mismatch` — but afterwards is after the money moved.
 */
export function assertItemsMatchAuthoritativeTotal(
  items: StripeLineItem[],
  amountCents: number,
): void {
  const total = lineItemsTotal(items);
  if (total !== amountCents) {
    throw new Error(
      `line items total ${total} but the order is ${amountCents}`,
    );
  }
}

/* ---------------------------------------------------------------- expiry */

/** Stripe's floor for a Checkout Session, in minutes. */
export const STRIPE_MIN_SESSION_MINUTES = 30;

/**
 * Our value, and why it is derived from the attempt.
 *
 * Preferring the attempt's creation time over the current clock keeps the
 * parameter **stable across retries**, which matters because Stripe compares
 * the parameters of an idempotent request and rejects a mismatch — which
 * would break exactly the retry the key exists to protect.
 *
 * 32 rather than 30 leaves head-room. 32 rather than 45 keeps the worst case
 * — active expiry never running — at twelve minutes past our twenty-minute
 * hold instead of twenty-five.
 */
export const SESSION_LIFETIME_MINUTES = 32;

/**
 * How far ahead the value must be at the moment of the call, whatever the
 * attempt's age. Stripe's floor is 30 minutes from *now*, so a value derived
 * purely from `created_at` decays: an attempt reused three minutes later
 * would compute 29 minutes ahead and Stripe would reject it outright.
 *
 * Validity is mandatory; stability is only desirable. So the derived value
 * wins whenever it is still valid — which is every ordinary call, because the
 * attempt is seconds old — and this floor takes over only on a delayed retry,
 * where a replayed session was never going to be returned anyway.
 */
export const MIN_SESSION_LEAD_SECONDS = 31 * 60;

/** Unix seconds. Derived from the attempt, floored so it is always valid. */
export function sessionExpiresAt(attemptCreatedAt: string, nowMs: number): number {
  const created = Date.parse(attemptCreatedAt);
  if (Number.isNaN(created)) {
    throw new Error("the attempt has no usable creation time");
  }
  const derived = Math.floor(created / 1000) + SESSION_LIFETIME_MINUTES * 60;
  const floor = Math.floor(nowMs / 1000) + MIN_SESSION_LEAD_SECONDS;
  return Math.max(derived, floor);
}

/**
 * Bound to the attempt, not to the request.
 *
 * `start_payment_attempt()` hands back the *existing* open attempt on a
 * retry, so the same attempt yields the same key, and Stripe replays the
 * original session instead of creating a second payable one. A lost response
 * therefore cannot produce a duplicate session.
 */
export function idempotencyKey(attemptId: number): string {
  return `skyisles-attempt-${attemptId}`;
}

/* ------------------------------------------------------------ the request */

export type PaymentRequest = { orderId: number; paymentToken: string | null };

/** What the capability looks like, so a malformed one costs no round trip. */
export const PAYMENT_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The whole accepted request surface: an order id, and optionally the
 * capability that proves the caller placed it.
 *
 * `user_id` is deliberately absent. It is never read from the body — the
 * only user this function will act for is one it verified from a JWT itself.
 * A body carrying `{"user_id": "..."}` has no effect whatsoever.
 */
export function parsePaymentRequest(body: unknown): PaymentRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;

  const orderId =
    typeof raw.order_id === "number"
      ? raw.order_id
      : typeof raw.order_id === "string" && /^\d+$/.test(raw.order_id)
        ? Number(raw.order_id)
        : null;

  if (orderId === null || !Number.isSafeInteger(orderId) || orderId < 1) return null;

  const token = raw.payment_token;
  if (token === undefined || token === null) {
    return { orderId, paymentToken: null };
  }
  if (typeof token !== "string" || !PAYMENT_TOKEN_PATTERN.test(token)) return null;

  return { orderId, paymentToken: token };
}

/* --------------------------------------------------------------- redirect */

/** Where Stripe sends the customer back to. */
export function redirectUrls(siteUrl: string, orderNumber: string): {
  successUrl: string;
  cancelUrl: string;
} {
  const base = siteUrl.replace(/\/+$/, "");
  return {
    // Stripe substitutes the placeholder. It must stay unencoded, so it is
    // appended after the encoded parameters rather than built by URLSearchParams.
    successUrl:
      `${base}/checkout/erfolg?order=${encodeURIComponent(orderNumber)}` +
      `&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/checkout?order=${encodeURIComponent(orderNumber)}`,
  };
}

/* ------------------------------------------------------------------- CORS */

/**
 * An allowlist, never `*`.
 *
 * The request carries an Authorization header and a capability, so a
 * wildcard would let any page on the internet ask a signed-in visitor's
 * browser to start a payment.
 */
export function resolveAllowedOrigin(
  requestOrigin: string | null,
  allowlist: readonly string[],
): string | null {
  if (!requestOrigin) return null;
  const normalised = requestOrigin.replace(/\/+$/, "");
  return allowlist.some((allowed) => allowed.replace(/\/+$/, "") === normalised)
    ? requestOrigin
    : null;
}

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The request headers a browser may actually send here.
 *
 * WHY `x-client-info` IS ON THIS LIST
 *
 * supabase-js puts it on every request it makes — `DEFAULT_HEADERS` becomes
 * the client's headers, and `get functions()` hands those to the
 * FunctionsClient. So it is not optional and not configurable away: any
 * browser calling `functions.invoke()` will ask for it in the preflight.
 *
 * Leaving it off cost a run. The preflight answered 204 with the right
 * `Allow-Origin`, and the browser still refused to send the POST, because it
 * compares the *requested* header names against `Allow-Headers` separately.
 * The function was never entered; nothing reached the database and nothing
 * reached Stripe. `preflightAllows()` and its test exist so that a header the
 * client sends can never again be missing from this list unnoticed.
 *
 * WHY `traceparent` IS NOT ON IT
 *
 * supabase-js attaches it only when `tracePropagation.enabled` is true — it
 * defaults to `false` — *and* the tracing entry point has been imported *and*
 * an OpenTelemetry SDK is active. `src/lib/supabase/client.ts` passes no
 * options at all, so nothing on the current path sends it. Allowing a header
 * nobody sends widens the surface for nothing; it goes on this list the day
 * tracing is switched on, not before.
 *
 * Lowercase throughout, which is also how the comparison is done: HTTP field
 * names are case-insensitive and a browser lowercases them before matching.
 */
export const ALLOWED_REQUEST_HEADERS = [
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
] as const;

/** The literal `Access-Control-Allow-Headers` value. One source, not two. */
export function allowedRequestHeadersValue(): string {
  return ALLOWED_REQUEST_HEADERS.join(", ");
}

/**
 * What a browser decides after reading the preflight response.
 *
 * Mirrors the Fetch spec's CORS-preflight check: split
 * `Access-Control-Request-Headers` on commas, trim, lowercase, and require
 * every name to appear in `Access-Control-Allow-Headers`. Anything left over
 * is what the browser would block the request on — which is a silent failure
 * in the page, so it is worth being able to assert on directly.
 */
export function preflightAllows(
  requestedHeaders: string | null | undefined,
  allowlist: readonly string[] = ALLOWED_REQUEST_HEADERS,
): { allowed: boolean; blocked: string[] } {
  const permitted = new Set(allowlist.map((name) => name.trim().toLowerCase()));
  const requested = (requestedHeaders ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);

  const blocked = requested.filter((name) => !permitted.has(name));
  return { allowed: blocked.length === 0, blocked };
}

/* --------------------------------------------------- the Stripe form body */

/**
 * Stripe's API takes form-encoded bodies with bracketed nested keys. Built
 * here so the exact shape is testable without a network call.
 *
 * What is deliberately NOT sent:
 *   payment_method_types    its absence is what enables dynamic payment
 *                           methods, configured in the Dashboard
 *   automatic_tax           §19 UStG is a regime, not a rate; Stripe Tax
 *                           would print a VAT line the order does not carry
 *   shipping_address_collection / shipping_options
 *                           the address is already snapshotted in
 *                           order_addresses and the charge is already a line
 *   the capability token     never, in any field
 */
export function buildSessionForm(input: {
  items: StripeLineItem[];
  currency: string;
  orderNumber: string;
  orderId: number;
  attemptId: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: number;
}): URLSearchParams {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", input.successUrl);
  form.set("cancel_url", input.cancelUrl);
  form.set("expires_at", String(input.expiresAt));
  form.set("customer_email", input.customerEmail);
  form.set("locale", "de");
  // Designed for exactly this: reconciling a session with our own records.
  form.set("client_reference_id", input.orderNumber);
  form.set("metadata[order_id]", String(input.orderId));
  form.set("metadata[payment_attempt_id]", String(input.attemptId));

  const currency = input.currency.toLowerCase();
  input.items.forEach((item, index) => {
    form.set(`line_items[${index}][price_data][currency]`, currency);
    form.set(`line_items[${index}][price_data][product_data][name]`, item.name);
    form.set(`line_items[${index}][price_data][unit_amount]`, String(item.unitAmount));
    form.set(`line_items[${index}][quantity]`, String(item.quantity));
  });

  return form;
}

/* ------------------------------------------------- the commerce mode guard */

/**
 * Which world commerce is in. The database is the only source of it; this
 * function never guesses from an environment variable, because two sources
 * are two things that can disagree and eventually will.
 */
export type CommerceMode = "closed" | "sandbox" | "live";

export function isCommerceMode(value: unknown): value is CommerceMode {
  return value === "closed" || value === "sandbox" || value === "live";
}

/**
 * What a Stripe secret says about itself.
 *
 * Both shapes Stripe issues are recognised: `sk_` for a standard secret key
 * and `rk_` for a restricted one. Anything else is `unknown`, which is never
 * treated as acceptable — a key whose world cannot be read is a key that must
 * not be used.
 */
export function stripeKeyMode(key: string | undefined | null): "test" | "live" | "unknown" {
  if (typeof key !== "string") return "unknown";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return "unknown";
}

/**
 * The whole Stripe-safety rule, as one pure question.
 *
 * Returns a short reason when the deployment must refuse, and `null` when the
 * key and the mode describe the same world. Every unclear case is a reason:
 * an unreadable mode, an unreadable key, a missing key, a closed shop. There
 * is no branch that shrugs and continues.
 *
 * This is what keeps "sandbox" honest. A sandbox that could reach a live key
 * would charge a tester real money for a test purchase, and a live shop
 * running on test keys would take orders nobody ever paid for.
 */
export function providerConfigProblem(
  mode: unknown,
  stripeKey: string | undefined | null,
): string | null {
  if (!isCommerceMode(mode)) return "unknown_commerce_mode";
  if (mode === "closed") return "commerce_closed";
  if (!stripeKey) return "missing_stripe_key";

  const keyMode = stripeKeyMode(stripeKey);
  if (keyMode === "unknown") return "unrecognised_stripe_key";

  const wanted = mode === "live" ? "live" : "test";
  return keyMode === wanted ? null : `stripe_key_is_${keyMode}_but_mode_is_${mode}`;
}
