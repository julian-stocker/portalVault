-- ===========================================================================
-- 0085 — the stock history a business reads (ADR-0102, Lager V2)
--
-- `admin_inventory_movements()` returns the ledger as it is: everything ever
-- booked, test runs included. That is right for an audit and wrong for the
-- screen an operator uses to run the shop, where a sandbox checkout from
-- last Tuesday sits between two real corrections and means nothing.
--
-- So this is a second reading of the same rows, not a second ledger.
-- `admin_inventory_movements()` is untouched and still answers the audit
-- question. Nothing is deleted, nothing is flagged, nothing is rewritten.
--
-- WHAT IS LEFT OUT, AND ON WHAT EVIDENCE
--
--   1. `initial_import`      the one legacy opening balance. See below.
--   2. fixture positions     SKY numbers from 9000 up: the rows the RLS,
--                            inventory and smoke suites book against. They
--                            are in no catalog and in no workbook.
--   3. sandbox sales         `order_reservations.movement_id` → an order
--                            whose `commerce_mode` is 'sandbox'.
--   4. sandbox returns       `order_reservations.reverted_movement_id` →
--                            the same condition (0083, 0084).
--   5. test sales & returns  `sale_items.movement_id` /
--                            `return_movement_id` → `sales.is_test`.
--
-- EVERY ONE OF THOSE IS A REFERENCE OR A CHECKED COLUMN. Not one of them
-- reads `note`. The notes say 'sandbox test order …' and 'verify-rls' and
-- would have been easier, and they are exactly what must never decide this:
-- free text has no constraint behind it, and a reader who cannot see the
-- rule cannot check it.
--
-- WHY `initial_import` IS NOT BUSINESS HISTORY
--
-- IT IS A TECHNICAL LEGACY OPENING-BALANCE IMPORT AND NOTHING ELSE. The
-- reason is not in `MOVEMENT_REASONS`, so no operator can choose it; only
-- `system_record_inventory_movement()` can write it, and only `service_role`
-- may execute that. A CHECK fixes its direction to positive and another
-- forbids it a cost basis, on the stated grounds that the legacy stock has
-- none that can be substantiated (0003).
--
-- In this database it was written by exactly one run: 218 movements on 218
-- positions, all on 2026-09-06, one per position, no actor.
--
-- It is also SUPERSEDED. `legacy_stock_events.opening_balance` now states
-- the same thing better: at 2026-01-01, reconstructed from the workbook's
-- final column, and reconciled. The two disagree on 126 of 171 shared
-- positions — correctly, because they describe different days with 2026's
-- trade in between. Showing both would put two different "opening stocks"
-- with two different dates on one card, and neither of them wrong.
--
-- THE ONE RISK, STATED: if a later migration reuses `initial_import` for
-- something an operator should see, this filter will hide it. That would be
-- the mistake of that migration, and this comment is where it is told so.
-- ===========================================================================

create or replace function public.seller_business_movements(
  p_inventory_id bigint,
  p_limit        integer default 200
)
returns table (
  id         bigint,
  delta      integer,
  reason     text,
  unit_cost  numeric,
  currency   text,
  note       text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select m.id, m.delta, m.reason, m.unit_cost, m.currency, m.note, m.created_at
      from public.inventory_movements m
      join public.shop_inventory i on i.id = m.inventory_id
     where m.inventory_id = p_inventory_id

       -- 1. The technical legacy opening balance. See the header.
       and m.reason <> 'initial_import'

       -- 2. Fixtures. The catalog's own numbering stops far below 9000, and
       --    the suites allocate from there upwards.
       and coalesce(
             nullif(regexp_replace(i.sky_id, '^SKY-', ''), '') ~ '^\d+$', false)
       and (regexp_replace(i.sky_id, '^SKY-', ''))::bigint < 9000

       -- 3. + 4. Anything a sandbox order took out or put back.
       and not exists (
         select 1
           from public.order_reservations r
           join public.orders o on o.id = r.order_id
          where o.commerce_mode = 'sandbox'
            and (r.movement_id = m.id or r.reverted_movement_id = m.id)
       )

       -- 5. Anything an Orderbuch test sale booked or returned.
       and not exists (
         select 1
           from public.sale_items si
           join public.sales s on s.id = si.sale_id
          where s.is_test
            and (si.movement_id = m.id or si.return_movement_id = m.id)
       )

     order by m.created_at desc, m.id desc
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

comment on function public.seller_business_movements(bigint, integer) is
  'The operative stock history of one position as a business reads it (0085, Lager V2): the ledger without its technical and test rows. Excluded, each by a reference or a checked column and never by a note — initial_import (the technical legacy opening-balance import, superseded by legacy_stock_events.opening_balance and never a business event), fixture positions from SKY-9000 up, movements a sandbox order took out or put back, and movements an is_test sale booked or returned. admin_inventory_movements() is unchanged and still returns everything for audit.';

revoke all on function public.seller_business_movements(bigint, integer) from public, anon;
grant execute on function public.seller_business_movements(bigint, integer) to authenticated;
