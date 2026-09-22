-- ===========================================================================
-- 0092 — was der Bildschirm nie erfahren hat, und ein Wareneingang in einem Klick
--
-- TEIL 1: DIE PROJEKTION HOLT DREI TATSACHEN NACH
--
-- `seller_sale()` liefert die Positionen eines Verkaufs an beide Ansichten —
-- die Detailseite und die aufgeklappte Zeile der Verkaufsliste. Zuletzt
-- angefasst wurde sie in 0063. Danach kamen drei Spalten dazu:
--
--   settled_at           0073   ohne Lagerbewegung abgeschlossen
--   not_shipped_at       0074   ging nicht mit raus, bleibt im Bestand
--   return_announced_at  0074   Retoure angekündigt, noch nicht da
--
-- Keine davon war je in der Projektion. Die Folge war still und
-- irreführend: `seller_announce_sale_item_return` schrieb `return_announced_at`
-- korrekt, der Bildschirm bekam das Feld nie zu sehen, `saleItemStatus` fiel
-- auf `movement_id is not null` zurück und zeigte weiter `Ausgebucht` mit
-- demselben Knopf. Zweimal geklickt, zweimal geschrieben (beim zweiten Mal
-- idempotent verweigert), und sichtbar passierte nichts.
--
-- TEIL 2: `seller_receive_sale_item_return`
--
-- Der Wareneingang einer Retoure bestand bisher aus zwei Aufrufen:
-- `seller_return_sale_item` setzt `returned_at`, `seller_restock_sale_item`
-- bucht +1. Fachlich ist das EIN Vorgang — „die Figur ist wieder da" —, und
-- zwei Aufrufe sind zwei Transaktionen mit einem Fenster dazwischen.
--
-- Diese Funktion bucht deshalb NICHTS selbst. Sie ruft die beiden
-- vorhandenen Funktionen auf, in einer Transaktion. Die +1 entsteht dort, wo
-- sie immer entstanden ist: in `seller_restock_sale_item` über
-- `record_inventory_movement`. Niemand fasst `shop_inventory` direkt an.
--
--   bereits eingebucht      gibt die vorhandene Bewegung zurück, schreibt nichts
--   nie ausgebucht          Ablehnung: es gibt nichts zurückzunehmen
--   historischer Verkauf    Ablehnung in `seller_restock_sale_item`
--
-- Angekündigt werden muss die Retoure dafür nicht: die Ankündigung ist der
-- normale Weg, aber eine Figur, die ohne Vorwarnung im Karton liegt, ist
-- genauso zurück.
-- ===========================================================================

create or replace function public.seller_sale(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_sale record; v_out jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_sale from public.sales where id = p_id;
  if not found then return null; end if;

  select jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'is_test', public.sale_is_test(p_id),
    'expected_payout', public.sale_expected_payout(p_id),
    'buy_in', public.sale_buy_in(p_id),
    'order', case when v_sale.order_id is null then null else (
      select jsonb_build_object('id', o.id, 'order_number', o.order_number,
        'paid_at', o.paid_at, 'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_status, 'shipped_at', o.shipped_at,
        'items_subtotal', o.items_subtotal, 'shipping_amount', o.shipping_amount,
        'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
        'currency', o.currency,
        -- Which world the order was placed in, frozen when it was placed.
        'commerce_mode', o.commerce_mode,
        'country', (select a.country_code from public.order_addresses a
                     where a.order_id = o.id and a.kind = 'shipping' limit 1),
        'refunded', coalesce((select sum(r.amount) from public.order_refunds r where r.order_id = o.id), 0),
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', l.id, 'sky_id', l.sky_id, 'name', coalesce(k.name, l.name_snapshot),
                    'series_code', k.series_code, 'condition', l.condition,
                    'quantity', l.quantity, 'unit_price', l.unit_price,
                    'line_total', l.line_total,
                    'market_price', k.market_price) order by l.id)
                  from public.order_lines l
                  left join public.skylanders k on k.sky_id = l.sky_id
                  where l.order_id = o.id), '[]'::jsonb))
      from public.orders o where o.id = v_sale.order_id) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', i.id, 'position', i.position, 'sky_id', i.sky_id,
                'name', coalesce(k.name, i.raw_name, i.sky_id), 'raw_name', i.raw_name,
                'series_code', k.series_code, 'condition', i.condition,
                'market_price', coalesce(i.market_price_snapshot, k.market_price),
                'price_is_frozen', i.market_price_snapshot is not null,
                'movement_id', i.movement_id, 'returned_at', i.returned_at,
                'return_movement_id', i.return_movement_id,
                /*
                 * Die drei Tatsachen, die 0073/0074 eingeführt haben und die
                 * diese Projektion nie mitgeliefert hat. Ohne sie sieht der
                 * Bildschirm eine angekündigte Retoure, eine erledigte und
                 * eine nicht verschickte Position nicht — er zeigt weiter
                 * `Ausgebucht` und bietet dieselbe Aktion an, während die
                 * Datenbank längst etwas anderes weiß.
                 */
                'return_announced_at', i.return_announced_at,
                'settled_at', i.settled_at,
                'not_shipped_at', i.not_shipped_at,
                'legacy_stock_flag', i.legacy_stock_flag,
                'legacy_shipped_flag', i.legacy_shipped_flag,
                'source_row', i.source_row) order by i.position)
              from public.sale_items i
              left join public.skylanders k on k.sky_id = i.sky_id
              where i.sale_id = p_id), '[]'::jsonb),
    'fees', coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.sale_fees f where f.sale_id = p_id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.sale_refunds r where r.sale_id = p_id), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.settlement_adjustments a where a.sale_id = p_id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Der Wareneingang: `returned_at` und die +1, in einer Transaktion.
-- ---------------------------------------------------------------------------
create or replace function public.seller_receive_sale_item_return(p_item_id bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_mid  bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then
    raise exception 'no such sale item' using errcode = 'no_data_found';
  end if;

  -- Schon eingebucht: dieselbe Bewegung, kein zweites Mal Bestand.
  if v_item.return_movement_id is not null then
    return v_item.return_movement_id;
  end if;

  if v_item.movement_id is null then
    raise exception 'nothing was booked out of stock for this position'
      using errcode = 'restrict_violation';
  end if;

  -- Die beiden vorhandenen Wege, in dieser Reihenfolge und in dieser
  -- Transaktion. `seller_restock_sale_item` verlangt `returned_at`.
  if v_item.returned_at is null then
    perform public.seller_return_sale_item(p_item_id, true);
  end if;
  v_mid := public.seller_restock_sale_item(p_item_id);

  return v_mid;
end;
$$;

comment on function public.seller_receive_sale_item_return(bigint) is
  'Records that a returned position physically arrived (0092): marks it returned through seller_return_sale_item and books it back through seller_restock_sale_item — which is the only path that writes a return movement of +1 via record_inventory_movement. Writes no stock itself and never touches shop_inventory directly. Idempotent: a second call returns the existing return movement and writes nothing. Refuses a position that never left stock; a historical sale is refused by the restock path.';

revoke all on function public.seller_receive_sale_item_return(bigint) from public, anon;
grant execute on function public.seller_receive_sale_item_return(bigint) to authenticated;
