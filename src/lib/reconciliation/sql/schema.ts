/**
 * A small PostgreSQL world for the reconciliation migrations (0169–0173).
 *
 * Tables are cut to the columns the functions touch. Every function the
 * reconciliation CALLS comes WORD FOR WORD from the migration that defines it
 * today — `orderbook_log`, `orderbook_guard_stale`, `orderbook_touch_sale`,
 * `seller_add_sale_refund` (0062), `seller_update_sale` (0091),
 * `hold_sale_item`, `release_sale_item_hold` (0110). A stub would only prove
 * that they are called; the real bodies prove what they do. Only the two
 * identities are switches: who is signed in (`auth.uid()`) and whether that
 * account operates the seller (`can_operate_active_seller()`).
 *
 * Then 0169–0173 run as files, exactly as they would on Staging.
 */

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIG = (file: string) => readFileSync(`supabase/migrations/${file}`, "utf8");

/** The LAST body of a function in a migration file, verbatim. */
export function body(file: string, name: string): string {
  const sql = MIG(file);
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`${name} is missing in ${file}`);
  const end = sql.indexOf("\n$$;", start);
  return sql.slice(start, end + 4);
}

export const RECONCILIATION_MIGRATIONS = [
  "0169_sales_reconciliation_schema.sql",
  "0170_external_sale_cancel.sql",
  "0171_external_order_ref_per_channel.sql",
  "0172_sales_reconciliation_rpcs.sql",
  "0173_sales_reconciliation_apply.sql",
] as const;

export const migration = (file: string): string => MIG(file);

export const OPERATOR = "00000000-0000-4000-8000-000000000001";

const WORLD = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
insert into auth.users values ('${OPERATOR}');
create table public.test_identity (uid uuid, operator boolean not null);
insert into public.test_identity values ('${OPERATOR}', true);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.test_identity $$;
create function public.can_operate_active_seller() returns boolean language sql stable as $$
  select operator from public.test_identity $$;
create function public.v1_sale_condition() returns text language sql immutable as $$ select 'loose'::text $$;

create table public.skylanders (sky_id text primary key, name text not null, series_code text not null, base_sky_id text);
create table public.inventory_movements (id bigint generated always as identity primary key, note text);
create table public.legacy_stock_events (id bigint generated always as identity primary key, note text);
create table public.shop_inventory (
  id bigint generated always as identity primary key, sky_id text not null, condition text not null default 'loose',
  quantity integer not null, reserved integer not null default 0, check (reserved between 0 and quantity));

create table public.sales (
  id bigint generated always as identity primary key,
  channel text not null, order_id bigint, sold_at date, shipped_at timestamptz,
  destination_country_code text, currency text not null default 'EUR',
  items_subtotal numeric(10,2), shipping_charged numeric(10,2), discount_amount numeric(10,2),
  external_order_ref text, buyer_ref text, note text,
  source text not null default 'manual', is_test boolean not null default false,
  cancelled_at timestamptz, stock_released_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint sales_cancelled_is_not_released check (cancelled_at is null or stock_released_at is null));
create table public.sale_items (
  id bigint generated always as identity primary key, sale_id bigint not null references public.sales (id),
  position integer not null default 1, sky_id text, raw_name text, condition text not null default 'loose',
  movement_id bigint, return_movement_id bigint, returned_at timestamptz, return_announced_at timestamptz,
  settled_at timestamptz, not_shipped_at timestamptz, legacy_stock_flag text, source_row integer);
create table public.sale_refunds (
  id bigint generated always as identity primary key, sale_id bigint not null references public.sales (id),
  amount numeric(10,2) not null, occurred_at timestamptz not null default now(), reason text,
  external_ref text, note text, created_at timestamptz not null default now(), created_by uuid);
create table public.order_reservations (
  id bigint generated always as identity primary key, order_id bigint, sale_item_id bigint,
  inventory_id bigint not null, quantity integer not null, expires_at timestamptz,
  state text not null default 'active', released_at timestamptz);
create table public.orderbook_audit (
  id bigint generated always as identity primary key, sale_id bigint, entity_type text not null,
  entity_id bigint not null, action text not null, field text, old_value text, new_value text,
  changed_at timestamptz not null default now(), changed_by uuid);
`;

/** The functions the world takes word for word from the migration that defines them today. */
const BODIES = [
  ["0062_orderbook_sale_maintenance.sql", "orderbook_log"],
  ["0062_orderbook_sale_maintenance.sql", "orderbook_guard_stale"],
  ["0062_orderbook_sale_maintenance.sql", "orderbook_touch_sale"],
  ["0062_orderbook_sale_maintenance.sql", "seller_add_sale_refund"],
  ["0091_update_sale_date_range.sql", "seller_update_sale"],
  ["0110_external_hold_runtime.sql", "hold_sale_item"],
  ["0110_external_hold_runtime.sql", "release_sale_item_hold"],
] as const;

/**
 * The same world as SQL scripts, in order — for a REAL PostgreSQL server
 * (`src/lib/reconciliation/pg/`), which runs exactly what PGlite runs.
 */
export function reconciliationWorldScripts(migrations: readonly string[] = RECONCILIATION_MIGRATIONS): string[] {
  return [WORLD, ...BODIES.map(([file, name]) => body(file, name)), ...migrations.map(MIG)];
}

export async function reconciliationWorld(options: { migrations?: readonly string[] } = {}): Promise<PGlite> {
  const db = new PGlite();
  for (const script of reconciliationWorldScripts(options.migrations)) await db.exec(script);
  return db;
}

/** One value from one query. */
export async function one<T = unknown>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<Record<string, T>>(sql, params);
  const row = result.rows[0];
  return row ? (Object.values(row)[0] as T) : (undefined as T);
}

/** The SQLSTATE a statement fails with, or "ok". */
export async function failsWith(db: PGlite, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params);
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

/** The SQLSTATE a whole script (several statements) fails with, or "ok". */
export async function scriptFailsWith(db: PGlite, sql: string): Promise<string> {
  try {
    await db.exec(sql);
    return "ok";
  } catch (error) {
    // A script with its own `begin` leaves the session in an aborted transaction.
    await db.exec("rollback").catch(() => {});
    return (error as { code?: string }).code ?? String(error);
  }
}

/** A fingerprint of everything the reconciliation must never touch. */
export async function untouchable(db: PGlite): Promise<string> {
  return one<string>(db, `
    select md5(
      coalesce((select string_agg(to_jsonb(i)::text, ';' order by i.id) from public.sale_items i), '') || '|' ||
      (select count(*) from public.inventory_movements)::text || '|' ||
      (select count(*) from public.legacy_stock_events)::text)`);
}
