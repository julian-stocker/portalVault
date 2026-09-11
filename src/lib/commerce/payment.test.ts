import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

import {
  bookedStock,
  isAttemptOpen,
  isAttemptTerminal,
  needsHuman,
  PAYMENT_ATTEMPT_STATUSES,
  PAYMENT_OUTCOMES,
  PAYMENT_PROVIDERS,
} from "@/lib/commerce/payment";

/**
 * The payment core (B2.1, migration 0012).
 *
 * The migration is not applied anywhere, so nothing here executes it. These
 * are contract tests against the SQL, and they exist because the guarantees
 * they cover are the ones that cost money when they quietly stop holding:
 * one sale per payment, never a half-sold order, never an oversold one, and
 * nothing about payments reachable from a browser.
 */
const MIGRATION = "supabase/migrations/0012_payment_core.sql";
const sql = readFileSync(MIGRATION, "utf8");

const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/** The migration with `comment on … is '…'` removed: prose, not code. */
const statements = code.replace(/comment on [\s\S]*?';/g, "");

function table(name: string): string {
  const start = code.indexOf(`create table public.${name} (`);
  expect(start, `table ${name} is missing`).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf("\n);", start));
}

function fnHead(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  if (start < 0) return "";
  return code.slice(start, code.indexOf("as $$", start));
}

function fn(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} is missing`).toBeGreaterThan(-1);
  const open = code.indexOf("as $$", start);
  return code.slice(open, code.indexOf("$$;", open));
}

describe("the migration stays additive", () => {
  it("creates exactly the two payment tables", () => {
    const created = [...code.matchAll(/create table public\.(\w+) \(/g)].map((m) => m[1]);
    expect(created.sort()).toEqual(["payment_attempts", "payment_events"]);
  });

  it("alters no existing table and drops nothing", () => {
    expect(code).not.toMatch(/alter table public\.(orders|order_lines|order_reservations|shop_inventory)/);
    expect(code).not.toMatch(/\bdrop\s+(table|function|column|constraint)\b/i);
  });

  it("re-signs none of the functions it builds on", () => {
    for (const existing of [
      "convert_order_reservations",
      "release_expired_reservations",
      "apply_inventory_movement",
      "create_order",
      "reserve_for_order",
    ]) {
      expect(code).not.toContain(`create or replace function public.${existing}(`);
    }
  });

  it("sits in the numbered sequence without disturbing it", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain("0012_payment_core.sql");
    // Contiguous numbering from 0001, no gaps and no duplicates.
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });
});

describe("payment_attempts", () => {
  const attempts = table("payment_attempts");

  it("knows exactly the statuses the application knows", () => {
    const check = code.slice(code.indexOf("payment_attempts_status_known"));
    const values = [...check.slice(0, check.indexOf("))")).matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(values.sort()).toEqual([...PAYMENT_ATTEMPT_STATUSES].sort());
  });

  it("names the provider as text with a CHECK, not an enum", () => {
    expect(attempts).toContain("provider text not null");
    expect(attempts).toContain("check (provider in ('stripe'))");
    expect(code).not.toMatch(/create type|as enum/i);
    expect([...PAYMENT_PROVIDERS]).toEqual(["stripe"]);
  });

  it("allows several attempts per order", () => {
    // A declined card must be retryable; a one-attempt order is abandoned.
    expect(code).not.toMatch(/unique\s*\(order_id\)\s*$/m);
    expect(code).toContain("create index payment_attempts_order_idx");
  });

  it("allows only one open attempt per order", () => {
    expect(code).toContain("create unique index payment_attempts_one_open_per_order");
    expect(code).toContain("where status in ('created', 'pending')");
  });

  it("ties one provider payment to one attempt", () => {
    expect(code).toContain("create unique index payment_attempts_provider_payment_unique");
    expect(code).toContain("on public.payment_attempts (provider, provider_payment_id)");
    expect(code).toContain("where provider_payment_id is not null");
  });

  it("keeps a status and its timestamp in agreement", () => {
    expect(attempts).toContain("check ((paid_at is not null) = (status = 'succeeded'))");
    expect(attempts).toContain(
      "check ((failed_at is not null) = (status in ('failed', 'expired', 'cancelled')))",
    );
  });

  it("refuses a zero or negative amount", () => {
    expect(attempts).toContain("check (amount > 0)");
    expect(attempts).toContain("check (currency ~ '^[A-Z]{3}$')");
  });
});

describe("what may change about an attempt", () => {
  const trigger = fn("payment_attempts_protect");

  it("freezes the order, provider, amount and currency", () => {
    // The trigger aligns its operands, so whitespace varies.
    for (const frozen of ["order_id", "provider", "amount", "currency", "created_at"]) {
      expect(trigger, `${frozen} is not frozen`).toMatch(
        new RegExp(`new\\.${frozen}\\s+is distinct from old\\.${frozen}`),
      );
    }
  });

  it("lets the provider payment id be set once and never rewritten", () => {
    expect(trigger).toContain("if old.provider_payment_id is not null");
    expect(trigger).toContain("the provider payment id is set once and cannot be changed");
  });

  it("lets the checkout url be set once", () => {
    expect(trigger).toContain("if old.provider_checkout_url is not null");
  });

  it("refuses to reopen a settled attempt", () => {
    expect(trigger).toContain("if old.status in ('succeeded', 'failed', 'expired', 'cancelled')");
    expect(trigger).toContain("and that is final");
  });

  it("is superseded by 0015, which reopens exactly one of those four", () => {
    // 0012's rule was absolute and that turned out to be wrong: an attempt
    // closed as `expired` by our own local timeout could never be corrected
    // by a later authoritative confirmation, so a late payment rolled back
    // and went unrecorded. 0015 permits `expired` -> `succeeded` and nothing
    // else. This test exists so the two files cannot silently disagree —
    // the live contract is `payment-bootstrap.test.ts`.
    const next = readFileSync("supabase/migrations/0015_payment_bootstrap.sql", "utf8");
    expect(next).toContain("create or replace function public.payment_attempts_protect()");
    expect(next).toContain("if old.status = 'expired' and new.status = 'succeeded' then");
  });

  it("never deletes an attempt or an event", () => {
    expect(code).toContain("create trigger payment_attempts_keep");
    expect(code).toContain("before delete on public.payment_attempts");
    expect(code).toContain("create trigger payment_events_keep");
  });
});

describe("the amount comes from the order, never from a request", () => {
  const start = fn("start_payment_attempt");

  it("has no amount or currency parameter", () => {
    const head = fnHead("start_payment_attempt");
    expect(head).toContain("p_order_id bigint");
    expect(head).not.toMatch(/p_amount|p_currency|p_total|p_price/i);
  });

  it("copies the order's own figures under its lock", () => {
    expect(start).toContain("from public.orders o");
    expect(start).toContain("for update");
    expect(start).toContain("values (p_order_id, p_provider, v_order.total_amount, v_order.currency)");
  });
});

describe("when an order may be paid at all", () => {
  const start = fn("start_payment_attempt");

  it("refuses an order that is not pending", () => {
    expect(start).toContain("if v_order.payment_status <> 'pending' then");
  });

  it("refuses an order that needs a human first", () => {
    expect(start).toContain("if v_order.needs_resolution then");
  });

  it("refuses an order whose hold has lapsed", () => {
    // Paying for something no longer reserved is inviting the late-payment
    // problem on purpose.
    expect(start).toContain("if v_active < v_lines then");
    expect(start).toContain("r.state = 'active'");
    expect(start).toContain("r.expires_at > now()");
  });

  it("hands back the open attempt instead of opening a second", () => {
    expect(start).toContain("a.status in ('created', 'pending')");
    expect(start).toContain("reused     := true;");
  });
});

describe("confirming a payment", () => {
  const confirm = fn("confirm_order_payment");

  it("locks the attempt and then the order", () => {
    const attempt = confirm.indexOf("from public.payment_attempts a");
    const order = confirm.indexOf("from public.orders o");
    expect(attempt).toBeGreaterThan(-1);
    expect(order).toBeGreaterThan(attempt);
    expect((confirm.match(/for update/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("stops on a repeated provider event before reading anything", () => {
    expect(confirm).toContain("on conflict (provider, provider_event_id) do nothing");
    expect(confirm).toContain("return 'duplicate_event';");
    const dedupe = confirm.indexOf("return 'duplicate_event';");
    expect(dedupe).toBeLessThan(confirm.indexOf("from public.payment_attempts a"));
  });

  it("does nothing for an order that is already paid", () => {
    expect(confirm).toContain("if v_order.paid_at is not null then");
    expect(confirm).toContain("v_outcome := 'already_confirmed';");
  });

  it("refuses money that does not match, and sells nothing", () => {
    expect(confirm).toContain("p_amount is distinct from v_attempt.amount");
    expect(confirm).toContain("upper(coalesce(p_currency, '')) <> v_attempt.currency");
    expect(confirm).toContain("v_outcome := 'amount_mismatch';");

    // The mismatch branch flags the order and never reaches a conversion.
    const branch = confirm.slice(
      confirm.indexOf("p_amount is distinct from"),
      confirm.indexOf("v_outcome := 'amount_mismatch';"),
    );
    expect(branch).toContain("needs_resolution = true");
    expect(branch).not.toContain("convert_order_reservations");
  });

  it("converts every reservation or none of them", () => {
    // A partly-lapsed hold must not half-sell an order.
    expect(confirm).toContain("if v_active < v_lines then");
    const lateBranch = confirm.slice(
      confirm.indexOf("if v_active < v_lines then"),
      confirm.indexOf("v_outcome := 'late_payment_unresolved';"),
    );
    expect(lateBranch).not.toContain("convert_order_reservations");
  });

  it("books the sale through the existing journal, once", () => {
    expect(confirm).toContain("public.convert_order_reservations(v_order.id)");
    expect(confirm).not.toContain("insert into public.inventory_movements");
    expect(confirm).not.toContain("set quantity = quantity");
    expect((confirm.match(/convert_order_reservations/g) ?? [])).toHaveLength(1);
  });

  it("raises rather than half-selling if the counts ever disagree", () => {
    expect(confirm).toContain("if v_converted < v_lines then");
    expect(confirm).toContain("using errcode = 'data_corrupted'");
  });

  it("marks the attempt and the order together", () => {
    const happy = confirm.slice(confirm.indexOf("v_converted := "));
    expect(happy).toContain("set status = 'succeeded', paid_at = now()");
    expect(happy).toContain("set payment_status = 'paid', paid_at = now()");
    expect(happy).toContain("'payment_succeeded'");
  });
});

describe("a late payment never oversells", () => {
  const confirm = fn("confirm_order_payment");
  const late = confirm.slice(
    confirm.indexOf("if v_active < v_lines then"),
    confirm.indexOf("v_outcome := 'late_payment_unresolved';"),
  );

  it("records that the money really arrived", () => {
    expect(late).toContain("set status = 'succeeded', paid_at = now()");
    expect(late).toContain("payment_status  = 'paid'");
  });

  it("flags the order for a human", () => {
    expect(late).toContain("needs_resolution = true");
    expect(late).toContain("'late_payment_unresolved'");
  });

  it("revives no reservation and books no movement", () => {
    expect(late).not.toContain("convert_order_reservations");
    expect(late).not.toMatch(/state = 'active'/);
    expect(late).not.toContain("apply_inventory_movement");
    expect(late).not.toContain("reserved");
  });

  it("is the semantics ADR-0050 already fixed", () => {
    const adr = readFileSync("docs/DECISIONS.md", "utf8");
    expect(adr).toContain("Eine abgelaufene und freigegebene wird **nicht**");
  });
});

describe("a failed attempt is not a failed order", () => {
  const fail = fn("fail_payment_attempt");

  it("closes only the attempt", () => {
    expect(fail).toContain("set status = p_status, failed_at = now()");
    expect(fail).not.toMatch(/update public\.orders[\s\S]{0,120}payment_status/);
  });

  it("leaves the reservation alone", () => {
    expect(fail).not.toContain("release_order_reservations");
    expect(fail).not.toContain("order_reservations");
  });

  it("accepts only the three ways an attempt can end badly", () => {
    expect(fail).toContain("if p_status not in ('failed', 'cancelled', 'expired') then");
  });

  it("is idempotent on a repeated event and on a closed attempt", () => {
    expect(fail).toContain("return 'duplicate_event';");
    expect(fail).toContain("return 'already_closed';");
  });
});

describe("the sweep closes what lapsed", () => {
  const sweep = fn("expire_stale_checkouts");

  it("gives the stock back first, using 0010's function", () => {
    expect(sweep).toContain("perform public.release_expired_reservations()");
  });

  it("only touches orders that are pending and hold nothing", () => {
    expect(sweep).toContain("o.payment_status = 'pending'");
    expect(sweep).toContain("o.paid_at is null");
    expect(sweep).toContain("and r.state = 'active'");
    expect(sweep).toContain("not exists");
  });

  it("expires the open attempt and the order together", () => {
    expect(sweep).toContain("set status = 'expired', failed_at = now()");
    expect(sweep).toContain("set payment_status = 'expired'");
    expect(sweep).toContain("'checkout_expired'");
  });

  it("takes the order's lock, so a payment cannot interleave", () => {
    expect(sweep).toContain("for update of o");
    expect(sweep).toContain("order by o.id");
  });

  it("installs no scheduler", () => {
    // pg_cron is an infrastructure decision and a separate, manual step.
    expect(code).not.toMatch(/pg_cron|cron\.schedule|create extension/i);
  });
});

describe("nothing about payments is reachable from a browser", () => {
  it("grants no privilege on either table to a client role", () => {
    expect(code).toContain(
      "revoke all on public.payment_attempts, public.payment_events from anon, authenticated;",
    );
    expect(code).not.toMatch(/grant[^;]*on public\.payment_(attempts|events)[^;]*to (anon|authenticated)/);
  });

  it("enables row level security and adds no policy", () => {
    expect(code).toContain("alter table public.payment_attempts enable row level security;");
    expect(code).toContain("alter table public.payment_events   enable row level security;");
    expect(code).not.toContain("create policy");
  });

  it("grants EXECUTE on nothing at all", () => {
    // Every function here is internal; the Edge Function is the caller.
    expect(code).not.toMatch(/grant execute/);
  });

  it("revokes every function from all three roles, not just PUBLIC", () => {
    // Supabase's default privileges grant EXECUTE on new functions to anon
    // and authenticated explicitly — `from public` alone leaves them open.
    // That was the 0010 bug, and this is the guard against repeating it.
    const defined = [...code.matchAll(/create or replace function public\.(\w+)\(/g)]
      .map((m) => m[1])
      .filter((name) => !fnHead(name).includes("returns trigger") || true);

    for (const name of defined) {
      const revoke = code.match(
        new RegExp(`revoke all on function public\\.${name}\\([^)]*\\)\\s*\\n?\\s*from ([^;]+);`),
      );
      expect(revoke, `${name} is never revoked`).not.toBeNull();
      expect(revoke![1], `${name} is revoked only from ${revoke![1]}`).toContain("anon");
      expect(revoke![1], `${name} is revoked only from ${revoke![1]}`).toContain("authenticated");
    }
  });

  it("pins search_path on every function", () => {
    const defined = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    expect(defined.length).toBeGreaterThan(5);
    for (const name of defined) {
      expect(fnHead(name), `${name} does not pin search_path`).toContain("set search_path = ''");
    }
  });

  it("makes every non-trigger function a definer", () => {
    for (const name of [
      "start_payment_attempt",
      "attach_provider_payment",
      "confirm_order_payment",
      "fail_payment_attempt",
      "expire_stale_checkouts",
    ]) {
      expect(fnHead(name), `${name} is not security definer`).toContain("security definer");
    }
  });
});

describe("no payment data and no provider code is stored", () => {
  it("keeps no payload column", () => {
    expect(table("payment_events")).not.toMatch(/payload|raw|body|json/i);
  });

  it("stores nothing that could be card data or a credential", () => {
    for (const forbidden of [
      "card", "pan", "cvc", "iban", "token", "secret", "api_key", "signature",
    ]) {
      expect(statements.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("names no Stripe API surface — that is B2.2 and B2.3", () => {
    expect(statements).not.toMatch(/pi_|cs_|whsec|sk_live|checkout\.session|payment_intent/i);
  });
});

describe("the vocabulary matches the migration", () => {
  it("agrees on the outcomes confirm_order_payment can return", () => {
    // Only the values actually returned — not every string literal in the
    // body, which includes reservation states and column values.
    const body = fn("confirm_order_payment");
    const returned = [
      ...body.matchAll(/return '(\w+)';/g),
      ...body.matchAll(/v_outcome := '(\w+)';/g),
    ].map((m) => m[1]);
    expect(returned.length).toBeGreaterThan(3);
    for (const outcome of returned) {
      expect(PAYMENT_OUTCOMES, `${outcome} is not in PAYMENT_OUTCOMES`).toContain(outcome);
    }
  });

  it("knows that exactly one outcome moves stock", () => {
    expect(PAYMENT_OUTCOMES.filter(bookedStock)).toEqual(["confirmed"]);
  });

  it("knows which outcomes need a human", () => {
    expect(PAYMENT_OUTCOMES.filter(needsHuman).sort()).toEqual([
      "amount_mismatch",
      "late_payment_unresolved",
    ]);
  });

  it("knows which attempt states are still open", () => {
    expect(PAYMENT_ATTEMPT_STATUSES.filter(isAttemptOpen)).toEqual(["created", "pending"]);
    expect(PAYMENT_ATTEMPT_STATUSES.filter(isAttemptTerminal)).toEqual([
      "succeeded",
      "failed",
      "expired",
      "cancelled",
    ]);
  });
});

describe("B2.1 ships no provider integration", () => {
  it("adds no Stripe dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
      expect(name).not.toMatch(/stripe|mollie|paypal/i);
    }
  });

  it("adds no webhook route, and every Edge Function is a named one", () => {
    const files = readdirSync("src/app", { recursive: true }) as string[];
    expect(files.some((f) => String(f).includes("webhook"))).toBe(false);
    /*
     * The guard that matters is not "there is exactly one" — it is that a new
     * privileged runtime is a deliberate, named addition (ADR-0051). Three
     * exist now, each with its own reason:
     *
     *   create-payment    B2.2b, the only caller of the payment functions
     *   stripe-webhook    B2.3, the only thing that may say money arrived
     *   send-order-mail   transactional mail, the only holder of the Resend key
     *
     * A fourth fails this test, which is when it should be discussed rather
     * than silently widened.
     */
    expect(readdirSync("supabase/functions").sort()).toEqual([
      "create-payment",
      "send-order-mail",
      "stripe-webhook",
    ]);
  });

  it("calls none of the payment functions from the application", () => {
    // They are revoked, and nothing in src/ should even reference them.
    const app = (readdirSync("src", { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(String(f)) && !String(f).includes(".test."))
      .map((f) => readFileSync(`src/${f}`, "utf8"))
      .join("\n")
      // Prose may name them — payment.ts documents the contract. Code may not.
      .split("\n")
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");
    for (const internal of [
      "confirm_order_payment",
      "start_payment_attempt",
      "attach_provider_payment",
      "fail_payment_attempt",
      "expire_stale_checkouts",
    ]) {
      expect(app).not.toContain(internal);
    }
  });
});

describe("an event is only 'done' when it actually finished", () => {
  const confirm = fn("confirm_order_payment");
  const fail = fn("fail_payment_attempt");

  /*
   * The dead end this guards against: a webhook can legitimately arrive
   * before attach_provider_payment() has committed, so the first delivery is
   * unmatched. If that were recorded as processed, every provider retry would
   * be discarded as a duplicate and the order would never be paid.
   */
  it("treats only a processed event as a duplicate", () => {
    for (const body of [confirm, fail]) {
      expect(body).toContain("and e.processed_at is null");
      const lookup = body.indexOf("and e.processed_at is null");
      const giveUp = body.indexOf("return 'duplicate_event';");
      expect(lookup).toBeLessThan(giveUp);
    }
  });

  it("locks the unresolved row before retrying it", () => {
    for (const body of [confirm, fail]) {
      const block = body.slice(body.indexOf("on conflict"), body.indexOf("return 'duplicate_event';"));
      expect(block).toContain("for update");
    }
  });

  it("leaves an unplaceable payment retryable, not closed", () => {
    // No processed_at, no outcome — the row says "seen, unresolved".
    const unknown = confirm.slice(
      confirm.indexOf("if not found then"),
      confirm.indexOf("return 'unknown_payment';"),
    );
    expect(unknown).not.toContain("processed_at = now()");
    expect(unknown).not.toContain("outcome = 'unknown_payment'");
  });

  it("marks every outcome that really is final", () => {
    // The tail of confirm_order_payment stamps the row for the four terminal
    // outcomes; unknown_payment returns before reaching it.
    const tail = confirm.slice(confirm.lastIndexOf("if v_event_id is not null then"));
    expect(tail).toContain("set processed_at = now()");
    expect(tail).toContain("outcome = v_outcome");
  });

  it("rolls the event back with everything else when it raises", () => {
    // PostgREST runs one call in one transaction, so a raise undoes the
    // event insert too — the retry then starts clean.
    expect(confirm).toContain("using errcode = 'data_corrupted'");
  });
});

describe("a mismatched payment does not leave the attempt open", () => {
  const confirm = fn("confirm_order_payment");
  const branch = confirm.slice(
    confirm.indexOf("elsif p_amount is distinct from"),
    confirm.indexOf("v_outcome := 'amount_mismatch';"),
  );

  it("closes the attempt as failed", () => {
    expect(branch).toContain("set status = 'failed', failed_at = now()");
  });

  it("flags the order and sells nothing", () => {
    expect(branch).toContain("needs_resolution = true");
    expect(branch).not.toContain("convert_order_reservations");
  });

  it("frees the one-open-attempt slot, while the order stays blocked", () => {
    // `failed` is outside the partial unique index, but start_payment_attempt
    // refuses an order with needs_resolution — so no new attempt begins.
    expect(fn("start_payment_attempt")).toContain("if v_order.needs_resolution then");
  });
});

describe("the sweep leaves flagged and settled orders alone", () => {
  const sweep = fn("expire_stale_checkouts");

  it("never expires an order that needs a human", () => {
    expect(sweep).toContain("o.needs_resolution = false");
  });

  it("never expires a paid order", () => {
    expect(sweep).toContain("o.payment_status = 'pending'");
    expect(sweep).toContain("o.paid_at is null");
  });
});

describe("after a late payment the order is closed to new attempts", () => {
  it("is paid, so start_payment_attempt refuses it", () => {
    const start = fn("start_payment_attempt");
    expect(start).toContain("if v_order.payment_status <> 'pending' then");
    // And it is flagged as well, which refuses it a second time over.
    expect(start).toContain("if v_order.needs_resolution then");
  });

  it("closes its attempt as succeeded, which is terminal", () => {
    const confirm = fn("confirm_order_payment");
    const late = confirm.slice(
      confirm.indexOf("if v_active < v_lines then"),
      confirm.indexOf("v_outcome := 'late_payment_unresolved';"),
    );
    expect(late).toContain("set status = 'succeeded', paid_at = now()");
  });
});

describe("retrying after a closed attempt", () => {
  it("is possible, because only open attempts occupy the slot", () => {
    // failed, expired and cancelled all fall out of the partial index.
    expect(code).toContain("where status in ('created', 'pending')");
    const open = ["created", "pending"];
    const terminal = ["succeeded", "failed", "expired", "cancelled"];
    for (const state of terminal) {
      expect(open).not.toContain(state);
    }
  });

  it("and the order is still pending after a failed attempt", () => {
    const fail = fn("fail_payment_attempt");
    expect(fail).not.toMatch(/update public\.orders[\s\S]{0,150}payment_status/);
  });
});

