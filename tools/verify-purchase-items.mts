/**
 * Functional verification of the Einkauf figure workflow (0064, ADR-0091).
 *
 *   npm run verify:purchase-items:staging
 *
 * STAGING ONLY, AND IT WRITES. It creates one auth user, makes it a seller
 * operator, creates one purchase MARKED AS A TEST, and works through the
 * corrections the screens offer. The purchase is left behind on purpose —
 * marked `Testvorgang`, it counts in no business total (0063) and is the
 * thing an operator can look at afterwards. The auth user and its operator
 * membership are removed at the end.
 *
 * WHAT IT PROVES, in the order in which one would doubt it:
 *
 *   1  a purchase and its figures arrive in one transaction
 *   2  duplicates are separate physical rows, never a quantity
 *   3  creating a purchase of any size moves no stock at all
 *   4  Marktwert and Faktor match the arithmetic the screen shows
 *   5  an unbooked item can be added, remapped and removed
 *   6  a workbook line can be remapped but NOT removed
 *   7  a booked item can be neither removed nor remapped
 *   8  a partial failure leaves nothing behind
 *
 * THE ONE INVENTORY MOVEMENT IT MAKES is in step 7 and is deliberate: the
 * only honest proof that a booked item is protected is to book one. It is
 * reversed through `seller_unbook_purchase_item`, which writes a compensating
 * movement rather than deleting the first — so the ledger keeps both, the net
 * quantity change is zero, and nothing historical is touched.
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
const NOTE = "UI Einkauf Figuren Smoke";
const cents = (n: number) => Math.round(n * 100) / 100;

/** Positions, quantity, reserved and movement count — the four §50 numbers. */
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

const sameStock = (a: Awaited<ReturnType<typeof inventorySnapshot>>,
                   b: Awaited<ReturnType<typeof inventorySnapshot>>) =>
  a.positions === b.positions && a.quantity === b.quantity
  && a.reserved === b.reserved && a.movements === b.movements;

const show = (s: Awaited<ReturnType<typeof inventorySnapshot>>) =>
  `Positionen ${s.positions} · Menge ${s.quantity} · reserviert ${s.reserved} · Bewegungen ${s.movements}`;

async function main(): Promise<void> {
  // Before any client exists, so there is no window in which a connection is
  // open and the guard has not run. This tool has no production mode at all.
  requireStaging("verify:purchase-items");

  const admin = serviceClient();
  let operator: { client: SupabaseClient; user: User } | null = null;
  let sellerId: number | null = null;
  let purchaseId: number | null = null;

  try {
    /* ---------------------------------------------------------------- setup */
    heading("Setup (service role)");
    const seller = await admin.from("sellers").select("id").eq("is_active", true).single();
    if (seller.error) throw new Error(`active seller: ${seller.error.message}`);
    sellerId = seller.data.id as number;

    const credentials = {
      email: `orderbook-smoke-${RUN}@skyisles.invalid`,
      password: `smoke-${RUN}-${Math.random().toString(36).slice(2)}`,
    };
    const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
    if (created.error) throw new Error(`createUser: ${created.error.message}`);
    const client = anonClient();
    const signIn = await client.auth.signInWithPassword(credentials);
    if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
    operator = { client, user: created.data.user };

    const membership = await admin.from("seller_operators").insert({
      seller_id: sellerId, user_id: operator.user.id, note: "verify:purchase-items",
    });
    if (membership.error) throw new Error(`seller_operators: ${membership.error.message}`);
    console.log("  one temporary seller operator");

    // Five priced catalog figures, chosen from the catalog rather than named:
    // a hard-coded SKY-ID would make this tool depend on one import.
    const priced = await admin.from("skylanders")
      .select("sky_id, name, market_price")
      .not("market_price", "is", null).order("sky_id").limit(5);
    if (priced.error || (priced.data?.length ?? 0) < 5) {
      throw new Error(`need five priced figures: ${priced.error?.message ?? "too few"}`);
    }
    const figures = priced.data.map((r) => ({
      skyId: String(r.sky_id), name: String(r.name), price: Number(r.market_price),
    }));
    const [A, B, C, D, E] = figures;
    console.log(`  figures: ${figures.map((f) => `${f.skyId} ${f.price}`).join(" · ")}`);

    const before = await inventorySnapshot(admin);
    console.log(`  inventory before: ${show(before)}`);

    const op = operator.client;

    /* ------------------------------------------------- 1. atomic creation */
    heading("1-4. Anlegen mit Figuren, in einer Transaktion");

    // Two copies of A plus one B — the duplicate case, entered as the screen
    // would send it: one element per physical unit.
    const cost = 12.5;
    const createArgs = {
      p_purchased_at: null as string | null,
      p_total_cost: cost,
      p_note: NOTE,
      p_is_test: true,
      p_items: [{ sky_id: A.skyId }, { sky_id: A.skyId }, { sky_id: B.skyId }],
    };
    const create = await op.rpc("seller_create_purchase_with_items", createArgs);
    check("seller_create_purchase_with_items answers", create.error === null,
          create.error?.message.slice(0, 90) ?? "");
    if (create.error) throw new Error("cannot continue without a purchase");
    purchaseId = Number(create.data);
    console.log(`  purchase #${purchaseId}`);

    const detail = async () => {
      const d = await op.rpc("seller_purchase", { p_id: purchaseId });
      if (d.error) throw new Error(`seller_purchase: ${d.error.message}`);
      const root = d.data as Record<string, unknown>;
      const items = (root.items ?? []) as Record<string, unknown>[];
      const value = (root.value ?? {}) as Record<string, unknown>;
      return {
        isTest: (root.purchase as Record<string, unknown>).is_test === true,
        source: String((root.purchase as Record<string, unknown>).source),
        items: items.map((i) => ({
          id: Number(i.id), skyId: (i.sky_id as string) ?? null,
          state: String(i.state), movementId: i.movement_id === null ? null : Number(i.movement_id),
          price: i.market_price === null ? null : Number(i.market_price),
        })),
        knownValue: Number(value.known_value ?? 0),
        totalItems: Number(value.total_items ?? 0),
        factor: root.factor === null ? null : Number(root.factor),
      };
    };

    let d = await detail();
    check("three physical items, not one row with a quantity", d.items.length === 3,
          `${d.items.length}`);
    check("the duplicate is two separate rows",
          d.items.filter((i) => i.skyId === A.skyId).length === 2);
    check("the canonical sky_ids are the ones sent",
          d.items.map((i) => i.skyId).sort().join(",") === [A.skyId, A.skyId, B.skyId].sort().join(","),
          d.items.map((i) => i.skyId).join(","));
    check("each item carries its own catalog market price",
          d.items.every((i) => i.price !== null));

    const expectedValue = cents(A.price * 2 + B.price);
    check("Marktwert is the sum over the units", cents(d.knownValue) === expectedValue,
          `${cents(d.knownValue)} vs ${expectedValue}`);
    const expectedFactor = Math.round((cost / expectedValue) * 10000) / 10000;
    check("Faktor is Ausgaben / Marktwert", d.factor !== null
          && Math.abs(d.factor - expectedFactor) < 0.0002,
          `${d.factor} vs ${expectedFactor}`);
    check("the purchase is classified as a test (0063)", d.isTest);
    check("and is hand-made, not imported", d.source === "manual");

    const afterCreate = await inventorySnapshot(admin);
    check("CREATING THREE FIGURES MOVED NO STOCK", sameStock(before, afterCreate),
          show(afterCreate));

    /* ------------------------------------------------------ 2. atomicity */
    heading("5. Teilfehler hinterlässt nichts");
    const countPurchases = async () => {
      const r = await admin.from("purchases").select("id", { count: "exact", head: true });
      return r.count ?? -1;
    };
    const purchasesBefore = await countPurchases();
    const bad = await op.rpc("seller_create_purchase_with_items", {
      p_purchased_at: null, p_total_cost: 5, p_note: `${NOTE} (rollback)`, p_is_test: true,
      /*
       * The third element names a figure that is not in the catalog. Built
       * from the run id rather than written as a literal: `SKY-99xx` is what
       * `verify:inventory` uses for its own fixtures, and borrowing one of
       * those would make this assertion pass or fail depending on whether
       * that tool had run.
       */
      p_items: [{ sky_id: C.skyId }, { sky_id: D.skyId }, { sky_id: `SKY-NONE-${RUN}` }],
    });
    check("an invalid figure is refused", bad.error !== null,
          bad.error?.code ?? "NO ERROR — it was accepted");
    check("AND THE WHOLE PURCHASE ROLLED BACK", (await countPurchases()) === purchasesBefore,
          `${purchasesBefore} → ${await countPurchases()}`);

    /* ------------------------------------------------ 3. editing an item */
    heading("6-8. Hinzufügen, ändern, entfernen");
    const add = await op.rpc("seller_add_purchase_item", {
      p_purchase_id: purchaseId, p_sky_id: C.skyId, p_raw_name: null, p_condition: "loose",
    });
    check("a figure can be added to an existing purchase", add.error === null,
          add.error?.message.slice(0, 60) ?? "");
    d = await detail();
    check("the purchase now holds four units", d.items.length === 4, `${d.items.length}`);
    check("Marktwert followed the addition",
          cents(d.knownValue) === cents(A.price * 2 + B.price + C.price),
          `${cents(d.knownValue)}`);

    const wrong = d.items.find((i) => i.skyId === C.skyId)!;
    const remap = await op.rpc("seller_set_purchase_item_sky", {
      p_item_id: wrong.id, p_sky_id: E.skyId, p_remember: false,
    });
    check("a wrongly selected unbooked figure can be changed", remap.error === null,
          remap.error?.message.slice(0, 60) ?? "");
    d = await detail();
    check("the identity changed and the unit count did not",
          d.items.length === 4 && d.items.some((i) => i.skyId === E.skyId)
          && !d.items.some((i) => i.skyId === C.skyId));
    check("Marktwert followed the change",
          cents(d.knownValue) === cents(A.price * 2 + B.price + E.price),
          `${cents(d.knownValue)}`);

    const doomed = d.items.find((i) => i.skyId === E.skyId)!;
    const remove = await op.rpc("seller_remove_purchase_item", { p_item_id: doomed.id });
    check("an unbooked hand-made figure can be removed", remove.error === null,
          remove.error?.message.slice(0, 60) ?? "");
    d = await detail();
    check("three units remain", d.items.length === 3, `${d.items.length}`);
    check("Marktwert and Faktor followed the removal",
          cents(d.knownValue) === expectedValue && d.factor !== null
          && Math.abs(d.factor - expectedFactor) < 0.0002);

    const afterEdits = await inventorySnapshot(admin);
    check("ADD, CHANGE AND REMOVE MOVED NO STOCK", sameStock(before, afterEdits),
          show(afterEdits));

    /* --------------------------------------------- 4. historical defence */
    heading("9. Historische Positionen sind geschützt");
    const legacy = await admin.from("purchase_items")
      .select("id, purchase_id, state, source_row")
      .eq("state", "reconciled_legacy").order("id").limit(1).single();
    if (legacy.error) throw new Error(`legacy sample: ${legacy.error.message}`);
    const legacyId = Number(legacy.data.id);
    const legacyRemove = await op.rpc("seller_remove_purchase_item", { p_item_id: legacyId });
    check("REMOVING A WORKBOOK LINE IS REFUSED", legacyRemove.error !== null,
          legacyRemove.error?.message.slice(0, 70) ?? "NO ERROR — IT WAS DELETED");
    check("and refused for the stated reason",
          (legacyRemove.error?.message ?? "").includes("legacy workbook"));

    const stillThere = await admin.from("purchase_items")
      .select("id, source_row, state").eq("id", legacyId).maybeSingle();
    check("the line is still there, unchanged",
          stillThere.data !== null
          && Number(stillThere.data.source_row) === Number(legacy.data.source_row)
          && stillThere.data.state === "reconciled_legacy");

    /* ------------------------------------------------ 5. booking defence */
    heading("10. Eingebuchte Positionen sind geschützt");
    const toBook = (await detail()).items.find((i) => i.skyId === B.skyId)!;
    const book = await op.rpc("seller_book_purchase_item", { p_item_id: toBook.id });
    check("the test item books into stock", book.error === null,
          book.error?.message.slice(0, 60) ?? "");
    const movementId = Number(book.data);
    const booked = await inventorySnapshot(admin);
    check("exactly one movement was written", booked.movements === before.movements + 1,
          `${before.movements} → ${booked.movements} (#${movementId})`);

    const removeBooked = await op.rpc("seller_remove_purchase_item", { p_item_id: toBook.id });
    check("REMOVING A BOOKED ITEM IS REFUSED", removeBooked.error !== null,
          removeBooked.error?.message.slice(0, 70) ?? "NO ERROR — IT WAS DELETED");
    const remapBooked = await op.rpc("seller_set_purchase_item_sky", {
      p_item_id: toBook.id, p_sky_id: E.skyId, p_remember: false,
    });
    check("CHANGING A BOOKED ITEM'S FIGURE IS REFUSED", remapBooked.error !== null,
          remapBooked.error?.message.slice(0, 70) ?? "NO ERROR — IT WAS REASSIGNED");

    const stillBooked = await admin.from("purchase_items")
      .select("sky_id, movement_id, state").eq("id", toBook.id).single();
    check("the booked item still names the figure that entered stock",
          stillBooked.data?.sky_id === B.skyId
          && Number(stillBooked.data?.movement_id) === movementId);

    // Reversed the canonical way: a compensating movement, never a delete.
    const unbook = await op.rpc("seller_unbook_purchase_item", { p_item_id: toBook.id });
    check("the booking is reversed by a compensating movement", unbook.error === null,
          unbook.error?.message.slice(0, 60) ?? "");
    const afterUnbook = await inventorySnapshot(admin);
    check("NET QUANTITY IS BACK TO THE BASELINE",
          afterUnbook.quantity === before.quantity && afterUnbook.reserved === before.reserved,
          show(afterUnbook));
    check("and both movements are kept in the ledger",
          afterUnbook.movements === before.movements + 2,
          `${before.movements} → ${afterUnbook.movements}`);

    /* ------------------------------------------------------- 6. security */
    heading("11. Wer nichts darf, darf nichts");
    const stranger = anonClient();
    const anonCreate = await stranger.rpc("seller_create_purchase_with_items", createArgs);
    check("anon cannot create a purchase", anonCreate.error !== null,
          anonCreate.error?.code ?? "NO ERROR");
    const anonRemove = await stranger.rpc("seller_remove_purchase_item", { p_item_id: legacyId });
    check("anon cannot remove an item", anonRemove.error !== null,
          anonRemove.error?.code ?? "NO ERROR");
    const anonTable = await stranger.from("purchase_items").select("id").limit(1);
    check("anon cannot read purchase_items directly", anonTable.error !== null,
          anonTable.error?.code ?? "NO ERROR");

    // A signed-in account that is not an operator.
    const outsider = {
      email: `orderbook-outsider-${RUN}@skyisles.invalid`,
      password: `outsider-${RUN}-${Math.random().toString(36).slice(2)}`,
    };
    const madeOutsider = await admin.auth.admin.createUser({ ...outsider, email_confirm: true });
    if (madeOutsider.error) throw new Error(`outsider: ${madeOutsider.error.message}`);
    const outClient = anonClient();
    await outClient.auth.signInWithPassword(outsider);
    const outCreate = await outClient.rpc("seller_create_purchase_with_items", createArgs);
    check("a signed-in non-operator cannot create a purchase", outCreate.error !== null,
          outCreate.error?.code ?? "NO ERROR");
    await admin.auth.admin.deleteUser(madeOutsider.data.user.id);

    const finalStock = await inventorySnapshot(admin);
    heading("Bestand");
    console.log(`  vorher:  ${show(before)}`);
    console.log(`  nachher: ${show(finalStock)}`);
    console.log(`  Menge Δ ${finalStock.quantity - before.quantity} · `
      + `reserviert Δ ${finalStock.reserved - before.reserved} · `
      + `Bewegungen Δ ${finalStock.movements - before.movements} `
      + "(die zwei aus der Einbuch-Prüfung, +1 und die Rücknahme −1)");
    console.log(`\n  Der Testeinkauf #${purchaseId} bleibt als Testvorgang stehen.`);
  } finally {
    /* -------------------------------------------------------------- cleanup */
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
