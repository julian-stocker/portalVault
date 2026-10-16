-- ===========================================================================
-- POSTFLIGHT fuer Migration 0131  —  nach der Erweiterung
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Rollenumschaltung. Geprueft wird die DEFINITION der Exportfunktion.
--
-- Zeile 9999 muss 0 zeigen. Die 9xx-Zeilen MUESSEN denen des Preflights
-- gleichen: `0131` aendert keine Zeile.
-- ===========================================================================

with
def as (
  select coalesce(pg_get_functiondef(to_regprocedure('public.seller_business_backup()')),
                  '') as d
),
/*
 * DERSELBE TEXT OHNE KOMMENTARE. `pg_get_functiondef` liefert den Rumpf
 * zeichengetreu, und der Rumpf ist voller Prosa. Wer darin SUCHT, sucht
 * kommentarfrei — `0124` ist zweimal an einer Pruefung gescheitert, die Prosa
 * fuer Code hielt.
 */
code as (
  select regexp_replace(regexp_replace(d.d, '/\*.*?\*/', '', 'g'),
                        '--.*', '', 'gn') as d
    from def d
),

/*
 * ===========================================================================
 * DER BEREICHSPARSER — ZEILENWEISE, NICHT MIT EINEM MEHRZEILIGEN REGEX.
 *
 * WAS VORHER HIER STAND UND WARUM ES FALSCH WAR.
 *
 * Der erste Entwurf schnitt die Bereiche mit EINEM Ausdruck aus:
 *
 *     regexp_matches(d, '\n {6}''([a-z_0-9]+)'', coalesce\(\((.*?)\n {6}\), …', 'g')
 *
 * In Python und JavaScript tut das, was es soll. In PostgreSQL nicht. Das
 * Handbuch (9.7.3.5, „Regular Expression Matching Rules") sagt es deutlich:
 *
 *     „Ein Zweig hat dieselbe Gierigkeit wie das ERSTE quantifizierte Atom in
 *      ihm, das eine Gierigkeits-Eigenschaft besitzt."
 *
 * Die Gierigkeit ist in einer POSIX-ARE also eine Eigenschaft des ganzen
 * Zweigs, nicht des einzelnen Quantors. Das erste Atom mit Vorliebe war
 * `[a-z_0-9]+` — GIERIG. Damit wurde der ganze Ausdruck gierig, `(.*?)`
 * verhielt sich wie `(.*)`, und der erste Bereich verschluckte den gesamten
 * Rumpf: ein Bereich `shop_inventory` mit 321 Schluesseln statt 28 Bereichen.
 *
 * WAS JETZT HIER STEHT.
 *
 * Kein Ausdruck laeuft mehr ueber mehr als eine Zeile. Der Rumpf wird in
 * Zeilen zerlegt, jede Zeile wird mit einem verankerten Muster EINZELN
 * geprueft, und ein Feld gehoert zu dem Bereich, dessen Anfangszeile zuletzt
 * vor ihm stand. Daran gibt es nichts zu interpretieren: keine Gierigkeit,
 * kein `.` ueber Zeilengrenzen, keine Engine-Abhaengigkeit.
 *
 * UND DER PARSER BEWEIST SICH SELBST — in der Engine, die ihn ausfuehrt.
 * Die Pruefungen 1xx laufen ihn ueber eine eingebaute Beispielzeichenkette mit
 * ZWEI Bereichen. Ein gieriger Parser liefert dort einen Bereich mit drei
 * Feldern, der richtige zwei Bereiche mit zwei und einem. Weicht die Engine
 * von der Annahme ab, schlaegt das hier an und nicht erst am Ergebnis.
 * ===========================================================================
 */
zeile as (
  select z.nr, z.txt
    from code c,
         regexp_split_to_table(c.d, E'\n') with ordinality as z(txt, nr)
),
anfang as (
  select z.nr,
         (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
    from zeile z
   where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
),
bereich as (
  select a.name from anfang a
),
feld as (
  select (select a.name from anfang a
           where a.nr < z.nr order by a.nr desc limit 1) as name,
         (regexp_match(z.txt, '^ {10}''([a-z_0-9]+)'','))[1] as schluessel
    from zeile z
   where z.txt ~ '^ {10}''[a-z_0-9]+'','
),

/* ---- Der Selbsttest: zwei Bereiche, bekannte Antwort -------------------- */
probe as (
  select E'      ''alpha'', coalesce((\n'
      || E'        select jsonb_agg(jsonb_build_object(\n'
      || E'          ''a1'', t.a1,\n'
      || E'          ''a2'', t.a2\n'
      || E'        ) order by t.id)\n'
      || E'          from public.alpha t\n'
      || E'      ), ''[]''::jsonb),\n'
      || E'  \n'
      || E'      ''beta'', coalesce((\n'
      || E'        select jsonb_agg(jsonb_build_object(\n'
      || E'          ''b1'', t.b1\n'
      || E'        ) order by t.id)\n'
      || E'          from public.beta t\n'
      || E'      ), ''[]''::jsonb)' as d
),
probe_zeile as (
  select z.nr, z.txt
    from probe p,
         regexp_split_to_table(p.d, E'\n') with ordinality as z(txt, nr)
),
probe_anfang as (
  select z.nr,
         (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
    from probe_zeile z
   where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
),
probe_feld as (
  select (select a.name from probe_anfang a
           where a.nr < z.nr order by a.nr desc limit 1) as name,
         (regexp_match(z.txt, '^ {10}''([a-z_0-9]+)'','))[1] as schluessel
    from probe_zeile z
   where z.txt ~ '^ {10}''[a-z_0-9]+'','
),

pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 0xx  DER PARSER BEWEIST SICH SELBST — in dieser Engine, blockierend
  -- =====================================================================
  /*
   * Die Probe im CTE oben hat ZWEI Bereiche: `alpha` mit zwei Feldern, `beta`
   * mit einem. Ein gieriger Parser liefert EINEN Bereich mit DREI Feldern —
   * genau das ist auf Staging passiert, weil PostgreSQL die Gierigkeit fuer den
   * ganzen Zweig bestimmt und nicht je Quantor. Schlaegt eine dieser Zeilen
   * an, ist jede Feldaussage weiter unten wertlos; deshalb blockieren sie.
   */
  (1, 'Selbsttest', 'der Parser erkennt ZWEI Bereiche in der Probe',
        ((select count(*) from probe_anfang))::text, '2'),
  (2, 'Selbsttest', 'alpha hat zwei Felder, beta eines',
        ((select count(*) from probe_feld f where f.name = 'alpha')::text || '/'
         || (select count(*) from probe_feld f where f.name = 'beta')::text)::text,
        '2/1'),
  (3, 'Selbsttest', 'kein Feld der Probe ohne Bereich',
        ((select count(*) from probe_feld f where f.name is null))::text, '0'),
  (4, 'Struktur', 'genau 28 Bereiche im echten Rumpf',
        ((select count(*) from bereich))::text, '28'),
  (5, 'Struktur', 'jede Feldzeile ist genau einem Bereich zugeordnet',
        ((select count(*) from feld f where f.name is not null))::text,
        ((select count(*) from zeile z
           where z.txt ~ '^ {10}''[a-z_0-9]+'','))::text),
  (6, 'Struktur', 'kein Bereich ohne Feld, kein Bereichsname doppelt',
        ((select count(*) from bereich b
           where not exists (select 1 from feld f where f.name = b.name))
         + (select count(*) from (select b.name from bereich b
                                   group by b.name having count(*) > 1) d))::text, '0'),
  (7, 'Struktur', 'Info: Gesamtzahl der erkannten Schluessel',
        ((select count(*) from feld))::text, null),

  -- =====================================================================
  -- 1xx  Die 13 neuen Feldzeilen
  -- =====================================================================
  /*
   * BEREICHSGENAU. `is_active` steht seit `0130` auch im Bereich `figures` —
   * im ganzen Rumpf gesucht, bestaende diese Pruefung auch ohne `0131`.
   */
  (101, 'Stammdaten', 'is_active im Bereich seller — welche Zeile der Betrieb ist',
        ((select count(*) from feld f
           where f.name = 'seller' and f.schluessel = 'is_active'))::text, '1'),
  (102, 'Stammdaten', 'Registergericht, Registernummer, Verpackungsregister',
        ((select count(*) from (values ('''register_court'', t.register_court'),
            ('''register_number'', t.register_number'), ('''w_id'', t.w_id')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '3'),
  (103, 'Stammdaten', 'Telefon und unmittelbare Kommunikation',
        ((select count(*) from (values ('''phone'', t.phone'),
            ('''direct_contact'', t.direct_contact')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '2'),
  (104, 'Stammdaten', 'die drei weiteren Kontaktadressen',
        ((select count(*) from (values
            ('''transactional_reply_to'', t.transactional_reply_to'),
            ('''withdrawal_contact_email'', t.withdrawal_contact_email'),
            ('''complaints_contact_email'', t.complaints_contact_email')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '3'),
  (105, 'Stammdaten', 'Streitbeilegung, Versandaussage, Rueckporto',
        ((select count(*) from (values
            ('''dispute_participation'', t.dispute_participation'),
            ('''dispute_body'', t.dispute_body'),
            ('''dispatch_statement'', t.dispatch_statement'),
            ('''return_postage_borne_by'', t.return_postage_borne_by')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '4'),

  -- =====================================================================
  -- 12x  Was NICHT drinsteht
  -- =====================================================================
  (121, 'Schritt c', 'kein Absenderfeld im Bereich purchases',
        ((select count(*) from feld f
           where f.name = 'purchases'
             and f.schluessel in ('sender_name', 'sender_street', 'sender_postal_code',
                                  'sender_city', 'sender_country')))::text, '0'),
  (122, 'Schritt c', 'die neun Felder stehen NUR im Bereich purchase_receipts',
        ((select count(*) from feld f
           where f.schluessel in ('sender_name', 'sender_street', 'sender_postal_code',
                                  'sender_city', 'sender_country', 'listing_title',
                                  'listing_url', 'listing_details', 'agreement_note')
             and f.name <> 'purchase_receipts'))::text, '0'),
  (123, 'Sperre', 'keine Kontoidentitaet, kein Geheimnis',
        ((select count(*) from (values ('''issued_by'''), ('''delivered_by'''),
            ('''created_by'''), ('''updated_by'''), ('''client_salt'''),
            ('''idempotency_key''')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  /*
   * UND IM BEREICH `seller` KEIN ZEITSTEMPEL.
   *
   * Gefragt ist NUR dieser Bereich: `created_at` ist in anderen voellig
   * richtig. Hier stand bis zuletzt ein mehrzeiliges `substring` — derselbe
   * Fehlgriff, der in der Diagnosedatei den ganzen Rumpf verschluckt hat.
   * Jetzt beantwortet es die zeilenweise Zuordnung aus dem `feld`-CTE.
   */
  (124, 'Sperre', 'im Bereich seller kein created_at und kein updated_at',
        ((select count(*) from feld f
           where f.name = 'seller'
             and f.schluessel in ('created_at', 'updated_at')))::text, '0'),

  -- =====================================================================
  -- 2xx  Die Form und was frueher kam
  -- =====================================================================
  (201, 'Form', 'genau 28 Bereiche',
        ((select count(*) from code d,
               regexp_matches(d.d, '^\s{6}''([a-z_]+)'', coalesce\(\(', 'gn') as m(k)))::text,
        '28'),
  (202, 'Form', 'was 0129 und 0130 gebracht haben, ist bereichsgenau noch da',
        ((select count(*) from feld f
           where (f.name = 'purchase_receipts' and f.schluessel = 'lines')
              or (f.name = 'purchases' and f.schluessel = 'items_cost')
              or (f.name = 'sales' and f.schluessel = 'sale_day')
              or (f.name = 'order_reservations' and f.schluessel = 'sale_item_id')
              or (f.name = 'figures' and f.schluessel = 'category_id')
              or (f.name = 'shop_settings' and f.schluessel = 'id')))::text, '6'),
  (203, 'Form', 'genau ein Anweisungstrenner im Rumpf',
        ((select (length(substring(d.d from position('AS $function$' in d.d)))
                  - length(replace(substring(d.d from position('AS $function$' in d.d)),
                                   ';', '')))
            from code d))::text, '1'),
  (204, 'Form', 'stable und security definer',
        ((select count(*) from pg_proc p
           where p.oid = to_regprocedure('public.seller_business_backup()')
             and p.provolatile = 's' and p.prosecdef))::text, '1'),
  (205, 'Form', 'kein Stringliteral traegt einen Kommentarstarter',
        ((select count(*) from def d,
               regexp_matches(d.d, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
           where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%'))::text,
        '0'),
  (206, 'Form', 'sie schreibt nichts',
        ((select count(*) from (values ('insert into'), ('update public.'),
            ('delete from'), ('truncate'), ('nextval'), ('setval')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  (207, 'Vertrag', 'Formatversion 1 und restore_supported false',
        ((select count(*) from (values ('''format_version'',  1'),
            ('''restore_supported'',      false')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '2'),
  (208, 'Rechte', 'PUBLIC und anon duerfen die Sicherung nicht abrufen',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.seller_business_backup()')
             and a.privilege_type = 'EXECUTE'
             and (a.grantee = 0 or a.grantee::regrole::text = 'anon')))::text, '0'),

  -- =====================================================================
  -- 3xx  Die Eigenbelege bleiben unangetastet
  -- =====================================================================
  /*
   * DIESE MIGRATION AENDERT KEINE TABELLE — sie ersetzt eine Funktion. Hier
   * wird das nachgeprueft und nicht behauptet: die Unveraenderlichkeit der
   * Belege ist die Zusicherung, auf der `0122` bis `0128` ruhen, und sie darf
   * von einer Exporterweiterung nicht beruehrt werden.
   */
  (301, 'Beleg', 'die Unveraenderlichkeits-Trigger stehen',
        ((select count(*) from pg_trigger
           where not tgisinternal
             and tgname in ('purchase_receipts_immutable_trg',
                            'purchase_receipt_downloads_immutable_trg')))::text, '2'),
  (302, 'Beleg', 'sie feuern BEFORE update und delete',
        ((select count(*) from pg_trigger
           where not tgisinternal
             and tgname = 'purchase_receipts_immutable_trg'
             and tgtype::int & 2 = 2
             and tgtype::int & 8 = 8
             and tgtype::int & 16 = 16))::text, '1'),
  (303, 'Beleg', 'die zwei Teilindizes der Kette stehen',
        ((select count(*) from pg_indexes
           where schemaname = 'public'
             and indexname in ('purchase_receipts_origin_uniq',
                               'purchase_receipts_supersedes_uniq')))::text, '2'),
  (304, 'Beleg', 'die acht Zusicherungen der Kette stehen',
        ((select count(*) from pg_constraint
           where conrelid = 'public.purchase_receipts'::regclass
             and conname in ('receipts_supersedes_fk', 'receipts_revision_matches_chain',
                             'receipts_no_self_reference', 'receipts_id_purchase_uniq',
                             'receipts_number_unique', 'receipts_number_shape',
                             'receipts_revision_sane', 'receipts_lines_present')))::text,
        '8'),
  (305, 'Beleg', 'und die zwei Verweis-Zusicherungen aus 0128',
        ((select count(*) from pg_constraint
           where conrelid = 'public.purchase_receipts'::regclass
             and conname in ('receipts_supersedes_ref_complete',
                             'receipts_supersedes_number_shape')
             and convalidated))::text, '2'),
  (306, 'Beleg', 'die Belegtabellen bleiben fuer anon und authenticated gesperrt',
        ((select count(*) from (values ('anon'), ('authenticated')) t(rolle)
            cross join (values ('purchase_receipts'), ('purchase_receipt_counters'),
                               ('purchase_receipt_downloads')) u(tab)
           where has_table_privilege(t.rolle, 'public.' || u.tab, 'SELECT')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'INSERT')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'UPDATE')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'DELETE')))::text, '0'),
  (307, 'Beleg', 'authenticated darf den internen Fingerabdruck nicht rufen (0125)',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.purchase_receipt_fingerprint(bigint)')
             and a.privilege_type = 'EXECUTE'
             and (a.grantee = 0
                  or a.grantee::regrole::text in ('anon', 'authenticated'))))::text, '0'),
  (308, 'Beleg', 'die Ausstellungsfunktionen sind unveraendert vorhanden',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_issue_purchase_receipt',
                               'seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt',
                               'seller_purchase_receipt_history',
                               'seller_purchase_receipt_document')))::text, '5'),
  (309, 'Beleg', 'und die Erstausstellung ist weiterhin idempotent',
        (position('return public.seller_purchase_receipt(p_purchase_id);'
          in coalesce((select p.prosrc from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'seller_issue_purchase_receipt'), '')) > 0)::text, 'true'),

  -- =====================================================================
  -- 9xx  Bestand und Belege — vorher/nachher vergleichen
  -- =====================================================================
  (901, 'Umgebung', 'Info: Serverversion',
        (current_setting('server_version'))::text, null),
  (902, 'Bestand', 'Einkaeufe / Positionen',
        ((select count(*)::text from public.purchases) || ' / '
         || (select count(*)::text from public.purchase_items))::text, null),
  (903, 'Bestand', 'Verkaeufe / Verkaufspositionen',
        ((select count(*)::text from public.sales) || ' / '
         || (select count(*)::text from public.sale_items))::text, null),
  (904, 'Bestand', 'Lagerzeilen / Summe Menge',
        ((select count(*)::text from public.shop_inventory) || ' / '
         || (select coalesce(sum(quantity), 0)::text from public.shop_inventory))::text,
        null),
  (905, 'Bestand', 'Bestellungen / Rechnungen',
        ((select count(*)::text from public.orders) || ' / '
         || (select count(*)::text from public.invoices))::text, null),
  (911, 'Beleg', 'Belege / Abrufe / Zaehlerzeilen',
        ((select count(*)::text from public.purchase_receipts) || ' / '
         || (select count(*)::text from public.purchase_receipt_downloads) || ' / '
         || (select count(*)::text from public.purchase_receipt_counters))::text, null),
  (912, 'Beleg', 'Pruefsumme der gespeicherten Fingerabdruecke',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.content_fingerprint,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (913, 'Beleg', 'Pruefsumme der eingefrorenen Positionslisten',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.lines::text,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (914, 'Beleg', 'Pruefsumme der Kette',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.revision::text || ':'
                                         || coalesce(r.supersedes_id::text, '-'),
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),

  -- =====================================================================
  -- 99x  Invarianten
  -- =====================================================================
  (991, 'Invariante', 'genau eine aktive Verkaeuferzeile',
        ((select count(*) from public.sellers where is_active))::text, '1'),
  (992, 'Invariante', 'kein Beleg mit revision > 1 ohne Vorgaenger',
        ((select count(*) from public.purchase_receipts
           where revision > 1 and supersedes_id is null))::text, '0'),
  (993, 'Invariante', 'jeder Abruf gehoert zu einem vorhandenen Beleg',
        ((select count(*) from public.purchase_receipt_downloads d
           where not exists (select 1 from public.purchase_receipts r
                              where r.id = d.receipt_id)))::text, '0'),
  (994, 'Invariante', 'negative Lagermengen',
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
