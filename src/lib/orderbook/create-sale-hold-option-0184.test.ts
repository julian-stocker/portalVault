/**
 * 0184 on real PostgreSQL (PGlite): `seller_create_sale_with_details` with
 * `p_hold` — the body of 0110, the item loop the only difference.
 *
 *   default     a call without p_hold holds as before (every existing caller)
 *   p_hold false  the same positions, no hold, no stock movement
 *   NULL        refused — the mode is said, never guessed
 *   later       held and booked by hand through the existing functions
 *   once        a second sale with the same eBay number is refused (0171)
 *   rights      operator only; authenticated may call, anon may not; ONE function
 *   rollback    R0184 restores 0110's body character for character
 */
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { body, failsWith, migration, one, reconciliationWorld } from "@/lib/reconciliation/sql/schema";
import { WORKFLOW } from "@/lib/reconciliation/sql/create-sale-world";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const M0184 = "0184_create_sale_hold_option.sql";
const MD5_0110 = "4aceeb7caab83b1b078fd03f39982464";
/* What 0110's body calls besides the positions — fees, adjustments, payout — recorded, not re-implemented (0184 does not touch them). */
const BEFORE_0184 = `
create table public.test_calls (fn text, sale_id bigint, arg text);
create function public.seller_add_sale_fee(p_sale_id bigint, p_kind text, p_amount numeric, p_settled_by text, p_label text, p_note text)
returns bigint language sql as $$ insert into public.test_calls values ('fee', p_sale_id, p_kind || '=' || p_amount) returning 1::bigint $$;
create function public.seller_add_settlement_adjustment(p_sale_id bigint, p_channel text, p_amount numeric, p_reason text,
  p_external_ref text, p_note text, p_occurred_at date) returns bigint language sql as $$
  insert into public.test_calls values ('adjustment', p_sale_id, p_amount::text) returning 1::bigint $$;
create function public.seller_set_sale_payout(p_sale_id bigint, p_amount numeric, p_ref text, p_a text, p_b text)
returns void language sql as $$ insert into public.test_calls values ('payout', p_sale_id, p_amount::text) $$;
${body("0063_orderbook_test_classification.sql", "seller_create_sale")}
${body("0110_external_hold_runtime.sql", "seller_add_sale_item")}
${body("0110_external_hold_runtime.sql", "seller_create_sale_with_details")}
`;
const OTHER = "00000000-0000-4000-8000-000000000002";

let db: PGlite;
async function world(apply = true) {
  db = await reconciliationWorld();
  await db.exec(WORKFLOW);
  await db.exec(BEFORE_0184);
  if (apply) await db.exec(migration(M0184));
  await db.exec(`insert into public.skylanders (sky_id, name, series_code) values
    ('SKY-0150', 'Cynder', 'G'), ('SKY-0021', 'Dino-Rang', 'SA') on conflict do nothing;
    insert into public.shop_inventory (sky_id, quantity) values ('SKY-0150', 2), ('SKY-0021', 1)`);
}
afterEach(async () => { await db.close(); });

const ITEMS = JSON.stringify([{ sky_id: "SKY-0150" }, { sky_id: "SKY-0150" }, { sky_id: "SKY-0021" }, { raw_name: "Portal 84148790" }]);
const createSql = (hold?: string) => `select public.seller_create_sale_with_details(
  p_channel => 'ebay', p_sold_at => '2026-04-16', p_country => 'DE', p_external_ref => $1,
  p_items_subtotal => 30.01, p_shipping_charged => 5.49, p_items => $2::jsonb,
  p_fees => '[{"kind":"ebay","amount":3.2,"settled_by":"platform"}]'::jsonb${hold === undefined ? "" : `, p_hold => ${hold}`})`;
const create = (ref: string, hold?: string) => one<number>(db, createSql(hold), [ref, ITEMS]);
const stock = () => one<string>(db, `select string_agg(sky_id || '=' || quantity || '/' || reserved, ',' order by sky_id) from public.shop_inventory`);
const holds = (sale: number) => one<number>(db, `select count(*)::int from public.order_reservations r join public.sale_items i on i.id = r.sale_item_id
  where i.sale_id = $1 and r.state = 'active'`, [sale]);
const items = (sale: number) => db.query(`select position, sky_id, raw_name, condition, movement_id from public.sale_items
  where sale_id = $1 order by position`, [sale]).then((r) => r.rows);

describe("the default stays: every existing caller holds as before", () => {
  beforeEach(async () => { await world(); });

  it("without p_hold: three figures, two units free of Cynder and one Dino-Rang — all held, nothing booked", async () => {
    const sale = await create("01-00000-00001");
    expect(await holds(sale)).toBe(3);
    expect(await stock()).toBe("SKY-0021=1/1,SKY-0150=2/2");
    expect(await one(db, `select count(*)::int from public.inventory_movements`)).toBe(0);
  });

  it("the same as 0110 did: same positions, same amounts, same fee call", async () => {
    const before = await world0110("01-00000-00001");
    const sale = await create("01-00000-00001");
    expect({ items: await items(sale), head: await head(sale), calls: await calls(sale), holds: await holds(sale) }).toEqual(before);
  });
});

describe("p_hold false — only when said", () => {
  beforeEach(async () => { await world(); });

  it("the same positions, no hold, no stock change, no movement; fees still go through", async () => {
    const before = await stock();
    const sale = await create("01-00000-00002", "false");
    expect(await items(sale)).toEqual([
      { position: 1, sky_id: "SKY-0150", raw_name: null, condition: "loose", movement_id: null },
      { position: 2, sky_id: "SKY-0150", raw_name: null, condition: "loose", movement_id: null },
      { position: 3, sky_id: "SKY-0021", raw_name: null, condition: "loose", movement_id: null },
      { position: 4, sky_id: null, raw_name: "Portal 84148790", condition: "loose", movement_id: null },
    ]);
    expect(await holds(sale)).toBe(0);
    expect(await stock()).toBe(before);
    expect(await one(db, `select count(*)::int from public.inventory_movements`)).toBe(0);
    expect(await calls(sale)).toEqual(["fee:ebay=3.2"]);
    expect(await head(sale)).toMatchObject({ items_subtotal: "30.01", shipping_charged: "5.49", external_order_ref: "01-00000-00002" });
  });

  it("true explicitly is the old behaviour; NULL is refused and nothing is written", async () => {
    expect(await holds(await create("01-00000-00003", "true"))).toBe(3);
    expect(await failsWith(db, createSql("null"), ["01-00000-00004", ITEMS])).toBe("22023");
    expect(await one(db, `select count(*)::int from public.sales where external_order_ref = '01-00000-00004'`)).toBe(0);
  });

  it("later, by hand: reserve one unit (held), book it (moved, hold converted), book another without hold", async () => {
    const sale = await create("01-00000-00005", "false");
    const [cynder, , dino] = (await db.query<{ id: number }>(`select id from public.sale_items where sale_id = $1 order by position`, [sale])).rows.map((r) => r.id);
    expect(await one(db, `select public.seller_hold_sale_item($1)`, [cynder])).toBe("held");
    expect(await stock()).toBe("SKY-0021=1/0,SKY-0150=2/1");
    expect(await one<number>(db, `select public.seller_book_sale_item($1)`, [cynder])).toBeGreaterThan(0);
    expect(await one<number>(db, `select public.seller_book_sale_item($1)`, [dino])).toBeGreaterThan(0);
    expect(await stock()).toBe("SKY-0021=0/0,SKY-0150=1/0");
    expect(await one(db, `select count(*)::int from public.sale_items i where i.sale_id = $1 and not public.sale_item_is_closed(i)`, [sale])).toBe(2);
  });
});

describe("what stays guarded", () => {
  beforeEach(async () => { await world(); });

  it("a second sale with the same eBay number is refused (0171) — with or without hold — and nothing half-written stays", async () => {
    await create("06-14518-99785", "false");
    for (const hold of ["false", "true", undefined]) {
      expect(await failsWith(db, createSql(hold), ["06-14518-99785", ITEMS])).toBe("23505");
    }
    expect(await one(db, `select count(*)::int from public.sales where external_order_ref = '06-14518-99785'`)).toBe(1);
    expect(await one(db, `select count(*)::int from public.order_reservations where state = 'active'`)).toBe(0);
  });

  it("an account that does not operate the seller: 42501 in both modes", async () => {
    await db.query(`update public.test_identity set uid = $1, operator = false`, [OTHER]);
    expect(await failsWith(db, createSql("false"), ["01-00000-00006", ITEMS])).toBe("42501");
    expect(await failsWith(db, createSql(), ["01-00000-00006", ITEMS])).toBe("42501");
  });

  it("exactly ONE function of that name — the 16-argument one; authenticated may call it, anon and PUBLIC may not", async () => {
    expect(await one(db, `select string_agg(p.oid::regprocedure::text, ';') from pg_proc p where p.proname = 'seller_create_sale_with_details'`))
      .toBe("seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)");
    const sig = "public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)";
    expect(await one(db, `select has_function_privilege('authenticated', $1, 'execute')`, [sig])).toBe(true);
    expect(await one(db, `select has_function_privilege('anon', $1, 'execute')`, [sig])).toBe(false);
    expect(await one(db, `select obj_description(to_regprocedure($1), 'pg_proc') like '%since 0184 p_hold false%'`, [sig])).toBe(true);
  });

  it("the body is 0110's but for the NULL refusal and the item branch", () => {
    const old = body("0110_external_hold_runtime.sql", "seller_create_sale_with_details");
    const sql = migration(M0184);
    const from = sql.indexOf("create function public.seller_create_sale_with_details(");
    const now = sql.slice(from, sql.indexOf("\n$$;", from) + 4);
    const back = now
      .replace("create function public.seller_create_sale_with_details(", "create or replace function public.seller_create_sale_with_details(")
      .replace("  p_payout_ref       text    default null,\n  p_hold             boolean default true\n)", "  p_payout_ref       text    default null\n)")
      .replace(/  -- 0184: the reservation mode[^\n]*\n  if p_hold is null then\n[^\n]*\n  end if;\n/, "")
      .replace(/    if p_hold then\n([\s\S]*?)    else\n[\s\S]*?    end if;\n  end loop;/, (_m, held: string) =>
        held.split("\n").map((l) => l.replace(/^  /, "")).join("\n") + "  end loop;");
    expect(back).toBe(old);
  });
});

describe("the migration's latches and its rollback", () => {
  it("a foreign body is not overwritten; a second run bounces", async () => {
    await world(false);
    await db.exec(`create or replace function public.seller_create_sale_with_details(p_channel text, p_sold_at date default null,
      p_country text default null, p_external_ref text default null, p_buyer_ref text default null, p_note text default null,
      p_is_test boolean default false, p_items_subtotal numeric default 0, p_shipping_charged numeric default 0,
      p_discount_amount numeric default 0, p_items jsonb default '[]', p_fees jsonb default '[]', p_adjustments jsonb default '[]',
      p_payout_amount numeric default null, p_payout_ref text default null) returns bigint language sql as $$ select 1::bigint $$`);
    await expect(db.exec(migration(M0184))).rejects.toThrow(/not the body of 0110/);
    await db.exec(body("0110_external_hold_runtime.sql", "seller_create_sale_with_details"));
    await db.exec(migration(M0184));
    await expect(db.exec(migration(M0184))).rejects.toThrow(/applied here already/);
  });

  it("R0184: back to 0110's body, one function, its rights; a sale created without hold stays", async () => {
    await world();
    const sale = await create("01-00000-00007", "false");
    await db.exec(readFileSync("supabase/rollback/R0184_create_sale_hold_option.sql", "utf8"));
    expect(await one(db, `select md5(prosrc) from pg_proc where proname = 'seller_create_sale_with_details'`)).toBe(MD5_0110);
    expect(await one(db, `select count(*)::int from pg_proc where proname = 'seller_create_sale_with_details'`)).toBe(1);
    expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text)', 'execute')`)).toBe(true);
    expect(await one(db, `select count(*)::int from public.sale_items where sale_id = $1`, [sale])).toBe(4);
    expect(await holds(await create("01-00000-00008"))).toBe(3);
  });
});

/* ---- helpers that need `db` */
async function head(sale: number) {
  return (await db.query<Record<string, unknown>>(`select channel, sold_at::text, destination_country_code, external_order_ref,
    items_subtotal, shipping_charged, discount_amount, buyer_ref, source from public.sales where id = $1`, [sale])).rows[0];
}
async function calls(sale: number) {
  return (await db.query<{ c: string }>(`select fn || ':' || arg as c from public.test_calls where sale_id = $1 order by fn`, [sale])).rows.map((r) => r.c);
}
/* The same call against a world WITHOUT 0184 — the reference for "unchanged". */
async function world0110(ref: string) {
  const mine = db;
  await world(false);
  const sale = await create(ref);
  const out = { items: await items(sale), head: await head(sale), calls: await calls(sale), holds: await holds(sale) };
  await db.close();
  db = mine;
  return out;
}
