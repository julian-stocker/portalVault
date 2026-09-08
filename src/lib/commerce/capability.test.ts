import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  isPaymentToken,
  newCheckoutCredentials,
  newPaymentToken,
  newRequestId,
} from "@/lib/commerce/capability";

/**
 * The guest payment capability (B2.2a, migration 0013).
 *
 * A guest has no session, so the order carries a secret instead. What these
 * tests protect is narrow and expensive to lose: that the secret is random,
 * that only its hash is ever stored, that nothing guessable can stand in for
 * it, and that it never travels anywhere it could be written down.
 */
const MIGRATION = "supabase/migrations/0013_guest_payment_capability.sql";
const sql = readFileSync(MIGRATION, "utf8");

const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

function fn(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} is missing`).toBeGreaterThan(-1);
  const open = code.indexOf("as $$", start);
  return code.slice(open, code.indexOf("$$;", open));
}

function source(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("{/*");
    })
    .join("\n");
}

describe("the token itself", () => {
  it("is 256 bits, as 64 hex characters", () => {
    const token = newPaymentToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toHaveLength(64);
  });

  it("uses the platform's cryptographic generator, not Math.random", () => {
    const file = source("src/lib/commerce/capability.ts");
    expect(file).toContain("crypto.getRandomValues");
    expect(file).not.toContain("Math.random");
  });

  it("is different every time, across many draws", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newPaymentToken()));
    expect(seen.size).toBe(500);
  });

  it("looks random rather than patterned", () => {
    // A crude but real check: 500 tokens should exercise every hex digit and
    // land near an even distribution. A constant or a counter would not.
    const all = Array.from({ length: 500 }, () => newPaymentToken()).join("");
    const counts = new Map<string, number>();
    for (const ch of all) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(16);
    const expected = all.length / 16;
    for (const [digit, n] of counts) {
      expect(Math.abs(n - expected) / expected, `digit ${digit} is skewed`).toBeLessThan(0.2);
    }
  });

  it("is recognised, and nothing else is", () => {
    expect(isPaymentToken(newPaymentToken())).toBe(true);
    for (const wrong of ["", "abc", "z".repeat(64), "A".repeat(64), null, 42, undefined]) {
      expect(isPaymentToken(wrong)).toBe(false);
    }
  });

  it("is not the request id", () => {
    // Different rules: a request id may be logged, a capability may not.
    const { requestId, paymentToken } = newCheckoutCredentials();
    expect(requestId).not.toBe(paymentToken);
    expect(newRequestId()).not.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("only the hash is ever stored", () => {
  it("stores a SHA-256 digest, in a column shaped like one", () => {
    expect(code).toContain("add column if not exists payment_token_hash text");
    expect(code).toContain("check (payment_token_hash is null or payment_token_hash ~ '^[0-9a-f]{64}$')");
  });

  it("hashes the token and never writes the plaintext", () => {
    const create = fn("create_order");
    expect(create).toContain("v_token_hash := encode(sha256(convert_to(p_payment_token, 'utf8')), 'hex');");
    // The column is only ever fed the hash variable.
    expect(create).toContain("payment_token_hash)");
    expect(create).not.toMatch(/payment_token_hash\s*=\s*p_payment_token/);
    expect(create).not.toMatch(/values[\s\S]{0,400}p_payment_token\b(?![^)]*sha256)/);
  });

  it("uses nothing reversible", () => {
    expect(code).not.toMatch(/encrypt|pgp_|cipher|decode\(/i);
  });

  it("does not derive the token from anything already known", () => {
    // A token derived from the order number or the request id would be as
    // guessable as they are.
    const create = fn("create_order");
    expect(create).not.toMatch(/sha256\(convert_to\(p_request_id/);
    expect(create).not.toMatch(/sha256\(convert_to\(v_number/);
  });

  it("is written once and can never be replaced", () => {
    const trigger = fn("orders_protect_immutable");
    expect(trigger).toContain("old.payment_token_hash is not null");
    expect(trigger).toContain("the payment capability is issued once and cannot be replaced");
  });

  it("leaves orders placed before B2.2a valid", () => {
    // Additive and nullable: existing rows keep NULL, which simply means no
    // capability was issued.
    expect(code).toContain("add column if not exists payment_token_hash text;");
    expect(code).not.toMatch(/payment_token_hash text not null/);
  });
});

describe("what may authorise a payment", () => {
  const auth = fn("authorize_order_payment");

  it("accepts the signed-in owner", () => {
    expect(auth).toContain("p_user_id is not null and o.user_id = p_user_id");
  });

  it("accepts the holder of the capability", () => {
    expect(auth).toContain("o.payment_token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')");
  });

  it("refuses an empty or absent token", () => {
    expect(auth).toContain("p_token is not null");
    expect(auth).toContain("p_token <> ''");
    expect(auth).toContain("o.payment_token_hash is not null");
  });

  it("accepts nothing guessable", () => {
    // The order number, the id, the email, the fingerprint and the request id
    // are each either public, sequential, or both.
    for (const forbidden of ["order_number", "customer_email", "client_hash", "request_id"]) {
      expect(auth, `${forbidden} must not authorise`).not.toContain(forbidden);
    }
    // The order id only ever selects the row; it never grants anything.
    expect(auth).toContain("o.id = p_order_id");
  });

  it("is callable by no client role", () => {
    expect(code).toContain(
      "revoke all on function public.authorize_order_payment(bigint, uuid, text)\n  from public, anon, authenticated;",
    );
    expect(code).not.toMatch(/grant execute on function public\.authorize_order_payment/);
  });

  it("is a definer with a pinned search_path", () => {
    const head = code.slice(
      code.indexOf("create or replace function public.authorize_order_payment("),
      code.indexOf("as $$", code.indexOf("create or replace function public.authorize_order_payment(")),
    );
    expect(head).toContain("security definer");
    expect(head).toContain("set search_path = ''");
  });
});

describe("a lost response cannot destroy the capability", () => {
  const create = fn("create_order");

  it("never returns the token", () => {
    const returns = code.slice(
      code.indexOf("returns table (", code.indexOf("create or replace function public.create_order(")),
      code.indexOf("language plpgsql", code.indexOf("create or replace function public.create_order(")),
    );
    expect(returns).not.toMatch(/token|capability|secret/i);
    expect(returns).toContain("order_number");
  });

  it("requires the caller to bring one", () => {
    expect(create).toContain("if p_payment_token is null or length(p_payment_token) < 32 then");
    expect(create).toContain("a checkout needs a payment capability");
  });

  it("turns the retry into a proof rather than a re-issue", () => {
    // The whole design: a repeated request id hands the order back only to a
    // caller presenting the same capability.
    expect(create).toContain("if v_existing.payment_token_hash is distinct from v_token_hash then");
    expect(create).toContain("this checkout belongs to somebody else");
    expect(create).toContain("using errcode = 'insufficient_privilege'");
  });

  it("re-issues nothing on that path", () => {
    const retry = create.slice(create.indexOf("if found then"), create.indexOf("return next;\n    return;"));
    expect(retry).not.toContain("update public.orders");
    expect(retry).not.toContain("gen_random");
  });

  it("keeps the client's identifiers stable across retries", () => {
    const view = source("src/components/checkout/checkout-view.tsx");
    expect(view).toContain("const credentials = useRef<CheckoutCredentials | null>(null);");
    expect(view).toContain("if (credentials.current === null) credentials.current = newCheckoutCredentials();");
    // Not state: a re-render must not mint new ones.
    expect(view).not.toContain("useState<CheckoutCredentials");
  });

  it("no longer lets the server invent a request id per call", () => {
    // The B1 bug this replaces: placeOrder minted a fresh uuid on every call,
    // so a retry created a second order and held a second lot of stock.
    const action = source("src/lib/commerce/actions.ts");
    expect(action).not.toContain("randomUUID()");
    expect(action).toContain("p_request_id: credentials.requestId");
  });
});

describe("the token goes nowhere it could be written down", () => {
  const files = [
    "src/lib/commerce/actions.ts",
    "src/lib/commerce/order.ts",
    "src/components/checkout/checkout-view.tsx",
  ];

  it("is never logged", () => {
    for (const path of files) {
      const file = source(path);
      expect(file, `${path} logs`).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });

  it("never reaches a URL, a query string or a route", () => {
    for (const path of files) {
      const file = source(path);
      expect(file).not.toMatch(/paymentToken[^)\n]*(?:href|url|searchParams|pathname|redirect)/i);
      expect(file).not.toMatch(/[?&](token|t)=/);
    }
  });

  it("is never written to an order or payment event", () => {
    expect(fn("create_order")).not.toMatch(/order_events[\s\S]{0,200}p_payment_token/);
    expect(code).not.toMatch(/payload[\s\S]{0,120}token/i);
  });

  it("is not rendered into the page", () => {
    const view = source("src/components/checkout/checkout-view.tsx");
    expect(view).not.toMatch(/\{credentials\.current\.paymentToken\}/);
    expect(view).not.toMatch(/value=\{credentials/);
  });

  it("does not survive in browser storage yet", () => {
    // Deliberate for B2.2a: memory only. Surviving a reload belongs to guest
    // order access, which arrives with the confirmation mail.
    const view = source("src/components/checkout/checkout-view.tsx");
    expect(view).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("the migration stays additive and opens nothing", () => {
  it("adds one column and creates no table", () => {
    expect(code).not.toMatch(/create table/i);
    expect((code.match(/add column if not exists/g) ?? [])).toHaveLength(1);
  });

  it("drops no function at all", () => {
    // Dropping the old signature would break every checkout for the length of
    // a deployment; see the coexistence tests below.
    expect(code).not.toMatch(/drop function/);
  });

  it("re-grants create_order with its new signature and nothing else", () => {
    const granted = [...code.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to ([^;]+);/g)]
      .filter(([, , roles]) => /anon|authenticated/.test(roles))
      .map(([, name]) => name);
    expect(granted).toEqual(["create_order"]);
    expect(code).toContain(
      "grant execute on function public.create_order(text, text, jsonb, jsonb, text, text) to anon, authenticated;",
    );
  });

  it("touches no payment-core function", () => {
    for (const core of [
      "confirm_order_payment", "start_payment_attempt", "attach_provider_payment",
      "fail_payment_attempt", "expire_stale_checkouts",
    ]) {
      expect(code).not.toContain(`create or replace function public.${core}(`);
    }
  });

  it("introduces no Stripe, no secret and no scheduler", () => {
    expect(code.toLowerCase()).not.toMatch(/stripe|webhook|pg_cron|cron\.schedule|secret/);
  });
});

describe("both signatures coexist across the deployment", () => {
  const legacy = readFileSync("supabase/migrations/0011_checkout_shipping_and_tax.sql", "utf8");

  it("leaves the five-argument version exactly as 0011 defined it", () => {
    // Untouched, not redefined: no chance of the shim drifting from what is
    // actually running in production right now.
    expect(code).not.toContain("create or replace function public.create_order(\n  p_request_id      text,\n  p_email           text,\n  p_items           jsonb,\n  p_address         jsonb,\n  p_shipping_method text\n)");
    expect(legacy).toContain("create or replace function public.create_order(");
    expect(legacy).toContain("grant execute on function public.create_order(text, text, jsonb, jsonb, text) to anon, authenticated;");
  });

  it("adds the six-argument version alongside it", () => {
    expect(code).toContain("p_shipping_method text,\n  p_payment_token   text\n)");
    expect(code).toContain(
      "grant execute on function public.create_order(text, text, jsonb, jsonb, text, text) to anon, authenticated;",
    );
  });

  it("gives the new argument NO default, so neither call is ambiguous", () => {
    /*
     * The decisive detail. With a default on `p_payment_token`, a five-name
     * call would match both functions and PostgREST would refuse it as
     * ambiguous rather than choose. Without one, each set of argument names
     * resolves to exactly one function.
     */
    const signature = code.slice(
      code.indexOf("create or replace function public.create_order("),
      code.indexOf("returns table (", code.indexOf("create or replace function public.create_order(")),
    );
    expect(signature).toContain("p_payment_token   text");
    expect(signature).not.toMatch(/p_payment_token[^,)]*default/i);
    expect(signature).not.toMatch(/default/i);
  });

  it("marks the old one as temporary in the database itself", () => {
    expect(code).toContain("comment on function public.create_order(text, text, jsonb, jsonb, text) is");
    expect(code).toContain("TEMPORARY compatibility shim");
  });

  it("invents no capability for an order placed the old way", () => {
    // 0011's INSERT never mentions the column, so it stays NULL. A
    // server-minted hash whose plaintext nobody holds would only look like a
    // capability.
    const insert = legacy.slice(
      legacy.indexOf("insert into public.orders"),
      legacy.indexOf("returning id, orders.order_number"),
    );
    expect(insert).not.toContain("payment_token_hash");
    expect(code).not.toMatch(/create_order\(text, text, jsonb, jsonb, text\)[\s\S]{0,200}sha256/);
  });

  it("means a legacy order can never be paid by guest capability", () => {
    // authorize_order_payment() requires a non-null hash for the token path.
    expect(fn("authorize_order_payment")).toContain("o.payment_token_hash is not null");
  });

  it("leaves the signed-in owner path working for those orders", () => {
    expect(fn("authorize_order_payment")).toContain("p_user_id is not null and o.user_id = p_user_id");
  });

  it("can be removed later by dropping exactly one signature", () => {
    // The cleanup is unambiguous because the two differ in arity.
    expect(code).toContain("create_order(text, text, jsonb, jsonb, text, text)");
    expect(legacy).toContain("create_order(text, text, jsonb, jsonb, text)");
  });
});

describe("the new client uses the new signature", () => {
  it("always sends a payment token", () => {
    const action = source("src/lib/commerce/actions.ts");
    expect(action).toContain("p_payment_token: credentials.paymentToken");
    // And refuses to call at all without a well-formed one.
    expect(action).toContain("isPaymentToken(credentials.paymentToken)");
  });

  it("never falls back to the five-argument call", () => {
    const action = source("src/lib/commerce/actions.ts");
    const call = action.slice(action.indexOf('supabase.rpc("create_order"'));
    expect(call).toContain("p_payment_token");
  });
});

