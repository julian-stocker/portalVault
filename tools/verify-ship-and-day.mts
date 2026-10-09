/**
 * Functional verification of `0112` and `0113` — the one-click ship, the
 * daily index and the repeat buyer.
 *
 *   npm run verify:ship-day:staging
 *
 * STAGING ONLY, AND IT WRITES. It creates one temporary seller operator and
 * nine throwaway sales on three days that staging leaves empty, exercises
 * every rule the two migrations promise, and removes all of it again in a
 * `finally` — including after a failed assertion.
 *
 * WHAT IT PROVES, in the order in which one would doubt it:
 *
 *   A1  a sale made only of free articles finishes in ONE call: the shipment
 *       is dated and the free position is settled, in one transaction
 *   A2  …and the second identical call writes nothing and does not move the
 *       shipping date
 *   A3  a MIXED sale closes its free position and leaves the catalogue one
 *       alone — `still_open` says so, the hold survives, nothing is booked
 *   B1  two external sales of one buyer differing only in LETTER CASE are one
 *       identity: first false, second true
 *   B2  the same username in two different channels is NOT one identity
 *   B3  a cancelled earlier sale stops counting as a previous purchase
 *   D1  three sales on one day get places 1, 2, 3 in creation order
 *   D2  a swap exchanges exactly two rows, leaves no gap and no duplicate,
 *       and reverses the ledger order of that day
 *   D3  a swap onto one's own place writes nothing
 *   D4  place 0 and an unoccupied place are refused
 *   D5  a sale without a day has no place to swap
 *
 * AND THAT NOTHING ELSE MOVED. A fingerprint is taken before the first write
 * and again after the cleanup: row counts, the whole id set, and four hashes
 * over amounts, status fields, positions and reservations. The run fails if
 * the two do not match — a test that cannot prove it put the database back is
 * not finished.
 *
 * THE ONE DELIBERATE STEP OUTSIDE THE PRODUCT PATH is marked as such where it
 * happens: `sales.cancelled_at` has no `seller_*` writer for an external sale
 * (only the one-time backfill in `0071` ever set it), so B3 sets it with the
 * service role — on a row this run created seconds earlier, never on existing
 * history.
 *
 * NEVER TOUCHED: any pre-existing sale, sale #129 (staging's one undated
 * sale, which gets its own throwaway counterpart instead), any inventory
 * movement, any amount.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, passed: boolean, detail = ""): void => {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const heading = (text: string) => console.log(`\n${text}\n${"-".repeat(text.length)}`);
const note = (text: string) => console.log(`       ${text}`);

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

/** Run-scoped suffix, so a broken-off run cannot collide with the next. */
const RUN = Date.now().toString(36);

/*
 * THREE DAYS STAGING LEAVES EMPTY, verified read-only before the first write.
 * One day per feature keeps every "this day carries exactly n" assertion
 * sharp — and the guard below refuses to run if any of them is occupied.
 */
const DAY_SHIP = "2026-10-05";
const DAY_BUYER = "2026-10-06";
const DAY_INDEX = "2026-10-07";

// ---------------------------------------------------------------------------
// The fingerprint — what must be identical afterwards
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

async function page(admin: SupabaseClient, table: string, select: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const got = await admin.from(table).select(select).order("id", { ascending: true })
      .range(from, from + 999);
    if (got.error) throw new Error(`${table}: ${got.error.message}`);
    const rows = (got.data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function countOf(admin: SupabaseClient, table: string): Promise<number> {
  const got = await admin.from(table).select("id", { count: "exact", head: true });
  if (got.error) throw new Error(`${table}: ${got.error.message}`);
  return got.count ?? -1;
}

const digest = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")
    .slice(0, 16);
};

const str = (v: unknown) => (v === null || v === undefined ? "·" : String(v));

type Fingerprint = {
  saleCount: number; saleIds: number[];
  itemCount: number; movements: number; auditRows: number;
  inventoryRows: number; quantity: number; reserved: number;
  reservationCount: number; activeReservations: number;
  moneyHash: string; stateHash: string; itemHash: string; reservationHash: string;
  /** The business order of the ledger: `sale_day DESC NULLS LAST, daily_index DESC, id DESC`. */
  order: number[];
};

async function fingerprint(admin: SupabaseClient): Promise<Fingerprint> {
  const sales = await page(admin, "sales",
    "id,sold_at,sale_day,daily_index,shipped_at,cancelled_at,stock_released_at,updated_at,"
    + "items_subtotal,shipping_charged,discount_amount,reported_payout_amount");
  const items = await page(admin, "sale_items",
    "id,sale_id,sky_id,movement_id,settled_at,not_shipped_at,return_movement_id,returned_at");
  const inventory = await page(admin, "shop_inventory", "id,quantity,reserved");
  const reservations = await page(admin, "order_reservations",
    "id,order_id,sale_item_id,state,quantity");

  const order = [...sales].sort((a, b) => {
    const da = (a.sale_day as string | null) ?? null;
    const db = (b.sale_day as string | null) ?? null;
    if (da !== db) { if (da === null) return 1; if (db === null) return -1; return da < db ? 1 : -1; }
    const ia = (a.daily_index as number | null) ?? null;
    const ib = (b.daily_index as number | null) ?? null;
    if (ia !== ib) { if (ia === null) return 1; if (ib === null) return -1; return ib - ia; }
    return Number(b.id) - Number(a.id);
  }).map((s) => Number(s.id));

  return {
    saleCount: sales.length,
    saleIds: sales.map((s) => Number(s.id)).sort((a, b) => a - b),
    itemCount: items.length,
    movements: await countOf(admin, "inventory_movements"),
    auditRows: await countOf(admin, "orderbook_audit"),
    inventoryRows: inventory.length,
    quantity: inventory.reduce((n, r) => n + Number(r.quantity ?? 0), 0),
    reserved: inventory.reduce((n, r) => n + Number(r.reserved ?? 0), 0),
    reservationCount: reservations.length,
    activeReservations: reservations.filter((r) => r.state === "active").length,
    moneyHash: await digest(sales.map((s) => [s.id, str(s.items_subtotal),
      str(s.shipping_charged), str(s.discount_amount), str(s.reported_payout_amount)]
      .join("|")).join("\n")),
    stateHash: await digest(sales.map((s) => [s.id, str(s.sold_at), str(s.shipped_at),
      str(s.cancelled_at), str(s.stock_released_at), str(s.updated_at)].join("|")).join("\n")),
    itemHash: await digest(items.map((i) => [i.id, i.sale_id, str(i.sky_id), str(i.movement_id),
      str(i.settled_at), str(i.not_shipped_at), str(i.return_movement_id)].join("|")).join("\n")),
    reservationHash: await digest(reservations.map((r) => [r.id, str(r.order_id),
      str(r.sale_item_id), r.state, r.quantity].join("|")).join("\n")),
    order,
  };
}

/** Stock only — for the assertions inside a single step. */
async function stockOf(admin: SupabaseClient) {
  const inventory = await page(admin, "shop_inventory", "id,quantity,reserved");
  return {
    quantity: inventory.reduce((n, r) => n + Number(r.quantity ?? 0), 0),
    reserved: inventory.reduce((n, r) => n + Number(r.reserved ?? 0), 0),
    movements: await countOf(admin, "inventory_movements"),
  };
}
type Stock = Awaited<ReturnType<typeof stockOf>>;
const sameStock = (a: Stock, b: Stock) =>
  a.quantity === b.quantity && a.reserved === b.reserved && a.movements === b.movements;
const showStock = (s: Stock) =>
  `Menge ${s.quantity} · reserviert ${s.reserved} · Bewegungen ${s.movements}`;

// ---------------------------------------------------------------------------
// Calling as the operator
// ---------------------------------------------------------------------------

type Call = { ok: true; data: unknown } | { ok: false; code: string; message: string };

async function rpc(client: SupabaseClient, fn: string, args: Row): Promise<Call> {
  const got = await client.rpc(fn, args);
  if (got.error) {
    return { ok: false, code: got.error.code ?? "", message: got.error.message ?? "" };
  }
  return { ok: true, data: got.data };
}

/** The same call, but it must succeed — a setup step that fails stops the run. */
async function must(client: SupabaseClient, fn: string, args: Row): Promise<unknown> {
  const got = await rpc(client, fn, args);
  if (!got.ok) throw new Error(`${fn}: ${got.code} ${got.message}`);
  return got.data;
}

type Ship = { ok: boolean; settled: number; still_open: number; shipped_at: string | null;
              already_shipped: boolean };
type Swap = { ok: boolean; moved: boolean; daily_index: number; swapped_with?: number;
              swapped_from?: number };

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  /*
   * THE GUARD, BEFORE A CLIENT EVEN EXISTS. It compares origin AND
   * service-role key against `.env.staging` and refuses anything else —
   * production by url, production by credential, and any third project.
   */
  requireStaging("verify:ship-day");

  const admin = serviceClient();
  /** Every sale this run created, newest first — the cleanup list. */
  const mine: number[] = [];
  let operator: { client: SupabaseClient; user: User } | null = null;
  let sellerId: number | null = null;
  let before: Fingerprint | null = null;

  try {
    heading("0. Before the first write");

    before = await fingerprint(admin);
    note(`${before.saleCount} sales · ${before.itemCount} Positionen · `
      + `${before.movements} Bewegungen · ${before.auditRows} Audit-Zeilen`);
    note(`${before.inventoryRows} Lagerzeilen · Menge ${before.quantity} · `
      + `reserviert ${before.reserved} · ${before.reservationCount} Reservierungen `
      + `(${before.activeReservations} aktiv)`);

    check("staging carries the 303 sales the migration postflight saw",
      before.saleCount === 303, String(before.saleCount));
    check("…and the 1 284 positions", before.itemCount === 1284, String(before.itemCount));
    check("…and 20 inventory movements", before.movements === 20, String(before.movements));
    check("…and 284 inventory rows with quantity 808, reserved 0",
      before.inventoryRows === 284 && before.quantity === 808 && before.reserved === 0,
      `${before.inventoryRows}/${before.quantity}/${before.reserved}`);
    check("…and 9 reservations, none active",
      before.reservationCount === 9 && before.activeReservations === 0,
      `${before.reservationCount}/${before.activeReservations}`);

    /*
     * THE THREE DAYS MUST BE EMPTY, or the per-day assertions below mean
     * something else than they say. Refusing is the only safe answer: a run
     * that quietly adapts would also quietly stop testing what it claims.
     */
    const occupied = await admin.from("sales").select("id,sale_day")
      .in("sale_day", [DAY_SHIP, DAY_BUYER, DAY_INDEX]);
    if (occupied.error) throw new Error(`day check: ${occupied.error.message}`);
    check("the three test days are empty on staging",
      (occupied.data ?? []).length === 0,
      (occupied.data ?? []).map((r) => `#${r.id} ${r.sale_day}`).join(", "));
    if ((occupied.data ?? []).length > 0) {
      throw new Error("test days are not empty — refusing to run");
    }

    // -----------------------------------------------------------------------
    heading("1. One temporary seller operator");

    const seller = await admin.from("sellers").select("id").eq("is_active", true).single();
    if (seller.error) throw new Error(`sellers: ${seller.error.message}`);
    sellerId = seller.data.id as number;

    {
      /* Random password, in a block scope, never logged and never stored. */
      const credentials = {
        email: `ship-day-${RUN}@skyisles.invalid`,
        password: `sd-${RUN}-${Math.random().toString(36).slice(2)}`,
      };
      const made = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
      if (made.error) throw new Error(`createUser: ${made.error.message}`);
      const client = anonClient();
      const signedIn = await client.auth.signInWithPassword(credentials);
      if (signedIn.error) throw new Error(`signIn: ${signedIn.error.message}`);
      operator = { client, user: made.data.user };
    }
    const member = await admin.from("seller_operators").insert({
      seller_id: sellerId, user_id: operator.user.id, note: "verify:ship-day",
    });
    if (member.error) throw new Error(`seller_operators: ${member.error.message}`);
    check("a temporary operator can be created and signed in", true);
    const op = operator.client;

    /** Create one throwaway sale and remember it for the cleanup immediately. */
    const makeSale = async (args: Row): Promise<number> => {
      const id = Number(await must(op, "seller_create_sale_with_details", args));
      mine.unshift(id);
      return id;
    };
    const saleRow = async (id: number): Promise<Row> => {
      const got = await admin.from("sales").select("*").eq("id", id).single();
      if (got.error) throw new Error(`sale ${id}: ${got.error.message}`);
      return got.data as Row;
    };
    const itemsOf = async (id: number): Promise<Row[]> => {
      const got = await admin.from("sale_items")
        .select("id,sky_id,raw_name,movement_id,settled_at,not_shipped_at,position")
        .eq("sale_id", id).order("position", { ascending: true });
      if (got.error) throw new Error(`items ${id}: ${got.error.message}`);
      return (got.data ?? []) as Row[];
    };
    const holdsOf = async (itemId: number): Promise<Row[]> => {
      const got = await admin.from("order_reservations")
        .select("id,state,quantity,sale_item_id").eq("sale_item_id", itemId);
      if (got.error) throw new Error(`holds ${itemId}: ${got.error.message}`);
      return (got.data ?? []) as Row[];
    };
    /** `seller_sales()` as the operator — the real projection, not a rebuild. */
    const ledger = async (): Promise<Map<number, Row>> => {
      const data = await must(op, "seller_sales", { p_status: "any" }) as
        { sales?: Row[] } | null;
      const rows = (data?.sales ?? []) as Row[];
      return new Map(rows.map((r) => [Number(r.id), r]));
    };

    // -----------------------------------------------------------------------
    heading("2. A — a sale of free articles only, finished in one call");

    const stockA = await stockOf(admin);

    const s1 = await makeSale({
      p_channel: "manual", p_sold_at: DAY_SHIP, p_is_test: true,
      p_buyer_ref: `ship-free-${RUN}`, p_note: `verify:ship-day ${RUN}`,
      p_items_subtotal: 0, p_shipping_charged: 0,
      p_items: [{ raw_name: `Testportal ${RUN}` }],
    });
    const s1Items = await itemsOf(s1);
    check("A — the free position exists with raw_name and no sky_id",
      s1Items.length === 1 && s1Items[0].sky_id === null
      && String(s1Items[0].raw_name) === `Testportal ${RUN}`,
      `${s1Items.length} Position(en)`);
    check("A — creating it took no hold", (await holdsOf(Number(s1Items[0].id))).length === 0);
    check("A — and moved no stock", sameStock(await stockOf(admin), stockA),
      showStock(await stockOf(admin)));

    const firstShip = await must(op, "seller_ship_sale", { p_id: s1 }) as Ship;
    check("A1 — one call settles the free position and dates the shipment",
      firstShip.ok === true && firstShip.settled === 1 && firstShip.still_open === 0
      && firstShip.already_shipped === false && firstShip.shipped_at !== null,
      JSON.stringify(firstShip));

    const s1After = await saleRow(s1);
    const s1ItemsAfter = await itemsOf(s1);
    check("A1 — sales.shipped_at is set", s1After.shipped_at !== null, str(s1After.shipped_at));
    check("A1 — the free position carries settled_at and still no movement",
      s1ItemsAfter[0].settled_at !== null && s1ItemsAfter[0].movement_id === null);
    check("A1 — no inventory movement, no stock change, no hold",
      sameStock(await stockOf(admin), stockA)
      && (await holdsOf(Number(s1Items[0].id))).length === 0,
      showStock(await stockOf(admin)));

    const ledgerA = await ledger();
    check("A1 — the ledger calls the sale finished (is_open = false)",
      ledgerA.get(s1)?.is_open === false, str(ledgerA.get(s1)?.is_open));

    const secondShip = await must(op, "seller_ship_sale", { p_id: s1 }) as Ship;
    const s1Twice = await saleRow(s1);
    check("A2 — the second identical call settles nothing and says so",
      secondShip.settled === 0 && secondShip.still_open === 0
      && secondShip.already_shipped === true,
      JSON.stringify(secondShip));
    check("A2 — and does not move the shipping date",
      String(s1Twice.shipped_at) === String(s1After.shipped_at),
      `${str(s1After.shipped_at)} → ${str(s1Twice.shipped_at)}`);

    const gone = await rpc(op, "seller_ship_sale", { p_id: 99999999 });
    check("A — a sale that does not exist is refused",
      !gone.ok && gone.message.includes("no such sale"),
      gone.ok ? "accepted" : `${gone.code} ${gone.message}`);

    // -----------------------------------------------------------------------
    heading("3. A — a mixed sale leaves the catalogue position alone");

    /* Picked at runtime: never a hard-coded SKY-ID, never an invented one. */
    const free = await admin.from("shop_inventory").select("sky_id,quantity,reserved,condition")
      .eq("condition", "loose").eq("reserved", 0).gte("quantity", 1).limit(1);
    if (free.error) throw new Error(`shop_inventory: ${free.error.message}`);
    const picked = (free.data ?? [])[0] as { sky_id: string } | undefined;
    if (!picked) throw new Error("no loose stock row with free quantity — cannot test the hold");
    note(`Katalogfigur für den gemischten Verkauf: ${picked.sky_id}`);

    const beforeMixed = await stockOf(admin);
    const s2 = await makeSale({
      p_channel: "manual", p_sold_at: DAY_SHIP, p_is_test: true,
      p_buyer_ref: `ship-mixed-${RUN}`, p_note: `verify:ship-day ${RUN}`,
      p_items_subtotal: 0, p_shipping_charged: 0,
      p_items: [{ raw_name: `Testspiel ${RUN}` }, { sky_id: picked.sky_id }],
    });
    const s2Items = await itemsOf(s2);
    const s2Free = s2Items.find((i) => i.sky_id === null)!;
    const s2Figure = s2Items.find((i) => i.sky_id !== null)!;
    check("A3 — the mixed sale has one free and one catalogue position",
      s2Free !== undefined && s2Figure !== undefined, `${s2Items.length} Positionen`);

    const afterCreate = await stockOf(admin);
    const figureHolds = await holdsOf(Number(s2Figure.id));
    check("A3 — the catalogue position took a hold",
      figureHolds.length === 1 && figureHolds[0].state === "active"
      && afterCreate.reserved === beforeMixed.reserved + 1,
      `${figureHolds.length} Hold(s) · reserviert ${beforeMixed.reserved} → ${afterCreate.reserved}`);
    check("A3 — the free position took none", (await holdsOf(Number(s2Free.id))).length === 0);
    check("A3 — and nothing left the shelf", afterCreate.quantity === beforeMixed.quantity
      && afterCreate.movements === beforeMixed.movements, showStock(afterCreate));

    const mixedShip = await must(op, "seller_ship_sale", { p_id: s2 }) as Ship;
    check("A3 — one free position settled, ONE still open",
      mixedShip.settled === 1 && mixedShip.still_open === 1,
      JSON.stringify(mixedShip));

    const s2ItemsAfter = await itemsOf(s2);
    const s2FreeAfter = s2ItemsAfter.find((i) => Number(i.id) === Number(s2Free.id))!;
    const s2FigureAfter = s2ItemsAfter.find((i) => Number(i.id) === Number(s2Figure.id))!;
    check("A3 — the free position is settled", s2FreeAfter.settled_at !== null);
    check("A3 — the catalogue position is NOT silently closed",
      s2FigureAfter.settled_at === null && s2FigureAfter.not_shipped_at === null,
      `settled_at=${str(s2FigureAfter.settled_at)} not_shipped_at=${str(s2FigureAfter.not_shipped_at)}`);
    check("A3 — and NOT silently booked out", s2FigureAfter.movement_id === null,
      str(s2FigureAfter.movement_id));

    const holdsAfterShip = await holdsOf(Number(s2Figure.id));
    const afterShip = await stockOf(admin);
    check("A3 — the hold survives the shipment",
      holdsAfterShip.length === 1 && holdsAfterShip[0].state === "active"
      && afterShip.reserved === afterCreate.reserved,
      `${holdsAfterShip[0]?.state} · reserviert ${afterShip.reserved}`);
    check("A3 — still no inventory movement",
      afterShip.movements === beforeMixed.movements && afterShip.quantity === beforeMixed.quantity,
      showStock(afterShip));

    const ledgerMixed = await ledger();
    check("A3 — the ledger keeps the mixed sale OPEN",
      ledgerMixed.get(s2)?.is_open === true, str(ledgerMixed.get(s2)?.is_open));
    check("A3 — and reports shipped_at on it anyway",
      (await saleRow(s2)).shipped_at !== null);

    // -----------------------------------------------------------------------
    heading("4. B — who counts as the same buyer");

    /*
     * `is_test = false` ON PURPOSE, and this is the tension worth naming:
     * `sale_is_test()` removes a test sale from the repeat-buyer window
     * entirely, so a test-flagged fixture would prove nothing here. These
     * three carry no amounts, no items and no stock effect, and they are
     * deleted at the end of the run.
     */
    const b1 = await makeSale({
      p_channel: "ebay", p_sold_at: DAY_BUYER, p_is_test: false,
      p_buyer_ref: `SkyTest-${RUN}`, p_note: `verify:ship-day ${RUN}`,
      p_items_subtotal: 0, p_shipping_charged: 0, p_items: [],
    });
    const b2 = await makeSale({
      p_channel: "ebay", p_sold_at: DAY_BUYER, p_is_test: false,
      p_buyer_ref: `  skytest-${RUN}  `, p_note: `verify:ship-day ${RUN}`,
      p_items_subtotal: 0, p_shipping_charged: 0, p_items: [],
    });
    const b3 = await makeSale({
      p_channel: "manual", p_sold_at: DAY_BUYER, p_is_test: false,
      p_buyer_ref: `skytest-${RUN}`, p_note: `verify:ship-day ${RUN}`,
      p_items_subtotal: 0, p_shipping_charged: 0, p_items: [],
    });

    const bRows = await Promise.all([saleRow(b1), saleRow(b2), saleRow(b3)]);
    note(`gespeicherte buyer_ref: ${bRows.map((r) => JSON.stringify(r.buyer_ref)).join(" · ")}`);
    check("B — the three sit on one day as places 1, 2, 3",
      Number(bRows[0].daily_index) === 1 && Number(bRows[1].daily_index) === 2
      && Number(bRows[2].daily_index) === 3,
      bRows.map((r) => r.daily_index).join(","));

    const ledgerB1 = await ledger();
    check("B1 — the first purchase is not a repeat",
      ledgerB1.get(b1)?.buyer_repeat === false, str(ledgerB1.get(b1)?.buyer_repeat));
    check("B1 — the second one, differing only in letter case, IS a repeat",
      ledgerB1.get(b2)?.buyer_repeat === true, str(ledgerB1.get(b2)?.buyer_repeat));
    check("B2 — the same username in another channel is NOT the same buyer",
      ledgerB1.get(b3)?.buyer_repeat === false, str(ledgerB1.get(b3)?.buyer_repeat));
    check("B — buyer_label shows the stored reference, not the normalised key",
      String(ledgerB1.get(b1)?.buyer_label) === String(bRows[0].buyer_ref),
      `${str(ledgerB1.get(b1)?.buyer_label)} vs ${str(bRows[0].buyer_ref)}`);

    /*
     * ---- TEST MANIPULATION, OUTSIDE THE PRODUCT PATH ----------------------
     *
     * `sales.cancelled_at` has no `seller_*` writer for an external sale; the
     * only thing that ever set it is the one-time backfill in `0071`. So this
     * one precondition is written with the service role, and only on the row
     * created a few lines above — never on existing history.
     */
    console.log("       [Test-Manipulation außerhalb des Produktpfads] "
      + `sales.cancelled_at auf der Wegwerfzeile #${b1}`);
    const cancelled = await admin.from("sales")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", b1).is("order_id", null).select("id,cancelled_at").single();
    if (cancelled.error) throw new Error(`cancel ${b1}: ${cancelled.error.message}`);
    check("B3 — the throwaway row is cancelled (test manipulation, marked)",
      cancelled.data.cancelled_at !== null, str(cancelled.data.cancelled_at));

    const ledgerB2 = await ledger();
    check("B3 — a cancelled earlier sale stops counting as a previous purchase",
      ledgerB2.get(b2)?.buyer_repeat === false, str(ledgerB2.get(b2)?.buyer_repeat));
    check("B3 — the cancelled row itself is not marked either",
      ledgerB2.get(b1)?.buyer_repeat === false, str(ledgerB2.get(b1)?.buyer_repeat));
    check("B3 — and the other channel is untouched by all of it",
      ledgerB2.get(b3)?.buyer_repeat === false, str(ledgerB2.get(b3)?.buyer_repeat));

    // -----------------------------------------------------------------------
    heading("5. D — the place within a day, and the swap");

    const t1 = await makeSale({
      p_channel: "manual", p_sold_at: DAY_INDEX, p_is_test: true,
      p_buyer_ref: `day-a-${RUN}`, p_items_subtotal: 0, p_shipping_charged: 0,
      p_items: [{ raw_name: `Tag A ${RUN}` }],
    });
    const t2 = await makeSale({
      p_channel: "manual", p_sold_at: DAY_INDEX, p_is_test: true,
      p_buyer_ref: `day-b-${RUN}`, p_items_subtotal: 0, p_shipping_charged: 0,
      p_items: [{ raw_name: `Tag B ${RUN}` }],
    });
    const t3 = await makeSale({
      p_channel: "manual", p_sold_at: DAY_INDEX, p_is_test: true,
      p_buyer_ref: `day-c-${RUN}`, p_items_subtotal: 0, p_shipping_charged: 0,
      p_items: [{ raw_name: `Tag C ${RUN}` }],
    });

    /** `(id, daily_index, updated_at)` of the test day — the swap's evidence. */
    const dayRows = async (): Promise<Row[]> => {
      const got = await admin.from("sales").select("id,daily_index,updated_at")
        .eq("sale_day", DAY_INDEX).order("daily_index", { ascending: true });
      if (got.error) throw new Error(`day ${DAY_INDEX}: ${got.error.message}`);
      return (got.data ?? []) as Row[];
    };
    const places = async (): Promise<Map<number, number>> =>
      new Map((await dayRows()).map((r) => [Number(r.id), Number(r.daily_index)]));

    const beforeSwap = await dayRows();
    const p0 = await places();
    check("D1 — three sales on one day get places 1, 2, 3 in creation order",
      p0.get(t1) === 1 && p0.get(t2) === 2 && p0.get(t3) === 3,
      `${p0.get(t1)}/${p0.get(t2)}/${p0.get(t3)}`);

    const detail = await must(op, "seller_sale", { p_id: t2 }) as Row;
    const dayOrder = (detail.day_order ?? []) as Row[];
    check("D1 — seller_sale reports the day's size and its occupied places",
      Number(detail.daily_index_count) === 3
      && dayOrder.map((r) => Number(r.daily_index)).join(",") === "3,2,1",
      `count=${str(detail.daily_index_count)} order=${dayOrder.map((r) => r.daily_index).join(",")}`);

    const stockBeforeSwap = await stockOf(admin);
    const swapped = await must(op, "seller_swap_sale_daily_index",
      { p_id: t1, p_with_index: 3 }) as Swap;
    check("D2 — the swap reports what it did",
      swapped.ok === true && swapped.moved === true && Number(swapped.daily_index) === 3
      && Number(swapped.swapped_with) === t3 && Number(swapped.swapped_from) === 1,
      JSON.stringify(swapped));

    const p1 = await places();
    check("D2 — A and C exchanged places, B did not move",
      p1.get(t3) === 1 && p1.get(t2) === 2 && p1.get(t1) === 3,
      `${p1.get(t1)}/${p1.get(t2)}/${p1.get(t3)}`);

    const afterSwap = await dayRows();
    const touched = afterSwap.filter((row) => {
      const was = beforeSwap.find((b) => Number(b.id) === Number(row.id))!;
      return String(was.updated_at) !== String(row.updated_at);
    }).map((r) => Number(r.id)).sort((a, b) => a - b);
    check("D2 — exactly two rows were written",
      touched.length === 2 && touched.includes(t1) && touched.includes(t3),
      `${touched.length}: ${touched.join(",")}`);

    const dayPlaces = [...(await places()).values()].sort((a, b) => a - b);
    check("D2 — no gap and no duplicate: the day still carries 1, 2, 3",
      dayPlaces.join(",") === "1,2,3", dayPlaces.join(","));

    const ledgerD = await ledger();
    const shown = [...ledgerD.values()]
      .filter((r) => String(r.sold_at) === DAY_INDEX)
      .map((r) => Number(r.id));
    check("D2 — the ledger order of that day reversed",
      shown.join(",") === [t1, t2, t3].join(","),
      `${[t3, t2, t1].join(",")} → ${shown.join(",")}`);

    const noop = await must(op, "seller_swap_sale_daily_index",
      { p_id: t1, p_with_index: 3 }) as Swap;
    const afterNoop = await dayRows();
    const movedByNoop = afterNoop.filter((row) => {
      const was = afterSwap.find((b) => Number(b.id) === Number(row.id))!;
      return String(was.updated_at) !== String(row.updated_at);
    });
    check("D3 — a swap onto one's own place is a no-op that writes nothing",
      noop.moved === false && movedByNoop.length === 0,
      `${JSON.stringify(noop)} · ${movedByNoop.length} Zeile(n) berührt`);

    const zero = await rpc(op, "seller_swap_sale_daily_index", { p_id: t1, p_with_index: 0 });
    check("D4 — place 0 is refused",
      !zero.ok && zero.message.includes("a place in a day starts at one"),
      zero.ok ? "accepted" : `${zero.code} ${zero.message}`);
    const nowhere = await rpc(op, "seller_swap_sale_daily_index", { p_id: t1, p_with_index: 99 });
    check("D4 — an unoccupied place is refused",
      !nowhere.ok && nowhere.message.includes("no sale holds that place"),
      nowhere.ok ? "accepted" : `${nowhere.code} ${nowhere.message}`);

    /*
     * ITS OWN UNDATED ROW — sale #129 is staging's real undated sale and is
     * not touched, not even as the target of a refusal.
     */
    const t4 = await makeSale({
      p_channel: "manual", p_sold_at: null, p_is_test: true,
      p_buyer_ref: `day-undated-${RUN}`, p_items_subtotal: 0, p_shipping_charged: 0,
      p_items: [{ raw_name: `Ohne Tag ${RUN}` }],
    });
    const t4Row = await saleRow(t4);
    check("D5 — an undated sale gets neither a day nor a place",
      t4Row.sale_day === null && t4Row.daily_index === null,
      `sale_day=${str(t4Row.sale_day)} daily_index=${str(t4Row.daily_index)}`);
    const undated = await rpc(op, "seller_swap_sale_daily_index", { p_id: t4, p_with_index: 1 });
    check("D5 — and cannot swap a place it does not have",
      !undated.ok && undated.message.includes("without a day has no place"),
      undated.ok ? "accepted" : `${undated.code} ${undated.message}`);

    const s129 = await saleRow(129);
    check("D5 — the real undated sale #129 is untouched",
      s129.sale_day === null && s129.daily_index === null && s129.cancelled_at === null,
      `sale_day=${str(s129.sale_day)} daily_index=${str(s129.daily_index)}`);

    check("D — no parked negative place survived anywhere",
      ((await admin.from("sales").select("id", { count: "exact", head: true })
        .lte("daily_index", 0)).count ?? -1) === 0);
    check("D — the swap moved no stock, no movement, no hold",
      sameStock(await stockOf(admin), stockBeforeSwap), showStock(await stockOf(admin)));

  } catch (error) {
    /*
     * A THROWN SETUP ERROR IS A FAILED TEST, NOT A CRASH.
     *
     * It is recorded here so the summary still prints and the cleanup in
     * `finally` still runs — a run that dies on an exception and leaves nine
     * sales behind is the one outcome this file must not have.
     */
    check("the run completed without an unexpected error", false,
      error instanceof Error ? error.message : String(error));
  } finally {
    // -----------------------------------------------------------------------
    heading("6. Cleanup");

    /*
     * THE SALES FIRST, THE ACCOUNT AFTER.
     *
     * `seller_delete_sale` releases every active hold before the cascade takes
     * the positions, and `orderbook_audit.sale_id` is `ON DELETE CASCADE`, so
     * the audit rows of a throwaway sale go with it. Nothing historical is
     * named, matched or touched: the list is exactly the ids this run created.
     *
     * Deleting as the OPERATOR, not as the service role — the same gated path
     * a person would use, so a refusal here is a real refusal.
     */
    const left: number[] = [];
    for (const id of mine) {
      const client = operator?.client ?? null;
      if (client === null) { left.push(id); continue; }
      const dropped = await rpc(client, "seller_delete_sale", { p_id: id });
      if (!dropped.ok) {
        console.log(`  WARN  sale #${id} not deleted — ${dropped.code} ${dropped.message}`);
        left.push(id);
      }
    }
    check("every throwaway sale was deleted", left.length === 0,
      left.length === 0 ? `${mine.length} gelöscht` : `offen: ${left.join(", ")}`);

    if (operator && sellerId !== null) {
      await admin.from("seller_operators")
        .delete().eq("seller_id", sellerId).eq("user_id", operator.user.id);
      await admin.auth.admin.deleteUser(operator.user.id);
      check("the temporary operator was removed", true);
    }

    // -----------------------------------------------------------------------
    if (before !== null) {
      heading("7. The database is where it was");

      const after = await fingerprint(admin);
      const same = (name: string, a: unknown, b: unknown) =>
        check(name, String(a) === String(b), `${String(a)} → ${String(b)}`);

      same("303 sales", before.saleCount, after.saleCount);
      check("the same 303 sale ids", before.saleIds.join(",") === after.saleIds.join(","));
      same("1 284 sale_items", before.itemCount, after.itemCount);
      same("20 inventory_movements", before.movements, after.movements);
      same("284 inventory rows", before.inventoryRows, after.inventoryRows);
      same("quantity 808", before.quantity, after.quantity);
      same("reserved 0", before.reserved, after.reserved);
      same("9 order_reservations", before.reservationCount, after.reservationCount);
      same("0 active reservations", before.activeReservations, after.activeReservations);
      same("orderbook_audit rows (cascade)", before.auditRows, after.auditRows);
      check("amounts hash identical", before.moneyHash === after.moneyHash,
        `${before.moneyHash} → ${after.moneyHash}`);
      check("status/updated_at hash identical", before.stateHash === after.stateHash,
        `${before.stateHash} → ${after.stateHash}`);
      check("positions hash identical", before.itemHash === after.itemHash,
        `${before.itemHash} → ${after.itemHash}`);
      check("reservations hash identical", before.reservationHash === after.reservationHash,
        `${before.reservationHash} → ${after.reservationHash}`);

      const dated = await admin.from("sales").select("id", { count: "exact", head: true })
        .not("sale_day", "is", null);
      same("302 sales with sale_day", 302, dated.count ?? -1);
      const back129 = await admin.from("sales").select("sale_day,daily_index")
        .eq("id", 129).single();
      check("#129 still sale_day NULL / daily_index NULL",
        back129.data?.sale_day === null && back129.data?.daily_index === null,
        `${str(back129.data?.sale_day)} / ${str(back129.data?.daily_index)}`);
      check("the business order of the ledger is unchanged",
        before.order.join(",") === after.order.join(","),
        before.order.join(",") === after.order.join(",") ? ""
          : `erste Abweichung an Position ${after.order.findIndex((id, i) => id !== before!.order[i])}`);

      note("Verbrauchte Sequenzwerte bleiben verbraucht — erwartet und erlaubt.");
    }
  }

  // -------------------------------------------------------------------------
  const failed = results.filter((r) => !r.passed);
  heading(`${results.length - failed.length}/${results.length} PASS`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  FAIL  ${f.name}${f.detail ? `  — ${f.detail}` : ""}`);
    process.exit(1);
  }
  console.log("  Alles grün. Staging ist im Ausgangszustand.\n");
}

await main();
