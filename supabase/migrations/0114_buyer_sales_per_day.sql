-- ===========================================================================
-- 0114 — WIE VIELE VERKÄUFE EIN KÄUFER AN EINEM TAG HAT
--
-- ADDITIV UND AUSSCHLIESSLICH LESEND. Eine ersetzte Funktion, sonst nichts:
-- keine Spalte, kein Index, kein Trigger, kein Constraint, keine Zeile
-- geschrieben. Ein Rollback ist der `seller_sales()`-Block aus `0113`.
--
-- ---------------------------------------------------------------------------
-- WARUM DAFÜR EINE MIGRATION NÖTIG IST
--
-- Das Verkaufsbuch soll das Datum einfärben, wenn ein Käufer am selben Tag
-- mehrere Verkäufe hat — ein Hinweis darauf, dass sich die Pakete
-- zusammenlegen lassen. Dafür fehlt die Tatsache, und sie ist nicht
-- herleitbar:
--
--   `buyer_repeat`  sagt „hat hier schon einmal gekauft". Das ist auch für
--                   zwei Käufe in verschiedenen Monaten wahr und beantwortet
--                   die Frage nach dem TAG nicht.
--   `buyer_key`     wäre die Antwort, verlässt aber `seller_sales()` nicht —
--                   und soll es nicht: er enthält `orders.user_id`.
--   `buyer_label`   ist ein Anzeigename. Zwei Marktplatzkonten können
--                   denselben tragen, und danach zu gruppieren würde zwei
--                   Menschen zu einem machen. Ausdrücklich ausgeschlossen.
--
-- Also wird die Zahl dort gerechnet, wo der Schlüssel schon liegt, und nur
-- die Zahl geht hinaus. Die Alternative wäre, den Schlüssel auszuliefern und
-- im Browser zu gruppieren — mehr Datenpreisgabe für dasselbe Ergebnis.
--
-- ---------------------------------------------------------------------------
-- WAS SICH ÄNDERT, UND WAS NICHT
--
-- Eine Fensterfunktion in der bestehenden `repeats`-CTE, ein Durchreichen in
-- `marked`, ein Feld in der Projektion. Rumpf im Übrigen Zeichen für Zeichen
-- aus `0113`.
--
--   UNVERÄNDERT: `buyer_repeat` und seine Identitätsregeln · die Reihenfolge
--   (`sale_day desc, daily_index desc, id desc`) · jede Zählung · `is_open` ·
--   `is_incomplete` · jede Geldableitung · Filter und Summen · `seller_sale()`.
--
-- Dieselbe Identität wie `buyer_repeat`, also auch dieselben Ausschlüsse: ein
-- stornierter und ein als Test klassifizierter Verkauf liegen gar nicht im
-- Fenster (`buyers`-CTE) und zählen in keiner Richtung. Die Markierung ist
-- rein visuell — sie legt nichts zusammen und verschickt nichts.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingung
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sales'
                    and column_name = 'sale_day') then
    raise exception '0114 setzt 0113 voraus: sales.sale_day fehlt';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 1. Das Verkaufsbuch, um eine Zahl reicher
-- ---------------------------------------------------------------------------
create or replace function public.seller_sales(
  p_year    integer default null,
  p_month   integer default null,
  p_search  text    default null,
  p_undated boolean default false,
  p_scope   text    default 'all',      -- 'all' | 'internal' | 'external'
  p_open_payout boolean default false,
  p_status  text    default 'normal'    -- 'normal' | 'incomplete' | 'test' | 'any'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text; v_num text; v_status text; v_rows jsonb; v_sum jsonb; v_class jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  v_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'normal');
  if v_status not in ('normal', 'incomplete', 'open', 'test', 'any') then
    raise exception 'unknown orderbook status filter' using errcode = 'check_violation';
  end if;

  v_q := nullif(btrim(coalesce(p_search, '')), '');
  v_num := replace(coalesce(v_q, ''), ',', '.');   -- German decimals, nothing else

  with base as (
    select s.*,
           -- The customer-facing side, from whichever system owns it.
           case when s.order_id is not null then o.items_subtotal   else s.items_subtotal   end as c_subtotal,
           case when s.order_id is not null then o.shipping_amount  else s.shipping_charged end as c_shipping,
           case when s.order_id is not null then o.discount_amount  else s.discount_amount  end as c_discount,
           -- 0113. Die Spalte, nicht die Ableitung: `sale_day_of()` ist der
           -- eine Ort, an dem der Geschäftstag entsteht, und der Trigger
           -- hält die Spalte daran.
           s.sale_day as effective_date,
           o.order_number, o.payment_status, o.fulfillment_status,
           /*
            * WER GEKAUFT HAT — ZWEI FELDER, ZWEI BEDEUTUNGEN (0113).
            *
            * `buyer_user_id` ist das Einzige, womit interne Bestellungen
            * abgeglichen werden: die SkyIsles-Konto-ID. Ein Gastkauf hat
            * keine, und das bleibt so — ein Abgleich über Namen oder
            * E-Mail-Adresse wäre eine Vermutung mit Folgen.
            *
            * `buyer_label` ist reine Anzeige. Für einen externen Verkauf die
            * Referenz, die der Betreiber auf dem Marktplatz nachsieht; für
            * eine Bestellung der Name, an den das Paket ging, eingefroren
            * beim Kauf. Er wird NIE zum Abgleichen benutzt.
            */
           o.user_id as buyer_user_id,
           case when s.order_id is not null
                then nullif(btrim(coalesce(a.first_name, '') || ' '
                                  || coalesce(a.last_name, '')), '')
                else nullif(btrim(coalesce(s.buyer_ref, '')), '')
           end as buyer_label,
           coalesce(a.country_code, s.destination_country_code) as country,
           case when s.order_id is not null
                then (select count(*) from public.order_lines l where l.order_id = s.order_id)
                else (select count(*) from public.sale_items i where i.sale_id = s.id) end as item_count,
           case when s.order_id is not null
                then coalesce((select sum(r.amount) from public.order_refunds r where r.order_id = s.order_id), 0)
                else coalesce((select sum(r.amount) from public.sale_refunds r where r.sale_id = s.id), 0) end as refunded,
           -- 0062. Disjoint halves of the same fee table: a shipping
           -- label is in exactly one of them, so no amount is counted twice.
           coalesce((select sum(f.amount) from public.sale_fees f
                      where f.sale_id = s.id and f.kind <> 'shipping_label'), 0) as fees_total,
           coalesce((select sum(f.amount) from public.sale_fees f
                      where f.sale_id = s.id and f.kind = 'shipping_label'), 0) as label_total,
           public.sale_expected_payout(s.id) as expected_payout,
           -- 0063. The one definition, called rather than repeated.
           public.sale_is_test(s.id) as classified_test
      from public.sales s
      left join public.orders o on o.id = s.order_id
      left join public.order_addresses a on a.order_id = s.order_id and a.kind = 'shipping'
  ),
  /*
   * WER DERSELBE KÄUFER IST (0113, Entscheidung B).
   *
   * Eng und ausdrücklich: die Konto-ID für eine Bestellung, Quelle PLUS
   * Benutzername für einen externen Verkauf. Kein Name, keine E-Mail, keine
   * Adresse, und keine Verknüpfung zweier Quellen.
   *
   * `buyer_key IS NULL` heißt „nicht zuordenbar" und nicht „neu": ein
   * Gastkauf ohne Konto und ein externer Verkauf ohne Benutzernamen fallen
   * aus dem Fenster, statt einander zu Wiederholungskäufern zu machen.
   *
   * STORNIERT UND TEST FALLEN GANZ HERAUS (B-2, B-3). Nicht nur als
   * „vorheriger Kauf": sie werden auch selbst nie markiert. Ein stornierter
   * Verkauf ist kein Kauf, in keiner Richtung.
   */
  buyers as (
    select b.id, b.sale_day, b.daily_index,
           case when b.order_id is not null
                then case when b.buyer_user_id is null then null
                          else 'skyisles:' || b.buyer_user_id::text end
                else case when nullif(btrim(coalesce(b.buyer_ref, '')), '') is null then null
                          else b.channel || ':' || lower(btrim(b.buyer_ref)) end
           end as buyer_key
      from base b
     where b.cancelled_at is null
       and not b.classified_test
  ),
  /*
   * DIE REIHENFOLGE IST DIE DES BILDSCHIRMS, RÜCKWÄRTS GELESEN.
   *
   * `(sale_day, daily_index, id)` aufsteigend, mit NULLS FIRST — weil das
   * Verkaufsbuch absteigend mit NULLS LAST sortiert und ein undatierter
   * Verkauf dort unten steht. Eine Liste, zwei Richtungen; wäre es hier
   * anders, stünde ein grünes Häkchen über dem Kauf, der es erzeugt hat.
   *
   * Das Fenster läuft über ALLE Verkäufe, nicht über die gefilterte Seite:
   * der erste Kauf im Januar macht den im Oktober zum Wiederholungskauf,
   * auch wenn nur Oktober angezeigt wird.
   */
  repeats as (
    select b.id,
           row_number() over (partition by b.buyer_key
                              order by b.sale_day asc nulls first,
                                       b.daily_index asc nulls first,
                                       b.id asc) > 1 as buyer_repeat,
           /*
            * WIE VIELE VERKÄUFE DIESER KÄUFER AN DIESEM TAG HAT (0114).
            *
            * Dieselbe Identität wie `buyer_repeat` — Konto-ID innen, Quelle
            * plus Benutzername aussen —, nur anders gefenstert: nicht „der
            * wievielte Kauf überhaupt", sondern „wie viele an diesem einen
            * Tag". Dafür genügt `buyer_repeat` nicht: es ist auch für zwei
            * Käufe in verschiedenen Monaten wahr.
            *
            * EIN VERKAUF OHNE TAG HAT KEINEN TAGESNACHBARN. Ohne den `case`
            * würde `partition by (buyer_key, NULL)` alle undatierten Käufe
            * desselben Käufers in einen Topf werfen und sie als gemeinsam
            * verschickbar markieren — über einen Tag, den keiner von ihnen
            * hat.
            *
            * Der Schlüssel selbst verlässt die Funktion nicht; nur die Zahl.
            */
           case when b.sale_day is null then 1
                else count(*) over (partition by b.buyer_key, b.sale_day)
           end as buyer_day_count
      from buyers b
     where b.buyer_key is not null
  ),
  marked as (
    select b.*,
           coalesce(r.buyer_repeat, false) as buyer_repeat,
           /* Kein Schlüssel, kein Nachbar: eine Gruppe von einem. */
           coalesce(r.buyer_day_count, 1) as buyer_day_count,
           /*
            * UNVOLLSTÄNDIG, and the two halves of the ledger answer it
            * differently because different systems own their facts.
            *
            * INTERNAL. Commerce owns everything that matters, so the only
            * thing this can report is a projection that disagrees with it: a
            * sale registered for an order that is not paid, one whose order
            * has no payment time to date it by, or one whose order has no
            * lines. An ordinary paid sandbox or live order is COMPLETE — the
            * Orderbuch's own optional extras being absent says nothing.
            *
            * EXTERNAL. A missing date, always. Plus, for a hand-made sale
            * only, two states that mean "this was started and not finished":
            * no items, and money still sitting at the 0/0 that
            * `seller_create_sale` writes as a placeholder. An imported sale is
            * held to neither, for the same reason as a purchase: its contents
            * and its amounts came from the workbook and cannot be completed
            * from this screen.
            *
            * A missing REPORTED PAYOUT is not here and must not be: the
            * marketplace pays late by design, and `Auszahlung offen` is its
            * own filter.
            */
           (case when b.order_id is not null
                 then b.payment_status is distinct from 'paid'
                   or b.effective_date is null
                   or b.item_count = 0
                 else b.effective_date is null
                   or (b.source = 'manual'
                       and (b.item_count = 0
                            or (coalesce(b.items_subtotal, 0) = 0
                                and coalesce(b.shipping_charged, 0) = 0)))
            end) as is_incomplete,
           /*
            * OFFEN — what is still to be DONE, which is not the same as what
            * can be BOOKED (0072).
            *
            * An internal sale is never open: commerce moved the stock when
            * the order was paid. A cancelled order is never open: nothing
            * left the shelf and nothing has to. A workbook sale is open only
            * if 0071 released it — the other 271 stay frozen, which is the
            * same refusal `seller_book_sale_item` makes.
            *
            * The item test asks for neither a movement NOR a `settled_at`,
            * and no longer asks for a `sky_id`. A portal in a shipped parcel
            * cannot be booked and is plainly not dealt with either; it
            * becomes dealt with by being settled. Same reasoning as 0068 on
            * the Einkauf side.
            */
           (b.cancelled_at is null
            and b.order_id is null
            and (b.source <> 'excel_order_2026' or b.stock_released_at is not null)
            and exists (select 1
                          from public.sale_items i
                         where i.sale_id = b.id
                           and not public.sale_item_is_closed(i))) as is_open,
           /*
            * THREE COUNTS, AND THEY ARE THREE (0072).
            *
            *   outbooked  a real `sale_external` movement exists. This and
            *              only this is `Ausgebucht`.
            *   settled    finished WITHOUT a movement: a non-catalog article,
            *              or a line the workbook marked `L = "-"` — shipped,
            *              deliberately not taken from the shelf.
            *   open       item_count minus both.
            *
            * `settled` is never added to `outbooked`. A settled position did
            * not leave figure inventory, and the tick in the ledger means
            * exactly that it did.
            */
           (select count(*) from public.sale_items i
             where i.sale_id = b.id
               and i.movement_id is not null and i.return_movement_id is null
               and i.return_announced_at is null and i.returned_at is null)::integer
             as outbooked_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and i.return_movement_id is not null)::integer
             as restocked_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and i.settled_at is not null)::integer as settled_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and i.not_shipped_at is not null)::integer
             as not_shipped_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and public.sale_item_is_closed(i))::integer as closed_count
      from base b
      left join repeats r on r.id = b.id
  ),
  filtered as (
    select b.* from marked b
     where (case when coalesce(p_undated, false)
                 then b.effective_date is null
                 else (p_year  is null or extract(year  from b.effective_date) = p_year)
                  and (p_month is null or extract(month from b.effective_date) = p_month)
            end)
       and (p_scope = 'all'
            or (p_scope = 'internal' and b.order_id is not null)
            or (p_scope = 'external' and b.order_id is null))
       and (not coalesce(p_open_payout, false) or b.reported_payout_amount is null)
  ),
  hits as (
    select f.*,
           (select jsonb_agg(jsonb_build_object('id', i.id, 'position', i.position,
                     'name', coalesce(k.name, i.raw_name, i.sky_id)) order by i.position)
              from public.sale_items i
              left join public.skylanders k on k.sky_id = i.sky_id
              left join public.series se on se.code = k.series_code
             where i.sale_id = f.id and v_q is not null
               and (i.raw_name ilike '%'||v_q||'%' or k.name ilike '%'||v_q||'%'
                 or i.sky_id ilike '%'||v_q||'%' or se.label ilike '%'||v_q||'%')) as match_items
      from filtered f
  ),
  searched as (
    select h.* from hits h
     where v_q is null
        or h.match_items is not null
        -- An internal sale matches on its own order lines, too.
        or (h.order_id is not null and exists (
              select 1 from public.order_lines l
               left join public.skylanders k on k.sky_id = l.sky_id
               left join public.series se on se.code = k.series_code
              where l.order_id = h.order_id
                and (l.name_snapshot ilike '%'||v_q||'%' or k.name ilike '%'||v_q||'%'
                  or l.sky_id ilike '%'||v_q||'%' or se.label ilike '%'||v_q||'%')))
        or to_char(h.effective_date, 'DD.MM.YYYY') ilike '%'||v_q||'%'
        or h.effective_date::text        ilike '%'||v_q||'%'
        or coalesce(h.c_subtotal, 0)::text ilike '%'||v_num||'%'
        or coalesce(h.expected_payout, 0)::text ilike '%'||v_num||'%'
        or coalesce(h.order_number, '')  ilike '%'||v_q||'%'
        or coalesce(h.external_order_ref, '') ilike '%'||v_q||'%'
        or coalesce(h.buyer_ref, '')     ilike '%'||v_q||'%'
        -- 0113. Auch der Käufername einer Bestellung ist auffindbar; bisher
        -- war die Zeile über ihren Käufer gar nicht zu suchen.
        or coalesce(h.buyer_label, '')   ilike '%'||v_q||'%'
        or coalesce(h.note, '')          ilike '%'||v_q||'%'
        or h.channel                     ilike '%'||v_q||'%'
  ),
  matched as (
    select r.* from searched r
     where case v_status
             when 'normal'     then not r.classified_test
             when 'incomplete' then not r.classified_test and r.is_incomplete
             when 'open'       then not r.classified_test and r.is_open
             when 'test'       then r.classified_test
             else true
           end
  ),
  -- One statement, for the same reason the Einkauf ledger is one: the page and
  -- the counts are two aggregates over two CTEs of the same query.
  page as (
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'channel', m.channel, 'order_id', m.order_id, 'order_number', m.order_number,
      'sold_at', m.effective_date, 'shipped_at', m.shipped_at,
      -- 0113. Der Platz im Tag, und wie viele Verkäufe dieser Tag hat.
      'daily_index', m.daily_index,
      'payment_status', m.payment_status, 'fulfillment_status', m.fulfillment_status,
      'country', m.country, 'item_count', m.item_count,
      'items_subtotal', m.c_subtotal, 'shipping_charged', m.c_shipping,
      'discount_amount', m.c_discount, 'refunded', m.refunded,
      'expected_payout', m.expected_payout,
      'reported_payout', m.reported_payout_amount,
      'payout_difference', case when m.reported_payout_amount is null then null
                                else round(m.reported_payout_amount - m.expected_payout, 2) end,
      'buyer_ref', m.buyer_ref, 'external_order_ref', m.external_order_ref,
      -- 0113. Anzeige und Wiederkehr — beides nie zum Abgleichen benutzt.
      'buyer_label', m.buyer_label, 'buyer_repeat', m.buyer_repeat,
      'buyer_day_count', m.buyer_day_count,
      'fees_total', m.fees_total, 'label_total', m.label_total,
      'source', m.source, 'note', m.note,
      -- The concurrency token an editor reads and sends back (0062).
      'updated_at', m.updated_at,
      'is_test', m.classified_test, 'is_incomplete', m.is_incomplete,
      'is_open', m.is_open,
      'cancelled_at', m.cancelled_at,
      'stock_released_at', m.stock_released_at,
      'outbooked_count', m.outbooked_count,
      'restocked_count', m.restocked_count,
      'settled_count', m.settled_count,
      'not_shipped_count', m.not_shipped_count,
      'closed_count', m.closed_count,
      'open_count', m.item_count - m.closed_count,
      'match_items', m.match_items)
      -- 0113. Höchster Platz oben (D-1). `id` bleibt der letzte Ausweg: ein
      -- undatierter Verkauf hat keinen Platz, und zwei davon brauchen
      -- trotzdem eine feste Reihenfolge.
      order by m.effective_date desc nulls last,
               m.daily_index desc nulls last,
               m.id desc), '[]'::jsonb) as page_rows,
    jsonb_build_object(
      'sale_count', count(*),
      'item_count', coalesce(sum(m.item_count), 0),
      'gross',      coalesce(sum(coalesce(m.c_subtotal,0) + coalesce(m.c_shipping,0) - coalesce(m.c_discount,0)), 0),
      'refunded',   coalesce(sum(m.refunded), 0),
      'fees_total',   coalesce(sum(m.fees_total), 0),
      'label_total',  coalesce(sum(m.label_total), 0),
      'expected_payout', coalesce(sum(m.expected_payout), 0),
      'reported_payout', coalesce(sum(m.reported_payout_amount), 0),
      'open_payouts', count(*) filter (where m.reported_payout_amount is null),
      'mismatched',   count(*) filter (where m.reported_payout_amount is not null
                                         and round(m.reported_payout_amount - m.expected_payout, 2) <> 0)) as page_summary
  from matched m
  ),
  counts as (
    select jsonb_build_object(
             'normal',     count(*) filter (where not r.classified_test),
             'incomplete', count(*) filter (where not r.classified_test and r.is_incomplete),
             'open',       count(*) filter (where not r.classified_test and r.is_open),
             'test',       count(*) filter (where r.classified_test)) as classification
      from searched r
  )
  select page.page_rows, page.page_summary, counts.classification
    into v_rows, v_sum, v_class
    from page cross join counts;

  return jsonb_build_object('sales', v_rows, 'summary', v_sum,
                            'classification', v_class);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_missing text; v_count integer;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_sales';
  if v_def is null then
    raise exception '0114 unvollständig: seller_sales() fehlt';
  end if;

  -- Die neue Zahl ist da.
  if position('buyer_day_count' in v_def) = 0 then
    raise exception '0114 unvollständig: seller_sales() projiziert buyer_day_count nicht';
  end if;

  /*
   * UND ALLES, WAS BLEIBEN MUSSTE, IST GEBLIEBEN.
   *
   * Diese Migration ersetzt eine 200-zeilige Funktion, um eine Zahl
   * hinzuzufügen. Was dabei UNBEMERKT verschwinden könnte, ist gefährlicher
   * als das, was offensichtlich dazukommt — also wird jedes tragende Merkmal
   * namentlich nachgesehen.
   */
  select string_agg(needle, ', ') into v_missing
    from unnest(array[
      'buyer_repeat', 'buyer_label',
      'skyisles:', 'lower(btrim(b.buyer_ref))',
      'asc nulls first', 'm.daily_index desc nulls last',
      'as is_open', 'as is_incomplete', 'closed_count', 'expected_payout',
      'cancelled_at is null', 'not b.classified_test'
    ]) as needle
   where position(needle in v_def) = 0;
  if v_missing is not null then
    raise exception '0114 Befund: seller_sales() hat Merkmale verloren: %', v_missing;
  end if;

  -- Genau eine Overload, wie zuvor.
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_sales';
  if v_count <> 1 then
    raise exception '0114 Befund: % Overloads von seller_sales(), erwartet 1', v_count;
  end if;
end;
$$;
