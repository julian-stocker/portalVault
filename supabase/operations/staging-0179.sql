-- ===========================================================================
-- STAGING — EIN LAUF FUER 0179
--            (der Verkaufsabgleich nennt einen Analysewert nur mit Nachweis —
--             ADR-0174, Phase 4; Befund der Leseabnahme von 0178)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0179`, diese Datei,
-- `npm run db:migrate:staging -- 0179 --resume`.
--
-- NOCH NICHT FREIGEGEBEN. Diese Huelle ist vorbereitet; gefahren wird sie erst
-- nach einer eigenen Freigabe des Betreibers.
--
-- DIE MIGRATION IST ZEICHENGLEICH EINGEBETTET. Sie ersetzt einen
-- Funktionsrumpf und legt zwei Funktionen an; bricht sie ab, ist nichts
-- angewendet.
--
-- SIE AENDERT KEINE DATEN UND KEIN RECHT. A2 misst vorher — jede Spalte —
-- die sieben Abgleichstabellen, Verkaeufe, Positionen, Erstattungen,
-- Lagerbewegungen, Altbestandsereignisse, das Orderbuch-Journal, das Lager
-- und die Sammlung, dazu die Rechte jeder Funktion (ausser den zwei neuen)
-- und jeder Tabelle in `public` und jede Policy. Z1 misst nachher dasselbe
-- und bricht ab, wenn sich auch nur ein Wert bewegt hat.
--
-- NUR STAGING. Production ist eine eigene, spaetere Entscheidung.
--
-- ERWARTET: die NOTICE-Zeilen A3 und `0179 ok`, dann `commit`.
-- ===========================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $lauf_a$
begin
  /* A1 — der Umgebungsstempel (Datenbankkommentar, wie beim Pruefzugang). */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     <> 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
end
$lauf_a$;

/* A2 — Daten und Rechte, vorher gemessen (Temporaertabelle, faellt mit commit). */
create temporary table recon_0179_vorher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_sessions t) as sales_recon_sessions,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_files t) as sales_recon_files,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_orders t) as sales_recon_orders,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_matches t) as sales_recon_matches,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_findings t) as sales_recon_findings,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_decisions t) as sales_recon_decisions,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_applications t) as sales_recon_applications,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales t) as sales,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_items t) as sale_items,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_refunds t) as sale_refunds,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.legacy_stock_events t) as legacy_stock_events,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orderbook_audit t) as orderbook_audit,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not in ('sales_recon_ledger', 'sales_recon_proven')) as funktionsrechte,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

do $lauf_a3$
declare v record;
begin
  select * into v from pg_temp.recon_0179_vorher;
  raise notice 'A3: Abgleichssitzungen %, Entscheidungen %, Uebernahmen %, Verkaeufe %, Positionen %, Erstattungen %, Lagerbewegungen %. Nach diesem Lauf muss jeder Wert gleich sein.',
    split_part(v.sales_recon_sessions, '|', 1), split_part(v.sales_recon_decisions, '|', 1),
    split_part(v.sales_recon_applications, '|', 1), split_part(v.sales, '|', 1),
    split_part(v.sale_items, '|', 1), split_part(v.sale_refunds, '|', 1),
    split_part(v.inventory_movements, '|', 1);
end
$lauf_a3$;

-- >>> EINGEBETTET: supabase/migrations/0179_sales_recon_ledger_proof.sql
-- ===========================================================================
-- 0179 — SALES RECONCILIATION: A VALUE AT ANALYSIS ONLY WITH PROOF
--        (ADR-0174, phase 4; the functional read check of 0178)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- THE FINDING. The functional read check of 0178 on Staging (2026-11-04,
-- 41/42) found discarded session 3 — the refusal probe's hand-built mini
-- session, category `exact` WITHOUT findings and synthetic amounts 1 / 0 / 1
-- on a real test sale — reported as `derived` at analysis: values the sale
-- never had. 0178 called a pair without a finding "equal to the report",
-- which is true only for a payload `diff.ts` built. The database never
-- checked it.
--
-- THE RULE OF 0179, per field (soldOn, itemsNet, shipping, expectedTotal,
-- pieces). A CLAIM is checked against a PROOF the database holds itself:
--
--   claim     stored   the finding's `ledger` value (written at analysis)
--             derived  the report's value, for a pair without a finding
--             unknown  no pair — nothing was compared
--
--   proof     unchanged  the sale's version is the analysed one, and
--                        `seller_recon_create` refused (PT409) to store a
--                        match whose version was not — so the sale TODAY is
--                        the sale AT ANALYSIS: the proof is today's value
--             applied    only THIS session changed the sale since (every
--                        apply refuses a moved sale, PT409, and refreshes
--                        the snapshot after its own writes). A field no
--                        application of this session touched: today's value.
--                        A touched field: the old value that application
--                        recorded (sold_on, items_net, shipping). The total:
--                        proven net + proven shipping − the refunds that
--                        stood BEFORE this session (today's minus this
--                        session's), 0 only if the sale was cancelled
--                        already (a cancellation by this session means it
--                        was not — 0170 refuses to cancel twice)
--             changed    changed elsewhere since: NO proof
--
--   result    proof and claim agree (amounts to the cent, the rest
--             literally) → the claim, `stored` or `derived`
--             proof and claim disagree, or the proof is missing, ambiguous
--             (two applications of one field) or unreadable (an old value
--             not in the form apply writes, a day not in ISO form)
--             → `unknown`, value null — never a stand-in
--             no proof at all (`changed`): `stored` stays `stored` (it is
--             what the analysis recorded); `derived` becomes `unknown` —
--             a report value or the category `exact` proves nothing
--
-- WHAT DOES NOT CHANGE. `seller_recon_session` keeps its signature, rights
-- and every key; `ledger` keeps its shape (`state`, `version`, `current`,
-- `atAnalysis` per field `{value, basis}`). `seller_recon_pending`,
-- `seller_recon_decide`, `seller_recon_apply`, `sales_recon_sale_values` and
-- `sales_recon_at_analysis` (0178, no longer called, kept for R0179) are
-- untouched; the postcondition proves their bodies. No data statement.
--
-- WHAT IT CANNOT SEE. A change made past the Orderbuch functions (by hand
-- in the SQL editor) does not move `updated_at`. If it contradicts a claim
-- on an `unchanged` sale, the claim becomes `unknown`; if it does not, it
-- stays unseen — the same limit `stale` and PT409 already have.
--
-- THE NUMBER. 0179 was planned for the token and decide hardening; that is
-- now 0180. `0177` stays reserved for the central backup.
--
-- Rollback: `supabase/rollback/R0179_sales_recon_ledger_without_proof.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Which version stands here?
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_body text;
begin
  if to_regprocedure('public.seller_recon_pending(bigint)') is null
     or to_regprocedure('public.sales_recon_sale_values(bigint)') is null then
    raise exception '0179 needs 0178: seller_recon_pending or sales_recon_sale_values is missing';
  end if;
  if to_regprocedure('public.sales_recon_ledger(bigint)') is not null
     or to_regprocedure('public.sales_recon_proven(jsonb,text,jsonb,boolean)') is not null then
    raise exception '0179 abort: sales_recon_ledger or sales_recon_proven exists — applied here already';
  end if;
  select md5(p.prosrc) into v_body from pg_proc p
   where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)');
  if v_body is distinct from 'd70ee33c2b740aa811704ad5e561a34e' then
    raise exception '0179 abort: seller_recon_session is % and not the body from 0178 '
      '(d70ee33c2b740aa811704ad5e561a34e). A foreign version is not overwritten blindly.',
      coalesce(v_body, '(none)');
  end if;
end
$pre$;


-- ---------------------------------------------------------------------------
-- 1. One claim against one proof
-- ---------------------------------------------------------------------------
create or replace function public.sales_recon_proven(p_value jsonb, p_basis text, p_proof jsonb, p_provable boolean)
returns jsonb
language sql immutable set search_path = ''
as $$
  select case
    when p_basis is distinct from 'stored' and p_basis is distinct from 'derived'
      then jsonb_build_object('value', null, 'basis', 'unknown')
    -- No proof exists at all (changed elsewhere): only what the analysis recorded survives.
    when not coalesce(p_provable, false)
      then case when p_basis = 'stored' and p_value is not null and jsonb_typeof(p_value) <> 'null'
                then jsonb_build_object('value', p_value, 'basis', 'stored')
                else jsonb_build_object('value', null, 'basis', 'unknown') end
    -- A proof should exist but is missing or unreadable: nothing is claimed.
    when p_proof is null or jsonb_typeof(p_proof) = 'null' or p_value is null or jsonb_typeof(p_value) = 'null'
      then jsonb_build_object('value', null, 'basis', 'unknown')
    when jsonb_typeof(p_value) = 'number' and jsonb_typeof(p_proof) = 'number'
      then case when abs((p_value #>> '{}')::numeric - (p_proof #>> '{}')::numeric) < 0.005
                then jsonb_build_object('value', p_value, 'basis', p_basis)
                else jsonb_build_object('value', null, 'basis', 'unknown') end
    when jsonb_typeof(p_value) = 'string' and jsonb_typeof(p_proof) = 'string' and p_value = p_proof
      then jsonb_build_object('value', p_value, 'basis', p_basis)
    else jsonb_build_object('value', null, 'basis', 'unknown') end
$$;

comment on function public.sales_recon_proven(jsonb, text, jsonb, boolean) is
  'One value at analysis (0179): the claim (stored / derived) if a proof exists and agrees — amounts to the cent, the rest literally; unknown with value null if it disagrees or is missing; without any proof only stored survives. Internal, no client right.';


-- ---------------------------------------------------------------------------
-- 2. The SkyIsles side of one match: state, versions, today, at analysis
-- ---------------------------------------------------------------------------
create or replace function public.sales_recon_ledger(p_match_id bigint)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with b as (
    select m.id, m.session_id, m.sale_id, m.sale_updated_at, s.updated_at as now_version,
           o.id as order_id, o.sold_on as r_sold, o.items_value as r_net, o.shipping as r_ship,
           o.total as r_total, o.pieces as r_pieces,
           public.sales_recon_sale_values(m.sale_id) as cur
      from public.sales_recon_matches m
      join public.sales s on s.id = m.sale_id
      left join public.sales_recon_orders o on o.id = m.order_id
     where m.id = p_match_id
  ),
  -- The claims: one finding per key and match (sales_recon_findings_once).
  fx as (
    select max(fi.ledger_value::text) filter (where fi.finding_key = 'sold_on')::jsonb as f_sold,
           max(fi.ledger_value::text) filter (where fi.finding_key = 'items_net')::jsonb as f_net,
           max(fi.ledger_value::text) filter (where fi.finding_key = 'shipping')::jsonb as f_ship,
           max(fi.ledger_value::text) filter (where fi.finding_key = 'total')::jsonb as f_total,
           max(fi.ledger_value::text) filter (where fi.finding_key = 'pieces')::jsonb as f_pieces
      from public.sales_recon_findings fi
     where fi.match_id = p_match_id
  ),
  -- This session's applications that CHANGED this sale (documented ones did not).
  ap as (
    select count(a.id) as n,
           count(a.id) filter (where a.field = 'sold_on') as n_sold,
           max(a.old_value) filter (where a.field = 'sold_on') as old_sold,
           count(a.id) filter (where a.field = 'items_net') as n_net,
           max(a.old_value) filter (where a.field = 'items_net') as old_net,
           count(a.id) filter (where a.field = 'shipping') as n_ship,
           max(coalesce(a.old_value, '0')) filter (where a.field = 'shipping') as old_ship,
           count(a.id) filter (where a.field = 'total' and d.manual_value ->> 'action' = 'refund') as n_refund,
           coalesce(sum((d.manual_value ->> 'amount')::numeric)
                      filter (where a.field = 'total' and d.manual_value ->> 'action' = 'refund'), 0) as refunds_here,
           count(a.id) filter (where a.field = 'total' and d.manual_value ->> 'action' = 'cancel') as n_cancel,
           count(a.id) filter (where a.field = 'total'
                                 and coalesce(d.manual_value ->> 'action', '') not in ('refund', 'cancel')) as n_total_other
      from b
      left join public.sales_recon_applications a
        on a.session_id = b.session_id and a.sale_id = b.sale_id and a.outcome = 'applied'
      left join public.sales_recon_decisions d on d.id = a.decision_id
  ),
  st as (
    select b.*, fx.*, ap.*,
           case when b.now_version is distinct from b.sale_updated_at then 'changed'
                when ap.n > 0 then 'applied'
                else 'unchanged' end as state
      from b, fx, ap
  ),
  -- The proofs, field by field. NULL where a proof should exist but cannot be read.
  pr as (
    select st.*,
           st.state <> 'changed' as provable,
           case when st.n_sold = 0 then st.cur -> 'soldOn'
                when st.n_sold = 1 and st.old_sold ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then to_jsonb(st.old_sold::date)
           end as p_sold,
           case when st.n_net = 0 then st.cur -> 'itemsNet'
                when st.n_net = 1 then to_jsonb(substring(st.old_net
                  from '^items_subtotal -?[0-9]+(?:\.[0-9]+)? \(net (-?[0-9]+(?:\.[0-9]+)?)\)$')::numeric)
           end as p_net,
           case when st.n_ship = 0 then st.cur -> 'shipping'
                when st.n_ship = 1 and st.old_ship ~ '^-?[0-9]+(\.[0-9]+)?$' then to_jsonb(st.old_ship::numeric)
           end as p_ship,
           st.cur -> 'pieces' as p_pieces
      from st
  ),
  pt as (
    select pr.*,
           case when pr.n_net = 0 and pr.n_ship = 0 and pr.n_refund = 0 and pr.n_cancel = 0 and pr.n_total_other = 0
                  then pr.cur -> 'expectedTotal'
                when pr.n_cancel > 1 or pr.n_total_other > 0 then null
                when pr.p_net is null or jsonb_typeof(pr.p_net) = 'null'
                     or pr.p_ship is null or jsonb_typeof(pr.p_ship) = 'null' then null
                -- Cancelled by this session, yet not cancelled today: another hand was here.
                when pr.n_cancel = 1 and pr.cur ->> 'cancelledOn' is null then null
                when pr.cur ->> 'cancelledOn' is not null and pr.n_cancel = 0 then to_jsonb(0)
                else to_jsonb((pr.p_net #>> '{}')::numeric + (pr.p_ship #>> '{}')::numeric
                              - ((pr.cur ->> 'refundsTotal')::numeric - pr.refunds_here))
           end as p_total
      from pr
  )
  select jsonb_build_object(
    'state', x.state,
    'version', jsonb_build_object('analysed', x.sale_updated_at, 'current', x.now_version),
    'current', x.cur,
    'atAnalysis', jsonb_build_object(
      'soldOn', public.sales_recon_proven(coalesce(x.f_sold, to_jsonb(x.r_sold)),
        case when x.f_sold is not null then 'stored' when x.order_id is not null then 'derived' end, x.p_sold, x.provable),
      'itemsNet', public.sales_recon_proven(coalesce(x.f_net, to_jsonb(x.r_net)),
        case when x.f_net is not null then 'stored' when x.order_id is not null then 'derived' end, x.p_net, x.provable),
      'shipping', public.sales_recon_proven(coalesce(x.f_ship, to_jsonb(x.r_ship)),
        case when x.f_ship is not null then 'stored' when x.order_id is not null then 'derived' end, x.p_ship, x.provable),
      'expectedTotal', public.sales_recon_proven(coalesce(x.f_total, to_jsonb(x.r_total)),
        case when x.f_total is not null then 'stored' when x.order_id is not null then 'derived' end, x.p_total, x.provable),
      'pieces', public.sales_recon_proven(coalesce(x.f_pieces, to_jsonb(x.r_pieces)),
        case when x.f_pieces is not null then 'stored' when x.order_id is not null then 'derived' end, x.p_pieces, x.provable)))
    from pt x
$$;

comment on function public.sales_recon_ledger(bigint) is
  'The SkyIsles side of one reconciliation match (0179): state (unchanged / applied / changed), both versions, today''s values, and every value at analysis as {value, basis} — stored or derived only where the database can prove it, unknown with value null otherwise. Internal, no client right.';


-- ---------------------------------------------------------------------------
-- 3. Reading one session — the body of 0178, `ledger` from the helper
-- ---------------------------------------------------------------------------
create or replace function public.seller_recon_session(
  p_id bigint, p_category text default null, p_offset integer default 0, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_session public.sales_recon_sessions;
begin
  perform public.sales_recon_gate();
  select * into v_session from public.sales_recon_sessions where id = p_id;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0 then
    raise exception 'a page is 1 to 200 rows from offset 0' using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'session', to_jsonb(v_session) - array['created_by', 'closed_by', 'discarded_by'],
    'files', coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.sales_recon_files f
                        where f.session_id = p_id), '[]'::jsonb),
    'total', (select count(*) from public.sales_recon_matches m
               where m.session_id = p_id and (p_category is null or m.category = p_category)),
    'matches', coalesce((
      select jsonb_agg(page.entry order by page.row_order)
        from (select m.id as row_order,
                     jsonb_build_object(
                       'id', m.id, 'category', m.category, 'certainty', m.certainty, 'score', m.score,
                       'dateDelta', m.date_delta, 'competitors', m.competitors, 'reason', m.reason,
                       'order', (select to_jsonb(o) - 'session_id' from public.sales_recon_orders o where o.id = m.order_id),
                       'sale', (select jsonb_build_object(
                                  'id', s.id, 'soldOn', s.sold_at, 'itemsSubtotal', s.items_subtotal,
                                  'discount', s.discount_amount, 'shipping', s.shipping_charged,
                                  'cancelledOn', s.cancelled_at::date, 'externalOrderRef', s.external_order_ref,
                                  'source', s.source, 'stale', s.updated_at is distinct from m.sale_updated_at)
                                  from public.sales s where s.id = m.sale_id),
                       /*
                        * 0179: the SkyIsles side, with the provenance of every
                        * value at analysis proven or withheld (`sales_recon_ledger`).
                        */
                       'ledger', case when m.sale_id is null then null else public.sales_recon_ledger(m.id) end,
                       'findings', coalesce((
                         select jsonb_agg(jsonb_build_object(
                                  'id', fi.id, 'key', fi.finding_key, 'field', fi.field, 'kind', fi.kind,
                                  'ledger', fi.ledger_value, 'external', fi.external_value, 'delta', fi.delta,
                                  'causes', fi.causes, 'allowedDecisions', to_jsonb(fi.allowed_decisions),
                                  'decision', (select jsonb_build_object(
                                                 'id', d.id, 'decision', d.decision, 'manualValue', d.manual_value,
                                                 'reason', d.reason, 'decidedAt', d.decided_at)
                                                 from public.sales_recon_decisions d
                                                where d.finding_id = fi.id order by d.id desc limit 1),
                                  'applied', exists (select 1 from public.sales_recon_applications a
                                                       join public.sales_recon_decisions d on d.id = a.decision_id
                                                      where d.finding_id = fi.id))
                                order by fi.id)
                           from public.sales_recon_findings fi where fi.match_id = m.id), '[]'::jsonb)) as entry
                from public.sales_recon_matches m
               where m.session_id = p_id and (p_category is null or m.category = p_category)
               order by m.id
              offset p_offset limit p_limit) page), '[]'::jsonb));
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Rights: the helpers for nobody; the session read keeps its ACL
-- ---------------------------------------------------------------------------
revoke all on function public.sales_recon_proven(jsonb, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.sales_recon_ledger(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Postcondition
-- ---------------------------------------------------------------------------
do $post$
begin
  if (select string_agg(p.proname || '=' || md5(p.prosrc), ',' order by p.proname) from pg_proc p
       where p.oid in (to_regprocedure('public.sales_recon_ledger(bigint)'),
                       to_regprocedure('public.sales_recon_proven(jsonb,text,jsonb,boolean)'),
                       to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)')))
     is distinct from 'sales_recon_ledger=07875fe3ba889fefab1c55dbe67005d9,'
                      'sales_recon_proven=b7b36ccd5efdd57e661808b62274df68,'
                      'seller_recon_session=5ed52447581cc895efc6a56f268c0da3' then
    raise exception '0179 postcondition: the three bodies are not those of this file';
  end if;
  if (select string_agg(p.proname || '=' || md5(p.prosrc), ',' order by p.proname) from pg_proc p
       where p.oid in (to_regprocedure('public.sales_recon_at_analysis(boolean,jsonb,jsonb)'),
                       to_regprocedure('public.sales_recon_pending_set(bigint)'),
                       to_regprocedure('public.sales_recon_sale_values(bigint)'),
                       to_regprocedure('public.seller_recon_apply(bigint,integer)'),
                       to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)'),
                       to_regprocedure('public.seller_recon_pending(bigint)')))
     is distinct from 'sales_recon_at_analysis=192dedca6ea258b54c6108ccbcd2d149,'
                      'sales_recon_pending_set=3228eb12e00d7982c5cad5c42ea6f773,'
                      'sales_recon_sale_values=4c4a01eb05adb6d439450063f04eada9,'
                      'seller_recon_apply=f8b1132c27ba1b18123f6c2548f9997c,'
                      'seller_recon_decide=2526d3a77ccf3153158182d0ecd391aa,'
                      'seller_recon_pending=51213fd88afb5441a487dc89bba2ac06' then
    raise exception '0179 postcondition: a function 0179 must not touch has moved';
  end if;
  if (select count(*) from pg_proc p
       where p.oid in (to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)'),
                       to_regprocedure('public.sales_recon_ledger(bigint)'))
         and p.prosecdef and p.provolatile = 's'
         and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
         and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                from unnest(p.proconfig) c where c like 'search\_path=%')) <> 2 then
    raise exception '0179 postcondition: the session read and the ledger are not stable security definers with an empty search_path';
  end if;
  if not has_function_privilege('authenticated', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute') then
    raise exception '0179 postcondition: the rights on seller_recon_session moved';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in (to_regprocedure('public.sales_recon_ledger(bigint)'),
                              to_regprocedure('public.sales_recon_proven(jsonb,text,jsonb,boolean)'))
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) then
    raise exception '0179 postcondition: a client role may execute a helper of 0179';
  end if;
  raise notice '0179: ledger.atAnalysis only with proof. pending, decide and apply unchanged. No row touched.';
end
$post$;
-- <<< ENDE: supabase/migrations/0179_sales_recon_ledger_proof.sql

/* Z0 — dieselben Messungen nachher, in derselben Form. */
create temporary table recon_0179_nachher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_sessions t) as sales_recon_sessions,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_files t) as sales_recon_files,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_orders t) as sales_recon_orders,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_matches t) as sales_recon_matches,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_findings t) as sales_recon_findings,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_decisions t) as sales_recon_decisions,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_applications t) as sales_recon_applications,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales t) as sales,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_items t) as sale_items,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_refunds t) as sale_refunds,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.legacy_stock_events t) as legacy_stock_events,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orderbook_audit t) as orderbook_audit,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not in ('sales_recon_ledger', 'sales_recon_proven')) as funktionsrechte,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

do $lauf_z$
begin
  /* Z1 — kein Wert hat sich bewegt: keine Zeile, kein Recht, keine Policy. */
  if exists (select 1 from pg_temp.recon_0179_vorher v, pg_temp.recon_0179_nachher n
              where (v.sales_recon_sessions, v.sales_recon_files, v.sales_recon_orders, v.sales_recon_matches, v.sales_recon_findings, v.sales_recon_decisions, v.sales_recon_applications, v.sales, v.sale_items, v.sale_refunds, v.inventory_movements, v.legacy_stock_events, v.orderbook_audit, v.shop_inventory, v.collection_items, v.funktionsrechte, v.tabellenrechte, v.policies)
                    is distinct from (n.sales_recon_sessions, n.sales_recon_files, n.sales_recon_orders, n.sales_recon_matches, n.sales_recon_findings, n.sales_recon_decisions, n.sales_recon_applications, n.sales, n.sale_items, n.sale_refunds, n.inventory_movements, n.legacy_stock_events, n.orderbook_audit, n.shop_inventory, n.collection_items, n.funktionsrechte, n.tabellenrechte, n.policies)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Daten, Rechte oder Policies bewegt — nichts wird angewendet';
  end if;

  /* Z2 — die neue Fassung steht, und alles, was 0179 nicht anfassen darf, ist das alte. */
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)'))
     is distinct from '5ed52447581cc895efc6a56f268c0da3'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_ledger(bigint)'))
     is distinct from '07875fe3ba889fefab1c55dbe67005d9'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_proven(jsonb,text,jsonb,boolean)'))
     is distinct from 'b7b36ccd5efdd57e661808b62274df68'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_pending(bigint)'))
     is distinct from '51213fd88afb5441a487dc89bba2ac06'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_apply(bigint,integer)'))
     is distinct from 'f8b1132c27ba1b18123f6c2548f9997c'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)'))
     is distinct from '2526d3a77ccf3153158182d0ecd391aa' then
    raise exception 'ABBRUCH Z2: die Fassung aus 0179 steht nicht, oder Pending/Apply/Decide haben sich bewegt';
  end if;

  /* Z3 — Lesefunktion und Ledger: genau eine search_path-Festlegung, ausgepackt leer. */
  if (select count(*) from pg_proc p
       where p.oid in (to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)'),
                       to_regprocedure('public.sales_recon_ledger(bigint)'))
         and p.prosecdef
         and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
         and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                from unnest(p.proconfig) c where c like 'search\_path=%')) <> 2 then
    raise exception 'ABBRUCH Z3: Lesefunktion oder Ledger ist nicht SECURITY DEFINER mit leerem search_path';
  end if;

  raise notice '0179 ok: ledger.atAnalysis nur mit Nachweis. Keine Zeile, kein Recht bewegt.';
end
$lauf_z$;

commit;
