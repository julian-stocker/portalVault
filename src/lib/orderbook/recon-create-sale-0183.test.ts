/**
 * 0183 on real PostgreSQL (PGlite): an unmatched order of the CSV
 * reconciliation becomes ONE open sale in the Orderbuch — with a session
 * analysed the real way (parser → match → `seller_recon_create`, 0169–0180).
 *
 *   created     head and money from the stored report, nothing from the caller;
 *               one position per unit, raw names from the report, the chosen
 *               figure per unit (variants differ), no buyer, no fee, no refund
 *   nothing     no hold, no stock movement, no shipping date
 *   open        every position open; later held, booked — the existing workflow
 *   once        a second call answers `exists` with the same sale
 *   refusals    operator, closed session, a paired order, counts, unknown
 *               figures, smuggled text, a report that does not add up
 *   journal     the sale and every position as `insert`
 *   rollback    R0183 removes the function; the sale stays
 *
 * Real concurrency (two connections at once): `src/lib/reconciliation/pg/concurrency-0183.test.ts`.
 */
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { failsWith, migration, one, OPERATOR, reconciliationWorld } from "@/lib/reconciliation/sql/schema";
import { WITH_0180, WORKFLOW } from "@/lib/reconciliation/sql/create-sale-world";
import { analyseSpecs, seedSales, type Spec } from "@/lib/reconciliation/sql/session-fixture";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const M0183 = "0183_recon_create_open_sale.sql";
/* The April order 06-14518-99785, simulated: seven units, six of them names the catalogue carries twice. */
const NAMES = ["Cynder", "Zook", "Slam Bam", "Double Trouble", "Stump Smash", "Dino-Rang", "Bash"];
const UNMATCHED: Spec = { ref: "06-14518-99785", sold: "2026-04-16", shipping: 5.49,
  lines: NAMES.map((character, k) => ({ character, unit: [0.95, 7.21, 8.58, 3.15, 3.15, 2.32, 4.65][k] })), ledger: null };
const PAIRED: Spec = { ref: "07-00000-00001", sold: "2026-04-18", lines: [{ character: "Eruptor", unit: 9 }],
  ledger: { sold: "2026-04-18", subtotal: 9, pieces: ["Eruptor"] } };
/* The chosen figure per line: Giants or Spyro's Adventure — the operator's explicit choice; Bash without figure. */
const CHOSEN = ["SKY-0150", "SKY-0187", "SKY-0048", "SKY-0152", "SKY-0063", "SKY-0021", null];
const pieces = (chosen: readonly (string | null)[] = CHOSEN) => chosen.map((skyId, line) => ({ line, skyId }));

let db: PGlite;
let session: number;
const OTHER = "00000000-0000-4000-8000-000000000002";

async function world(specs: Spec[] = [UNMATCHED, PAIRED]) {
  db = await reconciliationWorld({ migrations: WITH_0180 });
  await db.exec(WORKFLOW);
  await db.exec(migration(M0183));
  await db.exec(`insert into public.skylanders (sky_id, name, series_code) values
    ('SKY-0020', 'Cynder', 'SSA'), ('SKY-0150', 'Cynder', 'SG'), ('SKY-0088', 'Zook', 'SSA'), ('SKY-0187', 'Zook', 'SG'),
    ('SKY-0048', 'Slam Bam', 'SSA'), ('SKY-0173', 'Slam Bam', 'SG'), ('SKY-0025', 'Double Trouble', 'SSA'),
    ('SKY-0152', 'Double Trouble', 'SG'), ('SKY-0063', 'Stump Smash', 'SSA'), ('SKY-0180', 'Stump Smash', 'SG'),
    ('SKY-0021', 'Dino-Rang', 'SSA'), ('SKY-0007', 'Bash', 'SSA'), ('SKY-0148', 'Bash', 'SG'), ('SKY-0029', 'Eruptor', 'SSA')
    on conflict do nothing`);
  // Stock on the shelf for two of the figures: still nothing may be held.
  await db.exec(`insert into public.shop_inventory (sky_id, quantity) values ('SKY-0150', 2), ('SKY-0021', 1)`);
  await seedSales(db, specs);
  session = await analyseSpecs(db, specs);
}
const orderId = (ref = UNMATCHED.ref!) =>
  one<number>(db, `select id from public.sales_recon_orders where session_id = $1 and order_ref = $2`, [session, ref]);
const create = async (p: unknown = pieces(), ref?: string) =>
  db.query<{ r: { status: string; sale_id: number } }>(`select public.seller_recon_create_sale($1, $2::jsonb) as r`,
    [await orderId(ref), JSON.stringify(p)]).then((x) => x.rows[0].r);
const refusal = async (p: unknown = pieces(), ref?: string) =>
  failsWith(db, `select public.seller_recon_create_sale($1, $2::jsonb)`, [await orderId(ref), JSON.stringify(p)]);
const refusalText = async (p: unknown = pieces(), ref?: string) => {
  try { await create(p, ref); return "ok"; } catch (e) { return String((e as Error).message); }
};
const nothingMoved = () => one<string>(db, `select concat_ws('|', (select count(*) from public.order_reservations),
  (select count(*) from public.inventory_movements), (select string_agg(sky_id || '=' || quantity || '/' || reserved, ',' order by sky_id)
  from public.shop_inventory))`);

afterEach(async () => { await db.close(); });

describe("an unmatched order becomes one open sale", () => {
  beforeEach(async () => { await world(); });

  it("the analysis really left it unmatched (external_only, no sale) — the case the function is for", async () => {
    expect(await one(db, `select category || '|' || coalesce(sale_id::text, '-') from public.sales_recon_matches
      where session_id = $1 and order_id = $2`, [session, await orderId()])).toBe("external_only|-");
  });

  it("head and money from the report; no buyer, no fee, no refund, no shipping date; the provenance in the note", async () => {
    const r = await create();
    expect(r.status).toBe("created");
    const sale = (await db.query<Record<string, unknown>>(`select channel, sold_at::text, external_order_ref, destination_country_code,
      items_subtotal, shipping_charged, discount_amount, buyer_ref, shipped_at, source, is_test, created_by::text, note
      from public.sales where id = $1`, [r.sale_id])).rows[0];
    expect(sale).toMatchObject({ channel: "ebay", sold_at: "2026-04-16", external_order_ref: "06-14518-99785",
      items_subtotal: "30.01", shipping_charged: "5.49", discount_amount: "0.00", buyer_ref: null, shipped_at: null,
      source: "manual", is_test: false, created_by: OPERATOR });
    expect(String(sale.note)).toContain("Aus dem CSV-Abgleich angelegt");
    expect(String(sale.note)).toContain("Käufer und Gebühren nennt der Bericht nicht.");
    expect(await one(db, `select count(*)::int from public.sale_refunds where sale_id = $1`, [r.sale_id])).toBe(0);
  });

  it("seven positions in report order: the report's raw names, the chosen variant per unit, one without figure", async () => {
    const r = await create();
    const items = await db.query<{ position: number; raw_name: string; sky_id: string | null; condition: string }>(
      `select position, raw_name, sky_id, condition from public.sale_items where sale_id = $1 order by position`, [r.sale_id]);
    expect(items.rows).toEqual(NAMES.map((raw_name, k) => ({ position: k + 1, raw_name, sky_id: CHOSEN[k], condition: "loose" })));
  });

  it("a line with quantity two takes exactly two units, each with its own figure", async () => {
    await db.close();
    await world([{ ref: "08-00000-00002", sold: "2026-04-20", lines: [{ character: "Cynder", unit: 3, qty: 2 }], ledger: null }]);
    expect(await refusal([{ line: 0, skyId: "SKY-0020" }], "08-00000-00002")).toBe("23514");
    const r = await create([{ line: 0, skyId: "SKY-0020" }, { line: 0, skyId: "SKY-0150" }], "08-00000-00002");
    expect((await db.query(`select sky_id from public.sale_items where sale_id = $1 order by position`, [r.sale_id])).rows)
      .toEqual([{ sky_id: "SKY-0020" }, { sky_id: "SKY-0150" }]);
  });

  it("no hold, no stock movement — even with the figure on the shelf", async () => {
    const before = await nothingMoved();
    await create();
    expect(await nothingMoved()).toBe(before);
    expect(before).toBe("0|0|SKY-0021=1/0,SKY-0150=2/0");
  });

  it("the journal: the sale and each of the seven positions as insert, by the operator", async () => {
    const r = await create();
    expect((await db.query(`select entity_type, action, field, changed_by::text from public.orderbook_audit
      where sale_id = $1 order by id`, [r.sale_id])).rows).toEqual([
      { entity_type: "sale", action: "insert", field: null, changed_by: OPERATOR },
      ...NAMES.map(() => ({ entity_type: "sale_item", action: "insert", field: null, changed_by: OPERATOR })),
    ]);
  });

  it("the analysis stays what it was: no reconciliation row is written", async () => {
    const snap = () => one<string>(db, `select md5(concat_ws('|',
      (select string_agg(to_jsonb(m)::text, ';' order by m.id) from public.sales_recon_matches m),
      (select string_agg(to_jsonb(o)::text, ';' order by o.id) from public.sales_recon_orders o),
      (select count(*) from public.sales_recon_decisions), (select count(*) from public.sales_recon_applications)))`);
    const before = await snap();
    await create();
    expect(await snap()).toBe(before);
  });
});

describe("open — and then the existing manual workflow", () => {
  beforeEach(async () => { await world(); });

  it("every position is open, so the sale counts as open in the Orderbuch", async () => {
    const r = await create();
    expect(await one(db, `select count(*)::int from public.sale_items i where i.sale_id = $1 and not public.sale_item_is_closed(i)`,
      [r.sale_id])).toBe(7);
  });

  it("later: reserve by hand (held), book (a movement, the hold converted), the position closed", async () => {
    const r = await create();
    const cynder = await one<number>(db, `select id from public.sale_items where sale_id = $1 and position = 1`, [r.sale_id]);
    expect(await one(db, `select public.seller_hold_sale_item($1)`, [cynder])).toBe("held");
    expect(await one(db, `select reserved from public.shop_inventory where sky_id = 'SKY-0150'`)).toBe(1);
    const movement = await one<number>(db, `select public.seller_book_sale_item($1)`, [cynder]);
    expect(movement).toBeGreaterThan(0);
    expect(await one(db, `select quantity || '/' || reserved from public.shop_inventory where sky_id = 'SKY-0150'`)).toBe("1/0");
    expect(await one(db, `select state from public.order_reservations where sale_item_id = $1`, [cynder])).toBe("converted");
    expect(await one(db, `select public.sale_item_is_closed(i) from public.sale_items i where id = $1`, [cynder])).toBe(true);
  });

  it("booking also works without any hold; a figure-less position simply has nothing to hold", async () => {
    const r = await create();
    const dino = await one<number>(db, `select id from public.sale_items where sale_id = $1 and position = 6`, [r.sale_id]);
    expect(await one<number>(db, `select public.seller_book_sale_item($1)`, [dino])).toBeGreaterThan(0);
    const bash = await one<number>(db, `select id from public.sale_items where sale_id = $1 and position = 7`, [r.sale_id]);
    expect(await one(db, `select public.seller_hold_sale_item($1)`, [bash])).toBe("not_a_figure");
  });
});

describe("only once", () => {
  beforeEach(async () => { await world(); });

  it("a second call answers exists with the same sale and creates nothing", async () => {
    const first = await create();
    const again = await create();
    expect(again).toEqual({ status: "exists", sale_id: first.sale_id });
    expect(await one(db, `select count(*)::int from public.sales where external_order_ref = $1`, [UNMATCHED.ref])).toBe(1);
    expect(await one(db, `select count(*)::int from public.sale_items where sale_id = $1`, [first.sale_id])).toBe(7);
  });

  it("a sale that already carries the number (typed by hand) is named, nothing is created", async () => {
    const hand = await one<number>(db, `insert into public.sales (channel, sold_at, external_order_ref) values ('ebay', '2026-04-16', $1) returning id`, [UNMATCHED.ref]);
    expect(await create()).toEqual({ status: "exists", sale_id: hand });
  });

  it("the order row is locked before anything is decided — the floor under parallel calls", () => {
    const sql = migration(M0183);
    expect(sql).toMatch(/from public\.sales_recon_orders where id = p_order_id for update;/);
    expect(sql.indexOf("for update")).toBeLessThan(sql.indexOf("'status', 'exists'"));
  });
});

describe("the database refuses — and writes nothing", () => {
  beforeEach(async () => { await world(); });
  const none = async () => expect(await one(db, `select count(*)::int from public.sales where external_order_ref = $1`, [UNMATCHED.ref])).toBe(0);

  it("an account that does not operate the seller (42501)", async () => {
    await db.query(`update public.test_identity set uid = $1, operator = false`, [OTHER]);
    expect(await refusal()).toBe("42501");
    await none();
  });

  it("a session that is not open; an order that was paired", async () => {
    expect(await one(db, `select category from public.sales_recon_matches where session_id = $1 and order_id = $2`,
      [session, await orderId(PAIRED.ref!)])).not.toBe("external_only");
    expect(await refusalText(pieces(), PAIRED.ref!)).toContain("(not_unmatched)");
    await db.query(`update public.sales_recon_sessions set state = 'closed', closed_at = now() where id = $1`, [session]);
    expect(await refusalText()).toContain("(session_not_open)");
    await none();
  });

  it("units that are not the report's: too few, too many, the wrong line, an unknown line", async () => {
    expect(await refusalText(pieces().slice(0, 6))).toContain("(piece_count)");
    expect(await refusalText([...pieces(), { line: 0, skyId: null }])).toContain("(piece_count)");
    expect(await refusalText([{ line: 0, skyId: null }, ...pieces().slice(1, 6), { line: 0, skyId: null }])).toContain("(line_quantity)");
    expect(await refusalText([...pieces().slice(0, 6), { line: 7, skyId: null }])).toContain("(piece)");
    await none();
  });

  it("a figure the catalogue does not have; an empty figure; a smuggled raw name or extra key", async () => {
    expect(await refusalText(pieces(["SKY-9999", ...CHOSEN.slice(1)]))).toContain("(unknown_figure)");
    expect(await refusalText(pieces(["  ", ...CHOSEN.slice(1)]))).toContain("(piece)");
    expect(await refusalText([{ line: 0, skyId: null, rawName: "Erfunden" }, ...pieces().slice(1)])).toContain("(piece)");
    expect(await refusalText([{ line: 0 }, ...pieces().slice(1)])).toContain("(piece)");
    expect(await refusal("nope")).toBe("22023");
    await none();
  });

  it("a report whose total is not goods + shipping (a discount or fee it does not name) is not taken over", async () => {
    await db.close();
    await world([{ ...UNMATCHED, total: 30.00 }]);
    expect(await refusalText()).toContain("(money)");
    await none();
  });

  it("the client roles: authenticated may call it (the operator check is inside), anon may not", async () => {
    expect(await one(db, `select has_function_privilege('anon', 'public.seller_recon_create_sale(bigint,jsonb)', 'execute')`)).toBe(false);
    expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_recon_create_sale(bigint,jsonb)', 'execute')`)).toBe(true);
    expect(await one(db, `select prosecdef from pg_proc where oid = to_regprocedure('public.seller_recon_create_sale(bigint,jsonb)')`)).toBe(true);
  });
});

describe("the migration and its rollback", () => {
  beforeEach(async () => { await world(); });

  it("0183 defines exactly one function and touches no table, no hold path, no money path", () => {
    const sql = migration(M0183);
    expect([...sql.matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)\(/g)].map((m) => m[1])).toEqual(["seller_recon_create_sale"]);
    const code = sql.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/hold_sale_item\(|record_inventory_movement|sale_fees|sale_refunds|create table|alter table|insert into public\.sales_recon/);
  });

  it("a second run bounces", async () => {
    await expect(db.exec(migration(M0183))).rejects.toThrow(/applied here already/);
  });

  it("R0183 removes the function; a sale it created stays, with its positions and journal", async () => {
    const r = await create();
    await db.exec(readFileSync("supabase/rollback/R0183_recon_create_open_sale.sql", "utf8"));
    expect(await one(db, `select to_regprocedure('public.seller_recon_create_sale(bigint,jsonb)')::text`)).toBeNull();
    expect(await one(db, `select count(*)::int from public.sale_items where sale_id = $1`, [r.sale_id])).toBe(7);
    expect(await one(db, `select count(*)::int from public.orderbook_audit where sale_id = $1`, [r.sale_id])).toBe(8);
  });
});
