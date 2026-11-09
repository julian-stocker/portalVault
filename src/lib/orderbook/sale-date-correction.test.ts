/**
 * Correcting the date of a HISTORICAL sale by hand (2026-11-08) — on real
 * PostgreSQL (PGlite), with the functions word for word from the migrations
 * that define them today:
 *
 *   seller_update_sale (0091), orderbook_log / orderbook_guard_stale (0062),
 *   sale_day_of / sales_set_day_and_index + its trigger (0113).
 *
 * The case is sale 64 on Staging: a workbook row (`excel_order_2026`) that was
 * never released for stock work (`stock_released_at` NULL — "frozen", 0071).
 * The freeze guards STOCK work (booking, settling, holds, shipping); the date
 * is not stock work, and `seller_update_sale` has no source rule. This file
 * holds that the dialog's one write corrects the day of such a sale — and
 * nothing else — that the database still refuses everyone who is not the
 * seller operator and every stale screen, and that the audit names both days.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { body, failsWith, one, reconciliationWorld, untouchable } from "@/lib/reconciliation/sql/schema";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const M0113 = "0113_sales_daily_index_and_repeat_buyers.sql";
const NOT_OPERATOR = "00000000-0000-4000-8000-000000000002";

/* 0113 on top of the reconciliation world: the two columns, the derivation and the trigger, verbatim. */
const DAY_ORDER = `
create table if not exists public.orders (id bigint primary key, paid_at timestamptz);
alter table public.sales add column sale_day date, add column daily_index integer;
create unique index sales_daily_index_uniq on public.sales (sale_day, daily_index)
  where sale_day is not null and daily_index is not null;
${body(M0113, "sale_day_of")}
${body(M0113, "sales_set_day_and_index")}
create trigger sales_set_day_and_index_trg before insert or update on public.sales
  for each row execute function public.sales_set_day_and_index();
`;

let db: PGlite;
const ids: Record<string, number> = {};

/* The 17.02.2026 of Staging, cut down: sale 63 on place 4, sale 64 on place 5, and a sale on the 18th. */
async function seed() {
  const insert = async (key: string, day: string, ref: string) => {
    ids[key] = await one<number>(db, `
      insert into public.sales (channel, sold_at, source, items_subtotal, shipping_charged, discount_amount, external_order_ref)
      values ('ebay', $1::date, 'excel_order_2026', 61.40, 8.89, 0, $2) returning id`, [day, ref]);
  };
  await insert("first", "2026-02-17", "A-1");
  await insert("s63", "2026-02-17", "15-14247-56972");
  await insert("s64", "2026-02-17", "06-14260-71832");
  await insert("next", "2026-02-18", "B-1");
  await db.query(`insert into public.sale_items (sale_id, position, sky_id, raw_name) values ($1, 1, 'SKY-0001', 'Spyro')`, [ids.s64]);
  await db.query(`insert into public.sale_refunds (sale_id, amount, reason) values ($1, 70.29, 'return')`, [ids.s64]);
}

const token = (id: number) => one<string>(db, `select updated_at::text from public.sales where id = $1`, [id]);
const correct = (id: number, day: string, expected: string | null) =>
  failsWith(db, `select public.seller_update_sale(p_id => $1, p_sold_at => $2::date, p_expected_updated_at => $3::timestamptz)`,
    [id, day, expected]);
const row = (id: number) => db.query<Record<string, unknown>>(`
  select sold_at::text, sale_day::text, daily_index, items_subtotal::text, shipping_charged::text, discount_amount::text,
         external_order_ref, source, stock_released_at, cancelled_at
    from public.sales where id = $1`, [id]).then((r) => r.rows[0]);
const dayOrder = (day: string) => db.query<{ id: number; daily_index: number }>(
  `select id, daily_index from public.sales where sale_day = $1::date order by daily_index`, [day]).then((r) => r.rows);
const money = () => one<string>(db, `
  select md5(coalesce((select string_agg(concat_ws(',', id, items_subtotal, shipping_charged, discount_amount), ';' order by id) from public.sales), '')
          || '|' || coalesce((select string_agg(concat_ws(',', id, sale_id, amount, reason), ';' order by id) from public.sale_refunds), ''))`);

beforeEach(async () => {
  db = await reconciliationWorld({ migrations: [] });
  await db.exec(DAY_ORDER);
  await seed();
});
afterEach(async () => { await db.close(); });

describe("the seller operator corrects the day of a frozen workbook sale", () => {
  it("the day moves from 17.02. to 18.02. — the sale stays a workbook sale and stays frozen", async () => {
    expect(await correct(ids.s64, "2026-02-18", await token(ids.s64))).toBe("ok");
    expect(await row(ids.s64)).toMatchObject({
      sold_at: "2026-02-18", sale_day: "2026-02-18",
      source: "excel_order_2026", stock_released_at: null, cancelled_at: null,
      external_order_ref: "06-14260-71832",
    });
  });

  it("the audit names the field, the old and the new day, and who changed it — one line, nothing else", async () => {
    await correct(ids.s64, "2026-02-18", await token(ids.s64));
    const audit = await db.query(`select entity_type, action, field, old_value, new_value, changed_by::text
                                    from public.orderbook_audit where sale_id = $1`, [ids.s64]);
    expect(audit.rows).toEqual([{
      entity_type: "sale", action: "update", field: "sold_at",
      old_value: "2026-02-17", new_value: "2026-02-18", changed_by: "00000000-0000-4000-8000-000000000001",
    }]);
  });

  it("amounts, refunds, positions and stock are exactly as before", async () => {
    const [moneyBefore, stockBefore] = [await money(), await untouchable(db)];
    await correct(ids.s64, "2026-02-18", await token(ids.s64));
    expect(await money()).toBe(moneyBefore);
    expect(await untouchable(db)).toBe(stockBefore);
  });

  it("the day order stays consistent: last place on the new day; the old day keeps its places, a gap stays visible", async () => {
    await correct(ids.s64, "2026-02-18", await token(ids.s64));
    expect(await dayOrder("2026-02-18")).toEqual([
      { id: ids.next, daily_index: 1 }, { id: ids.s64, daily_index: 2 },
    ]);
    // 0113: nobody else is renumbered. Sale 64 was the day's last place, so no gap here.
    expect(await dayOrder("2026-02-17")).toEqual([
      { id: ids.first, daily_index: 1 }, { id: ids.s63, daily_index: 2 },
    ]);
  });

  it("moving a sale out of the MIDDLE of a day leaves the gap rather than renumbering the others (0113)", async () => {
    await correct(ids.s63, "2026-02-18", await token(ids.s63));
    expect(await dayOrder("2026-02-17")).toEqual([
      { id: ids.first, daily_index: 1 }, { id: ids.s64, daily_index: 3 },
    ]);
  });
});

describe("the database still refuses", () => {
  it("an account that does not operate the seller: 42501, nothing written", async () => {
    const before = await token(ids.s64);
    await db.query(`update public.test_identity set uid = $1, operator = false`, [NOT_OPERATOR]);
    expect(await correct(ids.s64, "2026-02-18", before)).toBe("42501");
    await db.query(`update public.test_identity set uid = '00000000-0000-4000-8000-000000000001', operator = true`);
    expect((await row(ids.s64)).sold_at).toBe("2026-02-17");
    expect(await one<number>(db, `select count(*)::int from public.orderbook_audit`)).toBe(0);
  });

  it("a stale screen: PT409, nothing written", async () => {
    const opened = await token(ids.s64);
    // Someone else saves the sale in between (here: the note).
    await db.query(`select public.seller_update_sale(p_id => $1, p_note => 'checked')`, [ids.s64]);
    expect(await correct(ids.s64, "2026-02-18", opened)).toBe("PT409");
    expect((await row(ids.s64)).sold_at).toBe("2026-02-17");
  });

  it("an implausible day stays refused, as before", async () => {
    expect(await correct(ids.s64, "1999-12-31", await token(ids.s64))).toBe("23514");
    expect((await row(ids.s64)).sold_at).toBe("2026-02-17");
  });

  it("a call without a day changes no day", async () => {
    await db.query(`select public.seller_update_sale(p_id => $1, p_note => 'checked', p_expected_updated_at => $2::timestamptz)`,
      [ids.s64, await token(ids.s64)]);
    expect((await row(ids.s64)).sold_at).toBe("2026-02-17");
    const fields = await db.query(`select field from public.orderbook_audit where sale_id = $1`, [ids.s64]);
    expect(fields.rows).toEqual([{ field: "note" }]);
  });
});
