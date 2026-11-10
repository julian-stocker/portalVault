-- ===========================================================================
-- R0189 — Rücknahme von 0189: seller_cancel_external_sale wieder in der Fassung
--         aus 0170
--
-- ACHTUNG: Das stellt die Race wieder her, die 0189 schließt (stornierter
-- Verkauf mit gebuchter Position, Deadlock mit Hold). Nur verwenden, wenn 0189
-- selbst ein Problem verursacht. Nur Staging (wo 0170 liegt). Rumpf wortgleich
-- 0170, Rechte wie auf Staging gemessen.
-- ===========================================================================

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
grant execute on function public.seller_cancel_external_sale(bigint, text, date, timestamptz) to authenticated, service_role;
