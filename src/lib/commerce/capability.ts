/**
 * The capability that lets whoever placed an order pay for it (B2.2a).
 *
 * A guest has no account, so nothing about a session can authorise them. The
 * order number is a counter, the order id is an integer, and the email address
 * is not a secret — none of them may stand in for permission. So an order
 * carries a capability: a random secret whose SHA-256 is stored on the row and
 * whose plaintext lives only in the browser that placed it.
 *
 * WHY THE BROWSER GENERATES IT, AND NOT THE SERVER
 *
 * This looks backwards and is the most important decision in the file.
 *
 * If the server minted the token and returned it once, a lost HTTP response
 * would be unrecoverable: the order exists, the stock is held, and the only
 * copy of the plaintext is gone. The customer could never pay, and a
 * one-of-a-kind figure would sit reserved for twenty minutes. Re-issuing on
 * retry would fix that and open something worse — anybody who learned a
 * `request_id` could mint themselves a capability for that order.
 *
 * Generating it here means the secret **travels forward only**. A lost
 * response destroys nothing, because this browser had the token before it made
 * the call. The retry then proves it holds the token rather than asking for a
 * new one.
 *
 * Choosing the entropy client-side is safe, and worth being explicit about: a
 * caller who picks a weak token weakens only the capability for the order they
 * are creating, which they already control. It buys them nothing against
 * anybody else's order, because a token must hash to the value stored on
 * *that* row.
 *
 * WHERE IT MAY GO
 *
 * Into the request body, and nowhere else. Never a URL, a query string, a log
 * line, an analytics call, an order or payment event, Stripe metadata, or
 * server-rendered HTML. It is held in memory for the seconds between placing
 * the order and being sent to the payment provider.
 */

/** 32 bytes — 256 bits, as hex. The size the stored SHA-256 digest implies. */
const TOKEN_BYTES = 32;

/**
 * A fresh payment capability.
 *
 * `crypto.getRandomValues` is the platform's cryptographic generator and is
 * required to be one — `Math.random` would be a real weakness here, not a
 * stylistic one. Present in every browser this product supports and in Node
 * for the tests.
 */
export function newPaymentToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The idempotency key for one checkout attempt.
 *
 * Deliberately separate from the capability even though both are random and
 * both are generated here. They have different rules: a request id may be
 * logged and traced, a capability may not. Merging them would quietly turn
 * every log line that records an idempotency key into a leaked secret.
 */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** What both look like, so a malformed value is caught before a round trip. */
export const PAYMENT_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function isPaymentToken(value: unknown): value is string {
  return typeof value === "string" && PAYMENT_TOKEN_PATTERN.test(value);
}

/**
 * Everything one checkout attempt needs to stay recoverable across a retry.
 *
 * Generated once and kept for the life of the attempt. Regenerating either
 * value between tries would create a second order (a new request id) or fail
 * to prove ownership of the first (a new token).
 */
export type CheckoutCredentials = {
  requestId: string;
  paymentToken: string;
};

export function newCheckoutCredentials(): CheckoutCredentials {
  return { requestId: newRequestId(), paymentToken: newPaymentToken() };
}
