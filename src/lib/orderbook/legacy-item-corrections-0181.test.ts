/**
 * 0181 on real PostgreSQL (PGlite): correcting the positions of an imported
 * workbook sale by hand — with the reconciliation world (0169–0180), 0088's
 * sync function and 0181 as files, exactly as they would run on Staging.
 *
 *   replace     the catalog figure of a workbook line; raw_name, source_row,
 *               position and the legacy flags stay; the original stays recorded
 *   add         a missing line (sale 152: 3 → 5), no hold, no stock
 *   remove      only a line added by a correction — never a workbook line
 *   trail       sale_item_corrections (append-only) + orderbook_audit + updated_at
 *   refusals    operator, version (required, PT409), workbook-only, internal,
 *               cancelled, a position with any operation, an unknown figure
 *   nothing else  money, refunds, stock, reservations
 *   the sync    0088's sync refuses a corrected line instead of reverting it;
 *               0089's refuses a date corrected in the Orderbuch; buyer,
 *               reference, country and note have no sync path at all
 *   the CSV     a decision from before the correction is refused (stale)
 */
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { body, failsWith, migration, one, OPERATOR, RECONCILIATION_MIGRATIONS, reconciliationWorld } from "@/lib/reconciliation/sql/schema";
import { analyseSpecs, decideOn, findingOf, seedSales, type Spec } from "@/lib/reconciliation/sql/session-fixture";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const M0181 = "0181_legacy_sale_item_corrections.sql";
const WITH_0180 = [...RECONCILIATION_MIGRATIONS, "0175_sales_recon_account_deletion.sql",
  "0176_sales_recon_validate_before_dedup.sql", "0178_sales_recon_comparison_and_pending.sql",
  "0179_sales_recon_ledger_proof.sql", "0180_sales_recon_selected_apply.sql"] as const;
const OTHER = "00000000-0000-4000-8000-000000000002";

/* What the reconciliation world lacks for 0088/0181: two columns of sale_items, the sync, service_role. */
const BEFORE_0181 = `
alter table public.sale_items add column legacy_shipped_flag text, add column updated_at timestamptz not null default now();
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $$;
${body("0088_legacy_orderbook_sync.sql", "system_sync_legacy_sale_item")}
${body("0089_legacy_sale_group_sync.sql", "system_sync_legacy_sale_group")}
`;

let db: PGlite;
const id: Record<string, number> = {};

async function world(withRecon = false) {
  db = await reconciliationWorld({ migrations: withRecon ? WITH_0180 : [] });
  await db.exec(BEFORE_0181);
  await db.exec(migration(M0181));
  await db.exec(`insert into public.skylanders (sky_id, name, series_code) values
    ('SKY-0612', 'Water Armor', 'TT'), ('SKY-0590', 'Dark Pyramid', 'TT'),
    ('SKY-0597', 'Fire Reactor', 'TT'), ('SKY-0598', 'Fire Reactor (Crystal)', 'TT')`);
}

/* Sale 152 on Staging, simulated: a frozen workbook sale with three workbook lines (rows 651–653). */
async function seed152() {
  id.s152 = await one<number>(db, `insert into public.sales (channel, sold_at, source, items_subtotal, shipping_charged, discount_amount)
    values ('ebay', '2026-04-24', 'excel_order_2026', 23.97, 5.49, 0) returning id`);
  for (const [k, [sky, raw]] of [["SKY-0612", "Water Armor"], ["SKY-0590", "Dark Pyramid"], ["SKY-0597", "Fire Reactor"]].entries()) {
    id[`l${k + 1}`] = await one<number>(db, `insert into public.sale_items
      (sale_id, position, sky_id, raw_name, source_row, legacy_stock_flag, legacy_shipped_flag)
      values ($1, $2, $3, $4, $5, 'x', 'x') returning id`, [id.s152, k + 1, sky, raw, 651 + k]);
  }
  await db.query(`insert into public.sale_refunds (sale_id, amount, reason) values ($1, 2.00, 'partial')`, [id.s152]);
}

const token = (sale = id.s152) => one<string>(db, `select updated_at::text from public.sales where id = $1`, [sale]);
const correct = async (item: number, sky: string, t?: string | null) =>
  failsWith(db, `select public.seller_correct_legacy_sale_item($1, $2, $3::timestamptz)`, [item, sky, t === undefined ? await token() : t]);
const add = async (sky: string | null, raw: string | null = null, t?: string | null, sale = id.s152) =>
  failsWith(db, `select public.seller_add_legacy_sale_item($1, $2, $3, 'loose', $4::timestamptz)`,
    [sale, sky, raw, t === undefined ? await token(sale) : t]);
const remove = async (item: number, t?: string | null) =>
  failsWith(db, `select public.seller_remove_legacy_added_item($1, $2::timestamptz)`, [item, t === undefined ? await token() : t]);
const items = () => db.query<Record<string, unknown>>(`select id, position, sky_id, raw_name, source_row, legacy_stock_flag,
  legacy_shipped_flag from public.sale_items where sale_id = $1 order by position, id`, [id.s152]).then((r) => r.rows);
const corrections = () => db.query<Record<string, unknown>>(`select sale_item_id, action, position, source_row, old_sky_id,
  old_raw_name, new_sky_id, new_raw_name, corrected_by::text from public.sale_item_corrections order by id`).then((r) => r.rows);
const audit = () => db.query<Record<string, unknown>>(`select entity_type, entity_id, action, field, old_value, new_value
  from public.orderbook_audit where sale_id = $1 order by id`, [id.s152]).then((r) => r.rows);
/* Everything a correction must never move. */
const sideEffects = () => one<string>(db, `select md5(concat_ws('|',
  (select string_agg(concat_ws(',', id, items_subtotal, shipping_charged, discount_amount, sold_at, external_order_ref,
     cancelled_at, stock_released_at, shipped_at, is_test), ';' order by id) from public.sales),
  (select string_agg(concat_ws(',', id, amount, reason), ';' order by id) from public.sale_refunds),
  (select count(*) from public.inventory_movements), (select count(*) from public.legacy_stock_events),
  (select string_agg(concat_ws(',', id, quantity, reserved), ';' order by id) from public.shop_inventory),
  (select count(*) from public.order_reservations)))`);
const asOther = () => db.query(`update public.test_identity set uid = $1, operator = false`, [OTHER]);
const asOperator = () => db.query(`update public.test_identity set uid = $1, operator = true`, [OPERATOR]);

afterEach(async () => { await db.close(); });

describe("correcting the figure of a workbook line", () => {
  beforeEach(async () => { await world(); await seed152(); });

  it("only sky_id moves; raw_name, source_row, position and the legacy flags stay the workbook's", async () => {
    expect(await correct(id.l3, "SKY-0598")).toBe("ok");
    expect((await items())[2]).toEqual({
      id: id.l3, position: 3, sky_id: "SKY-0598", raw_name: "Fire Reactor", source_row: 653,
      legacy_stock_flag: "x", legacy_shipped_flag: "x",
    });
  });

  it("the original stays recorded for good — also after a second correction", async () => {
    await correct(id.l3, "SKY-0598");
    await correct(id.l3, "SKY-0612");
    expect(await corrections()).toEqual([
      { sale_item_id: id.l3, action: "replace", position: 3, source_row: 653, old_sky_id: "SKY-0597", old_raw_name: "Fire Reactor",
        new_sky_id: "SKY-0598", new_raw_name: "Fire Reactor", corrected_by: OPERATOR },
      { sale_item_id: id.l3, action: "replace", position: 3, source_row: 653, old_sky_id: "SKY-0598", old_raw_name: "Fire Reactor",
        new_sky_id: "SKY-0612", new_raw_name: "Fire Reactor", corrected_by: OPERATOR },
    ]);
    // The first record names the workbook's figure: the reconstruction stays provable.
    expect(await one(db, `select old_sky_id from public.sale_item_corrections where sale_item_id = $1 order by id limit 1`, [id.l3]))
      .toBe("SKY-0597");
  });

  it("the trail is append-only: no update, no delete", async () => {
    await correct(id.l3, "SKY-0598");
    expect(await failsWith(db, `update public.sale_item_corrections set new_sky_id = 'SKY-0590'`)).toBe("23001");
    expect(await failsWith(db, `delete from public.sale_item_corrections`)).toBe("23001");
    expect(await corrections()).toHaveLength(1);
  });

  it("audit names old and new figure, and the sale's version moves", async () => {
    const before = await token();
    await correct(id.l3, "SKY-0598");
    expect(await audit()).toEqual([
      { entity_type: "sale_item", entity_id: id.l3, action: "update", field: "sky_id", old_value: "SKY-0597", new_value: "SKY-0598" },
    ]);
    expect(await token()).not.toBe(before);
  });

  it("an unknown figure, no figure, or the same figure: refused, nothing written", async () => {
    expect(await correct(id.l3, "SKY-9999")).toBe("23514");
    expect(await correct(id.l3, "  ")).toBe("23514");
    expect(await correct(id.l3, "SKY-0597")).toBe("23514");
    expect(await corrections()).toEqual([]);
    expect(await audit()).toEqual([]);
  });
});

describe("adding missing lines — sale 152: three in SkyIsles, five in the report", () => {
  beforeEach(async () => { await world(); await seed152(); });

  it("two Fire Reactor (Crystal) added: five lines, the two new ones without source_row or flags", async () => {
    expect(await add("SKY-0598")).toBe("ok");
    expect(await add("SKY-0598")).toBe("ok");
    const rows = await items();
    expect(rows).toHaveLength(5);
    expect(rows.slice(3).map((r) => [r.position, r.sky_id, r.raw_name, r.source_row, r.legacy_stock_flag, r.legacy_shipped_flag]))
      .toEqual([[4, "SKY-0598", null, null, null, null], [5, "SKY-0598", null, null, null, null]]);
    expect((await corrections()).map((c) => [c.action, c.position, c.new_sky_id, c.source_row])).toEqual([
      ["add", 4, "SKY-0598", null], ["add", 5, "SKY-0598", null],
    ]);
    expect((await audit()).map((a) => [a.action, a.field, a.new_value])).toEqual([["insert", null, "SKY-0598"], ["insert", null, "SKY-0598"]]);
  });

  it("a name without a catalog figure is a line too (a portal) — taken raw", async () => {
    expect(await add(null, "Portal 84148790 (Wireless)")).toBe("ok");
    expect((await items())[3]).toMatchObject({ sky_id: null, raw_name: "Portal 84148790 (Wireless)" });
    expect(await add(null, "  ")).toBe("23514");
  });

  it("no hold, no stock, no money — even with the figure on the shelf", async () => {
    await db.exec(`insert into public.shop_inventory (sky_id, quantity) values ('SKY-0598', 4)`);
    const before = await sideEffects();
    await add("SKY-0598");
    await add("SKY-0598");
    await correct(id.l1, "SKY-0590");
    expect(await sideEffects()).toBe(before);
    expect(await one<number>(db, `select count(*)::int from public.order_reservations`)).toBe(0);
  });

  it("each write needs the current version: the second call with the first token is PT409", async () => {
    const opened = await token();
    expect(await add("SKY-0598", null, opened)).toBe("ok");
    expect(await add("SKY-0598", null, opened)).toBe("PT409");
    expect(await items()).toHaveLength(4);
  });
});

describe("removing — only what a correction added", () => {
  beforeEach(async () => { await world(); await seed152(); });

  it("an added line is removed; its add and its removal stay in the trail and the audit", async () => {
    await add("SKY-0598");
    const added = (await items())[3].id as number;
    expect(await remove(added)).toBe("ok");
    expect(await items()).toHaveLength(3);
    expect((await corrections()).map((c) => [c.action, c.sale_item_id, c.old_sky_id, c.new_sky_id])).toEqual([
      ["add", added, null, "SKY-0598"], ["remove", added, "SKY-0598", null],
    ]);
    expect((await audit()).map((a) => [a.action, a.entity_id])).toEqual([["insert", added], ["delete", added]]);
    expect(await remove(added)).toBe("P0002");
  });

  it("a workbook line is never removed — not even after its figure was corrected", async () => {
    expect(await remove(id.l1)).toBe("23001");
    await correct(id.l1, "SKY-0590");
    expect(await remove(id.l1)).toBe("23001");
    expect(await items()).toHaveLength(3);
  });

  it("a line without a source row that no correction added is not removed here either", async () => {
    const stray = await one<number>(db, `insert into public.sale_items (sale_id, position, sky_id) values ($1, 9, 'SKY-0590') returning id`, [id.s152]);
    expect(await remove(stray)).toBe("23001");
  });
});

describe("the database still refuses", () => {
  beforeEach(async () => { await world(); await seed152(); });

  it("an account that does not operate the seller (42501) — every function, nothing written", async () => {
    const t = await token();
    await asOther();
    expect(await correct(id.l3, "SKY-0598", t)).toBe("42501");
    expect(await add("SKY-0598", null, t)).toBe("42501");
    expect(await remove(id.l1, t)).toBe("42501");
    expect(await failsWith(db, `select public.seller_sale_item_corrections($1)`, [id.s152])).toBe("42501");
    expect(await failsWith(db, `select public.seller_correct_legacy_sale_item(999999, 'SKY-0598', now())`)).toBe("42501");
    await asOperator();
    expect(await corrections()).toEqual([]);
  });

  it("without the sale's version, or with an old one", async () => {
    expect(await correct(id.l3, "SKY-0598", null)).toBe("23514");
    expect(await add("SKY-0598", null, null)).toBe("23514");
    expect(await correct(id.l3, "SKY-0598", "2020-01-01T00:00:00Z")).toBe("PT409");
  });

  it("a sale that is not a workbook sale keeps the normal rules (23001)", async () => {
    const manual = await one<number>(db, `insert into public.sales (channel, sold_at, source) values ('ebay', '2026-04-24', 'manual') returning id`);
    const line = await one<number>(db, `insert into public.sale_items (sale_id, position, sky_id) values ($1, 1, 'SKY-0590') returning id`, [manual]);
    const t = await token(manual);
    expect(await add("SKY-0598", null, undefined, manual)).toBe("23001");
    expect(await failsWith(db, `select public.seller_correct_legacy_sale_item($1, 'SKY-0598', $2::timestamptz)`, [line, t])).toBe("23001");
  });

  it("an internal or a cancelled workbook sale (23001)", async () => {
    await db.query(`update public.sales set cancelled_at = now() where id = $1`, [id.s152]);
    expect(await correct(id.l3, "SKY-0598")).toBe("23001");
    expect(await add("SKY-0598")).toBe("23001");
    await db.query(`update public.sales set cancelled_at = null, order_id = 77 where id = $1`, [id.s152]);
    expect(await correct(id.l3, "SKY-0598")).toBe("23001");
  });

  it("a line with any operation on it — closed, not shipped, returned, announced, held (23001)", async () => {
    const inv = await one<number>(db, `insert into public.shop_inventory (sky_id, quantity) values ('SKY-0597', 2) returning id`);
    for (const set of [
      `settled_at = now()`, `not_shipped_at = now()`, `returned_at = now()`, `return_announced_at = now()`,
    ]) {
      await db.query(`update public.sale_items set ${set} where id = $1`, [id.l3]);
      expect(await correct(id.l3, "SKY-0598"), set).toBe("23001");
      await db.query(`update public.sale_items set settled_at = null, not_shipped_at = null, returned_at = null, return_announced_at = null where id = $1`, [id.l3]);
    }
    await db.query(`insert into public.order_reservations (sale_item_id, inventory_id, quantity, state) values ($1, $2, 1, 'active')`, [id.l3, inv]);
    expect(await correct(id.l3, "SKY-0598")).toBe("23001");
    expect(await corrections()).toEqual([]);
  });

  it("the client roles hold no right on the trail or the helpers", async () => {
    expect(await one(db, `select has_table_privilege('authenticated', 'public.sale_item_corrections', 'select')`)).toBe(false);
    expect(await one(db, `select has_function_privilege('authenticated', 'public.sales_legacy_correction_sale(bigint,timestamptz)', 'execute')`)).toBe(false);
    expect(await one(db, `select has_function_privilege('anon', 'public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)', 'execute')`)).toBe(false);
    expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)', 'execute')`)).toBe(true);
    expect(await one(db, `select has_function_privilege('authenticated', 'public.system_sync_legacy_sale_item(bigint,text,text,text,text)', 'execute')`)).toBe(false);
  });
});

describe("the workbook sync and the read", () => {
  beforeEach(async () => { await world(); await seed152(); });

  it("the sync writes an untouched line as before — and refuses a corrected one instead of reverting it", async () => {
    expect(await failsWith(db, `select public.system_sync_legacy_sale_item($1, 'Water Armor', 'SKY-0612', 'x', 'x')`, [id.l1])).toBe("ok");
    await correct(id.l3, "SKY-0598");
    expect(await failsWith(db, `select public.system_sync_legacy_sale_item($1, 'Fire Reactor', 'SKY-0597', 'x', 'x')`, [id.l3])).toBe("23001");
    expect((await items())[2].sky_id).toBe("SKY-0598");
  });

  it("0181 redefines the sync word for word but for the one check", () => {
    const old = body("0088_legacy_orderbook_sync.sql", "system_sync_legacy_sale_item");
    const now = body(M0181, "system_sync_legacy_sale_item");
    const check = now.slice(now.indexOf("  /*\n   * 0181:"), now.indexOf("  end if;\n", now.indexOf("sale_item_corrections c")) + "  end if;\n".length);
    expect(now.replace(check, "")).toBe(old);
  });

  it("the operator reads the corrections of a sale, oldest first", async () => {
    await correct(id.l3, "SKY-0598");
    await add("SKY-0598");
    const list = await one<{ action: string; oldSkyId: string | null; sourceRow: number | null }[]>(db, `select public.seller_sale_item_corrections($1)`, [id.s152]);
    expect(list.map((c) => [c.action, c.oldSkyId, c.sourceRow])).toEqual([["replace", "SKY-0597", 653], ["add", null, null]]);
  });

  it("0181 touches no other existing function", () => {
    const sql = migration(M0181);
    const defined = [...sql.matchAll(/create or replace function public\.([a-z_0-9]+)\(/g)].map((m) => m[1]).sort();
    expect(defined).toEqual([
      "sale_item_corrections_append_only", "sales_legacy_correction_figure", "sales_legacy_correction_item",
      "sales_legacy_correction_sale", "seller_add_legacy_sale_item", "seller_correct_legacy_sale_item",
      "seller_remove_legacy_added_item", "seller_sale_item_corrections", "system_sync_legacy_sale_group",
      "system_sync_legacy_sale_item",
    ]);
    expect(sql).not.toMatch(/hold_sale_item\(|inventory_movements|apply_inventory_movement|sale_refunds|sale_fees|items_subtotal\s*=/);
  });
});

describe("the workbook sync and a header corrected in the Orderbuch", () => {
  beforeEach(async () => { await world(); await seed152(); });

  const syncDate = (date: string, sale = id.s152) =>
    failsWith(db, `select public.system_sync_legacy_sale_group($1, $2::date)`, [sale, date]);
  const header = () => db.query<Record<string, unknown>>(`select sold_at::text, buyer_ref, external_order_ref,
    destination_country_code, note from public.sales where id = $1`, [id.s152]).then((r) => r.rows[0]);
  /* The Orderbuch's own save path (0091): one call, one audit line per moved field. */
  const editHeader = async (fields: { sold_at?: string; buyer?: string; ref?: string; country?: string; note?: string }) =>
    failsWith(db, `select public.seller_update_sale($1, p_sold_at => $2::date, p_country => $3, p_external_ref => $4,
      p_buyer_ref => $5, p_note => $6, p_expected_updated_at => $7::timestamptz)`,
      [id.s152, fields.sold_at ?? null, fields.country ?? null, fields.ref ?? null, fields.buyer ?? null, fields.note ?? null, await token()]);

  it("a date nobody touched in SkyIsles: the workbook still writes it, as before", async () => {
    expect(await syncDate("2026-04-23")).toBe("ok");
    expect((await header()).sold_at).toBe("2026-04-23");
  });

  it("a date corrected in the Orderbuch: the workbook's other date is refused, the correction stays", async () => {
    expect(await editHeader({ sold_at: "2026-04-20" })).toBe("ok");
    expect(await syncDate("2026-04-24")).toBe("23001");
    expect((await header()).sold_at).toBe("2026-04-20");
    // The workbook brought in line with the correction: nothing to defend, the call runs as before.
    expect(await syncDate("2026-04-20")).toBe("ok");
    expect((await header()).sold_at).toBe("2026-04-20");
  });

  it("the refusal is per sale: another sale's date is still written", async () => {
    const other = await one<number>(db, `insert into public.sales (channel, sold_at, source, items_subtotal, shipping_charged, discount_amount)
      values ('ebay', '2026-04-10', 'excel_order_2026', 5, 0, 0) returning id`);
    await editHeader({ sold_at: "2026-04-20" });
    expect(await syncDate("2026-04-24")).toBe("23001");
    expect(await syncDate("2026-04-11", other)).toBe("ok");
    expect(await one(db, `select sold_at::text from public.sales where id = $1`, [other])).toBe("2026-04-11");
  });

  it("buyer, reference, country and note corrected by hand: no sync function writes them", async () => {
    expect(await editHeader({ buyer: "buyer-corrected", ref: "12-14520-00152", country: "AT", note: "Order 2026, Kopfzeile 650, korrigiert" })).toBe("ok");
    const before = await header();
    expect(await failsWith(db, `select public.system_sync_legacy_sale_item($1, 'Water Armor', 'SKY-0612', 'x', 'x')`, [id.l1])).toBe("ok");
    expect(await syncDate("2026-04-24")).toBe("ok");
    expect(await header()).toEqual(before);
    // And by construction: neither sync body has a SET for any of them.
    for (const [file, fn] of [[M0181, "system_sync_legacy_sale_item"], [M0181, "system_sync_legacy_sale_group"]] as const) {
      const set = body(file, fn).match(/\bset\b[\s\S]*?\bwhere\b/gi)?.join(" ") ?? "";
      expect(set).not.toMatch(/buyer_ref|external_order_ref|destination_country_code|\bnote\b|items_subtotal|shipping_charged|discount_amount/);
    }
  });

  it("0181 redefines the date sync word for word but for the one check", () => {
    const old = body("0089_legacy_sale_group_sync.sql", "system_sync_legacy_sale_group");
    const now = body(M0181, "system_sync_legacy_sale_group");
    const check = now.slice(now.indexOf("  /*\n   * 0181:"), now.indexOf("  end if;\n", now.indexOf("a.field = 'sold_at'")) + "  end if;\n".length);
    expect(check).toContain("restrict_violation");
    expect(now.replace(check, "")).toBe(old);
  });

  it("the date sync stays service_role only", async () => {
    expect(await one(db, `select has_function_privilege('authenticated', 'public.system_sync_legacy_sale_group(bigint,date)', 'execute')`)).toBe(false);
    expect(await one(db, `select has_function_privilege('service_role', 'public.system_sync_legacy_sale_group(bigint,date)', 'execute')`)).toBe(true);
  });
});

describe("the CSV reconciliation after a correction", () => {
  const REF = "50-00000-01520";
  const SPECS: Spec[] = [{ ref: REF, sold: "2026-04-24", lines: [{ character: "Camo", unit: 6 }],
    ledger: { sold: "2026-04-24", subtotal: 6, pieces: ["Camo"] } }];
  let session: number;
  let sale: number;

  beforeEach(async () => {
    await world(true);
    sale = (await seedSales(db, SPECS)).get(REF)!;
    session = await analyseSpecs(db, SPECS);
  });

  it("a decision taken on the analysed state is refused once a position was corrected (stale) — nothing applied", async () => {
    const f = await findingOf(db, session, REF, "external_order_ref");
    expect(await failsWith(db, `select public.seller_add_legacy_sale_item($1, null, 'Camo', 'loose', $2::timestamptz)`,
      [sale, await token(sale)])).toBe("ok");
    expect(await one(db, `select public.sales_recon_take_check($1)`, [f.id])).toBe("stale");
    await expect(decideOn(db, f, "take_external")).rejects.toMatchObject({ code: "PT409" });
    expect(await one(db, `select external_order_ref from public.sales where id = $1`, [sale])).toBeNull();
  });

  it("the CSV apply still writes only goods value, shipping, the day and the order number — never a position", () => {
    const apply = readFileSync("supabase/migrations/0180_sales_recon_selected_apply.sql", "utf8");
    expect(apply).not.toMatch(/insert into public\.sale_items|update public\.sale_items|delete from public\.sale_items/);
    expect(migration(M0181)).not.toMatch(/sales_recon_/);
  });
});

describe("the rollback R0181", () => {
  const R0181 = readFileSync("supabase/rollback/R0181_legacy_sale_item_corrections.sql", "utf8");
  beforeEach(async () => { await world(); await seed152(); });

  it("without corrections: everything of 0181 gone, the sync back to 0088's body", async () => {
    await db.exec(R0181);
    expect(await one(db, `select to_regclass('public.sale_item_corrections')::text`)).toBeNull();
    expect(await one(db, `select to_regprocedure('public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)')::text`)).toBeNull();
    expect(await failsWith(db, `select public.system_sync_legacy_sale_item($1, 'Fire Reactor', 'SKY-0597', 'x', 'x')`, [id.l3])).toBe("ok");
    // 0089's date sync is back too, character for character.
    expect(await one(db, `select md5(prosrc) from pg_proc where oid = to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)')`))
      .toBe("6de873975a90579e1dcc8f2de0987f42");
  });

  it("with a correction: refused, nothing changed — the record of the original survives", async () => {
    await correct(id.l3, "SKY-0598");
    await expect(db.exec(R0181)).rejects.toThrow(/R0181 refused/);
    expect(await corrections()).toHaveLength(1);
  });

  it("while a backup still exports the trail (0182): refused — R0182 comes first", async () => {
    // A stand-in with 0182's area: a SQL body records no dependency, so the drop would break the export.
    await db.exec(`create or replace function public.system_platform_export() returns jsonb language sql stable as $$
      select jsonb_build_object('sale_item_corrections', (select count(*) from public.sale_item_corrections)) $$`);
    await expect(db.exec(R0181)).rejects.toThrow(/run R0182 first/);
    expect(await one(db, `select to_regclass('public.sale_item_corrections')::text`)).toBe("sale_item_corrections");
  });
});
