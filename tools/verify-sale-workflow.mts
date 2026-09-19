/**
 * Functional verification of the external-sale workflow (0065, ADR-0092).
 *
 *   npm run verify:sale-workflow:staging
 *
 * STAGING ONLY, AND IT WRITES. It creates one temporary seller operator, one
 * external sale MARKED AS A TEST, and works through the whole eBay template:
 * amounts, several fees, an adjustment, a reported payout, figures, and the
 * corrections the detail screen offers. The sale is left behind on purpose —
 * as a `Testvorgang` it counts in no business total (0063). The temporary
 * account is removed at the end.
 *
 * WHAT IT PROVES, in the order in which one would doubt it:
 *
 *   1  the whole sale — money, fees, adjustment, payout, figures — in ONE
 *      transaction, and nothing left behind when one element is invalid
 *   2  several fees per sale, with `settled_by` deciding the payout
 *   3  the database's payout equals the screen's, to the cent
 *   4  a reported payout that differs shows the difference
 *   5  creating a sale of any size moves NO stock
 *   6  each figure is booked out individually, one movement each
 *   7  a booked-out line can be neither removed nor reassigned
 *   8  a workbook line can be neither removed nor reassigned
 *   9  the sale is classified as a test
 *
 * THE INVENTORY MOVEMENTS IT MAKES are in step 6 and are the point of it: a
 * sale that never books anything out proves nothing about Ausbuchen. Each is
 * reversed through `seller_unbook_sale_item`, which writes a compensating
 * entry rather than deleting one — the ledger keeps both, and the net
 * quantity change is zero.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";

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
    console.error(`Missing ${name}. Run through npm, which loads the env file.`);
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

const RUN = Date.now().toString(36);
const NOTE = "UI Verkauf eBay Smoke";
const cents = (n: number) => Math.round(n * 100) / 100;

async function inventorySnapshot(admin: SupabaseClient) {
  const rows: { quantity: number; reserved: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await admin.from("shop_inventory").select("quantity, reserved")
      .range(from, from + 999);
    if (page.error) throw new Error(`shop_inventory: ${page.error.message}`);
    rows.push(...(page.data as { quantity: number; reserved: number }[]));
    if ((page.data?.length ?? 0) < 1000) break;
  }
  const movements = await admin.from("inventory_movements")
    .select("id", { count: "exact", head: true });
  if (movements.error) throw new Error(`movements: ${movements.error.message}`);
  return {
    positions: rows.length,
    quantity: rows.reduce((s, r) => s + Number(r.quantity), 0),
    reserved: rows.reduce((s, r) => s + Number(r.reserved), 0),
    movements: movements.count ?? -1,
  };
}
type Snapshot = Awaited<ReturnType<typeof inventorySnapshot>>;
const sameStock = (a: Snapshot, b: Snapshot) =>
  a.quantity === b.quantity && a.reserved === b.reserved && a.movements === b.movements;
const show = (s: Snapshot) =>
  `Positionen ${s.positions} · Menge ${s.quantity} · reserviert ${s.reserved} · Bewegungen ${s.movements}`;

async function main(): Promise<void> {
  requireStaging("verify:sale-workflow");

  const admin = serviceClient();
  let operator: { client: SupabaseClient; user: User } | null = null;
  let sellerId: number | null = null;
  let saleId: number | null = null;

  try {
    heading("Setup (service role)");
    const seller = await admin.from("sellers").select("id").eq("is_active", true).single();
    if (seller.error) throw new Error(`active seller: ${seller.error.message}`);
    sellerId = seller.data.id as number;

    const credentials = {
      email: `sale-smoke-${RUN}@skyisles.invalid`,
      password: `smoke-${RUN}-${Math.random().toString(36).slice(2)}`,
    };
    const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
    if (created.error) throw new Error(`createUser: ${created.error.message}`);
    const client = anonClient();
    const signIn = await client.auth.signInWithPassword(credentials);
    if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
    operator = { client, user: created.data.user };
    const membership = await admin.from("seller_operators").insert({
      seller_id: sellerId, user_id: operator.user.id, note: "verify:sale-workflow",
    });
    if (membership.error) throw new Error(`seller_operators: ${membership.error.message}`);
    console.log("  one temporary seller operator");

    /*
     * Figures that are actually ON THE SHELF, because Ausbuchen has to be
     * able to succeed. Free stock only: `apply_inventory_movement()` refuses
     * to take a unit that a shop order has reserved, and that refusal is
     * correct — this test must not be the thing that discovers it.
     */
    const stocked = await admin.from("shop_inventory")
      .select("sky_id, quantity, reserved, condition")
      .gt("quantity", 1).order("sky_id").limit(40);
    if (stocked.error) throw new Error(`inventory: ${stocked.error.message}`);
    const free = (stocked.data ?? []).filter((r) => Number(r.quantity) - Number(r.reserved) >= 2);
    if (free.length < 3) throw new Error("need three figures with two free units each");
    const skyIds = free.slice(0, 3).map((r) => String(r.sky_id));
    const prices = await admin.from("skylanders").select("sky_id, market_price").in("sky_id", skyIds);
    if (prices.error) throw new Error(`prices: ${prices.error.message}`);
    const [A, B, C] = skyIds;
    console.log(`  figures on the shelf: ${skyIds.join(" · ")}`);

    const before = await inventorySnapshot(admin);
    console.log(`  inventory before: ${show(before)}`);
    const op = operator.client;

    /* ------------------------------------------- 1. the eBay template, whole */
    heading("1-4. Anlegen mit Vorlage, Gebühren, Korrektur und Auszahlung");

    // The exact shape the eBay template produces.
    const subtotal = 20, shipping = 4.99, discount = 0;
    const fees = [
      { kind: "marketplace", amount: 3.42, settled_by: "channel" },
      { kind: "shipping_label", amount: 3.15, settled_by: "channel" },
      // Bought at the post office: real money, but it cannot change what the
      // channel owes. The payout below must NOT move because of this row.
      { kind: "shipping_label", amount: 2.19, settled_by: "external" },
    ];
    const adjustments = [{ amount: -0.35, reason: "sonstiges", note: `${NOTE} Korrektur` }];
    // 20 + 4,99 − 0 − (3,42 + 3,15) − 0,35
    const expectedByHand = cents(subtotal + shipping - discount - 3.42 - 3.15 - 0.35);

    const args = {
      p_channel: "ebay", p_sold_at: new Date().toISOString().slice(0, 10), p_country: "DE",
      p_external_ref: `EBAY-SMOKE-${RUN}`, p_buyer_ref: "smoke", p_note: NOTE, p_is_test: true,
      p_items_subtotal: subtotal, p_shipping_charged: shipping, p_discount_amount: discount,
      p_items: [{ sky_id: A }, { sky_id: A }, { sky_id: B }],
      p_fees: fees, p_adjustments: adjustments,
      p_payout_amount: expectedByHand, p_payout_ref: `PAYOUT-${RUN}`,
    };
    const create = await op.rpc("seller_create_sale_with_details", args);
    check("seller_create_sale_with_details answers", create.error === null,
          create.error?.message.slice(0, 90) ?? "");
    if (create.error) throw new Error("cannot continue without a sale");
    saleId = Number(create.data);
    console.log(`  sale #${saleId}`);

    const detail = async () => {
      const d = await op.rpc("seller_sale", { p_id: saleId });
      if (d.error) throw new Error(`seller_sale: ${d.error.message}`);
      const root = d.data as Record<string, unknown>;
      const sale = root.sale as Record<string, unknown>;
      return {
        sale,
        isTest: sale.is_test === true,
        expected: Number(root.expected_payout),
        reported: sale.reported_payout_amount === null ? null : Number(sale.reported_payout_amount),
        items: (root.items as Record<string, unknown>[]).map((i) => ({
          id: Number(i.id), skyId: (i.sky_id as string) ?? null,
          movementId: i.movement_id === null ? null : Number(i.movement_id),
        })),
        fees: (root.fees as Record<string, unknown>[]).map((f) => ({
          kind: String(f.kind), amount: Number(f.amount), settledBy: String(f.settled_by),
        })),
        adjustments: (root.adjustments as Record<string, unknown>[]).map((a) => Number(a.amount)),
      };
    };

    let d = await detail();
    check("three physical items, the duplicate kept separate", d.items.length === 3
          && d.items.filter((i) => i.skyId === A).length === 2, `${d.items.length}`);
    check("ALL THREE FEES WERE STORED, with their settlement", d.fees.length === 3,
          d.fees.map((f) => `${f.kind}/${f.settledBy} ${f.amount}`).join(" · "));
    check("one signed adjustment", d.adjustments.length === 1 && d.adjustments[0] === -0.35,
          String(d.adjustments[0]));
    check("THE DATABASE'S PAYOUT EQUALS THE SCREEN'S", cents(d.expected) === expectedByHand,
          `${cents(d.expected)} vs ${expectedByHand}`);
    check("the externally settled label did NOT reduce it",
          cents(d.expected) === cents(subtotal + shipping - 3.42 - 3.15 - 0.35));
    check("the reported payout was recorded", d.reported === expectedByHand, String(d.reported));
    check("and the difference is zero", cents((d.reported ?? 0) - d.expected) === 0);
    check("the sale is classified as a test (0063)", d.isTest);
    check("channel and source are the ordinary ones",
          d.sale.channel === "ebay" && d.sale.source === "manual");

    const afterCreate = await inventorySnapshot(admin);
    check("CREATING THE SALE MOVED NO STOCK", sameStock(before, afterCreate), show(afterCreate));

    /* ---------------------------------------------- 2. a differing payout */
    heading("5. Abweichende Auszahlung");
    const short = cents(expectedByHand - 0.35);
    const setShort = await op.rpc("seller_set_sale_payout",
      { p_id: saleId, p_amount: short, p_ref: `PAYOUT-${RUN}`, p_paid_at: null,
        p_expected_updated_at: null });
    check("a short payment can be recorded", setShort.error === null,
          setShort.error?.message.slice(0, 60) ?? "");
    d = await detail();
    check("AND THE DIFFERENCE IS −0,35", cents((d.reported ?? 0) - d.expected) === -0.35,
          `${cents((d.reported ?? 0) - d.expected)}`);
    // Put it back, so the sale left behind reconciles.
    await op.rpc("seller_set_sale_payout", { p_id: saleId, p_amount: expectedByHand,
      p_ref: `PAYOUT-${RUN}`, p_paid_at: null, p_expected_updated_at: null });

    /* ---------------------------------------------------- 3. atomicity */
    heading("6. Teilfehler hinterlässt nichts");
    const countSales = async () =>
      (await admin.from("sales").select("id", { count: "exact", head: true })).count ?? -1;
    const salesBefore = await countSales();
    const bad = await op.rpc("seller_create_sale_with_details", {
      ...args, p_external_ref: `EBAY-ROLLBACK-${RUN}`,
      // A fee kind the CHECK constraint does not know, after two valid ones.
      p_fees: [{ kind: "marketplace", amount: 1, settled_by: "channel" },
               { kind: "nonsense", amount: 1, settled_by: "channel" }],
    });
    check("an invalid fee is refused", bad.error !== null,
          bad.error?.code ?? "NO ERROR — it was accepted");
    const salesAfter = await countSales();
    check("AND THE WHOLE SALE ROLLED BACK — no sale, no items, no first fee",
          salesAfter === salesBefore, `${salesBefore} → ${salesAfter}`);

    /* ------------------------------------------- 4. editing before Ausbuchen */
    heading("7. Position hinzufügen, ändern, entfernen");
    const add = await op.rpc("seller_add_sale_item",
      { p_sale_id: saleId, p_sky_id: C, p_raw_name: null, p_condition: "loose" });
    check("a figure can be added", add.error === null, add.error?.message.slice(0, 60) ?? "");
    d = await detail();
    check("four units now", d.items.length === 4, `${d.items.length}`);

    const wrong = d.items.find((i) => i.skyId === C)!;
    const remap = await op.rpc("seller_set_sale_item_sky", { p_item_id: wrong.id, p_sky_id: B });
    check("a wrongly chosen unbooked figure can be changed", remap.error === null,
          remap.error?.message.slice(0, 60) ?? "");
    d = await detail();
    check("the identity changed, the unit count did not",
          d.items.length === 4 && !d.items.some((i) => i.skyId === C));

    const remove = await op.rpc("seller_remove_sale_item", { p_item_id: wrong.id });
    check("an unbooked hand-made line can be removed", remove.error === null,
          remove.error?.message.slice(0, 60) ?? "");
    d = await detail();
    check("three units remain", d.items.length === 3, `${d.items.length}`);

    const afterEdits = await inventorySnapshot(admin);
    check("ADD, CHANGE AND REMOVE MOVED NO STOCK", sameStock(before, afterEdits), show(afterEdits));

    /* ------------------------------------------------------- 5. Ausbuchen */
    heading("8. Ausbuchen — je Figur eine Bewegung");
    const first = d.items[0];
    const book = await op.rpc("seller_book_sale_item", { p_item_id: first.id });
    check("one item books out", book.error === null, book.error?.message.slice(0, 70) ?? "");
    const movementId = Number(book.data);
    const booked = await inventorySnapshot(admin);
    check("EXACTLY ONE MOVEMENT, AND ONE UNIT LESS",
          booked.movements === before.movements + 1 && booked.quantity === before.quantity - 1,
          `${show(booked)} (#${movementId})`);
    /*
     * The column is `reason`, not `kind` — `sale_fees` has a `kind` and
     * `inventory_movements` has a `reason`, and reading the wrong one here
     * returned no row at all, which a truthy check would have called a pass.
     * So the row itself is asserted first.
     */
    const movement = await admin.from("inventory_movements")
      .select("id, delta, reason").eq("id", movementId).single();
    check("the movement row is readable", movement.error === null && movement.data !== null,
          movement.error?.message.slice(0, 60) ?? "");
    check("and it is the canonical `sale_external` −1",
          movement.data?.reason === "sale_external" && Number(movement.data?.delta) === -1,
          `${movement.data?.reason} ${movement.data?.delta}`);

    check("the OTHER items are untouched — Ausbuchen is per unit",
          (await detail()).items.filter((i) => i.movementId === null).length === 2);

    /* --------------------------------------------- 6. booked-out defence */
    heading("9. Ausgebuchte Positionen sind geschützt");
    const removeBooked = await op.rpc("seller_remove_sale_item", { p_item_id: first.id });
    check("REMOVING A BOOKED-OUT LINE IS REFUSED", removeBooked.error !== null,
          removeBooked.error?.message.slice(0, 70) ?? "NO ERROR — IT WAS DELETED");
    const remapBooked = await op.rpc("seller_set_sale_item_sky",
      { p_item_id: first.id, p_sky_id: C });
    check("CHANGING ITS FIGURE IS REFUSED", remapBooked.error !== null,
          remapBooked.error?.message.slice(0, 70) ?? "NO ERROR — IT WAS REASSIGNED");
    const stillBooked = await admin.from("sale_items")
      .select("sky_id, movement_id").eq("id", first.id).single();
    check("it still names the figure that left the shelf",
          stillBooked.data?.sky_id === first.skyId
          && Number(stillBooked.data?.movement_id) === movementId);

    // Reversed the canonical way: a compensating movement, never a delete.
    const unbook = await op.rpc("seller_unbook_sale_item", { p_item_id: first.id });
    check("the Ausbuchen is reversed by a compensating movement", unbook.error === null,
          unbook.error?.message.slice(0, 60) ?? "");
    const afterUnbook = await inventorySnapshot(admin);
    check("NET QUANTITY IS BACK TO THE BASELINE", afterUnbook.quantity === before.quantity,
          show(afterUnbook));
    check("and both movements stay in the ledger",
          afterUnbook.movements === before.movements + 2);

    /* --------------------------------------------- 7. historical defence */
    heading("10. Historische Positionen sind geschützt");
    const legacy = await admin.from("sale_items")
      .select("id, sale_id, sky_id, source_row").not("source_row", "is", null)
      .order("id").limit(1).single();
    if (legacy.error) throw new Error(`legacy sample: ${legacy.error.message}`);
    const legacyId = Number(legacy.data.id);
    const legacyRemove = await op.rpc("seller_remove_sale_item", { p_item_id: legacyId });
    check("REMOVING A WORKBOOK LINE IS REFUSED", legacyRemove.error !== null,
          legacyRemove.error?.message.slice(0, 70) ?? "NO ERROR — IT WAS DELETED");
    check("and refused for the stated reason",
          (legacyRemove.error?.message ?? "").includes("legacy workbook"));
    const legacyRemap = await op.rpc("seller_set_sale_item_sky",
      { p_item_id: legacyId, p_sky_id: C });
    check("REASSIGNING ONE IS REFUSED TOO", legacyRemap.error !== null,
          legacyRemap.error?.message.slice(0, 70) ?? "NO ERROR — IT WAS REASSIGNED");
    const legacyStill = await admin.from("sale_items")
      .select("sky_id, source_row").eq("id", legacyId).single();
    check("the line is still there, unchanged",
          legacyStill.data?.sky_id === legacy.data.sky_id
          && Number(legacyStill.data?.source_row) === Number(legacy.data.source_row));

    /* ------------------------------------------------------- 8. security */
    heading("11. Wer nichts darf, darf nichts");
    const stranger = anonClient();
    check("anon cannot create a sale",
          (await stranger.rpc("seller_create_sale_with_details", args)).error !== null);
    check("anon cannot reassign an item",
          (await stranger.rpc("seller_set_sale_item_sky",
            { p_item_id: legacyId, p_sky_id: C })).error !== null);
    check("anon cannot read sale_items directly",
          (await stranger.from("sale_items").select("id").limit(1)).error !== null);
    const outsider = {
      email: `sale-outsider-${RUN}@skyisles.invalid`,
      password: `out-${RUN}-${Math.random().toString(36).slice(2)}`,
    };
    const madeOutsider = await admin.auth.admin.createUser({ ...outsider, email_confirm: true });
    if (madeOutsider.error) throw new Error(`outsider: ${madeOutsider.error.message}`);
    const outClient = anonClient();
    await outClient.auth.signInWithPassword(outsider);
    check("a signed-in non-operator cannot create a sale",
          (await outClient.rpc("seller_create_sale_with_details", args)).error !== null);
    await admin.auth.admin.deleteUser(madeOutsider.data.user.id);

    const final = await inventorySnapshot(admin);
    heading("Bestand");
    console.log(`  vorher:  ${show(before)}`);
    console.log(`  nachher: ${show(final)}`);
    console.log(`  Menge Δ ${final.quantity - before.quantity} · `
      + `reserviert Δ ${final.reserved - before.reserved} · `
      + `Bewegungen Δ ${final.movements - before.movements} `
      + "(die zwei aus der Ausbuch-Prüfung: sale_external −1 und die Rücknahme +1)");
    console.log(`\n  Der Testverkauf #${saleId} bleibt als Testvorgang stehen.`);
  } finally {
    heading("Aufräumen");
    if (operator && sellerId !== null) {
      await admin.from("seller_operators")
        .delete().eq("seller_id", sellerId).eq("user_id", operator.user.id);
      await admin.auth.admin.deleteUser(operator.user.id);
      console.log("  temporary operator removed");
    }
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
