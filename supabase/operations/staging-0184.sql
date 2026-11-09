-- ===========================================================================
-- STAGING — EIN LAUF FUER 0184
--            (seller_create_sale_with_details mit p_hold: einen externen
--             Verkauf auf ausdruecklichen Wunsch ohne Reservierung anlegen)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0184`, diese Datei,
-- `npm run db:migrate:staging -- 0184 --resume`.
--
-- NOCH NICHT FREIGEGEBEN. Gefahren wird sie erst nach einer eigenen Freigabe.
--
-- DIE MIGRATION IST ZEICHENGLEICH EINGEBETTET. Sie ersetzt EINE Funktion
-- (alte Signatur entfernt, neue angelegt); bricht sie ab, ist nichts angewendet.
--
-- SIE AENDERT KEINE DATEN. A2 misst vorher — jede Spalte — Verkaeufe,
-- Positionen, Erstattungen, Gebuehren, Lagerbewegungen, Journal,
-- Reservierungen, Lager, Korrekturen der Abrechnung und die Sammlung, dazu
-- die Rechte jeder Funktion (ausser der ersetzten) und jeder
-- Tabelle und jede Policy. Z1 misst nachher dasselbe und bricht ab, wenn sich
-- auch nur ein Wert bewegt hat. Z2 prueft den neuen Rumpf und die
-- unberuehrten, Z3 die Rechte.
--
-- NUR STAGING. ERWARTET: die NOTICE `0184 ok`, dann `commit`.
-- ===========================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $lauf_a$
begin
  /* A1 — der Umgebungsstempel. */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     <> 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
end
$lauf_a$;

/* A2 — Daten und Rechte, vorher gemessen. */
create temporary table hold_0184_vorher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales t) as sales,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_items t) as sale_items,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_refunds t) as sale_refunds,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_fees t) as sale_fees,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orderbook_audit t) as orderbook_audit,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.order_reservations t) as order_reservations,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.settlement_adjustments t) as settlement_adjustments,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not in ('seller_create_sale_with_details')) as funktionsrechte,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') ) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

-- ===========================================================================
-- >>> EINGEBETTET: supabase/migrations/0184_create_sale_hold_option.sql
-- ===========================================================================
-- 0184 — Einen externen Verkauf ohne sofortige Reservierung anlegen
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- WARUM
--
-- Der Dialog „Neuen externen Verkauf anlegen“ (`NewSale`) speichert über
-- `seller_create_sale_with_details`, und das reserviert seit `0110` jede
-- Figur, für die eine lose Einheit frei ist (`seller_add_sale_item` →
-- `hold_sale_item`). Für einen Verkauf, den der Betrieb aus dem CSV-Abgleich
-- nachträgt und dessen Figuren er erst prüft, soll das Lager unberührt
-- bleiben, bis er selbst reserviert oder ausbucht.
--
-- WAS DIESE MIGRATION TUT — EIN PARAMETER, SONST NICHTS
--
--   seller_create_sale_with_details(… , p_hold boolean default true)
--
-- Der Rumpf ist der aus `0110`, zeichengleich bis auf zwei Stellen:
--
--   1. `p_hold` NULL wird abgelehnt (`invalid_parameter_value`): der Modus
--      wird gesagt, nicht geraten.
--   2. In der Positionsschleife: `p_hold` true → wie bisher
--      `seller_add_sale_item` (mit dem Reservierungsversuch); false → dieselbe
--      Position direkt in `sale_items`, OHNE `hold_sale_item`.
--
-- DAS BISHERIGE VERHALTEN BLEIBT DER STANDARD. Wer `p_hold` nicht schickt —
-- jeder heutige Aufrufer: `createSaleWithDetails` (App), die Staging-Werkzeuge
-- `verify-sale-workflow`, `verify-ship-and-day`, `verify-sales-reconciliation`,
-- `ui-fixtures-ship-day`, alle mit benannten Argumenten über PostgREST —,
-- reserviert wie bisher. Keine SQL-Funktion und keine Sicht ruft diese
-- Funktion auf (geprüft: nur Kommentare in `0110`, `0113`, `0183`).
--
-- KEINE ÜBERLADUNG. Die alte Signatur (15 Argumente) wird ENTFERNT und die
-- neue (16) angelegt — in einer Transaktion. Zwei Fassungen nebeneinander
-- machten den Aufruf ohne `p_hold` für PostgREST mehrdeutig. Die Nachbedingung
-- verlangt genau EINE Funktion dieses Namens. Rechte (0065: `authenticated`,
-- nicht PUBLIC, nicht anon) und Kommentar werden neu gesetzt, weil `drop` sie
-- mitnimmt.
--
-- UNVERÄNDERT: Betriebskonto-Prüfung, Grenzen (200/20/20), die Sperrordnung
-- auf `shop_inventory`, Gebühren, Korrekturen, Auszahlung, der Index gegen
-- doppelte Bestellnummern (`0171`). Keine Lagerbewegung in beiden Modi
-- (Ausbuchen bleibt `seller_book_sale_item`). Keine Datenanweisung.
--
-- Rücknahme: `supabase/rollback/R0184_create_sale_hold_option.sql` (die
-- Fassung aus `0110`, zeichengleich; angelegte Verkäufe bleiben).
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)') is not null then
    raise exception '0184 abort: the 16-argument seller_create_sale_with_details exists — applied here already';
  end if;
  if to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text)') is null then
    raise exception '0184 needs 0065/0110: seller_create_sale_with_details(15 arguments) is missing';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'seller_create_sale_with_details') <> 1 then
    raise exception '0184 abort: more than one seller_create_sale_with_details exists — not resolved blindly';
  end if;
  -- The body 0184 replaces must be 0110's: a foreign version is not overwritten blindly.
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text)'))
     is distinct from '4aceeb7caab83b1b078fd03f39982464' then
    raise exception '0184 abort: seller_create_sale_with_details is not the body of 0110 — not overwritten blindly';
  end if;
  if to_regprocedure('public.seller_add_sale_item(bigint,text,text,text)') is null then
    raise exception '0184 needs seller_add_sale_item (0110)';
  end if;
end
$pre$;

drop function public.seller_create_sale_with_details(text, date, text, text, text, text, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, text);

create function public.seller_create_sale_with_details(
  p_channel          text,
  p_sold_at          date    default null,
  p_country          text    default null,
  p_external_ref     text    default null,
  p_buyer_ref        text    default null,
  p_note             text    default null,
  p_is_test          boolean default false,
  p_items_subtotal   numeric default 0,
  p_shipping_charged numeric default 0,
  p_discount_amount  numeric default 0,
  p_items            jsonb   default '[]'::jsonb,
  p_fees             jsonb   default '[]'::jsonb,
  p_adjustments      jsonb   default '[]'::jsonb,
  p_payout_amount    numeric default null,
  p_payout_ref       text    default null,
  p_hold             boolean default true
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id      bigint;
  v_element jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  -- 0184: the reservation mode is said, never guessed — NULL is refused, not read as either.
  if p_hold is null then
    raise exception 'p_hold must be true or false' using errcode = 'invalid_parameter_value';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_fees, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_adjustments, '[]'::jsonb)) <> 'array'
  then
    raise exception 'items, fees and adjustments must each be a json array'
      using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 200
     or jsonb_array_length(coalesce(p_fees, '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p_adjustments, '[]'::jsonb)) > 20
  then
    raise exception 'too many items, fees or adjustments in one sale'
      using errcode = 'program_limit_exceeded';
  end if;

  /*
   * DIE SPERRORDNUNG, EINMAL UND AUFSTEIGEND (0110). Siehe den Kopf dieses
   * Abschnitts. Rein lesend — `for update` nimmt die Zeilensperren, ohne
   * etwas zu verändern.
   */
  perform 1
     from public.shop_inventory i
    where i.condition = public.v1_sale_condition()
      and i.sky_id in (
        select nullif(btrim(coalesce(e->>'sky_id', '')), '')
          from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e)
    order by i.id
      for update;

  v_id := public.seller_create_sale(p_channel, p_sold_at, p_country,
                                    p_external_ref, p_buyer_ref, p_note, p_is_test);

  update public.sales
     set items_subtotal   = coalesce(p_items_subtotal, 0),
         shipping_charged = coalesce(p_shipping_charged, 0),
         discount_amount  = coalesce(p_discount_amount, 0)
   where id = v_id;

  for v_element in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every item must be a json object' using errcode = 'invalid_parameter_value';
    end if;
    -- Hält mit (0110): der Hold entsteht in seller_add_sale_item.
    if p_hold then
      perform public.seller_add_sale_item(
        v_id,
        nullif(btrim(coalesce(v_element->>'sky_id', '')), ''),
        nullif(btrim(coalesce(v_element->>'raw_name', '')), ''),
        coalesce(nullif(btrim(coalesce(v_element->>'condition', '')), ''), 'loose')
      );
    else
      /*
       * 0184: OHNE RESERVIERUNG, NUR AUF AUSDRÜCKLICHEN WUNSCH. Dieselbe
       * Position, die `seller_add_sale_item` schreibt — Platz, Figur,
       * Rohname, Zustand —, nur ohne dessen `hold_sale_item`. Dessen eigene
       * Prüfungen (Betriebskonto, Verkauf existiert, kein interner) sind
       * hier schon erfüllt: der Verkauf ist eben in dieser Transaktion
       * entstanden. Reserviert und ausgebucht wird später von Hand
       * (`seller_hold_sale_item`, `seller_book_sale_item`).
       */
      insert into public.sale_items (sale_id, position, sky_id, raw_name, condition)
      values (v_id,
              (select coalesce(max(i.position), 0) + 1 from public.sale_items i where i.sale_id = v_id),
              nullif(btrim(coalesce(v_element->>'sky_id', '')), ''),
              nullif(btrim(coalesce(v_element->>'raw_name', '')), ''),
              coalesce(nullif(btrim(coalesce(v_element->>'condition', '')), ''), 'loose'));
    end if;
  end loop;

  for v_element in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every fee must be a json object' using errcode = 'invalid_parameter_value';
    end if;
    perform public.seller_add_sale_fee(
      v_id,
      v_element->>'kind',
      (v_element->>'amount')::numeric,
      v_element->>'settled_by',
      nullif(btrim(coalesce(v_element->>'label', '')), ''),
      nullif(btrim(coalesce(v_element->>'note', '')), '')
    );
  end loop;

  for v_element in select * from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every adjustment must be a json object'
        using errcode = 'invalid_parameter_value';
    end if;
    perform public.seller_add_settlement_adjustment(
      v_id,
      p_channel,
      (v_element->>'amount')::numeric,
      nullif(btrim(coalesce(v_element->>'reason', '')), ''),
      nullif(btrim(coalesce(v_element->>'external_ref', '')), ''),
      nullif(btrim(coalesce(v_element->>'note', '')), ''),
      (nullif(btrim(coalesce(v_element->>'occurred_at', '')), ''))::date
    );
  end loop;

  if p_payout_amount is not null then
    perform public.seller_set_sale_payout(v_id, p_payout_amount, p_payout_ref, null, null);
  end if;

  return v_id;
end;
$$;

comment on function public.seller_create_sale_with_details(text, date, text, text, text, text, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, text, boolean) is
  'Creates one external sale together with its amounts, items, fees, adjustments and reported payout in a single transaction (0065). One item element per physical unit — duplicates are expected and are not collapsed. Moves NO stock: seller_book_sale_item does that. Since 0110 each figure is HELD when a loose unit is free (seller_add_sale_item); since 0184 p_hold false creates the same positions WITHOUT any hold — explicit only, NULL refused, the default stays true. Seller operator only.';

revoke all on function public.seller_create_sale_with_details(text, date, text, text, text, text, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, text, boolean) from public, anon;
grant execute on function public.seller_create_sale_with_details(text, date, text, text, text, text, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, text, boolean) to authenticated;

do $post$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'seller_create_sale_with_details') <> 1
     or to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text)') is not null then
    raise exception '0184 postcondition: not exactly one seller_create_sale_with_details (the 16-argument one)';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)')
                    and p.prosecdef
                    and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
                    and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                           from unnest(p.proconfig) c where c like 'search\_path=%')) then
    raise exception '0184 postcondition: seller_create_sale_with_details is not a security definer with an empty search_path';
  end if;
  if has_function_privilege('anon', 'public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)')
                   and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '0184 postcondition: the rights of seller_create_sale_with_details are not those of 0065';
  end if;
end
$post$;
-- <<< ENDE: supabase/migrations/0184_create_sale_hold_option.sql

/* Z0 — dieselben Messungen nachher. */
create temporary table hold_0184_nachher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales t) as sales,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_items t) as sale_items,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_refunds t) as sale_refunds,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_fees t) as sale_fees,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orderbook_audit t) as orderbook_audit,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.order_reservations t) as order_reservations,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.settlement_adjustments t) as settlement_adjustments,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not in ('seller_create_sale_with_details')) as funktionsrechte,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') ) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

do $lauf_z$
begin
  /* Z1 — kein Wert hat sich bewegt. */
  if exists (select 1 from pg_temp.hold_0184_vorher v, pg_temp.hold_0184_nachher n
              where (v.sales, v.sale_items, v.sale_refunds, v.sale_fees, v.inventory_movements, v.orderbook_audit, v.order_reservations, v.shop_inventory, v.settlement_adjustments, v.collection_items, v.funktionsrechte, v.tabellenrechte, v.policies)
                    is distinct from (n.sales, n.sale_items, n.sale_refunds, n.sale_fees, n.inventory_movements, n.orderbook_audit, n.order_reservations, n.shop_inventory, n.settlement_adjustments, n.collection_items, n.funktionsrechte, n.tabellenrechte, n.policies)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Daten, Rechte oder Policies bewegt — nichts wird angewendet';
  end if;

  /* Z2 — die neue Fassung steht, und die unberuehrten sind die alten. */
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)')) is distinct from 'ba97349be8b2a96194fde5a38460840b'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.hold_sale_item(bigint)')) is distinct from 'bf3502a3f6f5ec849a4ef22785063431'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_add_sale_item(bigint,text,text,text)')) is distinct from 'da912f44a62052d52fd6da1bd8cfdd19'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_book_sale_item(bigint)')) is distinct from '718cf1cd9a5252cc9a8b7d6916825fc3'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_create_sale(text,date,text,text,text,text,boolean)')) is distinct from 'cd36c2efcc89c1a42c85a59199683085'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_hold_sale_item(bigint)')) is distinct from 'cd2e02ee9e43f485e321c0ff49118675'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_create_sale(bigint,jsonb)')) is distinct from '75e9d24e44b2467b551e8c620f840ba0' then
    raise exception 'ABBRUCH Z2: die Fassung aus 0184 steht nicht, oder ein unberuehrter Rumpf hat sich bewegt';
  end if;

  /* Z3 — die Rechte: nur authenticated, nie anon oder PUBLIC. */
  if not (select (has_function_privilege('authenticated', to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))) or (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')) <> '1'
     or (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'seller_create_sale_with_details') <> '1' or to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text)') is not null then
    raise exception 'ABBRUCH Z3: ein Recht, die Form oder die Eindeutigkeit von seller_create_sale_with_details steht nicht wie zugesagt';
  end if;

  raise notice '0184 ok: seller_create_sale_with_details mit p_hold steht (genau eine Fassung); keine Zeile, kein Recht bewegt.';
end
$lauf_z$;

commit;
