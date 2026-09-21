import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { selectStripeKey } from "../../../supabase/functions/create-payment/session.ts";
import {
  attemptWorldConflict,
  eventWorldConflict,
} from "../../../supabase/functions/stripe-webhook/event.ts";

/**
 * THE MATRIX, AND THE ONE INVARIANT UNDER IT.
 *
 *   shop active   normal account   -> live
 *   shop active   tester           -> sandbox
 *   shop inactive normal account   -> no payment at all
 *   shop inactive tester           -> sandbox
 *
 * A tester is in the sandbox in BOTH rows they appear in. There is no switch,
 * parameter or code path that moves one to live — that is the property this
 * file exists to pin, and every other assertion here is in service of it.
 *
 * The rule itself lives in `payment_mode_for_user()` in migration 0077,
 * because the database is the only place both facts are known and the only
 * place a caller cannot reach around. What follows is a model of that
 * function plus the assertions that the SQL still says what the model says.
 */

const MIGRATION = readFileSync(
  "supabase/migrations/0077_payment_mode_per_caller.sql",
  "utf8",
);

/** Comments are prose about the rule, not the rule. */
const sqlCode = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const CODE = sqlCode(MIGRATION);

type ShopMode = "closed" | "sandbox" | "live";
type PaymentWorld = "live" | "sandbox" | null;

/**
 * The model of `payment_mode_for_user(uuid)`.
 *
 * `userId === null` is a guest: no account, therefore never a tester. The
 * tester branch is tested FIRST and returns unconditionally, which is the
 * whole invariant expressed as control flow.
 */
function paymentWorld(shop: ShopMode, isTester: boolean, userId: string | null): PaymentWorld {
  if (userId !== null && isTester) return "sandbox";
  if (shop === "live") return "live";
  return null;
}

const ACCOUNT = "11111111-1111-4111-8111-111111111111";

describe("the four cases of the matrix", () => {
  it("shop active, normal account -> live", () => {
    expect(paymentWorld("live", false, ACCOUNT)).toBe("live");
  });

  it("shop active, tester -> sandbox", () => {
    expect(paymentWorld("live", true, ACCOUNT)).toBe("sandbox");
  });

  it("shop inactive, normal account -> no payment", () => {
    expect(paymentWorld("closed", false, ACCOUNT)).toBeNull();
    expect(paymentWorld("sandbox", false, ACCOUNT)).toBeNull();
  });

  it("shop inactive, tester -> sandbox", () => {
    expect(paymentWorld("closed", true, ACCOUNT)).toBe("sandbox");
    expect(paymentWorld("sandbox", true, ACCOUNT)).toBe("sandbox");
  });
});

describe("the invariant, from every direction", () => {
  it("a tester never reaches live, under any shop mode", () => {
    for (const shop of ["closed", "sandbox", "live"] as const) {
      expect(paymentWorld(shop, true, ACCOUNT), shop).toBe("sandbox");
    }
  });

  it("a normal account never reaches sandbox, under any shop mode", () => {
    for (const shop of ["closed", "sandbox", "live"] as const) {
      expect(paymentWorld(shop, false, ACCOUNT), shop).not.toBe("sandbox");
    }
  });

  it("a guest is never a tester, so sandbox checkout stays closed to them", () => {
    for (const shop of ["closed", "sandbox", "live"] as const) {
      expect(paymentWorld(shop, true, null), shop).not.toBe("sandbox");
    }
    expect(paymentWorld("live", true, null)).toBe("live");
    expect(paymentWorld("closed", true, null)).toBeNull();
  });

  it("exhaustively: sandbox happens for testers and nobody else", () => {
    for (const shop of ["closed", "sandbox", "live"] as const) {
      for (const tester of [true, false]) {
        for (const user of [ACCOUNT, null]) {
          const world = paymentWorld(shop, tester, user);
          expect(world === "sandbox", `${shop}/${tester}/${String(user)}`).toBe(
            tester && user !== null,
          );
        }
      }
    }
  });
});

describe("the shop switch steers normal accounts only", () => {
  it("blocks a normal checkout while the shop is not live", () => {
    expect(paymentWorld("closed", false, ACCOUNT)).toBeNull();
    expect(paymentWorld("sandbox", false, ACCOUNT)).toBeNull();
  });

  it("does not block a tester while the shop is not live", () => {
    expect(paymentWorld("closed", true, ACCOUNT)).toBe("sandbox");
  });

  /**
   * The reason the whole change exists: production can be tested end to end
   * with test accounts while real customers cannot pay yet.
   */
  it("lets testers run a full checkout on a shop that is off for customers", () => {
    const shop: ShopMode = "closed";
    expect(paymentWorld(shop, true, ACCOUNT)).toBe("sandbox");
    expect(paymentWorld(shop, false, ACCOUNT)).toBeNull();
  });
});

describe("the SQL implements the model, not just the comments", () => {
  it("the tester branch comes first and is unconditional", () => {
    const fn = CODE.slice(
      CODE.indexOf("create or replace function public.payment_mode_for_user"),
    ).split("$$;")[0];
    const tester = fn.indexOf("is_commerce_tester_for");
    const live = fn.indexOf("commerce_mode() = 'live'");
    expect(tester).toBeGreaterThan(-1);
    expect(live).toBeGreaterThan(-1);
    // Tester first: a `case` returns on the first match, so order IS the rule.
    expect(tester).toBeLessThan(live);
    // And the tester branch yields sandbox, with nothing else in between.
    expect(fn.slice(tester, live)).toContain("'sandbox'");
    expect(fn.slice(tester, live)).not.toContain("'live'");
  });

  it("only `live` opens the non-tester branch", () => {
    const fn = CODE.slice(
      CODE.indexOf("create or replace function public.payment_mode_for_user"),
    ).split("$$;")[0];
    expect(fn).toContain("public.commerce_mode() = 'live'");
    // Not `<> 'closed'`, which would let the sandbox shop mode pay for real.
    expect(fn).not.toContain("<> 'closed'");
    expect(fn).toContain("else null");
  });

  /**
   * Found by running the matrix against Staging: `NULL = 'sandbox'` is NULL,
   * not false, so a `boolean` column answered NULL for every caller with no
   * payment world. The reader demands a literal `true` and was never fooled,
   * but a declared boolean that is sometimes NULL is a trap for the next one.
   */
  it("is_sandbox is a real boolean, never NULL", () => {
    const fn = CODE.slice(CODE.indexOf("create or replace function public.commerce_access")).split(
      "$$;",
    )[0];
    expect(fn).toContain("coalesce(public.effective_payment_mode() = 'sandbox', false)");
  });

  it("every gate asks the one rule rather than re-deriving it", () => {
    for (const fn of [
      "public.effective_payment_mode",
      "public.commerce_checkout_allowed",
      "public.commerce_access",
      "public.orders_stamp_payment_mode",
      "public.authorize_order_payment",
      "public.order_payment_mode",
    ]) {
      expect(CODE, fn).toContain(`create or replace function ${fn}`);
    }
    // The gate is the rule, not a copy of it.
    expect(CODE).toContain("public.effective_payment_mode() is not null");
  });
});

describe("the client cannot choose a world", () => {
  const CREATE_PAYMENT = readFileSync("supabase/functions/create-payment/index.ts", "utf8");
  const SESSION = readFileSync("supabase/functions/create-payment/session.ts", "utf8");

  /**
   * The request body is parsed into exactly two fields. A `mode` that arrived
   * in the body would have to be read somewhere, and there is nowhere.
   */
  it("the request parser accepts an order id and a token, and nothing else", () => {
    const parser = SESSION.slice(SESSION.indexOf("export function parsePaymentRequest"));
    const body = parser.slice(0, parser.indexOf("\n}"));
    expect(body).toContain("raw.order_id");
    expect(body).toContain("raw.payment_token");
    for (const field of ["mode", "livemode", "commerce_mode", "sandbox", "stripe"]) {
      expect(body.toLowerCase(), field).not.toContain(`raw.${field}`);
    }
  });

  it("the world is read from the database, keyed only by the order id", () => {
    expect(CREATE_PAYMENT).toContain('rpc("order_payment_mode", { p_order_id: orderId })');
  });

  /**
   * The stamp on the order is written by a trigger, so it is not even the
   * INSERT's to choose — `create_order()` could pass anything and the row
   * would still carry what the rule says.
   */
  it("the order's world is stamped by a trigger that overwrites the row", () => {
    expect(CODE).toContain("new.commerce_mode := v_mode");
    expect(CODE).toContain("before insert on public.orders");
    expect(CODE).toContain("orders_stamp_payment_mode_trg");
  });

  it("an account with no world cannot produce an order at all", () => {
    const trigger = CODE.slice(CODE.indexOf("create or replace function public.orders_stamp_payment_mode"));
    expect(trigger.slice(0, trigger.indexOf("$$;"))).toContain("raise exception");
  });
});

describe("missing credentials fail closed, and never sideways", () => {
  it("a missing live key does not become a test charge", () => {
    expect(selectStripeKey("live", { sandbox: "sk_test_x" })).toEqual({
      problem: "missing_stripe_key_for_live",
    });
  });

  it("a missing sandbox key does not become a real charge", () => {
    expect(selectStripeKey("sandbox", { live: "sk_live_x" })).toEqual({
      problem: "missing_stripe_key_for_sandbox",
    });
  });

  it("no world at all is a refusal, not a default", () => {
    expect(selectStripeKey(null, { live: "sk_live_x", sandbox: "sk_test_x" })).toEqual({
      problem: "unknown_payment_mode:null",
    });
  });

  /**
   * `order_payment_mode()` answers NULL for an order it will not vouch for,
   * and NULL is exactly the input that `selectStripeKey` refuses. The two
   * halves meet here.
   */
  it("an order the database will not vouch for cannot be paid", () => {
    expect("problem" in selectStripeKey(undefined, { sandbox: "sk_test_x" })).toBe(true);
  });
});

describe("sandbox and live webhooks are isolated from each other", () => {
  it("an event may not act on an order from the other world", () => {
    expect(attemptWorldConflict("live", "sandbox")).not.toBeNull();
    expect(attemptWorldConflict("sandbox", "live")).not.toBeNull();
  });

  it("the event's own signed flag has to agree with the secret too", () => {
    expect(eventWorldConflict(true, "sandbox")).not.toBeNull();
    expect(eventWorldConflict(false, "live")).not.toBeNull();
  });

  it("the database can name the world of any provider payment", () => {
    expect(CODE).toContain("create or replace function public.payment_attempt_mode");
    const fn = CODE.slice(CODE.indexOf("create or replace function public.payment_attempt_mode"));
    const body = fn.slice(0, fn.indexOf("$$;"));
    expect(body).toContain("public.payment_attempts");
    expect(body).toContain("o.commerce_mode");
  });
});

describe("an order keeps the world it was placed in", () => {
  /**
   * The stamp is never rewritten — `orders_protect_immutable()` from 0021
   * already refuses a changed `commerce_mode`, and 0077 adds no path that
   * would. What 0077 changes is what the stamp is COMPARED against.
   */
  it("0077 writes the stamp only on insert, never on update", () => {
    expect(CODE).toContain("before insert on public.orders");
    expect(CODE).not.toContain("before insert or update on public.orders");
    expect(CODE).not.toContain("update public.orders");
  });

  /**
   * A sandbox order belonging to somebody who is not a tester is exactly the
   * historical case: every order placed before this change carries `sandbox`.
   * Once the shop goes live the rule says `live` for those owners, the stamp
   * still says `sandbox`, and the comparison refuses. An old test order can
   * therefore never be completed with real money.
   */
  it("an old sandbox order does not become payable when the shop goes live", () => {
    const stamped = "sandbox";
    const nowEntitledTo = paymentWorld("live", false, ACCOUNT);
    expect(nowEntitledTo).toBe("live");
    expect(stamped === nowEntitledTo).toBe(false);
  });

  it("a tester's sandbox order stays payable after the shop goes live", () => {
    const stamped = "sandbox";
    expect(paymentWorld("live", true, ACCOUNT)).toBe(stamped);
  });

  it("the comparison is against the owner's entitlement, not the shop switch", () => {
    for (const fn of ["public.authorize_order_payment", "public.order_payment_mode"]) {
      const body = CODE.slice(CODE.indexOf(`create or replace function ${fn}`)).split("$$;")[0];
      expect(body, fn).toContain("public.payment_mode_for_user(o.user_id)");
    }
    const attempt = CODE.slice(
      CODE.indexOf("create or replace function public.start_payment_attempt"),
    ).split("$$;")[0];
    expect(attempt).toContain("public.payment_mode_for_user(v_order.user_id)");
    expect(attempt).not.toContain("is distinct from public.commerce_mode()");
  });
});

describe("start_payment_attempt was patched, not retyped", () => {
  /**
   * 112 lines were carried over from 0021 so that one comparison could
   * change. Retyping them is how a refusal goes missing — this re-does the
   * extraction and the substitution and insists the result matches, so any
   * other drift fails here rather than in production.
   */
  const ORIGINAL = readFileSync("supabase/migrations/0021_commerce_mode.sql", "utf8");

  const extract = (source: string): string => {
    const start = source.indexOf(
      "create or replace function public.start_payment_attempt",
    );
    const end = source.indexOf("\n$$;", start);
    return source.slice(start, end);
  };

  it("differs from 0021 in the mode comparison and nowhere else", () => {
    const before = extract(ORIGINAL);
    const after = extract(MIGRATION);
    expect(before).toContain("v_order.commerce_mode is distinct from public.commerce_mode()");
    expect(after).toContain(
      "v_order.commerce_mode is distinct from public.payment_mode_for_user(v_order.user_id)",
    );

    // Strip comments from both, then neutralise the one intended change.
    const normalise = (sql: string): string =>
      sqlCode(sql)
        .replace(
          /v_order\.commerce_mode is distinct from public\.(commerce_mode\(\)|payment_mode_for_user\(v_order\.user_id\))/,
          "@@MODE_CHECK@@",
        )
        .replace(/\s+/g, " ")
        .trim();

    expect(normalise(after)).toBe(normalise(before));
  });

  it("still carries every refusal it had", () => {
    const after = extract(MIGRATION);
    for (const refusal of [
      "no such order",
      "and cannot be paid",
      "needs to be looked at before it can be paid",
      "was placed in a different commerce mode",
      "the hold on order",
    ]) {
      expect(after, refusal).toContain(refusal);
    }
    // And still opens exactly one attempt, under the same lock.
    expect(after).toContain("for update");
    expect(after).toContain("insert into public.payment_attempts");
  });
});
