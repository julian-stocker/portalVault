/**
 * verify:sandbox-e2e — one real Stripe SANDBOX checkout, as far as a
 * terminal can take it.
 *
 * STAGING ONLY: `requireStaging()` compares origin AND service-role key
 * against `.env.staging` before a connection exists.
 *
 * WHAT IT DOES
 *
 *   1. borrows a session for the existing Staging tester (admin magic link,
 *      never a password), so the order belongs to a real tester account
 *      rather than to a user this tool invented
 *   2. places one order through `create_order()`, exactly as the checkout
 *      form does
 *   3. asks the DEPLOYED `create-payment` function for a Checkout Session
 *   4. proves the sandbox key was used, from Stripe's own answer
 *
 * WHERE IT STOPS
 *
 * At the hosted payment page. Completing it needs a browser, so the URL is
 * printed and the webhook half is verified afterwards by
 * `--verify <order-number>`.
 *
 * WHAT IT WRITES: one order, its reservation and one payment attempt — the
 * same rows a tester produces by clicking. No inventory movement: stock moves
 * only when `confirm_order_payment()` runs, after a real payment.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

import { readEnvFile, requireStaging } from "./lib/staging-guard.mts";

const FUNCTION = "create-payment";

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

async function testerSession(
  admin: SupabaseClient,
  url: string,
  anonKey: string,
): Promise<{ userId: string; email: string; accessToken: string }> {
  const profiles = await admin.from("profiles").select("id").limit(50);
  if (profiles.error) throw new Error(`profiles: ${profiles.error.message}`);

  let userId: string | null = null;
  for (const row of profiles.data ?? []) {
    const { data } = await admin.rpc("is_commerce_tester_for", { p_user_id: row.id });
    if (data === true) { userId = row.id as string; break; }
  }
  if (!userId) throw new Error("no commerce tester on staging");

  const user = await admin.auth.admin.getUserById(userId);
  const email = user.data.user?.email;
  if (!email) throw new Error(`tester ${userId} has no email`);

  // A magic link minted by the service role. No password is read, guessed or
  // stored, and the link is consumed immediately by this process.
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`generateLink: ${link.error.message}`);
  const tokenHash = link.data.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink returned no token");

  const asUser = createClient(url, anonKey, { auth: { persistSession: false } });
  const session = await asUser.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (session.error || !session.data.session) {
    throw new Error(`verifyOtp: ${session.error?.message ?? "no session"}`);
  }
  return { userId, email, accessToken: session.data.session.access_token };
}

async function main(): Promise<void> {
  requireStaging("verify:sandbox-e2e");

  const env = readEnvFile(".env.staging");
  const url = env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const verifyOnly = process.argv.indexOf("--verify");
  if (verifyOnly > -1) {
    await report(admin, process.argv[verifyOnly + 1]);
    return;
  }

  /*
   * `--shop-live` runs the whole thing with the shop switched ON for
   * customers. That is the row of the matrix that matters most: a tester
   * must STILL get a sandbox order and a test-mode Stripe session, with a
   * live key nowhere in reach. The switch is restored in `finally`, so a
   * failed assertion cannot leave the shop open.
   */
  /*
   * `--fail-closed-live` is the opposite proof: a NORMAL account, a live
   * shop, and deliberately no live key configured. The only acceptable
   * outcome is a refusal — never a quiet sandbox charge.
   */
  const failClosed = process.argv.includes("--fail-closed-live");
  const wantLive = process.argv.includes("--shop-live") || failClosed;
  const before = await admin.from("commerce_settings").select("mode").eq("id", true).single();
  if (before.error) throw new Error(`commerce_settings: ${before.error.message}`);
  const originalShopMode = before.data.mode as string;

  if (wantLive) {
    const set = await admin.from("commerce_settings").update({ mode: "live" }).eq("id", true);
    if (set.error) throw new Error(`shop -> live: ${set.error.message}`);
    console.log(`\n  Shop-Schalter: live (vorgefunden ${originalShopMode}, wird zurückgesetzt)`);
  } else {
    console.log(`\n  Shop-Schalter: ${(await admin.rpc("commerce_mode")).data}`);
  }

  try {
    await (failClosed ? runFailClosedLive(admin, url, anonKey, env) : run(admin, url, anonKey, env));
  } finally {
    if (wantLive) {
      await admin.from("commerce_settings").update({ mode: originalShopMode }).eq("id", true);
      const back = await admin.rpc("commerce_mode");
      console.log(`  Shop-Schalter zurückgesetzt auf: ${back.data}`);
      if (back.data !== originalShopMode) {
        console.error(`  ACHTUNG: Schalter steht auf ${back.data}, erwartet ${originalShopMode}`);
      }
    }
  }
}

async function run(
  admin: SupabaseClient,
  url: string,
  anonKey: string,
  env: Record<string, string | undefined>,
): Promise<void> {

  const tester = await testerSession(admin, url, anonKey);
  console.log(`  Tester:        ${tester.userId}  <${tester.email}>`);
  console.log(`  payment_mode_for_user -> ${JSON.stringify(
    (await admin.rpc("payment_mode_for_user", { p_user_id: tester.userId })).data,
  )}`);

  // ---- one cheap, available article ---------------------------------------
  const offers = await admin.rpc("shop_offers");
  if (offers.error) throw new Error(`shop_offers: ${offers.error.message}`);
  const offer = (offers.data as { sky_id: string; condition: string; price: number; available: boolean }[])
    .filter((o) => o.available)
    .sort((a, b) => a.price - b.price)[0];
  if (!offer) throw new Error("no available offer on staging");
  console.log(`  Artikel:       ${offer.sky_id} ${offer.condition} ${offer.price} EUR\n`);

  // ---- the order, exactly as the form places it ---------------------------
  const asUser = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${tester.accessToken}` } },
  });

  const paymentToken = hex(32);
  const placed = await asUser.rpc("create_order", {
    p_request_id: `e2e-${hex(8)}`,
    p_payment_token: paymentToken,
    p_email: tester.email,
    p_shipping_method: "hermes",
    p_items: [{ sky_id: offer.sky_id, condition: offer.condition, quantity: 1 }],
    p_address: {
      first_name: "Sandbox", last_name: "Test", company: null,
      street: "Teststrasse", house_number: "1", address_line_2: null,
      postal_code: "10115", city: "Berlin", country_code: "DE", phone: null,
    },
  });
  if (placed.error) throw new Error(`create_order: ${placed.error.code} ${placed.error.message}`);
  const row = (Array.isArray(placed.data) ? placed.data[0] : placed.data) as
    { order_id: number; order_number: string; total_amount: number };
  console.log(`  Bestellung ${row.order_number} (#${row.order_id}), ${row.total_amount} EUR`);

  const stamped = await admin.from("orders").select("commerce_mode").eq("id", row.order_id).single();
  const ok = stamped.data?.commerce_mode === "sandbox";
  console.log(`  ${ok ? "PASS" : "FAIL"}  commerce_mode = ${JSON.stringify(stamped.data?.commerce_mode)}`);
  if (!ok) throw new Error("the order was not stamped sandbox");

  // ---- the deployed function, with the tester's own token -----------------
  const response = await fetch(`${url}/functions/v1/${FUNCTION}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tester.accessToken}`,
      apikey: anonKey,
      Origin: env.SITE_URL ?? "http://localhost:3000",
    },
    body: JSON.stringify({ order_id: row.order_id, payment_token: paymentToken }),
  });
  const payload = await response.json();
  console.log(`\n  create-payment -> HTTP ${response.status}`);
  if (!response.ok) throw new Error(`create-payment: ${JSON.stringify(payload)}`);

  const attempt = await admin
    .from("payment_attempts")
    .select("id,provider_payment_id,status")
    .eq("order_id", row.order_id)
    .order("id", { ascending: false })
    .limit(1)
    .single();
  const sessionId = attempt.data?.provider_payment_id as string | undefined;

  // THE PROOF. Stripe issues `cs_test_` from a test key and `cs_live_` from a
  // live one; the prefix comes from Stripe, not from us.
  const isTest = typeof sessionId === "string" && sessionId.startsWith("cs_test_");
  console.log(`  ${isTest ? "PASS" : "FAIL"}  Stripe-Session ${sessionId?.slice(0, 12)}… -> ${
    isTest ? "cs_test_ = Sandbox-Schlüssel wurde benutzt" : "NICHT cs_test_"}`);
  if (!isTest) throw new Error("the session is not a test-mode session");

  console.log(`\n  Bezahlseite (Testkarte 4242 4242 4242 4242, beliebiges künftiges Datum):`);
  console.log(`\n  ${payload.url}\n`);
  console.log(`  Danach:  npm run verify:sandbox-e2e:staging -- --verify ${row.order_number}\n`);
}

/** The webhook half, read-only, after a real payment. */
async function report(admin: SupabaseClient, orderNumber: string): Promise<void> {
  if (!orderNumber) throw new Error("--verify needs an order number");
  const order = await admin
    .from("orders")
    .select("id,order_number,commerce_mode,payment_status,needs_resolution,total_amount")
    .eq("order_number", orderNumber)
    .single();
  if (order.error) throw new Error(`order ${orderNumber}: ${order.error.message}`);

  console.log(`\n== ${orderNumber} ==`);
  console.log(`  commerce_mode     ${order.data.commerce_mode}`);
  console.log(`  payment_status    ${order.data.payment_status}`);
  console.log(`  needs_resolution  ${order.data.needs_resolution}`);

  const attempts = await admin
    .from("payment_attempts")
    .select("id,status,provider_payment_id,amount")
    .eq("order_id", order.data.id)
    .order("id");
  for (const a of attempts.data ?? []) {
    console.log(`  Versuch ${a.id}: ${a.status} ${String(a.provider_payment_id).slice(0, 12)}… ${a.amount}`);
  }

  const events = await admin
    .from("payment_events")
    .select("provider_event_id,event_type,outcome,created_at")
    .order("id", { ascending: false })
    .limit(5);
  console.log("  letzte Webhook-Ereignisse:");
  for (const e of events.data ?? []) {
    console.log(`    ${e.event_type} -> ${e.outcome}`);
  }

  const reservations = await admin
    .from("order_reservations")
    .select("state,quantity")
    .eq("order_id", order.data.id);
  console.log(`  Reservierungen: ${JSON.stringify(reservations.data)}`);

  const inv = await admin.from("shop_inventory").select("quantity");
  const mv = await admin.from("inventory_movements").select("id", { count: "exact", head: true });
  console.log(`  Bestand ${inv.data?.reduce((s, r) => s + r.quantity, 0)} · Bewegungen ${mv.count}`);
}

/**
 * A normal account, a live shop, and no live key. Must refuse.
 *
 * The one path that would be catastrophic if it fell back: charging a
 * customer through the test account, or — worse in the other direction —
 * quietly completing an order nobody paid for.
 */
async function runFailClosedLive(
  admin: SupabaseClient,
  url: string,
  anonKey: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const profiles = await admin.from("profiles").select("id").limit(50);
  if (profiles.error) throw new Error(`profiles: ${profiles.error.message}`);

  let normal: string | null = null;
  for (const row of profiles.data ?? []) {
    const { data } = await admin.rpc("is_commerce_tester_for", { p_user_id: row.id });
    if (data === false) { normal = row.id as string; break; }
  }
  if (!normal) throw new Error("no non-tester account on staging");

  const user = await admin.auth.admin.getUserById(normal);
  const email = user.data.user?.email;
  if (!email) throw new Error(`account ${normal} has no email`);

  console.log(`  normales Konto: ${normal}  <${email}>`);
  console.log(`  payment_mode_for_user -> ${JSON.stringify(
    (await admin.rpc("payment_mode_for_user", { p_user_id: normal })).data,
  )}`);

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`generateLink: ${link.error.message}`);
  const asUser = createClient(url, anonKey, { auth: { persistSession: false } });
  const session = await asUser.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.data.properties!.hashed_token!,
  });
  if (session.error || !session.data.session) throw new Error("no session for the normal account");
  const token = session.data.session.access_token;

  const offers = await admin.rpc("shop_offers");
  const offer = (offers.data as { sky_id: string; condition: string; price: number; available: boolean }[])
    .filter((o) => o.available).sort((a, b) => a.price - b.price)[0];

  const paymentToken = hex(32);
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const placed = await client.rpc("create_order", {
    p_request_id: `e2e-live-${hex(8)}`,
    p_payment_token: paymentToken,
    p_email: email,
    p_shipping_method: "hermes",
    p_items: [{ sky_id: offer.sky_id, condition: offer.condition, quantity: 1 }],
    p_address: {
      first_name: "FailClosed", last_name: "Test", company: null,
      street: "Teststrasse", house_number: "1", address_line_2: null,
      postal_code: "10115", city: "Berlin", country_code: "DE", phone: null,
    },
  });
  if (placed.error) throw new Error(`create_order: ${placed.error.code} ${placed.error.message}`);
  const row = (Array.isArray(placed.data) ? placed.data[0] : placed.data) as
    { order_id: number; order_number: string };

  const stamped = await admin.from("orders").select("commerce_mode").eq("id", row.order_id).single();
  const stampOk = stamped.data?.commerce_mode === "live";
  console.log(`  Bestellung ${row.order_number} (#${row.order_id})`);
  console.log(`  ${stampOk ? "PASS" : "FAIL"}  commerce_mode = ${JSON.stringify(stamped.data?.commerce_mode)} (erwartet "live")`);

  const response = await fetch(`${url}/functions/v1/${FUNCTION}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      Origin: env.SITE_URL ?? "http://localhost:3000",
    },
    body: JSON.stringify({ order_id: row.order_id, payment_token: paymentToken }),
  });
  const payload = await response.json();
  const refused = response.status === 503 && payload?.error === "provider_unconfigured";
  console.log(`  ${refused ? "PASS" : "FAIL"}  create-payment -> HTTP ${response.status} ${JSON.stringify(payload)}`);

  const attempt = await admin
    .from("payment_attempts")
    .select("provider_payment_id")
    .eq("order_id", row.order_id)
    .order("id", { ascending: false })
    .limit(1);
  const sessionId = attempt.data?.[0]?.provider_payment_id ?? null;
  const noSandbox = sessionId === null;
  console.log(`  ${noSandbox ? "PASS" : "FAIL"}  keine Stripe-Session angelegt: ${JSON.stringify(sessionId)}`);

  if (!stampOk || !refused || !noSandbox) throw new Error("fail-closed check did not hold");
  console.log("\n  Fail-closed bestätigt: kein Rückfall auf Sandbox.");
}

main().catch((error) => {
  console.error(`\nverify:sandbox-e2e fehlgeschlagen: ${(error as Error).message}`);
  process.exit(1);
});
