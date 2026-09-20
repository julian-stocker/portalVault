/**
 * Runtime proof for 0071–0073, against Staging (V4.8).
 *
 * WHAT THIS EXISTS FOR
 *
 * The Verkauf side now has two endings and one of them writes no inventory
 * movement. `seller_settle_sale_item` must therefore refuse every catalog
 * figure that is not marked as never having come off the shelf — otherwise
 * it is a door straight past the inventory ledger: a figure closed, never
 * booked, and the stock short by one with nothing to show for it.
 *
 * Until now that refusal was asserted against the TEXT of the migration.
 * This calls the function and watches it say no.
 *
 * WHAT IT TOUCHES — AND WHAT IT REFUSES TO
 *
 * One test sale, flagged `is_test`, with positions it creates itself. The
 * 197 real positions of the 22 released orders are READ and never written:
 * every refusal is provoked on a copy that mirrors their shape, because a
 * refusal that failed would otherwise mutate the very rows this release was
 * careful about. `Terrafin S2` in particular is looked at, never poked.
 *
 * NOTHING IS EVER BOOKED. No `sale_external` movement is created and no
 * quantity moves; stock and the ledger are counted at both ends and must be
 * identical. The one place a movement could appear — the booking function —
 * is only ever called where it must refuse.
 *
 * THE OPERATOR IS REMOVED IN `finally`, whatever happens.
 *
 * Staging only: `requireStaging()` compares origin AND service-role key
 * against `.env.staging` before a connection exists.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";
import { saleStockStatus } from "../src/lib/orderbook/sales-view.ts";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} fehlt — mit --env-file=.env.staging starten.`);
  return value;
};
const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false } });
const serviceClient = () =>
  createClient(URL_, requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } });

const RUN = Date.now().toString(36);
const NOTE = `verify:sale-locks ${RUN}`;

const results: { name: string; passed: boolean }[] = [];
function check(name: string, passed: boolean, detail = "") {
  results.push({ name, passed });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
class Halt extends Error {}
function must(name: string, passed: boolean, detail = "") {
  check(name, passed, detail);
  if (!passed) throw new Halt(name);
}
const heading = (t: string) => console.log(`\n=== ${t} ===`);

type Snapshot = {
  quantity: number; reserved: number; movements: number;
  released: number; items: number; withMovement: number; withSettled: number;
};

async function snapshot(admin: SupabaseClient): Promise<Snapshot> {
  const inv = await admin.from("shop_inventory").select("quantity, reserved");
  if (inv.error) throw new Error(`shop_inventory: ${inv.error.message}`);
  const moves = await admin.from("inventory_movements").select("id", { count: "exact", head: true });
  if (moves.error) throw new Error(`inventory_movements: ${moves.error.message}`);

  /* The 22 released orders — by the columns 0071 set, not by a list. */
  const sales = await admin.from("sales").select("id")
    .or("stock_released_at.not.is.null,cancelled_at.not.is.null");
  if (sales.error) throw new Error(`sales: ${sales.error.message}`);
  const ids = sales.data.map((r) => r.id as number);
  const items = await admin.from("sale_items")
    .select("movement_id, settled_at").in("sale_id", ids);
  if (items.error) throw new Error(`sale_items: ${items.error.message}`);

  return {
    quantity: inv.data.reduce((s, r) => s + Number(r.quantity), 0),
    reserved: inv.data.reduce((s, r) => s + Number(r.reserved), 0),
    movements: moves.count ?? -1,
    released: ids.length,
    items: items.data.length,
    withMovement: items.data.filter((r) => r.movement_id !== null).length,
    withSettled: items.data.filter((r) => r.settled_at !== null).length,
  };
}

const show = (s: Snapshot) =>
  `${s.quantity} Stück · ${s.reserved} reserviert · ${s.movements} Bewegungen · `
  + `${s.released} freigegebene Sales · ${s.items} Positionen · `
  + `${s.withMovement} ausgebucht · ${s.withSettled} erledigt`;

/** Did the call fail, and with the message it should have? */
const refused = (r: { error: { message: string } | null }, fragment: string) =>
  r.error !== null && r.error.message.includes(fragment);

async function main(): Promise<void> {
  requireStaging("verify:sale-locks");

  const admin = serviceClient();
  let operator: { client: SupabaseClient; user: User } | null = null;
  let sellerId: number | null = null;
  let saleId: number | null = null;
  /*
   * The two movements the fixture lifecycle creates. They are permanent:
   * `seller_unbook_sale_item` writes a compensating `correction` rather
   * than deleting, so there is no way to book and leave the ledger
   * untouched. Recorded here so the final check can name them instead of
   * merely tolerating a bigger number.
   */
  const fixtureMovements: number[] = [];

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
      email: `sale-locks-${RUN}@skyisles.invalid`,
      password: `locks-${RUN}-${Math.random().toString(36).slice(2)}`,
    };
    const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
    if (created.error) throw new Error(`createUser: ${created.error.message}`);
    const client = anonClient();
    const signIn = await client.auth.signInWithPassword(credentials);
    if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
    operator = { client, user: created.data.user };
    const membership = await admin.from("seller_operators")
      .insert({ seller_id: sellerId, user_id: operator.user.id, note: NOTE });
    if (membership.error) throw new Error(`seller_operators: ${membership.error.message}`);
    console.log("  ein temporärer Seller-Operator");

    const figure = await admin.from("skylanders").select("sky_id").order("sky_id").limit(1).single();
    if (figure.error) throw new Error(`catalog: ${figure.error.message}`);
    const skyId = String(figure.data.sky_id);

    const made = await operator.client.rpc("seller_create_sale", {
      p_channel: "manual", p_sold_at: null, p_country: null,
      p_external_ref: null, p_buyer_ref: null, p_note: NOTE,
    });
    if (made.error) throw new Error(`create sale: ${made.error.message}`);
    saleId = Number(made.data);
    await operator.client.rpc("seller_set_sale_test", { p_id: saleId, p_is_test: true });

    /*
     * Three positions, one per rule:
     *   figure   an ordinary catalog figure      — never settled
     *   portal   no catalog row                  — settled, never booked
     *   dash     a figure marked not-from-stock  — settled, never booked
     */
    const add = async (sky: string | null, raw: string | null) => {
      const r = await operator!.client.rpc("seller_add_sale_item", {
        p_sale_id: saleId, p_sky_id: sky, p_raw_name: raw, p_condition: "loose" });
      if (r.error) throw new Error(`add item: ${r.error.message}`);
    };
    /*
     * THE FIXTURE IS THE ONLY FIGURE THIS MAY BOOK.
     *
     * `SKY-9994 Inventory Fixture` exists on Staging for exactly this, and
     * it is the only stock this tool is allowed to move. The catalog's
     * first figure has no stock at all, which is why it can only ever be
     * used for refusals.
     */
    const FIXTURE = "SKY-9994";
    await add(skyId, null);
    await add(null, `Verify-Portal ${RUN}`);
    await add(skyId, null);
    await add(skyId, null);
    await add(FIXTURE, null);

    const rows = await admin.from("sale_items")
      .select("id, sky_id, legacy_stock_flag").eq("sale_id", saleId).order("id");
    if (rows.error) throw new Error(`items: ${rows.error.message}`);
    const [figureItem, portalItem, dashItem, spareItem, fixtureItem] = rows.data;
    await admin.from("sale_items").update({ condition: "loose" }).eq("id", fixtureItem.id);
    console.log(`  Testverkauf #${saleId} (is_test) mit ${rows.data.length} Positionen`);

    /*
     * The workbook marker cannot be written by any RPC — that is what makes
     * it a lock rather than a door. So the test sets it with the service
     * role, on a row it created, to build the shape `Terrafin S2` has.
     */
    const marked = await admin.from("sale_items")
      .update({ legacy_stock_flag: "-" }).eq("id", dashItem.id);
    if (marked.error) throw new Error(`mark: ${marked.error.message}`);
    console.log("  eine Position als nicht-aus-dem-Lager markiert (wie Terrafin S2)");

    /* ---------------------------------------------- 1. the ledger counts */
    heading("1. seller_sales liefert die drei Zählungen (0072)");
    const ledger = async () => {
      const r = await operator!.client.rpc("seller_sales", {
        p_year: null, p_month: null, p_search: NOTE, p_undated: true,
        p_scope: "external", p_status: "any",
      });
      if (r.error) throw new Error(`ledger: ${r.error.message}`);
      const root = r.data as { sales?: Record<string, unknown>[] };
      return (root.sales ?? []).find((s) => Number(s.id) === saleId);
    };
    const first = await ledger();
    must("der Testverkauf ist im Ledger", first !== undefined);
    for (const field of ["outbooked_count", "settled_count", "open_count"]) {
      must(`die Zeile trägt ${field}`, field in (first ?? {}));
    }
    check("outbooked_count ist 0", Number(first!.outbooked_count) === 0);
    check("settled_count ist 0", Number(first!.settled_count) === 0);
    /* Five positions now: the three the lock needs, plus a spare and the
       fixture the 0074/0075 lifecycle runs on. */
    check("open_count zählt alle fünf", Number(first!.open_count) === 5,
      `open_count=${first!.open_count}`);
    check("is_open ist wahr", first!.is_open === true);

    /* --------------------------------------------------- 2. THE LOCK */
    heading("2. Erledigt wird für eine gewöhnliche Katalogfigur verweigert");
    const locked = await operator.client.rpc("seller_settle_sale_item",
      { p_item_id: figureItem.id, p_settled: true });
    must("der direkte RPC-Aufruf schlägt fehl", locked.error !== null,
      locked.error ? locked.error.code : "ER WURDE ANGENOMMEN");
    check("und sagt warum", refused(locked, "never by being closed"),
      String(locked.error?.message ?? "").slice(0, 62));
    const after = await admin.from("sale_items")
      .select("settled_at, movement_id").eq("id", figureItem.id).single();
    must("die Figur steht unverändert da",
      after.data?.settled_at === null && after.data?.movement_id === null);

    /* ------------------------------- 3. accepted where there is no shelf */
    heading("3. Erledigt wird angenommen, wo es kein Regal gibt");
    const p = await operator.client.rpc("seller_settle_sale_item",
      { p_item_id: portalItem.id, p_settled: true });
    must("Nicht-Katalog-Position", p.error === null, p.error?.message ?? "");
    const d = await operator.client.rpc("seller_settle_sale_item",
      { p_item_id: dashItem.id, p_settled: true });
    must("als nicht-aus-dem-Lager markierte Figur", d.error === null, d.error?.message ?? "");
    const closed = await admin.from("sale_items")
      .select("id, settled_at, movement_id").in("id", [portalItem.id, dashItem.id]);
    must("beide tragen settled_at und keine Bewegung",
      (closed.data ?? []).every((r) => r.settled_at !== null && r.movement_id === null));

    /* ------------------------------- 4. never counted as an outbooking */
    heading("4. Erledigt zählt nicht als ausgebucht · 5. und nicht mehr als offen");
    const second = await ledger();
    check("settled_count ist 2", Number(second!.settled_count) === 2,
      `settled_count=${second!.settled_count}`);
    check("outbooked_count bleibt 0", Number(second!.outbooked_count) === 0,
      `outbooked_count=${second!.outbooked_count}`);
    check("open_count fiel von 5 auf 3", Number(second!.open_count) === 3,
      `open_count=${second!.open_count}`);
    check("noch offen — die Figur ist es", second!.is_open === true);

    /* ------------------------------- 6. booking refuses the marked one */
    heading("6. Ausbuchen wird für die markierte Figur verweigert");
    const unmark = await admin.from("sale_items")
      .update({ settled_at: null }).eq("id", dashItem.id);
    if (unmark.error) throw new Error(`reset: ${unmark.error.message}`);
    const bookDash = await operator.client.rpc("seller_book_sale_item", { p_item_id: dashItem.id });
    must("der Aufruf schlägt fehl", bookDash.error !== null,
      bookDash.error ? bookDash.error.code : "ES WURDE AUSGEBUCHT");
    check("und sagt warum", refused(bookDash, "not taken from stock"),
      String(bookDash.error?.message ?? "").slice(0, 62));
    const stillNull = await admin.from("sale_items")
      .select("movement_id").eq("id", dashItem.id).single();
    must("keine Bewegung entstanden", stillNull.data?.movement_id === null);

    heading("7. Ausbuchen wird für eine erledigte Position verweigert");
    await admin.from("sale_items").update({ settled_at: new Date().toISOString() })
      .eq("id", portalItem.id);
    const bookSettled = await operator.client.rpc("seller_book_sale_item", { p_item_id: portalItem.id });
    must("der Aufruf schlägt fehl", bookSettled.error !== null);
    check("und sagt warum", refused(bookSettled, "already closed without a movement"),
      String(bookSettled.error?.message ?? "").slice(0, 62));

    /* ------------------------------- 8./9. cancelled and frozen */
    heading("8. Eine stornierte Bestellung bucht nichts aus");
    await admin.from("sales").update({ cancelled_at: new Date().toISOString() }).eq("id", saleId);
    const bookCancelled = await operator.client.rpc("seller_book_sale_item",
      { p_item_id: figureItem.id });
    must("Ausbuchen schlägt fehl", bookCancelled.error !== null);
    check("und sagt warum", refused(bookCancelled, "cancelled"),
      String(bookCancelled.error?.message ?? "").slice(0, 62));
    const third = await ledger();
    check("und die Bestellung ist nicht mehr offen", third!.is_open === false,
      `is_open=${third!.is_open}`);

    heading("9. Ein nicht freigegebener Werkbuch-Verkauf bleibt gesperrt");
    await admin.from("sales").update({ cancelled_at: null, source: "excel_order_2026" })
      .eq("id", saleId);
    const bookFrozen = await operator.client.rpc("seller_book_sale_item",
      { p_item_id: figureItem.id });
    must("Ausbuchen schlägt fehl", bookFrozen.error !== null);
    check("und sagt warum", refused(bookFrozen, "historical sales never move stock"),
      String(bookFrozen.error?.message ?? "").slice(0, 62));
    /*
     * Taking an ending BACK is deliberately free: nothing irreversible
     * happened, no movement exists, and a mis-click should not need a
     * migration. Only setting one is gated.
     */
    const undo = await operator.client.rpc("seller_settle_sale_item",
      { p_item_id: portalItem.id, p_settled: false });
    check("Erledigt zurücknehmen bleibt möglich", undo.error === null,
      undo.error?.message ?? "bewusst ungesperrt");
    const settleFrozen = await operator.client.rpc("seller_settle_sale_item",
      { p_item_id: portalItem.id, p_settled: true });
    must("aber Erledigt SETZEN ist dort gesperrt", settleFrozen.error !== null,
      settleFrozen.error ? settleFrozen.error.code : "ES WURDE ANGENOMMEN");
    check("und sagt warum", refused(settleFrozen, "has not been released"),
      String(settleFrozen.error?.message ?? "").slice(0, 62));

    heading("10. Freigegeben, und die gewöhnliche Figur ist ausbuchbar — ungetestet mit Absicht");
    /*
     * The positive case is NOT exercised: booking creates a real movement,
     * and this tool promises to create none. The refusals above are what
     * cannot be checked any other way; that a released figure books is
     * covered by `itemActions` and by the read-only verification.
     */
    check("kein Ausbuchen ausgeführt", true, "der einzige Pfad, der Bestand bewegt");

    /* ======================== 0074 / 0075 ======================== */
    await admin.from("sales").update({ source: "manual", cancelled_at: null }).eq("id", saleId);

    heading("11. Nicht verschickt (0074)");
    const ns1 = await operator.client.rpc("seller_set_sale_item_not_shipped",
      { p_item_id: spareItem.id, p_not_shipped: true });
    must("bei einer nicht ausgebuchten Position erlaubt", ns1.error === null, ns1.error?.message ?? "");
    const nsRow = await admin.from("sale_items")
      .select("not_shipped_at, movement_id").eq("id", spareItem.id).single();
    check("setzt einen Zeitstempel und keine Bewegung",
      nsRow.data?.not_shipped_at !== null && nsRow.data?.movement_id === null);

    heading("12. settled und not_shipped schließen sich aus");
    const both = await admin.from("sale_items")
      .update({ settled_at: new Date().toISOString() }).eq("id", spareItem.id);
    must("die Datenbank verweigert beides zugleich", both.error !== null,
      both.error ? both.error.code : "BEIDES WURDE AKZEPTIERT");
    check("und nennt den Constraint",
      /sale_items_one_ending_without_movement/.test(both.error?.message ?? ""),
      String(both.error?.message ?? "").slice(0, 60));

    heading("13. Retoure ankündigen ohne Ausbuchung");
    const ra0 = await operator.client.rpc("seller_announce_sale_item_return",
      { p_item_id: figureItem.id, p_announced: true });
    must("wird verweigert", ra0.error !== null, ra0.error ? ra0.error.code : "ANGENOMMEN");
    check("und sagt warum", refused(ra0, "nothing was booked out of stock"),
      String(ra0.error?.message ?? "").slice(0, 60));

    /*
     * FROM HERE ONE REAL MOVEMENT EXISTS, AND IT IS PERMANENT.
     *
     * `seller_unbook_sale_item` does not delete a movement, it writes a
     * compensating `correction` — so there is no way to book and leave the
     * ledger untouched. The owner allowed exactly this on a fixture: the
     * shelf ends where it started, the two movements stay, and nothing is
     * reset by hand to hide them.
     */
    heading("14. Ausbuchen einer Fixture-Position — eine echte Bewegung");
    const booked = await operator.client.rpc("seller_book_sale_item", { p_item_id: fixtureItem.id });
    must("die Buchung gelingt", booked.error === null, booked.error?.message ?? "");
    const bookedRow = await admin.from("sale_items")
      .select("movement_id").eq("id", fixtureItem.id).single();
    must("und hinterlässt eine movement_id", bookedRow.data?.movement_id !== null);
    fixtureMovements.push(Number(bookedRow.data!.movement_id));
    const mv1 = await admin.from("inventory_movements")
      .select("delta, reason").eq("id", bookedRow.data!.movement_id).single();
    check("eine sale_external-Bewegung von −1",
      mv1.data?.delta === -1 && mv1.data?.reason === "sale_external",
      `${mv1.data?.delta} ${mv1.data?.reason}`);

    heading("15. Nicht verschickt wird nach einer Ausbuchung verweigert");
    const ns2 = await operator.client.rpc("seller_set_sale_item_not_shipped",
      { p_item_id: fixtureItem.id, p_not_shipped: true });
    must("der Aufruf schlägt fehl", ns2.error !== null, ns2.error ? ns2.error.code : "ANGENOMMEN");
    check("und sagt warum", refused(ns2, "left the shelf"),
      String(ns2.error?.message ?? "").slice(0, 60));

    heading("16. Retoure unterwegs — angekündigt, noch nichts zurück");
    const ra1 = await operator.client.rpc("seller_announce_sale_item_return",
      { p_item_id: fixtureItem.id, p_announced: true });
    must("die Ankündigung gelingt", ra1.error === null, ra1.error?.message ?? "");
    const annRow = await admin.from("sale_items")
      .select("return_announced_at, returned_at, return_movement_id").eq("id", fixtureItem.id).single();
    check("return_announced_at gesetzt", annRow.data?.return_announced_at !== null);
    must("returned_at bleibt leer", annRow.data?.returned_at === null);
    must("return_movement_id bleibt leer", annRow.data?.return_movement_id === null);

    const counts = async () => {
      const r = await operator!.client.rpc("seller_sales", {
        p_year: null, p_month: null, p_search: NOTE, p_undated: true,
        p_scope: "external", p_status: "any" });
      if (r.error) throw new Error(`ledger: ${r.error.message}`);
      return ((r.data as { sales?: Record<string, unknown>[] }).sales ?? [])
        .find((x) => Number(x.id) === saleId)!;
    };
    heading("17. Eine angekündigte Retoure macht die Position wieder offen");
    const c1 = await counts();
    check("sie zählt nicht mehr als ausgebucht", Number(c1.outbooked_count) === 0,
      `outbooked_count=${c1.outbooked_count}`);
    check("und die Bestellung ist offen", c1.is_open === true);
    check("open_count enthält sie", Number(c1.open_count) >= 1, `open_count=${c1.open_count}`);

    heading("18. Retoure angekommen — immer noch keine Bewegung");
    const beforeReturn = await admin.from("inventory_movements")
      .select("id", { count: "exact", head: true });
    const arrived = await operator.client.rpc("seller_return_sale_item",
      { p_item_id: fixtureItem.id, p_returned: true });
    must("die Meldung gelingt", arrived.error === null, arrived.error?.message ?? "");
    const afterReturn = await admin.from("inventory_movements")
      .select("id", { count: "exact", head: true });
    must("keine neue Bewegung dadurch", afterReturn.count === beforeReturn.count,
      `${beforeReturn.count} → ${afterReturn.count}`);
    const arrRow = await admin.from("sale_items")
      .select("returned_at, return_movement_id").eq("id", fixtureItem.id).single();
    check("returned_at gesetzt, noch nicht eingelagert",
      arrRow.data?.returned_at !== null && arrRow.data?.return_movement_id === null);

    heading("19. Einlagern — erst das ist eine echte Rückbewegung");
    const back = await operator.client.rpc("seller_restock_sale_item", { p_item_id: fixtureItem.id });
    must("das Einlagern gelingt", back.error === null, back.error?.message ?? "");
    const backRow = await admin.from("sale_items")
      .select("return_movement_id").eq("id", fixtureItem.id).single();
    must("return_movement_id gesetzt", backRow.data?.return_movement_id !== null);
    fixtureMovements.push(Number(backRow.data!.return_movement_id));
    const mv2 = await admin.from("inventory_movements")
      .select("delta, reason").eq("id", backRow.data!.return_movement_id).single();
    check("eine return-Bewegung von +1",
      mv2.data?.delta === 1 && mv2.data?.reason === "return", `${mv2.data?.delta} ${mv2.data?.reason}`);

    heading("20. Die sechs Zählungen bleiben getrennt");
    await operator.client.rpc("seller_set_sale_item_not_shipped",
      { p_item_id: figureItem.id, p_not_shipped: true });
    await operator.client.rpc("seller_settle_sale_item",
      { p_item_id: dashItem.id, p_settled: true });
    /* Section 9 reopened the portal to prove undoing is free; close it again. */
    await operator.client.rpc("seller_settle_sale_item",
      { p_item_id: portalItem.id, p_settled: true });
    const c2 = await counts();
    check("outbooked_count 0 — die Position kam zurück", Number(c2.outbooked_count) === 0,
      `${c2.outbooked_count}`);
    check("restocked_count 1", Number(c2.restocked_count) === 1, `${c2.restocked_count}`);
    check("settled_count 2", Number(c2.settled_count) === 2, `${c2.settled_count}`);
    check("not_shipped_count 2", Number(c2.not_shipped_count) === 2, `${c2.not_shipped_count}`);
    check("closed_count 5", Number(c2.closed_count) === 5, `${c2.closed_count}`);
    check("open_count 0", Number(c2.open_count) === 0, `${c2.open_count}`);
    check("nichts mehr offen", c2.is_open === false);

    heading("21. Gemischt abgeschlossen → `Abgeschlossen`, kein Haken");
    const mixed = saleStockStatus({
      source: "manual", cancelledAt: null, stockReleasedAt: null, orderId: null,
      itemCount: Number(c2.item_count), outbookedCount: Number(c2.outbooked_count),
      restockedCount: Number(c2.restocked_count), settledCount: Number(c2.settled_count),
      notShippedCount: Number(c2.not_shipped_count), closedCount: Number(c2.closed_count),
    });
    check("die Testbestellung ist `Abgeschlossen`", mixed === "closed", mixed);

    heading("22. Vollständig retour → `Retour ✓`, nicht `Ausgebucht ✓`");
    /* Read-only, gegen Sale 15 — der Fall, der 0075 ausgelöst hat. */
    const s15 = await admin.from("sales")
      .select("id, source, cancelled_at, stock_released_at, order_id").eq("id", 15).single();
    const i15 = await admin.from("sale_items")
      .select("movement_id, return_movement_id, returned_at, return_announced_at, settled_at, not_shipped_at")
      .eq("sale_id", 15);
    const rows15 = i15.data ?? [];
    const status15 = saleStockStatus({
      source: String(s15.data!.source), cancelledAt: s15.data!.cancelled_at as string | null,
      stockReleasedAt: s15.data!.stock_released_at as string | null,
      orderId: s15.data!.order_id as number | null, itemCount: rows15.length,
      outbookedCount: rows15.filter((r) => r.movement_id !== null && r.return_movement_id === null
        && r.return_announced_at === null && r.returned_at === null).length,
      restockedCount: rows15.filter((r) => r.return_movement_id !== null).length,
      settledCount: rows15.filter((r) => r.settled_at !== null).length,
      notShippedCount: rows15.filter((r) => r.not_shipped_at !== null).length,
    });
    check("Sale 15 leitet sich als `Retour ✓` ab", status15 === "returned", status15);
    check("und nicht als `Ausgebucht ✓`", status15 !== "outbooked", status15);

    /* --------------------------------------------------- Testdaten weg */
    heading("Testdaten entfernen");
    await admin.from("sales").update({ source: "manual", cancelled_at: null }).eq("id", saleId);
    for (const row of rows.data) await admin.from("sale_items").delete().eq("id", row.id);
    const gone = await admin.from("sales").delete().eq("id", saleId);
    check("Testverkauf gelöscht", gone.error === null, gone.error?.message ?? "");
    if (gone.error === null) saleId = null;
  } catch (error) {
    if (!(error instanceof Halt)) {
      console.error(`\n  ABBRUCH: ${error instanceof Error ? error.message : String(error)}`);
      results.push({ name: "Durchlauf ohne Ausnahme", passed: false });
    } else {
      console.error("\n  ABBRUCH nach einer fehlgeschlagenen Prüfung — nichts weiter getestet.");
    }
  } finally {
    heading("Aufräumen");
    if (saleId !== null) {
      await admin.from("sales").update({ source: "manual", cancelled_at: null }).eq("id", saleId);
      const left = await admin.from("sale_items").select("id").eq("sale_id", saleId);
      for (const row of left.data ?? []) await admin.from("sale_items").delete().eq("id", row.id);
      const gone = await admin.from("sales").delete().eq("id", saleId);
      console.log(`  Testverkauf #${saleId} nachträglich entfernt${gone.error ? ` (${gone.error.message})` : ""}`);
    }
    if (operator && sellerId !== null) {
      await admin.from("seller_operators")
        .delete().eq("seller_id", sellerId).eq("user_id", operator.user.id);
      await admin.auth.admin.deleteUser(operator.user.id);
      console.log("  temporärer Operator entfernt");
    }
  }

  const after = await snapshot(admin);
  heading("Nachher");
  console.log(`  ${show(after)}`);
  check("Bestand unverändert", after.quantity === before.quantity,
    `${before.quantity} → ${after.quantity}`);
  check("reserviert unverändert", after.reserved === before.reserved);
  /*
   * EXACTLY THE TWO THE FIXTURE LIFECYCLE MADE, AND NOTHING ELSE.
   *
   * Booking cannot be undone without writing a third movement, so these
   * two stay. They are named rather than tolerated: the check fails if the
   * count moved by any other amount, or if the surviving rows are not the
   * −1 and the +1 this run created on the fixture figure.
   */
  check("die Bewegungszahl stieg um genau zwei", after.movements === before.movements + 2,
    `${before.movements} → ${after.movements}`);
  const made = await admin.from("inventory_movements")
    .select("id, delta, reason, inventory_id").in("id", fixtureMovements);
  const rows = made.data ?? [];
  check("und es sind die zwei der Fixture", rows.length === 2, `${rows.length}`);
  check("eine sale_external −1 und eine return +1",
    rows.some((r) => r.delta === -1 && r.reason === "sale_external")
    && rows.some((r) => r.delta === 1 && r.reason === "return"),
    rows.map((r) => `${r.delta} ${r.reason}`).join(" · "));
  check("beide auf derselben Fixture-Lagerposition",
    new Set(rows.map((r) => r.inventory_id)).size === 1,
    [...new Set(rows.map((r) => r.inventory_id))].join(","));
  check("netto null — der Bestand steht, wo er stand",
    rows.reduce((t, r) => t + Number(r.delta), 0) === 0,
    String(rows.reduce((t, r) => t + Number(r.delta), 0)));
  check("22 Sales weiterhin freigegeben oder storniert", after.released === 22, `${after.released}`);
  check("197 echte Positionen unverändert", after.items === 197, `${after.items}`);
  check("keine davon ausgebucht", after.withMovement === 0, `${after.withMovement}`);
  check("keine davon erledigt", after.withSettled === 0, `${after.withSettled}`);

  const strays = await admin.from("sales").select("id").like("note", "verify:sale-locks%");
  check("kein Test-Verkauf zurückgeblieben", (strays.data?.length ?? 0) === 0);
  const strayItems = await admin.from("sale_items").select("id").like("raw_name", "Verify-Portal%");
  check("keine Test-Position zurückgeblieben", (strayItems.data?.length ?? 0) === 0);
  const strayOps = await admin.from("seller_operators").select("user_id").like("note", "verify:sale-locks%");
  check("keine Operator-Zuordnung zurückgeblieben", (strayOps.data?.length ?? 0) === 0);
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const leftovers = (users.data?.users ?? []).filter((u) => (u.email ?? "").startsWith("sale-locks-"));
  check("kein temporärer Auth-Nutzer zurückgeblieben", leftovers.length === 0,
    leftovers.map((u) => u.email).join(", ") || "keiner");

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
