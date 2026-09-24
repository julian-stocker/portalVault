-- ---------------------------------------------------------------------------
-- 0096 — Zwei Projektionen, die vorhandene Tatsachen dorthin tragen, wo sie
--        fehlen. Keine neue Tabelle, keine neue Spalte, keine neue Regel.
--
-- 1. `seller_sale()` liefert für eine interne Bestellung die Positionen der
--    BESTELLUNG. Was aus einer Position inzwischen geworden ist, lieferte es
--    nicht — also zeigte das Orderbuch für jede bezahlte Zeile denselben
--    Haken „Verschickt ✓", auch für eine, die über 0095 storniert war. Die
--    Wahrheit steht seit 0095 in `order_line_events`; sie wird hier nur
--    mitgeliefert, über dieselbe Funktion, die `admin_order()` schon benutzt.
--
-- 2. `admin_order()` liefert Zwischensumme, Versand, Rabatt und Erstattungen,
--    aber nichts über die Kosten des Verkaufs. Die stehen seit 0059 in
--    `sale_fees` und sind vom Bestellschirm aus nicht erreichbar: beide
--    Tabellen haben `revoke all ... from authenticated`, jeder Zugriff läuft
--    über security-definer-Funktionen. Ohne diese Projektion wären die
--    „Verkaufskosten" auf dem Bestellschirm erfunden — und Zahlen erfinden
--    ist keine Option.
--
-- Beides ist rein lesend und additiv. Bestehende Felder behalten Namen, Typ
-- und Bedeutung; ein Client, der die neuen nicht kennt, merkt nichts.
--
-- `create or replace` mit UNVERÄNDERTER Argumentliste — keine Overloads,
-- keine PGRST203. Rechte bleiben, wie sie sind.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Das Orderbuch sieht, was aus einer Bestellposition geworden ist
-- ---------------------------------------------------------------------------
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
        /*
         * DIE VIER MENGEN, DIE SEIT 0095 EXISTIEREN UND HIER GEFEHLT HABEN.
         *
         * Abgeleitet aus dem append-only `order_line_events`, nichts
         * gespeichert — dieselbe Funktion, die `admin_order()` benutzt, damit
         * beide Bildschirme dieselbe Zahl zeigen. `cancelled` und `returned`
         * können nur wachsen; ein späterer Versand überschreibt sie nicht.
         */
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', l.id, 'sky_id', l.sky_id, 'name', coalesce(k.name, l.name_snapshot),
                    'series_code', k.series_code, 'condition', l.condition,
                    'quantity', l.quantity, 'unit_price', l.unit_price,
                    'line_total', l.line_total,
                    'cancelled', q.cancelled, 'returned', q.returned,
                    'fulfillable', q.fulfillable, 'outstanding', q.outstanding,
                    'market_price', k.market_price) order by l.id)
                  from public.order_lines l
                  cross join lateral public.order_line_quantities(l.id) q
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

comment on function public.seller_sale(bigint) is
  'One sale with everything hanging off it (0092, erweitert in 0096): sale_items for an external or imported sale, the ORDER''s lines for an internal one — since 0096 with cancelled/returned/fulfillable/outstanding from order_line_quantities(), so the ledger stops showing a cancelled position as shipped. Read-only; writes nothing.';


-- ---------------------------------------------------------------------------
-- 2. Der Bestellschirm sieht, was der Verkauf gekostet hat
--
-- `sale_fees` gehört dem Verkauf, nicht der Bestellung, und genau ein
-- Verkauf hängt an einer Bestellung (`sales.order_id`). Summiert wird nach
-- den beiden Gruppen, die der Bildschirm zeigt — Gebühren und Versandetikett
-- —, nicht Zeile für Zeile: der Schirm zeigt zwei Beträge, und mehr
-- herauszugeben wäre mehr Kundendaten als nötig.
--
-- `settled_by` wird NICHT gefiltert. `sale_expected_payout()` tut das, weil
-- es die Auszahlung des Kanals beantwortet; hier geht es um die Einnahmen
-- dieser Bestellung, und eine extern bezahlte Gebühr kostet genauso.
-- ---------------------------------------------------------------------------
create or replace function public.order_sale_costs(p_order_id bigint)
returns table (fees numeric, shipping_label numeric)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(sum(f.amount) filter (where f.kind <> 'shipping_label'), 0)::numeric,
    coalesce(sum(f.amount) filter (where f.kind =  'shipping_label'), 0)::numeric
    from public.sales s
    join public.sale_fees f on f.sale_id = s.id
   where s.order_id = p_order_id;
$$;

comment on function public.order_sale_costs(bigint) is
  'What selling one order cost, from sale_fees of the sale it belongs to (0096): fees (payment, marketplace, other) and the shipping label, as two sums. Internal: no client role holds EXECUTE — it is reached from admin_order(), which has already decided who may ask. Unlike sale_expected_payout() it does not filter settled_by: this answers what the order earned, not what the channel transfers.';

revoke all on function public.order_sale_costs(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. `admin_order()` reicht die beiden Kostensummen mit durch
--
-- Unveraendert bis auf den einen neuen Schluessel `costs`. Kein zusaetzlicher
-- Aufruf von der Seite aus: der Bestellschirm laedt diese Funktion ohnehin.
-- ---------------------------------------------------------------------------
create or replace function public.admin_order(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_result jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select o.* into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'order', jsonb_build_object(
      'order_number',       v_order.order_number,
      'placed_at',          v_order.placed_at,
      'paid_at',            v_order.paid_at,
      'shipped_at',         v_order.shipped_at,
      'cancelled_at',       v_order.cancelled_at,
      'payment_status',     v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status,
      'needs_resolution',   v_order.needs_resolution,
      'customer_email',     v_order.customer_email,
      'items_subtotal',     v_order.items_subtotal,
      'shipping_amount',    v_order.shipping_amount,
      'discount_amount',    v_order.discount_amount,
      'total_amount',       v_order.total_amount,
      'shipping_method',    v_order.shipping_method_name,
      'shipping_method_code', v_order.shipping_method_code,
      'tracking_number',    v_order.tracking_number,
      'is_guest',           v_order.user_id is null,
      'commerce_mode',      v_order.commerce_mode,
      'stock_reverted',     exists (
                              select 1 from public.order_events se
                               where se.order_id = v_order.id
                                 and se.event_type = 'sandbox_stock_reverted')
    ),
    'address', (
      select jsonb_build_object(
               'first_name', a.first_name, 'last_name', a.last_name,
               'company', a.company, 'street', a.street,
               'house_number', a.house_number, 'address_line_2', a.address_line_2,
               'postal_code', a.postal_code, 'city', a.city,
               'country_code', a.country_code, 'phone', a.phone)
        from public.order_addresses a
       where a.order_id = v_order.id
       limit 1
    ),
    -- `image` and `series` come from the LINE, never from `skylanders`: the
    -- order says what was sold, not what it is called today. Since 0095 the
    -- line also carries its id — the two new RPCs address a position, not an
    -- article — and the quantities derived from `order_line_events`.
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id,
               'sky_id', l.sky_id, 'condition', l.condition,
               'name', l.name_snapshot, 'image', l.image_snapshot,
               'series', l.series_snapshot, 'quantity', l.quantity,
               'unit_price', l.unit_price, 'line_total', l.line_total,
               'cancelled', q.cancelled, 'returned', q.returned,
               'fulfillable', q.fulfillable, 'outstanding', q.outstanding,
               'cancellable', q.cancellable, 'returnable', q.returnable,
               -- Die technische Tatsache, aus der der Server den Bestandsausgang
               -- bestimmt. Die Oberfläche zeigt sie nicht als Auswahl an.
               'was_booked_out', exists (
                 select 1 from public.order_reservations r
                  where r.order_id = l.order_id
                    and r.inventory_id = l.inventory_id
                    and r.movement_id is not null))
               order by l.id)
        from public.order_lines l
        cross join lateral public.order_line_quantities(l.id) q
       where l.order_id = v_order.id
    ), '[]'::jsonb),
    'line_events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_line_id', ev.order_line_id, 'kind', ev.kind,
               'quantity', ev.quantity, 'stock_outcome', ev.stock_outcome,
               'occurred_at', ev.occurred_at, 'reason', ev.reason)
               order by ev.id)
        from public.order_line_events ev
       where ev.order_id = v_order.id
    ), '[]'::jsonb),
    'withdrawal', (
      select jsonb_build_object('id', w.id, 'received_at', w.received_at,
                                'handled_at', w.handled_at,
                                'consumer_name', w.consumer_name)
        from public.withdrawal_requests w
       where w.order_id = v_order.id
       order by w.received_at asc
       limit 1
    ),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'amount', r.amount, 'occurred_at', r.occurred_at,
               'reason', r.reason, 'provider_refund_id', r.provider_refund_id,
               'allocations', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'type', al.allocation_type, 'order_line_id', al.order_line_id,
                          'quantity', al.quantity, 'amount', al.amount) order by al.id)
                   from public.order_refund_allocations al
                  where al.refund_id = r.id), '[]'::jsonb))
               order by r.id)
        from public.order_refunds r
       where r.order_id = v_order.id
    ), '[]'::jsonb),
    'fulfillable_total', public.order_fulfillable_total(v_order.id),
    -- Was der Verkauf gekostet hat (0096). Zwei Summen aus `sale_fees`, dem
    -- Modell, das das Orderbuch seit 0059 benutzt — nichts Geschaetztes und
    -- nichts Erfundenes. Ohne einen erfassten Posten sind beide 0.
    'costs', (select jsonb_build_object('fees', c.fees, 'shipping_label', c.shipping_label)
                from public.order_sale_costs(v_order.id) c),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_type', e.event_type, 'actor_kind', e.actor_kind,
               'created_at', e.created_at, 'payload', e.payload)
               order by e.id)
        from public.order_events e
       where e.order_id = v_order.id
    ), '[]'::jsonb),
    'mail', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', m.kind,
               'state', public.order_mail_effective_state(m.state, m.claimed_at),
               'sent_at', m.sent_at,
               'attempts', m.attempts,
               'last_error', m.last_error,
               'updated_at', m.updated_at)
               order by m.kind)
        from public.order_mail m
       where m.order_id = v_order.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.admin_order(text) is
  'One order for the seller''s screen (0095, erweitert in 0096): header, address, lines with the quantities derived from order_line_events, the line events themselves, withdrawal, refunds with their allocations, the fulfillable total, the sale costs from sale_fees, the event log and the mail state. Read-only.';
