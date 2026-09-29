-- ===========================================================================
-- 0102 — DER KÄUFER SIEHT, WAS MIT SEINER BESTELLUNG PASSIERT IST
--
-- DER BEFUND, AN EINEM ECHTEN FALL
--
-- `SI-2026-001009`: zwei Anvil Rain und ein Ghost Swords, bezahlt. Zwei Tage
-- später storniert der Betrieb eine der beiden Anvil Rain und erstattet
-- 0,76 €. In der Datenbank steht das vollständig und richtig — Zeilenereignis,
-- Erstattung, Zuordnung zur Position, Gegenbewegung im Lager.
--
-- Auf dem Bestellschirm des Käufers stand weiterhin „2 × Anvil Rain — 1,52 €"
-- und als Gesamtbetrag unverändert 7,85 €. Von der Änderung erfuhr er nur
-- über eine Systemzeile im Nachrichtenbereich.
--
-- URSACHE: `my_order()` wurde zuletzt in `0039` ersetzt — vor dem gesamten
-- Commerce-Block. Es kennt Storno, Retoure und Erstattung nicht. Der
-- Verkäufer sieht es längst richtig: `admin_order()` hängt seit `0096`
-- `order_line_quantities()` an jede Position.
--
-- DIESE MIGRATION GIBT DER ZWEITEN ROLLE DIESELBEN ZAHLEN. Keine neue
-- Tabelle, keine neue Spalte, keine neue Rechnung — dieselben Helfer, die der
-- Betrieb benutzt, an dieselbe Stelle für den Käufer.
--
-- DIE URSPRÜNGLICHE POSITION WIRD NICHT UMGESCHRIEBEN. `quantity` bleibt 2
-- und `line_total` bleibt 1,52 €: so wurde bestellt, und so steht es auf der
-- Rechnung. Daneben tritt, was seither geschah — storniert 1, erstattet
-- 0,76 €, verbleibend 1. Eine Bestellhistorie, die ihre eigene Vergangenheit
-- überschreibt, ist keine.
--
-- AUCH DIE BETRÄGE STEHEN NEBENEINANDER, NICHT ÜBEREINANDER:
--
--   Ursprünglicher Gesamtbetrag   7,85 €   (orders.total_amount, unverändert)
--   Rückerstattungen             −0,76 €   (Summe order_refunds)
--   Verbleibender Betrag          7,09 €   (die Differenz, hier gerechnet)
--
-- UND DIE ZAHLUNGSART, falls `0101` sie aufgezeichnet hat. Fehlt sie — jede
-- Bestellung vor `0101` —, stehen dort NULLs und die Anzeige schweigt.
-- ===========================================================================

create or replace function public.my_order(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if (select auth.uid()) is null then
    return null;
  end if;

  select o.* into v_order
    from public.orders o
   where o.order_number = p_order_number
     and o.user_id = (select auth.uid());

  if not found then
    -- Unknown and not-yours answer the same, as everywhere else.
    return null;
  end if;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'order_number',       v_order.order_number,
      'placed_at',          v_order.placed_at,
      'paid_at',            v_order.paid_at,
      'shipped_at',         v_order.shipped_at,
      'payment_status',     v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status,
      'needs_resolution',   v_order.needs_resolution,
      'customer_email',     v_order.customer_email,
      'currency',           v_order.currency,
      'items_subtotal',     v_order.items_subtotal,
      'shipping_amount',    v_order.shipping_amount,
      'discount_amount',    v_order.discount_amount,
      'total_amount',       v_order.total_amount,
      'shipping_method',    v_order.shipping_method_name,
      -- The code as well as the label: a tracking link is built from the
      -- carrier the catalogue keys on, never from a display name somebody
      -- may rename to "DHL Paket" (ADR-0062).
      'shipping_method_code', v_order.shipping_method_code,
      'tracking_number',    v_order.tracking_number,
      'commerce_mode',      v_order.commerce_mode,
      /*
       * WAS SEITHER GESCHAH, auf Bestellebene (0102).
       *
       * `refunded_total` ist die Summe aller Erstattungen dieser Bestellung,
       * `remaining_total` die Differenz zum ursprünglichen Betrag. Beide sind
       * abgeleitet und werden nirgends gespeichert: `total_amount` bleibt,
       * was vereinbart war.
       */
      'refunded_total', coalesce((
        select sum(r.amount) from public.order_refunds r where r.order_id = v_order.id
      ), 0),
      'remaining_total', v_order.total_amount - coalesce((
        select sum(r.amount) from public.order_refunds r where r.order_id = v_order.id
      ), 0),
      /*
       * WOMIT BEZAHLT WURDE (0101). Aus dem jüngsten erfolgreichen Versuch,
       * und nur, wenn der Schnappschuss existiert — vor 0101 bezahlte
       * Bestellungen tragen hier NULL, und die Anzeige sagt dann nichts.
       */
      'payment_method', (
        select jsonb_build_object(
                 'type',   a.payment_method_type,
                 'brand',  a.card_brand,
                 'last4',  a.card_last4,
                 'wallet', a.wallet_type)
          from public.payment_attempts a
         where a.order_id = v_order.id
           and a.status = 'succeeded'
           and a.method_recorded_at is not null
         order by a.paid_at desc nulls last, a.id desc
         limit 1
      )
    ),
    -- The address as it was agreed, not as the account holds it today. This
    -- is the whole point of the snapshot (ADR-0049).
    'address', (
      select jsonb_build_object(
               'first_name', a.first_name, 'last_name', a.last_name,
               'company', a.company, 'street', a.street,
               'house_number', a.house_number, 'address_line_2', a.address_line_2,
               'postal_code', a.postal_code, 'city', a.city,
               'country_code', a.country_code, 'phone', a.phone)
        from public.order_addresses a
       where a.order_id = v_order.id and a.kind = 'shipping'
       limit 1
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sky_id', l.sky_id, 'condition', l.condition,
               'name', l.name_snapshot, 'image', l.image_snapshot,
               'series', l.series_snapshot, 'quantity', l.quantity,
               'unit_price', l.unit_price, 'line_total', l.line_total,
               /*
                * DIESELBEN MENGEN, DIE DER BETRIEB SIEHT (0095, über
                * `admin_order()` seit 0096). Kein zweiter Rechenweg: wo zwei
                * Seiten dieselbe Bestellung ansehen, dürfen sie nicht zwei
                * Antworten bekommen.
                */
               'cancelled', q.cancelled,
               'returned', q.returned,
               'fulfillable', q.fulfillable,
               'outstanding', q.outstanding,
               /*
                * Was dieser Position zugeordnet erstattet wurde. Die
                * Versandzeile einer Erstattung (`allocation_type` <> 'line')
                * gehört keiner Position und erscheint deshalb nur oben in
                * `refunded_total`.
                */
               'refunded', coalesce((
                 select sum(al.amount)
                   from public.order_refund_allocations al
                  where al.order_line_id = l.id
                    and al.allocation_type = 'line'
               ), 0))
               order by l.id)
        from public.order_lines l
        cross join lateral public.order_line_quantities(l.id) q
       where l.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.my_order(text) is
  'One order as its buyer may see it (0039, extended by 0102). Since 0102 every line also carries what happened to it — cancelled, returned, fulfillable, outstanding, and the refund allocated to it — from the same helpers the seller''s admin_order() uses, so the two sides can never disagree. The ordered quantity and the line total stay exactly as they were agreed; the order carries refunded_total and remaining_total beside its unchanged total_amount, and the payment method snapshot where 0101 recorded one.';
