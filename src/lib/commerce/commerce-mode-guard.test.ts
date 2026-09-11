import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  isCommerceMode,
  providerConfigProblem,
  stripeKeyMode,
} from "../../../supabase/functions/create-payment/session.ts";
import {
  expectedLivemode,
  livemodeConfigConflict,
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

describe("the outbound guard refuses every disagreement", () => {
  it("lets a sandbox run on a test key and a live shop on a live key", () => {
    expect(providerConfigProblem("sandbox", "sk_test_x")).toBeNull();
    expect(providerConfigProblem("live", "sk_live_x")).toBeNull();
    expect(providerConfigProblem("sandbox", "rk_test_x")).toBeNull();
  });

  /** The one that would charge a tester real money for a test purchase. */
  it("refuses a sandbox holding a live key", () => {
    expect(providerConfigProblem("sandbox", "sk_live_x")).toBe("stripe_key_is_live_but_mode_is_sandbox");
  });

  /** And the one that would take orders nobody ever paid for. */
  it("refuses a live shop holding a test key", () => {
    expect(providerConfigProblem("live", "sk_test_x")).toBe("stripe_key_is_test_but_mode_is_live");
  });

  it("refuses when commerce is closed, whatever the key says", () => {
    expect(providerConfigProblem("closed", "sk_test_x")).toBe("commerce_closed");
    expect(providerConfigProblem("closed", "sk_live_x")).toBe("commerce_closed");
  });

  it("refuses an unreadable mode, a missing key and an unreadable key", () => {
    expect(providerConfigProblem(null, "sk_test_x")).toBe("unknown_commerce_mode");
    expect(providerConfigProblem("SANDBOX", "sk_test_x")).toBe("unknown_commerce_mode");
    expect(providerConfigProblem("sandbox", undefined)).toBe("missing_stripe_key");
    expect(providerConfigProblem("sandbox", "")).toBe("missing_stripe_key");
    expect(providerConfigProblem("sandbox", "nonsense")).toBe("unrecognised_stripe_key");
  });

  it("has no input at all that it accepts by default", () => {
    // Every combination of a non-live mode with a live key, and vice versa,
    // must be a reason. Nothing falls through.
    for (const mode of ["closed", "sandbox", "live", "", "test", null, undefined, 7]) {
      for (const key of ["sk_test_x", "sk_live_x", "junk", "", undefined]) {
        const ok = providerConfigProblem(mode, key as string) === null;
        const shouldBeOk =
          (mode === "sandbox" && key === "sk_test_x") || (mode === "live" && key === "sk_live_x");
        expect(ok, `${String(mode)} / ${String(key)}`).toBe(shouldBeOk);
      }
    }
  });

  it("knows the three modes and nothing else", () => {
    expect(isCommerceMode("closed")).toBe(true);
    expect(isCommerceMode("sandbox")).toBe(true);
    expect(isCommerceMode("live")).toBe(true);
    expect(isCommerceMode("test")).toBe(false);
    expect(isCommerceMode(null)).toBe(false);
  });
});

describe("the inbound guard makes the deployment agree with itself", () => {
  it("only a live shop expects live events — closed included", () => {
    expect(expectedLivemode("live")).toBe(true);
    expect(expectedLivemode("sandbox")).toBe(false);
    expect(expectedLivemode("closed")).toBe(false);
    expect(expectedLivemode(null)).toBe(false);
  });

  it("passes when the endpoint and the database describe the same world", () => {
    expect(livemodeConfigConflict("live", true)).toBeNull();
    expect(livemodeConfigConflict("sandbox", false)).toBeNull();
    expect(livemodeConfigConflict("closed", false)).toBeNull();
  });

  it("refuses a live endpoint on a sandbox database, and the reverse", () => {
    expect(livemodeConfigConflict("sandbox", true)).toBe(
      "commerce_mode_sandbox_but_STRIPE_LIVEMODE_true",
    );
    expect(livemodeConfigConflict("live", false)).toBe("commerce_mode_live_but_STRIPE_LIVEMODE_false");
  });

  it("refuses a mode it cannot read", () => {
    expect(livemodeConfigConflict(null, false)).toContain("unknown_commerce_mode");
    expect(livemodeConfigConflict("Live", true)).toContain("unknown_commerce_mode");
  });
});

describe("the Edge Functions actually use their guards", () => {
  const CREATE_PAYMENT = readFileSync("supabase/functions/create-payment/index.ts", "utf8");
  const WEBHOOK = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");

  it("create-payment refuses before it reaches Stripe", () => {
    const check = CREATE_PAYMENT.indexOf("providerConfigProblem(");
    const stripe = CREATE_PAYMENT.indexOf("STRIPE_API");
    const fetchCall = CREATE_PAYMENT.indexOf("await fetch(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(fetchCall);
    expect(stripe).toBeGreaterThan(-1);
  });

  it("create-payment reads the mode from the database, not from an environment variable", () => {
    expect(CREATE_PAYMENT).toContain('rpc("commerce_mode")');
    // A second source of truth could drift from the one stamped on the order.
    expect(CREATE_PAYMENT).not.toContain('Deno.env.get("COMMERCE_MODE")');
  });

  it("create-payment tells the caller nothing about which key it holds", () => {
    const guard = CREATE_PAYMENT.slice(CREATE_PAYMENT.indexOf("const configProblem"));
    const refusal = guard.slice(0, guard.indexOf("\n  }"));
    expect(refusal).toContain("provider_unconfigured");
    // The reason goes to the log argument, never into the returned message.
    expect(refusal).not.toMatch(/message:\s*`/);
  });

  it("the webhook refuses every event while it disagrees with itself", () => {
    const check = WEBHOOK.indexOf("livemodeConfigConflict(");
    const decide = WEBHOOK.indexOf("decide(event, EXPECT_LIVEMODE)");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(decide);
  });

  it("the webhook keeps its own livemode check as well", () => {
    // Two independent locks on the same door: the endpoint's secret, and this.
    expect(WEBHOOK).toContain('Deno.env.get("STRIPE_LIVEMODE") === "true"');
  });

  it("a misconfigured webhook answers 503, so Stripe keeps the delivery", () => {
    const guard = WEBHOOK.slice(WEBHOOK.indexOf("const conflict ="));
    expect(guard.slice(0, 400)).toContain('respond(503, { error: "not_configured" })');
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
    });
  });

  it("keeps the reason when checkout is refused", () => {
    expect(readAccess({ may_checkout: false, reason: "testers_only" })).toEqual({
      mayCheckout: false,
      reason: "testers_only",
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

  it("the panel grants by user id and never by address", () => {
    expect(PANEL).toContain("setCommerceTester(userId");
    expect(PANEL).toContain("grant(match.userId");
    expect(PANEL).not.toMatch(/setCommerceTester\(\s*(match|tester)\.email/);
  });
});

describe("an unset STRIPE_LIVEMODE is a valid sandbox configuration", () => {
  const WEBHOOK = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");

  /**
   * The question the rollout plan hangs on: must a production-sandbox
   * deployment set `STRIPE_LIVEMODE=false` explicitly, or is leaving it unset
   * enough?
   *
   * The read is `Deno.env.get("STRIPE_LIVEMODE") === "true"`, which is a
   * boolean and never `undefined` — so "unset" and "false" are the same value
   * by construction, and there is no third state to fail closed on. The
   * asymmetry is deliberate and points the safe way: the ONLY input that ever
   * unlocks live-event processing is the literal string "true".
   */
  const readEnv = (raw: string | undefined): boolean => raw === "true";

  it("is read as a boolean, so unset cannot be a third state", () => {
    expect(WEBHOOK).toContain('Deno.env.get("STRIPE_LIVEMODE") === "true"');
    // Not `!== "false"`, which would make an unset variable mean live.
    expect(WEBHOOK).not.toContain('!== "false"');
  });

  it("unset, empty and explicit false all agree with sandbox and closed", () => {
    for (const raw of [undefined, "", "false"]) {
      for (const mode of ["sandbox", "closed"]) {
        expect(livemodeConfigConflict(mode, readEnv(raw)), `${mode} / ${String(raw)}`).toBeNull();
      }
    }
  });

  it("unset never lets a live event through", () => {
    expect(livemodeConfigConflict("live", readEnv(undefined))).toBe(
      "commerce_mode_live_but_STRIPE_LIVEMODE_false",
    );
  });

  /**
   * A mistyped value reads as false. For sandbox that is the intended state
   * anyway; for live it is an outage, not a money bug — every event is
   * refused with 503 and the log line names the cause. Pinned so the
   * asymmetry stays the safe way round.
   */
  it("only the exact string true unlocks live", () => {
    for (const raw of ["TRUE", "True", "1", "yes", " true", "true "]) {
      expect(readEnv(raw), raw).toBe(false);
      expect(livemodeConfigConflict("live", readEnv(raw)), raw).not.toBeNull();
    }
    expect(readEnv("true")).toBe(true);
    expect(livemodeConfigConflict("live", readEnv("true"))).toBeNull();
  });
});
