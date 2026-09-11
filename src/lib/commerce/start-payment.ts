"use client";

import { currentPrincipal } from "@/lib/auth/principal";
import { recallPaymentToken } from "@/lib/commerce/capability";
import { createClient } from "@/lib/supabase/client";

/**
 * Asking `create-payment` for a checkout session (B2.4).
 *
 * THE WHOLE REQUEST IS ONE NUMBER
 *
 * An order id, plus the capability when the caller is a guest. No amount, no
 * currency, no line items, no order number. Every figure comes from the order
 * itself, read under a lock inside `start_payment_attempt()` — so there is
 * nothing here a tampered client could change about what it is charged.
 *
 * AUTHENTICATION IS AUTOMATIC
 *
 * `supabase.functions.invoke()` attaches the signed-in user's access token by
 * itself, and deliberately does not fall back to the anon key. A guest has no
 * session, so they send the capability instead — the same pair the Edge
 * Function has accepted since B2.2b. Neither is ever read from a URL, written
 * to a log, or put in an error message.
 *
 * WHY IT LIVES HERE AND NOT IN A SERVER ACTION
 *
 * Both proofs are browser-side: the JWT is in the browser's Supabase session,
 * the capability in its `sessionStorage`. A server action would have to be
 * handed one of them, which means putting a secret in a request body for no
 * gain.
 */

/** What went wrong, in terms the interface can translate. */
export type PaymentStartFailure =
  /** The order is settled, flagged, or its hold has lapsed. */
  | "not_payable"
  /** Neither a session nor a capability that fits this order. */
  | "not_yours"
  /** The provider is not configured on this deployment. */
  | "unavailable"
  /** The provider answered, but not with a session. */
  | "provider"
  /** The request never arrived: network, CORS, DNS. */
  | "network";

export type PaymentStartResult =
  | { ok: true; url: string; reused: boolean }
  | { ok: false; reason: PaymentStartFailure };

/** The Edge Function's stable error codes, mapped once. */
function reasonFor(status: number, code: string): PaymentStartFailure {
  if (code === "order_not_payable") return "not_payable";
  if (code === "unauthorized" || code === "origin_not_allowed") return "not_yours";
  if (code === "provider_unconfigured") return "unavailable";
  if (code === "provider_error" || code === "provider_unreachable") return "provider";
  if (status === 409) return "not_payable";
  if (status === 401 || status === 403) return "not_yours";
  if (status === 503) return "unavailable";
  return "provider";
}

/**
 * Start (or resume) the payment for one order.
 *
 * `orderNumber` is used for one thing only: looking up the capability this
 * browser stored for that order. A signed-in owner has none and needs none —
 * the JWT rides along by itself, and `authorize_order_payment()` accepts
 * either proof. Passing the number does not authorise anything; the token or
 * the session does.
 */
export async function startPayment(
  orderId: number,
  orderNumber?: string,
): Promise<PaymentStartResult> {
  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    return { ok: false, reason: "not_payable" };
  }

  const body: { order_id: number; payment_token?: string } = { order_id: orderId };
  if (orderNumber) {
    const token = recallPaymentToken(currentPrincipal(), orderNumber);
    if (token !== null) body.payment_token = token;
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("create-payment", { body });

    if (error) {
      const response = (error as { context?: Response }).context;
      if (!(response instanceof Response)) {
        // No HTTP answer at all: the request never left, or was blocked before
        // it did. Never surfaced verbatim — the message is ours, not the
        // provider's.
        return { ok: false, reason: "network" };
      }
      let code = "";
      try {
        const payload = (await response.clone().json()) as { error?: string };
        code = typeof payload.error === "string" ? payload.error : "";
      } catch {
        /* an error without a body is still an error */
      }
      return { ok: false, reason: reasonFor(response.status, code) };
    }

    const payload = data as { url?: unknown; reused?: unknown } | null;
    if (typeof payload?.url !== "string" || payload.url === "") {
      return { ok: false, reason: "provider" };
    }
    return { ok: true, url: payload.url, reused: payload.reused === true };
  } catch {
    return { ok: false, reason: "network" };
  }
}
