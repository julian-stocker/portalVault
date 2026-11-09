-- ===========================================================================
-- STAGING — EIN LAUF FUER 0186
--            (eine Bestellnummer trotz konkurrierender Verkaeufe zuordnen,
--             wenn der Betrieb jeden Konkurrenten einzeln ausgeschlossen hat)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0186`, diese Datei,
-- `npm run db:migrate:staging -- 0186 --resume`.
--
-- NOCH NICHT FREIGEGEBEN. Gefahren wird sie erst nach einer eigenen Freigabe.
--
-- DIE MIGRATION IST ZEICHENGLEICH EINGEBETTET. Sie legt EINE Funktion an;
-- bricht sie ab, ist nichts angewendet. `sales_recon_take_check` (0180) und
-- `seller_recon_assign_sale` (0185) bleiben Wort fuer Wort (Z2).
--
-- SIE AENDERT KEINE DATEN. A2 misst vorher — jede Spalte — Verkaeufe,
-- Positionen, Erstattungen, Gebuehren, Lagerbewegungen, Journal,
-- Reservierungen, Lager, Abgleichszuordnungen und -bestellungen und die
-- Sammlung, dazu die Rechte jeder Funktion (ausser der neuen) und jeder
-- Tabelle und jede Policy. Z1 misst nachher dasselbe und bricht ab, wenn sich
-- auch nur ein Wert bewegt hat. Z2 prueft den neuen Rumpf und die
-- unberuehrten, Z3 die Rechte.
--
-- NUR STAGING. ERWARTET: die NOTICE `0186 ok`, dann `commit`.
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
create temporary table confirm_0186_vorher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales t) as sales,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_items t) as sale_items,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_refunds t) as sale_refunds,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_fees t) as sale_fees,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orderbook_audit t) as orderbook_audit,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.order_reservations t) as order_reservations,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_matches t) as sales_recon_matches,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_orders t) as sales_recon_orders,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not in ('seller_recon_confirm_order_ref')) as funktionsrechte,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') ) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

-- ===========================================================================
-- >>> EINGEBETTET: supabase/migrations/0186_recon_order_ref_with_exclusions.sql
-- ===========================================================================
-- 0186 — Eine Bestellnummer trotz konkurrierender Verkäufe zuordnen, wenn der
--        Betrieb JEDEN Konkurrenten einzeln ausgeschlossen hat
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- WARUM
--
-- Die Regel aus `0180` sperrt die Übernahme einer Bestellnummer, sobald ein
-- anderer, ungepaarter Verkauf mit gleicher Figur im Fenster liegt
-- (`rival_sale`) oder eine andere ungepaarte Bestellung mit gleicher Figur
-- (`rival_order`). Das ist richtig, solange niemand hingesehen hat. Bei den
-- April-Verkäufen 155 und 157 liegen die Konkurrenten 158 und 160 im Mai; der
-- Betrieb kann sie prüfen und ausschließen — aber keine Funktion nimmt diese
-- Prüfung an. Diese Migration fügt GENAU DAS hinzu, als eigene Funktion:
--
--   seller_recon_confirm_order_ref(p_order_id, p_sale_id, p_expected_updated_at,
--                                  p_excluded jsonb, p_note text)
--
-- WARUM EINE EIGENE FUNKTION. `sales_recon_take_check` (0180) und
-- `seller_recon_assign_sale` (0185) bleiben Wort für Wort, wie sie sind: der
-- Sammelabgleich und die einfache Zuordnung kennen keine Übersteuerung, und
-- niemand kann sie über einen neuen Parameter abschwächen. Wer Konkurrenten
-- ausschließt, ruft ausdrücklich DIESE Funktion — und sie verlangt, dass es
-- Konkurrenten gibt (`no_rivals` sonst: dann gelten 0180/0185).
--
-- BEIDE ZUORDNUNGSWEGE:
--
--   a) eine NICHT zugeordnete Bestellung (`external_only`, ohne Verkauf) und
--      ein bestehender Verkauf — wie 0185;
--   b) ein von der Analyse sicher GEPAARTER Verkauf ohne Bestellnummer
--      (`exact`/`deviating`, genau dieses Paar) — wie die Übernahme der
--      Nummer in 0180, ohne die Abgleichstabellen anzufassen.
--
-- DER AUSSCHLUSS IST KONKRET, NICHT GLOBAL. `p_excluded` nennt jeden
-- Konkurrenten einzeln: `{"sales": [{"id": 158, "updatedAt": "…"}],
-- "orders": [{"id": 412}]}`. Die Datenbank ermittelt die Konkurrenten unter
-- Sperre NEU — mit den Prädikaten aus `0180`, Wort für Wort — und schreibt nur,
-- wenn die ausgeschlossene Menge GENAU die aktuelle ist und jeder Verkauf noch
-- den Stand hat, den der Betrieb gesehen hat. Ein neuer, ein verschwundener
-- oder ein inzwischen geänderter Konkurrent: `rivals_changed`, nichts
-- geschrieben. Die Begründung (`p_note`) ist Pflicht.
--
-- WAS UNVERÄNDERT GILT: Betriebskonto; Sperren auf Bestellung und Verkauf;
-- Version des Verkaufs Pflicht (PT409); eine vorhandene Nummer wird nie
-- überschrieben (`ref_present`, gleiche Nummer → `exists`); eine anderswo
-- vergebene abgelehnt (`ref_taken`, Index aus 0171); ein in einer zählenden
-- Sitzung mit einer ANDEREN Bestellung gepaarter Verkauf wird nie verdrängt
-- (`paired`). Die Konkurrenten selbst bleiben unberührt.
--
-- WAS GESCHRIEBEN WIRD: `sales.external_order_ref` (+ `updated_at`,
-- `updated_by`), eine Journalzeile für die Nummer und je ausgeschlossenem
-- Konkurrenten eine Journalzeile (`field = 'rival_excluded'`: welcher
-- Konkurrent mit welchem Stand, für welche Bestellnummer, mit welcher
-- Begründung; wer und wann trägt das Journal selbst). Keine Figur, kein
-- Betrag, kein Datum, kein Lager, keine Reservierung, keine Abgleichszeile.
--
-- Rücknahme: `supabase/rollback/R0186_recon_order_ref_with_exclusions.sql`.
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)') is not null then
    raise exception '0186 abort: seller_recon_confirm_order_ref exists — applied here already';
  end if;
  if to_regclass('public.sales_recon_orders') is null or to_regclass('public.sales_recon_matches') is null
     or to_regclass('public.sales_recon_sessions') is null then
    raise exception '0186 needs 0169: the reconciliation tables are missing';
  end if;
  if to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)') is null
     or to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)') is null
     or to_regprocedure('public.can_operate_active_seller()') is null then
    raise exception '0186 needs 0062 (orderbook_log, orderbook_guard_stale) and the operator gate';
  end if;
  if to_regclass('public.sales_external_order_ref_per_channel') is null then
    raise exception '0186 needs 0171: sales_external_order_ref_per_channel is missing';
  end if;
end
$pre$;

create function public.seller_recon_confirm_order_ref(
  p_order_id bigint, p_sale_id bigint, p_expected_updated_at timestamptz, p_excluded jsonb, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order   public.sales_recon_orders%rowtype;
  v_sale    public.sales%rowtype;
  v_state   text;
  v_paired  boolean;
  v_note    text := btrim(coalesce(p_note, ''));
  v_x       jsonb;
  v_ack_s   jsonb := '{}'::jsonb;  -- acknowledged rival sales: id → updatedAt as given
  v_ack_o   bigint[] := '{}';      -- acknowledged rival orders
  v_cur_s   bigint[];
  v_cur_o   bigint[];
  v_id      bigint;
  v_seen    timestamptz;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if p_expected_updated_at is null then
    raise exception 'this order number cannot be confirmed (version_required)' using errcode = 'check_violation';
  end if;
  if v_note = '' or length(v_note) > 500 then
    raise exception 'this order number cannot be confirmed (note)' using errcode = 'check_violation';
  end if;

  -- The exclusions, read strictly: sales with the version seen, orders by id, nothing else.
  if p_excluded is null or jsonb_typeof(p_excluded) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_excluded) k where k not in ('sales', 'orders'))
     or jsonb_typeof(coalesce(p_excluded -> 'sales', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_excluded -> 'orders', '[]'::jsonb)) is distinct from 'array' then
    raise exception 'this order number cannot be confirmed (exclusions)' using errcode = 'check_violation';
  end if;
  for v_x in select value from jsonb_array_elements(coalesce(p_excluded -> 'sales', '[]'::jsonb)) loop
    if jsonb_typeof(v_x) is distinct from 'object' or jsonb_typeof(v_x -> 'id') is distinct from 'number'
       or jsonb_typeof(v_x -> 'updatedAt') is distinct from 'string'
       or exists (select 1 from jsonb_object_keys(v_x) k where k not in ('id', 'updatedAt')) then
      raise exception 'this order number cannot be confirmed (exclusions)' using errcode = 'check_violation';
    end if;
    if v_ack_s ? (v_x ->> 'id') then
      raise exception 'this order number cannot be confirmed (exclusions)' using errcode = 'check_violation';
    end if;
    v_ack_s := v_ack_s || jsonb_build_object(v_x ->> 'id', v_x ->> 'updatedAt');
  end loop;
  for v_x in select value from jsonb_array_elements(coalesce(p_excluded -> 'orders', '[]'::jsonb)) loop
    if jsonb_typeof(v_x) is distinct from 'object' or jsonb_typeof(v_x -> 'id') is distinct from 'number'
       or exists (select 1 from jsonb_object_keys(v_x) k where k <> 'id')
       or (v_x ->> 'id')::bigint = any (v_ack_o) then
      raise exception 'this order number cannot be confirmed (exclusions)' using errcode = 'check_violation';
    end if;
    v_ack_o := v_ack_o || (v_x ->> 'id')::bigint;
  end loop;

  -- 1. Both rows locked, the order first — the order every caller (0185 too) takes.
  select * into v_order from public.sales_recon_orders where id = p_order_id for update;
  if not found then
    raise exception 'no such report order' using errcode = 'no_data_found';
  end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'no such sale' using errcode = 'no_data_found';
  end if;

  -- 2. Which of the two ways: an unmatched order, or exactly this certain pair.
  select s.state into v_state from public.sales_recon_sessions s where s.id = v_order.session_id;
  if v_state is null or v_state = 'discarded' then
    raise exception 'this order number cannot be confirmed (session)' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.sales_recon_matches m
              where m.order_id = v_order.id and m.session_id = v_order.session_id
                and m.category = 'external_only' and m.sale_id is null) then
    v_paired := false;
  elsif exists (select 1 from public.sales_recon_matches m
                 where m.order_id = v_order.id and m.session_id = v_order.session_id
                   and m.sale_id = v_sale.id and m.category in ('exact', 'deviating')) then
    v_paired := true;
  else
    raise exception 'this order number cannot be confirmed (not_assignable)' using errcode = 'check_violation';
  end if;
  if v_order.lines is null or jsonb_typeof(v_order.lines) is distinct from 'array' then
    raise exception 'this order number cannot be confirmed (no_lines)' using errcode = 'check_violation';
  end if;

  -- 3. The sale: same channel, external, real, not cancelled — and the version the operator saw.
  if v_sale.channel is distinct from v_order.channel or v_sale.order_id is not null
     or v_sale.is_test or v_sale.cancelled_at is not null then
    raise exception 'this order number cannot be confirmed (sale)' using errcode = 'check_violation';
  end if;
  perform public.orderbook_guard_stale(p_sale_id, p_expected_updated_at);

  -- 4. Never overwrite, never twice.
  if v_sale.external_order_ref = v_order.order_ref then
    return jsonb_build_object('status', 'exists', 'sale_id', v_sale.id);
  end if;
  if v_sale.external_order_ref is not null then
    raise exception 'this order number cannot be confirmed (ref_present)' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.sales s2
              where s2.channel = v_order.channel and s2.external_order_ref = v_order.order_ref and s2.id <> v_sale.id) then
    raise exception 'this order number cannot be confirmed (ref_taken)' using errcode = 'check_violation';
  end if;

  -- 5. An existing pairing with ANOTHER order is never displaced, in any session that counts.
  if exists (select 1 from public.sales_recon_matches m
               join public.sales_recon_sessions s on s.id = m.session_id
              where m.sale_id = v_sale.id and m.order_id is not null and s.state <> 'discarded'
                and m.order_id <> v_order.id) then
    raise exception 'this order number cannot be confirmed (paired)' using errcode = 'check_violation';
  end if;

  -- 6. The rivals NOW, by 0180's predicates word for word (sales_recon_take_check).
  select coalesce(array_agg(s2.id order by s2.id), '{}') into v_cur_s
    from public.sales s2
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
                                                                      lower(btrim(k.name)))));
  select coalesce(array_agg(o2.id order by o2.id), '{}') into v_cur_o
    from public.sales_recon_orders o2
   where v_sale.sold_at is not null
     and o2.session_id = v_order.session_id and o2.id <> v_order.id
     and o2.sold_on between v_sale.sold_at - 3 and v_sale.sold_at + 3
     and jsonb_typeof(o2.lines) = 'array'
     and not exists (select 1 from public.sales_recon_matches m2
                      where m2.session_id = v_order.session_id and m2.order_id = o2.id
                        and m2.sale_id is not null)
     and exists (select 1 from jsonb_array_elements(o2.lines) l
                   join public.sale_items i on i.sale_id = v_sale.id
                   left join public.skylanders k on k.sky_id = i.sky_id
                  where lower(btrim(l ->> 'name')) in (lower(btrim(i.raw_name)), lower(btrim(k.name))));

  -- 7. Only for a pair WITH rivals: without any, 0180/0185 decide, not this exception.
  if cardinality(v_cur_s) + cardinality(v_cur_o) = 0 then
    raise exception 'this order number cannot be confirmed (no_rivals)' using errcode = 'check_violation';
  end if;
  -- 8. Exactly the rivals the operator excluded — each sale with the version seen.
  if (select coalesce(array_agg(k::bigint order by k::bigint), '{}') from jsonb_object_keys(v_ack_s) k) is distinct from v_cur_s
     or (select coalesce(array_agg(x order by x), '{}') from unnest(v_ack_o) x) is distinct from v_cur_o then
    raise exception 'this order number cannot be confirmed (rivals_changed)' using errcode = 'check_violation';
  end if;
  -- `for share`: an edit of an excluded rival running right now is waited for —
  -- its new version then refuses (rivals_changed); none can slip in before commit.
  foreach v_id in array v_cur_s loop
    select s.updated_at into v_seen from public.sales s where s.id = v_id for share;
    if v_seen is distinct from (v_ack_s ->> v_id::text)::timestamptz then
      raise exception 'this order number cannot be confirmed (rivals_changed)' using errcode = 'check_violation';
    end if;
  end loop;

  -- 9. The write: the number, the version; the journal names every exclusion.
  update public.sales
     set external_order_ref = v_order.order_ref, updated_at = now(), updated_by = (select auth.uid())
   where id = v_sale.id;
  perform public.orderbook_log(v_sale.id, 'sale', v_sale.id, 'update', 'external_order_ref', null, v_order.order_ref);
  foreach v_id in array v_cur_s loop
    perform public.orderbook_log(v_sale.id, 'sale', v_sale.id, 'update', 'rival_excluded',
      'sale ' || v_id || ' @ ' || (v_ack_s ->> v_id::text),
      v_order.order_ref || ' (' || case when v_paired then 'pair' else 'unmatched' end || ') — ' || v_note);
  end loop;
  foreach v_id in array v_cur_o loop
    perform public.orderbook_log(v_sale.id, 'sale', v_sale.id, 'update', 'rival_excluded',
      'order ' || (select o.order_ref from public.sales_recon_orders o where o.id = v_id),
      v_order.order_ref || ' (' || case when v_paired then 'pair' else 'unmatched' end || ') — ' || v_note);
  end loop;

  return jsonb_build_object('status', 'confirmed', 'sale_id', v_sale.id,
    'excluded_sales', to_jsonb(v_cur_s), 'excluded_orders', to_jsonb(v_cur_o));
end;
$$;

comment on function public.seller_recon_confirm_order_ref(bigint, bigint, timestamptz, jsonb, text) is
  'Writes an order number into sales.external_order_ref (0186, ADR-0183) for an unmatched order or exactly its certain pair WHEN rivals exist and the operator excluded EACH one: p_excluded must equal the rivals recomputed under lock by 0180''s predicates (sales with the version seen, orders by id), else rivals_changed; no rivals → no_rivals (0180/0185 decide then). Note required. Unchanged rules: operator, sale version (PT409), never overwrite (ref_present/exists), ref_taken, never displace another pairing (paired). Journal: the number and one rival_excluded line per rival. Nothing else is written. Seller operator only.';

revoke all on function public.seller_recon_confirm_order_ref(bigint, bigint, timestamptz, jsonb, text) from public, anon;
grant execute on function public.seller_recon_confirm_order_ref(bigint, bigint, timestamptz, jsonb, text) to authenticated;

do $post$
begin
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)')
                    and p.prosecdef
                    and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
                    and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                           from unnest(p.proconfig) c where c like 'search\_path=%')) then
    raise exception '0186 postcondition: seller_recon_confirm_order_ref is not a security definer with an empty search_path';
  end if;
  if has_function_privilege('anon', 'public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure('public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)')
                   and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '0186 postcondition: the rights of seller_recon_confirm_order_ref are not as promised';
  end if;
end
$post$;
-- <<< ENDE: supabase/migrations/0186_recon_order_ref_with_exclusions.sql

/* Z0 — dieselben Messungen nachher. */
create temporary table confirm_0186_nachher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales t) as sales,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_items t) as sale_items,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_refunds t) as sale_refunds,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_fees t) as sale_fees,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orderbook_audit t) as orderbook_audit,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.order_reservations t) as order_reservations,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_matches t) as sales_recon_matches,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_orders t) as sales_recon_orders,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not in ('seller_recon_confirm_order_ref')) as funktionsrechte,
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
  if exists (select 1 from pg_temp.confirm_0186_vorher v, pg_temp.confirm_0186_nachher n
              where (v.sales, v.sale_items, v.sale_refunds, v.sale_fees, v.inventory_movements, v.orderbook_audit, v.order_reservations, v.shop_inventory, v.sales_recon_matches, v.sales_recon_orders, v.collection_items, v.funktionsrechte, v.tabellenrechte, v.policies)
                    is distinct from (n.sales, n.sale_items, n.sale_refunds, n.sale_fees, n.inventory_movements, n.orderbook_audit, n.order_reservations, n.shop_inventory, n.sales_recon_matches, n.sales_recon_orders, n.collection_items, n.funktionsrechte, n.tabellenrechte, n.policies)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Daten, Rechte oder Policies bewegt — nichts wird angewendet';
  end if;

  /* Z2 — die neue Fassung steht, und die unberuehrten sind die alten. */
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)')) is distinct from '7039d396e7166d623c42690bae1d0d2d'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)')) is distinct from '3152b6595d78de9b479199da28b05411'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)')) is distinct from 'a8a7e665d64e656e0ecc6515f55b3cb7'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_take_check(bigint)')) is distinct from 'bce45f42855c25fc428cab86bd7cf081'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)')) is distinct from 'ba97349be8b2a96194fde5a38460840b'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_assign_sale(bigint,bigint,timestamptz)')) is distinct from '2ecac417b66bc59c3272440d296f9e67'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_create_sale(bigint,jsonb)')) is distinct from '75e9d24e44b2467b551e8c620f840ba0'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_update_sale(bigint,date,boolean,text,numeric,numeric,numeric,text,text,text,timestamptz)')) is distinct from '5515f1af50aebb6b9ced82c1235b181a' then
    raise exception 'ABBRUCH Z2: die Fassung aus 0186 steht nicht, oder ein unberuehrter Rumpf hat sich bewegt';
  end if;

  /* Z3 — die Rechte: nur authenticated, nie anon oder PUBLIC. */
  if not (select (has_function_privilege('authenticated', to_regprocedure('public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))) or (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')) <> '1' then
    raise exception 'ABBRUCH Z3: ein Recht oder die Form von seller_recon_confirm_order_ref steht nicht wie zugesagt';
  end if;

  raise notice '0186 ok: seller_recon_confirm_order_ref steht; keine Zeile, kein Recht bewegt.';
end
$lauf_z$;

commit;
