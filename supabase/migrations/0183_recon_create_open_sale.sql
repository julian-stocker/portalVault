-- ===========================================================================
-- 0183 — Eine nicht zugeordnete eBay-Bestellung aus dem CSV-Abgleich als
--        offene Bestellung im Orderbuch anlegen
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- WARUM
--
-- Der April-Abgleich fand eine Bestellung, zu der SkyIsles keinen Verkauf
-- kennt (06-14518-99785). Anlegen ließ sie sich nur von Hand, Feld für Feld
-- abgetippt — und jeder Weg dorthin (`seller_create_sale_with_details`,
-- `seller_add_sale_item`) RESERVIERT freien Bestand sofort (`0110`). Für eine
-- Bestellung, deren Figuren erst noch geprüft werden, ist das falsch.
--
-- WAS DIESE MIGRATION TUT — EINE FUNKTION, NICHTS SONST
--
--   seller_recon_create_sale(p_order_id, p_pieces)
--
-- legt GENAU EINEN externen Verkauf an, dessen Kopf und Geld die Datenbank
-- SELBST aus dem gespeicherten Bericht liest (`sales_recon_orders`), nie vom
-- Aufrufer:
--
--   channel, sold_at (= sold_on), external_order_ref (= order_ref),
--   destination_country_code, items_subtotal (= items_value),
--   shipping_charged (= shipping), discount_amount 0
--
-- und nur, wenn die Summe des Berichts genau Warenwert + Versand ist — sonst
-- steckte darin ein Rabatt oder eine Gebühr, die der Bericht nicht nennt, und
-- die wird nicht erfunden. Käufer, Gebühren, Erstattungen, Auszahlung und
-- Versanddatum bleiben LEER: der Bestellbericht nennt keinen Käufer (die
-- Abgleichstabellen haben dafür keine Spalte, `0169`) und keine Gebühr; den
-- Versand bucht der Betrieb selbst. Was der Bericht zum Versand sagt, steht in
-- der Notiz, als Herkunft, nicht als Buchung.
--
-- DIE POSITIONEN: eine je Stück. Der Aufrufer nennt je Stück nur, ZU WELCHER
-- Berichtszeile es gehört (`line`, 0-basiert) und welche Katalogfigur es ist
-- (`skyId`, oder ausdrücklich null für „ohne Katalogfigur“). Der Rohname kommt
-- aus der Berichtszeile, roh (Regel 4) — der Aufrufer kann keinen Text
-- einschleusen. Je Zeile muss die Stückzahl genau ihrer Menge entsprechen, und
-- die Summe der Stückzahl des Berichts (`pieces`). Eine genannte Figur muss im
-- Katalog stehen. Welche Variante es ist, entscheidet der Betrieb in der
-- Vorschau ausdrücklich; die Datenbank rät nichts.
--
-- WAS NIE GESCHIEHT: keine Reservierung (die Positionen werden direkt
-- eingefügt, `hold_sale_item` wird NICHT gerufen), keine Lagerbewegung, keine
-- Ausbuchung, keine Gebühr, keine Erstattung, keine Zeile in den
-- Abgleichstabellen (die Analyse bleibt, was sie war). Der Verkauf ist danach
-- „Offen“ (jede Position offen, `sale_item_is_closed`) und läuft durch den
-- bestehenden Ablauf: Reservieren (`seller_hold_sale_item`), Ausbuchen
-- (`seller_book_sale_item` — bucht auch ohne Hold), Versand, Abschließen.
--
-- NUR EINMAL. Die Bestellzeile wird gesperrt (`for update`), bevor geprüft
-- wird; ein zweiter, gleichzeitiger Aufruf wartet und findet danach den
-- Verkauf. Steht die Bestellnummer schon an einem Verkauf dieses Kanals,
-- antwortet die Funktion `exists` mit dessen Nummer und legt nichts an. Der
-- Boden darunter bleibt `sales_external_order_ref_per_channel` (`0171`).
--
-- WER: nur das Betriebskonto (42501), nur eine Bestellung einer OFFENEN
-- Sitzung, die die Analyse als `external_only` ohne Verkauf geführt hat.
--
-- JOURNAL: `orderbook_audit` — der Verkauf und jede Position als `insert`.
--
-- Rücknahme: `supabase/rollback/R0183_recon_create_open_sale.sql` (entfernt
-- die Funktion; angelegte Verkäufe bleiben — sie sind Geschäftsvorfälle).
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.seller_recon_create_sale(bigint,jsonb)') is not null then
    raise exception '0183 abort: seller_recon_create_sale exists — applied here already';
  end if;
  if to_regclass('public.sales_recon_orders') is null or to_regclass('public.sales_recon_matches') is null
     or to_regclass('public.sales_recon_sessions') is null then
    raise exception '0183 needs 0169: the reconciliation tables are missing';
  end if;
  if to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)') is null
     or to_regprocedure('public.can_operate_active_seller()') is null
     or to_regprocedure('public.v1_sale_condition()') is null then
    raise exception '0183 needs 0062 (orderbook_log), the operator gate and v1_sale_condition()';
  end if;
  if to_regclass('public.sales_external_order_ref_per_channel') is null then
    raise exception '0183 needs 0171: sales_external_order_ref_per_channel is missing';
  end if;
end
$pre$;

create function public.seller_recon_create_sale(p_order_id bigint, p_pieces jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order    public.sales_recon_orders%rowtype;
  v_state    text;
  v_existing bigint;
  v_lines    integer;
  v_qty      integer;
  v_line     jsonb;
  v_idx      integer;
  v_piece    jsonb;
  v_sky      text;
  v_country  text;
  v_sale     bigint;
  v_item     bigint;
  v_pos      integer := 0;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  -- 1. The order, LOCKED before anything is decided: a second call waits here.
  select * into v_order from public.sales_recon_orders where id = p_order_id for update;
  if not found then
    raise exception 'no such report order' using errcode = 'no_data_found';
  end if;
  select s.state into v_state from public.sales_recon_sessions s where s.id = v_order.session_id;
  if v_state is distinct from 'open' then
    raise exception 'this order cannot be created (session_not_open)' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.sales_recon_matches m
                  where m.order_id = v_order.id and m.session_id = v_order.session_id
                    and m.category = 'external_only' and m.sale_id is null) then
    raise exception 'this order cannot be created (not_unmatched)' using errcode = 'check_violation';
  end if;
  if v_order.channel = 'skyisles' then
    raise exception 'this order cannot be created (internal_channel)' using errcode = 'check_violation';
  end if;

  -- 2. Once only: the number already on a sale of this channel → that sale, nothing created.
  select s.id into v_existing from public.sales s
   where s.channel = v_order.channel and s.external_order_ref = v_order.order_ref
   order by s.is_test, s.id limit 1;
  if v_existing is not null then
    return jsonb_build_object('status', 'exists', 'sale_id', v_existing);
  end if;

  -- 3. The report must carry what is taken over, and agree with itself.
  if v_order.lines is null or jsonb_typeof(v_order.lines) is distinct from 'array'
     or jsonb_array_length(v_order.lines) = 0 then
    raise exception 'this order cannot be created (no_lines)' using errcode = 'check_violation';
  end if;
  if v_order.sold_on is null or v_order.sold_on < date '2000-01-01' or v_order.sold_on > current_date + 1 then
    raise exception 'this order cannot be created (date)' using errcode = 'check_violation';
  end if;
  if v_order.items_value is null or v_order.shipping is null or v_order.total is null
     or round(v_order.total, 2) <> round(v_order.items_value + v_order.shipping, 2) then
    -- A difference would be a discount or a fee the report does not name: not invented.
    raise exception 'this order cannot be created (money)' using errcode = 'check_violation';
  end if;
  v_lines := jsonb_array_length(v_order.lines);
  -- Step by step, never a cast inside an OR: SQL does not promise an evaluation order.
  v_qty := 0;
  for v_line in select value from jsonb_array_elements(v_order.lines) loop
    if jsonb_typeof(v_line) is distinct from 'object' or jsonb_typeof(v_line -> 'quantity') is distinct from 'number'
       or nullif(btrim(coalesce(v_line ->> 'name', '')), '') is null then
      raise exception 'this order cannot be created (lines)' using errcode = 'check_violation';
    end if;
    if (v_line ->> 'quantity')::numeric <> floor((v_line ->> 'quantity')::numeric)
       or (v_line ->> 'quantity')::numeric < 1 then
      raise exception 'this order cannot be created (lines)' using errcode = 'check_violation';
    end if;
    v_qty := v_qty + (v_line ->> 'quantity')::integer;
  end loop;
  if v_qty is distinct from v_order.pieces then
    raise exception 'this order cannot be created (lines)' using errcode = 'check_violation';
  end if;

  -- 4. The pieces: one per unit, each naming its line, together exactly the report.
  if p_pieces is null or jsonb_typeof(p_pieces) is distinct from 'array' then
    raise exception 'pieces must be a json array' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_pieces) <> v_qty then
    raise exception 'this order cannot be created (piece_count)' using errcode = 'check_violation';
  end if;
  for v_piece in select value from jsonb_array_elements(p_pieces) loop
    if jsonb_typeof(v_piece) is distinct from 'object' then
      raise exception 'this order cannot be created (piece)' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_piece -> 'line') is distinct from 'number' or not (v_piece ? 'skyId')
       or jsonb_typeof(v_piece -> 'skyId') not in ('string', 'null')
       or exists (select 1 from jsonb_object_keys(v_piece) k where k not in ('line', 'skyId')) then
      raise exception 'this order cannot be created (piece)' using errcode = 'check_violation';
    end if;
    if (v_piece ->> 'line')::numeric <> floor((v_piece ->> 'line')::numeric)
       or (v_piece ->> 'line')::numeric < 0 or (v_piece ->> 'line')::numeric > v_lines - 1 then
      raise exception 'this order cannot be created (piece)' using errcode = 'check_violation';
    end if;
    v_sky := nullif(btrim(v_piece ->> 'skyId'), '');
    if jsonb_typeof(v_piece -> 'skyId') = 'string' and v_sky is null then
      raise exception 'this order cannot be created (piece)' using errcode = 'check_violation';
    end if;
    if v_sky is not null and not exists (select 1 from public.skylanders k where k.sky_id = v_sky) then
      raise exception 'this order cannot be created (unknown_figure)' using errcode = 'check_violation';
    end if;
  end loop;
  for v_line, v_idx in select l, (o - 1)::integer from jsonb_array_elements(v_order.lines) with ordinality t(l, o) loop
    if (select count(*) from jsonb_array_elements(p_pieces) p where (p ->> 'line')::integer = v_idx)
       <> (v_line ->> 'quantity')::integer then
      raise exception 'this order cannot be created (line_quantity)' using errcode = 'check_violation';
    end if;
  end loop;

  -- 5. The sale — its head and money from the report, nothing from the caller.
  v_country := upper(nullif(btrim(coalesce(v_order.destination_country, '')), ''));
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then v_country := null; end if;
  insert into public.sales (channel, sold_at, destination_country_code, external_order_ref, buyer_ref, note,
                            source, is_test, items_subtotal, shipping_charged, discount_amount,
                            created_by, updated_by)
  values (v_order.channel, v_order.sold_on, v_country, v_order.order_ref, null,
          'Aus dem CSV-Abgleich angelegt (Sitzung ' || v_order.session_id || ', Bericht '
            || coalesce(v_order.source_file, '?') || ', Datensatz ' || coalesce(v_order.record_no::text, '?')
            || '). Laut Bericht: bezahlt ' || coalesce(to_char(v_order.paid_on, 'DD.MM.YYYY'), '–')
            || ', versendet ' || coalesce(to_char(v_order.shipped_on, 'DD.MM.YYYY'), '–')
            || coalesce(', ' || nullif(btrim(v_order.shipping_service), ''), '')
            || '. Käufer und Gebühren nennt der Bericht nicht.',
          'manual', false, round(v_order.items_value, 2), round(v_order.shipping, 2), 0,
          (select auth.uid()), (select auth.uid()))
  returning id into v_sale;
  perform public.orderbook_log(v_sale, 'sale', v_sale, 'insert', null, null, null);

  -- 6. The positions, in report order — DIRECTLY, so no hold is taken (0110's seller_add_sale_item would).
  for v_line, v_idx in select l, (o - 1)::integer from jsonb_array_elements(v_order.lines) with ordinality t(l, o) loop
    for v_piece in select value from jsonb_array_elements(p_pieces) p where (p ->> 'line')::integer = v_idx loop
      v_pos := v_pos + 1;
      insert into public.sale_items (sale_id, position, sky_id, raw_name, condition)
      values (v_sale, v_pos, nullif(btrim(v_piece ->> 'skyId'), ''), v_line ->> 'name', public.v1_sale_condition())
      returning id into v_item;
      perform public.orderbook_log(v_sale, 'sale_item', v_item, 'insert', null, null, null);
    end loop;
  end loop;

  return jsonb_build_object('status', 'created', 'sale_id', v_sale);
end;
$$;

comment on function public.seller_recon_create_sale(bigint, jsonb) is
  'Creates ONE external sale from an unmatched order of an open reconciliation session (0183): head and money read from sales_recon_orders (order number, date, country, goods value, shipping; refused unless total = goods + shipping), no buyer, no fee, no refund, no shipping date. One position per unit, each naming its report line and an explicit catalogue figure or null; raw names from the report; counts must equal the report. Positions are inserted directly: no hold, no stock movement. Locks the order row; an order number already on a sale of the channel answers exists with that sale. Audited. Seller operator only.';

revoke all on function public.seller_recon_create_sale(bigint, jsonb) from public, anon;
grant execute on function public.seller_recon_create_sale(bigint, jsonb) to authenticated;

do $post$
begin
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.seller_recon_create_sale(bigint,jsonb)')
                    and p.prosecdef
                    and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
                    and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                           from unnest(p.proconfig) c where c like 'search\_path=%')) then
    raise exception '0183 postcondition: seller_recon_create_sale is not a security definer with an empty search_path';
  end if;
  if has_function_privilege('anon', 'public.seller_recon_create_sale(bigint,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.seller_recon_create_sale(bigint,jsonb)', 'execute') then
    raise exception '0183 postcondition: the rights of seller_recon_create_sale are not as promised';
  end if;
end
$post$;
