/**
 * Runtime proof for 0069 and 0070, against Staging (V4.7).
 *
 * WHAT THIS EXISTS FOR
 *
 * `settled` closes a purchase position without an inventory movement. For a
 * portal that is the truth. For a catalog figure it would be a door straight
 * past the inventory ledger — closed, never booked, stock short by one — so
 * `seller_set_purchase_item_state` refuses it whenever the row has a
 * `sky_id`.
 *
 * That refusal was until now only asserted against the TEXT of the
 * migration. This calls the function and watches it say no.
 *
 * WHAT IT TOUCHES
 *
 * One test purchase, flagged `is_test`, holding two positions it creates
 * itself: one catalog figure and one non-catalog line. Both are removed and
 * the purchase deleted before the tool exits. NOTHING ELSE IS WRITTEN — in
 * particular nothing is ever booked, so no `inventory_movement` is created
 * and no quantity moves. Stock and the ledger are counted before and after
 * and must be identical.
 *
 * The 109 reopened legacy positions are read, never written, and are counted
 * at both ends too.
 *
 * THE OPERATOR IS REMOVED IN `finally`, whatever happens — a failed check
 * must not leave an account behind that can act as the seller.
 *
 * Staging only: `requireStaging()` compares origin AND service-role key
 * against `.env.staging` before a connection exists.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} fehlt — mit --env-file=.env.staging starten.`);
  return value;
};
const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false } });
const serviceClient = () =>
  createClient(URL_, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const RUN = Date.now().toString(36);

/** The five orders 0067 reopened, by the fingerprint both projects share. */
const REOPENED = [
  "b12a36227a55a52afdb8411bba28e26232a2af733b192bfc367eec735052b49e",
  "9fd2e9ba6adbe7ae78f983082f7dca3228d51b40ef556ba507e713a285041e0d",
  "263f65622db1f34c51b12454892d38a809fd1dc3a532f13051eae0eb0ef5d381",
  "efd427bbe67c0fb651f41e7095208700a6db2b154b24d0d392ab4e6cc32abf92",
  "77e90e02a65060f203e0572dee98d33da6e877d0ccfc8285b7560de81faaf225",
];

const results: { name: string; passed: boolean; detail: string }[] = [];
function check(name: string, passed: boolean, detail = "") {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const heading = (t: string) => console.log(`\n=== ${t} ===`);

/** Stop the moment something is wrong, before anything else is written. */
class Halt extends Error {}
function must(name: string, passed: boolean, detail = "") {
  check(name, passed, detail);
  if (!passed) throw new Halt(name);
}

type Snapshot = { quantity: number; reserved: number; movements: number;
                  reopened: number; withMovement: number };

async function snapshot(admin: SupabaseClient): Promise<Snapshot> {
  const inv = await admin.from("shop_inventory").select("quantity, reserved");
  if (inv.error) throw new Error(`shop_inventory: ${inv.error.message}`);
  const moves = await admin.from("inventory_movements")
    .select("id", { count: "exact", head: true });
  if (moves.error) throw new Error(`inventory_movements: ${moves.error.message}`);

  const orders = await admin.from("purchases").select("id")
    .in("import_fingerprint", REOPENED);
  if (orders.error) throw new Error(`purchases: ${orders.error.message}`);
  const ids = orders.data.map((r) => r.id as number);
  const items = await admin.from("purchase_items")
    .select("state, movement_id").in("purchase_id", ids);
  if (items.error) throw new Error(`purchase_items: ${items.error.message}`);

  return {
    quantity: inv.data.reduce((s, r) => s + Number(r.quantity), 0),
    reserved: inv.data.reduce((s, r) => s + Number(r.reserved), 0),
    movements: moves.count ?? -1,
    reopened: items.data.filter((r) => r.state === "ordered").length,
    withMovement: items.data.filter((r) => r.movement_id !== null).length,
  };
}

const show = (s: Snapshot) =>
  `${s.quantity} Stück · ${s.reserved} reserviert · ${s.movements} Bewegungen · `
  + `${s.reopened} Legacy ordered · ${s.withMovement} davon mit movement_id`;

async function main(): Promise<void> {
  requireStaging("verify:settled");

  const admin = serviceClient();
  let operator: { client: SupabaseClient; user: User } | null = null;
  let sellerId: number | null = null;
  let purchaseId: number | null = null;

  const before = await snapshot(admin);
  heading("Vorher");
  console.log(`  ${show(before)}`);

  try {
    /* ---------------------------------------------------------------- setup */
    heading("Setup");
    const seller = await admin.from("sellers").select("id").eq("is_active", true).single();
    if (seller.error) throw new Error(`active seller: ${seller.error.message}`);
    sellerId = seller.data.id as number;

    const credentials = {
      email: `settled-check-${RUN}@skyisles.invalid`,
      password: `settled-${RUN}-${Math.random().toString(36).slice(2)}`,
    };
    const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
    if (created.error) throw new Error(`createUser: ${created.error.message}`);
    const client = anonClient();
    const signIn = await client.auth.signInWithPassword(credentials);
    if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
    operator = { client, user: created.data.user };

    const membership = await admin.from("seller_operators").insert({
      seller_id: sellerId, user_id: operator.user.id, note: "verify:settled",
    });
    if (membership.error) throw new Error(`seller_operators: ${membership.error.message}`);
    console.log("  ein temporärer Seller-Operator");

    /*
     * One catalog figure, taken from the catalog rather than named: a
     * hard-coded SKY-ID would tie this tool to one import.
     */
    const figure = await admin.from("skylanders").select("sky_id, name")
      .order("sky_id").limit(1).single();
    if (figure.error) throw new Error(`catalog: ${figure.error.message}`);
    const skyId = String(figure.data.sky_id);

    const made = await operator.client.rpc("seller_create_purchase_with_items", {
      p_purchased_at: null,
      p_total_cost: 1,
      p_note: `verify:settled ${RUN}`,
      p_is_test: true,
      p_items: [{ sky_id: skyId, condition: "loose" }],
    });
    if (made.error) throw new Error(`create purchase: ${made.error.message}`);
    purchaseId = Number(made.data);
    console.log(`  Testeinkauf #${purchaseId} (is_test), eine Figur ${skyId}`);

    const added = await operator.client.rpc("seller_add_purchase_item", {
      p_purchase_id: purchaseId, p_sky_id: null,
      p_raw_name: `Verify-Portal ${RUN}`, p_condition: "loose",
    });
    if (added.error) throw new Error(`add non-catalog item: ${added.error.message}`);
    console.log("  eine Nicht-Katalog-Position ohne sky_id");

    const rows = await admin.from("purchase_items")
      .select("id, sky_id, state, movement_id").eq("purchase_id", purchaseId).order("id");
    if (rows.error) throw new Error(`items: ${rows.error.message}`);
    const figureItem = rows.data.find((r) => r.sky_id !== null);
    const portalItem = rows.data.find((r) => r.sky_id === null);
    if (!figureItem || !portalItem) throw new Error("test items missing");

    /* -------------------------------------------------- 1. settled_count */
    heading("1. seller_orderbook_ledger liefert settled_count (0070)");
    const ledger = async () => {
      const r = await operator!.client.rpc("seller_orderbook_ledger", {
        p_year: null, p_month: null, p_search: `verify:settled ${RUN}`,
        p_undated: true, p_status: "any",
      });
      if (r.error) throw new Error(`ledger: ${r.error.message}`);
      const root = r.data as { purchases?: Record<string, unknown>[] };
      return (root.purchases ?? []).find((p) => Number(p.id) === purchaseId);
    };
    const first = await ledger();
    must("der Testeinkauf ist im Ledger", first !== undefined);
    must("die Zeile trägt settled_count", "settled_count" in (first ?? {}),
      `Felder: ${Object.keys(first ?? {}).filter((k) => k.endsWith("_count")).join(", ")}`);
    check("settled_count ist zunächst 0", Number(first!.settled_count) === 0,
      `settled_count=${first!.settled_count}`);
    check("open_count zählt beide Positionen", Number(first!.open_count) === 2,
      `open_count=${first!.open_count} von item_count=${first!.item_count}`);
    check("is_open ist wahr", first!.is_open === true);

    /* ------------------------------------------------------- 2. THE LOCK */
    heading("2. settled wird für eine Katalogfigur verweigert");
    const locked = await operator.client.rpc("seller_set_purchase_item_state", {
      p_item_id: figureItem.id, p_state: "settled",
    });
    must("der direkte RPC-Aufruf schlägt fehl", locked.error !== null,
      locked.error ? `${locked.error.code}` : "ER WURDE ANGENOMMEN");
    check("und sagt warum",
      /never settled/.test(locked.error?.message ?? ""),
      String(locked.error?.message ?? "").slice(0, 60));

    const after = await admin.from("purchase_items")
      .select("state, movement_id").eq("id", figureItem.id).single();
    must("die Figur steht unverändert da",
      after.data?.state === figureItem.state && after.data?.movement_id === null,
      `state=${after.data?.state} movement_id=${after.data?.movement_id ?? "NULL"}`);

    /* ------------------------------------ 3. accepted for a non-catalog */
    heading("3. settled wird für eine Nicht-Katalog-Position angenommen");
    const arrived = await operator.client.rpc("seller_set_purchase_item_state", {
      p_item_id: portalItem.id, p_state: "arrived",
    });
    must("Bestellt → Angekommen", arrived.error === null, arrived.error?.message ?? "");
    const settle = await operator.client.rpc("seller_set_purchase_item_state", {
      p_item_id: portalItem.id, p_state: "settled",
    });
    must("Angekommen → Erledigt", settle.error === null, settle.error?.message ?? "");
    const portalAfter = await admin.from("purchase_items")
      .select("state, movement_id").eq("id", portalItem.id).single();
    check("der Zustand steht in der Zeile", portalAfter.data?.state === "settled",
      `state=${portalAfter.data?.state}`);
    must("und sie besitzt keine Bewegung", portalAfter.data?.movement_id === null,
      `movement_id=${portalAfter.data?.movement_id ?? "NULL"}`);

    /* ------------------------------- 4./5. counted, and no longer open */
    heading("4. settled zählt nicht als booked · 5. und nicht mehr als offen");
    const second = await ledger();
    check("settled_count ist jetzt 1", Number(second!.settled_count) === 1,
      `settled_count=${second!.settled_count}`);
    check("booked_count bleibt 0", Number(second!.booked_count) === 0,
      `booked_count=${second!.booked_count}`);
    check("open_count fiel von 2 auf 1", Number(second!.open_count) === 1,
      `open_count=${second!.open_count}`);
    check("der Einkauf ist noch offen — die Figur ist es", second!.is_open === true);

    /* The purchase stops being open once its one figure is gone too. The
       figure is REMOVED, never booked: booking would create a movement. */
    const dropped = await operator.client.rpc("seller_remove_purchase_item",
      { p_item_id: figureItem.id });
    must("die Testfigur lässt sich entfernen (statt sie zu buchen)",
      dropped.error === null, dropped.error?.message ?? "");
    const third = await ledger();
    check("ohne die Figur ist der Einkauf nicht mehr is_open", third!.is_open === false,
      `is_open=${third!.is_open}`);
    check("eine erledigte Position allein hält ihn nicht offen",
      Number(third!.open_count) === 0 && Number(third!.settled_count) === 1,
      `open_count=${third!.open_count} settled_count=${third!.settled_count}`);
    check("und sie gilt weiterhin nicht als eingebucht",
      Number(third!.booked_count) === 0, `booked_count=${third!.booked_count}`);

    /* --------------------------------------------------- Testdaten weg */
    heading("Testdaten entfernen");
    const rmPortal = await operator.client.rpc("seller_remove_purchase_item",
      { p_item_id: portalItem.id });
    check("Nicht-Katalog-Position entfernt", rmPortal.error === null,
      rmPortal.error?.message ?? "");
    const rmPurchase = await operator.client.rpc("seller_delete_purchase", { p_id: purchaseId });
    check("Testeinkauf gelöscht", rmPurchase.error === null, rmPurchase.error?.message ?? "");
    if (rmPurchase.error === null) purchaseId = null;
  } catch (error) {
    if (!(error instanceof Halt)) {
      console.error(`\n  ABBRUCH: ${error instanceof Error ? error.message : String(error)}`);
      results.push({ name: "Durchlauf ohne Ausnahme", passed: false, detail: String(error) });
    } else {
      console.error("\n  ABBRUCH nach einer fehlgeschlagenen Prüfung — nichts weiter getestet.");
    }
  } finally {
    /* -------------------------------------------------------------- cleanup */
    heading("Aufräumen");
    if (purchaseId !== null && operator) {
      /*
       * A check failed before the tool could tidy up. Remove the test
       * purchase with the service role rather than leaving it: it is
       * `is_test`, it holds no movement, and nothing else refers to it.
       */
      const left = await admin.from("purchase_items").select("id").eq("purchase_id", purchaseId);
      for (const row of left.data ?? []) {
        await admin.from("purchase_items").delete().eq("id", row.id as number);
      }
      const gone = await admin.from("purchases").delete().eq("id", purchaseId);
      console.log(`  Testeinkauf #${purchaseId} nachträglich entfernt${gone.error ? ` (${gone.error.message})` : ""}`);
    }
    if (operator && sellerId !== null) {
      await admin.from("seller_operators")
        .delete().eq("seller_id", sellerId).eq("user_id", operator.user.id);
      await admin.auth.admin.deleteUser(operator.user.id);
      console.log("  temporärer Operator entfernt");
    }
  }

  /* ------------------------------------------------------------ nachher */
  const after = await snapshot(admin);
  heading("Nachher");
  console.log(`  ${show(after)}`);
  check("Bestand unverändert", after.quantity === before.quantity,
    `${before.quantity} → ${after.quantity}`);
  check("reserviert unverändert", after.reserved === before.reserved,
    `${before.reserved} → ${after.reserved}`);
  check("keine neue Lagerbewegung", after.movements === before.movements,
    `${before.movements} → ${after.movements}`);
  check("die 109 Legacy-Positionen weiterhin ordered", after.reopened === 109,
    `${after.reopened}`);
  check("keine davon mit movement_id", after.withMovement === 0, `${after.withMovement}`);

  const stray = await admin.from("purchases").select("id, note").like("note", "verify:settled%");
  check("keine Test-Einkäufe zurückgeblieben", (stray.data?.length ?? 0) === 0,
    `${stray.data?.length ?? 0} gefunden`);
  const strayItems = await admin.from("purchase_items").select("id").like("raw_name", "Verify-Portal%");
  check("keine Test-Positionen zurückgeblieben", (strayItems.data?.length ?? 0) === 0,
    `${strayItems.data?.length ?? 0} gefunden`);
  const strayOps = await admin.from("seller_operators").select("user_id").eq("note", "verify:settled");
  check("keine Operator-Zuordnung zurückgeblieben", (strayOps.data?.length ?? 0) === 0,
    `${strayOps.data?.length ?? 0} gefunden`);
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const leftovers = (users.data?.users ?? []).filter((u) => (u.email ?? "").startsWith("settled-check-"));
  check("kein temporärer Auth-Nutzer zurückgeblieben", leftovers.length === 0,
    leftovers.map((u) => u.email).join(", ") || "keiner");

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
