import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  centsToAmountString,
  decide,
  HANDLED_EVENTS,
  statusForOutcome,
  type DbOutcome,
  type StripeEventShape,
} from "../../../supabase/functions/stripe-webhook/event.ts";

/**
 * `stripe-webhook` (B2.3).
 *
 * WHAT THIS FILE TESTS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * It does **not** test that HMAC-SHA256 is computed correctly, that the
 * timestamp tolerance holds, or that two signatures are compared in constant
 * time. All of that is Stripe's SDK, and owning a test for it would mean
 * owning the code (ADR-0054). What is ours, and what is tested here, is
 * whether we call the SDK correctly and what we do with the result.
 *
 * The dangerous decisions are all in `decide()`:
 *
 *   - a completed checkout whose money has not arrived must not sell anything
 *   - a payment_intent object must never be matched against a `cs_` identity
 *   - metadata must not influence anything at all
 *   - an amount must survive the trip to PostgreSQL as an exact decimal
 */

/** A minimal, valid Checkout Session event. Override what a case is about. */
function event(
  type: string,
  session: Record<string, unknown> = {},
  extra: Partial<StripeEventShape> = {},
): StripeEventShape {
  return {
    id: "evt_test_0001",
    type,
    livemode: false,
    ...extra,
    data: {
      object: {
        id: "cs_test_a1b2c3d4e5f6",
        object: "checkout.session",
        status: "complete",
        payment_status: "paid",
        amount_total: 931,
        currency: "eur",
        ...session,
      },
    },
  };
}

// ---------------------------------------------------------------------------

describe("cents become an exact decimal string", () => {
  it("converts the ordinary cases", () => {
    expect(centsToAmountString(931)).toBe("9.31");
    expect(centsToAmountString(0)).toBe("0.00");
    expect(centsToAmountString(5)).toBe("0.05");
    expect(centsToAmountString(50)).toBe("0.50");
    expect(centsToAmountString(100)).toBe("1.00");
    expect(centsToAmountString(123456)).toBe("1234.56");
  });

  it("is the exact inverse of the create-payment direction", () => {
    // The two conversions bracket the whole payment: create-payment turns the
    // order into minor units for Stripe, this turns Stripe's answer back. If
    // they ever disagree, confirm_order_payment() sees an amount_mismatch on a
    // perfectly good order and flags it for a human.
    for (const amount of ["0.01", "9.31", "14.99", "1234.56", "0.99", "100.00"]) {
      const [whole, fraction] = amount.split(".");
      const cents = Number(whole) * 100 + Number(fraction);
      expect(centsToAmountString(cents), amount).toBe(amount);
    }
  });

  it("never produces a float artefact", () => {
    // 0.1 + 0.2 territory: the whole reason this is integer arithmetic and a
    // string rather than `(cents / 100).toFixed(2)` on a computed float.
    for (let cents = 0; cents <= 2000; cents++) {
      const text = centsToAmountString(cents);
      expect(text, String(cents)).toMatch(/^\d+\.\d{2}$/);
      const [whole, fraction] = text.split(".");
      expect(Number(whole) * 100 + Number(fraction), text).toBe(cents);
    }
  });

  it("refuses anything that is not an integer amount", () => {
    for (const bad of [9.31, Number.NaN, Number.POSITIVE_INFINITY, 1e20]) {
      expect(() => centsToAmountString(bad), String(bad)).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------

describe("completed only means paid when Stripe says paid", () => {
  it("confirms an immediate, paid checkout", () => {
    const decision = decide(event("checkout.session.completed"), false);
    expect(decision).toEqual({
      action: "confirm",
      sessionId: "cs_test_a1b2c3d4e5f6",
      amount: "9.31",
      currency: "eur",
      eventId: "evt_test_0001",
      eventType: "checkout.session.completed",
    });
  });

  it("does NOT confirm a completed checkout whose payment is still pending", () => {
    /*
     * The case that would sell goods for money that never arrives.
     *
     * With an asynchronous method Stripe fires `completed` with
     * `status: "complete"` and `payment_status: "unpaid"`. Acting on the event
     * type alone converts reservations and writes a sale movement.
     *
     * V1 disables these methods in the Stripe Dashboard, so this should not
     * fire at all — which is exactly why it is tested rather than assumed.
     */
    const decision = decide(
      event("checkout.session.completed", { payment_status: "unpaid" }),
      false,
    );
    expect(decision).toEqual({ action: "ignore", reason: "awaiting_async_payment" });
  });

  it("does not confirm a session that is not complete", () => {
    expect(decide(event("checkout.session.completed", { status: "open" }), false)).toEqual({
      action: "ignore",
      reason: "session_incomplete",
    });
  });

  it("does not confirm no_payment_required either", () => {
    // A zero-amount checkout is not something V1 can produce, and treating it
    // as paid would book a sale against no money at all.
    expect(
      decide(
        event("checkout.session.completed", { payment_status: "no_payment_required" }),
        false,
      ),
    ).toEqual({ action: "ignore", reason: "no_payment_required" });
  });

  it("refuses a session with no amount", () => {
    for (const missing of [{ amount_total: null }, { currency: null }, { currency: "" }]) {
      expect(decide(event("checkout.session.completed", missing), false)).toEqual({
        action: "ignore",
        reason: "no_amount",
      });
    }
  });
});

// ---------------------------------------------------------------------------

describe("async_payment_succeeded takes the same confirm path", () => {
  it("produces an identical decision apart from the event type", () => {
    // There is exactly one way for money to become stock. A second
    // confirmation path is how two code paths end up disagreeing about when an
    // order is paid.
    const completed = decide(event("checkout.session.completed"), false);
    const async = decide(event("checkout.session.async_payment_succeeded"), false);

    expect(async).toEqual({
      ...completed,
      eventType: "checkout.session.async_payment_succeeded",
    });
  });

  it("does not require status complete, because Stripe does not set it", () => {
    const decision = decide(
      event("checkout.session.async_payment_succeeded", { status: null }),
      false,
    );
    expect(decision.action).toBe("confirm");
  });
});

// ---------------------------------------------------------------------------

describe("expired and async_payment_failed close the attempt", () => {
  it("expires an attempt without touching the order", () => {
    expect(decide(event("checkout.session.expired", { status: "expired" }), false)).toEqual({
      action: "fail",
      status: "expired",
      unknownIsFinal: true,
      sessionId: "cs_test_a1b2c3d4e5f6",
      eventId: "evt_test_0001",
      eventType: "checkout.session.expired",
    });
  });

  it("fails an attempt after an async payment did not arrive", () => {
    expect(
      decide(event("checkout.session.async_payment_failed", { payment_status: "unpaid" }), false),
    ).toEqual({
      action: "fail",
      status: "failed",
      unknownIsFinal: false,
      sessionId: "cs_test_a1b2c3d4e5f6",
      eventId: "evt_test_0001",
      eventType: "checkout.session.async_payment_failed",
    });
  });

  it("never closes an attempt as succeeded", () => {
    // fail_payment_attempt() refuses anything outside failed/cancelled/expired,
    // but the type here makes it unrepresentable in the first place.
    for (const type of ["checkout.session.expired", "checkout.session.async_payment_failed"]) {
      const decision = decide(event(type), false);
      expect(decision.action).toBe("fail");
      if (decision.action === "fail") {
        expect(["expired", "failed"]).toContain(decision.status);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe("identity comes from the session id and nowhere else", () => {
  it("ignores metadata entirely", () => {
    /*
     * We wrote order_id and payment_attempt_id into the session ourselves.
     * Stripe stores and returns them without checking anything, so they are
     * our own echo — not evidence. An event claiming a different order must
     * change nothing about which attempt is matched.
     */
    const withMetadata = decide(
      event("checkout.session.completed", {
        metadata: { order_id: "99999", payment_attempt_id: "88888" },
      }),
      false,
    );
    const without = decide(event("checkout.session.completed"), false);
    expect(withMetadata).toEqual(without);
  });

  it("refuses an object that is not a checkout session", () => {
    // A payment_intent has no cs_ identity and must never be matched against
    // payment_attempts.provider_payment_id. This is why
    // payment_intent.payment_failed is not subscribed to at all.
    expect(
      decide(
        event("checkout.session.completed", { object: "payment_intent", id: "pi_test_123" }),
        false,
      ),
    ).toEqual({ action: "ignore", reason: "not_a_checkout_session" });
  });

  it("refuses a session id that does not look like one", () => {
    expect(
      decide(event("checkout.session.completed", { id: "sub_test_123" }), false),
    ).toEqual({ action: "ignore", reason: "not_a_checkout_session" });
  });

  it("refuses a malformed event", () => {
    expect(decide({ ...event("checkout.session.completed"), id: "" }, false).action).toBe("ignore");
    expect(
      decide({ ...event("checkout.session.completed"), data: { object: null } }, false),
    ).toEqual({ action: "ignore", reason: "malformed" });
  });
});

// ---------------------------------------------------------------------------

describe("the environment refuses the wrong world", () => {
  it("a test deployment ignores a live event", () => {
    expect(decide(event("checkout.session.completed", {}, { livemode: true }), false)).toEqual({
      action: "ignore",
      reason: "livemode_mismatch",
    });
  });

  it("a live deployment ignores a test event", () => {
    expect(decide(event("checkout.session.completed"), true)).toEqual({
      action: "ignore",
      reason: "livemode_mismatch",
    });
  });
});

// ---------------------------------------------------------------------------

describe("only four event types are acted on", () => {
  it("handles exactly the four V1 subscribes to", () => {
    expect([...HANDLED_EVENTS]).toEqual([
      "checkout.session.completed",
      "checkout.session.expired",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
    ]);
  });

  it("ignores everything else, payment_intent.payment_failed included", () => {
    // Deliberately not treated as a final checkout failure: a declined card is
    // not a dead checkout, and the customer may retry in the same session.
    for (const type of [
      "payment_intent.payment_failed",
      "payment_intent.succeeded",
      "charge.refunded",
      "checkout.session.async_payment_pending",
      "invoice.paid",
    ]) {
      expect(decide(event(type), false), type).toEqual({
        action: "ignore",
        reason: "not_a_handled_type",
      });
    }
  });
});

// ---------------------------------------------------------------------------

describe("the answer tells Stripe whether to retry", () => {
  it("retries only an unmatched payment", () => {
    expect(statusForOutcome("unknown_payment", false)).toBe(500);
  });

  it("does not retry an unmatched expiry", () => {
    // create-payment expires orphaned sessions at Stripe itself; their expiry
    // events legitimately match no attempt and there is nothing to wait for.
    expect(statusForOutcome("unknown_payment", true)).toBe(200);
  });

  it("treats every other outcome as finished", () => {
    const finished: DbOutcome[] = [
      "confirmed",
      "already_confirmed",
      "amount_mismatch",
      "late_payment_unresolved",
      "duplicate_event",
      "attempt_failed",
      "already_closed",
      "closed",
    ];
    for (const outcome of finished) {
      expect(statusForOutcome(outcome, false), outcome).toBe(200);
      expect(statusForOutcome(outcome, true), outcome).toBe(200);
    }
  });

  it("does not retry an amount mismatch", () => {
    // It is recorded, the attempt is closed and the order is flagged. A second
    // delivery would find `already_closed` and change nothing, so retrying
    // only produces noise on an order a human already has to look at.
    expect(statusForOutcome("amount_mismatch", false)).toBe(200);
  });
});

// ---------------------------------------------------------------------------

describe("the Edge Function calls the SDK the one correct way", () => {
  const entry = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");

  /**
   * The same file with comment lines removed.
   *
   * Prose may name `shop_inventory` — the header says in so many words that
   * this function never writes to it, and that sentence is worth keeping.
   * Code may not. `payment.test.ts` draws the line the same way.
   */
  const code = entry
    .split("\n")
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join("\n");

  it("uses the official SDK and no hand-written crypto", () => {
    expect(entry).toContain('import Stripe from "npm:stripe');
    expect(entry).toContain("constructEventAsync");
    // ADR-0054. Any of these appearing here means somebody rebuilt the
    // signature check by hand.
    expect(code).not.toMatch(/createHmac|subtle\.sign|subtle\.importKey|sha256/i);
  });

  it("passes the SubtleCrypto provider", () => {
    // The synchronous path reaches for Node's crypto and does not work in this
    // runtime. Omitting the provider is the classic way to ship a webhook that
    // rejects every delivery.
    expect(entry).toContain("Stripe.createSubtleCryptoProvider()");
  });

  it("verifies the RAW body, never a re-serialised one", () => {
    // Parsing first and re-serialising changes whitespace and key order, and
    // the signature is over the exact bytes Stripe sent.
    expect(entry).toContain("await req.text()");
    expect(entry).toContain("constructEventAsync(\n      rawBody,");
    expect(entry).not.toMatch(/JSON\.stringify\(\s*event/);
    // The body is never parsed before verification.
    const beforeVerify = entry.slice(0, entry.indexOf("constructEventAsync"));
    expect(beforeVerify).not.toContain("req.json()");
  });

  it("sends the amount as a string so PostgreSQL parses the exact decimal", () => {
    expect(entry).toContain("p_amount: decision.amount");
    // decision.amount is typed as string in event.ts; assert the contract here
    // so a later change to a number is caught.
    const decision = decide(event("checkout.session.completed"), false);
    expect(decision.action).toBe("confirm");
    if (decision.action === "confirm") expect(typeof decision.amount).toBe("string");
  });

  it("calls only the two database functions and mutates no stock itself", () => {
    expect(entry).toContain("confirm_order_payment");
    expect(entry).toContain("fail_payment_attempt");
    // The rule from 0012's header: nothing but those two may move stock.
    for (const forbidden of [
      "shop_inventory",
      "inventory_movements",
      "order_reservations",
      "convert_order_reservations",
      "release_expired_reservations",
      "start_payment_attempt",
      "attach_provider_payment",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("has no CORS surface at all", () => {
    // Stripe is not a browser. A CORS block here would imply a protection it
    // does not provide.
    expect(code).not.toContain("Access-Control-Allow");
    expect(code).not.toContain('req.method === "OPTIONS"');
  });

  it("fails closed without the webhook secret", () => {
    expect(entry).toContain("if (!WEBHOOK_SECRET)");
    expect(entry).toContain("not_configured");
  });

  it("carries no secret and no session id into a log line", () => {
    expect(entry).toContain("maskSession");
    /*
     * The VALUE, not the word.
     *
     * `console.error("stripe-webhook signature rejected:", ...)` is fine and
     * useful; `console.error(signature)` is not. So these look for the
     * identifier being passed or interpolated, which is what would actually
     * put a credential in a log line.
     */
    for (const secret of ["rawBody", "signature", "WEBHOOK_SECRET", "SERVICE_KEY"]) {
      const interpolated = new RegExp(`console\\.(log|error)\\([^)]*\\$\\{${secret}`);
      const passed = new RegExp(`console\\.(log|error)\\([^)]*,\\s*${secret}\\b`);
      expect(code, `${secret} interpolated`).not.toMatch(interpolated);
      expect(code, `${secret} passed`).not.toMatch(passed);
    }
  });

  it("holds no Stripe API key that could move money", () => {
    // The webhook needs no live key: the signed body is authoritative. Not
    // having one means this endpoint cannot charge, refund or expire anything.
    expect(code).not.toContain('Deno.env.get("STRIPE_SECRET_KEY")');
  });

  it("declares verify_jwt = false for the new function", () => {
    const config = readFileSync("supabase/config.toml", "utf8");
    expect(config).toContain("[functions.stripe-webhook]");
    const section = config.slice(config.indexOf("[functions.stripe-webhook]"));
    expect(section).toContain("verify_jwt = false");
  });
});
