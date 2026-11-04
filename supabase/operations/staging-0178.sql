-- ===========================================================================
-- STAGING — EIN LAUF FUER 0178
--            (der Verkaufsabgleich liest die SkyIsles-Vergleichswerte und die
--             ausstehenden Aenderungen — ADR-0174, Phase 4)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0178`, diese Datei,
-- `npm run db:migrate:staging -- 0178 --resume`.
--
-- NOCH NICHT FREIGEGEBEN. Diese Huelle ist vorbereitet; gefahren wird sie erst
-- nach einer eigenen Freigabe des Betreibers.
--
-- DIE MIGRATION IST ZEICHENGLEICH EINGEBETTET. Sie ersetzt einen
-- Funktionsrumpf und legt vier Funktionen an; bricht sie ab, ist nichts
-- angewendet.
--
-- SIE AENDERT KEINE DATEN UND KEIN RECHT. A2 misst vorher — jede Spalte —
-- die sieben Abgleichstabellen, Verkaeufe, Positionen, Erstattungen,
-- Lagerbewegungen, Altbestandsereignisse, das Orderbuch-Journal, das Lager
-- und die Sammlung, dazu die Rechte jeder Funktion (ausser den vier neuen)
-- und jeder Tabelle in `public` und jede Policy. Z1 misst nachher dasselbe
-- und bricht ab, wenn sich auch nur ein Wert bewegt hat.
--
-- NUR STAGING. Production ist eine eigene, spaetere Entscheidung.
--
-- ERWARTET: die NOTICE-Zeilen A3 und `0178 ok`, dann `commit`.
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
create temporary table recon_0178_vorher on commit drop as
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
    where n.nspname = 'public' and p.proname not in ('seller_recon_pending', 'sales_recon_pending_set', 'sales_recon_sale_values', 'sales_recon_at_analysis')) as funktionsrechte,
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
  select * into v from pg_temp.recon_0178_vorher;
  raise notice 'A3: Abgleichssitzungen %, Entscheidungen %, Uebernahmen %, Verkaeufe %, Positionen %, Erstattungen %, Lagerbewegungen %. Nach diesem Lauf muss jeder Wert gleich sein.',
    split_part(v.sales_recon_sessions, '|', 1), split_part(v.sales_recon_decisions, '|', 1),
    split_part(v.sales_recon_applications, '|', 1), split_part(v.sales, '|', 1),
    split_part(v.sale_items, '|', 1), split_part(v.sale_refunds, '|', 1),
    split_part(v.inventory_movements, '|', 1);
end
$lauf_a3$;

-- >>> EINGEBETTET: supabase/migrations/0178_sales_recon_comparison_and_pending.sql
-- ===========================================================================
-- 0178 — SALES RECONCILIATION: COMPARISON VALUES AND THE PENDING CHANGES
--        (ADR-0174, phase 4)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ##  `0177` stays reserved for the central backup (ADR-0175).             ##
-- ###########################################################################
--
-- READING ONLY. Nothing here writes a row, and no existing table, column,
-- policy or right changes. Two things are added for the two-column screen
-- (report on the left, SkyIsles on the right) and for the later review of
-- concrete corrections:
--
--   seller_recon_session(…)       the same signature and every key it had;
--                                 each match gains ONE new key, `ledger`
--   seller_recon_pending(id)      new: the changes an apply would make NOW
--
-- and two internal helpers without any client right:
--
--   sales_recon_sale_values(sale)      SkyIsles' comparison values of one sale
--   sales_recon_pending_set(session)   the pending changes, their count, a token
--
-- `seller_recon_decide` and `seller_recon_apply` are NOT touched. The
-- postcondition proves both bodies are those of 0172 / 0173.
--
-- ---------------------------------------------------------------------------
-- THE THREE VALUES OF A SALE — and which is which
--
--   ledger.atAnalysis   what SkyIsles held WHEN THE SESSION WAS ANALYSED,
--                       per field `{value, basis}` — and the basis says how
--                       much it is worth:
--                         stored    the finding's `ledger` value: written at
--                                   analysis, never changed since
--                         derived   no finding for this field — and
--                                   `diff.ts` compares every one of these
--                                   five fields of every PAIR (net, shipping,
--                                   total and pieces always; the day whenever
--                                   the sale has one, which every candidate
--                                   has: `seller_recon_candidates` filters on
--                                   it). No finding means "equal to the
--                                   report", so the value is the report's,
--                                   stored in `sales_recon_orders`
--                         unknown   no pair, so nothing was compared:
--                                   `value` is null — never a stand-in
--                       The session never stored a full copy of the sale.
--                       `derived` rests on the payload's findings, which the
--                       operator's own analysis wrote (`seller_recon_create`
--                       cannot prove that a payload left nothing out).
--   ledger.current      what SkyIsles holds NOW (`sales_recon_sale_values`).
--   ledger.state        how the two relate:
--                         unchanged  the sale's version is the analysed one
--                                    and nothing was applied: current IS the
--                                    state at analysis
--                         applied    changed by THIS session's application
--                                    and by nothing else since
--                         changed    changed elsewhere since the analysis (or
--                                    since this session's last application) —
--                                    a decision or apply would be PT409
--   ledger.version      `{analysed, current}`: the two `updated_at` values.
--
-- A HISTORICAL SESSION thus never shows today's values as if they were the
-- analysed ones: `atAnalysis` stays what it was, and `state` says whether
-- `current` has moved away from it. The existing `sale` key is unchanged
-- (current values, `stale`).
--
-- WHY `updated_at` IS ENOUGH. Every writer of a sale, its refunds and its
-- positions goes through the Orderbuch functions, and each of them sets
-- `sales.updated_at` (`orderbook_touch_sale`, 0062 ff.). A change made past
-- them — by hand in the SQL editor — is not seen; that was already true for
-- `stale` and for the PT409 of 0172/0173.
--
-- ---------------------------------------------------------------------------
-- THE COMPARISON VALUES — the rules of `src/lib/reconciliation`, in SQL
--
--   itemsNet        items_subtotal − discount_amount   (`ledgerItemsNet`)
--   shipping        shipping_charged
--   soldOn          sold_at
--   expectedTotal   0 when cancelled, else itemsNet + shipping − Σ refunds
--                                                      (`ledgerExpectedTotal`)
--   pieces          the number of positions (`sale.pieces.length`)
--
-- NULL amounts count as 0, as in `seller_recon_candidates`, which fed the
-- analysis. `src/lib/reconciliation/sql/comparison-pending-0178.test.ts`
-- checks the SQL against the TypeScript functions.
--
-- ---------------------------------------------------------------------------
-- THE PENDING SET — exactly what `seller_recon_apply` (0173) would take
--
-- The CURRENT (latest) decision of every finding of the session, if it is
-- `take_external` or `manual` and no decision of that finding was applied.
-- Its `count` is the number `seller_recon_apply(id, expected)` expects. Per
-- change: sale, field, decision, `effect` (change / event / document), the
-- old value as the sale holds it NOW and the target the apply would write —
-- for `items_net` with the existing discount rule of 0173: the new
-- `items_subtotal` is target + the discount, the discount itself stays.
--
-- A session that is not open has nothing pending (`count` 0, no token):
-- `seller_recon_apply` refuses it anyway.
--
-- THE TOKEN. SHA-256 over the complete ordered set (by decision id, which is
-- unique): per change the session, decision, finding, match and sale ids,
-- the report's order number (the apply books a refund under it), the field, the
-- decision, its manual value, the finding's report value, old and target
-- values and BOTH sale versions as epoch microseconds. Another decision with
-- the same count, another value, a refund on one sale, an application — each
-- gives another token. `TimeZone` is fixed to UTC inside
-- `sales_recon_pending_set`, so neither the token nor the day of a
-- cancellation in it depends on the caller's session. It is a read for now:
-- `0179` will recompute it under lock in the apply.
--
-- THE DAY OF A CANCELLATION in `ledger.current` is read like
-- `seller_recon_candidates` reads it — `cancelled_at::date` in the caller's
-- time zone — so it is the value the analysis compared. Supabase answers in
-- UTC; under another session time zone the two reads can differ by a day.
--
-- ACCESS. Both new seller functions: `security definer`, empty
-- `search_path`, gated by `can_operate_active_seller()` (ADR-0077), EXECUTE
-- for `authenticated` only. The helpers: no client right. They read only the
-- session's own matches and their sales — which 0172 already checked to be
-- external sales of the channel — and return no buyer reference, note or
-- address. Errors name a state, never a value.
--
-- IT CONTAINS NO DATA STATEMENT.
--
-- WHAT 0179 WILL DEPEND ON (planned, not part of this file): a new
-- `seller_recon_apply(session, expected, token)` that recomputes
-- `sales_recon_pending_set` under lock and refuses on another token, and a
-- `seller_recon_decide` that refuses uncertain matches. 0179 therefore needs
-- 0178, and 0178 cannot be rolled back while 0179 stands — `R0178` checks it.
--
-- Rollback: `supabase/rollback/R0178_sales_recon_without_comparison.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Which version stands here?
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_body text;
begin
  if to_regprocedure('public.sales_recon_validate_payload(jsonb)') is null then
    raise exception '0178 needs 0176: sales_recon_validate_payload is missing';
  end if;
  if to_regprocedure('public.seller_recon_apply(bigint,integer)') is null then
    raise exception '0178 needs 0173: seller_recon_apply is missing';
  end if;
  if to_regprocedure('public.seller_recon_pending(bigint)') is not null
     or to_regprocedure('public.sales_recon_pending_set(bigint)') is not null
     or to_regprocedure('public.sales_recon_sale_values(bigint)') is not null then
    raise exception '0178 abort: seller_recon_pending or its helpers exist — applied here already';
  end if;
  if to_regprocedure('public.sales_recon_at_analysis(boolean,jsonb,jsonb)') is not null then
    raise exception '0178 abort: sales_recon_at_analysis exists — applied here already';
  end if;
  select md5(p.prosrc) into v_body from pg_proc p
   where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)');
  if v_body is distinct from '42c2f33b00fa40040a36e2a71637e724' then
    raise exception '0178 abort: seller_recon_session is % and not the body from 0172 '
      '(42c2f33b00fa40040a36e2a71637e724). A foreign version is not overwritten blindly.',
      coalesce(v_body, '(none)');
  end if;
end
$pre$;


-- ---------------------------------------------------------------------------
-- 1. SkyIsles' comparison values of one sale, as it is now
-- ---------------------------------------------------------------------------
create or replace function public.sales_recon_sale_values(p_sale_id bigint)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
           'soldOn', v.sold_at,
           'itemsSubtotal', v.subtotal,
           'discount', v.discount,
           'itemsNet', v.subtotal - v.discount,
           'shipping', v.shipping,
           'refundsTotal', v.refunds,
           'cancelledOn', v.cancelled_on,
           'expectedTotal', case when v.cancelled_on is not null then 0
                                 else v.subtotal - v.discount + v.shipping - v.refunds end,
           'pieces', v.pieces,
           'externalOrderRef', v.external_order_ref,
           'isTest', v.is_test)
    from (select s.sold_at, s.external_order_ref, s.is_test,
                 coalesce(s.items_subtotal, 0) as subtotal,
                 coalesce(s.discount_amount, 0) as discount,
                 coalesce(s.shipping_charged, 0) as shipping,
                 s.cancelled_at::date as cancelled_on,
                 coalesce((select sum(r.amount) from public.sale_refunds r where r.sale_id = s.id), 0) as refunds,
                 (select count(*) from public.sale_items i where i.sale_id = s.id)::integer as pieces
            from public.sales s
           where s.id = p_sale_id) v
$$;

comment on function public.sales_recon_sale_values(bigint) is
  'SkyIsles'' comparison values of one sale as it is now (0178): itemsNet, shipping, soldOn, expectedTotal (0 when cancelled, else net + shipping − refunds), pieces — the rules of src/lib/reconciliation. Internal, no client right.';


/*
 * One field of `ledger.atAnalysis`: the stored finding value, else — for a
 * pair — the report's value, else nothing. The one place the rule lives.
 */
create or replace function public.sales_recon_at_analysis(p_pair boolean, p_finding jsonb, p_report jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select case when p_finding is not null then jsonb_build_object('value', p_finding, 'basis', 'stored')
              when p_pair then jsonb_build_object('value', p_report, 'basis', 'derived')
              else jsonb_build_object('value', null, 'basis', 'unknown') end
$$;


-- ---------------------------------------------------------------------------
-- 2. The pending set — the selection of seller_recon_apply (0173), read only
-- ---------------------------------------------------------------------------
create or replace function public.sales_recon_pending_set(p_session_id bigint)
returns jsonb
language sql stable security definer
set search_path = '' set "TimeZone" = 'UTC'
as $$
  with pending as (
    select d.id as decision_id, d.decision, d.manual_value, d.decided_at,
           f.id as finding_id, f.field, f.external_value,
           m.id as match_id, m.sale_id, m.sale_updated_at,
           o.order_ref,
           s.updated_at as sale_now,
           public.sales_recon_sale_values(m.sale_id) as now_values
      from public.sales_recon_findings f
      join public.sales_recon_matches m on m.id = f.match_id
      join lateral (select * from public.sales_recon_decisions d2
                     where d2.finding_id = f.id order by d2.id desc limit 1) d on true
      join public.sales s on s.id = m.sale_id
      left join public.sales_recon_orders o on o.id = m.order_id
     where m.session_id = p_session_id
       and d.decision in ('take_external', 'manual')
       and not exists (select 1 from public.sales_recon_applications a
                         join public.sales_recon_decisions dx on dx.id = a.decision_id
                        where dx.finding_id = f.id)
  ),
  -- The value the apply takes: the manual one, else the report's.
  chosen as (
    select p.*,
           case when p.decision = 'manual' then p.manual_value -> 'value' else p.external_value end as value
      from pending p
  ),
  shaped as (
    select c.*,
           case c.field
             when 'sold_on' then 'change' when 'items_net' then 'change'
             when 'shipping' then 'change' when 'external_order_ref' then 'change'
             when 'total' then case when c.manual_value ->> 'action' in ('refund', 'cancel') then 'event' else 'document' end
             else 'document' end as effect,
           case c.field
             when 'sold_on' then jsonb_build_object('soldOn', c.now_values -> 'soldOn')
             when 'items_net' then jsonb_build_object('itemsNet', c.now_values -> 'itemsNet',
                                                      'itemsSubtotal', c.now_values -> 'itemsSubtotal',
                                                      'discount', c.now_values -> 'discount')
             when 'shipping' then jsonb_build_object('shipping', c.now_values -> 'shipping')
             when 'external_order_ref' then jsonb_build_object('externalOrderRef', c.now_values -> 'externalOrderRef')
             when 'total' then jsonb_build_object('expectedTotal', c.now_values -> 'expectedTotal',
                                                  'refundsTotal', c.now_values -> 'refundsTotal',
                                                  'cancelledOn', c.now_values -> 'cancelledOn')
             else jsonb_build_object('pieces', c.now_values -> 'pieces') end as old,
           case c.field
             when 'sold_on' then jsonb_build_object('soldOn', to_jsonb((c.value #>> '{}')::date))
             when 'items_net' then jsonb_build_object(
               'itemsNet', round((c.value #>> '{}')::numeric, 2),
               -- 0173, decision 4: the discount is never changed automatically.
               'itemsSubtotal', round((c.value #>> '{}')::numeric + (c.now_values ->> 'discount')::numeric, 2),
               'discount', c.now_values -> 'discount')
             when 'shipping' then jsonb_build_object('shipping', round((c.value #>> '{}')::numeric, 2))
             when 'external_order_ref' then jsonb_build_object('externalOrderRef', c.value)
             when 'total' then case c.manual_value ->> 'action'
               -- `occurredOn` null: seller_recon_apply books the day it runs.
               when 'refund' then jsonb_build_object('action', 'refund', 'amount', c.manual_value -> 'amount',
                                                     'reason', c.manual_value -> 'reason',
                                                     'occurredOn', coalesce(c.manual_value -> 'occurred_on', 'null'::jsonb))
               when 'cancel' then jsonb_build_object('action', 'cancel', 'cancelledOn', c.manual_value -> 'cancelled_on')
               else jsonb_build_object('action', 'none') end
             else jsonb_build_object('action', 'clarify') end as target,
           c.sale_now is distinct from c.sale_updated_at as stale
      from chosen c
  )
  select jsonb_build_object(
    'count', (select count(*) from shaped)::integer,
    'staleSales', (select count(distinct sale_id) from shaped where stale)::integer,
    'token', encode(sha256(convert_to('seller_recon_pending v1|' || p_session_id::text || '|' || coalesce((
      select jsonb_agg(jsonb_build_array(
               x.decision_id, x.finding_id, x.match_id, x.sale_id, x.order_ref, x.field, x.decision,
               x.manual_value, x.external_value, x.old, x.target,
               (extract(epoch from x.sale_updated_at) * 1000000)::bigint,
               (extract(epoch from x.sale_now) * 1000000)::bigint)
             order by x.decision_id)
        from shaped x), '[]'::jsonb)::text, 'UTF8')), 'hex'),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'decisionId', x.decision_id, 'findingId', x.finding_id, 'matchId', x.match_id,
               'saleId', x.sale_id, 'orderRef', x.order_ref, 'field', x.field, 'decision', x.decision,
               'effect', x.effect, 'old', x.old, 'target', x.target, 'stale', x.stale,
               'version', jsonb_build_object('analysed', x.sale_updated_at, 'current', x.sale_now),
               'decidedAt', x.decided_at)
             order by x.decision_id)
        from shaped x), '[]'::jsonb))
$$;

comment on function public.sales_recon_pending_set(bigint) is
  'The changes seller_recon_apply would make for one session now (0178): the selection of 0173, old and target values, count, stale sales and a SHA-256 token over the ordered set including decision identity and both sale versions. Internal, no client right.';


-- ---------------------------------------------------------------------------
-- 3. Reading one session — the body of 0172 plus the key `ledger`
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
                        * 0178: the SkyIsles side of the comparison — at analysis,
                        * now, and how the two relate (see the header).
                        */
                       'ledger', (select jsonb_build_object(
                                    'state', case
                                      when s.updated_at is distinct from m.sale_updated_at then 'changed'
                                      when exists (select 1 from public.sales_recon_applications a
                                                    where a.session_id = m.session_id and a.sale_id = m.sale_id
                                                      and a.outcome = 'applied') then 'applied'
                                      else 'unchanged' end,
                                    'version', jsonb_build_object('analysed', m.sale_updated_at, 'current', s.updated_at),
                                    'current', public.sales_recon_sale_values(s.id),
                                    'atAnalysis', jsonb_build_object(
                                      'soldOn', public.sales_recon_at_analysis(o.id is not null, fx.sold_on, to_jsonb(o.sold_on)),
                                      'itemsNet', public.sales_recon_at_analysis(o.id is not null, fx.items_net, to_jsonb(o.items_value)),
                                      'shipping', public.sales_recon_at_analysis(o.id is not null, fx.shipping, to_jsonb(o.shipping)),
                                      'expectedTotal', public.sales_recon_at_analysis(o.id is not null, fx.total, to_jsonb(o.total)),
                                      'pieces', public.sales_recon_at_analysis(o.id is not null, fx.pieces, to_jsonb(o.pieces))))
                                    from public.sales s
                                    left join public.sales_recon_orders o on o.id = m.order_id
                                    cross join lateral (
                                      select max(fi.ledger_value::text) filter (where fi.finding_key = 'sold_on')::jsonb as sold_on,
                                             max(fi.ledger_value::text) filter (where fi.finding_key = 'items_net')::jsonb as items_net,
                                             max(fi.ledger_value::text) filter (where fi.finding_key = 'shipping')::jsonb as shipping,
                                             max(fi.ledger_value::text) filter (where fi.finding_key = 'total')::jsonb as total,
                                             max(fi.ledger_value::text) filter (where fi.finding_key = 'pieces')::jsonb as pieces
                                        from public.sales_recon_findings fi where fi.match_id = m.id) fx
                                   where s.id = m.sale_id),
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
-- 4. The pending changes of one session, for the seller operator
-- ---------------------------------------------------------------------------
create or replace function public.seller_recon_pending(p_session_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_state text;
begin
  perform public.sales_recon_gate();
  select state into v_state from public.sales_recon_sessions where id = p_session_id;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if v_state <> 'open' then
    -- Nothing is pending where nothing can be applied (seller_recon_apply refuses).
    return jsonb_build_object('sessionId', p_session_id, 'state', v_state, 'sessionOpen', false,
                              'count', 0, 'staleSales', 0, 'token', null, 'changes', '[]'::jsonb);
  end if;
  return jsonb_build_object('sessionId', p_session_id, 'state', v_state, 'sessionOpen', true)
         || public.sales_recon_pending_set(p_session_id);
end;
$$;

comment on function public.seller_recon_pending(bigint) is
  'The changes seller_recon_apply would make for one open session now (0178, ADR-0174): per change sale, field, old and target value; count; stale sales; a token over the ordered set. Reads only.';


-- ---------------------------------------------------------------------------
-- 5. Rights: the seller function for `authenticated`, the helpers for nobody
-- ---------------------------------------------------------------------------
revoke all on function public.sales_recon_sale_values(bigint) from public, anon, authenticated;
revoke all on function public.sales_recon_at_analysis(boolean, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.sales_recon_pending_set(bigint) from public, anon, authenticated;
revoke all on function public.seller_recon_pending(bigint) from public, anon;
grant execute on function public.seller_recon_pending(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Postcondition
-- ---------------------------------------------------------------------------
do $post$
declare
  v_fn text;
begin
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_apply(bigint,integer)'))
     is distinct from 'f8b1132c27ba1b18123f6c2548f9997c' then
    raise exception '0178 postcondition: seller_recon_apply is not the body of 0173';
  end if;
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)'))
     is distinct from '2526d3a77ccf3153158182d0ecd391aa' then
    raise exception '0178 postcondition: seller_recon_decide is not the body of 0172';
  end if;
  if (select string_agg(p.proname || '=' || md5(p.prosrc), ',' order by p.proname) from pg_proc p
       where p.oid in (to_regprocedure('public.sales_recon_at_analysis(boolean,jsonb,jsonb)'),
                       to_regprocedure('public.sales_recon_pending_set(bigint)'),
                       to_regprocedure('public.sales_recon_sale_values(bigint)'),
                       to_regprocedure('public.seller_recon_pending(bigint)'),
                       to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)')))
     is distinct from 'sales_recon_at_analysis=192dedca6ea258b54c6108ccbcd2d149,'
                      'sales_recon_pending_set=3228eb12e00d7982c5cad5c42ea6f773,'
                      'sales_recon_sale_values=4c4a01eb05adb6d439450063f04eada9,'
                      'seller_recon_pending=51213fd88afb5441a487dc89bba2ac06,'
                      'seller_recon_session=d70ee33c2b740aa811704ad5e561a34e' then
    raise exception '0178 postcondition: the five bodies are not those of this file';
  end if;
  foreach v_fn in array array['seller_recon_session(bigint,text,integer,integer)', 'seller_recon_pending(bigint)',
                              'sales_recon_sale_values(bigint)', 'sales_recon_pending_set(bigint)'] loop
    if not exists (select 1 from pg_proc p
                    where p.oid = to_regprocedure('public.' || v_fn)
                      and p.prosecdef and p.provolatile = 's'
                      and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
                      and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                             from unnest(p.proconfig) c where c like 'search\_path=%')) then
      raise exception '0178 postcondition: % is not a stable security definer with an empty search_path', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['seller_recon_session(bigint,text,integer,integer)', 'seller_recon_pending(bigint)'] loop
    if not has_function_privilege('authenticated', 'public.' || v_fn, 'execute')
       or has_function_privilege('anon', 'public.' || v_fn, 'execute') then
      raise exception '0178 postcondition: the rights on % are not authenticated-only', v_fn;
    end if;
  end loop;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in (to_regprocedure('public.sales_recon_sale_values(bigint)'),
                              to_regprocedure('public.sales_recon_pending_set(bigint)'),
                              to_regprocedure('public.sales_recon_at_analysis(boolean,jsonb,jsonb)'))
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) then
    raise exception '0178 postcondition: a client role may execute an internal helper';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = to_regprocedure('public.seller_recon_pending(bigint)')
                and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '0178 postcondition: PUBLIC may execute seller_recon_pending';
  end if;
  raise notice '0178: seller_recon_session carries `ledger`; seller_recon_pending reads the pending changes. '
    'seller_recon_apply and seller_recon_decide unchanged. No row touched.';
end
$post$;
-- <<< ENDE: supabase/migrations/0178_sales_recon_comparison_and_pending.sql

/* Z0 — dieselben Messungen nachher, in derselben Form. */
create temporary table recon_0178_nachher on commit drop as
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
    where n.nspname = 'public' and p.proname not in ('seller_recon_pending', 'sales_recon_pending_set', 'sales_recon_sale_values', 'sales_recon_at_analysis')) as funktionsrechte,
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
  if exists (select 1 from pg_temp.recon_0178_vorher v, pg_temp.recon_0178_nachher n
              where (v.sales_recon_sessions, v.sales_recon_files, v.sales_recon_orders, v.sales_recon_matches, v.sales_recon_findings, v.sales_recon_decisions, v.sales_recon_applications, v.sales, v.sale_items, v.sale_refunds, v.inventory_movements, v.legacy_stock_events, v.orderbook_audit, v.shop_inventory, v.collection_items, v.funktionsrechte, v.tabellenrechte, v.policies)
                    is distinct from (n.sales_recon_sessions, n.sales_recon_files, n.sales_recon_orders, n.sales_recon_matches, n.sales_recon_findings, n.sales_recon_decisions, n.sales_recon_applications, n.sales, n.sale_items, n.sale_refunds, n.inventory_movements, n.legacy_stock_events, n.orderbook_audit, n.shop_inventory, n.collection_items, n.funktionsrechte, n.tabellenrechte, n.policies)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Daten, Rechte oder Policies bewegt — nichts wird angewendet';
  end if;

  /* Z2 — die neue Fassung steht, und Apply und Decide sind die alten. */
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)'))
     is distinct from 'd70ee33c2b740aa811704ad5e561a34e'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_pending(bigint)'))
     is distinct from '51213fd88afb5441a487dc89bba2ac06'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_apply(bigint,integer)'))
     is distinct from 'f8b1132c27ba1b18123f6c2548f9997c'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)'))
     is distinct from '2526d3a77ccf3153158182d0ecd391aa' then
    raise exception 'ABBRUCH Z2: die Fassung aus 0178 steht nicht, oder Apply/Decide haben sich bewegt';
  end if;

  /* Z3 — die vier Definer-Funktionen: genau eine search_path-Festlegung, ausgepackt leer. */
  if (select count(*) from pg_proc p
       where p.oid in (to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)'),
                       to_regprocedure('public.seller_recon_pending(bigint)'),
                       to_regprocedure('public.sales_recon_pending_set(bigint)'),
                       to_regprocedure('public.sales_recon_sale_values(bigint)'))
         and p.prosecdef
         and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
         and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                from unnest(p.proconfig) c where c like 'search\_path=%')) <> 4 then
    raise exception 'ABBRUCH Z3: eine der vier Funktionen ist nicht SECURITY DEFINER mit leerem search_path';
  end if;

  raise notice '0178 ok: seller_recon_session liest ledger, seller_recon_pending steht. Keine Zeile, kein Recht bewegt.';
end
$lauf_z$;

commit;
