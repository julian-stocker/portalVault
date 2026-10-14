-- ===========================================================================
-- 0119 — DER ANZEIGENAME ERREICHT DAS EINKAUFSBUCH
--
-- `0117` hat `skylanders.display_name_override` gefüllt, damit „Wii U Spiel"
-- nicht länger der Name von drei verschiedenen Spielen ist. Das Einkaufsbuch
-- liest die Spalte nicht. Es liest `coalesce(s.name, i.raw_name, i.sky_id)`
-- und zeigt damit den ROHEN Katalognamen — einen lebenden Wert aus der
-- falschen Spalte.
--
-- Das war kein Snapshot-Verhalten. Ein Snapshot wäre `purchase_items.raw_name`,
-- und für eine über die Oberfläche erfasste Position ist der NULL.
--
-- ---------------------------------------------------------------------------
-- DIE RANGFOLGE, VERBINDLICH ENTSCHIEDEN
--
--   1. s.display_name_override    der aktuelle, eindeutige Anzeigename
--   2. s.name                     der rohe Katalogname
--   3. i.raw_name                 der historische Snapshot der Quelle
--   4. i.sky_id                   der letzte Ausweg
--
-- Warum der Snapshot NICHT zuerst steht: er ist Provenienz, nicht Anzeige.
-- Stünde er vorn, trügen die 919 importierten Positionen weiter ihren
-- mehrdeutigen Arbeitsmappennamen, und genau das sollte `0117` beenden. Er
-- bleibt in der Datenbank, bleibt durchsuchbar, und `seller_purchase` gibt ihn
-- unverändert als eigenes Feld `raw_name` an die Detailseite — dort gehört die
-- Herkunftsangabe hin.
--
-- ---------------------------------------------------------------------------
-- WAS SICH NICHT ÄNDERT
--
-- KEINE Zeile in `purchase_items` wird umgeschrieben. KEINE in `purchases`.
-- KEINE in `skylanders`. Diese Migration schreibt keine Daten — sie ersetzt
-- zwei Funktionskörper, und beide sind `stable`.
--
-- `0117` und `0118` werden nicht angefasst.
--
-- Die beiden Rümpfe stammen Zeichen für Zeichen aus `0116`. Geändert sind
-- genau drei Stellen:
--
--   1. seller_purchase        · das Feld `name` der Positionsliste
--   2. seller_orderbook_ledger · das Feld `name` in `match_items`
--   3. seller_orderbook_ledger · die Suche kennt `display_name_override`
--
-- Filter, Summen, Faktor, `is_open`, `is_incomplete`, die Sortierung und jeder
-- Zähler sind unverändert. `create or replace` behält beide Signaturen und
-- damit beide Rechtelisten; die `revoke`/`grant`-Zeilen unten wiederholen den
-- Zustand ausdrücklich, statt sich auf ihn zu verlassen.
--
-- ---------------------------------------------------------------------------
-- WARUM DIE SUCHE MITMUSS
--
-- Die Ledger-Suche prüfte `i.raw_name`, `s.name`, `i.sky_id` und `se.label`.
-- Ein Betreiber, der den Namen sucht, den der Bildschirm ihm zeigt, fand
-- nichts, sobald dieser Name aus `display_name_override` kam. Der historische
-- Rohname bleibt dabei suchbar — beides, nicht eines davon.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'display_name_override') then
    raise exception '0119 setzt die redaktionelle Spalte voraus: skylanders.display_name_override fehlt';
  end if;

  -- Beide Funktionen müssen in der Fassung vorliegen, aus der dieser Rumpf
  -- stammt. Sonst ersetzt `create or replace` eine andere Version als die
  -- geprüfte, und der Unterschied wäre unbemerkt.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_purchase';
  if v_def is null then
    raise exception '0119 Abbruch: public.seller_purchase fehlt';
  end if;
  if position('coalesce(s.name, i.raw_name)' in v_def) = 0 then
    raise exception '0119 Abbruch: seller_purchase liegt nicht in der 0116-Fassung vor (erwartete coalesce-Kette nicht gefunden)';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_orderbook_ledger';
  if v_def is null then
    raise exception '0119 Abbruch: public.seller_orderbook_ledger fehlt';
  end if;
  if position('coalesce(s.name, i.raw_name, i.sky_id)' in v_def) = 0 then
    raise exception '0119 Abbruch: seller_orderbook_ledger liegt nicht in der 0116-Fassung vor';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'seller_orderbook_ledger') <> 1 then
    raise exception '0119 Abbruch: seller_orderbook_ledger ist mehrfach überladen';
  end if;

  raise notice '0119: Vorbedingungen erfüllt. % Katalogzeilen tragen einen Anzeigenamen.',
    (select count(*) from public.skylanders where display_name_override is not null);
end;
$$;


-- ---------------------------------------------------------------------------
-- 1. Die Detailseite eines Einkaufs
--
-- Rumpf aus `0116`. Eine Zeile geändert: `name` löst jetzt den Anzeigenamen
-- auf. `raw_name` bleibt als eigenes Feld daneben.
-- ---------------------------------------------------------------------------
create or replace function public.seller_purchase(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'purchase', to_jsonb(p) - 'created_by' - 'updated_by',
    'value', to_jsonb(val),
    'factor', case when val.known_value > 0 then round(p.total_cost / val.known_value, 4) end,
    /*
     * DER TAG, ALS LISTE (0116) — wortgleich mit `seller_sale` seit 0113.
     *
     * Die Oberfläche soll „nach oben" nicht raten müssen: `day_order` nennt
     * jeden belegten Platz des Tages mit der Einkaufs-ID dahinter, absteigend
     * wie auf dem Bildschirm. Eine Lücke — ein Einkauf, der sein Datum
     * gewechselt hat — ist damit sichtbar statt erschlossen.
     *
     * `to_jsonb(p)` oben bringt `daily_index` und die Kostenaufteilung schon
     * mit; hier kommt nur dazu, was aus den NACHBARN folgt.
     */
    'daily_index_count', case when p.purchased_at is null then 0 else (
      select count(*) from public.purchases d where d.purchased_at = p.purchased_at) end,
    'day_order', case when p.purchased_at is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'daily_index', d.daily_index)
                       order by d.daily_index desc)
        from public.purchases d
       where d.purchased_at = p.purchased_at and d.daily_index is not null), '[]'::jsonb) end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'position', i.position, 'sky_id', i.sky_id,
        'name', coalesce(s.display_name_override, s.name, i.raw_name, i.sky_id),
        'raw_name', i.raw_name,
        'series_code', s.series_code, 'condition', i.condition, 'state', i.state,
        -- One field for the screen: frozen when frozen, live when live.
        'market_price', coalesce(i.market_price_snapshot, s.market_price),
        'price_is_frozen', i.market_price_snapshot is not null,
        'market_price_snapshot_at', i.market_price_snapshot_at,
        'movement_id', i.movement_id,
        'legacy_condition_flag', i.legacy_condition_flag,
        'legacy_booked_flag', i.legacy_booked_flag,
        'note', i.note
      ) order by i.position, i.id)
      from public.purchase_items i
      left join public.skylanders s on s.sky_id = i.sky_id
     where i.purchase_id = p.id), '[]'::jsonb)
  ) into v
  from public.purchases p
  cross join lateral public.purchase_market_value(p.id) val
  where p.id = p_id;

  return v;
end;
$$;

revoke all on function public.seller_purchase(bigint) from public, anon;
grant execute on function public.seller_purchase(bigint) to authenticated;

comment on function public.seller_purchase(bigint) is
  'One purchase with its value, its day order and its items (0053, fields added in 0116, display name in 0119). The item field `name` resolves display_name_override → skylanders.name → raw_name → sky_id; `raw_name` travels beside it so the historical snapshot stays visible instead of being replaced. Reads only.';


-- ---------------------------------------------------------------------------
-- 2. Das Einkaufsbuch
--
-- Rumpf aus `0116`. Zwei Zeilen geändert: der Name in `match_items` und die
-- Positionssuche. Jeder Filter, jede Summe und jede Sortierung unverändert.
-- ---------------------------------------------------------------------------
create or replace function public.seller_orderbook_ledger(
  p_year    integer default null,
  p_month   integer default null,
  p_search  text    default null,
  p_undated boolean default false,
  p_status  text    default 'normal'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text;
  v_num    text;
  v_status text;
  v_rows   jsonb;
  v_sum    jsonb;
  v_class  jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  v_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'normal');
  if v_status not in ('normal', 'incomplete', 'open', 'test', 'any') then
    raise exception 'unknown orderbook status filter' using errcode = 'check_violation';
  end if;

  v_q := nullif(btrim(coalesce(p_search, '')), '');
  /*
   * German decimals. The owner types `67,02`; the column holds `67.02`. Only
   * the separator is translated — no rounding, no tolerance, no nearest-match.
   */
  v_num := replace(coalesce(v_q, ''), ',', '.');

  with filtered as (
    select p.*, v.known_value, v.known_items, v.total_items, v.booked_items,
           /*
            * DIE DREI ENDEN, DIE 0115/0116 UNTERSCHEIDBAR MACHEN.
            *
            * `showcase` ist physisch da und zählt voll in den Wert (D3);
            * `damaged` und `missing` zählen 0 EUR (D4) und sind damit im
            * Nennwert gar nicht mehr sichtbar — als ZAHL müssen sie es
            * bleiben, sonst sieht der Betrieb nicht, warum sein Faktor
            * gestiegen ist.
            */
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.state = 'damaged')::integer as damaged_items,
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.state = 'missing')::integer as missing_items,
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.state = 'showcase')::integer as showcase_items,
           /*
            * OFFEN ALS ZAHL, NICHT ALS REST.
            *
            * Hier stand `total_items - booked_items - settled_items` in der
            * Projektion, und das war seit `0069` falsch: eine beschädigte
            * oder fehlende Position ist weder gebucht noch `settled`, also
            * zählte sie als offen — während `is_open` daneben sie korrekt
            * ausschloss. Zahl und Wahrheitswert widersprachen sich. Jetzt
            * fragen beide dasselbe.
            */
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.movement_id is null
               and d.state in ('ordered', 'arrived'))::integer as open_items,
           /*
            * SETTLED, counted here and not in `purchase_market_value` (0070).
            *
            * That function returns a typed row, and widening it would mean
            * dropping and recreating it plus everything that reads it. This
            * is one scalar subquery over the same rows, needed by one caller.
            *
            * It is NOT added to `booked_items`. A settled portal owns no
            * movement, and `Eingebucht` means a movement exists — that is the
            * whole rule this release was written to restore.
            */
           (select count(*) from public.purchase_items s
             where s.purchase_id = p.id and s.state = 'settled')::integer as settled_items,
           case when v.known_value > 0 then round(p.total_cost / v.known_value, 4) end as factor,
           /*
            * UNVOLLSTÄNDIG, derived here and stored nowhere.
            *
            * A missing date, for every source — that is the thirteen `#REF!`
            * groups and anything the owner enters without an invoice to hand.
            * And a hand-made purchase with nothing in it: money recorded,
            * contents not, which is unfinished work rather than a parcel.
            *
            * The item rule is `manual` only. An imported group's contents are
            * the workbook's; nothing here can add to them, so listing one as
            * work outstanding would be listing something nobody can finish.
            */
           (p.purchased_at is null
            or (p.source = 'manual' and v.total_items = 0)) as is_incomplete,
           /*
            * OFFEN — an action is outstanding, not a fact. Derived too.
            *
            * A `reconciled_legacy` row is NOT outstanding: the historical
            * stock figure already contains those units, and the booking
            * function refuses that state outright. That is why a workbook
            * line the owner never ticked is absent here — and why 0067 moved
            * the five undelivered parcels to `ordered` rather than widening
            * this test to reach them.
            *
            * WHAT CHANGED IN 0068: `sky_id is not null` is gone.
            *
            * It was here because this expression mirrored
            * `seller_book_purchase_item` exactly, and that function needs a
            * catalog figure. But "can this be booked into figure inventory"
            * and "is there anything left to do with this" are two questions,
            * and a trophy and two portals in an undelivered parcel are where
            * they come apart: nobody can book them, and they are plainly not
            * dealt with either.
            *
            * Hiding them let a parcel report itself finished while three of
            * its items were still in the post — the false "nothing to do"
            * this axis exists to prevent.
            *
            * The BUTTON is a separate decision and is unchanged: `canCheckIn`
            * still requires a `sky_id`, so nothing offers an `Einbuchen` the
            * database would refuse.
            *
            * Independent of `Unvollständig`: a purchase can be fully recorded
            * and still have a parcel on the desk, and an incomplete one can
            * have nothing left to book.
            */
           exists (select 1
                     from public.purchase_items i
                    where i.purchase_id = p.id
                      and i.movement_id is null
                      and i.state in ('ordered', 'arrived')) as is_open
      from public.purchases p
      cross join lateral public.purchase_market_value(p.id) v
     where (case when coalesce(p_undated, false)
                 then p.purchased_at is null
                 else (p_year  is null or extract(year  from p.purchased_at) = p_year)
                  and (p_month is null or extract(month from p.purchased_at) = p_month)
            end)
  ),
  hits as (
    select f.*,
           (select jsonb_agg(jsonb_build_object(
                     'id', i.id, 'position', i.position,
                     'name', coalesce(s.display_name_override, s.name,
                                      i.raw_name, i.sky_id))
                   order by i.position)
              from public.purchase_items i
              left join public.skylanders s on s.sky_id = i.sky_id
              left join public.series se on se.code = s.series_code
             where i.purchase_id = f.id
               and v_q is not null
               and (i.raw_name ilike '%' || v_q || '%'
                 or s.name     ilike '%' || v_q || '%'
                 or s.display_name_override ilike '%' || v_q || '%'
                 or i.sky_id   ilike '%' || v_q || '%'
                 or se.label   ilike '%' || v_q || '%')) as match_items
      from filtered f
  ),
  searched as (
    select h.*
      from hits h
     where v_q is null
        or h.match_items is not null
        -- Every date comparison yields NULL for an undated purchase, which is
        -- not true, so it simply does not match on date — and still matches on
        -- cost, note, source or any item inside it.
        or to_char(h.purchased_at, 'DD.MM.YYYY') ilike '%' || v_q  || '%'
        or h.purchased_at::text                  ilike '%' || v_q  || '%'
        or h.total_cost::text                    ilike '%' || v_num || '%'
        or round(h.known_value, 2)::text         ilike '%' || v_num || '%'
        or coalesce(round(h.factor, 2)::text, '') ilike '%' || v_num || '%'
        or coalesce(h.note, '')                  ilike '%' || v_q  || '%'
        or h.source                              ilike '%' || v_q  || '%'
  ),
  /*
   * The classification filter, and the LAST one applied — which is what makes
   * the counts below meaningful. They are taken from `searched`, i.e. after
   * the year, month and search filters and before this one, so `Test 1` means
   * "one test purchase in the view you are looking at" rather than "one in the
   * database".
   */
  matched as (
    select r.* from searched r
     where case v_status
             when 'normal'     then not r.is_test
             when 'incomplete' then not r.is_test and r.is_incomplete
             when 'open'       then not r.is_test and r.is_open
             when 'test'       then r.is_test
             else true
           end
  ),
  /*
   * ONE STATEMENT, because a `with` clause belongs to the statement it is
   * attached to. The page and the counts are two aggregates over two
   * different CTEs of the same query, joined because each yields exactly one
   * row — not two queries, which would be two chances to disagree about the
   * filter.
   */
  page as (
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'purchased_at', m.purchased_at, 'total_cost', m.total_cost,
      'currency', m.currency, 'source', m.source, 'note', m.note,
      /* 0115: der Tagesplatz, die Kostenaufteilung, Plattform und Verkäufer. */
      'daily_index', m.daily_index,
      'items_cost', m.items_cost, 'shipping_cost', m.shipping_cost,
      'buyer_protection_cost', m.buyer_protection_cost,
      'platform', m.platform, 'seller_name', m.seller_name,
      'payment_method', m.payment_method,
      'external_ref', m.external_ref, 'updated_at', m.updated_at,
      'item_count', m.total_items, 'booked_count', m.booked_items,
      'settled_count', m.settled_items,
      'damaged_count', m.damaged_items, 'missing_count', m.missing_items,
      'showcase_count', m.showcase_items,
      /* Gezählt, nicht gerechnet — siehe `open_items` oben. */
      'open_count', m.open_items,
      'known_value', m.known_value, 'known_items', m.known_items,
      'factor', m.factor, 'match_items', m.match_items,
      'is_test', m.is_test, 'is_incomplete', m.is_incomplete, 'is_open', m.is_open)
      /*
        HÖCHSTER TAGESPLATZ OBEN (0116) — dieselbe Ordnung, die das
        Verkaufsbuch seit `0113` hat. `id` bleibt der letzte Ausweg: ein
        undatierter Einkauf hat keinen Platz, und zwei davon brauchen
        trotzdem eine feste Reihenfolge.
      */
      order by m.purchased_at desc nulls last,
               m.daily_index desc nulls last,
               m.id desc), '[]'::jsonb) as page_rows,
    jsonb_build_object(
      'purchase_count', count(*),
      'item_count',     coalesce(sum(m.total_items), 0),
      'total_cost',     coalesce(sum(m.total_cost), 0),
      'known_value',    coalesce(sum(m.known_value), 0),
      'known_items',    coalesce(sum(m.known_items), 0),
      /* Die drei Enden auch in der Summe: der Betrieb soll sehen, wie viele
         Positionen seinen Faktor belasten, ohne jede Zeile zu öffnen. */
      'damaged_count',  coalesce(sum(m.damaged_items), 0),
      'missing_count',  coalesce(sum(m.missing_items), 0),
      'showcase_count', coalesce(sum(m.showcase_items), 0),
      'open_count',     coalesce(sum(m.open_items), 0),
      -- SUM over SUM. Never avg(factor).
      'factor', case when coalesce(sum(m.known_value), 0) > 0
                     then round(sum(m.total_cost) / sum(m.known_value), 4) end,
      'incomplete', coalesce(sum(m.known_items), 0) < coalesce(sum(m.total_items), 0)) as page_summary
  from matched m
  ),
  counts as (
    select jsonb_build_object(
             'normal',     count(*) filter (where not r.is_test),
             'incomplete', count(*) filter (where not r.is_test and r.is_incomplete),
             'open',       count(*) filter (where not r.is_test and r.is_open),
             'test',       count(*) filter (where r.is_test)) as classification
      from searched r
  )
  select page.page_rows, page.page_summary, counts.classification
    into v_rows, v_sum, v_class
    from page cross join counts;

  return jsonb_build_object('purchases', v_rows, 'summary', v_sum,
                            'classification', v_class);
end;
$$;

revoke all on function public.seller_orderbook_ledger(integer, integer, text, boolean, text) from public, anon;
grant execute on function public.seller_orderbook_ledger(integer, integer, text, boolean, text) to authenticated;

comment on function public.seller_orderbook_ledger(integer, integer, text, boolean, text) is
  'The orderbook page and its summary over the same CTE (0056, extended through 0116, display name in 0119). Item names resolve display_name_override → skylanders.name → raw_name → sky_id, and the item search matches the display name AND the historical raw name, so the operator finds what the screen shows and what the workbook called it. Reads only.';


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_rows bigint; v_items bigint;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_purchase';
  if position('coalesce(s.display_name_override, s.name, i.raw_name, i.sky_id)' in v_def) = 0 then
    raise exception '0119 unvollständig: seller_purchase löst den Anzeigenamen nicht auf';
  end if;
  if position('coalesce(s.name, i.raw_name)' in v_def) > 0 then
    raise exception '0119 unvollständig: seller_purchase trägt noch die alte coalesce-Kette';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_orderbook_ledger';
  if position('coalesce(s.display_name_override, s.name,' in v_def) = 0 then
    raise exception '0119 unvollständig: der Ledger löst den Anzeigenamen nicht auf';
  end if;
  if position('s.display_name_override ilike' in v_def) = 0 then
    raise exception '0119 unvollständig: die Ledger-Suche kennt den Anzeigenamen nicht';
  end if;
  if position('or i.raw_name ilike' in v_def) = 0
     and position('(i.raw_name ilike' in v_def) = 0 then
    raise exception '0119 Abbruch: die Ledger-Suche hat den historischen Rohnamen verloren';
  end if;

  -- Beide bleiben lesend und bleiben je eine Signatur.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('seller_purchase', 'seller_orderbook_ledger')
                and p.provolatile <> 's') then
    raise exception '0119 Abbruch: eine der beiden Funktionen ist nicht mehr stable';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'seller_orderbook_ledger') <> 1 then
    raise exception '0119 Abbruch: seller_orderbook_ledger ist jetzt mehrfach überladen';
  end if;

  /*
   * UND KEINE ZEILE HAT SICH BEWEGT.
   *
   * Diese Migration schreibt keine Daten. Die Zähler kosten nichts und halten
   * die Behauptung fest, statt sie zu behaupten.
   */
  select count(*) into v_rows  from public.purchases;
  select count(*) into v_items from public.purchase_items;
  if exists (select 1 from public.purchase_items
              where state = 'booked' and movement_id is null) then
    raise exception '0119 Befund: gebuchte Position ohne Lagerbewegung';
  end if;
  raise notice '0119: fertig. % Einkäufe, % Positionen — unverändert. Anzeigename aufgelöst, Rohname weiter suchbar.',
    v_rows, v_items;
end;
$$;
