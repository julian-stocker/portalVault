-- ===========================================================================
-- 0185 — Eine nicht zugeordnete Bestellung des CSV-Abgleichs ausdrücklich
--        einem bestehenden Verkauf zuordnen
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- WARUM
--
-- Die Analyse eines Berichts ist ein Schnappschuss. Ein Verkauf, der danach
-- angelegt oder korrigiert wurde (Verkauf 381 für 06-14518-99785), kann ihr
-- nicht mehr zugeordnet werden. Die Abgleichseite zeigt solche Verkäufe seit
-- ADR-0182 als Kandidaten; diese Funktion macht aus der Empfehlung eine
-- bestätigte Identität — so, wie die Analyse selbst Identität kennt: über die
-- Bestellnummer am Verkauf (Stufe A, `match.ts`).
--
-- WAS SIE TUT — EIN FELD
--
--   seller_recon_assign_sale(p_order_id, p_sale_id, p_expected_updated_at)
--
-- trägt die Bestellnummer der Bestellung in `sales.external_order_ref` ein,
-- setzt `updated_at`/`updated_by` und schreibt EINE Journalzeile (alt NULL →
-- neu). Figuren, Stückzahlen, Beträge, Datum, Lager, Reservierungen und die
-- Abgleichstabellen bleiben unberührt. Abweichungen zeigt danach die Karte;
-- korrigiert wird getrennt mit den bestehenden Werkzeugen.
--
-- WANN SIE ABLEHNT — alles unmittelbar vor dem Schreiben, unter Sperre:
--
--   Betriebskonto (42501); Bestellung und Verkauf gesperrt (`for update`);
--   Version des Verkaufs Pflicht und aktuell (`orderbook_guard_stale`, PT409);
--   die Bestellung: in einer nicht verworfenen Sitzung als `external_only`
--   ohne Verkauf geführt, mit Positionsliste;
--   der Verkauf: gleicher Kanal, extern, kein Test, nicht storniert;
--   eine VORHANDENE Bestellnummer wird NIE überschrieben (`ref_present`;
--   dieselbe Nummer → `exists`, nichts geschrieben);
--   die Nummer an einem anderen Verkauf des Kanals (`ref_taken`; der Index
--   aus 0171 ist der Boden);
--   der Verkauf in irgendeiner nicht verworfenen Sitzung schon einer
--   Bestellung zugeordnet (`paired`) — eine bestehende Zuordnung wird nie
--   verdrängt;
--   DIE REGEL GEGEN KONKURRENTEN AUS 0180, unverändert: ein anderer, in
--   dieser Sitzung ungepaarter Verkauf ohne Bestellnummer, ±3 Tage um das
--   Bestelldatum, mit gleicher Figur (`rival_sale`), oder eine andere
--   ungepaarte Bestellung der Sitzung, ±3 Tage um das Verkaufsdatum, mit
--   gleicher Figur (`rival_order`). Eine manuelle Freigabe einzelner
--   Konkurrenten gibt es NICHT — das wäre eine neue Sicherheitsentscheidung
--   (siehe ADR-0182, offen).
--
-- Rücknahme: `supabase/rollback/R0185_recon_assign_sale.sql` (nur die
-- Funktion; eingetragene Bestellnummern bleiben — jede steht im Journal).
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.seller_recon_assign_sale(bigint,bigint,timestamptz)') is not null then
    raise exception '0185 abort: seller_recon_assign_sale exists — applied here already';
  end if;
  if to_regclass('public.sales_recon_orders') is null or to_regclass('public.sales_recon_matches') is null
     or to_regclass('public.sales_recon_sessions') is null then
    raise exception '0185 needs 0169: the reconciliation tables are missing';
  end if;
  if to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)') is null
     or to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)') is null
     or to_regprocedure('public.can_operate_active_seller()') is null then
    raise exception '0185 needs 0062 (orderbook_log, orderbook_guard_stale) and the operator gate';
  end if;
  if to_regclass('public.sales_external_order_ref_per_channel') is null then
    raise exception '0185 needs 0171: sales_external_order_ref_per_channel is missing';
  end if;
end
$pre$;

create function public.seller_recon_assign_sale(p_order_id bigint, p_sale_id bigint, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.sales_recon_orders%rowtype;
  v_sale  public.sales%rowtype;
  v_state text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if p_expected_updated_at is null then
    raise exception 'this sale cannot be assigned (version_required)' using errcode = 'check_violation';
  end if;

  -- 1. Both rows locked, the order first — the same order every caller takes.
  select * into v_order from public.sales_recon_orders where id = p_order_id for update;
  if not found then
    raise exception 'no such report order' using errcode = 'no_data_found';
  end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'no such sale' using errcode = 'no_data_found';
  end if;

  -- 2. The order: unmatched in a session that still counts, with its lines.
  select s.state into v_state from public.sales_recon_sessions s where s.id = v_order.session_id;
  if v_state is null or v_state = 'discarded' then
    raise exception 'this sale cannot be assigned (session)' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.sales_recon_matches m
                  where m.order_id = v_order.id and m.session_id = v_order.session_id
                    and m.category = 'external_only' and m.sale_id is null) then
    raise exception 'this sale cannot be assigned (not_unmatched)' using errcode = 'check_violation';
  end if;
  if v_order.lines is null or jsonb_typeof(v_order.lines) is distinct from 'array' then
    raise exception 'this sale cannot be assigned (no_lines)' using errcode = 'check_violation';
  end if;

  -- 3. The sale: the same channel, external, real, not cancelled — and the version the operator saw.
  if v_sale.channel is distinct from v_order.channel or v_sale.order_id is not null
     or v_sale.is_test or v_sale.cancelled_at is not null then
    raise exception 'this sale cannot be assigned (sale)' using errcode = 'check_violation';
  end if;
  perform public.orderbook_guard_stale(p_sale_id, p_expected_updated_at);

  -- 4. Never overwrite: the same number is done already, another one ends it.
  if v_sale.external_order_ref = v_order.order_ref then
    return jsonb_build_object('status', 'exists', 'sale_id', v_sale.id);
  end if;
  if v_sale.external_order_ref is not null then
    raise exception 'this sale cannot be assigned (ref_present)' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.sales s2
              where s2.channel = v_order.channel and s2.external_order_ref = v_order.order_ref and s2.id <> v_sale.id) then
    raise exception 'this sale cannot be assigned (ref_taken)' using errcode = 'check_violation';
  end if;

  -- 5. An existing pairing is never displaced — in any session that still counts.
  if exists (select 1 from public.sales_recon_matches m
               join public.sales_recon_sessions s on s.id = m.session_id
              where m.sale_id = v_sale.id and m.order_id is not null and s.state <> 'discarded') then
    raise exception 'this sale cannot be assigned (paired)' using errcode = 'check_violation';
  end if;

  -- 6. 0180's rule against rivals, word for word in its predicates (sales_recon_take_check).
  if exists (select 1 from public.sales s2
              where s2.channel = v_sale.channel and s2.id <> v_sale.id and s2.order_id is null
                and not s2.is_test and s2.cancelled_at is null and s2.external_order_ref is null
                and s2.sold_at between v_order.sold_on - 3 and v_order.sold_on + 3
                and not exists (select 1 from public.sales_recon_matches m2
                                 where m2.session_id = v_order.session_id and m2.sale_id = s2.id
                                   and m2.order_id is not null)
                and exists (select 1 from public.sale_items i
                              left join public.skylanders k on k.sky_id = i.sky_id
                             where i.sale_id = s2.id
                               and exists (select 1 from jsonb_array_elements(v_order.lines) l
                                            where lower(btrim(l ->> 'name')) in (lower(btrim(i.raw_name)),
                                                                                 lower(btrim(k.name)))))) then
    raise exception 'this sale cannot be assigned (rival_sale)' using errcode = 'check_violation';
  end if;
  if v_sale.sold_at is not null and exists (
       select 1 from public.sales_recon_orders o2
        where o2.session_id = v_order.session_id and o2.id <> v_order.id
          and o2.sold_on between v_sale.sold_at - 3 and v_sale.sold_at + 3
          and jsonb_typeof(o2.lines) = 'array'
          and not exists (select 1 from public.sales_recon_matches m2
                           where m2.session_id = v_order.session_id and m2.order_id = o2.id
                             and m2.sale_id is not null)
          and exists (select 1 from jsonb_array_elements(o2.lines) l
                        join public.sale_items i on i.sale_id = v_sale.id
                        left join public.skylanders k on k.sky_id = i.sky_id
                       where lower(btrim(l ->> 'name')) in (lower(btrim(i.raw_name)), lower(btrim(k.name))))) then
    raise exception 'this sale cannot be assigned (rival_order)' using errcode = 'check_violation';
  end if;

  -- 7. The one write: the number, the version, one journal line.
  update public.sales
     set external_order_ref = v_order.order_ref, updated_at = now(), updated_by = (select auth.uid())
   where id = v_sale.id;
  perform public.orderbook_log(v_sale.id, 'sale', v_sale.id, 'update', 'external_order_ref', null, v_order.order_ref);

  return jsonb_build_object('status', 'assigned', 'sale_id', v_sale.id);
end;
$$;

comment on function public.seller_recon_assign_sale(bigint, bigint, timestamptz) is
  'Assigns an unmatched order of a reconciliation session to an EXISTING external sale (0185, ADR-0182) by writing the order number into sales.external_order_ref — nothing else: no figure, amount, date, stock, hold or reconciliation row. Under lock and the sale version (PT409): refuses a non-operator, a discarded session, an order that is not external_only, a test/cancelled/internal sale or another channel, an existing other number (never overwritten; the same number answers exists), a number on another sale, a sale paired in any counting session, and the rivals of 0180 (rival_sale, rival_order) unchanged. One orderbook_audit line. Seller operator only.';

revoke all on function public.seller_recon_assign_sale(bigint, bigint, timestamptz) from public, anon;
grant execute on function public.seller_recon_assign_sale(bigint, bigint, timestamptz) to authenticated;

do $post$
begin
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.seller_recon_assign_sale(bigint,bigint,timestamptz)')
                    and p.prosecdef
                    and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
                    and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                           from unnest(p.proconfig) c where c like 'search\_path=%')) then
    raise exception '0185 postcondition: seller_recon_assign_sale is not a security definer with an empty search_path';
  end if;
  if has_function_privilege('anon', 'public.seller_recon_assign_sale(bigint,bigint,timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.seller_recon_assign_sale(bigint,bigint,timestamptz)', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure('public.seller_recon_assign_sale(bigint,bigint,timestamptz)')
                   and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '0185 postcondition: the rights of seller_recon_assign_sale are not as promised';
  end if;
end
$post$;
