/**
 * 0185 on real PostgreSQL (PGlite): an unmatched order is assigned to an
 * EXISTING sale — by writing its order number, and nothing else. The session
 * is analysed the real way (0169–0180); the sale is created AFTER the
 * analysis, as sale 381 was for 06-14518-99785.
 *
 *   assigned    only external_order_ref, updated_at/by and one journal line
 *   once        the same number again: exists; another number: never overwritten
 *   guarded     version (required, PT409), operator, session, unmatched order,
 *               test/cancelled/internal/other channel, number on another sale,
 *               a sale paired anywhere, 0180's rivals — sale and order
 *   rollback    R0185 removes the function; the written number stays
 *
 * Real concurrency: `src/lib/reconciliation/pg/concurrency-0185.test.ts`.
 */
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migration, one, OPERATOR, reconciliationWorld } from "@/lib/reconciliation/sql/schema";
import { WITH_0180, WORKFLOW } from "@/lib/reconciliation/sql/create-sale-world";
import { analyseSpecs, seedSales, type Spec } from "@/lib/reconciliation/sql/session-fixture";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const M0185 = "0185_recon_assign_sale.sql";
const REF = "06-14518-99785";
const NAMES = ["Cynder", "Zook", "Dino-Rang"];
const UNMATCHED: Spec = { ref: REF, sold: "2026-04-16", shipping: 5.49,
  lines: NAMES.map((character, k) => ({ character, unit: [0.95, 7.21, 2.32][k] })), ledger: null };
const PAIRED: Spec = { ref: "07-00000-00001", sold: "2026-04-25", lines: [{ character: "Eruptor", unit: 9 }],
  ledger: { sold: "2026-04-25", subtotal: 9, pieces: ["Eruptor"] } };
const OTHER = "00000000-0000-4000-8000-000000000002";

let db: PGlite;
let session: number;
async function world(specs: Spec[] = [UNMATCHED, PAIRED]) {
  db = await reconciliationWorld({ migrations: WITH_0180 });
  await db.exec(WORKFLOW);
  await db.exec(migration(M0185));
  await db.exec(`insert into public.skylanders (sky_id, name, series_code) values ('SKY-0150', 'Cynder', 'G'),
    ('SKY-0187', 'Zook', 'G'), ('SKY-0021', 'Dino-Rang', 'SA'), ('SKY-0029', 'Eruptor', 'SA') on conflict do nothing;
    insert into public.shop_inventory (sky_id, quantity) values ('SKY-0150', 2)`);
  await seedSales(db, specs);
  session = await analyseSpecs(db, specs);
}
/* A sale typed in the Orderbuch after the analysis — its figures, a discount, no order number; one position held. */
async function lateSale(over: { soldAt?: string; ref?: string | null; isTest?: boolean; cancelled?: boolean; channel?: string;
  pieces?: [string, string][] } = {}) {
  const id = await one<number>(db, `insert into public.sales (channel, sold_at, source, items_subtotal, shipping_charged,
    discount_amount, external_order_ref, is_test, cancelled_at) values ($1, $2, 'manual', 11.83, 5.49, 1.35, $3, $4, $5) returning id`,
    [over.channel ?? "ebay", over.soldAt ?? "2026-04-16", over.ref ?? null, over.isTest ?? false, over.cancelled ? "2026-04-20" : null]);
  for (const [k, [sky, name]] of (over.pieces ?? [["SKY-0150", "Cynder"], ["SKY-0187", "Zook"], ["SKY-0021", "Dino-Rang"]]).entries()) {
    await db.query(`insert into public.sale_items (sale_id, position, sky_id, raw_name) values ($1, $2, $3, $4)`, [id, k + 1, sky, name]);
  }
  return id;
}
const orderId = (ref = REF) => one<number>(db, `select id from public.sales_recon_orders where session_id = $1 and order_ref = $2`, [session, ref]);
const version = (sale: number) => one<string>(db, `select updated_at::text from public.sales where id = $1`, [sale]);
const assignSql = `select public.seller_recon_assign_sale($1, $2, $3::timestamptz)`;
const assign = async (sale: number, v?: string | null, ref?: string) =>
  one<{ status: string; sale_id: number }>(db, assignSql, [await orderId(ref), sale, v === undefined ? await version(sale) : v]);
const refusal = async (sale: number, v?: string | null, ref?: string) => {
  try { await assign(sale, v, ref); return "ok"; } catch (e) { const x = e as { code?: string; message?: string }; return `${x.code} ${x.message}`; }
};
/* Everything an assignment must never move — but the number, the version and the journal line. */
const untouched = () => one<string>(db, `select md5(concat_ws('|',
  (select string_agg(concat_ws(',', id, channel, sold_at, items_subtotal, shipping_charged, discount_amount, is_test, cancelled_at,
     destination_country_code, buyer_ref, note), ';' order by id) from public.sales),
  (select string_agg(concat_ws(',', id, sale_id, position, sky_id, raw_name, movement_id, settled_at), ';' order by id) from public.sale_items),
  (select string_agg(concat_ws(',', id, sky_id, quantity, reserved), ';' order by id) from public.shop_inventory),
  (select count(*) from public.order_reservations), (select count(*) from public.inventory_movements),
  (select string_agg(to_jsonb(m)::text, ';' order by m.id) from public.sales_recon_matches m),
  (select count(*) from public.sales_recon_decisions), (select count(*) from public.sales_recon_applications)))`);

afterEach(async () => { await db.close(); });

describe("an unmatched order, a sale created after the analysis", () => {
  beforeEach(async () => { await world(); });

  it("the analysis left it unmatched — and the sale did not exist then", async () => {
    expect(await one(db, `select category || '|' || coalesce(sale_id::text, '-') from public.sales_recon_matches
      where session_id = $1 and order_id = $2`, [session, await orderId()])).toBe("external_only|-");
  });

  it("assigned: ONLY the order number, the version and one journal line — figures, money, date, stock, the analysis untouched", async () => {
    const sale = await lateSale();
    const before = await untouched();
    const v = await version(sale);
    expect(await assign(sale)).toEqual({ status: "assigned", sale_id: sale });
    expect(await one(db, `select external_order_ref from public.sales where id = $1`, [sale])).toBe(REF);
    expect(await version(sale)).not.toBe(v);
    expect(await untouched()).toBe(before);
    expect((await db.query(`select entity_type, action, field, old_value, new_value, changed_by::text from public.orderbook_audit
      where sale_id = $1`, [sale])).rows).toEqual([
      { entity_type: "sale", action: "update", field: "external_order_ref", old_value: null, new_value: REF, changed_by: OPERATOR },
    ]);
  });

  it("the same again: exists, nothing written; a stale window (the old version): PT409", async () => {
    const sale = await lateSale();
    const v = await version(sale);
    await assign(sale, v);
    expect(await assign(sale)).toEqual({ status: "exists", sale_id: sale });
    expect(await one(db, `select count(*)::int from public.orderbook_audit where sale_id = $1`, [sale])).toBe(1);
    const other = await lateSale({ soldAt: "2026-04-30", pieces: [["SKY-0029", "Eruptor"]] });
    const old = await version(other);
    await db.query(`update public.sales set note = 'anderswo', updated_at = now() + interval '1 second' where id = $1`, [other]);
    expect(await refusal(other, old)).toMatch(/^PT409/);
  });
});

describe("never overwritten, never twice, never displaced", () => {
  beforeEach(async () => { await world(); });

  it("a sale with ANOTHER order number: refused, its number stays", async () => {
    const sale = await lateSale({ ref: "99-00000-00000" });
    expect(await refusal(sale)).toContain("(ref_present)");
    expect(await one(db, `select external_order_ref from public.sales where id = $1`, [sale])).toBe("99-00000-00000");
  });

  it("the number already on another sale: refused (and 0171's index is the floor)", async () => {
    await lateSale({ ref: REF, soldAt: "2026-06-01", pieces: [["SKY-0029", "Eruptor"]] });
    const sale = await lateSale({ soldAt: "2026-05-30", pieces: [["SKY-0029", "Eruptor"]] });
    expect(await refusal(sale)).toContain("(ref_taken)");
  });

  it("a sale paired in this session with another order: refused — an existing pairing is never displaced", async () => {
    const paired = await one<number>(db, `select sale_id from public.sales_recon_matches where session_id = $1 and order_id = $2`,
      [session, await orderId(PAIRED.ref!)]);
    expect(await refusal(paired)).toContain("(paired)");
  });

  it("an order that is not unmatched; a discarded session", async () => {
    const sale = await lateSale({ soldAt: "2026-04-28", pieces: [["SKY-0029", "Eruptor"]] });
    expect(await refusal(sale, undefined, PAIRED.ref!)).toContain("(not_unmatched)");
    await db.query(`update public.sales_recon_sessions set state = 'discarded', discarded_at = now() where id = $1`, [session]);
    expect(await refusal(await lateSale())).toContain("(session)");
  });
});

describe("0180's rule against rivals — unchanged, no manual release", () => {
  beforeEach(async () => { await world(); });

  it("another unpaired sale without number, ±3 days, with a same figure: rival_sale — nothing written", async () => {
    const sale = await lateSale();
    const rival = await lateSale({ soldAt: "2026-04-18", pieces: [["SKY-0187", "Zook"]] });
    expect(await refusal(sale)).toContain("(rival_sale)");
    expect(await one(db, `select count(*)::int from public.sales where external_order_ref = $1`, [REF])).toBe(0);
    // the rival four days away is no rival any more — the same window as 0180
    await db.query(`update public.sales set sold_at = '2026-04-20' where id = $1`, [rival]);
    expect((await assign(sale)).status).toBe("assigned");
  });

  it("another unpaired ORDER of the session, ±3 days of the sale, with a same figure: rival_order", async () => {
    await db.close();
    await world([UNMATCHED, { ref: "08-00000-00002", sold: "2026-04-17", lines: [{ character: "Dino-Rang", unit: 2.32 }], ledger: null }]);
    expect(await refusal(await lateSale())).toContain("(rival_order)");
  });
});

describe("the database refuses — and writes nothing", () => {
  beforeEach(async () => { await world(); });

  it("operator, version required, test, cancelled, internal, another channel", async () => {
    const sale = await lateSale();
    expect(await refusal(sale, null)).toContain("(version_required)");
    expect(await refusal(await lateSale({ isTest: true }))).toContain("(sale)");
    expect(await refusal(await lateSale({ cancelled: true }))).toContain("(sale)");
    expect(await refusal(await lateSale({ channel: "kleinanzeigen" }))).toContain("(sale)");
    const internal = await lateSale();
    await db.query(`update public.sales set order_id = 1 where id = $1`, [internal]);
    expect(await refusal(internal)).toContain("(sale)");
    await db.query(`update public.test_identity set uid = $1, operator = false`, [OTHER]);
    expect(await refusal(sale)).toMatch(/^42501/);
    expect(await one(db, `select count(*)::int from public.sales where external_order_ref = $1`, [REF])).toBe(0);
  });

  it("rights: authenticated may call (the operator check is inside), anon may not", async () => {
    const sig = "public.seller_recon_assign_sale(bigint,bigint,timestamptz)";
    expect(await one(db, `select has_function_privilege('authenticated', $1, 'execute')`, [sig])).toBe(true);
    expect(await one(db, `select has_function_privilege('anon', $1, 'execute')`, [sig])).toBe(false);
  });

  it("0185 defines one function and writes nothing but the number", () => {
    const sql = migration(M0185);
    expect([...sql.matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)\(/g)].map((m) => m[1])).toEqual(["seller_recon_assign_sale"]);
    const code = sql.replace(/--.*$/gm, "");
    expect([...code.matchAll(/\bupdate public\.(\w+)/g)].map((m) => m[1])).toEqual(["sales"]);
    expect(code).not.toMatch(/insert into public\.(?!orderbook_audit)|delete from|hold_sale_item|record_inventory_movement/);
    expect(code).toMatch(/set external_order_ref = v_order\.order_ref, updated_at = now\(\), updated_by = \(select auth\.uid\(\)\)\n/);
  });
});

describe("the migration's latch and its rollback", () => {
  beforeEach(async () => { await world(); });

  it("a second run bounces; R0185 removes the function, the written number stays", async () => {
    await expect(db.exec(migration(M0185))).rejects.toThrow(/applied here already/);
    const sale = await lateSale();
    await assign(sale);
    await db.exec(readFileSync("supabase/rollback/R0185_recon_assign_sale.sql", "utf8"));
    expect(await one(db, `select to_regprocedure('public.seller_recon_assign_sale(bigint,bigint,timestamptz)')::text`)).toBeNull();
    expect(await one(db, `select external_order_ref from public.sales where id = $1`, [sale])).toBe(REF);
  });
});
