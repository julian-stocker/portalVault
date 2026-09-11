/**
 * A read-only census of the staging project.
 *
 *   npm run snapshot:staging
 *
 * Every seed step in this repository is followed by the same question — what
 * is in there now, and is the payment smoke history still intact? Answering it
 * by hand each time invites a different query each time, which is how a
 * "nothing changed" claim quietly stops being checked.
 *
 * WRITES NOTHING. Only `select … head: true` for counts and three narrow reads
 * for the fixtures that must survive. It is guarded all the same: a census
 * pointed at production would print production's shape into somebody's
 * terminal, and that is not a report anyone asked for.
 */
import { createClient } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";

/** Everything worth counting, in the order the report reads best. */
const TABLES = [
  "series",
  "categories",
  "skylanders",
  "characters",
  "catalog_editorial",
  "shop_inventory",
  "inventory_movements",
  "shop_admins",
  "profiles",
  "collection_items",
  "orders",
  "order_lines",
  "order_reservations",
  "payment_attempts",
  "payment_events",
] as const;

/**
 * The three orders the staging smoke history rests on (PROJECT_STATUS.md).
 *
 * `SI-2026-001041` is the flagged one — paid, nothing booked, shipping locked.
 * It is the single most valuable row on staging: it is the only fixture that
 * exercises `needs_resolution`, and it cannot be recreated without a real
 * late-payment sequence.
 */
const PROTECTED_ORDERS = [
  { number: "SI-2026-001041", payment: "paid", fulfillment: "unfulfilled", flagged: true },
  { number: "SI-2026-001022", payment: "paid", fulfillment: "shipped", flagged: false },
  { number: "SI-2026-001040", payment: "paid", fulfillment: "shipped", flagged: false },
] as const;

/** The two figures the payment and RLS smokes hang off. */
const PROTECTED_FIGURES = ["SKY-9101", "SKY-9998"] as const;

async function main(): Promise<void> {
  requireStaging("snapshot:staging");

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  console.log("\nCounts");
  console.log("------");
  for (const table of TABLES) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    console.log(`  ${table.padEnd(22)} ${error ? `ERR ${error.code ?? ""}` : count}`);
  }

  console.log("\nProtected smoke history");
  console.log("-----------------------");
  let intact = true;
  for (const expected of PROTECTED_ORDERS) {
    const { data } = await db
      .from("orders")
      .select("order_number, payment_status, fulfillment_status, needs_resolution")
      .eq("order_number", expected.number)
      .maybeSingle();

    const ok =
      data !== null &&
      data.payment_status === expected.payment &&
      data.fulfillment_status === expected.fulfillment &&
      data.needs_resolution === expected.flagged;
    if (!ok) intact = false;

    console.log(
      `  ${ok ? "OK  " : "FAIL"} ${expected.number}  ` +
        (data
          ? `${data.payment_status} / ${data.fulfillment_status} / needs_resolution=${data.needs_resolution}`
          : "MISSING"),
    );
  }

  // The fixture positions, by inventory id, so a changed quantity is visible
  // rather than merely absent.
  const { data: fixtures } = await db
    .from("shop_inventory")
    .select("id, sky_id, condition, quantity, reserved, sale_price, is_listed, note")
    .in("sky_id", [...PROTECTED_FIGURES])
    .order("id");

  console.log("\nProtected fixture positions");
  console.log("---------------------------");
  for (const row of fixtures ?? []) {
    console.log(
      `  id=${String(row.id).padEnd(3)} ${row.sky_id} / ${String(row.condition).padEnd(6)} ` +
        `qty=${row.quantity} reserved=${row.reserved} price=${row.sale_price ?? "auto"} ` +
        `listed=${row.is_listed}  ${row.note ?? ""}`,
    );
  }

  // Nothing may ever be written to this column by a seed or an import
  // (ADR-0046). Counting it is how that stays a fact rather than a belief.
  const { count: overrides } = await db
    .from("skylanders")
    .select("*", { count: "exact", head: true })
    .not("image_override_path", "is", null);
  console.log(`\n  image_override_path set on: ${overrides} figure(s)`);

  console.log(`\n  smoke history intact: ${intact ? "YES" : "NO"}\n`);
  if (!intact) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`\nSnapshot failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
