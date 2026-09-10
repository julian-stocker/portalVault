/**
 * Read-only verification around one `create-payment` bootstrap (phase B2.2b).
 *
 *   node --env-file=.env.staging tools/verify-payment-smoke.mts --before 15
 *   node --env-file=.env.staging tools/verify-payment-smoke.mts --after  15
 *
 * WRITES NOTHING. Like verify:commerce and verify:shop, this asserts against
 * what is actually in the database rather than creating a fixture: an order
 * cannot be deleted (`on delete restrict`) and the stock journal is
 * append-only, so anything this script created would stay forever.
 *
 * TWO STAGES, ONE SET OF INVARIANTS
 *
 *   --before  the order is placed, reserved and payable, and NOTHING has
 *             asked the provider anything yet: zero payment attempts. This is
 *             the baseline the single call is measured against.
 *   --after   exactly one attempt exists, it is `pending`, it carries the
 *             order's own amount and currency, a `cs_`-prefixed provider id
 *             and a checkout URL.
 *
 * Everything else is checked identically in both stages, because none of it
 * may move when a checkout session is created: the order stays pending and
 * unpaid and unflagged, the reservation stays active, `reserved` stays as it
 * was, and there is NO `sale_skyisles` movement. Only the B2.3 webhook, by
 * way of `confirm_order_payment()`, may ever produce one.
 *
 * `payment_attempts` and `order_reservations` are invisible to every client
 * role — row level security is on and no policy exists — so these invariants
 * can only be checked with the service-role key, never from the application.
 *
 * NOTHING SECRET IS PRINTED
 *
 * The checkout URL is a bearer capability: whoever holds it can open the
 * payment page. The session id is close enough to one that it is not worth
 * the distinction. Both are reported as "present" plus a masked fragment,
 * never in full — see `maskProviderId()`.
 *
 * STAGING ONLY
 *
 * The production project is refused outright, by comparing the target URL
 * against the one in `.env.local`.
 */
import { readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, passed: boolean, detail = ""): void => {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const heading = (text: string) => console.log(`\n${text}\n${"-".repeat(text.length)}`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run with --env-file=.env.staging.`);
    process.exit(1);
  }
  return value;
}

/* ------------------------------------------------------------------ masking */

/**
 * `cs_test_a1b2c3d4e5f6` → `cs_test_…e5f6`.
 *
 * Enough to prove the prefix and to tell two runs apart, never enough to be
 * used. The prefix is what the check is about; the tail is only an identifier
 * for a human comparing two reports.
 */
export function maskProviderId(id: string): string {
  const separator = id.lastIndexOf("_");
  const prefix = separator > 0 ? id.slice(0, separator + 1) : "";
  return `${prefix}…${id.slice(-4)}`;
}

/** Only the origin, so a report can say "Stripe" without carrying the token. */
function maskUrl(url: string): string {
  try {
    return `${new URL(url).origin}/…`;
  } catch {
    return "…";
  }
}

/* -------------------------------------------------------------- the target */

const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");

function productionUrl(): string | null {
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="));
    return line ? line.slice("NEXT_PUBLIC_SUPABASE_URL=".length).trim() : null;
  } catch {
    return null;
  }
}

const production = productionUrl();
if (production && production.replace(/\/+$/, "") === URL_.replace(/\/+$/, "")) {
  console.error("Refusing to run: this is the production project (it matches .env.local).");
  process.exit(1);
}

const service: SupabaseClient = createClient(URL_, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ------------------------------------------------------------- the subject */

const argv = process.argv.slice(2);
const stage: "before" | "after" = argv.includes("--before") ? "before" : "after";
const positional = argv.filter((a) => !a.startsWith("--"));

const wantsLatest = argv.includes("--latest");
const expectedAmount = (positional[wantsLatest ? 0 : 1] ?? "9.31").trim();
const expectedCurrency = (positional[wantsLatest ? 1 : 2] ?? "EUR").trim();

/**
 * `--latest` resolves the newest pending order instead of naming one.
 *
 * The point is speed, not convenience: the stock hold is twenty minutes, and
 * two runs have already been lost to it. Reading the id here removes a
 * round trip between placing the order and checking it.
 */
async function resolveLatestPendingOrder(): Promise<number> {
  const { data, error } = await service
    .from("orders")
    .select("id")
    .eq("payment_status", "pending")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    console.error(`No pending order found${error ? `: ${error.message}` : "."}`);
    process.exit(1);
  }
  return (data as { id: number }).id;
}

const orderId = wantsLatest ? await resolveLatestPendingOrder() : Number(positional[0]);

if (!Number.isSafeInteger(orderId) || orderId < 1) {
  console.error(
    "Usage: verify-payment-smoke.mts [--before|--after] (--latest | <order_id>) [amount] [currency]",
  );
  process.exit(1);
}

console.log(`create-payment smoke — order ${orderId}, stage: ${stage}`);
console.log(`project: ${new URL(URL_).host}`);
console.log(`expecting: ${expectedAmount} ${expectedCurrency}, read-only\n`);

/** Money as text: `numeric` through a JSON float would lose the exact decimal. */
const AMOUNT = "amount_text:amount::text";

async function main(): Promise<void> {
  heading(stage === "before" ? "1. no attempt yet" : "1. the payment attempt");

  const attempts = await service
    .from("payment_attempts")
    .select(`id,provider,status,${AMOUNT},currency,provider_payment_id,provider_checkout_url`)
    .eq("order_id", orderId)
    .order("id", { ascending: true });

  if (attempts.error) {
    check("payment_attempts readable", false, attempts.error.message);
    return report(null);
  }

  const rows = attempts.data ?? [];
  let masked: string | null = null;

  if (stage === "before") {
    check("baseline: zero attempts", rows.length === 0, `${rows.length} found`);
  } else {
    check("exactly one attempt", rows.length === 1, `${rows.length} found`);
    if (rows.length !== 1) return report(null);

    const attempt = rows[0] as unknown as {
      id: number;
      provider: string;
      status: string;
      amount_text: string;
      currency: string;
      provider_payment_id: string | null;
      provider_checkout_url: string | null;
    };

    check("status is pending", attempt.status === "pending", attempt.status);
    check(
      `attempt amount is ${expectedAmount}`,
      attempt.amount_text === expectedAmount,
      attempt.amount_text,
    );
    check(
      `attempt currency is ${expectedCurrency}`,
      attempt.currency === expectedCurrency,
      attempt.currency,
    );
    check(
      "provider_payment_id starts with cs_",
      typeof attempt.provider_payment_id === "string" &&
        attempt.provider_payment_id.startsWith("cs_"),
      attempt.provider_payment_id ? maskProviderId(attempt.provider_payment_id) : "null",
    );
    check(
      "provider_checkout_url present",
      typeof attempt.provider_checkout_url === "string" &&
        attempt.provider_checkout_url.length > 0,
      attempt.provider_checkout_url ? maskUrl(attempt.provider_checkout_url) : "null",
    );
    masked = attempt.provider_payment_id ? maskProviderId(attempt.provider_payment_id) : null;
  }

  heading("2. the order");

  const order = await service
    .from("orders")
    .select(
      "order_number,payment_status,paid_at,needs_resolution,currency," +
        "shipping_method_name,total_text:total_amount::text",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (order.error || !order.data) {
    check("order readable", false, order.error?.message ?? "not found");
    return report(masked);
  }
  const o = order.data as unknown as {
    order_number: string;
    payment_status: string;
    paid_at: string | null;
    needs_resolution: boolean;
    currency: string;
    shipping_method_name: string | null;
    total_text: string;
  };
  check("payment_status is pending", o.payment_status === "pending", o.payment_status);
  check("paid_at is null", o.paid_at === null, String(o.paid_at));
  check("needs_resolution is false", o.needs_resolution === false, String(o.needs_resolution));
  check(`order total is ${expectedAmount}`, o.total_text === expectedAmount, o.total_text);
  check(`order currency is ${expectedCurrency}`, o.currency === expectedCurrency, o.currency);

  heading("3. nothing has been sold");

  const reservations = await service
    .from("order_reservations")
    .select("id,inventory_id,quantity,state,expires_at,movement_id")
    .eq("order_id", orderId);

  if (reservations.error) {
    check("order_reservations readable", false, reservations.error.message);
    return report(masked);
  }
  const held = (reservations.data ?? []) as {
    id: number;
    inventory_id: number;
    quantity: number;
    state: string;
    expires_at: string;
    movement_id: number | null;
  }[];

  check("at least one reservation", held.length > 0, `${held.length}`);
  check(
    "every reservation still active",
    held.length > 0 && held.every((r) => r.state === "active"),
    held.map((r) => r.state).join(",") || "none",
  );
  /*
   * `state` alone is not the question the database asks.
   *
   * start_payment_attempt() counts reservations with `r.state = 'active' AND
   * r.expires_at > now()`. Nothing sweeps lapsed holds on this project
   * (pg_cron is off), so a row sits at 'active' long after it stopped
   * counting — which is exactly how an order can look reserved and still be
   * refused. Checking the state without the clock is checking the wrong half.
   */
  const now = Date.now();
  const minutesLeft = held.map((r) => (Date.parse(r.expires_at) - now) / 60_000);
  const soonest = minutesLeft.length > 0 ? Math.min(...minutesLeft) : 0;
  check(
    "hold has not lapsed",
    held.length > 0 && soonest > 0,
    held.length === 0
      ? "no reservation"
      : soonest > 0
        ? `${soonest.toFixed(1)} min left`
        : `lapsed ${Math.abs(soonest).toFixed(1)} min ago — the database will refuse this order`,
  );

  check(
    "no reservation converted to a movement",
    held.every((r) => r.movement_id === null),
    `${held.filter((r) => r.movement_id !== null).length} converted`,
  );

  /*
   * `reserved` is the shop's own counter, and it carries EVERY active hold on
   * that position, not only this order's. So it is compared against the sum
   * of all active reservations on the same inventory row — checking it
   * against this order's quantity alone would fail the moment a second test
   * order exists, which is exactly the situation on a staging project.
   */
  for (const r of held) {
    const inv = await service
      .from("shop_inventory")
      .select("id,sky_id,condition,quantity,reserved")
      .eq("id", r.inventory_id)
      .maybeSingle();
    if (inv.error || !inv.data) {
      check(`inventory ${r.inventory_id} readable`, false, inv.error?.message ?? "not found");
      continue;
    }
    const i = inv.data as { sky_id: string; condition: string; quantity: number; reserved: number };

    const allHolds = await service
      .from("order_reservations")
      .select("quantity")
      .eq("inventory_id", r.inventory_id)
      .eq("state", "active");
    const expectedReserved = (allHolds.data ?? []).reduce(
      (sum, h) => sum + ((h as { quantity: number }).quantity ?? 0),
      0,
    );

    check(
      `${i.sky_id}/${i.condition}: reserved matches active holds`,
      !allHolds.error && i.reserved === expectedReserved,
      `reserved=${i.reserved}, active holds=${expectedReserved}, quantity=${i.quantity}, available=${
        i.quantity - i.reserved
      }`,
    );
    check(
      `${i.sky_id}/${i.condition}: this order holds ${r.quantity}`,
      r.quantity === 1,
      `${r.quantity}`,
    );

    const sales = await service
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("inventory_id", r.inventory_id)
      .eq("reason", "sale_skyisles");
    check(
      `${i.sky_id}/${i.condition}: no sale_skyisles movement`,
      !sales.error && (sales.count ?? 0) === 0,
      sales.error ? sales.error.message : `${sales.count ?? 0} found`,
    );
  }

  heading("reference");
  console.log(`  order:    ${o.order_number} · ${o.shipping_method_name ?? "no shipping method"}`);
  if (masked) console.log(`  provider: stripe · id: ${masked}`);

  report(masked);
}

function report(masked: string | null): void {
  const failed = results.filter((r) => !r.passed);
  heading("result");
  console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
  if (masked) console.log(`  provider id (masked): ${masked}`);
  console.log(`  pass=${failed.length === 0}`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`    FAIL  ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exitCode = 1;
  }
}

await main();
