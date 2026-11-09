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
