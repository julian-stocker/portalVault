/**
 * The world for 0183 (an unmatched report order becomes an open sale): the
 * reconciliation migrations up to 0180, plus what the later manual workflow
 * needs — hold, book, "open" — with the LIVE bodies of 0110 and 0075 and a
 * stand-in for the stock ledger. Shared by the PGlite test and the real
 * PostgreSQL concurrency test.
 */
import { body, RECONCILIATION_MIGRATIONS } from "./schema";

export const WITH_0180 = [...RECONCILIATION_MIGRATIONS, "0175_sales_recon_account_deletion.sql",
  "0176_sales_recon_validate_before_dedup.sql", "0178_sales_recon_comparison_and_pending.sql",
  "0179_sales_recon_ledger_proof.sql", "0180_sales_recon_selected_apply.sql"] as const;

/* What the reconciliation world lacks for the later workflow: hold, book, "open". The bodies are the live ones. */
export const WORKFLOW = `
alter table public.sale_items add column updated_at timestamptz not null default now(),
  add column market_price_snapshot numeric, add column market_price_snapshot_at timestamptz;
alter table public.skylanders add column market_price numeric;
alter table public.sales add column buy_in_factor_snapshot numeric;
alter table public.order_reservations add column converted_at timestamptz, add column movement_id bigint;
create function public.orderbook_global_factor() returns numeric language sql stable as $$ select 0.5::numeric $$;
create function public.record_inventory_movement(p_sky_id text, p_condition text, p_delta integer, p_reason text,
  p_unit_cost numeric default null, p_currency text default null, p_note text default null)
returns bigint language plpgsql as $$
declare v bigint;
begin
  update public.shop_inventory set quantity = quantity + p_delta where sky_id = p_sky_id and condition = p_condition;
  insert into public.inventory_movements (note) values (p_note) returning id into v;
  return v;
end $$;
${body("0110_external_hold_runtime.sql", "seller_hold_sale_item")}
${body("0110_external_hold_runtime.sql", "convert_sale_item_hold")}
${body("0110_external_hold_runtime.sql", "seller_book_sale_item")}
${body("0075_sales_returns_in_the_counts.sql", "sale_item_is_closed")}
`;

