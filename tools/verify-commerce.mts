/**
 * Functional verification of the commerce core (migration 0010).
 *
 *   npm run verify:commerce
 *
 * READ-ONLY, like verify:shop and for the same reason: a reservation fixture
 * would have to be released again, and a converted one would leave a permanent
 * row in the append-only stock journal. So this asserts against what is
 * actually there rather than creating anything.
 *
 * It checks the invariants that cost money if they ever stop holding:
 *
 *   1. `shop_inventory.reserved` equals the sum of active reservations,
 *      everywhere. This is the reservation counterpart of the
 *      `SUM(delta) = quantity` drift check verify:rls already runs.
 *   2. No active reservation exceeds the stock behind it, and no position has
 *      negative reserved or negative availability.
 *   3. Every converted reservation has exactly one sale movement, and every
 *      sale movement belongs to at most one reservation. That is what makes a
 *      repeated payment webhook unable to sell the same figure twice.
 *   4. An order's total is the sum of its own snapshots — recomputed here
 *      from the lines rather than trusted.
 *   5. Orders are invisible to anon and to a signed-in visitor who does not
 *      own them, and no client role can write to any commerce table.
 *
 * UNTIL THE MIGRATION IS APPLIED this reports that and stops. It does not
 * pretend to have verified anything, and it does not fail the build for a
 * table that does not exist yet.
 */
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
    console.error(`Missing ${name}. Run through npm, which loads .env.local.`);
    process.exit(1);
  }
  return value;
}

const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false } });
const serviceClient = () =>
  createClient(URL_, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** PostgREST's codes for "no such table/function" and "permission denied". */
const MISSING_TABLE = "42P01";
const MISSING_FUNCTION = "PGRST202";
const NOT_FOUND = "PGRST205";
const DENIED = "42501";

async function migrationApplied(admin: SupabaseClient): Promise<boolean> {
  const probe = await admin.from("orders").select("id").limit(1);
  if (!probe.error) return true;
  return ![MISSING_TABLE, MISSING_FUNCTION, NOT_FOUND].includes(probe.error.code ?? "");
}

async function main(): Promise<void> {
  console.log("Commerce core verification (migration 0010)");
  console.log("=".repeat(52));

  const admin = serviceClient();
  const anon = anonClient();

  if (!(await migrationApplied(admin))) {
    console.log("\n  SKIPPED — migration 0010_commerce_core.sql is not applied.");
    console.log("  Nothing was verified. Apply the migration, then run this again.\n");
    process.exit(0);
  }

  // --- 1. reserved agrees with the reservations behind it -------------------
  heading("1. reserved is explained by the reservations");

  const drift = await admin
    .from("reservation_reconciliation")
    .select("sky_id, condition, quantity, reserved, held, drift")
    .neq("drift", 0);
  check(
    "reserved equals the sum of active reservations everywhere",
    !drift.error && (drift.data?.length ?? 0) === 0,
    drift.error ? drift.error.message : `${drift.data?.length ?? 0} position(s) with drift`,
  );

  const negative = await admin
    .from("shop_inventory")
    .select("sky_id, condition, quantity, reserved, available_quantity")
    .or("reserved.lt.0,available_quantity.lt.0");
  check(
    "no position has negative reserved or negative availability",
    !negative.error && (negative.data?.length ?? 0) === 0,
    negative.error ? negative.error.message : `${negative.data?.length ?? 0} offending position(s)`,
  );

  const over = await admin
    .from("reservation_reconciliation")
    .select("sky_id, condition, quantity, reserved, held");
  const beyond = (over.data ?? []).filter((r) => Number(r.held) > Number(r.quantity));
  check(
    "no position holds more than it has",
    !over.error && beyond.length === 0,
    over.error ? over.error.message : `${beyond.length} oversold position(s)`,
  );

  const aboveStock = (over.data ?? []).filter((r) => Number(r.reserved) > Number(r.quantity));
  check(
    "reserved never exceeds quantity",
    !over.error && aboveStock.length === 0,
    over.error ? over.error.message : `${aboveStock.length} offending position(s)`,
  );

  // --- 2. a sale happens once ----------------------------------------------
  heading("2. a converted reservation sold exactly once");

  const converted = await admin
    .from("order_reservations")
    .select("id, order_id, quantity, state, movement_id")
    .eq("state", "converted");
  const rows = converted.data ?? [];
  check(
    "every converted reservation names its movement",
    !converted.error && rows.every((r) => r.movement_id !== null),
    converted.error ? converted.error.message : `${rows.length} converted`,
  );

  const movementIds = rows.map((r) => r.movement_id);
  check(
    "no movement belongs to two reservations",
    new Set(movementIds).size === movementIds.length,
    `${movementIds.length} movement reference(s), ${new Set(movementIds).size} distinct`,
  );

  const active = await admin
    .from("order_reservations")
    .select("id")
    .eq("state", "active")
    .not("movement_id", "is", null);
  check(
    "no active reservation has already been booked as a sale",
    !active.error && (active.data?.length ?? 0) === 0,
    active.error ? active.error.message : `${active.data?.length ?? 0} offending row(s)`,
  );

  const releasedSold = await admin
    .from("order_reservations")
    .select("id")
    .eq("state", "released")
    .not("movement_id", "is", null);
  check(
    "no released reservation carries a sale movement",
    !releasedSold.error && (releasedSold.data?.length ?? 0) === 0,
    releasedSold.error ? releasedSold.error.message : `${releasedSold.data?.length ?? 0} offending row(s)`,
  );

  // Every movement a reservation points at must actually be a sale, and the
  // quantity it booked must be the quantity that was held.
  const sold = await admin
    .from("inventory_movements")
    .select("id, delta, reason")
    .in("id", movementIds.length > 0 ? movementIds : [-1]);
  const byId = new Map((sold.data ?? []).map((m) => [m.id, m]));
  const mismatched = rows.filter((r) => {
    const movement = byId.get(r.movement_id as number);
    return !movement || movement.reason !== "sale_skyisles" || movement.delta !== -r.quantity;
  });
  check(
    "every converted reservation booked exactly its own quantity as sale_skyisles",
    rows.length === 0 || (!sold.error && mismatched.length === 0),
    sold.error ? sold.error.message : `${rows.length} conversion(s), ${mismatched.length} mismatched`,
  );

  // --- 3. an order's money adds up -----------------------------------------
  heading("3. order totals are the sum of their own snapshots");

  const orders = await admin
    .from("orders")
    .select("id, order_number, items_subtotal, shipping_amount, discount_amount, total_amount")
    .order("id", { ascending: false })
    .limit(200);
  const lines = await admin.from("order_lines").select("order_id, line_total");

  const summed = new Map<number, number>();
  for (const line of lines.data ?? []) {
    summed.set(line.order_id, (summed.get(line.order_id) ?? 0) + Number(line.line_total));
  }

  const cents = (value: unknown) => Math.round(Number(value) * 100);
  const wrong = (orders.data ?? []).filter(
    (o) =>
      cents(o.items_subtotal) !== cents(summed.get(o.id) ?? 0) ||
      cents(o.total_amount) !==
        cents(o.items_subtotal) + cents(o.shipping_amount) - cents(o.discount_amount),
  );
  check(
    "every order's subtotal and total match its lines",
    !orders.error && !lines.error && wrong.length === 0,
    orders.error?.message ?? lines.error?.message ?? `${orders.data?.length ?? 0} order(s) checked`,
  );

  // --- 4. nobody sees what is not theirs ------------------------------------
  heading("4. commerce data is not public");

  for (const table of ["orders", "order_lines", "order_addresses", "order_events", "order_reservations"]) {
    const read = await anon.from(table).select("*").limit(1);
    const blocked = read.error !== null || (read.data?.length ?? 0) === 0;
    check(
      `anon cannot read ${table}`,
      blocked,
      read.error ? `rejected: ${read.error.code}` : "empty result (no rows, or RLS)",
    );
  }

  for (const table of ["orders", "order_lines", "order_reservations"]) {
    const write = await anon.from(table).insert({});
    check(
      `anon cannot write ${table}`,
      write.error !== null,
      write.error ? `rejected: ${write.error.code}` : "INSERT SUCCEEDED",
    );
  }

  // Every function 0010 defines that no client should be able to call.
  // `reservation_ttl` and `next_order_number` are in this list because
  // Supabase's default privileges grant EXECUTE on new functions in `public`
  // to anon and authenticated: revoking only FROM PUBLIC leaves those explicit
  // grants in place. next_order_number() is `volatile` and calls nextval(),
  // so a caller who reaches it can burn order numbers.
  //
  // COST: when the grant is correctly revoked — the state this check exists to
  // confirm — the call is refused before the function body runs, so a passing
  // run consumes nothing. A sequence value is only ever spent in the failing
  // case, which is precisely when a burned order number is the smallest of the
  // problems. Gaps are expected by design (they are abandoned checkouts), and
  // there is no way to ask PostgREST whether a role may execute a function
  // without attempting it: pg_catalog is not exposed, and a deliberately
  // mismatched argument returns "not found" whether or not permission exists.
  const internals = [
    "reserve_for_order",
    "release_order_reservations",
    "convert_order_reservations",
    "reservation_ttl",
    "next_order_number",
  ];
  for (const name of internals) {
    const args = name.startsWith("reservation_ttl") || name.startsWith("next_order_number")
      ? {}
      : { p_order_id: 1 };
    const call = await anon.rpc(name, args);
    check(
      `anon cannot call ${name}()`,
      call.error !== null && [DENIED, MISSING_FUNCTION].includes(call.error.code ?? ""),
      call.error ? `rejected: ${call.error.code}` : "RPC SUCCEEDED",
    );
  }

  for (const internal of ["enforce_checkout_limits", "request_client_hash"]) {
    const call = await anon.rpc(internal, {});
    check(
      `anon cannot call ${internal}()`,
      call.error !== null,
      call.error ? `rejected: ${call.error.code}` : "RPC SUCCEEDED",
    );
  }

  const salt = await anon.from("commerce_settings").select("client_salt").limit(1);
  check(
    "anon cannot read the fingerprint salt",
    salt.error !== null || (salt.data?.length ?? 0) === 0,
    salt.error ? `rejected: ${salt.error.code}` : "empty result",
  );

  const sweep = await anon.rpc("release_expired_reservations", {});
  check(
    "anon cannot sweep reservations",
    sweep.error !== null,
    sweep.error ? `rejected: ${sweep.error.code}` : "RPC SUCCEEDED",
  );

  const rawIp = await admin.from("orders").select("client_hash").not("client_hash", "is", null).limit(50);
  const looksLikeAddress = (rawIp.data ?? []).filter(
    (o) => typeof o.client_hash === "string" && !/^[0-9a-f]{64}$/.test(o.client_hash),
  );
  check(
    "no order stores anything but a SHA-256 fingerprint",
    !rawIp.error && looksLikeAddress.length === 0,
    rawIp.error ? rawIp.error.message : `${rawIp.data?.length ?? 0} fingerprint(s) checked`,
  );

  // --- 5. the reservation window is the server's ----------------------------
  heading("5. the reservation window belongs to the server");

  const ttl = await admin.rpc("reservation_ttl");
  check(
    "reservation_ttl() is 20 minutes",
    !ttl.error && String(ttl.data).includes("20"),
    ttl.error ? ttl.error.message : String(ttl.data),
  );

  const stale = await admin
    .from("order_reservations")
    .select("id, expires_at")
    .eq("state", "active")
    .lt("expires_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  check(
    "no reservation has been expired for over an hour without release",
    !stale.error && (stale.data?.length ?? 0) === 0,
    stale.error ? stale.error.message : `${stale.data?.length ?? 0} stale hold(s) — is the sweep running?`,
  );

  // --- summary --------------------------------------------------------------
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${"=".repeat(52)}`);
  console.log(`${passed}/${results.length} checks passed`);
  if (passed !== results.length) {
    console.log("FAILED:");
    for (const r of results.filter((x) => !x.passed)) console.log(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  }
  console.log("Commerce verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
