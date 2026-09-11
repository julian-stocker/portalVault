import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  ALLOWED_REQUEST_HEADERS,
  allowedRequestHeadersValue,
  assertItemsMatchAuthoritativeTotal,
  buildLineItems,
  buildSessionForm,
  euroStringToCents,
  idempotencyKey,
  lineItemsTotal,
  parseAllowlist,
  parsePaymentRequest,
  PAYMENT_TOKEN_PATTERN,
  preflightAllows,
  redirectUrls,
  resolveAllowedOrigin,
  MIN_SESSION_LEAD_SECONDS,
  SESSION_LIFETIME_MINUTES,
  sessionExpiresAt,
  STRIPE_MIN_SESSION_MINUTES,
  type OrderLine,
  type OrderSummary,
} from "../../../supabase/functions/create-payment/session.ts";

/**
 * `create-payment` (B2.2b).
 *
 * Two kinds of test in one file, because the function has two halves. The
 * logic in `session.ts` is executed for real — it is plain TypeScript with no
 * Deno API, which is precisely why it was split out. `index.ts` is Deno and
 * cannot run here, so it is held to a source contract: what it must never do
 * matters more than what it does, and most of that is an absence.
 */
const ENTRY = "supabase/functions/create-payment/index.ts";
const entry = readFileSync(ENTRY, "utf8");

/** The entry point with comments removed: prose explains, code decides. */
const entryCode = entry
  .split("\n")
  .filter((line) => {
    const t = line.trimStart();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  })
  .join("\n");

const ORDER: OrderSummary = {
  order_number: "SI-2026-001004",
  currency: "EUR",
  customer_email: "kunde@example.test",
  shipping_amount_text: "5.49",
  discount_amount_text: "0.00",
  shipping_method_name: "Hermes",
};

const LINES: OrderLine[] = [
  {
    sky_id: "SKY-0015",
    condition: "loose",
    quantity: 1,
    name_snapshot: "Chop Chop",
    unit_price_text: "3.82",
    line_total_text: "3.82",
  },
];

// ---------------------------------------------------------------------------

describe("euro to cents, exactly", () => {
  it("converts the amounts this shop actually charges", () => {
    const vectors: [string, number][] = [
      ["3.82", 382],
      ["5.49", 549],
      ["9.31", 931],
      ["14.99", 1499],
      ["75.00", 7500],
      ["0.01", 1],
      ["0.00", 0],
      ["5.4", 540],
      ["5", 500],
      ["999.99", 99999],
    ];
    for (const [input, expected] of vectors) {
      expect(euroStringToCents(input), input).toBe(expected);
    }
  });

  it("refuses sub-cent precision rather than rounding it away", () => {
    for (const bad of ["1.005", "0.001", "3.8250"]) {
      expect(() => euroStringToCents(bad), bad).toThrow();
    }
  });

  it("refuses anything Number() would silently accept", () => {
    for (const bad of ["1e2", "14,99", " ", "", "abc", "0x10", "Infinity", "NaN", "1.2.3"]) {
      expect(() => euroStringToCents(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("never produces a float, even where one would be wrong", () => {
    // Values where Math.round(x * 100) is famously fragile: 1.15 * 100 is
    // 114.99999999999999 and 1.13 * 100 is 112.99999999999999 as doubles.
    expect(euroStringToCents("1.15")).toBe(115);
    expect(euroStringToCents("1.13")).toBe(113);
    expect(euroStringToCents("8.16")).toBe(816);
  });
});

// ---------------------------------------------------------------------------

describe("the Stripe line items", () => {
  it("shows each article and the shipping charge", () => {
    const items = buildLineItems(ORDER, LINES);
    expect(items).toEqual([
      { name: "Chop Chop", unitAmount: 382, quantity: 1 },
      { name: "Versand · Hermes", unitAmount: 549, quantity: 1 },
    ]);
  });

  it("adds up to the authoritative total from start_payment_attempt", () => {
    const items = buildLineItems(ORDER, LINES);
    expect(lineItemsTotal(items)).toBe(931);
    expect(() => assertItemsMatchAuthoritativeTotal(items, 931)).not.toThrow();
  });

  it("refuses to charge a total the order does not carry", () => {
    const items = buildLineItems(ORDER, LINES);
    expect(() => assertItemsMatchAuthoritativeTotal(items, 930)).toThrow(/931.*930|930/);
    expect(() => assertItemsMatchAuthoritativeTotal(items, 0)).toThrow();
  });

  it("multiplies quantity without ever multiplying a float", () => {
    const items = buildLineItems(ORDER, [
      { ...LINES[0], quantity: 3, unit_price_text: "3.82", line_total_text: "11.46" },
    ]);
    expect(items[0]).toEqual({ name: "Chop Chop", unitAmount: 382, quantity: 3 });
    expect(lineItemsTotal(items)).toBe(3 * 382 + 549);
  });

  it("omits the shipping line when shipping is free", () => {
    const items = buildLineItems({ ...ORDER, shipping_amount_text: "0.00" }, LINES);
    expect(items).toHaveLength(1);
    expect(items.some((i) => i.name.startsWith("Versand"))).toBe(false);
  });

  it("never sends a zero-amount or negative shipping line", () => {
    expect(() => buildLineItems({ ...ORDER, shipping_amount_text: "-1.00" }, LINES)).toThrow();
    const free = buildLineItems({ ...ORDER, shipping_amount_text: "0.00" }, LINES);
    expect(free.every((i) => i.unitAmount > 0)).toBe(true);
  });

  it("refuses a discounted order rather than charging the full amount", () => {
    // Stripe has no negative line item; V1 has no discounts. If one appears,
    // stop instead of quietly overcharging.
    expect(() => buildLineItems({ ...ORDER, discount_amount_text: "1.00" }, LINES)).toThrow();
  });

  it("refuses an order with no lines and an impossible quantity", () => {
    expect(() => buildLineItems(ORDER, [])).toThrow();
    expect(() => buildLineItems(ORDER, [{ ...LINES[0], quantity: 0 }])).toThrow();
    expect(() => buildLineItems(ORDER, [{ ...LINES[0], quantity: 1.5 }])).toThrow();
  });

  it("uses the name snapshot, not a live catalog name", () => {
    const items = buildLineItems(ORDER, [{ ...LINES[0], name_snapshot: "Umbenannt" }]);
    expect(items[0].name).toBe("Umbenannt");
  });
});

// ---------------------------------------------------------------------------

describe("the session expiry is derived, and always valid", () => {
  const CREATED = "2026-09-10T12:00:00.000Z";
  const at = (offsetSeconds: number) => Date.parse(CREATED) + offsetSeconds * 1000;

  it("sits above Stripe's floor", () => {
    expect(SESSION_LIFETIME_MINUTES).toBeGreaterThan(STRIPE_MIN_SESSION_MINUTES);
    expect(MIN_SESSION_LEAD_SECONDS).toBeGreaterThanOrEqual(STRIPE_MIN_SESSION_MINUTES * 60);
  });

  it("is the same value on every retry while the derived value is still valid", () => {
    // The ordinary path: the attempt is seconds old, so the parameter is
    // stable and Stripe replays the original session on a retry.
    expect(sessionExpiresAt(CREATED, at(0))).toBe(sessionExpiresAt(CREATED, at(30)));
    expect(sessionExpiresAt(CREATED, at(0))).toBe(Date.parse(CREATED) / 1000 + 32 * 60);
  });

  it("never falls below Stripe's floor, however old the attempt is", () => {
    // This is the defect the floor exists for: a value derived only from
    // created_at decays, and at +3 minutes it would be 29 minutes ahead —
    // rejected outright, leaving a customer unable to pay for a live order.
    for (const age of [0, 60, 120, 180, 600, 19 * 60]) {
      const expires = sessionExpiresAt(CREATED, at(age));
      const nowSeconds = Math.floor(at(age) / 1000);
      expect(expires - nowSeconds, `age ${age}s`)
        .toBeGreaterThanOrEqual(STRIPE_MIN_SESSION_MINUTES * 60);
    }
  });

  it("prefers the derived value and only floors when it must", () => {
    const derived = Date.parse(CREATED) / 1000 + 32 * 60;
    expect(sessionExpiresAt(CREATED, at(60))).toBe(derived);      // still valid
    expect(sessionExpiresAt(CREATED, at(600))).toBeGreaterThan(derived); // floored
  });

  it("refuses an unusable creation time", () => {
    expect(() => sessionExpiresAt("not a date", Date.now())).toThrow();
  });
});

describe("the idempotency key is bound to the attempt", () => {
  it("is stable for one attempt and different across attempts", () => {
    expect(idempotencyKey(41)).toBe(idempotencyKey(41));
    expect(idempotencyKey(41)).not.toBe(idempotencyKey(42));
  });

  it("carries nothing secret", () => {
    expect(idempotencyKey(41)).toBe("skyisles-attempt-41");
  });
});

// ---------------------------------------------------------------------------

describe("the accepted request surface", () => {
  it("takes an order id and optionally the capability", () => {
    expect(parsePaymentRequest({ order_id: 1 })).toEqual({ orderId: 1, paymentToken: null });
    const token = "a".repeat(64);
    expect(parsePaymentRequest({ order_id: 1, payment_token: token }))
      .toEqual({ orderId: 1, paymentToken: token });
  });

  it("ignores a user_id in the body completely", () => {
    const parsed = parsePaymentRequest({ order_id: 1, user_id: "00000000-0000-0000-0000-000000000000" });
    expect(parsed).toEqual({ orderId: 1, paymentToken: null });
    expect(JSON.stringify(parsed)).not.toContain("user_id");
  });

  it("accepts no amount, price or currency from the client", () => {
    const parsed = parsePaymentRequest({
      order_id: 1, amount: 1, amount_cents: 1, total: 1, currency: "EUR", price: 1,
    });
    expect(parsed).toEqual({ orderId: 1, paymentToken: null });
  });

  it("rejects a malformed capability instead of round-tripping it", () => {
    for (const bad of ["", "short", "A".repeat(64), "g".repeat(64), "a".repeat(63), 1, {}]) {
      expect(parsePaymentRequest({ order_id: 1, payment_token: bad }), String(bad)).toBeNull();
    }
  });

  it("rejects a missing or impossible order id", () => {
    for (const bad of [{}, { order_id: 0 }, { order_id: -1 }, { order_id: "x" },
                       { order_id: 1.5 }, null, "string", 7]) {
      expect(parsePaymentRequest(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("agrees with the capability format the database enforces", () => {
    // orders_payment_token_hash_format is 64 hex; the token itself is too.
    expect(PAYMENT_TOKEN_PATTERN.source).toBe("^[0-9a-f]{64}$");
  });
});

// ---------------------------------------------------------------------------

describe("CORS is an allowlist, never a wildcard", () => {
  const allow = ["http://localhost:3000", "https://skyisles.app"];

  it("echoes an allowed origin back", () => {
    expect(resolveAllowedOrigin("https://skyisles.app", allow)).toBe("https://skyisles.app");
    expect(resolveAllowedOrigin("http://localhost:3000", allow)).toBe("http://localhost:3000");
  });

  it("refuses everything else", () => {
    for (const bad of ["https://evil.test", "https://skyisles.app.evil.test",
                       "http://skyisles.app", "https://skyisles.appx", null, ""]) {
      expect(resolveAllowedOrigin(bad, allow), String(bad)).toBeNull();
    }
  });

  it("parses a configured allowlist and tolerates spacing", () => {
    expect(parseAllowlist("https://a.test, https://b.test ,")).toEqual([
      "https://a.test", "https://b.test",
    ]);
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it("fails closed when nothing is configured", () => {
    // An unset ALLOWED_ORIGINS must refuse every cross-origin request rather
    // than fall back to something permissive.
    expect(resolveAllowedOrigin("https://skyisles.app", [])).toBeNull();
    expect(resolveAllowedOrigin("http://localhost:3000", [])).toBeNull();
  });

  it("bakes no environment's origin into the source", () => {
    // A staging deployment that trusted the production origin would let the
    // live shop start test-mode payments against the staging database.
    const source = readFileSync("supabase/functions/create-payment/index.ts", "utf8")
      .split("\n")
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    // No production origin anywhere in the file.
    expect(source).not.toContain("skyisles.app");
    // And the allowlist itself is built from the environment alone. The
    // localhost default that remains is SITE_URL — a redirect base, not a
    // caller permitted to start a payment.
    expect(source).toContain('const ALLOWED_ORIGINS = parseAllowlist(Deno.env.get("ALLOWED_ORIGINS"));');
    const allowlistLine = source
      .split("\n")
      .find((line) => line.includes("const ALLOWED_ORIGINS"))!;
    expect(allowlistLine).not.toMatch(/https?:\/\//);
  });
});

describe("a real browser preflight gets through", () => {
  /**
   * The exact set supabase-js asks for from a browser.
   *
   * `x-client-info` is not optional: DEFAULT_HEADERS becomes the client's
   * headers and `get functions()` passes them to the FunctionsClient, so every
   * `functions.invoke()` carries it. `apikey` and `authorization` come from
   * the auth-aware fetch, `content-type` from sending a JSON body.
   */
  const BROWSER_PREFLIGHT = "authorization, apikey, content-type, x-client-info";

  it("allows every header supabase-js sends", () => {
    const { allowed, blocked } = preflightAllows(BROWSER_PREFLIGHT);
    expect(blocked).toEqual([]);
    expect(allowed).toBe(true);
  });

  it("allows x-client-info specifically", () => {
    // The regression this test exists for. Without it the preflight answers
    // 204 with a correct Allow-Origin and the browser still drops the POST,
    // so the function is never entered: no attempt row, no Stripe call, and
    // an opaque "Failed to send a request to the Edge Function" in the page.
    expect(preflightAllows("x-client-info").allowed).toBe(true);
    expect(ALLOWED_REQUEST_HEADERS).toContain("x-client-info");
  });

  it("matches header names case-insensitively, as a browser does", () => {
    // HTTP field names are case-insensitive; supabase-js writes the literal
    // "X-Client-Info". Matching on the exact case would refuse a request that
    // the specification says is identical.
    for (const variant of [
      "X-Client-Info",
      "Authorization, APIKey, Content-Type, X-Client-Info",
      "  authorization ,  X-CLIENT-INFO  ",
    ]) {
      expect(preflightAllows(variant).allowed, variant).toBe(true);
    }
  });

  it("still refuses a header nothing sends", () => {
    // The list is an allowlist, not decoration.
    const { allowed, blocked } = preflightAllows("authorization, x-smuggled");
    expect(allowed).toBe(false);
    expect(blocked).toEqual(["x-smuggled"]);
  });

  it("does not allow traceparent yet", () => {
    /*
     * Deliberate, and worth stating so it is not read as an oversight.
     *
     * supabase-js attaches `traceparent` only when `tracePropagation.enabled`
     * is true — it defaults to false — AND the tracing entry point has been
     * imported AND an OpenTelemetry SDK is active. `src/lib/supabase/client.ts`
     * constructs the browser client with no options at all, so nothing on the
     * current path sends it. It goes on the list when tracing is switched on.
     */
    expect(preflightAllows("traceparent").allowed).toBe(false);
  });

  it("empty or absent request headers are trivially allowed", () => {
    for (const nothing of ["", null, undefined]) {
      expect(preflightAllows(nothing).allowed, String(nothing)).toBe(true);
    }
  });

  it("is the single source the function serves", () => {
    // Two hand-maintained lists would drift, and the drift is invisible until
    // a browser refuses a request. index.ts must call the shared helper rather
    // than repeat the string.
    const source = readFileSync("supabase/functions/create-payment/index.ts", "utf8");
    expect(source).toContain('"Access-Control-Allow-Headers": allowedRequestHeadersValue()');
    expect(source).not.toMatch(/"Access-Control-Allow-Headers":\s*"/);
    expect(allowedRequestHeadersValue()).toBe(
      "authorization, apikey, content-type, x-client-info",
    );
  });
});

describe("the redirect urls", () => {
  it("carry the order number and Stripe's own session placeholder", () => {
    const { successUrl, cancelUrl } = redirectUrls("https://skyisles.app", "SI-2026-001004");
    expect(successUrl).toContain("https://skyisles.app/checkout/erfolg");
    expect(successUrl).toContain("order=SI-2026-001004");
    // Must reach Stripe unencoded, or it is never substituted.
    expect(successUrl).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(cancelUrl).toContain("https://skyisles.app/checkout");
  });

  it("tolerate a trailing slash on the site url", () => {
    expect(redirectUrls("https://skyisles.app/", "X").successUrl)
      .toContain("https://skyisles.app/checkout/erfolg");
  });

  it("carry no token and no session secret", () => {
    const { successUrl, cancelUrl } = redirectUrls("https://skyisles.app", "SI-2026-001004");
    for (const url of [successUrl, cancelUrl]) {
      expect(url).not.toMatch(/token|secret|capability/i);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the Stripe request body", () => {
  const form = buildSessionForm({
    items: buildLineItems(ORDER, LINES),
    currency: "EUR",
    orderNumber: "SI-2026-001004",
    orderId: 4,
    attemptId: 9,
    customerEmail: "kunde@example.test",
    successUrl: "https://skyisles.app/checkout/erfolg?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://skyisles.app/checkout",
    expiresAt: 1_800_000_000,
  });

  it("is a one-off payment with inline prices", () => {
    expect(form.get("mode")).toBe("payment");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("382");
    expect(form.get("line_items[0][price_data][product_data][name]")).toBe("Chop Chop");
    expect(form.get("line_items[0][quantity]")).toBe("1");
    expect(form.get("line_items[1][price_data][unit_amount]")).toBe("549");
  });

  it("sends the currency in lower case, as Stripe expects", () => {
    expect(form.get("line_items[0][price_data][currency]")).toBe("eur");
  });

  it("mirrors no Stripe Product or Price", () => {
    const keys = [...form.keys()].join(" ");
    expect(keys).not.toMatch(/\bprice\]|\[price\]|product\]/);
    expect(keys).not.toContain("[price]");
  });

  it("omits payment_method_types, so dynamic payment methods apply", () => {
    expect(form.has("payment_method_types")).toBe(false);
    expect([...form.keys()].some((k) => k.startsWith("payment_method_types"))).toBe(false);
  });

  it("lets Stripe compute neither tax nor shipping", () => {
    for (const forbidden of ["automatic_tax", "shipping_address_collection",
                             "shipping_options", "tax_id_collection", "shipping_rate"]) {
      expect([...form.keys()].some((k) => k.startsWith(forbidden)), forbidden).toBe(false);
    }
  });

  it("reconciles through client_reference_id and minimal metadata", () => {
    expect(form.get("client_reference_id")).toBe("SI-2026-001004");
    expect(form.get("metadata[order_id]")).toBe("4");
    expect(form.get("metadata[payment_attempt_id]")).toBe("9");
  });

  it("sends no capability, hash or secret in any field", () => {
    const body = form.toString();
    expect(body).not.toMatch(/token|capability|secret|sk_live|sk_test|whsec/i);
    expect([...form.keys()].some((k) => k.includes("payment_token"))).toBe(false);
  });

  it("carries the derived expiry", () => {
    expect(form.get("expires_at")).toBe("1800000000");
  });
});

// ---------------------------------------------------------------------------

describe("the Deno entry point, held to its contract", () => {
  it("never marks anything paid and converts no stock", () => {
    for (const forbidden of ["confirm_order_payment", "convert_order_reservations",
                             "release_order_reservations", "expire_stale_checkouts",
                             "inventory_movements", "payment_status", "sale_skyisles"]) {
      expect(entryCode, `${forbidden} must not appear`).not.toContain(forbidden);
    }
  });

  it("calls exactly the four contracted database functions", () => {
    // start_payment_attempt appears twice: once to open or reuse the attempt,
    // once to re-read it when a concurrent request won the attach race.
    //
    // `commerce_mode` was added by ADR-0060 and is a pure read: the mode has
    // one home, and this function asks it rather than keeping a second copy
    // in an environment variable that could drift from the one stamped on
    // the order.
    const rpcs = [...entryCode.matchAll(/\.rpc\(\s*"(\w+)"/g)].map((m) => m[1]);
    expect([...new Set(rpcs)].sort()).toEqual(["attach_provider_payment",
                                               "authorize_order_payment",
                                               "commerce_mode",
                                               "start_payment_attempt"]);
    expect(rpcs.filter((r) => r === "start_payment_attempt")).toHaveLength(2);
    expect(rpcs.filter((r) => r === "commerce_mode")).toHaveLength(1);
  });

  it("authorises through the existing contract, not a parallel one", () => {
    expect(entryCode).toContain("authorize_order_payment");
    expect(entryCode).toContain("p_user_id: userId");
    expect(entryCode).toContain("p_token: paymentToken");
    // Never from the body.
    expect(entryCode).not.toMatch(/body\.user_id|raw\.user_id|\.user_id\s*=\s*parsed/);
  });

  it("takes the user id only from a verified token", () => {
    expect(entryCode).toContain("auth.getUser(bearer)");
    expect(entryCode).toContain("userId = data.user.id");
  });

  it("takes the amount only from start_payment_attempt", () => {
    expect(entryCode).toContain("attempt.amount_cents");
    expect(entryCode).toContain("assertItemsMatchAuthoritativeTotal");
    // No amount is ever read out of the request.
    expect(entryCode).not.toMatch(/parsed\.(amount|total|price)/);
  });

  it("short-circuits a reused attempt instead of creating a second session", () => {
    const reuse = entryCode.indexOf("attempt.reused && attempt.provider_checkout_url");
    const stripe = entryCode.indexOf("fetch(STRIPE_API");
    expect(reuse).toBeGreaterThan(-1);
    expect(reuse).toBeLessThan(stripe);
  });

  it("sends an idempotency key bound to the attempt", () => {
    expect(entryCode).toContain('"Idempotency-Key": idempotencyKey(attempt.attempt_id)');
  });

  it("sends no unverified API version pin", () => {
    // Stripe's current version format carries a release name
    // (e.g. 2026-08-26.dahlia). Omitting the header uses the account default,
    // which is documented behaviour; pinning belongs with B2.3, where the
    // webhook endpoint's version has to match.
    expect(entryCode).not.toContain("Stripe-Version");
  });

  it("compensates an orphaned session by expiring it", () => {
    const attachFail = entryCode.indexOf("if (attached.error)");
    const expire = entryCode.indexOf("/expire");
    expect(attachFail).toBeGreaterThan(-1);
    expect(expire).toBeGreaterThan(attachFail);
  });

  it("checks for a concurrent winner BEFORE expiring anything", () => {
    // Two racing requests share one attempt, one idempotency key and
    // therefore one Stripe session. The loser's attach fails against
    // `provider_payment_id is null` — expiring there would kill the session
    // the winner already published to the customer.
    const attachFail = entryCode.indexOf("if (attached.error)");
    const recheck = entryCode.indexOf("start_payment_attempt", attachFail);
    const expire = entryCode.indexOf("/expire");
    expect(recheck).toBeGreaterThan(attachFail);
    expect(recheck).toBeLessThan(expire);
    expect(entryCode).toContain("current?.provider_payment_id === session.id");
  });

  it("derives the session expiry from the attempt and the clock", () => {
    expect(entryCode).toContain("sessionExpiresAt(attempt.created_at, Date.now())");
  });

  it("never returns a secret, a token or an internal message", () => {
    const responses = [...entryCode.matchAll(/JSON\.stringify\(\{[^}]*\}/g)].map((m) => m[0]);
    expect(responses.length).toBeGreaterThan(0);
    for (const body of responses) {
      expect(body).not.toMatch(/SERVICE_KEY|STRIPE_SECRET|paymentToken|token|detail|stack/);
    }
    // The failure shape carries a fixed code and message, never the cause.
    expect(entryCode).toContain('JSON.stringify({ error: code, message })');
  });

  it("logs the cause but never the body or the capability", () => {
    const logs = [...entryCode.matchAll(/console\.(error|log)\([^;]*\);/g)].map((m) => m[0]);
    for (const log of logs) {
      expect(log).not.toMatch(/paymentToken|STRIPE_SECRET|SERVICE_KEY|req\.json|parsed\b/);
    }
  });

  it("hard-codes no secret and reads them from the environment", () => {
    expect(entry).not.toMatch(/sk_live_|sk_test_|whsec_|eyJ[A-Za-z0-9_-]{10}/);
    for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "SUPABASE_ANON_KEY"]) {
      expect(entry).toContain(`Deno.env.get("${name}")`);
    }
  });

  it("answers 4xx for the caller's problems and 5xx for the provider's", () => {
    expect(entryCode).toMatch(/fail\(400, "invalid_request"/);
    expect(entryCode).toMatch(/fail\(401, "unauthorized"/);
    expect(entryCode).toMatch(/fail\(403, "unauthorized"/);
    expect(entryCode).toMatch(/fail\(409, "order_not_payable"/);
    expect(entryCode).toMatch(/fail\(502, "provider_error"/);
    expect(entryCode).toMatch(/fail\(502, "provider_unreachable"/);
  });

  it("never answers with a wildcard origin", () => {
    expect(entryCode).not.toContain('"Access-Control-Allow-Origin": "*"');
    expect(entryCode).toContain("resolveAllowedOrigin");
    expect(entryCode).toContain('"Vary": "Origin"');
  });

  it("is deployed with JWT verification off, and says why", () => {
    const config = readFileSync("supabase/config.toml", "utf8");
    expect(config).toContain("[functions.create-payment]");
    expect(config).toMatch(/verify_jwt\s*=\s*false/);
  });

  it("adds no npm dependency on Stripe", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
      expect(name).not.toMatch(/stripe|mollie|paypal/i);
    }
  });

  it("is not reachable from the Next.js application", () => {
    // The browser calls it over HTTPS; nothing in src/ imports it.
    expect(entry).not.toContain("@/lib");
  });
});
