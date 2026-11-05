-- ===========================================================================
-- STAGING — EIN LAUF FUER 0180
--            (der Verkaufsabgleich uebernimmt nur nachgewiesene Berichtswerte,
--             nur die ausgewaehlten Entscheidungen, nur mit dem Token der
--             Vorschau — ADR-0178)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0180`, diese Datei,
-- `npm run db:migrate:staging -- 0180 --resume`.
--
-- NOCH NICHT FREIGEGEBEN. Diese Huelle ist vorbereitet; gefahren wird sie erst
-- nach einer eigenen Freigabe des Betreibers.
--
-- DIE MIGRATION IST ZEICHENGLEICH EINGEBETTET. Sie ersetzt drei
-- Funktionsruempfe, legt sieben Funktionen an und entzieht der alten
-- Uebernahme jedes Clientrecht; bricht sie ab, ist nichts angewendet.
--
-- SIE AENDERT KEINE DATEN. A2 misst vorher — jede Spalte — die sieben
-- Abgleichstabellen, Verkaeufe, Positionen, Erstattungen, Lagerbewegungen,
-- Altbestandsereignisse, das Orderbuch-Journal, das Lager und die Sammlung,
-- dazu die Rechte jeder Funktion (ausser den neuen und den beiden
-- Apply-Fassungen) und jeder Tabelle in `public` und jede Policy. Z1 misst
-- nachher dasselbe und bricht ab, wenn sich auch nur ein Wert bewegt hat. Z3
-- prueft die Rechte, die 0180 bewusst aendert.
--
-- NUR STAGING. Production ist eine eigene, spaetere Entscheidung.
--
-- ERWARTET: die NOTICE-Zeilen A3 und `0180 ok`, dann `commit`.
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
create temporary table recon_0180_vorher on commit drop as
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
    where n.nspname = 'public' and p.proname not in ('sales_recon_allowed_0180', 'sales_recon_take_check', 'sales_recon_decision_problem', 'sales_recon_check_selection', 'sales_recon_selection', 'seller_recon_preview', 'seller_recon_apply')) as funktionsrechte,
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
  select * into v from pg_temp.recon_0180_vorher;
  raise notice 'A3: Abgleichssitzungen %, Entscheidungen %, Uebernahmen %, Verkaeufe %, Positionen %, Erstattungen %, Lagerbewegungen %. Nach diesem Lauf muss jeder Wert gleich sein.',
    split_part(v.sales_recon_sessions, '|', 1), split_part(v.sales_recon_decisions, '|', 1),
    split_part(v.sales_recon_applications, '|', 1), split_part(v.sales, '|', 1),
    split_part(v.sale_items, '|', 1), split_part(v.sale_refunds, '|', 1),
    split_part(v.inventory_movements, '|', 1);
end
$lauf_a3$;

-- >>> EINGEBETTET: supabase/migrations/0180_sales_recon_selected_apply.sql
-- ===========================================================================
-- 0180 — SALES RECONCILIATION: ONLY PROVEN REPORT VALUES, ONLY THE SELECTED
--        DECISIONS, ONLY WITH THE PREVIEW'S TOKEN (ADR-0174 phase 4, ADR-0178)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- THE GAPS OF 0172/0173 (analysis of 2026-11-05):
--
--   * the decisions a finding allows depended on its FIELD only — a
--     `probable` or `ambiguous` pair could be taken over;
--   * category and certainty were the payload's claim, never checked;
--   * a finding's report value was never compared with the stored order;
--   * `manual` wrote free values and booked refunds and cancellations;
--   * the apply took EVERY pending decision of a session, bound only by a
--     count; the token of 0178 was information, not a lock;
--   * the apply wrote with `p_expected_updated_at => null`.
--
-- THE RULES OF 0180 (approved 2026-11-05):
--
--   1. Direction: report (CSV) → SkyIsles, nothing else.
--   2. `take_external` is the ONLY decision that writes. `keep_ledger` is a
--      note (reason optional), `defer` leaves the finding open. `manual` is
--      refused by `seller_recon_decide`; an old `manual` stays readable and
--      is never applied.
--   3. THE WHITELIST — the only fields an apply ever writes:
--        sold_on              → sales.sold_at
--        items_net            → sales.items_subtotal = report value + the
--                               EXISTING discount (the discount never moves)
--        shipping             → sales.shipping_charged
--        external_order_ref   → sales.external_order_ref, only while empty
--      `total`, `pieces`, `figure`: `keep_ledger` or `defer` only. Refunds
--      and cancellations go through the Orderbuch, never through this path.
--   4. A finding can be taken over only when the DATABASE proves it
--      (`sales_recon_take_check`), at decide, at preview and under lock at
--      apply — the same function every time:
--        * a pair, `exact` or `deviating`, certainty `deterministic` or
--          `unique`, no competitors;
--        * an external, non-test, not cancelled sale of the session's
--          channel, unchanged since the analysis;
--        * `deterministic`: the sale carries EXACTLY the order's number
--          (unique per channel since 0171) — every whitelisted field;
--        * `unique`: ONLY the missing order number. The sale has none, its
--          day lies within ±3 days of the order's, no other non-test sale
--          carries the number, and no unpaired rival exists — another sale
--          in the window, or another order of the session, that shares a
--          figure name with the pair. Day and amounts follow after a new
--          analysis, as `deterministic`;
--        * the report value equals the stored order (`sales_recon_orders`),
--          the SkyIsles value equals the sale, and the two differ;
--        * net and shipping: refused while the sale has a refund.
--   5. THE APPLY takes an explicit list of decision ids and the token of
--      `seller_recon_preview` for exactly that list. Under the session lock
--      and the locks of every sale it names (id order), it judges every
--      selected decision again and recomputes the token. One inadmissible
--      decision, or another token, and NOTHING is applied — the selection is
--      never reduced silently. Each sale is written in ONE call of
--      `seller_update_sale` (all its selected fields together) with
--      `p_expected_updated_at` = the locked version, so its own write is
--      never mistaken for a foreign one and a foreign one is still caught.
--   6. The old `seller_recon_apply(bigint, integer)` refuses in its body and
--      has no client right left.
--
-- WHAT THE DATABASE CANNOT PROVE. The order rows themselves come from the
-- browser parser (`seller_recon_create` checks their shape, not the CSV).
-- The NAME matching of `match.ts` — aliases, spelling tiers, the piece ratio
-- behind `unique` — and the score margin behind `competitors` are not
-- recomputed here: the database sees counts, amounts, days and order
-- numbers and EXACT figure names, not aliases or spellings. A `unique` pair
-- is therefore allowed to write one thing only, the order number, and its
-- rival check (an unpaired candidate sharing an exact name) is a
-- conservative stand-in for the margin, not a replacement for it.
--
-- AUDIT. Every decision stays a row of `sales_recon_decisions`, every
-- applied field a row of `sales_recon_applications` (old and new value, in
-- the forms 0179 reads), and `seller_update_sale` writes `orderbook_audit`.
-- One apply run shares one `applied_at` (the transaction's `now()`). No new
-- table (decision 8). A refused call rolls back and leaves no row.
--
-- UNCHANGED: every table, column, constraint, trigger, policy and row; the
-- read `seller_recon_session` (0179), `sales_recon_ledger`,
-- `sales_recon_proven`, `sales_recon_pending_set`, `sales_recon_sale_values`,
-- `seller_recon_create`. Backup (0174) and account deletion (0175) see no new
-- table and no new column. Errors name a state or a reason code, never a
-- value.
--
-- IT CONTAINS NO DATA STATEMENT.
--
-- Rollback: `supabase/rollback/R0180_sales_recon_apply_without_selection.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Which version stands here?
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_fn text;
  v_expected text;
  v_body text;
begin
  if to_regprocedure('public.sales_recon_ledger(bigint)') is null then
    raise exception '0180 needs 0179: sales_recon_ledger is missing';
  end if;
  if to_regprocedure('public.sales_recon_pending_set(bigint)') is null
     or to_regprocedure('public.sales_recon_sale_values(bigint)') is null then
    raise exception '0180 needs 0178: sales_recon_pending_set or sales_recon_sale_values is missing';
  end if;
  foreach v_fn in array array['sales_recon_allowed_0180(text)', 'sales_recon_take_check(bigint)',
                              'sales_recon_decision_problem(bigint,bigint)', 'sales_recon_check_selection(bigint[])',
                              'sales_recon_selection(bigint,bigint[])', 'seller_recon_preview(bigint,bigint[])',
                              'seller_recon_apply(bigint,bigint[],text)'] loop
    if to_regprocedure('public.' || v_fn) is not null then
      raise exception '0180 abort: % exists — applied here already', v_fn;
    end if;
  end loop;
  for v_fn, v_expected in values
      ('seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)', '2526d3a77ccf3153158182d0ecd391aa'),
      ('seller_recon_apply(bigint,integer)', 'f8b1132c27ba1b18123f6c2548f9997c'),
      ('seller_recon_pending(bigint)', '51213fd88afb5441a487dc89bba2ac06') loop
    select md5(p.prosrc) into v_body from pg_proc p where p.oid = to_regprocedure('public.' || v_fn);
    if v_body is distinct from v_expected then
      raise exception '0180 abort: % is % and not the expected body (%). A foreign version is not overwritten blindly.',
        v_fn, coalesce(v_body, '(none)'), v_expected;
    end if;
  end loop;
end
$pre$;


-- ---------------------------------------------------------------------------
-- 1. The decisions a field allows from 0180 on — the one place
-- ---------------------------------------------------------------------------
create or replace function public.sales_recon_allowed_0180(p_field text)
returns text[]
language sql immutable set search_path = ''
as $$
  select case
    when p_field in ('sold_on', 'items_net', 'shipping', 'external_order_ref')
      then array['take_external', 'keep_ledger', 'defer']
    when p_field in ('total', 'pieces', 'figure')
      then array['keep_ledger', 'defer']
    else array[]::text[] end
$$;

comment on function public.sales_recon_allowed_0180(text) is
  'The decisions a reconciliation finding allows from 0180 on (ADR-0178): take_external, keep_ledger, defer for sold_on, items_net, shipping and external_order_ref; keep_ledger and defer for total, pieces and figure. Never manual. Internal, no client right.';


-- ---------------------------------------------------------------------------
-- 2. May this finding be taken over — now? NULL = yes, else a reason code
-- ---------------------------------------------------------------------------
create or replace function public.sales_recon_take_check(p_finding_id bigint)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  f public.sales_recon_findings;
  m public.sales_recon_matches;
  o public.sales_recon_orders;
  s public.sales;
  v_channel text;
  v_net numeric;
  v_ship numeric;
  v_ext jsonb;
  v_led jsonb;
begin
  select * into f from public.sales_recon_findings where id = p_finding_id;
  if not found then return 'unknown_finding'; end if;
  -- The whitelist: only these four fields are ever written.
  if f.field not in ('sold_on', 'items_net', 'shipping', 'external_order_ref') then
    return 'field_not_takeable';
  end if;
  -- (In parentheses: a bare CASE would end the IF condition at its first THEN.)
  if f.kind is distinct from (case when f.field = 'external_order_ref' then 'addition' else 'deviation' end) then
    return 'finding_kind';
  end if;

  select * into m from public.sales_recon_matches where id = f.match_id;
  if m.order_id is null or m.sale_id is null then return 'not_a_pair'; end if;
  -- Only a certain pair: the category and the certainty must say so together.
  if m.category not in ('exact', 'deviating') or m.certainty is null
     or m.certainty not in ('deterministic', 'unique') then
    return 'uncertain';
  end if;
  if jsonb_typeof(m.competitors) is distinct from 'array' or jsonb_array_length(m.competitors) > 0 then
    return 'competitors';
  end if;

  select channel into v_channel from public.sales_recon_sessions where id = m.session_id;
  select * into o from public.sales_recon_orders where id = m.order_id;
  select * into s from public.sales where id = m.sale_id;
  if not found or s.channel is distinct from v_channel or o.channel is distinct from v_channel
     or s.order_id is not null then
    return 'not_external';
  end if;
  if s.is_test then return 'test_sale'; end if;
  -- Decision 5: a cancelled sale takes nothing over, a refunded one no amount.
  if s.cancelled_at is not null then return 'cancelled'; end if;
  if f.field in ('items_net', 'shipping')
     and exists (select 1 from public.sale_refunds r where r.sale_id = s.id) then
    return 'refunded';
  end if;
  if s.updated_at is distinct from m.sale_updated_at then return 'stale'; end if;

  -- THE PROOF OF THE PAIR.
  if m.certainty = 'deterministic' then
    -- The stored order number IS the identity (unique per channel, 0171).
    if s.external_order_ref is distinct from o.order_ref then return 'ref_mismatch'; end if;
  else
    -- `unique` (decision 3): only the missing order number, nothing else yet.
    if f.field <> 'external_order_ref' then return 'unique_ref_only'; end if;
    if s.external_order_ref is not null then return 'ref_present'; end if;
    -- Decision 10: the matching window of match.ts, ±3 days.
    if s.sold_at is null or abs(o.sold_on - s.sold_at) > 3 then return 'window'; end if;
  end if;

  -- THE PROOF OF THE VALUES: the report side is the stored order, the
  -- SkyIsles side the sale as it is (unchanged since the analysis), and the
  -- two differ — the rules of `diff.ts`, NULL amounts as 0.
  v_ext := f.external_value;
  v_led := f.ledger_value;
  v_net := round(coalesce(s.items_subtotal, 0) - coalesce(s.discount_amount, 0), 2);
  v_ship := round(coalesce(s.shipping_charged, 0), 2);
  case f.field
    when 'sold_on' then
      if jsonb_typeof(v_ext) is distinct from 'string' or v_ext #>> '{}' <> to_char(o.sold_on, 'YYYY-MM-DD') then
        return 'report_mismatch';
      end if;
      if s.sold_at is null or jsonb_typeof(v_led) is distinct from 'string'
         or v_led #>> '{}' <> to_char(s.sold_at, 'YYYY-MM-DD') then
        return 'ledger_mismatch';
      end if;
      if o.sold_on = s.sold_at then return 'no_difference'; end if;
    when 'items_net' then
      if jsonb_typeof(v_ext) is distinct from 'number' or round((v_ext #>> '{}')::numeric, 2) <> round(o.items_value, 2) then
        return 'report_mismatch';
      end if;
      if jsonb_typeof(v_led) is distinct from 'number' or round((v_led #>> '{}')::numeric, 2) <> v_net then
        return 'ledger_mismatch';
      end if;
      if round(o.items_value, 2) = v_net then return 'no_difference'; end if;
    when 'shipping' then
      if jsonb_typeof(v_ext) is distinct from 'number' or round((v_ext #>> '{}')::numeric, 2) <> round(o.shipping, 2) then
        return 'report_mismatch';
      end if;
      if jsonb_typeof(v_led) is distinct from 'number' or round((v_led #>> '{}')::numeric, 2) <> v_ship then
        return 'ledger_mismatch';
      end if;
      if round(o.shipping, 2) = v_ship then return 'no_difference'; end if;
    else -- external_order_ref, an addition
      if jsonb_typeof(v_ext) is distinct from 'string' or v_ext #>> '{}' <> o.order_ref then
        return 'report_mismatch';
      end if;
      -- Never overwrite: an existing reference — the same or another — ends it.
      if jsonb_typeof(v_led) is distinct from 'null' or s.external_order_ref is not null then
        return 'ref_present';
      end if;
      -- Independently of 0171's index: nobody else carries this number.
      if exists (select 1 from public.sales s2
                  where s2.channel = s.channel and s2.external_order_ref = o.order_ref
                    and s2.id <> s.id and not s2.is_test) then
        return 'ref_taken';
      end if;
      /*
       * NO UNPAIRED RIVAL. A competitor in `match.ts` is another candidate
       * within the score margin — and half the score is the NAME match. The
       * database cannot redo aliases and spelling tiers, but it can see an
       * exact name: another candidate the session left UNPAIRED within the
       * ±3 day window that shares a figure name (trimmed, case-insensitive)
       * with this pair is a rival, and the reference is refused. A rival
       * known only under another spelling stays unseen here — that is the
       * part of the name matching the database cannot prove.
       */
      if o.lines is null or jsonb_typeof(o.lines) is distinct from 'array' then
        return 'no_lines';
      end if;
      if exists (select 1 from public.sales s2
                  where s2.channel = s.channel and s2.id <> s.id and s2.order_id is null
                    and not s2.is_test and s2.cancelled_at is null and s2.external_order_ref is null
                    and s2.sold_at between o.sold_on - 3 and o.sold_on + 3
                    and not exists (select 1 from public.sales_recon_matches m2
                                     where m2.session_id = m.session_id and m2.sale_id = s2.id
                                       and m2.order_id is not null)
                    and exists (select 1 from public.sale_items i
                                  left join public.skylanders k on k.sky_id = i.sky_id
                                 where i.sale_id = s2.id
                                   and exists (select 1 from jsonb_array_elements(o.lines) l
                                                where lower(btrim(l ->> 'name')) in (lower(btrim(i.raw_name)),
                                                                                     lower(btrim(k.name)))))) then
        return 'rival_sale';
      end if;
      if exists (select 1 from public.sales_recon_orders o2
                  where o2.session_id = m.session_id and o2.id <> o.id
                    and o2.sold_on between s.sold_at - 3 and s.sold_at + 3
                    and jsonb_typeof(o2.lines) = 'array'
                    and not exists (select 1 from public.sales_recon_matches m2
                                     where m2.session_id = m.session_id and m2.order_id = o2.id
                                       and m2.sale_id is not null)
                    and exists (select 1 from jsonb_array_elements(o2.lines) l
                                  join public.sale_items i on i.sale_id = s.id
                                  left join public.skylanders k on k.sky_id = i.sky_id
                                 where lower(btrim(l ->> 'name')) in (lower(btrim(i.raw_name)), lower(btrim(k.name))))) then
        return 'rival_order';
      end if;
  end case;
  return null;
end;
$$;

comment on function public.sales_recon_take_check(bigint) is
  'May this reconciliation finding be taken over now (0180, ADR-0178)? NULL if yes, else a reason code: field_not_takeable, finding_kind, not_a_pair, uncertain, competitors, not_external, test_sale, cancelled, refunded, stale, ref_mismatch, unique_ref_only, ref_present, window, report_mismatch, ledger_mismatch, no_difference, ref_taken, no_lines, rival_sale, rival_order. Used by decide, preview and apply alike. Internal, no client right.';


-- ---------------------------------------------------------------------------
-- 3. Can this decision be applied in this session — now? NULL = yes
-- ---------------------------------------------------------------------------
create or replace function public.sales_recon_decision_problem(p_session_id bigint, p_decision_id bigint)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  d public.sales_recon_decisions;
  v_session bigint;
begin
  select * into d from public.sales_recon_decisions where id = p_decision_id;
  if not found then return 'unknown_decision'; end if;
  select m.session_id into v_session
    from public.sales_recon_findings f join public.sales_recon_matches m on m.id = f.match_id
   where f.id = d.finding_id;
  -- Another session's decision is not told apart from a missing one.
  if v_session is distinct from p_session_id then return 'unknown_decision'; end if;
  if exists (select 1 from public.sales_recon_decisions d2 where d2.finding_id = d.finding_id and d2.id > d.id) then
    return 'not_latest';
  end if;
  if exists (select 1 from public.sales_recon_applications a
               join public.sales_recon_decisions dx on dx.id = a.decision_id
              where dx.finding_id = d.finding_id) then
    return 'already_applied';
  end if;
  if d.decision = 'manual' then return 'manual'; end if;
  if d.decision <> 'take_external' then return 'no_change'; end if;
  return public.sales_recon_take_check(d.finding_id);
end;
$$;

comment on function public.sales_recon_decision_problem(bigint, bigint) is
  'Why one decision cannot be applied in one session now (0180): unknown_decision, not_latest, already_applied, manual, no_change, or the code of sales_recon_take_check; NULL if it can. Internal, no client right.';


/* A selection is a non-empty list of at most 500 distinct ids, without NULL. */
create or replace function public.sales_recon_check_selection(p_decision_ids bigint[])
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_decision_ids is null or cardinality(p_decision_ids) = 0 then
    raise exception 'a selection of decisions is required' using errcode = 'check_violation';
  end if;
  if cardinality(p_decision_ids) > 500 then
    raise exception 'a selection holds at most 500 decisions' using errcode = 'check_violation';
  end if;
  if array_position(p_decision_ids, null) is not null then
    raise exception 'a selection holds no empty entry' using errcode = 'check_violation';
  end if;
  if (select count(distinct x) from unnest(p_decision_ids) x) <> cardinality(p_decision_ids) then
    raise exception 'a selection names every decision once' using errcode = 'check_violation';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. The selection: every selected decision, judged, and its token
-- ---------------------------------------------------------------------------
create or replace function public.sales_recon_selection(p_session_id bigint, p_decision_ids bigint[])
returns jsonb
language sql stable security definer
set search_path = '' set "TimeZone" = 'UTC'
as $$
  with ids as (
    select distinct x as decision_id from unnest(p_decision_ids) x where x is not null
  ),
  judged as (
    select i.decision_id, public.sales_recon_decision_problem(p_session_id, i.decision_id) as problem
      from ids i
  ),
  -- A decision of another session shows nothing but its id and `unknown_decision`.
  sel as (
    select j.decision_id, j.problem, d.finding_id, f.field, d.decision, f.external_value, f.ledger_value,
           m.id as match_id, m.sale_id, m.sale_updated_at, s.updated_at as sale_now,
           o.order_ref, o.sold_on as r_sold, o.items_value as r_net, o.shipping as r_ship,
           case when m.sale_id is not null then public.sales_recon_sale_values(m.sale_id) end as now_values
      from judged j
      left join public.sales_recon_decisions d on d.id = j.decision_id and j.problem is distinct from 'unknown_decision'
      left join public.sales_recon_findings f on f.id = d.finding_id
      left join public.sales_recon_matches m on m.id = f.match_id and m.session_id = p_session_id
      left join public.sales_recon_orders o on o.id = m.order_id
      left join public.sales s on s.id = m.sale_id
  ),
  -- Old: the sale now. Target: the STORED ORDER's value — what the apply writes.
  shaped as (
    select x.*,
           case x.field
             when 'sold_on' then jsonb_build_object('soldOn', x.now_values -> 'soldOn')
             when 'items_net' then jsonb_build_object('itemsNet', x.now_values -> 'itemsNet',
                                                      'itemsSubtotal', x.now_values -> 'itemsSubtotal',
                                                      'discount', x.now_values -> 'discount')
             when 'shipping' then jsonb_build_object('shipping', x.now_values -> 'shipping')
             when 'external_order_ref' then jsonb_build_object('externalOrderRef', x.now_values -> 'externalOrderRef')
           end as old,
           case when x.problem is null then
             case x.field
               when 'sold_on' then jsonb_build_object('soldOn', to_jsonb(x.r_sold))
               when 'items_net' then jsonb_build_object(
                 'itemsNet', round(x.r_net, 2),
                 -- 0173, decision 4: the discount is never changed automatically.
                 'itemsSubtotal', round(x.r_net + (x.now_values ->> 'discount')::numeric, 2),
                 'discount', x.now_values -> 'discount')
               when 'shipping' then jsonb_build_object('shipping', round(x.r_ship, 2))
               when 'external_order_ref' then jsonb_build_object('externalOrderRef', x.order_ref)
             end
           end as target
      from sel x
  )
  select jsonb_build_object(
    'count', (select count(*) from shaped)::integer,
    'problems', (select count(*) from shaped where problem is not null)::integer,
    'admissible', (select count(*) > 0 and bool_and(problem is null) from shaped),
    'staleSales', (select count(distinct sale_id) from shaped where sale_now is distinct from sale_updated_at)::integer,
    'token', encode(sha256(convert_to('seller_recon_selection v1|' || p_session_id::text || '|' || coalesce((
      select jsonb_agg(jsonb_build_array(
               x.decision_id, x.problem, x.finding_id, x.match_id, x.sale_id, x.order_ref, x.field, x.decision,
               x.external_value, x.ledger_value, x.old, x.target,
               (extract(epoch from x.sale_updated_at) * 1000000)::bigint,
               (extract(epoch from x.sale_now) * 1000000)::bigint)
             order by x.decision_id)
        from shaped x), '[]'::jsonb)::text, 'UTF8')), 'hex'),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'decisionId', x.decision_id, 'problem', x.problem, 'findingId', x.finding_id,
               'matchId', x.match_id, 'saleId', x.sale_id, 'orderRef', x.order_ref, 'field', x.field,
               'decision', x.decision, 'old', x.old, 'target', x.target,
               'version', jsonb_build_object('analysed', x.sale_updated_at, 'current', x.sale_now))
             order by x.decision_id)
        from shaped x), '[]'::jsonb))
$$;

comment on function public.sales_recon_selection(bigint, bigint[]) is
  'One selection of reconciliation decisions (0180): per decision its problem (NULL = applicable), old value (the sale now) and target (the stored order''s value), plus count, problems, admissible and a SHA-256 token over session, sorted selection, values, identities and both sale versions. The one judgement preview and apply share. Internal, no client right.';


-- ---------------------------------------------------------------------------
-- 5. The preview, for the seller operator
-- ---------------------------------------------------------------------------
create or replace function public.seller_recon_preview(p_session_id bigint, p_decision_ids bigint[])
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_state text;
begin
  perform public.sales_recon_gate();
  perform public.sales_recon_check_selection(p_decision_ids);
  select state into v_state from public.sales_recon_sessions where id = p_session_id;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if v_state <> 'open' then
    -- Nothing can be applied where the session is not open (seller_recon_apply refuses).
    return jsonb_build_object('sessionId', p_session_id, 'state', v_state, 'sessionOpen', false,
                              'count', 0, 'problems', 0, 'admissible', false, 'staleSales', 0,
                              'token', null, 'changes', '[]'::jsonb);
  end if;
  return jsonb_build_object('sessionId', p_session_id, 'state', v_state, 'sessionOpen', true)
         || public.sales_recon_selection(p_session_id, p_decision_ids);
end;
$$;

comment on function public.seller_recon_preview(bigint, bigint[]) is
  'What seller_recon_apply(session, decision_ids, token) would do with exactly these decisions now (0180, ADR-0178): per decision its problem or old and target value, admissible, and the token the apply requires. Reads only.';


-- ---------------------------------------------------------------------------
-- 6. The apply — exactly the selection, exactly the token, under lock
-- ---------------------------------------------------------------------------
create or replace function public.seller_recon_apply(p_session_id bigint, p_decision_ids bigint[], p_token text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_state text;
  v_sel jsonb;
  v_codes text;
  v_conflict boolean;
  v_sale_id bigint;
  v_sale public.sales;
  v_c jsonb;
  v_sold_at date; v_subtotal numeric; v_shipping numeric; v_ref text;
  v_target numeric;
  v_applied integer := 0;
  v_sales integer := 0;
begin
  perform public.sales_recon_gate();
  perform public.sales_recon_check_selection(p_decision_ids);
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'the token of seller_recon_preview is required' using errcode = 'check_violation';
  end if;

  -- One apply or decision of this session at a time.
  select state into v_state from public.sales_recon_sessions where id = p_session_id for update;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if v_state <> 'open' then
    raise exception 'this session is % — nothing can be applied', v_state using errcode = 'restrict_violation';
  end if;

  -- Every sale the selection names, locked in id order BEFORE anything is judged.
  perform 1 from public.sales s
   where s.id in (select m.sale_id
                    from public.sales_recon_decisions d
                    join public.sales_recon_findings f on f.id = d.finding_id
                    join public.sales_recon_matches m on m.id = f.match_id
                   where d.id = any (p_decision_ids) and m.session_id = p_session_id)
   order by s.id
   for update;

  -- The same judgement as the preview, now under lock.
  v_sel := public.sales_recon_selection(p_session_id, p_decision_ids);
  select string_agg(distinct c ->> 'problem', ', ' order by c ->> 'problem'),
         bool_and(c ->> 'problem' in ('not_latest', 'already_applied', 'stale'))
    into v_codes, v_conflict
    from jsonb_array_elements(v_sel -> 'changes') c
   where c ->> 'problem' is not null;
  if v_codes is not null then
    raise exception '% of % selected decision(s) cannot be applied (%) — nothing was applied',
      v_sel ->> 'problems', v_sel ->> 'count', v_codes
      using errcode = case when v_conflict then 'PT409' else 'check_violation' end;
  end if;
  if (v_sel ->> 'token') is distinct from p_token then
    raise exception 'the selection changed since the preview — nothing was applied; preview again'
      using errcode = 'PT409';
  end if;

  for v_sale_id in select distinct (c ->> 'saleId')::bigint from jsonb_array_elements(v_sel -> 'changes') c order by 1 loop
    v_sales := v_sales + 1;
    select * into v_sale from public.sales where id = v_sale_id;
    v_sold_at := null; v_subtotal := null; v_shipping := null; v_ref := null;

    -- Every selected field of this sale, gathered into ONE write.
    for v_c in select c from jsonb_array_elements(v_sel -> 'changes') c
                where (c ->> 'saleId')::bigint = v_sale_id
                order by (c ->> 'decisionId')::bigint loop
      case v_c ->> 'field'
        when 'sold_on' then
          v_sold_at := (v_c -> 'target' ->> 'soldOn')::date;
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values ((v_c ->> 'decisionId')::bigint, p_session_id, v_sale_id, 'sold_on', 'applied',
                  to_char(v_sale.sold_at, 'YYYY-MM-DD'), to_char(v_sold_at, 'YYYY-MM-DD'), (select auth.uid()));
        when 'items_net' then
          v_target := (v_c -> 'target' ->> 'itemsNet')::numeric;
          v_subtotal := round(v_target + coalesce(v_sale.discount_amount, 0), 2);
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values ((v_c ->> 'decisionId')::bigint, p_session_id, v_sale_id, 'items_net', 'applied',
                  format('items_subtotal %s (net %s)', coalesce(v_sale.items_subtotal, 0),
                         coalesce(v_sale.items_subtotal, 0) - coalesce(v_sale.discount_amount, 0)),
                  format('items_subtotal %s (net %s)', v_subtotal, v_target), (select auth.uid()));
        when 'shipping' then
          v_shipping := (v_c -> 'target' ->> 'shipping')::numeric;
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values ((v_c ->> 'decisionId')::bigint, p_session_id, v_sale_id, 'shipping', 'applied',
                  v_sale.shipping_charged::text, v_shipping::text, (select auth.uid()));
        when 'external_order_ref' then
          v_ref := v_c -> 'target' ->> 'externalOrderRef';
          -- Checked already; checked again at the write, and 0171's index stands behind both.
          if v_sale.external_order_ref is not null then
            raise exception 'a selected sale already carries an order reference — nothing was applied'
              using errcode = 'restrict_violation';
          end if;
          if exists (select 1 from public.sales s2
                      where s2.channel = v_sale.channel and s2.external_order_ref = v_ref
                        and s2.id <> v_sale_id and not s2.is_test) then
            raise exception 'a selected order reference is already carried by another sale — nothing was applied'
              using errcode = 'unique_violation';
          end if;
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values ((v_c ->> 'decisionId')::bigint, p_session_id, v_sale_id, 'external_order_ref', 'applied',
                  null, v_ref, (select auth.uid()));
        else
          raise exception 'a selected field is not on the whitelist — nothing was applied' using errcode = 'check_violation';
      end case;
      v_applied := v_applied + 1;
    end loop;

    /*
     * ONE WRITE PER SALE, AGAINST THE LOCKED VERSION. Its own earlier fields
     * are in the same call, so nothing of this apply can look like a foreign
     * change; a foreign one cannot get past the lock, and should anything
     * have moved `updated_at`, `orderbook_guard_stale` refuses (PT409).
     */
    perform public.seller_update_sale(
      p_id => v_sale_id, p_sold_at => v_sold_at, p_clear_date => false, p_country => null,
      p_items_subtotal => v_subtotal, p_shipping_charged => v_shipping, p_discount_amount => null,
      p_external_ref => v_ref, p_buyer_ref => null, p_note => null, p_expected_updated_at => v_sale.updated_at);

    -- The session's view of this sale is the state it just wrote.
    update public.sales_recon_matches m
       set sale_updated_at = s.updated_at
      from public.sales s
     where m.session_id = p_session_id and m.sale_id = v_sale_id and s.id = v_sale_id;
  end loop;

  return jsonb_build_object('applied', v_applied, 'sales', v_sales, 'appliedAt', now());
end;
$$;

comment on function public.seller_recon_apply(bigint, bigint[], text) is
  'Applies exactly the selected reconciliation decisions (0180, ADR-0178): only take_external, only proven pairs and report values, only the whitelisted fields, bound to the token of seller_recon_preview and judged again under the session lock and the locks of every named sale. All or nothing; one seller_update_sale per sale against the locked version. Never sale_items, refunds, cancellations, inventory_movements or legacy_stock_events.';


-- ---------------------------------------------------------------------------
-- 7. Deciding — the body of 0172, with the rules of 0180
-- ---------------------------------------------------------------------------
create or replace function public.seller_recon_decide(
  p_finding_id bigint, p_decision text, p_manual_value jsonb, p_reason text,
  p_shown_ledger jsonb, p_shown_external jsonb)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_finding public.sales_recon_findings;
  v_match public.sales_recon_matches;
  v_state text;
  v_now_updated timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_problem text;
  v_id bigint;
begin
  perform public.sales_recon_gate();
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'an explanation has at most 500 characters' using errcode = 'check_violation';
  end if;
  perform public.sales_recon_no_contact(v_reason, 'reason');

  select * into v_finding from public.sales_recon_findings where id = p_finding_id;
  if not found then raise exception 'no such finding' using errcode = 'no_data_found'; end if;
  select * into v_match from public.sales_recon_matches where id = v_finding.match_id;
  select state into v_state from public.sales_recon_sessions where id = v_match.session_id for update;
  if v_state <> 'open' then
    raise exception 'this session is % — nothing more can be decided', v_state using errcode = 'restrict_violation';
  end if;
  if p_decision = 'manual' then
    raise exception 'a manual correction is not part of the report reconciliation (0180) — correct the sale in the Orderbuch'
      using errcode = 'check_violation';
  end if;
  if p_decision is null or not (p_decision = any (v_finding.allowed_decisions))
     or not (p_decision = any (public.sales_recon_allowed_0180(v_finding.field))) then
    raise exception 'this decision is not possible for the field %', v_finding.field using errcode = 'check_violation';
  end if;
  if p_manual_value is not null then
    raise exception 'a decision carries no value of its own' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.sales_recon_applications a
               join public.sales_recon_decisions d on d.id = a.decision_id
              where d.finding_id = p_finding_id) then
    raise exception 'this finding has already been applied' using errcode = 'restrict_violation';
  end if;

  -- The 0156 pattern: what the screen showed is what is stored, and the sale did not move.
  if coalesce(p_shown_ledger, 'null'::jsonb) is distinct from v_finding.ledger_value
     or coalesce(p_shown_external, 'null'::jsonb) is distinct from v_finding.external_value then
    raise exception 'the values shown are not the values of this finding — reload' using errcode = 'PT409';
  end if;
  select updated_at into v_now_updated from public.sales where id = v_match.sale_id;
  if v_now_updated is distinct from v_match.sale_updated_at then
    raise exception 'sale % changed since the analysis — analyse again', v_match.sale_id using errcode = 'PT409';
  end if;

  -- Taking over needs the proof the apply will ask for again.
  if p_decision = 'take_external' then
    v_problem := public.sales_recon_take_check(p_finding_id);
    if v_problem is not null then
      raise exception 'this finding cannot be taken over (%)', v_problem using errcode = 'check_violation';
    end if;
  end if;

  insert into public.sales_recon_decisions
    (finding_id, decision, manual_value, reason, shown_ledger, shown_external, decided_by)
  values (p_finding_id, p_decision, null, v_reason,
          coalesce(p_shown_ledger, 'null'::jsonb), coalesce(p_shown_external, 'null'::jsonb),
          (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. The open decisions of a session — the 0178 keys, judged by 0180
-- ---------------------------------------------------------------------------
create or replace function public.seller_recon_pending(p_session_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_state text;
  v_set jsonb;
  v_changes jsonb;
begin
  perform public.sales_recon_gate();
  select state into v_state from public.sales_recon_sessions where id = p_session_id;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if v_state <> 'open' then
    return jsonb_build_object('sessionId', p_session_id, 'state', v_state, 'sessionOpen', false,
                              'count', 0, 'admissible', 0, 'staleSales', 0, 'token', null, 'changes', '[]'::jsonb);
  end if;
  v_set := public.sales_recon_pending_set(p_session_id);
  -- Every open decision with the reason it cannot be applied (NULL = it can, via preview).
  select coalesce(jsonb_agg(c || jsonb_build_object('problem',
                    public.sales_recon_decision_problem(p_session_id, (c ->> 'decisionId')::bigint))
                  order by (c ->> 'decisionId')::bigint), '[]'::jsonb)
    into v_changes
    from jsonb_array_elements(v_set -> 'changes') c;
  return jsonb_build_object('sessionId', p_session_id, 'state', v_state, 'sessionOpen', true)
         || v_set
         || jsonb_build_object('changes', v_changes,
                               'admissible', (select count(*) from jsonb_array_elements(v_changes) c
                                               where c ->> 'problem' is null)::integer);
end;
$$;

comment on function public.seller_recon_pending(bigint) is
  'The open take_external and manual decisions of one open session (0178), each with the reason 0180 refuses it (problem; NULL = applicable through seller_recon_preview and seller_recon_apply(session, decision_ids, token)), and the number of applicable ones. Reads only.';


-- ---------------------------------------------------------------------------
-- 9. The old apply: refused in its body, and no client right left
-- ---------------------------------------------------------------------------
create or replace function public.seller_recon_apply(p_session_id bigint, p_expected integer)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform public.sales_recon_gate();
  raise exception 'seller_recon_apply(session, expected) was retired by 0180 — use seller_recon_preview and '
    'seller_recon_apply(session, decision_ids, token); nothing was applied'
    using errcode = 'feature_not_supported';
end;
$$;

comment on function public.seller_recon_apply(bigint, integer) is
  'Retired by 0180 (ADR-0178): refuses every call and applies nothing. The apply is seller_recon_apply(bigint, bigint[], text) with the token of seller_recon_preview.';


-- ---------------------------------------------------------------------------
-- 10. Rights
-- ---------------------------------------------------------------------------
revoke all on function public.seller_recon_apply(bigint, integer) from public, anon, authenticated;

revoke all on function public.sales_recon_allowed_0180(text) from public, anon, authenticated;
revoke all on function public.sales_recon_take_check(bigint) from public, anon, authenticated;
revoke all on function public.sales_recon_decision_problem(bigint, bigint) from public, anon, authenticated;
revoke all on function public.sales_recon_check_selection(bigint[]) from public, anon, authenticated;
revoke all on function public.sales_recon_selection(bigint, bigint[]) from public, anon, authenticated;

revoke all on function public.seller_recon_preview(bigint, bigint[]) from public, anon;
revoke all on function public.seller_recon_apply(bigint, bigint[], text) from public, anon;
grant execute on function public.seller_recon_preview(bigint, bigint[]) to authenticated;
grant execute on function public.seller_recon_apply(bigint, bigint[], text) to authenticated;


-- ---------------------------------------------------------------------------
-- 11. Postcondition
-- ---------------------------------------------------------------------------
do $post$
declare
  v_fn text;
  v_expected text;
begin
  for v_fn, v_expected in values
      ('sales_recon_allowed_0180(text)', '56a9899eaf5465f1b90acc0ccb986b38'),
      ('sales_recon_take_check(bigint)', 'bce45f42855c25fc428cab86bd7cf081'),
      ('sales_recon_decision_problem(bigint,bigint)', 'ed9d427a8657e78c77ef70d53cc42410'),
      ('sales_recon_check_selection(bigint[])', 'b382e469fb58fa8a756f24910b9a8cc8'),
      ('sales_recon_selection(bigint,bigint[])', '97c3461ea718a4694d06cf1fc1280a22'),
      ('seller_recon_preview(bigint,bigint[])', 'f3bc1d34fa3e7b843ca609fe7b0f5569'),
      ('seller_recon_apply(bigint,bigint[],text)', 'b96ceff990dafa33674c71e928c713bb'),
      ('seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)', 'dffdbe5b16fa39989de47c9c61a77911'),
      ('seller_recon_pending(bigint)', 'dc140b5971bc752e90ad2344b3db2712'),
      ('seller_recon_apply(bigint,integer)', '72cc0079c007847cabd4db20a6109a0c'),
      -- Untouched by 0180:
      ('seller_recon_session(bigint,text,integer,integer)', '5ed52447581cc895efc6a56f268c0da3'),
      ('sales_recon_ledger(bigint)', '07875fe3ba889fefab1c55dbe67005d9'),
      ('sales_recon_proven(jsonb,text,jsonb,boolean)', 'b7b36ccd5efdd57e661808b62274df68'),
      ('sales_recon_pending_set(bigint)', '3228eb12e00d7982c5cad5c42ea6f773'),
      ('sales_recon_sale_values(bigint)', '4c4a01eb05adb6d439450063f04eada9') loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.' || v_fn)) is distinct from v_expected then
      raise exception '0180 postcondition: % is not the expected body', v_fn;
    end if;
  end loop;

  -- Every reconciliation entry point and helper of 0180: definer, one empty search_path.
  foreach v_fn in array array['sales_recon_take_check(bigint)', 'sales_recon_decision_problem(bigint,bigint)',
                              'sales_recon_selection(bigint,bigint[])', 'seller_recon_preview(bigint,bigint[])',
                              'seller_recon_apply(bigint,bigint[],text)', 'seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)',
                              'seller_recon_pending(bigint)', 'seller_recon_apply(bigint,integer)'] loop
    if not exists (select 1 from pg_proc p
                    where p.oid = to_regprocedure('public.' || v_fn)
                      and p.prosecdef
                      and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
                      and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                             from unnest(p.proconfig) c where c like 'search\_path=%')) then
      raise exception '0180 postcondition: % is not a security definer with an empty search_path', v_fn;
    end if;
  end loop;

  -- The seller entry points: authenticated only.
  foreach v_fn in array array['seller_recon_preview(bigint,bigint[])', 'seller_recon_apply(bigint,bigint[],text)',
                              'seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)', 'seller_recon_pending(bigint)'] loop
    if not has_function_privilege('authenticated', 'public.' || v_fn, 'execute')
       or has_function_privilege('anon', 'public.' || v_fn, 'execute') then
      raise exception '0180 postcondition: the rights on % are not authenticated-only', v_fn;
    end if;
  end loop;

  -- The old apply and the helpers: no client role at all, PUBLIC included.
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in (to_regprocedure('public.seller_recon_apply(bigint,integer)'),
                              to_regprocedure('public.sales_recon_allowed_0180(text)'),
                              to_regprocedure('public.sales_recon_take_check(bigint)'),
                              to_regprocedure('public.sales_recon_decision_problem(bigint,bigint)'),
                              to_regprocedure('public.sales_recon_check_selection(bigint[])'),
                              to_regprocedure('public.sales_recon_selection(bigint,bigint[])'))
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) then
    raise exception '0180 postcondition: a client role may execute the old apply or a helper of 0180';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in (to_regprocedure('public.seller_recon_preview(bigint,bigint[])'),
                              to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)'))
                and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '0180 postcondition: PUBLIC may execute the preview or the apply';
  end if;
  raise notice '0180: decide refuses manual and unproven take-overs; preview and apply(session, decision_ids, token) '
    'judge alike; the old apply refuses and has no client right. No row touched.';
end
$post$;
-- <<< ENDE: supabase/migrations/0180_sales_recon_selected_apply.sql

/* Z0 — dieselben Messungen nachher, in derselben Form. */
create temporary table recon_0180_nachher on commit drop as
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
    where n.nspname = 'public' and p.proname not in ('sales_recon_allowed_0180', 'sales_recon_take_check', 'sales_recon_decision_problem', 'sales_recon_check_selection', 'sales_recon_selection', 'seller_recon_preview', 'seller_recon_apply')) as funktionsrechte,
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
  if exists (select 1 from pg_temp.recon_0180_vorher v, pg_temp.recon_0180_nachher n
              where (v.sales_recon_sessions, v.sales_recon_files, v.sales_recon_orders, v.sales_recon_matches, v.sales_recon_findings, v.sales_recon_decisions, v.sales_recon_applications, v.sales, v.sale_items, v.sale_refunds, v.inventory_movements, v.legacy_stock_events, v.orderbook_audit, v.shop_inventory, v.collection_items, v.funktionsrechte, v.tabellenrechte, v.policies)
                    is distinct from (n.sales_recon_sessions, n.sales_recon_files, n.sales_recon_orders, n.sales_recon_matches, n.sales_recon_findings, n.sales_recon_decisions, n.sales_recon_applications, n.sales, n.sale_items, n.sale_refunds, n.inventory_movements, n.legacy_stock_events, n.orderbook_audit, n.shop_inventory, n.collection_items, n.funktionsrechte, n.tabellenrechte, n.policies)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Daten, Rechte oder Policies bewegt — nichts wird angewendet';
  end if;

  /* Z2 — die Fassung aus 0180 steht, und alles, was 0180 nicht anfassen darf, ist das alte. */
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_allowed_0180(text)')) is distinct from '56a9899eaf5465f1b90acc0ccb986b38'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_take_check(bigint)')) is distinct from 'bce45f42855c25fc428cab86bd7cf081'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_decision_problem(bigint,bigint)')) is distinct from 'ed9d427a8657e78c77ef70d53cc42410'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_check_selection(bigint[])')) is distinct from 'b382e469fb58fa8a756f24910b9a8cc8'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_selection(bigint,bigint[])')) is distinct from '97c3461ea718a4694d06cf1fc1280a22'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_preview(bigint,bigint[])')) is distinct from 'f3bc1d34fa3e7b843ca609fe7b0f5569'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)')) is distinct from 'b96ceff990dafa33674c71e928c713bb'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)')) is distinct from 'dffdbe5b16fa39989de47c9c61a77911'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_pending(bigint)')) is distinct from 'dc140b5971bc752e90ad2344b3db2712'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_apply(bigint,integer)')) is distinct from '72cc0079c007847cabd4db20a6109a0c'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)')) is distinct from '5ed52447581cc895efc6a56f268c0da3'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_ledger(bigint)')) is distinct from '07875fe3ba889fefab1c55dbe67005d9'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_proven(jsonb,text,jsonb,boolean)')) is distinct from 'b7b36ccd5efdd57e661808b62274df68'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_pending_set(bigint)')) is distinct from '3228eb12e00d7982c5cad5c42ea6f773'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_sale_values(bigint)')) is distinct from '4c4a01eb05adb6d439450063f04eada9'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_create(jsonb)')) is distinct from '21fab5ff4ea2c7cb2550f3db821fce0f' then
    raise exception 'ABBRUCH Z2: die Fassung aus 0180 steht nicht, oder Lesefunktion/Ledger/Anlegen haben sich bewegt';
  end if;

  /* Z3 — die Rechte, die 0180 aendert: alte Uebernahme und Helfer fuer niemanden, Vorschau und Uebernahme nur authenticated. */
  if (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.seller_recon_apply(bigint,integer)'),
                        to_regprocedure('public.sales_recon_allowed_0180(text)'),
                        to_regprocedure('public.sales_recon_take_check(bigint)'),
                        to_regprocedure('public.sales_recon_decision_problem(bigint,bigint)'),
                        to_regprocedure('public.sales_recon_check_selection(bigint[])'),
                        to_regprocedure('public.sales_recon_selection(bigint,bigint[])'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) <> '0'
     or not (select (has_function_privilege('authenticated', to_regprocedure('public.seller_recon_preview(bigint,bigint[])'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_recon_preview(bigint,bigint[])'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_recon_preview(bigint,bigint[])') and a.privilege_type = 'EXECUTE' and a.grantee = 0))::text
         )::boolean
     or not (select (has_function_privilege('authenticated', to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))::text
         )::boolean then
    raise exception 'ABBRUCH Z3: die alte Uebernahme oder ein Helfer ist fuer eine Clientrolle ausfuehrbar, oder Vorschau/Uebernahme nicht nur fuer authenticated';
  end if;

  raise notice '0180 ok: nur ausgewaehlte, nachgewiesene Uebernahmen mit Token; die alte Uebernahme weist ab. Keine Zeile bewegt.';
end
$lauf_z$;

commit;
