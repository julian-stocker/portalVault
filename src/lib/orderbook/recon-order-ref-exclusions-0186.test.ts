/**
 * 0186 on real PostgreSQL (PGlite): an order number confirmed DESPITE rivals,
 * when the operator excluded each one — the case of sales 155/157 (April
 * pairs without number) and their May rivals 158/160, simulated.
 *
 *   both ways   a certain pair without number; an unmatched order + a sale
 *   exact       the exclusions must equal the rivals recomputed under lock,
 *               each rival sale with the version seen — new, gone or changed:
 *               rivals_changed; none at all: no_rivals (0180/0185 decide)
 *   unchanged   operator, version (PT409), never overwrite, ref_taken,
 *               never displace another pairing, note required
 *   journal     the number + one `rival_excluded` line per rival
 *   untouched   figures, money, date, stock, holds, the analysis — and the
 *               functions of 0180 and 0185
 */
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { body, migration, one, OPERATOR, reconciliationWorld } from "@/lib/reconciliation/sql/schema";
import { WITH_0180, WORKFLOW } from "@/lib/reconciliation/sql/create-sale-world";
import { analyseSpecs, seedSales, type Spec } from "@/lib/reconciliation/sql/session-fixture";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const M0186 = "0186_recon_order_ref_with_exclusions.sql";
const SIG = "public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)";
const P157 = "12-14570-08869";
const UNMATCHED = "06-14518-99785";
const SPECS: Spec[] = [
  { ref: P157, sold: "2026-04-30", shipping: 5.49, lines: [{ character: "Warnado", unit: 4 }, { character: "Camo", unit: 5 }],
    ledger: { sold: "2026-04-30", subtotal: 9, pieces: ["Warnado", "Camo"] } },
  { ref: UNMATCHED, sold: "2026-04-16", shipping: 5.49, lines: [{ character: "Cynder", unit: 6 }], ledger: null },
];
const OTHER = "00000000-0000-4000-8000-000000000002";

let db: PGlite;
let session: number;
async function world(specs: Spec[] = SPECS) {
  db = await reconciliationWorld({ migrations: WITH_0180 });
  await db.exec(WORKFLOW);
  await db.exec(migration(M0186));
  await db.exec(`insert into public.skylanders (sky_id, name, series_code) values ('SKY-0014', 'Camo', 'SA'),
    ('SKY-0078', 'Warnado', 'SA'), ('SKY-0150', 'Cynder', 'G'), ('SKY-0007', 'Bash', 'SA') on conflict do nothing;
    insert into public.shop_inventory (sky_id, quantity) values ('SKY-0014', 1)`);
  await seedSales(db, specs);
  session = await analyseSpecs(db, specs);
}
/* A sale typed later, without order number (the May rivals, sale 381 …). */
async function sale(soldAt: string, names: string[], over: { ref?: string } = {}) {
  const id = await one<number>(db, `insert into public.sales (channel, sold_at, source, items_subtotal, shipping_charged, external_order_ref)
    values ('ebay', $1, 'manual', 5, 5.49, $2) returning id`, [soldAt, over.ref ?? null]);
  for (const [k, n] of names.entries()) await db.query(`insert into public.sale_items (sale_id, position, raw_name) values ($1, $2, $3)`, [id, k + 1, n]);
  return id;
}
const orderId = (ref: string) => one<number>(db, `select id from public.sales_recon_orders where session_id = $1 and order_ref = $2`, [session, ref]);
const pairedSale = () => one<number>(db, `select m.sale_id from public.sales_recon_matches m join public.sales_recon_orders o on o.id = m.order_id
  where o.order_ref = $1 and m.session_id = $2`, [P157, session]);
const version = (id: number) => one<string>(db, `select updated_at::text from public.sales where id = $1`, [id]);
const excl = async (sales: number[], orders: string[] = []) => ({
  sales: await Promise.all(sales.map(async (id) => ({ id, updatedAt: await version(id) }))),
  orders: await Promise.all(orders.map(async (r) => ({ id: await orderId(r) }))),
});
const confirm = async (ref: string, saleId: number, excluded: unknown, note = "158/160 sind Mai-Bestellungen", v?: string) =>
  one<{ status: string; sale_id: number; excluded_sales: number[] }>(db,
    `select public.seller_recon_confirm_order_ref($1, $2, $3::timestamptz, $4::jsonb, $5)`,
    [await orderId(ref), saleId, v ?? await version(saleId), JSON.stringify(excluded), note]);
const refusal = async (...a: Parameters<typeof confirm>) => {
  try { await confirm(...a); return "ok"; } catch (e) { const x = e as { code?: string; message?: string }; return `${x.code} ${x.message}`; }
};
const untouched = () => one<string>(db, `select md5(concat_ws('|',
  (select string_agg(concat_ws(',', id, sold_at, items_subtotal, shipping_charged, discount_amount, is_test, cancelled_at, note), ';' order by id) from public.sales),
  (select string_agg(concat_ws(',', id, sale_id, position, sky_id, raw_name, movement_id), ';' order by id) from public.sale_items),
  (select string_agg(concat_ws(',', id, quantity, reserved), ';' order by id) from public.shop_inventory),
  (select count(*) from public.order_reservations), (select count(*) from public.inventory_movements),
  (select string_agg(to_jsonb(m)::text, ';' order by m.id) from public.sales_recon_matches m),
  (select count(*) from public.sales_recon_decisions), (select count(*) from public.sales_recon_applications)))`);

afterEach(async () => { await db.close(); });

describe("a certain pair without number, a rival in the window (157 and 158/160)", () => {
  beforeEach(async () => { await world(); });

  it("the analysis paired it, without number — the case", async () => {
    expect(await one(db, `select m.category from public.sales_recon_matches m join public.sales_recon_orders o on o.id = m.order_id
      where o.order_ref = $1 and m.session_id = $2`, [P157, session])).toMatch(/^(exact|deviating)$/);
    expect(await one(db, `select external_order_ref from public.sales where id = $1`, [await pairedSale()])).toBeNull();
  });

  it("each rival excluded: the number written — and ONLY the number; the journal names every exclusion", async () => {
    const s157 = await pairedSale();
    const r158 = await sale("2026-05-01", ["Camo", "Bash"]);
    const r160 = await sale("2026-05-02", ["Warnado"]);
    const before = await untouched();
    const r = await confirm(P157, s157, await excl([r158, r160]));
    expect(r).toMatchObject({ status: "confirmed", sale_id: s157, excluded_sales: [r158, r160] });
    expect(await one(db, `select external_order_ref from public.sales where id = $1`, [s157])).toBe(P157);
    expect(await untouched()).toBe(before);
    const audit = (await db.query<Record<string, string>>(`select field, old_value, new_value, changed_by::text as by from public.orderbook_audit
      where sale_id = $1 order by id`, [s157])).rows;
    expect(audit.map((a) => a.field)).toEqual(["external_order_ref", "rival_excluded", "rival_excluded"]);
    expect(audit[1].old_value).toMatch(new RegExp(`^sale ${r158} @ `));
    expect(audit[2].new_value).toBe(`${P157} (pair) — 158/160 sind Mai-Bestellungen`);
    expect(audit.every((a) => a.by === OPERATOR)).toBe(true);
    // the rivals themselves stay exactly as they were
    expect(await one(db, `select count(*)::int from public.sales where id in ($1, $2) and external_order_ref is null`, [r158, r160])).toBe(2);
  });

  it("not every rival excluded, or one too many: rivals_changed — nothing written", async () => {
    const s157 = await pairedSale();
    const r158 = await sale("2026-05-01", ["Camo"]);
    const r160 = await sale("2026-05-02", ["Warnado"]);
    const elsewhere = await sale("2026-06-15", ["Camo"]);
    expect(await refusal(P157, s157, { sales: [], orders: [] })).toContain("(rivals_changed)");
    expect(await refusal(P157, s157, await excl([r158]))).toContain("(rivals_changed)");
    expect(await refusal(P157, s157, await excl([r158, r160, elsewhere]))).toContain("(rivals_changed)");
    expect(await one(db, `select external_order_ref from public.sales where id = $1`, [s157])).toBeNull();
  });

  it("a rival changed since the operator looked, or a new one appeared: rivals_changed", async () => {
    const s157 = await pairedSale();
    const r158 = await sale("2026-05-01", ["Camo"]);
    const seen = await excl([r158]);
    await db.query(`update public.sales set note = 'geändert', updated_at = now() + interval '1 minute' where id = $1`, [r158]);
    expect(await refusal(P157, s157, seen)).toContain("(rivals_changed)");
    const fresh = await excl([r158]);
    await sale("2026-04-29", ["Warnado"]);
    expect(await refusal(P157, s157, fresh)).toContain("(rivals_changed)");
  });

  it("no rival at all: no_rivals — then 0180 / 0185 decide, not this exception", async () => {
    expect(await refusal(P157, await pairedSale(), { sales: [], orders: [] })).toContain("(no_rivals)");
  });

  it("no note, a stale sale version, malformed exclusions: refused", async () => {
    const s157 = await pairedSale();
    const r158 = await sale("2026-05-01", ["Camo"]);
    expect(await refusal(P157, s157, await excl([r158]), "  ")).toContain("(note)");
    expect(await refusal(P157, s157, await excl([r158]), "x", "2026-01-01T00:00:00Z")).toMatch(/^PT409/);
    expect(await refusal(P157, s157, { sales: [{ id: r158 }] })).toContain("(exclusions)");
    expect(await refusal(P157, s157, { sales: [], orders: [], all: true })).toContain("(exclusions)");
  });
});

describe("an unmatched order and an existing sale, a rival beside it", () => {
  beforeEach(async () => { await world(); });

  it("excluded: assigned — the unmatched way, journal says so", async () => {
    const s381 = await sale("2026-04-16", ["Cynder"]);
    const rival = await sale("2026-04-18", ["Cynder"]);
    expect((await confirm(UNMATCHED, s381, await excl([rival]), "Verkauf daneben ist eine andere Bestellung")).status).toBe("confirmed");
    expect(await one(db, `select new_value from public.orderbook_audit where sale_id = $1 and field = 'rival_excluded'`, [s381]))
      .toBe(`${UNMATCHED} (unmatched) — Verkauf daneben ist eine andere Bestellung`);
  });

  it("a rival ORDER of the session (unpaired, same figure, ±3 days of the sale) must be excluded too", async () => {
    await db.close();
    const OTHER_ORDER = "07-00000-00007";
    await world([...SPECS, { ref: OTHER_ORDER, sold: "2026-04-18", shipping: 5.49, lines: [{ character: "Bash", unit: 3 }], ledger: null }]);
    const s = await sale("2026-04-17", ["Cynder", "Bash"]);
    // the only rival is the other unmatched ORDER (Bash): without excluding it — refused
    expect(await refusal(UNMATCHED, s, { sales: [], orders: [] })).toContain("(rivals_changed)");
    const r = await confirm(UNMATCHED, s, await excl([], [OTHER_ORDER]));
    expect(r.status).toBe("confirmed");
    expect(await one(db, `select old_value from public.orderbook_audit where sale_id = $1 and field = 'rival_excluded'`, [s]))
      .toBe(`order ${OTHER_ORDER}`);
  });
});

describe("what never changes", () => {
  beforeEach(async () => { await world(); });

  it("a number present: never overwritten (ref_present); the same: exists; on another sale: ref_taken", async () => {
    const s = await sale("2026-04-16", ["Cynder"], { ref: "99-00000-00000" });
    const rival = await sale("2026-04-17", ["Cynder"]);
    expect(await refusal(UNMATCHED, s, await excl([rival]))).toContain("(ref_present)");
    const same = await sale("2026-04-16", ["Cynder"], { ref: UNMATCHED });
    expect((await confirm(UNMATCHED, same, await excl([rival]))).status).toBe("exists");
  });

  it("a sale paired with ANOTHER order is never displaced (paired); a paired order is not 'unmatched'", async () => {
    const rival = await sale("2026-04-29", ["Camo"]);
    expect(await refusal(UNMATCHED, await pairedSale(), await excl([rival]))).toContain("(paired)");
    const other = await sale("2026-04-30", ["Camo"]);
    expect(await refusal(P157, other, await excl([rival]))).toContain("(not_assignable)");
  });

  it("operator only (42501); authenticated may call, anon may not", async () => {
    const s = await sale("2026-04-16", ["Cynder"]);
    const rival = await sale("2026-04-17", ["Cynder"]);
    const ex = await excl([rival]);
    await db.query(`update public.test_identity set uid = $1, operator = false`, [OTHER]);
    expect(await refusal(UNMATCHED, s, ex)).toMatch(/^42501/);
    expect(await one(db, `select has_function_privilege('anon', $1, 'execute')`, [SIG])).toBe(false);
    expect(await one(db, `select has_function_privilege('authenticated', $1, 'execute')`, [SIG])).toBe(true);
  });

  it("0186 is ONE new function: 0180's take check and every other function untouched; writes only the number and the journal", () => {
    const sql = migration(M0186);
    expect([...sql.matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)\(/g)].map((m) => m[1])).toEqual(["seller_recon_confirm_order_ref"]);
    const code = sql.replace(/--.*$/gm, "");
    expect([...code.matchAll(/\bupdate public\.(\w+)/g)].map((m) => m[1])).toEqual(["sales"]);
    expect(code).not.toMatch(/insert into|delete from|hold_sale_item|record_inventory_movement|sales_recon_take_check|seller_recon_assign_sale/);
    // the rival predicates are 0180's, word for word
    const take = body("0180_sales_recon_selected_apply.sql", "sales_recon_take_check");
    for (const part of ["s2.order_id is null", "not s2.is_test and s2.cancelled_at is null and s2.external_order_ref is null",
      "where lower(btrim(l ->> 'name')) in (lower(btrim(i.raw_name)), lower(btrim(k.name)))"]) {
      expect(take, part).toContain(part);
      expect(code, part).toContain(part);
    }
  });

  it("a second run bounces; R0186 removes only this function, a written number stays", async () => {
    await expect(db.exec(migration(M0186))).rejects.toThrow(/applied here already/);
    const s = await sale("2026-04-16", ["Cynder"]);
    const rival = await sale("2026-04-17", ["Cynder"]);
    await confirm(UNMATCHED, s, await excl([rival]));
    await db.exec(readFileSync("supabase/rollback/R0186_recon_order_ref_with_exclusions.sql", "utf8"));
    expect(await one(db, `select to_regprocedure($1)::text`, [SIG])).toBeNull();
    expect(await one(db, `select to_regprocedure('public.sales_recon_take_check(bigint)')::text`)).not.toBeNull();
    expect(await one(db, `select external_order_ref from public.sales where id = $1`, [s])).toBe(UNMATCHED);
  });
});
