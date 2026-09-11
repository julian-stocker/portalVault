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

import { principalKey, type Principal } from "@/lib/auth/principal";

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

/* ------------------------------------------------ surviving the redirect */

/**
 * Keeping the capability across the trip to Stripe (B2.4, ADR-0056).
 *
 * WHY THIS EXISTS, AND WHAT IT COSTS
 *
 * Everything above describes a secret held in memory for a few seconds. B2.4
 * breaks that: the customer leaves for Stripe's domain and comes back, and a
 * guest who arrives at /checkout/erfolg with nothing but an order number
 * cannot be shown their own order — `order_payment_state()` answers no one who
 * cannot prove they placed it. Without persistence, guests — most of the shop
 * — would be told nothing at all after paying.
 *
 * So the token is written to `sessionStorage`, and that is a real widening of
 * the attack surface: script running on this origin can read it. The trade is
 * deliberate and bounded:
 *
 *   sessionStorage, not localStorage   it dies with the tab; a shared computer
 *                                      does not keep it
 *   one key per order number           a second checkout cannot overwrite the
 *                                      first order's capability
 *   deleted at a terminal state        held only while it still answers
 *                                      something (see `isTerminal`)
 *   never a URL, never a query string, never a log line, never an event
 *                                      payload — unchanged from above
 *
 * What the token can do stays narrow: start or read the payment of the ONE
 * order it belongs to. It is not a session, it grants nothing else, and it
 * cannot be replayed against another order.
 */

/**
 * One key per order AND per principal.
 *
 * The order number alone was not enough. `sessionStorage` outlives a sign-out
 * — it belongs to the tab, not to the session — so after signing in as
 * somebody else the same key was still there, still readable, and still a
 * working capability for the previous account's order. Namespacing by
 * principal is what makes the next account's browser unable to offer it
 * (ADR-0061); `authorize_order_payment()` remains the thing that decides.
 */
const PAY_PREFIX = "skyisles.pay.v2.";

export function capabilityStorageKey(principal: Principal, orderNumber: string): string {
  return `${PAY_PREFIX}${principalKey(principal)}.${orderNumber}`;
}

/**
 * Every access is wrapped: Safari in private mode throws on `sessionStorage`
 * rather than returning null, and a checkout must not die because a browser
 * refuses to remember something.
 */
export function rememberPaymentToken(principal: Principal, orderNumber: string, token: string): void {
  if (!isPaymentToken(token)) return;
  try {
    window.sessionStorage.setItem(capabilityStorageKey(principal, orderNumber), token);
  } catch {
    /* Not remembering is survivable: the payment still starts, and the status
       page will simply not be able to show a guest their order. */
  }
}

/** The capability for this order, or null. Never throws. */
export function recallPaymentToken(principal: Principal, orderNumber: string): string | null {
  try {
    const value = window.sessionStorage.getItem(capabilityStorageKey(principal, orderNumber));
    return isPaymentToken(value) ? value : null;
  } catch {
    return null;
  }
}

/** Forget it. Called as soon as the order can no longer change by itself. */
export function forgetPaymentToken(principal: Principal, orderNumber: string): void {
  try {
    window.sessionStorage.removeItem(capabilityStorageKey(principal, orderNumber));
  } catch {
    /* nothing to do, and nothing worth telling the customer */
  }
}

/**
 * The open order this tab is in the middle of paying for.
 *
 * Separate from the capability above, and stored under its own key, because
 * it is a different kind of value: an order id and its number are **not
 * secrets**. They are kept for one reason — after a cancelled payment the
 * browser returns to `/checkout?order=…` with nothing but the number, and
 * `create-payment` matches on the id. Without this, "resume payment" would
 * need the id back from the database, and the status reader deliberately
 * returns no ids at all.
 *
 * Same lifetime rules as the token: sessionStorage, cleared when the order
 * settles. Nothing here would help an attacker who does not also hold the
 * capability.
 */
function openOrderKey(principal: Principal): string {
  return `${PAY_PREFIX}${principalKey(principal)}.open`;
}

export type OpenOrder = { orderId: number; orderNumber: string };

export function rememberOpenOrder(principal: Principal, order: OpenOrder): void {
  try {
    window.sessionStorage.setItem(openOrderKey(principal), JSON.stringify(order));
  } catch {
    /* the payment still works; only "resume" is lost */
  }
}

/**
 * The open order this tab is paying for.
 *
 * With an order number it must be that one: the number comes from `?order=…`
 * and is therefore attacker-suppliable, so it is matched rather than trusted.
 *
 * Without one it returns whatever this tab stored, and that is the case that
 * matters after a Back from the payment page: the browser lands on `/checkout`
 * with no query at all, and if the document was not restored from the
 * back/forward cache, the placed order would otherwise be unreachable while it
 * is still holding stock. Reading our own tab's storage is not the same as
 * trusting a URL.
 */
export function recallOpenOrder(principal: Principal, orderNumber?: string): OpenOrder | null {
  try {
    const raw = window.sessionStorage.getItem(openOrderKey(principal));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OpenOrder>;
    if (typeof parsed.orderNumber !== "string" || parsed.orderNumber === "") return null;
    if (orderNumber !== undefined && parsed.orderNumber !== orderNumber) return null;
    if (!Number.isSafeInteger(parsed.orderId) || (parsed.orderId ?? 0) < 1) return null;
    return { orderId: parsed.orderId as number, orderNumber: parsed.orderNumber };
  } catch {
    return null;
  }
}

export function forgetOpenOrder(principal: Principal): void {
  try {
    window.sessionStorage.removeItem(openOrderKey(principal));
  } catch {
    /* nothing worth telling the customer */
  }
}


/**
 * Throw away every payment state that does not belong to this principal.
 *
 * Called whenever the browser changes who it is acting as — a sign-in, a
 * sign-out, or arriving on a page already signed in as somebody else. Without
 * it the previous account's capability would simply sit in the tab until it
 * was closed, unreachable through the scoped keys but still present.
 *
 * A guest who signs in loses the capability of an order they placed as a
 * guest, and that is the intended trade: a token must not follow a person
 * across an identity change. The order itself is untouched and still reachable
 * with its number and the mail it produced.
 */
export function forgetForeignPaymentState(principal: Principal): void {
  const mine = `${PAY_PREFIX}${principalKey(principal)}.`;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key !== null && key.startsWith(PAY_PREFIX) && !key.startsWith(mine)) {
        doomed.push(key);
      }
    }
    for (const key of doomed) window.sessionStorage.removeItem(key);

    // The unscoped keys this release replaces. Removed rather than migrated:
    // there is no way to tell whose they were, and guessing is what caused
    // the leak in the first place.
    window.sessionStorage.removeItem("skyisles.pay.v1.open");
    for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = window.sessionStorage.key(i);
      if (key !== null && key.startsWith("skyisles.pay.v1.")) window.sessionStorage.removeItem(key);
    }
  } catch {
    /* Private mode. Nothing was stored, so nothing needs forgetting. */
  }
}
