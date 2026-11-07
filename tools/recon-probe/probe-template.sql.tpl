-- ===========================================================================
-- STAGING — PRUEFLAUF 0180: DIE UEBERNAHME AUF SYNTHETISCHEN TESTVERKAEUFEN,
--           IN EINER TRANSAKTION, DIE ZURUECKGEROLLT WIRD (ADR-0178, Variante B)
--
-- ERZEUGT von `tools/build-recon-probe.mts` aus `0180_sales_recon_selected_apply.sql`
-- und `tools/recon-probe/probe-template.sql.tpl`. NICHT VON HAND AENDERN — der
-- Test `build-recon-probe.test.ts` vergleicht diese Datei zeichengleich mit
-- dem Erzeuger.
--
-- NOCH NICHT FREIGEGEBEN. Gefahren wird sie erst, wenn 0180 auf Staging steht
-- und der Betreiber den Prueflauf eigens freigibt — und NICHT diese Datei,
-- sondern die Laufdatei `supabase/log/staging/0180-probe-lauf.sql`
-- (`npm run probe:recon-0180:staging`): diese Datei Zeichen fuer Zeichen,
-- nach `begin;` die eine Zeile, die das Betriebskonto benennt (R7). Die
-- Laufdatei vollstaendig in den SQL-Editor des Staging-Projekts
-- qqxcpesbwfxzgytkdsac einfuegen, ausfuehren — als `postgres`.
--
-- ES BLEIBT NICHTS. Die Datei beginnt mit `begin` und enthaelt KEIN
-- `commit`. Sie endet mit einer Ausnahme, die das Ergebnis jeder Pruefung
-- nennt — die Transaktion ist damit abgebrochen —, und mit `rollback`.
-- Testverkaeufe, Sitzungen, Entscheidungen, Uebernahmen, Journalzeilen und
-- die temporaeren Funktionen verschwinden. Uebrig bleiben nur verbrauchte
-- Sequenznummern (Luecken in den IDs).
--
-- ERWARTET: die Fehlermeldung
--   `PRUEFLAUF 0180 ZURUECKGEROLLT — <n>/<n> bestanden | …`
-- Jede andere Meldung ist ein Abbruch VOR oder WAEHREND der Pruefung (ihr
-- Text nennt den Riegel), und auch dann ist nichts geblieben.
--
-- DIE RIEGEL, BEVOR IRGENDETWAS GESCHRIEBEN WIRD
--   R1  der Datenbankstempel `skyisles-staging qqxcpesbwfxzgytkdsac`
--       (Production traegt keinen);
--   R2  als zweite, unabhaengige Markierung die Rolle `skyisles_agent`, die
--       es nur auf Staging gibt (`staging-agent-setup.sql`);
--   R3  PostgreSQL 15 bis 18;
--   R4  die Ruempfe aller Funktionen, die der Lauf benutzt, sind die des
--       Commits (md5) — 0180 steht, und nichts daneben;
--   R5  keine unbekannten Trigger auf den beruehrten Tabellen und keiner,
--       der ins Netz spricht (Webhooks, pg_net, dblink, NOTIFY);
--   R6  jede Pflichtspalte von `sales` und `sale_items` ist eine, die der
--       Lauf setzt;
--   R7  das BENANNTE Betriebskonto (`skyisles.probe_operator`, gesetzt von
--       der Laufdatei, die `build-recon-probe.mts --run-file` erzeugt): eine
--       gueltige Kennung, genau eine freigeschaltete Mitgliedschaft beim
--       aktiven Verkaeufer (andere Konten duerfen bestehen); vorher keine
--       Identitaet und das Tor zu; mit seiner Identitaet (transaktionslokal,
--       `request.jwt.claim.sub` / `request.jwt.claims`) liefert `auth.uid()`
--       genau sie und das Tor ist offen; die Gegenprobe mit einem fremden
--       Konto findet das Tor zu. Ohne Laufdatei bricht R7 ab.
--
-- DIE TEMPORAEREN FUNKTIONEN liegen ausschliesslich in `pg_temp` dieser
-- Sitzung — keine andere Verbindung sieht sie, und sie verschwinden mit dem
-- Rollback. Sie sind maschinell aus 0180 erzeugt; der einzige fachliche
-- Unterschied: wo 0180 einen Testverkauf abweist, weist die Kopie jeden
-- Verkauf ab, der NICHT ein von diesem Lauf angelegter Testverkauf ist.
-- Die regulaeren Funktionen bleiben, wie sie sind, und werden mitgeprueft:
-- sie weisen dieselben Testverkaeufe weiter ab.
-- ===========================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $probe_r$
declare
  v_fn text;
  v_expected text;
  v_body text;
  v_bad text;
  v_named text;
  v_operator uuid;
  v_stranger uuid;
  v_count integer;
begin
  /* R1 — der Stempel. */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     <> 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH R1: Umgebungsstempel nicht gefunden — dieser Lauf ist nur fuer Staging qqxcpesbwfxzgytkdsac';
  end if;
  /* R2 — die zweite Markierung. */
  if not exists (select 1 from pg_roles where rolname = 'skyisles_agent') then
    raise exception 'ABBRUCH R2: die Staging-Rolle skyisles_agent fehlt — das ist nicht Staging';
  end if;
  /* R3 — die Version. */
  if current_setting('server_version_num')::integer not between 150000 and 189999 then
    raise exception 'ABBRUCH R3: PostgreSQL % ist nicht 15 bis 18', current_setting('server_version');
  end if;
  /* R4 — die Ruempfe. */
  for v_fn, v_expected in values
@@MD5_ROWS@@
  loop
    select md5(p.prosrc) into v_body from pg_proc p where p.oid = to_regprocedure('public.' || v_fn);
    if v_body is distinct from v_expected then
      raise exception 'ABBRUCH R4: % ist % und nicht der Rumpf des Commits (%)', v_fn, coalesce(v_body, '(fehlt)'), v_expected;
    end if;
  end loop;
  /* R5 — keine unbekannte Nebenwirkung. */
  select string_agg(c.relname || '.' || t.tgname, ', ' order by 1) into v_bad
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc f on f.oid = t.tgfoid
   where not t.tgisinternal
     and t.tgrelid in ('public.sales'::regclass, 'public.sale_items'::regclass, 'public.sale_refunds'::regclass,
                       'public.orderbook_audit'::regclass, 'public.sales_recon_sessions'::regclass,
                       'public.sales_recon_files'::regclass, 'public.sales_recon_orders'::regclass,
                       'public.sales_recon_matches'::regclass, 'public.sales_recon_findings'::regclass,
                       'public.sales_recon_decisions'::regclass, 'public.sales_recon_applications'::regclass)
     and (c.relname || '.' || t.tgname || '=' || f.proname) not in (
@@KNOWN_TRIGGERS@@
     );
  if v_bad is not null then
    raise exception 'ABBRUCH R5: unbekannte Trigger auf beruehrten Tabellen: % — Nebenwirkungen nicht ausgeschlossen', v_bad;
  end if;
  select string_agg(f.proname, ', ') into v_bad
    from pg_trigger t join pg_proc f on f.oid = t.tgfoid
   where not t.tgisinternal
     and t.tgrelid in ('public.sales'::regclass, 'public.sale_items'::regclass, 'public.sale_refunds'::regclass,
                       'public.orderbook_audit'::regclass, 'public.sales_recon_decisions'::regclass,
                       'public.sales_recon_applications'::regclass)
     and f.prosrc ~* '(net\.|http|dblink|pg_notify|notify\s)';
  if v_bad is not null then
    raise exception 'ABBRUCH R5: ein Trigger spricht nach aussen (%)', v_bad;
  end if;
  /* R6 — die Pflichtspalten. */
  select string_agg(c.table_name || '.' || c.column_name, ', ') into v_bad
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name in ('sales', 'sale_items')
     and c.is_nullable = 'NO' and c.column_default is null
     and c.is_identity = 'NO' and c.is_generated = 'NEVER'
     and (c.table_name || '.' || c.column_name) not in
         ('sales.channel', 'sales.source', 'sales.is_test', 'sales.sold_at', 'sale_items.sale_id', 'sale_items.position');
  if v_bad is not null then
    raise exception 'ABBRUCH R6: Pflichtspalten, die der Lauf nicht setzt: %', v_bad;
  end if;
  /* R7 — das benannte Betriebskonto, und nur dessen Identitaet. */
  v_named := coalesce(current_setting('skyisles.probe_operator', true), '');
  if v_named = '' then
    raise exception 'ABBRUCH R7: kein Betriebskonto benannt (skyisles.probe_operator) — nur ueber die Laufdatei von build-recon-probe.mts --run-file';
  end if;
  if v_named !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_named = '00000000-0000-0000-0000-000000000000' then
    raise exception 'ABBRUCH R7: skyisles.probe_operator ist keine gueltige Kennung';
  end if;
  v_operator := v_named::uuid;
  select count(*) into v_count
    from public.seller_operators o join public.sellers s on s.id = o.seller_id
   where s.is_active and o.is_enabled and o.user_id = v_operator;
  if v_count <> 1 then
    raise exception 'ABBRUCH R7: das benannte Betriebskonto hat % freigeschaltete Mitgliedschaften beim aktiven Verkaeufer, verlangt ist genau eine', v_count;
  end if;
  /* Vorher: keine Identitaet in dieser Sitzung, das Tor zu. */
  if coalesce(current_setting('request.jwt.claim.sub', true), '') <> ''
     or coalesce(current_setting('request.jwt.claims', true), '') <> ''
     or (select auth.uid()) is not null then
    raise exception 'ABBRUCH R7: die Sitzung traegt schon eine Identitaet';
  end if;
  if public.can_operate_active_seller() then
    raise exception 'ABBRUCH R7: das Tor ist ohne Identitaet offen';
  end if;
  /* Mit der Identitaet: genau dieses Konto, und das Tor offen. */
  perform set_config('request.jwt.claim.sub', v_operator::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_operator, 'role', 'authenticated')::text, true);
  if (select auth.uid()) is distinct from v_operator then
    raise exception 'ABBRUCH R7: die transaktionslokale Identitaet greift nicht';
  end if;
  if not public.can_operate_active_seller() then
    raise exception 'ABBRUCH R7: mit der Identitaet bleibt das Tor zu';
  end if;
  /* Gegenprobe: ein Konto ohne jede freigeschaltete Mitgliedschaft — das Tor muss zu sein. */
  v_stranger := gen_random_uuid();
  if exists (select 1 from public.seller_operators o where o.user_id = v_stranger) then
    raise exception 'ABBRUCH R7: die Gegenprobe fand keine fremde Kennung';
  end if;
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  if (select auth.uid()) is distinct from v_stranger or public.can_operate_active_seller() then
    raise exception 'ABBRUCH R7: Gegenprobe — das Tor oeffnet sich fuer ein fremdes Konto';
  end if;
  /* Zurueck auf das benannte Konto, und noch einmal nachgesehen. */
  perform set_config('request.jwt.claim.sub', v_operator::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_operator, 'role', 'authenticated')::text, true);
  if (select auth.uid()) is distinct from v_operator or not public.can_operate_active_seller() then
    raise exception 'ABBRUCH R7: das benannte Konto liess sich nicht wiederherstellen';
  end if;
end
$probe_r$;


-- ---------------------------------------------------------------------------
-- Die Hilfstabellen dieses Laufs — nur in pg_temp
-- ---------------------------------------------------------------------------
create temporary table probe_sales (sale_id bigint primary key) on commit drop;
create temporary table probe_result (nr integer primary key, pruefung text not null, ok boolean not null, befund text)
  on commit drop;
create temporary table probe_before (what text primary key, fingerprint text not null) on commit drop;


-- ---------------------------------------------------------------------------
-- Die Kopien aus 0180 — maschinell erzeugt, nur die dokumentierten Ersetzungen
-- ---------------------------------------------------------------------------
@@PROBE_FUNCTIONS@@


-- ---------------------------------------------------------------------------
-- Werkzeuge des Laufs — ebenfalls nur in pg_temp
-- ---------------------------------------------------------------------------

/* Ein Pruefergebnis. Der Befund nennt Codes und Zahlen, nie einen Wert. */
create function pg_temp.probe_record(p_nr integer, p_name text, p_ok boolean, p_befund text default null)
returns void language sql set search_path = '' as $$
  insert into pg_temp.probe_result values (p_nr, p_name, coalesce(p_ok, false), p_befund)
$$;

/* Erwartet einen Abbruch mit diesem SQLSTATE (und, falls genannt, diesem Grundcode). */
create function pg_temp.probe_expect(p_nr integer, p_name text, p_sql text, p_state text, p_reason text default null)
returns void language plpgsql set search_path = '' as $$
begin
  execute p_sql;
  perform pg_temp.probe_record(p_nr, p_name, false, 'angenommen');
exception when others then
  perform pg_temp.probe_record(p_nr, p_name,
    sqlstate = p_state and (p_reason is null or position('(' || p_reason || ')' in sqlerrm) > 0
                            or position(p_reason || ')' in sqlerrm) > 0),
    sqlstate || coalesce(' ' || substring(sqlerrm from '\(([a-z_, ]+)\)'), ''));
end;
$$;

/* Ein synthetischer Testverkauf dieses Laufs: 2001, nur Rohnamen (kein Hold, kein Lager). */
create function pg_temp.probe_sale(p_sold date, p_subtotal numeric, p_shipping numeric, p_piece text, p_ref text)
returns bigint language plpgsql set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.sales (channel, sold_at, items_subtotal, discount_amount, shipping_charged, source,
                            external_order_ref, is_test, note)
  values ('ebay', p_sold, p_subtotal, 0, p_shipping, 'manual', p_ref, true,
          'verify:recon-0180-probe ' || txid_current()::text)
  returning id into v_id;
  insert into public.sale_items (sale_id, position, raw_name) values (v_id, 1, p_piece);
  insert into pg_temp.probe_sales values (v_id);
  return v_id;
end;
$$;

/*
 * Eine Sitzung ueber Testverkaeufe dieses Laufs — durch das REGULAERE
 * `seller_recon_create`. Kategorie und Sicherheit sind die Behauptung des
 * Laufs; ob sie stimmen, prueft 0180 selbst (`sales_recon_take_check`).
 */
create function pg_temp.probe_session(p_tag text, p_cases jsonb)
returns bigint language plpgsql set search_path = '' as $$
declare
  v_file text := 'verify-recon-0180-probe-' || p_tag || '.csv';
  v_from date; v_to date; v_n integer;
  v_orders jsonb; v_matches jsonb;
begin
  if exists (select 1 from jsonb_array_elements(p_cases) c
              where not exists (select 1 from pg_temp.probe_sales p where p.sale_id = (c ->> 'saleId')::bigint)) then
    raise exception 'ABBRUCH: eine Sitzung des Laufs nennt einen Verkauf, den er nicht angelegt hat';
  end if;
  select min((c ->> 'sold')::date), max((c ->> 'sold')::date), count(*) into v_from, v_to, v_n
    from jsonb_array_elements(p_cases) c;
  select jsonb_agg(jsonb_build_object(
           'orderRef', c ->> 'ref', 'recordNo', o.n, 'soldOn', c ->> 'sold', 'paidOn', null, 'shippedOn', null,
           'itemsValue', (c ->> 'items')::numeric, 'shipping', (c ->> 'shipping')::numeric,
           'total', (c ->> 'total')::numeric, 'pieces', 1, 'combined', false, 'destinationCountry', 'DE',
           'shippingService', null, 'sourceFile', v_file,
           'lines', jsonb_build_array(jsonb_build_object('lineRef', '1', 'listingId', '1', 'title', 'Pruefposition',
             'variant', null, 'name', c ->> 'piece', 'quantity', 1, 'unitPrice', (c ->> 'items')::numeric,
             'value', (c ->> 'items')::numeric))) order by o.n),
         jsonb_agg(jsonb_build_object(
           'orderRef', c ->> 'ref', 'saleId', (c ->> 'saleId')::bigint,
           'saleUpdatedAt', (select to_jsonb(s.updated_at) #>> '{}' from public.sales s where s.id = (c ->> 'saleId')::bigint),
           'category', c ->> 'category', 'certainty', c ->> 'certainty', 'score', 100, 'dateDelta', 0,
           'competitors', '[]'::jsonb, 'reason', null, 'findings', c -> 'findings') order by o.n)
    into v_orders, v_matches
    from jsonb_array_elements(p_cases) with ordinality o(c, n);
  return public.seller_recon_create(jsonb_build_object(
    'channel', 'ebay', 'parser', 'ebay-orders-report-de', 'parserVersion', 1,
    'coverage', jsonb_build_object('coveredFrom', v_from, 'coveredTo', v_to, 'recordFirst', 1, 'recordLast', v_n,
                                   'chainComplete', true),
    'summary', jsonb_build_object('categories', jsonb_build_object('probe', v_n)),
    'files', jsonb_build_array(jsonb_build_object('fileName', v_file,
      'fingerprint', md5(p_tag || txid_current()::text) || md5(txid_current()::text || p_tag), 'footerCount', v_n,
      'orders', v_n, 'firstSoldOn', v_from, 'lastSoldOn', v_to, 'recordFirst', 1, 'recordLast', v_n)),
    'orders', v_orders, 'matches', v_matches));
end;
$$;

create function pg_temp.probe_finding(p_session bigint, p_ref text, p_field text)
returns bigint language sql set search_path = '' as $$
  select f.id from public.sales_recon_findings f
    join public.sales_recon_matches m on m.id = f.match_id
    join public.sales_recon_orders o on o.id = m.order_id
   where m.session_id = p_session and o.order_ref = p_ref and f.field = p_field
$$;

/* Entscheiden mit den angezeigten Werten des Befunds — ueber die Kopie oder den regulaeren Weg. */
create function pg_temp.probe_decide_on(p_finding bigint, p_decision text, p_regular boolean default false)
returns bigint language plpgsql set search_path = '' as $$
declare f public.sales_recon_findings;
begin
  select * into f from public.sales_recon_findings where id = p_finding;
  if p_regular then
    return public.seller_recon_decide(p_finding, p_decision, null, null, f.ledger_value, f.external_value);
  end if;
  return pg_temp.probe_seller_recon_decide(p_finding, p_decision, null, null, f.ledger_value, f.external_value);
end;
$$;

/* Was nicht angefasst werden darf: alles ausser den Zeilen dieses Laufs. */
create function pg_temp.probe_fingerprints()
returns table (what text, fingerprint text) language sql set search_path = '' as $$
  select 'sales', md5(coalesce(string_agg(to_jsonb(s)::text, chr(10) order by s.id), ''))
    from public.sales s where s.id not in (select sale_id from pg_temp.probe_sales)
  union all
  select 'sale_items', md5(coalesce(string_agg(to_jsonb(i)::text, chr(10) order by i.id), ''))
    from public.sale_items i where i.sale_id not in (select sale_id from pg_temp.probe_sales)
  union all
  select 'sale_refunds', md5(coalesce(string_agg(to_jsonb(r)::text, chr(10) order by r.id), ''))
    from public.sale_refunds r where r.sale_id not in (select sale_id from pg_temp.probe_sales)
  union all
  select 'inventory_movements', md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by x.id), ''))
    from public.inventory_movements x
  union all
  select 'legacy_stock_events', md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by x.id), ''))
    from public.legacy_stock_events x
  union all
  select 'shop_inventory', md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by x.id), ''))
    from public.shop_inventory x
  union all
  select 'orderbook_audit', md5(coalesce(string_agg(to_jsonb(a)::text, chr(10) order by a.id), ''))
    from public.orderbook_audit a where a.sale_id is null or a.sale_id not in (select sale_id from pg_temp.probe_sales)
  union all
  select 'sales_recon_sessions', md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by x.id), ''))
    from public.sales_recon_sessions x
   where x.id not in (select m.session_id from public.sales_recon_matches m
                       where m.sale_id in (select sale_id from pg_temp.probe_sales))
  union all
  select 'sales_recon_decisions', md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by x.id), ''))
    from public.sales_recon_decisions x
   where x.finding_id not in (select f.id from public.sales_recon_findings f join public.sales_recon_matches m on m.id = f.match_id
                               where m.sale_id in (select sale_id from pg_temp.probe_sales))
  union all
  select 'sales_recon_applications', md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by x.id), ''))
    from public.sales_recon_applications x where x.sale_id not in (select sale_id from pg_temp.probe_sales)
$$;

/* Die temporaeren Funktionen sind fuer keine Clientrolle ausfuehrbar — auch innerhalb dieser Sitzung nicht. */
do $probe_rights$
declare v_fn regprocedure;
begin
  for v_fn in select p.oid::regprocedure from pg_proc p where p.pronamespace = pg_my_temp_schema() loop
    execute format('revoke all on function %s from public', v_fn);
  end loop;
end
$probe_rights$;


-- ---------------------------------------------------------------------------
-- Der Lauf
-- ---------------------------------------------------------------------------
do $probe_run$
declare
  v_tag text := to_hex(txid_current());
  r1 text := 'VP' || to_hex(txid_current()) || '-0001';   -- deterministic, drei Felder
  r2 text := 'VP' || to_hex(txid_current()) || '-0002';   -- deterministic, elf Tage
  r3 text := 'VP' || to_hex(txid_current()) || '-0003';   -- unique, nur die Nummer
  r4 text := 'VP' || to_hex(txid_current()) || '-0004';   -- mit Erstattung
  r5 text := 'VP' || to_hex(txid_current()) || '-0005';   -- storniert
  r6 text := 'VP' || to_hex(txid_current()) || '-0006';   -- Schreibfehler im letzten Verkauf
  r7 text := 'VP' || to_hex(txid_current()) || '-0007';   -- veraltet
  s1 bigint; s2 bigint; s3 bigint; s4 bigint; s5 bigint; s6 bigint; s7 bigint;
  v_s1 bigint; v_s2 bigint; v_s3 bigint;
  d1 bigint; d2 bigint; d3 bigint; d_ref bigint; d_far bigint; d_last bigint; d_stale bigint; d_again bigint;
  v_p jsonb; v_r jsonb; v_token text;
  v_before jsonb; v_after jsonb; v_n integer; v_audit integer;
begin
  insert into pg_temp.probe_before select * from pg_temp.probe_fingerprints();

  -- Die Testverkaeufe; der fuer den Schreibfehler zuletzt (hoechste ID).
  s1 := pg_temp.probe_sale('2001-05-09', 8, 5.49, 'Eruptor', r1);
  s2 := pg_temp.probe_sale('2001-05-01', 9, 5.49, 'Spyro', r2);
  s3 := pg_temp.probe_sale('2001-05-13', 7, 5.49, 'Zap', null);
  s4 := pg_temp.probe_sale('2001-05-14', 12, 5.49, 'Hex', r4);
  s5 := pg_temp.probe_sale('2001-05-15', 5, 5.49, 'Bash', r5);
  s7 := pg_temp.probe_sale('2001-05-17', 6, 5.49, 'Camo', r7);
  s6 := pg_temp.probe_sale('2001-05-20', 4, 5.49, 'Zook', r6);
  perform public.seller_add_sale_refund(s4, 1, now(), 'kulanz', null, 'Prueflauf 0180');
  perform public.seller_cancel_external_sale(s5, 'Prueflauf 0180', date '2001-05-15', null);

  v_s1 := pg_temp.probe_session(v_tag || 'a', jsonb_build_array(
    jsonb_build_object('ref', r1, 'saleId', s1, 'category', 'deviating', 'certainty', 'deterministic', 'sold', '2001-05-10',
      'items', 9, 'shipping', 4.99, 'total', 13.99, 'piece', 'Eruptor', 'findings', jsonb_build_array(
        jsonb_build_object('key', 'sold_on', 'field', 'sold_on', 'kind', 'deviation', 'ledger', '2001-05-09', 'external', '2001-05-10'),
        jsonb_build_object('key', 'items_net', 'field', 'items_net', 'kind', 'deviation', 'ledger', 8, 'external', 9),
        jsonb_build_object('key', 'shipping', 'field', 'shipping', 'kind', 'deviation', 'ledger', 5.49, 'external', 4.99))),
    jsonb_build_object('ref', r3, 'saleId', s3, 'category', 'deviating', 'certainty', 'unique', 'sold', '2001-05-14',
      'items', 7, 'shipping', 5.49, 'total', 12.49, 'piece', 'Zap', 'findings', jsonb_build_array(
        jsonb_build_object('key', 'sold_on', 'field', 'sold_on', 'kind', 'deviation', 'ledger', '2001-05-13', 'external', '2001-05-14'),
        jsonb_build_object('key', 'external_order_ref', 'field', 'external_order_ref', 'kind', 'addition', 'ledger', null, 'external', r3))),
    jsonb_build_object('ref', r4, 'saleId', s4, 'category', 'deviating', 'certainty', 'deterministic', 'sold', '2001-05-14',
      'items', 10, 'shipping', 5.49, 'total', 15.49, 'piece', 'Hex', 'findings', jsonb_build_array(
        jsonb_build_object('key', 'items_net', 'field', 'items_net', 'kind', 'deviation', 'ledger', 12, 'external', 10))),
    jsonb_build_object('ref', r5, 'saleId', s5, 'category', 'deviating', 'certainty', 'deterministic', 'sold', '2001-05-16',
      'items', 5, 'shipping', 5.49, 'total', 10.49, 'piece', 'Bash', 'findings', jsonb_build_array(
        jsonb_build_object('key', 'sold_on', 'field', 'sold_on', 'kind', 'deviation', 'ledger', '2001-05-15', 'external', '2001-05-16'))),
    jsonb_build_object('ref', r7, 'saleId', s7, 'category', 'deviating', 'certainty', 'deterministic', 'sold', '2001-05-18',
      'items', 6, 'shipping', 5.49, 'total', 11.49, 'piece', 'Camo', 'findings', jsonb_build_array(
        jsonb_build_object('key', 'sold_on', 'field', 'sold_on', 'kind', 'deviation', 'ledger', '2001-05-17', 'external', '2001-05-18')))));
  v_s3 := pg_temp.probe_session(v_tag || 'c', jsonb_build_array(
    jsonb_build_object('ref', r2, 'saleId', s2, 'category', 'deviating', 'certainty', 'deterministic', 'sold', '2001-05-12',
      'items', 9, 'shipping', 5.49, 'total', 14.49, 'piece', 'Spyro', 'findings', jsonb_build_array(
        jsonb_build_object('key', 'sold_on', 'field', 'sold_on', 'kind', 'deviation', 'ledger', '2001-05-01', 'external', '2001-05-12'))),
    jsonb_build_object('ref', r6, 'saleId', s6, 'category', 'deviating', 'certainty', 'deterministic', 'sold', '2999-01-01',
      'items', 4, 'shipping', 5.49, 'total', 9.49, 'piece', 'Zook', 'findings', jsonb_build_array(
        jsonb_build_object('key', 'sold_on', 'field', 'sold_on', 'kind', 'deviation', 'ledger', '2001-05-20', 'external', '2999-01-01')))));
  perform pg_temp.probe_record(1, 'die Pruefdaten stehen: sieben Testverkaeufe dieses Laufs, zwei Sitzungen',
    (select count(*) from pg_temp.probe_sales) = 7 and v_s1 is not null and v_s3 is not null);

  -- ---- Der regulaere Weg bleibt fuer Testverkaeufe gesperrt ----------------
  perform pg_temp.probe_expect(2, 'regulaer: take_external auf einem Testverkauf wird abgewiesen (test_sale)',
    format('select pg_temp.probe_decide_on(%s, %L, true)', pg_temp.probe_finding(v_s1, r1, 'sold_on'), 'take_external'),
    '23514', 'test_sale');
  perform pg_temp.probe_expect(3, 'regulaer: manual wird abgewiesen',
    format('select public.seller_recon_decide(%s, %L, %L::jsonb, null, %L::jsonb, %L::jsonb)',
           pg_temp.probe_finding(v_s1, r1, 'sold_on'), 'manual', '{"value":"2001-05-10"}', '"2001-05-09"', '"2001-05-10"'),
    '23514');
  perform pg_temp.probe_expect(4, 'regulaer: die alte Uebernahme (session, expected) weist ab',
    format('select public.seller_recon_apply(%s, 0)', v_s1), '0A000');

  -- ---- deterministic: drei Felder eines Verkaufs, ein Schreibvorgang --------
  d1 := pg_temp.probe_decide_on(pg_temp.probe_finding(v_s1, r1, 'sold_on'), 'take_external');
  d2 := pg_temp.probe_decide_on(pg_temp.probe_finding(v_s1, r1, 'items_net'), 'take_external');
  d3 := pg_temp.probe_decide_on(pg_temp.probe_finding(v_s1, r1, 'shipping'), 'take_external');
  v_p := public.seller_recon_preview(v_s1, array[d1, d2, d3]);
  perform pg_temp.probe_record(5, 'regulaere Vorschau derselben Entscheidungen: test_sale, nicht uebernehmbar',
    not (v_p ->> 'admissible')::boolean and (select bool_and(c ->> 'problem' = 'test_sale') from jsonb_array_elements(v_p -> 'changes') c),
    (v_p ->> 'problems') || ' Probleme');
  perform pg_temp.probe_expect(6, 'regulaere Uebernahme mit dem Token der regulaeren Vorschau: abgewiesen',
    format('select public.seller_recon_apply(%s, array[%s,%s,%s]::bigint[], %L)', v_s1, d1, d2, d3, v_p ->> 'token'),
    '23514', 'test_sale');
  v_p := pg_temp.probe_seller_recon_preview(v_s1, array[d1, d2, d3]);
  perform pg_temp.probe_record(7, 'Pruefvorschau: drei Aenderungen, uebernehmbar, mit Token',
    (v_p ->> 'admissible')::boolean and (v_p ->> 'count')::integer = 3 and v_p ->> 'token' ~ '^[0-9a-f]{64}$');
  v_before := (select to_jsonb(s) from public.sales s where s.id = s1);
  perform pg_temp.probe_expect(8, 'ein anderer Token: PT409',
    format('select pg_temp.probe_seller_recon_apply(%s, array[%s,%s,%s]::bigint[], %L)', v_s1, d1, d2, d3, repeat('0', 64)),
    'PT409');
  perform pg_temp.probe_expect(9, 'eine andere Auswahl mit demselben Token: PT409',
    format('select pg_temp.probe_seller_recon_apply(%s, array[%s,%s]::bigint[], %L)', v_s1, d1, d2, v_p ->> 'token'), 'PT409');
  perform pg_temp.probe_record(10, 'nach beiden Ablehnungen ist der Verkauf unveraendert',
    (select to_jsonb(s) from public.sales s where s.id = s1) = v_before
    and not exists (select 1 from public.sales_recon_applications a where a.sale_id = s1));
  v_audit := coalesce((select max(a.id) from public.orderbook_audit a), 0);
  v_r := pg_temp.probe_seller_recon_apply(v_s1, array[d3, d1, d2], v_p ->> 'token');
  perform pg_temp.probe_record(11, 'Uebernahme: drei Felder, ein Verkauf (Reihenfolge der Liste egal)',
    (v_r ->> 'applied')::integer = 3 and (v_r ->> 'sales')::integer = 1);
  perform pg_temp.probe_record(12, 'die Werte des Berichts stehen im Verkauf, der Rabatt nicht bewegt',
    (select s.sold_at = date '2001-05-10' and s.items_subtotal = 9 and s.shipping_charged = 4.99
            and coalesce(s.discount_amount, 0) = 0 from public.sales s where s.id = s1));
  perform pg_temp.probe_record(13, 'das Orderbuch-Journal haelt genau die drei Felder, je eine Zeile',
    (select array_agg(a.field order by a.field) from public.orderbook_audit a where a.sale_id = s1 and a.id > v_audit)
      = array['items_subtotal', 'shipping_charged', 'sold_at']);
  perform pg_temp.probe_record(14, 'je Entscheidung eine Uebernahmezeile, alte Werte in der Form, die 0179 liest',
    (select count(*) from public.sales_recon_applications a where a.sale_id = s1) = 3
    and (select old_value from public.sales_recon_applications a where a.decision_id = d1) = '2001-05-09'
    and (select old_value from public.sales_recon_applications a where a.decision_id = d2) ~ '^items_subtotal 8(\.00)? \(net 8(\.00)?\)$');
  perform pg_temp.probe_record(15, 'die Zuordnung kennt den neuen Stand; 0179 liest ihn als applied',
    (select m.sale_updated_at = s.updated_at from public.sales_recon_matches m join public.sales s on s.id = m.sale_id
      where m.session_id = v_s1 and m.sale_id = s1)
    and (select e -> 'ledger' ->> 'state' from jsonb_array_elements(public.seller_recon_session(v_s1, null, 0, 200) -> 'matches') e
          where (e -> 'sale' ->> 'id')::bigint = s1) = 'applied');
  v_n := (select count(*) from public.sales_recon_applications);
  perform pg_temp.probe_expect(16, 'dieselbe Uebernahme ein zweites Mal: PT409 (already_applied)',
    format('select pg_temp.probe_seller_recon_apply(%s, array[%s,%s,%s]::bigint[], %L)', v_s1, d1, d2, d3, v_p ->> 'token'),
    'PT409', 'already_applied');
  perform pg_temp.probe_record(17, 'und sie hat nichts geschrieben', (select count(*) from public.sales_recon_applications) = v_n);

  -- ---- unique: nur die Nummer; nach erneuter Analyse das Datum -------------
  perform pg_temp.probe_expect(18, 'unique: das Datum wird abgewiesen (unique_ref_only)',
    format('select pg_temp.probe_decide_on(%s, %L)', pg_temp.probe_finding(v_s1, r3, 'sold_on'), 'take_external'),
    '23514', 'unique_ref_only');
  v_before := (select to_jsonb(s) - array['external_order_ref', 'updated_at', 'updated_by'] from public.sales s where s.id = s3);
  d_ref := pg_temp.probe_decide_on(pg_temp.probe_finding(v_s1, r3, 'external_order_ref'), 'take_external');
  v_p := pg_temp.probe_seller_recon_preview(v_s1, array[d_ref]);
  v_r := pg_temp.probe_seller_recon_apply(v_s1, array[d_ref], v_p ->> 'token');
  perform pg_temp.probe_record(19, 'unique: die fehlende Bestellnummer ist ergaenzt',
    (select s.external_order_ref = r3 from public.sales s where s.id = s3));
  perform pg_temp.probe_record(20, 'unique: keine andere Spalte des Verkaufs hat sich bewegt',
    (select to_jsonb(s) - array['external_order_ref', 'updated_at', 'updated_by'] from public.sales s where s.id = s3) = v_before);
  v_s2 := pg_temp.probe_session(v_tag || 'b', jsonb_build_array(
    jsonb_build_object('ref', r3, 'saleId', s3, 'category', 'deviating', 'certainty', 'deterministic', 'sold', '2001-05-14',
      'items', 7, 'shipping', 5.49, 'total', 12.49, 'piece', 'Zap', 'findings', jsonb_build_array(
        jsonb_build_object('key', 'sold_on', 'field', 'sold_on', 'kind', 'deviation', 'ledger', '2001-05-13', 'external', '2001-05-14')))));
  d_again := pg_temp.probe_decide_on(pg_temp.probe_finding(v_s2, r3, 'sold_on'), 'take_external');
  v_p := pg_temp.probe_seller_recon_preview(v_s2, array[d_again]);
  v_r := pg_temp.probe_seller_recon_apply(v_s2, array[d_again], v_p ->> 'token');
  perform pg_temp.probe_record(21, 'erneute Analyse: jetzt deterministic — erst jetzt wird das Datum uebernommen',
    (select s.sold_at = date '2001-05-14' from public.sales s where s.id = s3));

  -- ---- Erstattung, Storno ---------------------------------------------------
  perform pg_temp.probe_expect(22, 'mit Erstattung: kein Betrag (refunded)',
    format('select pg_temp.probe_decide_on(%s, %L)', pg_temp.probe_finding(v_s1, r4, 'items_net'), 'take_external'),
    '23514', 'refunded');
  perform pg_temp.probe_expect(23, 'storniert: nichts (cancelled)',
    format('select pg_temp.probe_decide_on(%s, %L)', pg_temp.probe_finding(v_s1, r5, 'sold_on'), 'take_external'),
    '23514', 'cancelled');

  -- ---- veraltet zwischen Vorschau und Uebernahme ----------------------------
  d_stale := pg_temp.probe_decide_on(pg_temp.probe_finding(v_s1, r7, 'sold_on'), 'take_external');
  v_p := pg_temp.probe_seller_recon_preview(v_s1, array[d_stale]);
  /*
   * EINE FREMDE AENDERUNG, NACHGESTELLT. In EINER Transaktion ist `now()`
   * fest — eine Aenderung ueber das Orderbuch setzte `updated_at` auf
   * denselben Wert. Deshalb rueckt der Lauf die Version selbst weiter
   * (`clock_timestamp()`), wie es jede Orderbuch-Funktion in einer anderen
   * Transaktion taete. Echte getrennte Transaktionen prueft Variante C.
   */
  update public.sales set updated_at = clock_timestamp() where id = s7;
  perform pg_temp.probe_expect(24, 'ein seit der Vorschau geaenderter Verkauf: PT409 (stale), nichts geschrieben',
    format('select pg_temp.probe_seller_recon_apply(%s, array[%s]::bigint[], %L)', v_s1, d_stale, v_p ->> 'token'),
    'PT409', 'stale');
  perform pg_temp.probe_record(25, 'der veraltete Verkauf traegt sein altes Datum',
    (select s.sold_at = date '2001-05-17' from public.sales s where s.id = s7)
    and not exists (select 1 from public.sales_recon_applications a where a.sale_id = s7));

  -- ---- ein Schreibfehler im LETZTEN Verkauf nimmt alles zurueck -------------
  d_far := pg_temp.probe_decide_on(pg_temp.probe_finding(v_s3, r2, 'sold_on'), 'take_external');
  d_last := pg_temp.probe_decide_on(pg_temp.probe_finding(v_s3, r6, 'sold_on'), 'take_external');
  v_p := pg_temp.probe_seller_recon_preview(v_s3, array[d_far, d_last]);
  perform pg_temp.probe_record(26, 'ein Abstand von elf Tagen: die Vorschau nennt beide Tage',
    (select c -> 'old' ->> 'soldOn' = '2001-05-01' and c -> 'target' ->> 'soldOn' = '2001-05-12'
       from jsonb_array_elements(v_p -> 'changes') c where (c ->> 'decisionId')::bigint = d_far));
  perform pg_temp.probe_expect(27, 'der letzte Verkauf scheitert beim Schreiben (Datum ausserhalb des Plausiblen)',
    format('select pg_temp.probe_seller_recon_apply(%s, array[%s,%s]::bigint[], %L)', v_s3, d_far, d_last, v_p ->> 'token'),
    '23514');
  perform pg_temp.probe_record(28, 'und auch der erste Verkauf ist unveraendert — alles oder nichts',
    (select s.sold_at = date '2001-05-01' from public.sales s where s.id = s2)
    and not exists (select 1 from public.sales_recon_applications a where a.sale_id in (s2, s6)));
  v_p := pg_temp.probe_seller_recon_preview(v_s3, array[d_far]);
  v_r := pg_temp.probe_seller_recon_apply(v_s3, array[d_far], v_p ->> 'token');
  perform pg_temp.probe_record(29, 'deterministic ueber elf Tage: nach ausdruecklicher Auswahl uebernommen',
    (select s.sold_at = date '2001-05-12' from public.sales s where s.id = s2));

  -- ---- nichts ausserhalb dieses Laufs hat sich bewegt -----------------------
  perform pg_temp.probe_record(30, 'Verkaeufe, Positionen, Erstattungen, Lager, Altbestand, Journal und Abgleich ausserhalb des Laufs unveraendert',
    (select bool_and(b.fingerprint = a.fingerprint) from pg_temp.probe_before b join pg_temp.probe_fingerprints() a using (what))
    and (select count(*) from pg_temp.probe_before) = 10,
    (select string_agg(b.what, ', ') from pg_temp.probe_before b join pg_temp.probe_fingerprints() a using (what)
      where b.fingerprint <> a.fingerprint));
  perform pg_temp.probe_record(31, 'jede Pruefdatenzeile ist ein Testverkauf dieses Laufs',
    (select bool_and(s.is_test and s.note like 'verify:recon-0180-probe %') from public.sales s
      where s.id in (select sale_id from pg_temp.probe_sales)));
  perform pg_temp.probe_record(32, 'keine Funktion dieses Laufs liegt ausserhalb von pg_temp, keine ist fuer eine Clientrolle ausfuehrbar',
    not exists (select 1 from pg_proc p where p.proname in (@@TEMP_NAMES@@) and p.pronamespace <> pg_my_temp_schema())
    and (select count(*) from pg_proc p where p.pronamespace = pg_my_temp_schema()) = @@TEMP_COUNT@@
    and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.pronamespace = pg_my_temp_schema() and a.privilege_type = 'EXECUTE'
                       and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))));
end
$probe_run$;


-- ---------------------------------------------------------------------------
-- Das Ergebnis — und das Ende: Abbruch, dann Rollback
-- ---------------------------------------------------------------------------
do $probe_end$
declare v_text text; v_ok integer; v_all integer;
begin
  select count(*) filter (where ok), count(*),
         string_agg(nr || ' ' || case when ok then 'ok' else 'FEHLT' end || ' ' || pruefung
                    || coalesce(' [' || befund || ']', ''), ' | ' order by nr)
    into v_ok, v_all, v_text from pg_temp.probe_result;
  raise exception 'PRUEFLAUF 0180 ZURUECKGEROLLT — %/% bestanden | %', v_ok, v_all, v_text;
end
$probe_end$;

rollback;
