/**
 * verify:payment-mode — the 0077 matrix, against the real Staging database.
 *
 * STAGING ONLY: `requireStaging()` compares origin AND service-role key
 * against `.env.staging` before a connection exists.
 *
 * WHAT IT WRITES, AND WHAT IT PUTS BACK
 *
 * One column: `commerce_settings.mode`. The matrix has the shop switch on one
 * axis, so the switch has to move — there is no way to observe the `live` row
 * without the shop being `live` for the length of one read. The original
 * value is captured before anything moves and restored in `finally`, so a
 * failed assertion leaves the switch where it was found.
 *
 * NOTHING ELSE IS WRITTEN. No order, no attempt, no reservation, no inventory
 * movement, no tester granted or withdrawn. Every other call is a read of a
 * `stable` function.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { readEnvFile, requireStaging } from "./lib/staging-guard.mts";

type ShopMode = "closed" | "sandbox" | "live";
const SHOP_MODES: readonly ShopMode[] = ["closed", "sandbox", "live"];

/** Never a real account, therefore never a tester. */
const SYNTHETIC_NORMAL = "00000000-0000-4000-8000-000000000001";

let passed = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failures.push(`${label}: ist ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(62)} ${JSON.stringify(actual)}`);
}

async function paymentMode(db: SupabaseClient, userId: string | null): Promise<unknown> {
  const { data, error } = await db.rpc("payment_mode_for_user", { p_user_id: userId });
  if (error) throw new Error(`payment_mode_for_user: ${error.code} ${error.message}`);
  return data;
}

async function setShopMode(db: SupabaseClient, mode: ShopMode): Promise<void> {
  const { error } = await db.from("commerce_settings").update({ mode }).eq("id", true);
  if (error) throw new Error(`commerce_settings.mode := ${mode}: ${error.code} ${error.message}`);
  const now = await db.rpc("commerce_mode");
  if (now.data !== mode) throw new Error(`shop mode did not take: wanted ${mode}, read ${now.data}`);
}

async function main(): Promise<void> {
  requireStaging("verify:payment-mode");

  const env = readEnvFile(".env.staging");
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- who to ask about -----------------------------------------------------
  const profiles = await db.from("profiles").select("id").limit(50);
  if (profiles.error) throw new Error(`profiles: ${profiles.error.message}`);

  let tester: string | null = null;
  let normal: string | null = null;
  for (const row of profiles.data ?? []) {
    const { data } = await db.rpc("is_commerce_tester_for", { p_user_id: row.id });
    if (data === true && tester === null) tester = row.id as string;
    if (data === false && normal === null) normal = row.id as string;
    if (tester && normal) break;
  }
  if (!tester) throw new Error("no commerce tester on staging — cannot verify the tester rows");

  console.log(`\n  Tester          ${tester}`);
  console.log(`  echtes Nicht-Testerkonto ${normal ?? "keines gefunden"}`);
  console.log(`  synthetisches Konto      ${SYNTHETIC_NORMAL}\n`);

  const before = await db.from("commerce_settings").select("mode").eq("id", true).single();
  if (before.error) throw new Error(`commerce_settings: ${before.error.message}`);
  const original = before.data.mode as ShopMode;
  console.log(`  Shop-Schalter vorgefunden: ${original} — wird am Ende wiederhergestellt\n`);

  try {
    for (const shop of SHOP_MODES) {
      await setShopMode(db, shop);
      console.log(`== Shop-Schalter: ${shop} ==`);

      // THE INVARIANT: a tester is in the sandbox under every shop mode.
      check(`Tester + Shop ${shop} -> sandbox`, await paymentMode(db, tester), "sandbox");

      const expected = shop === "live" ? "live" : null;
      if (normal) {
        check(`normales Konto + Shop ${shop}`, await paymentMode(db, normal), expected);
      }
      check(`synthetisches Konto + Shop ${shop}`, await paymentMode(db, SYNTHETIC_NORMAL), expected);
      check(`Gast (ohne Konto) + Shop ${shop}`, await paymentMode(db, null), expected);
      console.log("");
    }

    // ---- the row that matters most: live shop, tester's order stays sandbox --
    await setShopMode(db, "live");
    console.log("== Shop live: bestehende Bestellungen ==");

    const orders = await db
      .from("orders")
      .select("id,user_id,commerce_mode")
      .eq("commerce_mode", "sandbox")
      .order("id", { ascending: false })
      .limit(200);
    if (orders.error) throw new Error(`orders: ${orders.error.message}`);

    let testerOrder: { id: number; user_id: string } | null = null;
    let strangerOrder: { id: number; user_id: string | null } | null = null;
    for (const row of orders.data ?? []) {
      const { data } = await db.rpc("is_commerce_tester_for", { p_user_id: row.user_id });
      if (data === true && !testerOrder) testerOrder = row as { id: number; user_id: string };
      if (data !== true && !strangerOrder) strangerOrder = row as { id: number; user_id: string | null };
      if (testerOrder && strangerOrder) break;
    }

    if (testerOrder) {
      check(
        `Sandbox-Order ${testerOrder.id} eines Testers bleibt zahlbar`,
        await (async () => (await db.rpc("order_payment_mode", { p_order_id: testerOrder!.id })).data)(),
        "sandbox",
      );
    } else {
      console.log("  ----  kein Sandbox-Auftrag eines Testers vorhanden");
    }

    if (strangerOrder) {
      check(
        `alte Sandbox-Order ${strangerOrder.id} eines Nicht-Testers wird NICHT live`,
        await (async () => (await db.rpc("order_payment_mode", { p_order_id: strangerOrder!.id })).data)(),
        null,
      );
    } else {
      console.log("  ----  keine Sandbox-Order eines Nicht-Testers vorhanden");
    }
  } finally {
    // Always, including after a thrown assertion.
    await setShopMode(db, original);
    const back = await db.rpc("commerce_mode");
    console.log(`\n  Shop-Schalter zurückgesetzt auf: ${back.data}`);
    if (back.data !== original) {
      console.error(`  ACHTUNG: konnte den Schalter nicht zurücksetzen (${original} erwartet)`);
    }
  }

  console.log(`\n${passed}/${passed + failures.length} bestanden`);
  for (const f of failures) console.log(`  - ${f}`);
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(`\nverify:payment-mode fehlgeschlagen: ${(error as Error).message}`);
  process.exit(1);
});
