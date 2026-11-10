-- ===========================================================================
-- R0188 — Rücknahme von 0188: seller_delete_sale wieder in der Fassung aus 0110
--
-- ACHTUNG: Das stellt die Race wieder her, die 0188 schließt (Zählung ohne
-- Sperre, verwaiste Lagerbewegung möglich). Nur verwenden, wenn 0188 selbst ein
-- Problem verursacht. Der Rumpf ist wortgleich der aus 0110; die Rechte wie auf
-- Staging gemessen (PUBLIC entzogen, authenticated und service_role).
-- ===========================================================================

create or replace function public.seller_delete_sale(p_id bigint)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_booked integer; v_item bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.sales where id = p_id and order_id is not null) then
    raise exception 'an internal sale exists because an order was paid' using errcode = 'restrict_violation';
  end if;
  select count(*) into v_booked from public.sale_items
   where sale_id = p_id and (movement_id is not null or return_movement_id is not null);
  if v_booked > 0 then
    raise exception 'this sale has % item(s) with stock movements; reverse them first', v_booked
      using errcode = 'restrict_violation';
  end if;

  /*
   * Jeden aktiven Hold freigeben, bevor der Cascade die Positionen nimmt
   * (0110). Aufsteigend nach `id`, dieselbe Ordnung wie überall sonst.
   */
  for v_item in
    select i.id from public.sale_items i where i.sale_id = p_id order by i.id
  loop
    perform public.release_sale_item_hold(v_item);
  end loop;

  delete from public.sales where id = p_id;
end;
$$;

revoke all on function public.seller_delete_sale(bigint) from public, anon;
grant execute on function public.seller_delete_sale(bigint) to authenticated, service_role;
