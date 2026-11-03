-- ===========================================================================
-- STAGING — EIN LAUF FUER 0176
--            (der Verkaufsabgleich weist verbotene Inhalte auch bei einem
--             bereits bekannten Upload ab — ADR-0177)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0176`, diese Datei,
-- `npm run db:migrate:staging -- 0176 --resume`
-- (Laufzettel: `supabase/checks/0176_staging_run.md`).
--
-- DIE MIGRATION IST ZEICHENGLEICH EINGEBETTET. Sie legt eine Pruef-
-- funktion an und ersetzt einen Funktionsrumpf; bricht sie ab, ist nichts
-- angewendet.
--
-- SIE AENDERT KEINE DATEN. A2 misst die fuenf Tabellen, die
-- `seller_recon_create` beschreibt, vorher — jede Spalte —, Z1 misst sie
-- nachher und bricht ab, wenn sich auch nur ein Wert bewegt hat.
--
-- NUR STAGING. Production ist eine eigene, spaetere Entscheidung (ADR-0177).
--
-- ERWARTET: die NOTICE-Zeilen A3 und `0176 ok`, dann `commit`.
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

/* A2 — die Abgleichsdaten, vorher gemessen, JEDE Spalte (Temporaertabelle, faellt mit commit). */
create temporary table recon_0176_vorher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_sessions t) as sitzungen,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_files t) as dateien,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_orders t) as bestellungen,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_matches t) as zuordnungen,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_findings t) as befunde;

do $lauf_a3$
declare v record;
begin
  select * into v from pg_temp.recon_0176_vorher;
  raise notice 'A3: Sitzungen %, Dateien %, Bestellungen %, Zuordnungen %, Befunde %. Nach diesem Lauf muss jede Zeile gleich sein.',
    split_part(v.sitzungen, '|', 1), split_part(v.dateien, '|', 1), split_part(v.bestellungen, '|', 1),
    split_part(v.zuordnungen, '|', 1), split_part(v.befunde, '|', 1);
end
$lauf_a3$;

-- >>> EINGEBETTET: supabase/migrations/0176_sales_recon_validate_before_dedup.sql
-- ---------------------------------------------------------------------------
-- 0176 — a known upload with forbidden content is refused, not recognised
--        (ADR-0177)
--
-- THE GAP IN 0172. `seller_recon_create` recognises the same upload: an OPEN
-- session with the same set of files is returned instead of a second one.
-- That lookup ran right after the top-level keys and the file entries were
-- checked — BEFORE orders, lines, matches and findings were looked at. So a
-- known upload that carried a buyer field (`buyerName`) or an e-mail address
-- in a title came back as a SUCCESS: the existing session's id. Nothing was
-- stored — the content was never read — but nothing was refused either, and
-- the third of the three privacy barriers (ADR-0174 no. 2) did not hold for
-- every call. The Staging functional test of 2026-11-03 (run `mw12dxva`)
-- found it: its two refusal probes reused the main session's files.
--
-- THE FIX. A new, pure function `sales_recon_validate_payload(jsonb)` checks
-- EVERY rule of the payload's shape and content — keys, types, lengths,
-- days, numbers, the contact-data barrier — and touches no table.
-- `seller_recon_create` calls it directly after the operator gate, before
-- the recognition. Its body is otherwise character for character the one
-- from 0172; the per-row checks while inserting stay (a second barrier, and
-- the only place for what depends on the database: a sale that exists, an
-- order that is in the session, a stale sale → PT409).
--
-- WHAT DOES NOT CHANGE. A correct known upload still returns its session,
-- without looking at the sales again (as before). Rights: the new function
-- is closed to every client role like the other helpers; `create or replace`
-- keeps the ACL of `seller_recon_create` (authenticated may execute).
--
-- IT CONTAINS NO DATA STATEMENT.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Which version stands here?
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_body text;
begin
  if to_regprocedure('public.seller_recon_create(jsonb)') is null
     or to_regprocedure('public.sales_recon_only_keys(jsonb,text[],text)') is null
     or to_regprocedure('public.sales_recon_no_contact(text,text)') is null then
    raise exception '0176 needs 0172: seller_recon_create or its helpers are missing';
  end if;
  if to_regprocedure('public.sales_recon_validate_payload(jsonb)') is not null then
    raise exception '0176 abort: sales_recon_validate_payload exists — applied here already';
  end if;
  select md5(p.prosrc) into v_body from pg_proc p
   where p.oid = to_regprocedure('public.seller_recon_create(jsonb)');
  if v_body is distinct from 'c54080be8908ef61589629314c1c0d9c' then
    raise exception '0176 abort: seller_recon_create(jsonb) is % and not the body from 0172 '
      '(c54080be8908ef61589629314c1c0d9c). A foreign version is not overwritten blindly.',
      coalesce(v_body, '(none)');
  end if;
end
$pre$;


-- ---------------------------------------------------------------------------
-- 2. The whole payload, checked without a table
-- ---------------------------------------------------------------------------
create or replace function public.sales_recon_validate_payload(p_payload jsonb)
returns void
language plpgsql immutable set search_path = ''
as $$
declare
  v_channel text;
  v_files jsonb; v_orders jsonb; v_matches jsonb; v_coverage jsonb; v_summary jsonb;
  v_file jsonb; v_order jsonb; v_line jsonb; v_match jsonb; v_finding jsonb; v_item jsonb;
begin
  perform public.sales_recon_only_keys(p_payload,
    array['channel', 'parser', 'parserVersion', 'coverage', 'summary', 'files', 'orders', 'matches'], 'payload');
  v_channel := public.sales_recon_text(p_payload, 'channel', 16, true, 'payload');
  if v_channel not in ('ebay') then
    raise exception 'unknown channel' using errcode = 'check_violation';
  end if;
  perform public.sales_recon_text(p_payload, 'parser', 64, true, 'payload');
  perform public.sales_recon_number(p_payload, 'parserVersion', 1, 1000, true, 'payload');
  v_files := public.sales_recon_array(p_payload, 'files', 100, 'payload');
  v_orders := public.sales_recon_array(p_payload, 'orders', 5000, 'payload');
  v_matches := public.sales_recon_array(p_payload, 'matches', 10000, 'payload');
  if jsonb_array_length(v_files) = 0 then
    raise exception 'a session needs at least one file' using errcode = 'check_violation';
  end if;

  v_coverage := coalesce(p_payload -> 'coverage', '{}'::jsonb);
  perform public.sales_recon_only_keys(v_coverage,
    array['coveredFrom', 'coveredTo', 'recordFirst', 'recordLast', 'chainComplete'], 'coverage');
  if jsonb_typeof(v_coverage -> 'chainComplete') is distinct from 'boolean' then
    raise exception 'coverage.chainComplete must be true or false' using errcode = 'check_violation';
  end if;
  perform public.sales_recon_day(v_coverage, 'coveredFrom', false, 'coverage');
  perform public.sales_recon_day(v_coverage, 'coveredTo', false, 'coverage');
  perform public.sales_recon_number(v_coverage, 'recordFirst', 0, 100000000, false, 'coverage');
  perform public.sales_recon_number(v_coverage, 'recordLast', 0, 100000000, false, 'coverage');

  v_summary := coalesce(p_payload -> 'summary', '{}'::jsonb);
  if jsonb_typeof(v_summary) <> 'object' or not public.sales_recon_numbers_only(v_summary) then
    raise exception 'summary may hold numbers only' using errcode = 'check_violation';
  end if;

  for v_file in select * from jsonb_array_elements(v_files) loop
    perform public.sales_recon_only_keys(v_file,
      array['fileName', 'fingerprint', 'footerCount', 'orders', 'firstSoldOn', 'lastSoldOn', 'recordFirst', 'recordLast'], 'file');
    perform public.sales_recon_text(v_file, 'fileName', 200, true, 'file');
    perform public.sales_recon_text(v_file, 'fingerprint', 64, true, 'file');
    perform public.sales_recon_number(v_file, 'footerCount', 0, 1000000, false, 'file');
    perform public.sales_recon_number(v_file, 'orders', 0, 1000000, true, 'file');
    perform public.sales_recon_day(v_file, 'firstSoldOn', false, 'file');
    perform public.sales_recon_day(v_file, 'lastSoldOn', false, 'file');
    perform public.sales_recon_number(v_file, 'recordFirst', 0, 100000000, false, 'file');
    perform public.sales_recon_number(v_file, 'recordLast', 0, 100000000, false, 'file');
  end loop;

  for v_order in select * from jsonb_array_elements(v_orders) loop
    perform public.sales_recon_only_keys(v_order,
      array['channel', 'orderRef', 'recordNo', 'soldOn', 'paidOn', 'shippedOn', 'itemsValue', 'shipping', 'total',
            'pieces', 'combined', 'destinationCountry', 'shippingService', 'sourceFile', 'lines'], 'order');
    if coalesce(v_order ->> 'channel', v_channel) <> v_channel then
      raise exception 'an order of another channel' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_order -> 'combined') is distinct from 'boolean' then
      raise exception 'order.combined must be true or false' using errcode = 'check_violation';
    end if;
    for v_line in select * from jsonb_array_elements(public.sales_recon_array(v_order, 'lines', 500, 'order')) loop
      perform public.sales_recon_only_keys(v_line,
        array['lineRef', 'listingId', 'title', 'variant', 'name', 'quantity', 'unitPrice', 'value'], 'line');
      perform public.sales_recon_text(v_line, 'lineRef', 64, false, 'line');
      perform public.sales_recon_text(v_line, 'listingId', 32, true, 'line');
      perform public.sales_recon_text(v_line, 'title', 300, true, 'line');
      perform public.sales_recon_text(v_line, 'variant', 300, false, 'line');
      perform public.sales_recon_text(v_line, 'name', 200, true, 'line');
      perform public.sales_recon_number(v_line, 'quantity', 1, 10000, true, 'line');
      perform public.sales_recon_number(v_line, 'unitPrice', 0, 1000000, true, 'line');
      perform public.sales_recon_number(v_line, 'value', 0, 1000000, true, 'line');
    end loop;
    perform public.sales_recon_text(v_order, 'orderRef', 64, true, 'order');
    perform public.sales_recon_number(v_order, 'recordNo', 0, 100000000, false, 'order');
    perform public.sales_recon_day(v_order, 'soldOn', true, 'order');
    perform public.sales_recon_day(v_order, 'paidOn', false, 'order');
    perform public.sales_recon_day(v_order, 'shippedOn', false, 'order');
    perform public.sales_recon_number(v_order, 'itemsValue', 0, 1000000, true, 'order');
    perform public.sales_recon_number(v_order, 'shipping', 0, 1000000, true, 'order');
    perform public.sales_recon_number(v_order, 'total', 0, 1000000, true, 'order');
    perform public.sales_recon_number(v_order, 'pieces', 0, 10000, true, 'order');
    perform public.sales_recon_text(v_order, 'destinationCountry', 2, false, 'order');
    perform public.sales_recon_text(v_order, 'shippingService', 100, false, 'order');
    perform public.sales_recon_text(v_order, 'sourceFile', 200, true, 'order');
  end loop;

  for v_match in select * from jsonb_array_elements(v_matches) loop
    perform public.sales_recon_only_keys(v_match,
      array['orderRef', 'saleId', 'saleUpdatedAt', 'category', 'certainty', 'score', 'dateDelta',
            'competitors', 'reason', 'findings'], 'match');
    perform public.sales_recon_text(v_match, 'orderRef', 64, false, 'match');
    if public.sales_recon_number(v_match, 'saleId', 1, 9223372036854775807, false, 'match') is not null then
      perform (public.sales_recon_text(v_match, 'saleUpdatedAt', 40, true, 'match'))::timestamptz;
    end if;
    for v_item in select * from jsonb_array_elements(public.sales_recon_array(v_match, 'competitors', 50, 'match')) loop
      perform public.sales_recon_only_keys(v_item, array['orderRef', 'saleId', 'score'], 'competitor');
      perform public.sales_recon_text(v_item, 'orderRef', 64, true, 'competitor');
      perform public.sales_recon_number(v_item, 'saleId', 1, 9223372036854775807, true, 'competitor');
      perform public.sales_recon_number(v_item, 'score', -1000, 1000, true, 'competitor');
    end loop;
    perform public.sales_recon_text(v_match, 'category', 32, true, 'match');
    perform public.sales_recon_text(v_match, 'certainty', 32, false, 'match');
    perform public.sales_recon_number(v_match, 'score', -1000, 1000, false, 'match');
    perform public.sales_recon_number(v_match, 'dateDelta', -100000, 100000, false, 'match');
    perform public.sales_recon_text(v_match, 'reason', 32, false, 'match');

    for v_finding in select * from jsonb_array_elements(public.sales_recon_array(v_match, 'findings', 200, 'match')) loop
      perform public.sales_recon_only_keys(v_finding,
        array['key', 'field', 'kind', 'ledger', 'external', 'delta', 'causes'], 'finding');
      if v_match -> 'orderRef' is null or jsonb_typeof(v_match -> 'orderRef') = 'null'
         or v_match -> 'saleId' is null or jsonb_typeof(v_match -> 'saleId') = 'null' then
        raise exception 'only a pair of order and sale has findings' using errcode = 'check_violation';
      end if;
      perform public.sales_recon_text(v_finding, 'key', 32, true, 'finding');
      perform public.sales_recon_text(v_finding, 'field', 32, true, 'finding');
      if jsonb_typeof(coalesce(v_finding -> 'ledger', 'null'::jsonb)) not in ('string', 'number', 'null')
         or jsonb_typeof(coalesce(v_finding -> 'external', 'null'::jsonb)) not in ('string', 'number', 'null')
         or length(coalesce(v_finding ->> 'ledger', '')) > 300
         or length(coalesce(v_finding ->> 'external', '')) > 300 then
        raise exception 'a finding value is one short scalar' using errcode = 'check_violation';
      end if;
      if jsonb_typeof(v_finding -> 'ledger') = 'string' then
        perform public.sales_recon_no_contact(v_finding ->> 'ledger', 'finding.ledger');
      end if;
      if jsonb_typeof(v_finding -> 'external') = 'string' then
        perform public.sales_recon_no_contact(v_finding ->> 'external', 'finding.external');
      end if;
      for v_item in select * from jsonb_array_elements(public.sales_recon_array(v_finding, 'causes', 20, 'finding')) loop
        perform public.sales_recon_only_keys(v_item, array['code', 'amount'], 'cause');
        if public.sales_recon_text(v_item, 'code', 64, true, 'cause') !~ '^[a-z_]+$' then
          raise exception 'a cause code is a plain word' using errcode = 'check_violation';
        end if;
        perform public.sales_recon_number(v_item, 'amount', -1000000, 1000000, false, 'cause');
      end loop;
      perform public.sales_recon_text(v_finding, 'kind', 16, true, 'finding');
      perform public.sales_recon_number(v_finding, 'delta', -100000000, 100000000, false, 'finding');
    end loop;
  end loop;
end;
$$;

revoke all on function public.sales_recon_validate_payload(jsonb) from public, anon, authenticated;

comment on function public.sales_recon_validate_payload(jsonb) is
  'Checks every rule of a reconciliation payload (0176, ADR-0177): keys, types, lengths, days, numbers and the contact-data barrier, for payload, coverage, summary, files, orders, lines, matches, competitors, findings and causes. Reads no table. Called by seller_recon_create BEFORE it recognises a known upload, so forbidden content is refused on every call. Closed to every client role.';


-- ---------------------------------------------------------------------------
-- 3. seller_recon_create — the body of 0172 plus the check up front
-- ---------------------------------------------------------------------------
create or replace function public.seller_recon_create(p_payload jsonb)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_channel text;
  v_session bigint;
  v_files jsonb; v_orders jsonb; v_matches jsonb; v_coverage jsonb; v_summary jsonb;
  v_file jsonb; v_order jsonb; v_line jsonb; v_match jsonb; v_finding jsonb; v_item jsonb;
  v_files_key text;
  v_order_id bigint; v_match_id bigint; v_sale public.sales; v_seen timestamptz;
  v_field text; v_key text;
begin
  perform public.sales_recon_gate();
  /*
   * 0176: THE WHOLE PAYLOAD IS CHECKED FIRST — before the same upload is
   * recognised below. Until 0176 an open session with the same files was
   * returned before orders, lines, matches and findings were looked at, so a
   * known upload carrying a buyer field or an e-mail address came back as a
   * success (nothing was stored — but nothing was refused either).
   */
  perform public.sales_recon_validate_payload(p_payload);
  perform public.sales_recon_only_keys(p_payload,
    array['channel', 'parser', 'parserVersion', 'coverage', 'summary', 'files', 'orders', 'matches'], 'payload');

  v_channel := public.sales_recon_text(p_payload, 'channel', 16, true, 'payload');
  if v_channel not in ('ebay') then
    raise exception 'unknown channel' using errcode = 'check_violation';
  end if;
  v_files := public.sales_recon_array(p_payload, 'files', 100, 'payload');
  v_orders := public.sales_recon_array(p_payload, 'orders', 5000, 'payload');
  v_matches := public.sales_recon_array(p_payload, 'matches', 10000, 'payload');
  if jsonb_array_length(v_files) = 0 then
    raise exception 'a session needs at least one file' using errcode = 'check_violation';
  end if;

  v_coverage := coalesce(p_payload -> 'coverage', '{}'::jsonb);
  perform public.sales_recon_only_keys(v_coverage,
    array['coveredFrom', 'coveredTo', 'recordFirst', 'recordLast', 'chainComplete'], 'coverage');
  if jsonb_typeof(v_coverage -> 'chainComplete') is distinct from 'boolean' then
    raise exception 'coverage.chainComplete must be true or false' using errcode = 'check_violation';
  end if;

  v_summary := coalesce(p_payload -> 'summary', '{}'::jsonb);
  if jsonb_typeof(v_summary) <> 'object' or not public.sales_recon_numbers_only(v_summary) then
    raise exception 'summary may hold numbers only' using errcode = 'check_violation';
  end if;

  -- The same set of files as an OPEN session: that session, not a second one.
  for v_file in select * from jsonb_array_elements(v_files) loop
    perform public.sales_recon_only_keys(v_file,
      array['fileName', 'fingerprint', 'footerCount', 'orders', 'firstSoldOn', 'lastSoldOn', 'recordFirst', 'recordLast'], 'file');
  end loop;
  select string_agg(distinct f ->> 'fingerprint', ',' order by f ->> 'fingerprint')
    into v_files_key from jsonb_array_elements(v_files) f;
  select id into v_session from public.sales_recon_sessions
   where channel = v_channel and files_key = v_files_key and state = 'open';
  if v_session is not null then
    return v_session;
  end if;

  insert into public.sales_recon_sessions
    (channel, parser, parser_version, files_key, covered_from, covered_to, record_first, record_last,
     chain_complete, summary, created_by)
  values (v_channel,
          public.sales_recon_text(p_payload, 'parser', 64, true, 'payload'),
          public.sales_recon_number(p_payload, 'parserVersion', 1, 1000, true, 'payload')::integer,
          v_files_key,
          public.sales_recon_day(v_coverage, 'coveredFrom', false, 'coverage'),
          public.sales_recon_day(v_coverage, 'coveredTo', false, 'coverage'),
          public.sales_recon_number(v_coverage, 'recordFirst', 0, 100000000, false, 'coverage')::integer,
          public.sales_recon_number(v_coverage, 'recordLast', 0, 100000000, false, 'coverage')::integer,
          (v_coverage ->> 'chainComplete')::boolean,
          v_summary,
          (select auth.uid()))
  /*
   * TWO TABS, ONE UPLOAD. The check above is not enough under concurrency:
   * two calls can both find no open session. The partial unique index
   * decides, and the loser receives the winner's session instead of an
   * error — the same answer as the sequential case.
   */
  on conflict (channel, files_key) where state = 'open' do nothing
  returning id into v_session;
  if v_session is null then
    select id into v_session from public.sales_recon_sessions
     where channel = v_channel and files_key = v_files_key and state = 'open';
    return v_session;
  end if;

  for v_file in select * from jsonb_array_elements(v_files) loop
    insert into public.sales_recon_files
      (session_id, file_name, fingerprint, footer_count, orders, first_sold_on, last_sold_on, record_first, record_last)
    values (v_session,
            public.sales_recon_text(v_file, 'fileName', 200, true, 'file'),
            public.sales_recon_text(v_file, 'fingerprint', 64, true, 'file'),
            public.sales_recon_number(v_file, 'footerCount', 0, 1000000, false, 'file')::integer,
            public.sales_recon_number(v_file, 'orders', 0, 1000000, true, 'file')::integer,
            public.sales_recon_day(v_file, 'firstSoldOn', false, 'file'),
            public.sales_recon_day(v_file, 'lastSoldOn', false, 'file'),
            public.sales_recon_number(v_file, 'recordFirst', 0, 100000000, false, 'file')::integer,
            public.sales_recon_number(v_file, 'recordLast', 0, 100000000, false, 'file')::integer);
  end loop;

  for v_order in select * from jsonb_array_elements(v_orders) loop
    perform public.sales_recon_only_keys(v_order,
      array['channel', 'orderRef', 'recordNo', 'soldOn', 'paidOn', 'shippedOn', 'itemsValue', 'shipping', 'total',
            'pieces', 'combined', 'destinationCountry', 'shippingService', 'sourceFile', 'lines'], 'order');
    if coalesce(v_order ->> 'channel', v_channel) <> v_channel then
      raise exception 'an order of another channel' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_order -> 'combined') is distinct from 'boolean' then
      raise exception 'order.combined must be true or false' using errcode = 'check_violation';
    end if;
    for v_line in select * from jsonb_array_elements(public.sales_recon_array(v_order, 'lines', 500, 'order')) loop
      perform public.sales_recon_only_keys(v_line,
        array['lineRef', 'listingId', 'title', 'variant', 'name', 'quantity', 'unitPrice', 'value'], 'line');
      perform public.sales_recon_text(v_line, 'lineRef', 64, false, 'line');
      perform public.sales_recon_text(v_line, 'listingId', 32, true, 'line');
      perform public.sales_recon_text(v_line, 'title', 300, true, 'line');
      perform public.sales_recon_text(v_line, 'variant', 300, false, 'line');
      perform public.sales_recon_text(v_line, 'name', 200, true, 'line');
      perform public.sales_recon_number(v_line, 'quantity', 1, 10000, true, 'line');
      perform public.sales_recon_number(v_line, 'unitPrice', 0, 1000000, true, 'line');
      perform public.sales_recon_number(v_line, 'value', 0, 1000000, true, 'line');
    end loop;
    insert into public.sales_recon_orders
      (session_id, channel, order_ref, record_no, sold_on, paid_on, shipped_on, items_value, shipping, total,
       pieces, combined, destination_country, shipping_service, source_file, lines)
    values (v_session, v_channel,
            public.sales_recon_text(v_order, 'orderRef', 64, true, 'order'),
            public.sales_recon_number(v_order, 'recordNo', 0, 100000000, false, 'order')::integer,
            public.sales_recon_day(v_order, 'soldOn', true, 'order'),
            public.sales_recon_day(v_order, 'paidOn', false, 'order'),
            public.sales_recon_day(v_order, 'shippedOn', false, 'order'),
            public.sales_recon_number(v_order, 'itemsValue', 0, 1000000, true, 'order'),
            public.sales_recon_number(v_order, 'shipping', 0, 1000000, true, 'order'),
            public.sales_recon_number(v_order, 'total', 0, 1000000, true, 'order'),
            public.sales_recon_number(v_order, 'pieces', 0, 10000, true, 'order')::integer,
            (v_order ->> 'combined')::boolean,
            public.sales_recon_text(v_order, 'destinationCountry', 2, false, 'order'),
            public.sales_recon_text(v_order, 'shippingService', 100, false, 'order'),
            public.sales_recon_text(v_order, 'sourceFile', 200, true, 'order'),
            v_order -> 'lines');
  end loop;

  for v_match in select * from jsonb_array_elements(v_matches) loop
    perform public.sales_recon_only_keys(v_match,
      array['orderRef', 'saleId', 'saleUpdatedAt', 'category', 'certainty', 'score', 'dateDelta',
            'competitors', 'reason', 'findings'], 'match');

    v_order_id := null;
    if public.sales_recon_text(v_match, 'orderRef', 64, false, 'match') is not null then
      select o.id into v_order_id from public.sales_recon_orders o
       where o.session_id = v_session and o.order_ref = v_match ->> 'orderRef';
      if v_order_id is null then
        raise exception 'a match names an order that is not in this session' using errcode = 'check_violation';
      end if;
    end if;

    v_sale := null;
    v_seen := null;
    if public.sales_recon_number(v_match, 'saleId', 1, 9223372036854775807, false, 'match') is not null then
      select * into v_sale from public.sales where id = (v_match ->> 'saleId')::bigint;
      if not found then
        raise exception 'a match names a sale that does not exist' using errcode = 'no_data_found';
      end if;
      if v_sale.channel <> v_channel or v_sale.order_id is not null then
        raise exception 'a match names a sale of another channel or an internal sale' using errcode = 'check_violation';
      end if;
      v_seen := (public.sales_recon_text(v_match, 'saleUpdatedAt', 40, true, 'match'))::timestamptz;
      if v_sale.updated_at is distinct from v_seen then
        raise exception 'sale % changed while it was being analysed — analyse again', v_sale.id
          using errcode = 'PT409';
      end if;
    end if;

    for v_item in select * from jsonb_array_elements(public.sales_recon_array(v_match, 'competitors', 50, 'match')) loop
      perform public.sales_recon_only_keys(v_item, array['orderRef', 'saleId', 'score'], 'competitor');
      perform public.sales_recon_text(v_item, 'orderRef', 64, true, 'competitor');
      perform public.sales_recon_number(v_item, 'saleId', 1, 9223372036854775807, true, 'competitor');
      perform public.sales_recon_number(v_item, 'score', -1000, 1000, true, 'competitor');
    end loop;

    insert into public.sales_recon_matches
      (session_id, order_id, sale_id, category, certainty, score, date_delta, competitors, reason, sale_updated_at)
    values (v_session, v_order_id, v_sale.id,
            public.sales_recon_text(v_match, 'category', 32, true, 'match'),
            public.sales_recon_text(v_match, 'certainty', 32, false, 'match'),
            public.sales_recon_number(v_match, 'score', -1000, 1000, false, 'match'),
            public.sales_recon_number(v_match, 'dateDelta', -100000, 100000, false, 'match')::integer,
            coalesce(v_match -> 'competitors', '[]'::jsonb),
            public.sales_recon_text(v_match, 'reason', 32, false, 'match'),
            v_seen)
    returning id into v_match_id;

    for v_finding in select * from jsonb_array_elements(public.sales_recon_array(v_match, 'findings', 200, 'match')) loop
      perform public.sales_recon_only_keys(v_finding,
        array['key', 'field', 'kind', 'ledger', 'external', 'delta', 'causes'], 'finding');
      if v_order_id is null or v_sale.id is null then
        raise exception 'only a pair of order and sale has findings' using errcode = 'check_violation';
      end if;
      v_key := public.sales_recon_text(v_finding, 'key', 32, true, 'finding');
      v_field := public.sales_recon_text(v_finding, 'field', 32, true, 'finding');
      if jsonb_typeof(coalesce(v_finding -> 'ledger', 'null'::jsonb)) not in ('string', 'number', 'null')
         or jsonb_typeof(coalesce(v_finding -> 'external', 'null'::jsonb)) not in ('string', 'number', 'null')
         or length(coalesce(v_finding ->> 'ledger', '')) > 300
         or length(coalesce(v_finding ->> 'external', '')) > 300 then
        raise exception 'a finding value is one short scalar' using errcode = 'check_violation';
      end if;
      if jsonb_typeof(v_finding -> 'ledger') = 'string' then
        perform public.sales_recon_no_contact(v_finding ->> 'ledger', 'finding.ledger');
      end if;
      if jsonb_typeof(v_finding -> 'external') = 'string' then
        perform public.sales_recon_no_contact(v_finding ->> 'external', 'finding.external');
      end if;
      for v_item in select * from jsonb_array_elements(public.sales_recon_array(v_finding, 'causes', 20, 'finding')) loop
        perform public.sales_recon_only_keys(v_item, array['code', 'amount'], 'cause');
        if public.sales_recon_text(v_item, 'code', 64, true, 'cause') !~ '^[a-z_]+$' then
          raise exception 'a cause code is a plain word' using errcode = 'check_violation';
        end if;
        perform public.sales_recon_number(v_item, 'amount', -1000000, 1000000, false, 'cause');
      end loop;
      insert into public.sales_recon_findings
        (match_id, finding_key, field, kind, ledger_value, external_value, delta, causes, allowed_decisions)
      values (v_match_id, v_key, v_field,
              public.sales_recon_text(v_finding, 'kind', 16, true, 'finding'),
              coalesce(v_finding -> 'ledger', 'null'::jsonb),
              coalesce(v_finding -> 'external', 'null'::jsonb),
              public.sales_recon_number(v_finding, 'delta', -100000000, 100000000, false, 'finding'),
              coalesce(v_finding -> 'causes', '[]'::jsonb),
              coalesce(public.sales_recon_allowed(v_field), array[]::text[]));
    end loop;
  end loop;

  return v_session;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Postconditions
-- ---------------------------------------------------------------------------
do $post$
begin
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_create(jsonb)'))
     is distinct from '21fab5ff4ea2c7cb2550f3db821fce0f' then
    raise exception '0176 postcondition: seller_recon_create is not the body of 0176 (21fab5ff4ea2c7cb2550f3db821fce0f)';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_validate_payload(jsonb)'))
     is distinct from '44441ee3b50a6bbf4f4fcbfda21d0e93' then
    raise exception '0176 postcondition: sales_recon_validate_payload is not the body of 0176 (44441ee3b50a6bbf4f4fcbfda21d0e93)';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.seller_recon_create(jsonb)')
                    and p.prosecdef
                    and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')) then
    raise exception '0176 postcondition: seller_recon_create lost security definer or its search_path';
  end if;
  if not has_function_privilege('authenticated', 'public.seller_recon_create(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.seller_recon_create(jsonb)', 'execute') then
    raise exception '0176 postcondition: the rights on seller_recon_create moved';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = to_regprocedure('public.sales_recon_validate_payload(jsonb)')
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) then
    raise exception '0176 postcondition: a client role may execute sales_recon_validate_payload';
  end if;
  raise notice '0176: seller_recon_create 21fab5ff4ea2c7cb2550f3db821fce0f checks the whole payload before it '
    'recognises a known upload; sales_recon_validate_payload 44441ee3b50a6bbf4f4fcbfda21d0e93. No row touched.';
end
$post$;
-- <<< ENDE: supabase/migrations/0176_sales_recon_validate_before_dedup.sql

/* Z0 — dieselben Messungen nachher, in derselben Form. */
create temporary table recon_0176_nachher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_sessions t) as sitzungen,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_files t) as dateien,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_orders t) as bestellungen,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_matches t) as zuordnungen,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales_recon_findings t) as befunde;

do $lauf_z$
begin
  /* Z1 — keine Zeile hat sich bewegt. */
  if exists (select 1 from pg_temp.recon_0176_vorher v, pg_temp.recon_0176_nachher n
              where (v.sitzungen, v.dateien, v.bestellungen, v.zuordnungen, v.befunde)
                    is distinct from (n.sitzungen, n.dateien, n.bestellungen, n.zuordnungen, n.befunde)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Abgleichsdaten bewegt — nichts wird angewendet';
  end if;

  /* Z2 — die neue Fassung steht. */
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_create(jsonb)'))
     is distinct from '21fab5ff4ea2c7cb2550f3db821fce0f'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_validate_payload(jsonb)'))
     is distinct from '44441ee3b50a6bbf4f4fcbfda21d0e93' then
    raise exception 'ABBRUCH Z2: die Fassung aus 0176 steht nicht';
  end if;

  raise notice '0176 ok: seller_recon_create prueft den ganzen Upload vor der Wiedererkennung. Keine Zeile bewegt.';
end
$lauf_z$;

commit;
