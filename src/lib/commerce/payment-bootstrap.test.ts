import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Payment bootstrap and the corrected lifecycle (B2.2b, migration 0015).
 *
 * Like `payment.test.ts`, these are contract tests against the SQL. The
 * migration is not applied anywhere and nothing here executes it.
 *
 * The one they exist for is the first block: a late payment on an attempt
 * that was already locally expired used to roll the whole transaction back,
 * so the money arrived and the database never recorded it. That defect was
 * invisible in TypeScript and reachable only through a specific interleaving,
 * which is exactly the kind of thing a source contract can hold in place.
 */
const MIGRATION = "supabase/migrations/0015_payment_bootstrap.sql";
const CORE = "supabase/migrations/0012_payment_core.sql";

const sql = readFileSync(MIGRATION, "utf8");
const coreSql = readFileSync(CORE, "utf8");

function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const code = stripComments(sql);
const coreCode = stripComments(coreSql);

/** The migration with `comment on … is '…'` removed: prose, not code. */
const statements = code.replace(/comment on [\s\S]*?';/g, "");

function bodyIn(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} is missing`).toBeGreaterThan(-1);
  const open = source.indexOf("as $$", start);
  return source.slice(open, source.indexOf("$$;", open));
}

function headIn(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} is missing`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("as $$", start));
}

const fn = (name: string) => bodyIn(code, name);
const fnHead = (name: string) => headIn(code, name);

/** The four functions this migration is allowed to define. */
const DEFINED = [
  "amount_to_cents",
  "payment_attempts_protect",
  "pending_payment_expiries",
  "start_payment_attempt",
];

// ---------------------------------------------------------------------------

describe("the migration does only what it says", () => {
  it("creates no table and alters none", () => {
    expect(code).not.toMatch(/create table/);
    expect(code).not.toMatch(/alter table/);
  });

  it("adds no column, index, trigger or constraint", () => {
    expect(code).not.toMatch(/create (unique )?index/);
    expect(code).not.toMatch(/create trigger/);
    expect(code).not.toMatch(/add constraint/);
  });

  it("defines exactly the four functions it documents", () => {
    const defined = [...code.matchAll(/create or replace function public\.(\w+)\(/g)]
      .map((m) => m[1])
      .sort();
    expect(defined).toEqual(DEFINED);
  });

  it("drops exactly one function, and only because its return type widened", () => {
    const drops = [...code.matchAll(/drop function[^;]*;/g)].map((m) => m[0]);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toContain("public.start_payment_attempt(bigint, text)");
  });

  it("leaves the rest of the commerce core alone", () => {
    for (const untouched of [
      "confirm_order_payment",
      "fail_payment_attempt",
      "attach_provider_payment",
      "expire_stale_checkouts",
      "release_expired_reservations",
      "release_order_reservations",
      "convert_order_reservations",
      "reserve_for_order",
      "create_order",
      "orders_protect_immutable",
    ]) {
      expect(code, `${untouched} must not be redefined`).not.toContain(
        `function public.${untouched}(`,
      );
    }
  });

  it("sits in the numbered sequence without disturbing it", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain("0015_payment_bootstrap.sql");
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });
});

// ---------------------------------------------------------------------------

describe("exactly one terminal transition is reopened", () => {
  const trigger = fn("payment_attempts_protect");
  const lifecycle = trigger.slice(
    trigger.indexOf("if new.status is distinct from old.status then"),
    trigger.indexOf("new.updated_at := now();"),
  );

  it("permits expired -> succeeded", () => {
    expect(lifecycle).toContain("if old.status = 'expired' and new.status = 'succeeded' then");
  });

  it("permits no other pair, in either direction", () => {
    const pairs = [...lifecycle.matchAll(/old\.status = '(\w+)'\s+and new\.status = '(\w+)'/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(pairs).toEqual([["expired", "succeeded"]]);
  });

  it("checks the exception before the terminal refusal, or it would never be reached", () => {
    const sanctioned = lifecycle.indexOf("if old.status = 'expired'");
    const refusal = lifecycle.indexOf("elsif old.status in ('succeeded', 'failed', 'expired'");
    expect(sanctioned).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(sanctioned);
  });

  it("keeps the terminal set itself unchanged", () => {
    expect(lifecycle).toContain("elsif old.status in ('succeeded', 'failed', 'expired', 'cancelled') then");
    expect(lifecycle).toContain("and that is final");
  });

  it("still refuses failed, cancelled and succeeded as starting points", () => {
    // Each of these reaches the elsif above, because only 'expired' matches
    // the sanctioned branch and the chain is exclusive.
    for (const stuck of ["succeeded", "failed", "cancelled"]) {
      expect(lifecycle).not.toContain(`old.status = '${stuck}' and new.status =`);
    }
  });

  it("does not let an expired attempt go back to created or pending", () => {
    for (const backwards of ["created", "pending"]) {
      expect(lifecycle).not.toContain(`old.status = 'expired' and new.status = '${backwards}'`);
    }
  });

  it("leaves the created and pending rules exactly as they were", () => {
    const core = bodyIn(coreCode, "payment_attempts_protect");
    for (const rule of [
      "old.status = 'created'",
      "new.status not in ('pending', 'succeeded', 'failed', 'expired', 'cancelled')",
      "old.status = 'pending'",
      "new.status not in ('succeeded', 'failed', 'expired', 'cancelled')",
    ]) {
      expect(lifecycle, `${rule} drifted from 0012`).toContain(rule);
      expect(core).toContain(rule);
    }
  });

  it("keeps every non-status guard 0012 had", () => {
    for (const frozen of ["order_id", "provider", "amount", "currency", "created_at"]) {
      expect(trigger, `${frozen} is no longer frozen`).toMatch(
        new RegExp(`new\\.${frozen}\\s+is distinct from old\\.${frozen}`),
      );
    }
    expect(trigger).toContain("if old.provider_payment_id is not null");
    expect(trigger).toContain("if old.provider_checkout_url is not null");
  });
});

// ---------------------------------------------------------------------------

describe("the reopened transition leaves a consistent row", () => {
  const trigger = fn("payment_attempts_protect");

  it("clears failed_at, which the CHECK constraint would otherwise reject", () => {
    // payment_attempts_failed_at_matches reads
    //   (failed_at is not null) = (status in ('failed','expired','cancelled'))
    // so a succeeded row carrying a failed_at is a constraint violation.
    expect(coreCode).toContain("constraint payment_attempts_failed_at_matches");
    expect(trigger).toContain("new.failed_at := null;");
  });

  it("clears it only on the sanctioned branch", () => {
    const clears = [...trigger.matchAll(/new\.failed_at := null;/g)];
    expect(clears).toHaveLength(1);
    const sanctioned = trigger.indexOf("if old.status = 'expired' and new.status = 'succeeded' then");
    const refusal = trigger.indexOf("elsif old.status in ('succeeded'");
    expect(clears[0].index).toBeGreaterThan(sanctioned);
    expect(clears[0].index).toBeLessThan(refusal);
  });

  it("does not invent a paid_at", () => {
    // The caller sets it in the same UPDATE. An attempt that reached
    // 'succeeded' without one must fail loudly, not be repaired here.
    expect(trigger).not.toMatch(/new\.paid_at\s*:=/);
  });
});

// ---------------------------------------------------------------------------

describe("the late payment path now completes", () => {
  const confirm = bodyIn(coreCode, "confirm_order_payment");
  const late = confirm.slice(
    confirm.indexOf("if v_active < v_lines then"),
    confirm.indexOf("v_outcome := 'late_payment_unresolved';"),
  );

  it("is the branch that performs the transition 0015 reopens", () => {
    expect(late).toContain("set status = 'succeeded', paid_at = now()");
    // Reachable with the attempt already 'expired', because
    // expire_stale_checkouts() closes attempts on local state alone.
    const sweep = bodyIn(coreCode, "expire_stale_checkouts");
    expect(sweep).toContain("set status = 'expired', failed_at = now()");
    expect(sweep).toContain("where order_id = v_order.id");
    // And that pair is exactly what the new trigger permits.
    const lifecycle = fn("payment_attempts_protect");
    expect(lifecycle).toContain("if old.status = 'expired' and new.status = 'succeeded' then");
  });

  it("records the money on the order and flags it for a human", () => {
    expect(late).toContain("payment_status  = 'paid'");
    expect(late).toContain("paid_at         = now()");
    expect(late).toContain("needs_resolution = true");
  });

  it("reactivates no reservation", () => {
    expect(late).not.toContain("convert_order_reservations");
    expect(late).not.toMatch(/state\s*=\s*'active'/);
    expect(late).not.toContain("update public.order_reservations");
  });

  it("writes no inventory movement and moves no stock", () => {
    expect(late).not.toContain("inventory_movements");
    expect(late).not.toContain("shop_inventory");
  });

  it("stamps the payment event after the branch, so it commits with it", () => {
    const outcome = confirm.indexOf("v_outcome := 'late_payment_unresolved';");
    const stamp = confirm.indexOf("update public.payment_events");
    expect(outcome).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(outcome);
    expect(confirm.slice(stamp)).toContain("set processed_at = now()");
    expect(confirm.slice(stamp)).toContain("outcome = v_outcome");
  });

  it("nothing in 0015 changes that behaviour", () => {
    // The fix is entirely in the trigger. confirm_order_payment() is untouched.
    expect(code).not.toContain("function public.confirm_order_payment(");
  });
});

// ---------------------------------------------------------------------------

describe("cents are computed in PostgreSQL, exactly", () => {
  const convert = fn("amount_to_cents");
  const head = fnHead("amount_to_cents");

  it("is immutable, so it can be reasoned about as a pure conversion", () => {
    expect(head).toContain("immutable");
    expect(head).toContain("returns integer");
    expect(head).toContain("p_amount numeric");
  });

  it("multiplies the exact numeric by 100 and casts", () => {
    expect(convert).toContain("(p_amount * 100)::integer");
  });

  it("never rounds", () => {
    // round() is precisely what would absorb the value this must refuse.
    expect(convert).not.toContain("round(");
  });

  it("refuses an amount with sub-cent precision instead of absorbing it", () => {
    expect(convert).toContain("p_amount * 100 <> trunc(p_amount * 100)");
    expect(convert).toContain("is not a whole number of cents");
    expect(convert).toContain("errcode = 'data_corrupted'");
  });

  it("refuses NULL rather than returning NULL", () => {
    expect(convert).toContain("if p_amount is null then");
  });

  it("uses no floating point type anywhere in the migration", () => {
    expect(statements).not.toMatch(/\b(float|float4|float8|double precision|real)\b/i);
  });

  /**
   * The mapping the SQL above implements. `numeric(10,2) * 100` is exact in
   * PostgreSQL, so each of these is a lossless cast rather than a rounding
   * decision — which is the whole reason the conversion is not in TypeScript.
   *
   * These are the values, and the assertions above are what pins the rule
   * that produces them. Verifying them by execution needs a database and is
   * a staging step (`npm run verify:commerce` once 0015 is applied there).
   */
  it("implements the documented mapping", () => {
    const vectors: [string, number | "raises"][] = [
      ["14.99", 1499],
      ["75.00", 7500],
      ["0.01", 1],
      ["5.40", 540],
      ["999.99", 99999],
      ["0.00", 0],
      ["1.005", "raises"],
    ];
    for (const [amount, expected] of vectors) {
      const cents = Number(amount) * 100;
      if (expected === "raises") {
        expect(Number.isInteger(Math.round(cents * 1e6) / 1e6)).toBe(false);
      } else {
        expect(Math.round(cents)).toBe(expected);
      }
    }
  });

  it("is the only place cents are derived", () => {
    // No inline arithmetic anywhere else in the migration.
    const elsewhere = statements.replace(convert, "");
    expect(elsewhere).not.toContain("* 100");
  });

  it("is what start_payment_attempt delegates to, in both branches", () => {
    const start = fn("start_payment_attempt");
    const calls = [...start.matchAll(/amount_cents\s+:= public\.amount_to_cents\(/g)];
    expect(calls).toHaveLength(2);
    expect(start).toContain("amount_cents          := public.amount_to_cents(v_open.amount);");
    expect(start).toContain("amount_cents          := public.amount_to_cents(v_new.amount);");
  });
});

// ---------------------------------------------------------------------------

describe("start_payment_attempt keeps every guard and answers more", () => {
  const start = fn("start_payment_attempt");
  const head = fnHead("start_payment_attempt");
  const core = bodyIn(coreCode, "start_payment_attempt");

  it("carries over all four refusals from 0012 verbatim", () => {
    for (const guard of [
      "if v_order.payment_status <> 'pending' then",
      "if v_order.needs_resolution then",
      "if v_active < v_lines then",
      "raise exception 'no such order'",
    ]) {
      expect(start, `${guard} was dropped`).toContain(guard);
      expect(core, `${guard} is not in 0012 either — check the test`).toContain(guard);
    }
  });

  it("still locks the order and still counts only unexpired holds", () => {
    expect(start).toContain("for update");
    expect(start).toContain("and r.expires_at > now()");
  });

  it("still takes the amount from the order and not from a parameter", () => {
    expect(head).not.toMatch(/p_amount|p_cents|p_total/);
    expect(start).toContain("values (p_order_id, p_provider, v_order.total_amount, v_order.currency)");
  });

  it("returns what a bootstrap needs without re-deriving anything", () => {
    for (const column of [
      "attempt_id            bigint",
      "amount                numeric",
      "amount_cents          integer",
      "currency              text",
      "status                text",
      "reused                boolean",
      "created_at            timestamptz",
      "provider_payment_id   text",
      "provider_checkout_url text",
    ]) {
      expect(head, `${column} is missing from the return`).toContain(column);
    }
  });

  it("hands back the existing provider session when it reuses an attempt", () => {
    const reuse = start.slice(start.indexOf("reused                := true;"));
    expect(reuse).toContain("provider_payment_id   := v_open.provider_payment_id;");
    expect(reuse).toContain("provider_checkout_url := v_open.provider_checkout_url;");
    expect(reuse).toContain("created_at            := v_open.created_at;");
  });

  it("reads created_at from the row it just inserted, not from now()", () => {
    // A value computed here would differ between retries and break the
    // provider's idempotency check, which compares request parameters.
    expect(start).toContain("returning * into v_new");
    expect(start).toContain("created_at            := v_new.created_at;");
    expect(start).not.toMatch(/created_at\s+:= now\(\)/);
  });

  it("keeps its security posture", () => {
    expect(head).toContain("security definer");
    expect(head).toContain("set search_path = ''");
  });
});

// ---------------------------------------------------------------------------

describe("pending_payment_expiries only reads", () => {
  const reader = fn("pending_payment_expiries");
  const head = fnHead("pending_payment_expiries");

  it("is a stable SQL function, not a procedure with effects", () => {
    expect(head).toContain("language sql");
    expect(head).toContain("stable");
    expect(head).toContain("security definer");
    expect(head).toContain("set search_path = ''");
  });

  it("contains no statement that can change anything", () => {
    expect(reader).not.toMatch(/\b(insert|update|delete|perform|truncate)\b/i);
  });

  it("releases no reservation, expires no order and closes no attempt", () => {
    for (const effect of [
      "release_expired_reservations",
      "release_order_reservations",
      "convert_order_reservations",
      "expire_stale_checkouts",
      "fail_payment_attempt",
      "attach_provider_payment",
      "confirm_order_payment",
    ]) {
      expect(reader, `${effect} must not be reachable from a reader`).not.toContain(effect);
    }
  });

  it("only offers attempts the provider already knows about", () => {
    expect(reader).toContain("a.status in ('created', 'pending')");
    expect(reader).toContain("a.provider_payment_id is not null");
  });

  it("skips orders that are paid, settled or already flagged", () => {
    expect(reader).toContain("o.payment_status = 'pending'");
    expect(reader).toContain("o.paid_at is null");
    expect(reader).toContain("o.needs_resolution = false");
  });

  it("includes an order whose hold has already lapsed", () => {
    // These are the dangerous ones: stock already back on the shelf while the
    // provider session may still be payable.
    expect(reader).toContain("coalesce(h.holds_until, now()) <= now() + p_lead");
    expect(reader).toContain("nulls first");
  });

  it("bounds one tick's work", () => {
    expect(head).toContain("p_limit integer");
    expect(reader).toContain("limit p_limit");
  });

  it("takes the lead time as a parameter rather than hard-coding a schedule", () => {
    expect(head).toContain("p_lead  interval default interval '60 seconds'");
  });
});

// ---------------------------------------------------------------------------

describe("no provider, no secret, no scheduler, no new reach", () => {
  it("carries no secret and no provider protocol", () => {
    expect(statements.toLowerCase()).not.toMatch(
      /paypal|klarna|webhook|secret|api[_ ]key|bearer|idempotency/,
    );
  });

  it("names a provider in exactly one place: the default 0012 already had", () => {
    // `p_provider text default 'stripe'` is a column value, not an
    // integration. Anything else naming a provider would be provider logic
    // leaking into SQL.
    const mentions = [...statements.matchAll(/'stripe'/g)];
    expect(mentions).toHaveLength(1);
    expect(fnHead("start_payment_attempt")).toContain("p_provider text default 'stripe'");
    expect(bodyIn(coreCode, "start_payment_attempt")).not.toContain("'stripe'");
    expect(headIn(coreCode, "start_payment_attempt")).toContain("p_provider text default 'stripe'");
  });

  it("keeps the expiry reader provider-neutral", () => {
    const reader = fn("pending_payment_expiries");
    expect(reader).not.toMatch(/'stripe'|'paypal'/);
    // It returns the provider instead of assuming one.
    expect(fnHead("pending_payment_expiries")).toContain("provider            text");
  });

  it("installs no scheduler and makes no outbound call", () => {
    expect(code.toLowerCase()).not.toMatch(
      /pg_cron|cron\.schedule|cron\.unschedule|net\.http|pg_net|extension/,
    );
  });

  it("grants nothing to anybody", () => {
    expect(code).not.toMatch(/\bgrant\b/i);
  });

  it("revokes every function it defines from every client role", () => {
    for (const name of DEFINED) {
      const revoke = new RegExp(
        `revoke all on function public\\.${name}\\([^)]*\\)\\s*\\n?\\s*from public, anon, authenticated;`,
      );
      expect(code, `${name} is not revoked`).toMatch(revoke);
    }
  });

  it("re-revokes start_payment_attempt, because dropping it reset its grants", () => {
    // Supabase grants EXECUTE on new functions in public to anon and
    // authenticated. A dropped-and-recreated function is a new one.
    const dropIndex = code.indexOf("drop function if exists public.start_payment_attempt");
    const revokeIndex = code.indexOf("revoke all on function public.start_payment_attempt");
    expect(dropIndex).toBeGreaterThan(-1);
    expect(revokeIndex).toBeGreaterThan(dropIndex);
  });

  it("leaves the payment core revoked as 0012 left it", () => {
    for (const core of [
      "confirm_order_payment",
      "fail_payment_attempt",
      "attach_provider_payment",
      "expire_stale_checkouts",
    ]) {
      expect(coreCode).toContain(`revoke all on function public.${core}(`);
      // And 0015 does not hand any of them back.
      expect(code).not.toMatch(new RegExp(`grant[^;]*${core}`, "i"));
    }
  });

  it("adds no Edge Function of its own and no provider dependency", () => {
    // 0015 itself introduces none. The one that exists is B2.2b's
    // create-payment, which calls start_payment_attempt() — it does not call
    // anything 0015 added beyond that, and never the expiry reader.
    expect(readdirSync("supabase/functions").sort()).toEqual(["create-payment", "stripe-webhook"]);
    const entry = readFileSync("supabase/functions/create-payment/index.ts", "utf8");
    expect(entry).not.toContain("pending_payment_expiries");
    expect(entry).not.toContain("amount_to_cents");
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
      expect(name).not.toMatch(/stripe|mollie|paypal/i);
    }
  });

  it("is not called from the application", () => {
    const app = (readdirSync("src", { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(String(f)) && !String(f).includes(".test."))
      .map((f) => readFileSync(`src/${f}`, "utf8"))
      .join("\n")
      .split("\n")
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");
    for (const internal of ["amount_to_cents", "pending_payment_expiries", "start_payment_attempt"]) {
      expect(app).not.toContain(internal);
    }
  });
});
