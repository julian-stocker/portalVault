import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  isCommerceMode,
  isPaymentMode,
  selectStripeKey,
  stripeKeyMode,
} from "../../../supabase/functions/create-payment/session.ts";
import {
  attemptWorldConflict,
  eventWorldConflict,
  expectedLivemode,
} from "../../../supabase/functions/stripe-webhook/event.ts";
import { CHECKOUT_CLOSED, readAccess } from "./access";
import {
  COMMERCE_CLOSED,
  isCommerceMode as isAdminCommerceMode,
  readAccountMatches,
  readCommerceState,
} from "@/lib/admin/commerce-model";

/**
 * The two doors Stripe money goes through, and what the interface is allowed
 * to believe about either of them.
 *
 * The rule underneath all of it: a sandbox must never be able to reach a live
 * key, and a live shop must never run on test keys. Every unclear answer is a
 * refusal — there is no branch anywhere below that shrugs and continues.
 */

describe("a Stripe key says which world it belongs to", () => {
  it("reads both shapes Stripe issues", () => {
    expect(stripeKeyMode("sk_test_abc")).toBe("test");
    expect(stripeKeyMode("rk_test_abc")).toBe("test");
    expect(stripeKeyMode("sk_live_abc")).toBe("live");
    expect(stripeKeyMode("rk_live_abc")).toBe("live");
  });

  it("calls anything else unknown rather than guessing", () => {
    for (const key of ["pk_test_abc", "sk_", "whsec_abc", "", " sk_live_abc", undefined, null]) {
      expect(stripeKeyMode(key as string), String(key)).toBe("unknown");
    }
  });
});

describe("the outbound key is chosen by the order's world, and never guessed", () => {
  const KEYS = { live: "sk_live_x", sandbox: "sk_test_x" };

  it("pays a live order with the live key and a sandbox order with the test key", () => {
    expect(selectStripeKey("live", KEYS)).toEqual({ key: "sk_live_x" });
    expect(selectStripeKey("sandbox", KEYS)).toEqual({ key: "sk_test_x" });
    expect(selectStripeKey("sandbox", { sandbox: "rk_test_x" })).toEqual({ key: "rk_test_x" });
  });

  /** The one that would charge a tester real money for a test purchase. */
  it("refuses a live key sitting in the sandbox slot", () => {
    expect(selectStripeKey("sandbox", { sandbox: "sk_live_x" })).toEqual({
      problem: "stripe_key_is_live_but_mode_is_sandbox",
    });
  });

  /** And the one that would take orders nobody ever paid for. */
  it("refuses a test key sitting in the live slot", () => {
    expect(selectStripeKey("live", { live: "sk_test_x" })).toEqual({
      problem: "stripe_key_is_test_but_mode_is_live",
    });
  });

  /**
   * FAIL CLOSED, IN BOTH DIRECTIONS, AND NEVER SIDEWAYS.
   *
   * A missing live key must not become a test charge and a missing test key
   * must not become a real one. The other world's key being present changes
   * nothing — this is the assertion that pins "no fallback".
   */
  it("never reaches for the other world's key when one is missing", () => {
    expect(selectStripeKey("live", { sandbox: "sk_test_x" })).toEqual({
      problem: "missing_stripe_key_for_live",
    });
    expect(selectStripeKey("sandbox", { live: "sk_live_x" })).toEqual({
      problem: "missing_stripe_key_for_sandbox",
    });
    expect(selectStripeKey("live", {})).toEqual({ problem: "missing_stripe_key_for_live" });
    expect(selectStripeKey("sandbox", {})).toEqual({ problem: "missing_stripe_key_for_sandbox" });
  });

  it("refuses a mode it cannot read, including the old closed", () => {
    for (const mode of [null, undefined, "", "closed", "CLOSED", "Live", "test", 7]) {
      const choice = selectStripeKey(mode, KEYS);
      expect(choice, String(mode)).toEqual({ problem: `unknown_payment_mode:${String(mode)}` });
    }
  });

  it("refuses a key whose world cannot be read", () => {
    expect(selectStripeKey("sandbox", { sandbox: "nonsense" })).toEqual({
      problem: "unrecognised_stripe_key_for_sandbox",
    });
  });

  it("has no input at all that it accepts by default", () => {
    for (const mode of ["closed", "sandbox", "live", "", "test", null, undefined, 7]) {
      for (const live of ["sk_live_x", "sk_test_x", "junk", "", undefined]) {
        for (const sandbox of ["sk_test_x", "sk_live_x", "junk", "", undefined]) {
          const choice = selectStripeKey(mode, { live, sandbox });
          const accepted = "key" in choice;
          const shouldAccept =
            (mode === "live" && live === "sk_live_x") ||
            (mode === "sandbox" && sandbox === "sk_test_x");
          expect(accepted, `${String(mode)} / ${String(live)} / ${String(sandbox)}`).toBe(
            shouldAccept,
          );
        }
      }
    }
  });

  it("knows two payment worlds, and `closed` is not one of them", () => {
    expect(isPaymentMode("live")).toBe(true);
    expect(isPaymentMode("sandbox")).toBe(true);
    expect(isPaymentMode("closed")).toBe(false);
    expect(isPaymentMode(null)).toBe(false);
  });

  it("still knows the three shop modes, which are a different question", () => {
    expect(isCommerceMode("closed")).toBe(true);
    expect(isCommerceMode("sandbox")).toBe(true);
    expect(isCommerceMode("live")).toBe(true);
    expect(isCommerceMode("test")).toBe(false);
    expect(isCommerceMode(null)).toBe(false);
  });
});

describe("the inbound world comes from the signature, corroborated twice", () => {
  it("maps a webhook world to the livemode flag it must carry", () => {
    expect(expectedLivemode("live")).toBe(true);
    expect(expectedLivemode("sandbox")).toBe(false);
  });

  it("accepts an event whose own flag agrees with the secret that verified it", () => {
    expect(eventWorldConflict(true, "live")).toBeNull();
    expect(eventWorldConflict(false, "sandbox")).toBeNull();
  });

  it("refuses a live event on a sandbox secret, and the reverse", () => {
    expect(eventWorldConflict(false, "live")).toBe("event_livemode_false_but_secret_is_live");
    expect(eventWorldConflict(true, "sandbox")).toBe("event_livemode_true_but_secret_is_sandbox");
  });

  it("refuses an event with no readable livemode rather than assuming one", () => {
    for (const raw of [undefined, null, "true", 1, ""]) {
      expect(eventWorldConflict(raw, "live"), String(raw)).toBe("event_without_livemode");
      expect(eventWorldConflict(raw, "sandbox"), String(raw)).toBe("event_without_livemode");
    }
  });

  /** The lock that keeps the two worlds from touching each other's orders. */
  it("refuses an event that names an order from the other world", () => {
    expect(attemptWorldConflict("live", "sandbox")).toBe("attempt_is_live_but_event_is_sandbox");
    expect(attemptWorldConflict("sandbox", "live")).toBe("attempt_is_sandbox_but_event_is_live");
  });

  it("lets an event act on an order from its own world", () => {
    expect(attemptWorldConflict("live", "live")).toBeNull();
    expect(attemptWorldConflict("sandbox", "sandbox")).toBeNull();
  });

  /**
   * No attempt matches. That is the ordinary `unknown_payment` case — an
   * expiry event for a session `create-payment` orphaned produces it
   * legitimately — so it must not become a refusal.
   */
  it("has no opinion when no attempt carries the payment id", () => {
    expect(attemptWorldConflict(null, "live")).toBeNull();
    expect(attemptWorldConflict(undefined, "sandbox")).toBeNull();
  });

  it("refuses an attempt whose world it cannot read", () => {
    expect(attemptWorldConflict("closed", "live")).toBe("attempt_is_closed_but_event_is_live");
    expect(attemptWorldConflict("", "sandbox")).toBe("attempt_is__but_event_is_sandbox");
  });
});

describe("the Edge Functions actually use their guards", () => {
  const CREATE_PAYMENT = readFileSync("supabase/functions/create-payment/index.ts", "utf8");
  const WEBHOOK = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");

  it("create-payment picks its key before it reaches Stripe", () => {
    const check = CREATE_PAYMENT.indexOf("selectStripeKey(");
    const fetchCall = CREATE_PAYMENT.indexOf("await fetch(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(fetchCall);
    expect(CREATE_PAYMENT.indexOf("STRIPE_API")).toBeGreaterThan(-1);
  });

  it("create-payment reads the world from the database, never from anywhere else", () => {
    expect(CREATE_PAYMENT).toContain('rpc("order_payment_mode"');
    // A second source of truth could drift from the one stamped on the order.
    expect(CREATE_PAYMENT).not.toContain('Deno.env.get("COMMERCE_MODE")');
    expect(CREATE_PAYMENT).not.toContain('Deno.env.get("STRIPE_LIVEMODE")');
  });

  it("create-payment holds both keys and mixes neither into the other", () => {
    expect(CREATE_PAYMENT).toContain('Deno.env.get("STRIPE_SECRET_KEY_LIVE")');
    expect(CREATE_PAYMENT).toContain('Deno.env.get("STRIPE_SECRET_KEY_SANDBOX")');
    // The single-key variable is gone: keeping it would be a third source of
    // truth that answers neither question.
    expect(CREATE_PAYMENT).not.toContain('Deno.env.get("STRIPE_SECRET_KEY")');
  });

  it("create-payment tells the caller nothing about which key it holds", () => {
    const guard = CREATE_PAYMENT.slice(CREATE_PAYMENT.indexOf("const choice = selectStripeKey"));
    const refusal = guard.slice(0, guard.indexOf("const stripeKey"));
    expect(refusal).toContain("provider_unconfigured");
    // The reason goes to the log argument, never into the returned message.
    expect(refusal).not.toMatch(/message:\s*`/);
  });

  it("the webhook derives its world from the verifying secret, not the environment", () => {
    expect(WEBHOOK).toContain('Deno.env.get("STRIPE_WEBHOOK_SECRET_LIVE")');
    expect(WEBHOOK).toContain('Deno.env.get("STRIPE_WEBHOOK_SECRET_SANDBOX")');
    expect(WEBHOOK).not.toContain('Deno.env.get("STRIPE_LIVEMODE")');
    expect(WEBHOOK).toContain("constructEventAsync");
  });

  it("the webhook checks both corroborating locks before it acts", () => {
    const worldCheck = WEBHOOK.indexOf("eventWorldConflict(");
    const attemptCheck = WEBHOOK.indexOf("attemptWorldConflict(");
    const decideAt = WEBHOOK.indexOf("decide(event,");
    const database = WEBHOOK.indexOf("await callDatabase(");
    expect(worldCheck).toBeGreaterThan(-1);
    expect(worldCheck).toBeLessThan(decideAt);
    expect(attemptCheck).toBeGreaterThan(-1);
    expect(attemptCheck).toBeLessThan(database);
  });

  it("a misconfigured webhook answers 503, so Stripe keeps the delivery", () => {
    const guard = WEBHOOK.slice(WEBHOOK.indexOf("const worldConflict ="));
    expect(guard.slice(0, 400)).toContain('respond(503, { error: "not_configured" })');
    const cross = WEBHOOK.slice(WEBHOOK.indexOf("const crossWorld ="));
    expect(cross.slice(0, 400)).toContain('respond(503, { error: "not_configured" })');
  });

  it("neither function holds a key of its own", () => {
    for (const source of [CREATE_PAYMENT, WEBHOOK]) {
      expect(source).not.toMatch(/sk_(test|live)_[A-Za-z0-9]/);
      expect(source).not.toMatch(/rk_(test|live)_[A-Za-z0-9]/);
    }
  });
});

describe("what the interface is allowed to believe", () => {
  it("reads a permitted checkout", () => {
    expect(readAccess({ may_checkout: true, reason: "open" })).toEqual({
      mayCheckout: true,
      reason: "open",
      isSandbox: false,
    });
  });

  /**
   * The flag that tells a tester no real money will move. Only a literal
   * `true` counts — a missing or malformed column must never make a live
   * checkout look like a test.
   */
  it("reads the sandbox flag, and only from a literal true", () => {
    expect(
      readAccess({ may_checkout: true, reason: "open", is_sandbox: true }).isSandbox,
    ).toBe(true);
    for (const raw of [undefined, null, "true", 1, "yes", {}]) {
      expect(
        readAccess({ may_checkout: true, reason: "open", is_sandbox: raw }).isSandbox,
        String(raw),
      ).toBe(false);
    }
  });

  it("keeps the reason when checkout is refused", () => {
    expect(readAccess({ may_checkout: false, reason: "testers_only" })).toEqual({
      mayCheckout: false,
      reason: "testers_only",
      isSandbox: false,
    });
  });

  it("treats anything it cannot read as closed", () => {
    for (const row of [null, undefined, {}, "yes", { may_checkout: "true" }, { reason: "open" }]) {
      expect(readAccess(row), JSON.stringify(row)).toEqual(CHECKOUT_CLOSED);
    }
  });

  it("never invents a permitted checkout from a stray truthy value", () => {
    expect(readAccess({ may_checkout: 1 }).mayCheckout).toBe(false);
    expect(readAccess({ may_checkout: "open" }).mayCheckout).toBe(false);
  });
});

describe("what the administrator is allowed to believe", () => {
  it("reads the state document", () => {
    const state = readCommerceState({
      mode: "sandbox",
      testers: [
        { user_id: "u-1", username: "ada", email: "ada@example.com", is_admin: true },
        { user_id: "u-2", username: null, email: null },
      ],
      orders_by_mode: { sandbox: 3, live: 0 },
    });
    expect(state.mode).toBe("sandbox");
    expect(state.testers.map((t) => t.userId)).toEqual(["u-1", "u-2"]);
    expect(state.testers[0].isAdmin).toBe(true);
    expect(state.testers[1].isAdmin).toBe(false);
    expect(state.ordersByMode).toEqual({ sandbox: 3, live: 0 });
  });

  it("drops a tester row with no account behind it", () => {
    const state = readCommerceState({ mode: "live", testers: [{ username: "ghost" }] });
    expect(state.testers).toEqual([]);
  });

  it("falls back to closed rather than to a guess", () => {
    for (const document of [null, {}, { mode: "open" }, { mode: null }, "sandbox"]) {
      expect(readCommerceState(document), JSON.stringify(document)).toEqual(COMMERCE_CLOSED);
    }
  });

  it("reads search results and drops anything without a user id", () => {
    const matches = readAccountMatches([
      { user_id: "u-1", username: "ada", email: "a@example.com", is_tester: true, is_admin: false },
      { username: "nobody" },
      null,
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      userId: "u-1",
      username: "ada",
      email: "a@example.com",
      isTester: true,
      isAdmin: false,
    });
  });

  it("knows the three modes", () => {
    expect(isAdminCommerceMode("sandbox")).toBe(true);
    expect(isAdminCommerceMode("open")).toBe(false);
  });
});

describe("the admin panel stays a client component", () => {
  const MODEL = readFileSync("src/lib/admin/commerce-model.ts", "utf8");
  const PANEL = readFileSync("src/components/admin/commerce-panel.tsx", "utf8");

  /**
   * The split exists because the build said so: a `"use client"` component
   * that imports a module reaching `@/lib/supabase/server` drags the server
   * client into the browser bundle. Same shape as inventory-model/inventory.
   */
  it("the model reaches no server module", () => {
    expect(MODEL).not.toContain("@/lib/supabase/server");
    expect(MODEL).not.toContain("@/lib/auth/admin");
    expect(MODEL).not.toContain('from "react"');
  });

  it("the panel imports the model, never the reader", () => {
    expect(PANEL).toContain('from "@/lib/admin/commerce-model"');
    expect(PANEL).not.toContain('from "@/lib/admin/commerce"');
  });

  it("the tester panel grants by user id and never by address", () => {
    /*
     * The invariant did not change; the file did. Since 0036 the tester list
     * lives in `TesterPanel` (ADR-0071), so this is asserted where the code
     * now is rather than dropped. An address may FIND an account; what is
     * granted is always the `user_id` of the row that was picked (ADR-0032).
     */
    const TESTER_PANEL = readFileSync("src/components/admin/tester-panel.tsx", "utf8");
    expect(TESTER_PANEL).toContain("setTester(userId");
    expect(TESTER_PANEL).toContain("setTesterPermission(userId");
    expect(TESTER_PANEL).toContain("membership(match.userId");
    expect(TESTER_PANEL).not.toMatch(/set(Tester|TesterPermission)\(\s*(match|tester)\.email/);
    // And the commerce panel no longer holds a second copy of the list.
    expect(PANEL).not.toContain("setCommerceTester");
  });
});

describe("no environment variable can unlock live payment any more", () => {
  const WEBHOOK = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
  const CREATE_PAYMENT = readFileSync("supabase/functions/create-payment/index.ts", "utf8");

  /**
   * `STRIPE_LIVEMODE` used to say which world a deployment belonged to. Since
   * 0077 a deployment belongs to both at once, so a single flag cannot answer
   * the question and its continued presence could only mislead. What decides
   * now is a Stripe endpoint secret, which no caller and no operator typo can
   * forge into the other world.
   */
  it("the flag is gone from both functions", () => {
    expect(WEBHOOK).not.toContain("STRIPE_LIVEMODE");
    expect(CREATE_PAYMENT).not.toContain("STRIPE_LIVEMODE");
  });

  it("a deployment with no secret at all refuses every delivery", () => {
    expect(WEBHOOK).toContain("ENDPOINT_SECRETS.some");
    const guard = WEBHOOK.slice(WEBHOOK.indexOf("ENDPOINT_SECRETS.some"));
    expect(guard.slice(0, 400)).toContain('respond(503, { error: "not_configured" })');
  });

  /**
   * A deployment holding only the sandbox secret is the state we sit in while
   * live payment is prepared: sandbox deliveries verify, live ones match no
   * configured secret and are rejected as an invalid signature.
   */
  it("an unconfigured world is skipped rather than defaulted", () => {
    expect(WEBHOOK).toContain("if (!secret) continue;");
  });
});
