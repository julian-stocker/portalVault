-- ===========================================================================
-- ROLLBACK OF 0181 — the hand correction of workbook positions removed,
--                    0088's and 0089's sync back word for word
--
-- WHAT IT DOES: `create or replace` of
--   system_sync_legacy_sale_item(bigint, text, text, text, text)   body of 0088
-- character for character (without 0181's refusal of a corrected line),
--   system_sync_legacy_sale_group(bigint, date)                    body of 0089
-- character for character (without 0181's refusal of a hand-corrected date), and
-- drops
--   seller_correct_legacy_sale_item(bigint, text, timestamptz),
--   seller_add_legacy_sale_item(bigint, text, text, text, timestamptz),
--   seller_remove_legacy_added_item(bigint, timestamptz),
--   seller_sale_item_corrections(bigint),
--   sales_legacy_correction_sale / _item / _figure, the append-only trigger,
--   and the table sale_item_corrections.
--
-- ONLY WHILE NOTHING WAS CORRECTED. Once `sale_item_corrections` holds a row,
-- it is the only record of a workbook line's original figure; dropping it
-- would destroy exactly the evidence 0181 exists to keep. The rollback then
-- refuses and changes nothing. Positions corrected or added stay as they are
-- in any case — a rollback never rewrites sales.
--
-- ORDER: `R0182` first. While a backup function still exports the table
-- (0182), this rollback refuses — the drop would break every export.
-- ===========================================================================

do $pre$
begin
  if to_regclass('public.sale_item_corrections') is not null
     and exists (select 1 from public.sale_item_corrections) then
    raise exception 'R0181 refused: sale_item_corrections holds corrections — they are the only record of the originals';
  end if;
  -- 0182 reads the table in both backups; a SQL body records no dependency,
  -- so dropping the table under it would break every export. R0182 first.
  if exists (select 1 from pg_proc p
              where p.oid in (to_regprocedure('public.seller_business_backup()'),
                              to_regprocedure('public.system_platform_export()'))
                and strpos(p.prosrc, 'sale_item_corrections') > 0) then
    raise exception 'R0181 refused: a backup function still exports sale_item_corrections (0182) — run R0182 first';
  end if;
end
$pre$;

create or replace function public.system_sync_legacy_sale_item(
  p_item_id       bigint,
  p_raw_name      text,
  p_sky_id        text,
  p_stock_flag    text,
  p_shipped_flag  text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
begin
  select * into v_item from public.sale_items where id = p_item_id;
  if not found then
    raise exception 'sale_item % does not exist', p_item_id using errcode = 'no_data_found';
  end if;
  if v_item.source_row is null then
    raise exception 'sale_item % has no source row and is not a workbook line', p_item_id;
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;
  if v_sale.source is distinct from 'excel_order_2026' then
    raise exception 'sale % is not a workbook sale (source %)', v_sale.id, v_sale.source;
  end if;
  -- An order owns its lines through `order_lines`; a sale that belongs to one
  -- is operative history and the workbook has no say over it.
  if v_sale.order_id is not null then
    raise exception 'sale % belongs to order % and is operative', v_sale.id, v_sale.order_id;
  end if;

  update public.sale_items
     set raw_name            = p_raw_name,
         sky_id              = p_sky_id,
         legacy_stock_flag   = p_stock_flag,
         legacy_shipped_flag = p_shipped_flag,
         updated_at          = now()
   where id = p_item_id;
end;
$$;

revoke all on function public.system_sync_legacy_sale_item(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.system_sync_legacy_sale_item(bigint, text, text, text, text) to service_role;

create or replace function public.system_sync_legacy_sale_group(
  p_sale_id bigint,
  p_sold_at date
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'sale % does not exist', p_sale_id using errcode = 'no_data_found';
  end if;
  if v_sale.source is distinct from 'excel_order_2026' then
    raise exception 'sale % is not a workbook sale (source %)', p_sale_id, v_sale.source;
  end if;
  -- A sale that belongs to an order is operative history; the workbook has
  -- no say over when it happened.
  if v_sale.order_id is not null then
    raise exception 'sale % belongs to order % and is operative', p_sale_id, v_sale.order_id;
  end if;
  -- A date is what this function is for. Clearing one would be a different
  -- act with a different justification, and nobody has asked for it.
  if p_sold_at is null then
    raise exception 'sale %: refusing to clear sold_at', p_sale_id;
  end if;
  -- The business year is the whole point of the cut (ADR-0102). A workbook
  -- date outside it means the sheet was misread, not that history moved.
  if p_sold_at < date '2026-01-01' then
    raise exception 'sale %: % is before the business cut', p_sale_id, p_sold_at;
  end if;

  update public.sales
     set sold_at = p_sold_at, updated_at = now()
   where id = p_sale_id;
end;
$$;

revoke all on function public.system_sync_legacy_sale_group(bigint, date) from public, anon, authenticated;
grant execute on function public.system_sync_legacy_sale_group(bigint, date) to service_role;

drop function if exists public.seller_correct_legacy_sale_item(bigint, text, timestamptz);
drop function if exists public.seller_add_legacy_sale_item(bigint, text, text, text, timestamptz);
drop function if exists public.seller_remove_legacy_added_item(bigint, timestamptz);
drop function if exists public.seller_sale_item_corrections(bigint);
drop function if exists public.sales_legacy_correction_item(public.sale_items);
drop function if exists public.sales_legacy_correction_figure(text);
drop function if exists public.sales_legacy_correction_sale(bigint, timestamptz);
drop table if exists public.sale_item_corrections;
drop function if exists public.sale_item_corrections_append_only();
