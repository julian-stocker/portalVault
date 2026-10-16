-- ===========================================================================
-- POSTFLIGHT fuer Migration 0128  —  nach dem Anlegen der Korrekturkette
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Betreiber-Simulation, kein set_config, keine Rollenumschaltung.
--
-- Zeile 9999 muss 0 zeigen.
--
-- ---------------------------------------------------------------------------
-- WAS DIESE DATEI PRUEFEN KANN UND WAS NICHT
--
-- Sie prueft den ZUSTAND: die zwei Spalten mit ihren validierten
-- Zusicherungen, die zwei Funktionen mit Signatur, Rechten und Rumpf, die
-- unveraenderte Struktur aus `0122`/`0123` — und dass sich kein Beleg bewegt
-- hat.
--
-- SIE KANN NICHT PRUEFEN, was nur ein Schreibvorgang zeigt: dass eine
-- Korrektur ohne Abweichung wirklich abgelehnt wird, dass zwei gleichzeitige
-- Korrekturen hintereinander laufen, dass der ersetzte Beleg nach einer
-- Korrektur unveraendert dasteht. Das sind Faelle fuer die Hand; sie stehen in
-- `0128_test_plan.md`. Eine lesende Datei, die so etwas behauptet, wuerde
-- luegen.
-- ===========================================================================

with
korr as (
  select coalesce(pg_get_functiondef(to_regprocedure(
           'public.seller_issue_purchase_receipt_correction(bigint)')), '') as d
),
code as (
  select regexp_replace(regexp_replace(k.d, '/\*.*?\*/', '', 'g'),
                        '--.*', '', 'gn') as d
    from korr k
),

pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Die zwei Spalten und ihre Zusicherungen
  -- =====================================================================
  (101, 'Spalten', 'supersedes_number und supersedes_issued_at stehen',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchase_receipts'
             and column_name in ('supersedes_number', 'supersedes_issued_at')))::text, '2'),
  (102, 'Spalten', 'beide sind nullable — ein Ursprungsbeleg hat keinen Verweis',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchase_receipts'
             and column_name in ('supersedes_number', 'supersedes_issued_at')
             and is_nullable = 'YES'))::text, '2'),
  (103, 'Spalten', 'und ohne Default — ein Default haette die Tabelle neu geschrieben',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchase_receipts'
             and column_name in ('supersedes_number', 'supersedes_issued_at')
             and column_default is not null))::text, '0'),
  (104, 'Spalten', 'die zwei Verweis-Zusicherungen stehen',
        ((select count(*) from pg_constraint
           where conrelid = 'public.purchase_receipts'::regclass
             and conname in ('receipts_supersedes_ref_complete',
                             'receipts_supersedes_number_shape')))::text, '2'),
  /*
   * UND SIE SIND VALIDIERT.
   *
   * `not valid` waere eine Zusicherung, die fuer bestehende Zeilen nichts
   * sagt — und bestehende Zeilen sind hier die ausgestellten Belege.
   */
  (105, 'Spalten', 'beide sind validiert, nicht `not valid`',
        ((select count(*) from pg_constraint
           where conrelid = 'public.purchase_receipts'::regclass
             and conname in ('receipts_supersedes_ref_complete',
                             'receipts_supersedes_number_shape')
             and convalidated))::text, '2'),

  -- =====================================================================
  -- 11x  Kein bestehender Beleg wurde angefasst
  -- =====================================================================
  (111, 'Bestand', 'kein Ursprungsbeleg traegt einen Verweis',
        ((select count(*) from public.purchase_receipts
           where supersedes_id is null
             and (supersedes_number is not null
                  or supersedes_issued_at is not null)))::text, '0'),
  (112, 'Bestand', 'und keine Revision wurde verschoben',
        ((select count(*) from public.purchase_receipts
           where (supersedes_id is null) <> (revision = 1)))::text, '0'),
  (113, 'Bestand', 'jeder Verweis ist vollstaendig oder ganz leer',
        ((select count(*) from public.purchase_receipts
           where (supersedes_id is null) <> (supersedes_number is null)
              or (supersedes_id is null) <> (supersedes_issued_at is null)))::text, '0'),
  (114, 'Bestand', 'jede Verweisnummer hat die Belegform',
        ((select count(*) from public.purchase_receipts
           where supersedes_number is not null
             and supersedes_number !~ '^SI-E-[0-9]{4}-[0-9]{6}$'))::text, '0'),
  (115, 'Bestand', 'und sie nennt wirklich die Nummer des Vorgaengers',
        ((select count(*) from public.purchase_receipts r
           join public.purchase_receipts v on v.id = r.supersedes_id
          where r.supersedes_number is distinct from v.receipt_number
             or r.supersedes_issued_at is distinct from v.issued_at))::text, '0'),

  -- =====================================================================
  -- 2xx  Die zwei neuen Funktionen
  -- =====================================================================
  (201, 'Funktion', 'die Korrekturfunktion ist da',
        (to_regprocedure('public.seller_issue_purchase_receipt_correction(bigint)')
           is not null)::text, 'true'),
  (202, 'Funktion', 'die Historienfunktion ist da',
        (to_regprocedure('public.seller_purchase_receipt_history(bigint)')
           is not null)::text, 'true'),
  (203, 'Funktion', 'keine von beiden ist mehrfach ueberladen',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt_history')))::text, '2'),
  /*
   * EIN ARGUMENT, TYPBASIERT GEPRUEFT.
   *
   * `proargtypes` ist ein NULLBASIERTER oidvector — `[0]` ist das erste
   * Argument. Verglichen wird Position fuer Position und niemals der ganze
   * Vektor gegen ein `array[...]`-Literal: dessen untere Grenze ist 1, und die
   * Array-Gleichheit vergleicht die Grenzen mit. Daran ist `0127` beim ersten
   * Anwendungsversuch gescheitert.
   */
  (204, 'Funktion', 'beide nehmen genau ein bigint',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt_history')
             and p.pronargs = 1
             and p.proargtypes[0]::regtype = 'bigint'::regtype))::text, '2'),
  (205, 'Funktion', 'beide geben jsonb zurueck',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt_history')
             and p.prorettype::regtype = 'jsonb'::regtype))::text, '2'),
  (206, 'Funktion', 'die Korrektur ist volatile — sie schreibt',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.oid = to_regprocedure(
                      'public.seller_issue_purchase_receipt_correction(bigint)')),
                  '(fehlt)'))::text, 'v'),
  (207, 'Funktion', 'die Historie ist stable — sie liest nur',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.oid = to_regprocedure(
                      'public.seller_purchase_receipt_history(bigint)')), '(fehlt)'))::text,
        's'),
  (208, 'Funktion', 'beide sind security definer',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt_history')
             and p.prosecdef))::text, '2'),
  /* Leerer search_path, QUOTIERT abgelegt: `search_path=""`. */
  (209, 'Funktion', 'beide haben einen LEEREN search_path',
        ((select count(*) from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt_history')
             and c like 'search\_path=%'
             and nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '') is null))::text,
        '2'),
  (210, 'Funktion', 'beide gehoeren dem Eigentuemer der Belegfunktionen',
        ((select count(distinct p.proowner) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt_history',
                               'seller_issue_purchase_receipt',
                               'purchase_receipt_fingerprint')))::text, '1'),
  (211, 'Funktion', 'Info: der Kommentar der Korrekturfunktion, erste 90 Zeichen',
        (left(coalesce(obj_description(to_regprocedure(
          'public.seller_issue_purchase_receipt_correction(bigint)'), 'pg_proc'),
          '(kein Kommentar)'), 90))::text, null),

  -- =====================================================================
  -- 22x  Die Rechte
  -- =====================================================================
  (221, 'Rechte', 'beide haben einen ACL (NULL waere EXECUTE fuer PUBLIC)',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt_history')
             and p.proacl is not null))::text, '2'),
  (222, 'Rechte', 'PUBLIC und anon duerfen keine von beiden ausfuehren',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt_history')
             and a.privilege_type = 'EXECUTE'
             and (a.grantee = 0 or a.grantee::regrole::text = 'anon')))::text, '0'),
  (223, 'Rechte', 'authenticated darf beide ausfuehren',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt_history')
             and a.privilege_type = 'EXECUTE'
             and a.grantee <> 0
             and a.grantee::regrole::text = 'authenticated'))::text, '2'),
  /* service_role behaelt EXECUTE mit Absicht (ADR-0125) — kein Mangel. */
  (224, 'Rechte', 'kein weiterer Empfaenger als authenticated, service_role, Eigentuemer',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt_history')
             and a.privilege_type = 'EXECUTE'
             and a.grantee <> p.proowner
             and (a.grantee = 0
                  or (a.grantee::regrole::text <> 'service_role'
                      and a.grantee::regrole::text <> 'authenticated'))))::text, '0'),

  -- =====================================================================
  -- 3xx  Der Rumpf der Korrektur, kommentarfrei geprueft
  -- =====================================================================
  (301, 'Rumpf', 'kein Stringliteral traegt einen Kommentarstarter',
        ((select count(*) from korr k,
               regexp_matches(k.d, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
           where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%'))::text,
        '0'),
  (302, 'Rumpf', 'das Betreibertor steht vor der Sperre',
        ((position('can_operate_active_seller()' in (select d from code)) > 0
          and position('can_operate_active_seller()' in (select d from code))
              < position('for update' in (select d from code))))::text, 'true'),
  (303, 'Rumpf', 'die Sperre steht vor dem Lesen der Kettenspitze',
        ((position('for update' in (select d from code))
          < position('order by r.revision desc' in (select d from code))))::text, 'true'),
  (304, 'Rumpf', 'der Fingerabdruck wird verglichen',
        ((select count(*) from (values ('public.purchase_receipt_fingerprint(p_purchase_id)'),
            ('v_tip.content_fingerprint = v_now'),
            ('nothing changed since the last receipt')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '3'),
  /*
   * UND ZWAR VOR DER NUMMERNVERGABE.
   *
   * Sonst verbrauchte eine abgelehnte Korrektur eine Nummer. Die Transaktion
   * gaebe sie zurueck — aber die Reihenfolge soll stimmen, nicht nur das
   * Ergebnis.
   */
  (305, 'Rumpf', 'der Vergleich steht VOR dem Zaehler',
        ((position('nothing changed since the last receipt' in (select d from code))
          < position('purchase_receipt_counters' in (select d from code))))::text, 'true'),
  (306, 'Rumpf', 'ohne Ursprungsbeleg wird abgelehnt',
        (position('there is no receipt to correct' in (select d from code)) > 0)::text,
        'true'),
  (307, 'Rumpf', 'Revision und Verweis werden aus der Spitze uebernommen',
        ((select count(*) from (values ('v_tip.revision + 1'), ('v_tip.id'),
            ('v_tip.receipt_number'), ('v_tip.issued_at')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '4'),
  (308, 'Rumpf', 'dieselbe Nummernvergabe wie die Erstausstellung',
        ((select count(*) from (values ('insert into public.purchase_receipt_counters as c'),
            ('on conflict (year) do update'),
            ('''SI-E-'' || v_year::text || ''-'' || lpad(v_number::text, 6, ''0'')')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '3'),
  (309, 'Rumpf', 'die drei weiteren Ablehnungen stehen wie bei der Erstausstellung',
        ((select count(*) from (values ('a test purchase gets no receipt'),
            ('a receipt needs the purchase date'),
            ('no complete business address')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '3'),
  /*
   * SIE AENDERT UND LOESCHT NICHTS.
   *
   * Ein `update` auf `purchase_receipt_counters` ist erlaubt und steht als
   * `on conflict` ausdruecklich da; gesucht wird deshalb nach den Tabellen und
   * nicht nach dem Wort.
   */
  (310, 'Rumpf', 'kein Schreiben an Belegen, Positionen, Lager oder Einkauf',
        ((select count(*) from (values ('update public.purchase_receipts'),
            ('delete from public.purchase_receipts'),
            ('delete from public.purchase_receipt_downloads'),
            ('update public.purchase_items'), ('delete from public.purchase_items'),
            ('update public.purchases'),
            ('inventory_movements'), ('shop_inventory')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  (311, 'Rumpf', 'und sie antwortet mit dem Lesezustand des Einkaufs',
        (position('public.seller_purchase_receipt(p_purchase_id)'
          in (select d from code)) > 0)::text, 'true'),
  (312, 'Rumpf', 'die Historie schreibt nicht',
        ((select count(*) from (values ('insert into'), ('update public.'),
            ('delete from')) t(k)
           where position(t.k in coalesce(pg_get_functiondef(to_regprocedure(
             'public.seller_purchase_receipt_history(bigint)')), '')) > 0))::text, '0'),

  -- =====================================================================
  -- 4xx  0122 und 0123 sind unveraendert
  -- =====================================================================
  (401, '0122', 'die Unveraenderlichkeits-Trigger stehen weiterhin',
        ((select count(*) from pg_trigger
           where not tgisinternal
             and tgname in ('purchase_receipts_immutable_trg',
                            'purchase_receipt_downloads_immutable_trg')))::text, '2'),
  (402, '0122', 'die zwei Teilindizes stehen weiterhin',
        ((select count(*) from pg_indexes
           where schemaname = 'public'
             and indexname in ('purchase_receipts_origin_uniq',
                               'purchase_receipts_supersedes_uniq')))::text, '2'),
  (403, '0122', 'die acht Zusicherungen der Kette stehen weiterhin',
        ((select count(*) from pg_constraint
           where conrelid = 'public.purchase_receipts'::regclass
             and conname in ('receipts_supersedes_fk', 'receipts_revision_matches_chain',
                             'receipts_no_self_reference', 'receipts_id_purchase_uniq',
                             'receipts_number_unique', 'receipts_number_shape',
                             'receipts_revision_sane', 'receipts_lines_present')))::text,
        '8'),
  (404, '0122', 'die Erstausstellung ist unveraendert und idempotent',
        (position('return public.seller_purchase_receipt(p_purchase_id);'
          in coalesce((select p.prosrc from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'seller_issue_purchase_receipt'), '')) > 0)::text, 'true'),
  (405, '0123', 'sie schreibt weiterhin die Formatnummer',
        (position('content_fingerprint, format_version' in coalesce((select p.prosrc
          from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_issue_purchase_receipt'), '')) > 0)::text, 'true'),
  (406, '0125', 'authenticated darf den Fingerabdruck weiterhin nicht rufen',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.purchase_receipt_fingerprint(bigint)')
             and a.privilege_type = 'EXECUTE'
             and (a.grantee = 0
                  or a.grantee::regrole::text in ('anon', 'authenticated'))))::text, '0'),
  (407, 'Rechte', 'die Belegtabellen bleiben fuer anon und authenticated gesperrt',
        ((select count(*) from (values ('anon'), ('authenticated')) t(rolle)
            cross join (values ('purchase_receipts'), ('purchase_receipt_counters'),
                               ('purchase_receipt_downloads')) u(tab)
           where has_table_privilege(t.rolle, 'public.' || u.tab, 'SELECT')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'INSERT')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'UPDATE')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'DELETE')))::text, '0'),

  -- =====================================================================
  -- 9xx  Bestand — gegen den Preflight vergleichen
  -- =====================================================================
  (901, 'Umgebung', 'Info: Serverversion',
        (current_setting('server_version'))::text, null),
  (902, 'Bestand', 'Einkaeufe (Preflight 902)',
        ((select count(*) from public.purchases))::text, null),
  (903, 'Bestand', 'Einkaufspositionen (Preflight 903)',
        ((select count(*) from public.purchase_items))::text, null),
  (904, 'Bestand', 'Lagerzeilen / Menge (Preflight 904)',
        ((select count(*)::text || ' / ' || coalesce(sum(quantity), 0)::text
            from public.shop_inventory))::text, null),
  (905, 'Bestand', 'Lagerbewegungen (Preflight 905)',
        ((select count(*) from public.inventory_movements))::text, null),
  (911, 'Beleg', 'Eigenbelege — MUSS Preflight 911 gleichen',
        ((select count(*) from public.purchase_receipts))::text, null),
  (912, 'Beleg', 'bestaetigte Abrufe — MUSS Preflight 912 gleichen',
        ((select count(*) from public.purchase_receipt_downloads))::text, null),
  (913, 'Beleg', 'Nummernzaehler — MUSS Preflight 913 gleichen',
        (coalesce((select string_agg(year::text || ':' || next_number::text, ' | '
                                     order by year)
                     from public.purchase_receipt_counters), '(keiner)'))::text, null),
  (914, 'Beleg', 'Nummer/Revision/Verweis je Beleg — MUSS Preflight 914 gleichen',
        (coalesce((select string_agg(
                     r.receipt_number || '/r' || r.revision::text || '/'
                     || coalesce(r.supersedes_id::text, '-'),
                     ' | ' order by r.id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (915, 'Beleg', 'Pruefsumme der Fingerabdruecke — MUSS Preflight 915 gleichen',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.content_fingerprint,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (916, 'Beleg', 'Belege, deren Fingerabdruck passt (Preflight 916)',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 = public.purchase_receipt_fingerprint(r.purchase_id)))::text, null),
  (917, 'Beleg', 'Pruefsumme der Positionslisten — MUSS Preflight 917 gleichen',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.lines::text,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),

  -- =====================================================================
  -- 99x  Invarianten
  -- =====================================================================
  (991, 'Invariante', 'kein Beleg mit revision > 1 ohne Vorgaenger',
        ((select count(*) from public.purchase_receipts
           where revision > 1 and supersedes_id is null))::text, '0'),
  (992, 'Invariante', 'kein Beleg wird zweimal ersetzt',
        ((select count(*) from (select supersedes_id from public.purchase_receipts
                                 where supersedes_id is not null
                                 group by supersedes_id having count(*) > 1) d))::text, '0'),
  (993, 'Invariante', 'kein Einkauf mit zwei Ursprungsbelegen',
        ((select count(*) from (select purchase_id from public.purchase_receipts
                                 where supersedes_id is null
                                 group by purchase_id having count(*) > 1) d))::text, '0'),
  (994, 'Invariante', 'jede Kette bleibt beim selben Einkauf',
        ((select count(*) from public.purchase_receipts r
           join public.purchase_receipts v on v.id = r.supersedes_id
          where r.purchase_id <> v.purchase_id))::text, '0'),
  (995, 'Invariante', 'gebuchte Positionen OHNE Lagerbewegung',
        ((select count(*) from public.purchase_items
           where state = 'booked' and movement_id is null))::text, '0'),
  (996, 'Invariante', 'negative Lagermengen',
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
