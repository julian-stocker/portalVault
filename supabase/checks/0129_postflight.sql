-- ===========================================================================
-- POSTFLIGHT fuer Migration 0129  —  nach der Erweiterung der Sicherung
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Rollenumschaltung. Sie ruft `seller_business_backup()` NICHT auf — geprueft
-- wird ihre DEFINITION. Ob die Datei am Ende wirklich 28 Bereiche enthaelt,
-- zeigt ein Download; das steht als Handprobe in `0129_restore_test.md`.
--
-- Zeile 9999 muss 0 zeigen.
-- ===========================================================================

with
def as (
  select coalesce(pg_get_functiondef(to_regprocedure('public.seller_business_backup()')),
                  '') as d
),
code as (
  select regexp_replace(regexp_replace(d.d, '/\*.*?\*/', '', 'g'),
                        '--.*', '', 'gn') as d
    from def d
),

pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Die Funktion bleibt, was sie war
  -- =====================================================================
  (101, 'Form', 'seller_business_backup() ist da',
        (to_regprocedure('public.seller_business_backup()') is not null)::text, 'true'),
  (102, 'Form', 'genau eine Fassung',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_business_backup'))::text, '1'),
  (103, 'Form', 'ohne Argumente',
        (coalesce((select p.pronargs::text from pg_proc p
                    where p.oid = to_regprocedure('public.seller_business_backup()')),
                  '(fehlt)'))::text, '0'),
  (104, 'Form', 'stable — sie liest nur',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.oid = to_regprocedure('public.seller_business_backup()')),
                  '(fehlt)'))::text, 's'),
  (105, 'Form', 'security definer',
        ((select p.prosecdef from pg_proc p
           where p.oid = to_regprocedure('public.seller_business_backup()')))::text, 'true'),
  (106, 'Form', 'leerer search_path',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where p.oid = to_regprocedure('public.seller_business_backup()')
                      and c like 'search\_path=%'), '(leer)'))::text, '(leer)'),
  (107, 'Form', 'kein Stringliteral traegt einen Kommentarstarter',
        ((select count(*) from def d,
               regexp_matches(d.d, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
           where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%'))::text,
        '0'),
  /*
   * EINE ANWEISUNG — DAHER EINE MOMENTAUFNAHME.
   *
   * Der Rumpf enthaelt genau EINEN Anweisungstrenner. Zwei Statements saehen
   * zwei MVCC-Momentaufnahmen, und dann koennte ein Beleg in der Datei stehen,
   * dessen Einkauf fehlt.
   */
  (108, 'Form', 'genau ein Anweisungstrenner im Rumpf',
        ((select (length(substring(d.d from position('AS $function$' in d.d)))
                  - length(replace(substring(d.d from position('AS $function$' in d.d)),
                                   ';', '')))
            from code d))::text, '1'),

  -- =====================================================================
  -- 2xx  Die drei neuen Bereiche
  -- =====================================================================
  (201, 'Belege', 'purchase_receipts ist ein Bereich',
        ((select position('from public.purchase_receipts t' in d.d) > 0 from code d))::text,
        'true'),
  (202, 'Belege', 'purchase_receipt_downloads ist ein Bereich',
        ((select position('from public.purchase_receipt_downloads t' in d.d) > 0
            from code d))::text, 'true'),
  (203, 'Belege', 'purchase_receipt_counters ist ein Bereich',
        ((select position('from public.purchase_receipt_counters t' in d.d) > 0
            from code d))::text, 'true'),
  (204, 'Belege', 'der eingefrorene Snapshot kommt als Ganzes mit',
        ((select position('''lines'', t.lines' in d.d) > 0 from code d))::text, 'true'),
  (205, 'Belege', 'der Fingerabdruck kommt mit — sonst ist „abweichend" nicht pruefbar',
        ((select position('''content_fingerprint'', t.content_fingerprint' in d.d) > 0
            from code d))::text, 'true'),
  (206, 'Belege', 'die Revisionskette kommt vollstaendig mit',
        ((select count(*) from (values ('''revision'', t.revision'),
            ('''supersedes_id'', t.supersedes_id'),
            ('''supersedes_number'', t.supersedes_number'),
            ('''supersedes_issued_at'', t.supersedes_issued_at')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '4'),
  (207, 'Belege', 'der Nummernzaehler kommt mit',
        ((select count(*) from (values ('''year'', t.year'),
            ('''next_number'', t.next_number')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '2'),
  (208, 'Belege', 'der Abrufnachweis kommt mit',
        ((select count(*) from (values ('''receipt_id'', t.receipt_id'),
            ('''delivered_at'', t.delivered_at'),
            ('''byte_count'', t.byte_count')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '3'),
  (209, 'Belege', 'Betraege als Text — nie als JSON-Zahl',
        ((select count(*) from (values ('''total_cost'', t.total_cost::text'),
            ('''items_cost'', t.items_cost::text')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '2'),
  (210, 'Belege', 'Info: Anzahl Bereiche insgesamt',
        ((select count(*) from code d,
               regexp_matches(d.d, '^\s{6}''([a-z_]+)'', coalesce\(\(', 'gn') as m(k)))::text,
        null),
  (211, 'Belege', 'es sind 28',
        ((select count(*) from code d,
               regexp_matches(d.d, '^\s{6}''([a-z_]+)'', coalesce\(\(', 'gn') as m(k)))::text,
        '28'),

  -- =====================================================================
  -- 22x  Kontoidentitaeten und Geheimnisse bleiben draussen
  -- =====================================================================
  (221, 'Sperre', 'issued_by und delivered_by werden nicht ausgegeben',
        ((select count(*) from (values ('''issued_by'''), ('''delivered_by''')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  (222, 'Sperre', 'und die uebrigen Kontoidentitaeten auch nicht',
        ((select count(*) from (values ('''created_by'''), ('''updated_by'''),
            ('''user_id'''), ('''client_salt''')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  (223, 'Sperre', 'sie schreibt nichts, in keiner Form',
        ((select count(*) from (values ('insert into'), ('update public.'),
            ('delete from'), ('create temp'), ('truncate'), ('nextval'), ('setval'),
            ('txid_current()')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  (224, 'Sperre', 'der Betreiberwaechter steht weiterhin drin',
        ((select position('can_operate_active_seller()' in d.d) > 0 from code d))::text,
        'true'),
  (225, 'Sperre', 'und die Momentaufnahme wird weiterhin belegt',
        ((select position('pg_current_snapshot()::text' in d.d) > 0 from code d))::text,
        'true'),
  (226, 'Rechte', 'PUBLIC und anon duerfen die Sicherung nicht abrufen',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.seller_business_backup()')
             and a.privilege_type = 'EXECUTE'
             and (a.grantee = 0 or a.grantee::regrole::text = 'anon')))::text, '0'),
  (227, 'Rechte', 'authenticated darf weiterhin — das drop haette den ACL mitgenommen',
        (has_function_privilege('authenticated', 'public.seller_business_backup()',
                                'EXECUTE'))::text, 'true'),
  (228, 'Rechte', 'die Belegtabellen bleiben direkt unlesbar',
        ((select count(*) from (values ('anon'), ('authenticated')) t(rolle)
            cross join (values ('purchase_receipts'), ('purchase_receipt_counters'),
                               ('purchase_receipt_downloads')) u(tab)
           where has_table_privilege(t.rolle, 'public.' || u.tab, 'SELECT')))::text, '0'),

  -- =====================================================================
  -- 3xx  Die 25 bestehenden Bereiche sind unveraendert dabei
  -- =====================================================================
  (301, 'Bestand', 'die acht tragenden Bereiche stehen weiterhin',
        ((select count(*) from (values ('from public.shop_inventory t'),
            ('from public.inventory_movements t'), ('from public.purchases t'),
            ('from public.purchase_items t'), ('from public.sales t'),
            ('from public.orders t'), ('from public.invoices t'),
            ('from public.sellers t')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '8'),
  (302, 'Bestand', 'die Legacy-Maschinerie bleibt draussen',
        ((select count(*) from (values ('from public.legacy_stock_events t'),
            ('from public.inventory_imports t'), ('from public.inventory_import_rows t'),
            ('from public.inventory_import_mappings t')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  (303, 'Bestand', 'und der Formatvertrag ist unveraendert',
        ((select count(*) from (values ('''skyisles-business-backup'''),
            ('''format_version'',  1'), ('''restore_supported'',      false')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '3'),

  -- =====================================================================
  -- 9xx  Bestand — gegen den Preflight vergleichen
  -- =====================================================================
  (901, 'Umgebung', 'Info: Serverversion',
        (current_setting('server_version'))::text, null),
  (902, 'Bestand', 'Einkaeufe / Positionen (Preflight 902)',
        ((select count(*)::text from public.purchases) || ' / '
         || (select count(*)::text from public.purchase_items))::text, null),
  (911, 'Beleg', 'Belege / Abrufe / Zaehler — MUSS Preflight 911 gleichen',
        ((select count(*)::text from public.purchase_receipts) || ' / '
         || (select count(*)::text from public.purchase_receipt_downloads) || ' / '
         || (select count(*)::text from public.purchase_receipt_counters))::text, null),
  (912, 'Beleg', 'Pruefsumme der Fingerabdruecke — MUSS Preflight 912 gleichen',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.content_fingerprint,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (913, 'Beleg', 'Pruefsumme der Positionslisten — MUSS Preflight 913 gleichen',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.lines::text,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),

  -- =====================================================================
  -- 99x  Invarianten
  -- =====================================================================
  (991, 'Invariante', 'kein Beleg mit revision > 1 ohne Vorgaenger',
        ((select count(*) from public.purchase_receipts
           where revision > 1 and supersedes_id is null))::text, '0'),
  (992, 'Invariante', 'jeder Abruf gehoert zu einem vorhandenen Beleg',
        ((select count(*) from public.purchase_receipt_downloads d
           where not exists (select 1 from public.purchase_receipts r
                              where r.id = d.receipt_id)))::text, '0'),
  (993, 'Invariante', 'negative Lagermengen',
        ((select count(*) from public.shop_inventory where quantity < 0))::text, '0')
),

ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)

select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
order by nr;
