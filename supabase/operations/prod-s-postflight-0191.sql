-- ===========================================================================
-- PRODUCTION — NACHKONTROLLE ZU 0191, MIT EINGESETZTER BASELINE, REIN LESEND
--
-- Im SQL-Editor des Projekts zmiwxswrpkmizvqsgype, als `postgres`, NACH
-- `supabase/operations/prod-0191.sql`.
-- DIE GANZE DATEI IN EINEM STUECK ausfuehren. Nichts daran aendern.
--
-- *** WARUM ES DIESE DATEI GIBT ***
--
-- `set_config(..., true)` gilt nur bis zum Ende der TRANSAKTION, und ohne
-- `begin` laeuft im SQL-Editor jede Anweisung in ihrer eigenen (Lehre aus
-- 0167). Baseline und Nachkontrolle stehen deshalb in EINER Transaktion:
-- `begin` … `rollback`. Muster: `prod-s-postflight-0190.sql`.
--
-- *** DIE BASELINE ***
--
-- Zeile 900 des Production-Preflights `prod_0191_preflight.sql`, vom
-- Betreiber gemeldet am 2026-11-18 (Preflight: 9998 = 0, 9999 = 0; 0190
-- nachgewiesen, 0191 nicht angewendet), wortgleich eingesetzt:
--
--   skyisles-p0191-1|7|504e8b376dc2f4ac511a7b6438ff0b85|2|f09e79301d99068ede65b422a6610e8f|7|4fc4d0a0dc8e7283008a46d935531066|2094|57c0d0504e8409e7a3c5a021acb4f53b|1862|f6ae168a63fde09f610e30cb64d7a557|cdfd7f22135a3aefeb9856c2a51a49bd|42d8433ea1182bef37257cb7b2bd4397|ff57cc3e2546c7a52efcb2c3ef5fc293|2b415755841cc33883ac61898895b7e0|cf360d2dd6a1d6ea50875f30de509673|90d3fc7fd664
--
-- 17 Teile: Marke, 15 Felder, Schutzsumme. Felder: Bestellungen 7 ·
-- Rechnungen 2 · Bestellsnapshots 7 · Lagerpositionen 2094 ·
-- Lagerbewegungen 1862 (je groesster Schluessel und Abdruck), dann die
-- Abdruecke von Verkaeufer, Rechtsfassungen, Funktionen (jetzt mit
-- seller_legal_public aus 0190, ohne die Objekte aus 0191), Tabellenrechten
-- und Policies. Schutzsumme `90d3fc7fd664` (nachgerechnet: stimmt).
--
-- *** SIE SCHREIBT NICHTS ***
--
-- `set transaction read only` als erste Anweisung: jeder Schreibversuch
-- endete mit 25006. Sie installiert nichts, ruft create_order NICHT auf,
-- liest legal_versions_public() (221) und endet mit `rollback`.
--
-- ERGEBNIS: eine Tabelle. Zeile 9999 muss `0` zeigen.
--
-- HINWEIS ZU 811-815: Sie vergleichen bestehende Zeilen bis zum groessten
-- Schluessel der Baseline. Eine NEUE Bestellung bricht sie nicht (891-895
-- melden sie); eine Zahlung, ein Versand oder eine Lagerbuchung an einer
-- BESTEHENDEN Zeile seit dem Preflight schon. 821-823 (Funktionen,
-- Tabellenrechte, Policies) duerfen nie abweichen.
-- ===========================================================================

begin;
set transaction read only;

-- ---------------------------------------------------------------------------
-- A  IST DAS PRODUCTION, UND LIEGT 0191? — positiv am Schema
-- ---------------------------------------------------------------------------
do $ziel$
begin
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     = 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: das ist Staging. Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype).';
  end if;
  if to_regprocedure('public.purchases_paid_total_is_final()') is null
     or not exists (select 1 from pg_trigger t
                     where t.tgrelid = to_regclass('public.purchases')
                       and t.tgname = 'purchases_paid_total_immutable_trg'
                       and not t.tgisinternal) then
    raise exception 'ABBRUCH A2: 0133 liegt hier nicht vollstaendig — das ist nicht Production.';
  end if;
  if exists (select 1 from pg_sequences where schemaname = 'public'
              and sequencename = 'sky_id_seq' and min_value = 928 and max_value = 4999) then
    raise exception 'ABBRUCH A3: sky_id_seq traegt das Staging-Band.';
  end if;
  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A4: weniger als 100 Katalogzeilen — kein Production-Projekt.';
  end if;
  if to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)') is null
     or to_regprocedure('public.legal_versions_public()') is null then
    raise exception 'ABBRUCH A5: 0191 liegt hier nicht (create_order mit acht Parametern '
      'oder legal_versions_public fehlt). Erst prod-0191.sql.';
  end if;
end
$ziel$;

-- ---------------------------------------------------------------------------
-- B  DIE BASELINE — in DIESER Transaktion gesetzt
-- ---------------------------------------------------------------------------
select set_config('skyisles.p0191', 'skyisles-p0191-1|7|504e8b376dc2f4ac511a7b6438ff0b85|2|f09e79301d99068ede65b422a6610e8f|7|4fc4d0a0dc8e7283008a46d935531066|2094|57c0d0504e8409e7a3c5a021acb4f53b|1862|f6ae168a63fde09f610e30cb64d7a557|cdfd7f22135a3aefeb9856c2a51a49bd|42d8433ea1182bef37257cb7b2bd4397|ff57cc3e2546c7a52efcb2c3ef5fc293|2b415755841cc33883ac61898895b7e0|cf360d2dd6a1d6ea50875f30de509673|90d3fc7fd664', true);

do $basis$
declare
  v text[] := string_to_array(current_setting('skyisles.p0191', true), '|');
begin
  if v is null or array_length(v, 1) <> 17 or v[1] <> 'skyisles-p0191-1' then
    raise exception 'ABBRUCH B1: die Baseline ist nicht angekommen oder hat nicht siebzehn Teile.';
  end if;
  if v[17] <> left(md5(array_to_string(v[2:16], '|')), 12) then
    raise exception 'ABBRUCH B2: die Schutzsumme der Baseline stimmt nicht.';
  end if;
end
$basis$;

-- ---------------------------------------------------------------------------
-- C  DIE NACHKONTROLLE, unveraendert
-- ---------------------------------------------------------------------------
-- >>> EINGEBETTET: supabase/checks/prod_0191_postflight.sql
-- ===========================================================================
-- PRODUCTION — NACHKONTROLLE ZU 0191 (create_order mit den angezeigten
--              Rechtsfassungen, neben der bisherigen), REIN LESEND
--
-- Im SQL-Editor des Projekts zmiwxswrpkmizvqsgype als `postgres`, NACH
-- `supabase/operations/prod-0191.sql`, mit der Baseline aus Zeile 900 von
-- `prod_0191_preflight.sql` in DERSELBEN TRANSAKTION (Huelle
-- `supabase/operations/prod-s-postflight-0191.sql`, gebaut erst mit der
-- gemeldeten Zeile):
--
--     select set_config('skyisles.p0191', 'skyisles-p0191-1|…', true);
--
-- **Erwartet: Zeile 9999 = `0`.**
--
--   101-106  die Umgebung (wie der Preflight).
--   201-206  die Achter: Rumpf aus 0191, Form, keine Standardwerte, dieselben
--            Empfaenger wie die Sechser, genau zwei Ueberladungen.
--   207-209  die Sechser: unveraendert der Rumpf aus 0139, ihre Form, und
--            anon/authenticated duerfen sie weiter.
--   211-215  legal_versions_public: Rumpf, Form, Spalten, Rechte; die
--            Fassungstabelle bleibt gesperrt.
--   221-222  was legal_versions_public() nennt und was die Tabelle traegt:
--            viermal 2026-09-17.
--   231      seller_legal_public ist unveraendert die aus 0190.
--   801-803  die Baseline.
--   811-823  WAS SICH NICHT BEWEGT HAT (wie bei 0190; die Sechser steht im
--            Funktionsabdruck 821 mit Rechten und Rumpf).
--   891-899  AUSKUNFT.
--
-- SIE SCHREIBT NICHTS. Sie ruft create_order NICHT auf.
-- ===========================================================================

with
seq as (
  select min_value, max_value, cycle from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq'
),
mess as (
  select
    (select coalesce(max(t.id), 0)::text from public.orders t) as orders_max,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orders t) as orders_fp,
    (select coalesce(max(t.id), 0)::text from public.invoices t) as invoices_max,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.invoices t) as invoices_fp,
    (select coalesce(max(t.order_id), 0)::text from public.order_legal_snapshots t) as order_legal_snapshots_max,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.order_id)), '-') from public.order_legal_snapshots t) as order_legal_snapshots_fp,
    (select coalesce(max(t.id), 0)::text from public.shop_inventory t) as shop_inventory_max,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory_fp,
    (select coalesce(max(t.id), 0)::text from public.inventory_movements t) as inventory_movements_max,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements_fp,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sellers t) as sellers_fp,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.slug)), '-') from public.legal_document_versions t) as ldv_fp,
    (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || md5(p.prosrc),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.oid <> coalesce(to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)'), 0) and p.oid <> coalesce(to_regprocedure('public.legal_versions_public()'), 0)) as funktionen_fp,
    (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')) as tabellenrechte_fp,
    (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies_fp
),
feld as (
  select orders_max || '|' || orders_fp || '|' || invoices_max || '|' || invoices_fp || '|' || order_legal_snapshots_max || '|' || order_legal_snapshots_fp || '|' || shop_inventory_max || '|' || shop_inventory_fp || '|' || inventory_movements_max || '|' || inventory_movements_fp || '|' || sellers_fp || '|' || ldv_fp || '|' || funktionen_fp || '|' || tabellenrechte_fp || '|' || policies_fp as kern, m.* from mess m
),
heute as (
  select 'skyisles-p0191-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from feld f
),
basis as (
  select nullif(btrim(coalesce(current_setting('skyisles.p0191', true), '')), '') as roh
),
teil as (
  select roh, case when roh is null then null else string_to_array(roh, '|') end as t from basis
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (101, 'Umgebung', 'purchases_paid_total_is_final() liegt — 0133, und 0133 liegt '
                    'NUR auf Production',
      (select (to_regprocedure('public.purchases_paid_total_is_final()') is not null)::text),
      'true'),
  (102, 'Umgebung', 'und ihr Trigger purchases_paid_total_immutable_trg auch — '
                    'zwei Objekte, damit ein halber Stand auffaellt',
      (select (count(*) > 0)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.purchases')
          and t.tgname = 'purchases_paid_total_immutable_trg' and not t.tgisinternal),
      'true'),
  (103, 'Umgebung', 'sky_id_seq traegt NICHT das Staging-Band 928..4999',
      (select (count(*) = 0)::text from seq where min_value = 928 and max_value = 4999),
      'true'),
  (104, 'Umgebung', 'sondern den unbegrenzten Stand ODER das Production-Band 5001..8999',
      (select (count(*) = 1)::text from seq
        where (min_value = 1 and max_value = 9223372036854775807)
           or (min_value = 5001 and max_value = 8999)),
      'true'),
  (105, 'Umgebung', 'der Katalog traegt Zeilen (mindestens 100)',
      (select (count(*) >= 100)::text from public.skylanders), 'true'),
  (106, 'Umgebung', 'die Datenbank traegt NICHT den Staging-Stempel',
      (select (coalesce(shobj_description(d.oid, 'pg_database'), '') <> 'skyisles-staging qqxcpesbwfxzgytkdsac')::text
         from pg_database d where d.datname = current_database()),
      'true'),

  (201, 'Achter', 'create_order (acht Parameter) ist die Fassung aus 0191 (md5 des Rumpfs)',
      coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)')), '(fehlt)'), '75fbeaea7b193035717eeb37c0995127'),
  (202, 'Achter', 'SECURITY DEFINER, genau ein leerer search_path',
      (select count(*)::text from pg_proc p
        where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)') and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')), '1'),
  (203, 'Achter', 'keine Standardwerte — ein Aufruf mit sechs Namen kann sie nicht treffen',
      coalesce((select p.pronargdefaults::text from pg_proc p where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)')), '(fehlt)'), '0'),
  (204, 'Rechte', 'die Achter hat dieselben Empfaenger wie die Sechser',
      coalesce((select 'anon=' || has_function_privilege('anon', p.oid, 'execute')::text
                     || ',authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')::text
                     || ',service_role=' || has_function_privilege('service_role', p.oid, 'execute')::text
                     || ',PUBLIC=' || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                               where a.privilege_type = 'EXECUTE' and a.grantee = 0)::text
                  from pg_proc p where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)')), '(fehlt)'),
      coalesce((select 'anon=' || has_function_privilege('anon', p.oid, 'execute')::text
                     || ',authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')::text
                     || ',service_role=' || has_function_privilege('service_role', p.oid, 'execute')::text
                     || ',PUBLIC=' || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                               where a.privilege_type = 'EXECUTE' and a.grantee = 0)::text
                  from pg_proc p where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)')), '(Sechser fehlt)')),
  (205, 'Rechte', 'PUBLIC darf die Achter NICHT',
      coalesce((select exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where a.privilege_type = 'EXECUTE' and a.grantee = 0)::text
                  from pg_proc p where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)')), '(fehlt)'), 'false'),
  (206, 'Achter', 'create_order gibt es genau zweimal — die Sechser und die Achter',
      (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_order'), '2'),
  (207, 'Sechser', 'die Sechser ist unveraendert der Rumpf aus 0139',
      coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)')), '(fehlt)'), 'c233337c0ca0555756f21e1abe173593'),
  (208, 'Sechser', 'und unveraendert SECURITY DEFINER mit genau einem leeren search_path',
      (select count(*)::text from pg_proc p
        where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)') and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')), '1'),
  (209, 'Sechser', 'anon und authenticated duerfen sie weiter (der laufende Checkout bis zum Deployment)',
      coalesce((has_function_privilege('anon', to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'), 'execute')
                and has_function_privilege('authenticated', to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'), 'execute'))::text, '(fehlt)'), 'true'),

  (211, 'Fassung', 'legal_versions_public() ist die Fassung aus 0191 (md5 des Rumpfs)',
      coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.legal_versions_public()')), '(fehlt)'), '5e9daa01284d9b06b1b7d8fb053cff36'),
  (212, 'Fassung', 'STABLE, SECURITY DEFINER, genau ein leerer search_path',
      (select count(*)::text from pg_proc p
        where p.oid = to_regprocedure('public.legal_versions_public()') and p.prosecdef and p.provolatile = 's'
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')), '1'),
  (213, 'Fassung', 'genau die vier Kennungen als Spalten',
      coalesce(pg_get_function_result(to_regprocedure('public.legal_versions_public()')), '(fehlt)'),
      'TABLE(agb text, widerruf text, datenschutz text, impressum text)'),
  (214, 'Rechte', 'anon und authenticated duerfen; service_role und PUBLIC nicht',
      coalesce((has_function_privilege('anon', to_regprocedure('public.legal_versions_public()'), 'execute')
                and has_function_privilege('authenticated', to_regprocedure('public.legal_versions_public()'), 'execute')
                and not has_function_privilege('service_role', to_regprocedure('public.legal_versions_public()'), 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                 where p.oid = to_regprocedure('public.legal_versions_public()') and a.privilege_type = 'EXECUTE' and a.grantee = 0))::text,
               '(fehlt)'), 'true'),
  (215, 'Rechte', 'legal_document_versions bleibt fuer anon und authenticated gesperrt',
      (not has_table_privilege('anon', 'public.legal_document_versions', 'select')
       and not has_table_privilege('authenticated', 'public.legal_document_versions', 'select'))::text, 'true'),

  (221, 'Ausgabe', 'legal_versions_public() nennt viermal 2026-09-17',
      case when to_regprocedure('public.legal_versions_public()') is null then '(fehlt)'
           else (xpath('/row/c/text()', query_to_xml(
                  'select ''agb='' || agb || '',datenschutz='' || datenschutz || '',impressum='' || impressum || '',widerruf='' || widerruf as c from public.legal_versions_public()',
                  false, true, '')))[1]::text end,
      'agb=2026-09-17,datenschutz=2026-09-17,impressum=2026-09-17,widerruf=2026-09-17'),

  (231, 'Unberuehrt', 'seller_legal_public() ist unveraendert die aus 0190',
      coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_legal_public()')), '(fehlt)'), '147b403e834f4e525bad11d3494ea083'),

  (232, 'Rechtsfassung', 'die Tabelle traegt viermal 2026-09-17 (0192 ist NICHT angewendet)',
      (select coalesce(string_agg(v.slug || '=' || v.version, ',' order by v.slug), '(keine)') from public.legal_document_versions v),
      'agb=2026-09-17,datenschutz=2026-09-17,impressum=2026-09-17,widerruf=2026-09-17'),

  (801, 'Basis', 'eine Baseline ist uebergeben worden',
      (select case when roh is null then 'FEHLT' else 'ja' end from basis), 'ja'),
  (802, 'Basis', 'sie traegt die Marke skyisles-p0191-1 und 17 Teile',
      (select case when t is null then 'keine Baseline'
                   else (t[1] = 'skyisles-p0191-1' and array_length(t, 1) = 17)::text end from teil), 'true'),
  (803, 'Basis', 'die Schutzsumme stimmt — kein Feld vertauscht, keine Stelle fort',
      (select case when t is null then 'keine Baseline'
                   else (t[17] = left(md5(array_to_string(t[2:16], '|')), 12))::text end from teil), 'true'),

  (811, 'Unveraendert', 'bestehende Bestellungen (bis zum groessten Schluessel der Baseline): Abdruck',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orders t where t.id <= (select t[2]::bigint from teil)),
      (select coalesce(t[3], '(keine Baseline)') from teil)),
  (812, 'Unveraendert', 'bestehende Rechnungen (bis zum groessten Schluessel der Baseline): Abdruck',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.invoices t where t.id <= (select t[4]::bigint from teil)),
      (select coalesce(t[5], '(keine Baseline)') from teil)),
  (813, 'Unveraendert', 'bestehende Bestellsnapshots (bis zum groessten Schluessel der Baseline): Abdruck',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.order_id)), '-') from public.order_legal_snapshots t where t.order_id <= (select t[6]::bigint from teil)),
      (select coalesce(t[7], '(keine Baseline)') from teil)),
  (814, 'Unveraendert', 'bestehende Lagerpositionen (bis zum groessten Schluessel der Baseline): Abdruck',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t where t.id <= (select t[8]::bigint from teil)),
      (select coalesce(t[9], '(keine Baseline)') from teil)),
  (815, 'Unveraendert', 'bestehende Lagerbewegungen (bis zum groessten Schluessel der Baseline): Abdruck',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t where t.id <= (select t[10]::bigint from teil)),
      (select coalesce(t[11], '(keine Baseline)') from teil)),
  (816, 'Unveraendert', 'Verkaeufer: jede Zeile, jede Spalte',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sellers t),
      (select coalesce(t[12], '(keine Baseline)') from teil)),
  (817, 'Unveraendert', 'Rechtsfassungen: jede Zeile',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.slug)), '-') from public.legal_document_versions t),
      (select coalesce(t[13], '(keine Baseline)') from teil)),
  (821, 'Unveraendert', 'jede Funktion in public ausser create_order (acht Parameter) und legal_versions_public(): Rechte, Form, Rumpf',
      (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || md5(p.prosrc),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.oid <> coalesce(to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)'), 0) and p.oid <> coalesce(to_regprocedure('public.legal_versions_public()'), 0)),
      (select coalesce(t[14], '(keine Baseline)') from teil)),
  (822, 'Unveraendert', 'Rechte und RLS-Schalter jeder Tabelle, Sicht und Sequenz in public',
      (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')),
      (select coalesce(t[15], '(keine Baseline)') from teil)),
  (823, 'Unveraendert', 'jede Policy in public',
      (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public'),
      (select coalesce(t[16], '(keine Baseline)') from teil)),

  (891, 'Auskunft', 'Bestellungen, die seit der Baseline dazukamen',
      (select count(*)::text from public.orders x where x.id > (select t[2]::bigint from teil)), null),
  (892, 'Auskunft', 'Rechnungen, die seit der Baseline dazukamen',
      (select count(*)::text from public.invoices x where x.id > (select t[4]::bigint from teil)), null),
  (893, 'Auskunft', 'Bestellsnapshots, die seit der Baseline dazukamen',
      (select count(*)::text from public.order_legal_snapshots x where x.order_id > (select t[6]::bigint from teil)), null),
  (894, 'Auskunft', 'Lagerpositionen, die seit der Baseline dazukamen',
      (select count(*)::text from public.shop_inventory x where x.id > (select t[8]::bigint from teil)), null),
  (895, 'Auskunft', 'Lagerbewegungen, die seit der Baseline dazukamen',
      (select count(*)::text from public.inventory_movements x where x.id > (select t[10]::bigint from teil)), null),
  (898, 'Basis', 'die uebergebene Baseline, wie sie gelesen wurde', (select coalesce(roh, '(keine)') from basis), null),
  (899, 'Basis', 'der heutige Stand als Baseline-Zeile', (select zeile from heute), null)
),
ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte (0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
-- <<< ENDE: supabase/checks/prod_0191_postflight.sql

rollback;
