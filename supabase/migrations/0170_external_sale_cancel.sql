-- ===========================================================================
-- 0170 — CANCELLING AN EXTERNAL SALE, AND TAKING IT BACK (ADR-0174)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- THE GAP. `sales.cancelled_at` exists since `0071`, and every stock function
-- honours it — but nothing could set it except that migration's one-off data
-- block. An external order the buyer called off had no way into the books.
-- The reconciliation finds such orders (an eBay total of 0,00 €, nothing
-- shipped); this gives the operator the safe way to record them.
--
-- TWO FUNCTIONS, BOTH SELLER-GATED, BOTH AUDITED, BOTH WITH THE CONFLICT TOKEN:
--
--   seller_cancel_external_sale(id, reason, cancelled_on, expected_updated_at)
--   seller_uncancel_external_sale(id, reason, expected_updated_at)
--
-- WHAT A CANCELLATION REFUSES
--
--   * an internal sale (commerce owns its order and its cancellation);
--   * a sale already cancelled;
--   * a historical sale RELEASED for stock work (`stock_released_at`):
--     `sales_cancelled_is_not_released` (0071) forbids the pair, and saying so
--     is better than a constraint error;
--   * any position that has ENDED: booked out (`movement_id`), returned,
--     return announced, restocked or settled. Something left the shelf or was
--     closed — that is a return or a correction, not a cancellation.
--
-- WHAT IT DOES
--
--   * releases every active external hold of the sale's positions through
--     `release_sale_item_hold` (0110): `shop_inventory.reserved` goes down,
--     and NO inventory movement is written — the goods never left;
--   * sets `cancelled_at`;
--   * writes the reason and the date into `orderbook_audit`. The reason has no
--     column of its own: the audit is where corrections are explained, and
--     it is in every backup already.
--
-- TAKING IT BACK reverses exactly that: `cancelled_at` becomes NULL, and every
-- position without an ending tries to get its hold back through
-- `hold_sale_item` (0110) — the same attempt a new sale makes. Like a new
-- sale, missing stock does not block it (a sale is a fact even when the shelf
-- is empty); the function returns, per position, what the attempt said, and
-- the caller shows it.
--
-- WHAT NEITHER DOES. No `inventory_movements` row, no change to `sale_items`
-- (a hold lives in `order_reservations`), no `legacy_stock_events`, no refund.
-- A cancelled order that WAS paid and refunded gets its refund recorded
-- separately — the two are different facts (ADR-0118).
--
-- Rollback: `supabase/rollback/R0169_0173_drop_sales_reconciliation.sql`.
-- ===========================================================================


do $pre$
begin
  if to_regprocedure('public.release_sale_item_hold(bigint)') is null
     or to_regprocedure('public.hold_sale_item(bigint)') is null then
    raise exception '0170 needs the external holds of 0110';
  end if;
  if to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)') is null
     or to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)') is null then
    raise exception '0170 needs the audit and the conflict token of 0062';
  end if;
  if to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)') is not null then
    raise exception '0170 is already applied: seller_cancel_external_sale exists';
  end if;
end
$pre$;


create or replace function public.seller_cancel_external_sale(
  p_id bigint,
  p_reason text,
  p_cancelled_on date default null,
  p_expected_updated_at timestamptz default null
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_sale public.sales;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_on date := coalesce(p_cancelled_on, current_date);
  v_item record;
  v_released integer := 0;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'a cancellation needs a reason (at most 500 characters)' using errcode = 'check_violation';
  end if;
  if v_on < date '2000-01-01' or v_on > current_date + 1 then
    raise exception 'that cancellation date is outside the plausible range' using errcode = 'check_violation';
  end if;

  select * into v_sale from public.sales where id = p_id for update;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;
  if v_sale.order_id is not null then
    raise exception 'an order is cancelled in commerce, not in the Orderbuch' using errcode = 'restrict_violation';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'this sale is already cancelled' using errcode = 'restrict_violation';
  end if;
  if v_sale.stock_released_at is not null then
    raise exception 'a sale released for stock work cannot be cancelled' using errcode = 'restrict_violation';
  end if;
  if exists (select 1 from public.sale_items i
              where i.sale_id = p_id
                and (i.movement_id is not null or i.return_movement_id is not null
                     or i.returned_at is not null or i.return_announced_at is not null
                     or i.settled_at is not null)) then
    raise exception 'a position of this sale has already ended (booked out, returned or settled)'
      using errcode = 'restrict_violation';
  end if;

  perform public.orderbook_guard_stale(p_id, p_expected_updated_at);

  for v_item in select i.id from public.sale_items i where i.sale_id = p_id order by i.id loop
    if public.release_sale_item_hold(v_item.id) = 'released' then
      v_released := v_released + 1;
    end if;
  end loop;

  update public.sales
     set cancelled_at = v_on::timestamptz, updated_at = now(), updated_by = (select auth.uid())
   where id = p_id;

  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'cancelled_at', null, v_on::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'cancel_reason', null, v_reason);
  return v_released;
end;
$$;

comment on function public.seller_cancel_external_sale(bigint, text, date, timestamptz) is
  'Cancels an external sale (0170, ADR-0174): releases its holds without any inventory movement, sets cancelled_at, audits date and reason. Refuses internal, already cancelled, released-historical sales and any sale with an ended position. Returns the number of holds released.';

revoke all on function public.seller_cancel_external_sale(bigint, text, date, timestamptz) from public, anon;
grant execute on function public.seller_cancel_external_sale(bigint, text, date, timestamptz) to authenticated;


create or replace function public.seller_uncancel_external_sale(
  p_id bigint,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_sale public.sales;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_item record;
  v_outcomes jsonb := '[]'::jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'taking back a cancellation needs a reason (at most 500 characters)' using errcode = 'check_violation';
  end if;

  select * into v_sale from public.sales where id = p_id for update;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;
  if v_sale.order_id is not null then
    raise exception 'an order is cancelled in commerce, not in the Orderbuch' using errcode = 'restrict_violation';
  end if;
  if v_sale.cancelled_at is null then
    raise exception 'this sale is not cancelled' using errcode = 'restrict_violation';
  end if;

  perform public.orderbook_guard_stale(p_id, p_expected_updated_at);

  update public.sales
     set cancelled_at = null, updated_at = now(), updated_by = (select auth.uid())
   where id = p_id;

  -- The same attempt a new sale makes; it never throws for missing stock.
  for v_item in select i.id from public.sale_items i where i.sale_id = p_id order by i.id loop
    v_outcomes := v_outcomes || jsonb_build_object('item_id', v_item.id, 'hold', public.hold_sale_item(v_item.id));
  end loop;

  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'cancelled_at', v_sale.cancelled_at::date::text, null);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'cancel_reason', 'cancellation taken back', v_reason);
  return v_outcomes;
end;
$$;

comment on function public.seller_uncancel_external_sale(bigint, text, timestamptz) is
  'Takes back the cancellation of an external sale (0170, ADR-0174): clears cancelled_at, tries to re-hold every position like a new sale does (missing stock does not block), audits the reason. Returns the hold outcome per position.';

revoke all on function public.seller_uncancel_external_sale(bigint, text, timestamptz) from public, anon;
grant execute on function public.seller_uncancel_external_sale(bigint, text, timestamptz) to authenticated;
