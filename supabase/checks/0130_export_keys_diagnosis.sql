-- ===========================================================================
-- DIAGNOSE zum Fehlschlag von 0130_preflight.sql
--
--   Pruefung 131: 5 statt 0   (Absenderfelder angeblich im Export)
--   Pruefung 132: 4 statt 0   (Inseratsfelder angeblich im Export)
--   Pruefung 201: NACH_0130   (obwohl 0130 nicht ausgefuehrt wurde)
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Rollenumschaltung.
--
-- SIE RUFT `seller_business_backup()` NICHT AUF. Das waere auch sinnlos: die
-- Funktion gibt fuer eine Sitzung ohne Betreiberrolle `null` zurueck, und mit
-- Betreiberrolle lieferte sie Kaeuferanschriften — in ein Pruefprotokoll
-- gehoert beides nicht. Gelesen wird ihre DEFINITION, und daraus werden die
-- JSON-SCHLUESSEL je Bereich gewonnen. Schluessel sind Feldnamen, keine Werte;
-- es wird kein einziger Feldwert ausgegeben.
--
-- ---------------------------------------------------------------------------
-- DIE VERMUTUNG, DIE DIESE DATEI PRUEFT
--
-- `0129` hat den Bereich `purchase_receipts` in den Export genommen. Ein
-- Eigenbeleg friert den Ankauf ein — und dazu gehoeren Absender, Inserat,
-- Kaufvereinbarung UND die Kostenaufteilung. Diese Felder stehen dort
-- BERECHTIGT, weil der Beleg das Dokument ueber den Ankauf ist.
--
-- Die Pruefungen 131, 132 und 201 suchen aber im GANZEN Funktionsrumpf statt
-- im Bereich `purchases`. Sie finden damit die Felder des Belegsnapshots und
-- melden sie als Treffer im Einkaufsbereich. Trifft das zu, dann sind alle
-- drei Befunde Fehlalarme — und die Funktion ist unveraendert.
--
-- Die 2xx-Zeilen beantworten das Bereich fuer Bereich, die 3xx-Zeilen stellen
-- den Fehlgriff nach, und die 4xx-Zeilen sagen, ob die Funktion dem Stand der
-- Migrationshistorie entspricht.
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
  -- 1xx  DER PARSER BEWEIST SICH SELBST — in dieser Engine
  -- =====================================================================
  /*
   * Die Beispielzeichenkette hat ZWEI Bereiche: `alpha` mit zwei Feldern,
   * `beta` mit einem. Ein gieriger Parser — und genau das war der Fehler —
   * liefert hier EINEN Bereich mit DREI Feldern. Schlaegt eine dieser vier
   * Pruefungen an, stimmt die Annahme ueber die Regex-Engine nicht, und jedes
   * Ergebnis weiter unten ist wertlos. Deshalb blockieren alle vier.
   */
  (101, 'Selbsttest', 'der Parser erkennt ZWEI Bereiche in der Probe',
        ((select count(*) from probe_anfang))::text, '2'),
  (102, 'Selbsttest', 'und sie heissen alpha und beta',
        (coalesce((select string_agg(a.name, ',' order by a.nr)
                     from probe_anfang a), '(keine)'))::text, 'alpha,beta'),
  (103, 'Selbsttest', 'alpha hat genau zwei Felder',
        ((select count(*) from probe_feld f where f.name = 'alpha'))::text, '2'),
  (104, 'Selbsttest', 'beta hat genau eines — und keines von alpha',
        ((select count(*) from probe_feld f where f.name = 'beta'))::text, '1'),
  (105, 'Selbsttest', 'kein Feld ohne Bereich',
        ((select count(*) from probe_feld f where f.name is null))::text, '0'),

  -- =====================================================================
  -- 11x  Die Struktur des echten Rumpfs — blockierend
  -- =====================================================================
  /*
   * PUNKT 8: EINE PARSERABWEICHUNG MUSS ZUM ABBRUCH FUEHREN.
   *
   * 28 Bereiche sind keine Information, sondern eine Bedingung. Und die Summe
   * der Felder je Bereich muss der Gesamtzahl der Feldzeilen entsprechen —
   * sonst waere ein Feld keinem oder zwei Bereichen zugeordnet, und genau das
   * war der Fehler, der als „321 Schluessel" durchkam.
   */
  (111, 'Struktur', 'genau 28 Bereiche erkannt',
        ((select count(*) from bereich))::text, '28'),
  (112, 'Struktur', 'kein Feld ohne Bereich',
        ((select count(*) from feld f where f.name is null))::text, '0'),
  /*
   * DIE QUERPROBE: zugeordnete Felder gegen Feldzeilen.
   *
   * Links die Felder, die der Parser einem Bereich zugeordnet hat, rechts die
   * Feldzeilen im Rumpf, voneinander unabhaengig gezaehlt. Weichen sie ab, hat
   * der Parser etwas verloren oder doppelt vergeben.
   */
  (113, 'Struktur', 'jede Feldzeile ist genau einem Bereich zugeordnet',
        ((select count(*) from feld f where f.name is not null))::text,
        ((select count(*) from zeile z
           where z.txt ~ '^ {10}''[a-z_0-9]+'','))::text),
  (114, 'Struktur', 'kein Bereich ohne Feld',
        ((select count(*) from bereich b
           where not exists (select 1 from feld f where f.name = b.name)))::text, '0'),
  (115, 'Struktur', 'jeder Bereichsname kommt genau einmal vor',
        ((select count(*) from (select b.name from bereich b
                                 group by b.name having count(*) > 1) d))::text, '0'),
  (116, 'Struktur', 'Info: Gesamtzahl der erkannten Schluessel',
        ((select count(*) from feld))::text, null),

  -- =====================================================================
  -- 12x  Die Definition, grob
  -- =====================================================================
  (121, 'Form', 'seller_business_backup() ist da',
        (to_regprocedure('public.seller_business_backup()') is not null)::text, 'true'),
  (122, 'Form', 'Info: Bereiche mit ihrer Schluesselzahl',
        (coalesce((select string_agg(x.name || ':' || x.n::text, ' | ' order by x.name)
                     from (select f.name, count(*) as n from feld f group by f.name) x),
                  '(keine)'))::text, null),

  -- =====================================================================
  -- 2xx  WO stehen die neun Felder wirklich?
  -- =====================================================================
  /*
   * DIE ENTSCHEIDENDEN ZEILEN. Erwartet wird, dass JEDES der neun Felder
   * ausschliesslich im Bereich `purchase_receipts` vorkommt — dem
   * eingefrorenen Belegsnapshot, in dem es hingehoert.
   */
  (201, 'Fundort', 'sender_name steht in welchen Bereichen?',
        (coalesce((select string_agg(f.name, ', ' order by f.name) from feld f
                    where f.schluessel = 'sender_name'), '(in keinem)'))::text,
        'purchase_receipts'),
  (202, 'Fundort', 'sender_street',
        (coalesce((select string_agg(f.name, ', ' order by f.name) from feld f
                    where f.schluessel = 'sender_street'), '(in keinem)'))::text,
        'purchase_receipts'),
  (203, 'Fundort', 'sender_postal_code',
        (coalesce((select string_agg(f.name, ', ' order by f.name) from feld f
                    where f.schluessel = 'sender_postal_code'), '(in keinem)'))::text,
        'purchase_receipts'),
  (204, 'Fundort', 'sender_city',
        (coalesce((select string_agg(f.name, ', ' order by f.name) from feld f
                    where f.schluessel = 'sender_city'), '(in keinem)'))::text,
        'purchase_receipts'),
  (205, 'Fundort', 'sender_country',
        (coalesce((select string_agg(f.name, ', ' order by f.name) from feld f
                    where f.schluessel = 'sender_country'), '(in keinem)'))::text,
        'purchase_receipts'),
  (206, 'Fundort', 'listing_title',
        (coalesce((select string_agg(f.name, ', ' order by f.name) from feld f
                    where f.schluessel = 'listing_title'), '(in keinem)'))::text,
        'purchase_receipts'),
  (207, 'Fundort', 'listing_url',
        (coalesce((select string_agg(f.name, ', ' order by f.name) from feld f
                    where f.schluessel = 'listing_url'), '(in keinem)'))::text,
        'purchase_receipts'),
  (208, 'Fundort', 'listing_details',
        (coalesce((select string_agg(f.name, ', ' order by f.name) from feld f
                    where f.schluessel = 'listing_details'), '(in keinem)'))::text,
        'purchase_receipts'),
  (209, 'Fundort', 'agreement_note',
        (coalesce((select string_agg(f.name, ', ' order by f.name) from feld f
                    where f.schluessel = 'agreement_note'), '(in keinem)'))::text,
        'purchase_receipts'),
  (210, 'Fundort', 'items_cost',
        (coalesce((select string_agg(f.name, ', ' order by f.name) from feld f
                    where f.schluessel = 'items_cost'), '(in keinem)'))::text,
        'purchase_receipts'),
  /*
   * UND DER EINKAUFSBEREICH SELBST: er traegt keines der neun.
   *
   * Das ist die Aussage, die Pruefung 131 und 132 treffen WOLLTEN.
   */
  (220, 'Einkauf', 'Schluessel im Bereich purchases',
        (coalesce((select string_agg(f.schluessel, ', ' order by f.schluessel)
                     from feld f where f.name = 'purchases'), '(keine)'))::text, null),
  (221, 'Einkauf', 'Anzahl Schluessel im Bereich purchases',
        ((select count(*) from feld f where f.name = 'purchases'))::text, null),
  (222, 'Einkauf', 'davon Absender-, Inserats- oder Vereinbarungsfelder',
        ((select count(*) from feld f
           where f.name = 'purchases'
             and f.schluessel in ('sender_name', 'sender_street', 'sender_postal_code',
                                  'sender_city', 'sender_country', 'listing_title',
                                  'listing_url', 'listing_details',
                                  'agreement_note')))::text, '0'),
  (223, 'Einkauf', 'davon Kostenteile (0130 ergaenzt sie)',
        ((select count(*) from feld f
           where f.name = 'purchases'
             and f.schluessel in ('items_cost', 'shipping_cost',
                                  'buyer_protection_cost')))::text, null),
  (224, 'Beleg', 'Anzahl Schluessel im Bereich purchase_receipts',
        ((select count(*) from feld f where f.name = 'purchase_receipts'))::text, '38'),

  -- =====================================================================
  -- 3xx  Der Fehlgriff, nachgestellt
  -- =====================================================================
  /*
   * DASSELBE SUCHEN WIE DIE KAPUTTEN PRUEFUNGEN — im GANZEN Rumpf statt im
   * Bereich. Kommt hier 5 und 4 heraus, ist der Fehlalarm erklaert.
   */
  (301, 'Fehlgriff', 'ganzer Rumpf: Absenderfelder (Pruefung 131 zaehlte so)',
        ((select count(*) from (values ('''sender_name'''), ('''sender_street'''),
            ('''sender_postal_code'''), ('''sender_city'''), ('''sender_country''')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '5'),
  (302, 'Fehlgriff', 'ganzer Rumpf: Inserats- und Vereinbarungsfelder (132)',
        ((select count(*) from (values ('''listing_title'''), ('''listing_url'''),
            ('''listing_details'''), ('''agreement_note''')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '4'),
  (303, 'Fehlgriff', 'ganzer Rumpf: items_cost mit Textcast (201 las so NACH_0130)',
        ((select position('''items_cost'', t.items_cost::text' in d.d) > 0
            from code d))::text, 'true'),
  /*
   * HIER STAND `b.block`.
   *
   * Das war der Rest der blockbasierten Erkennung: das CTE `bereich` lieferte
   * damals einen Textblock je Bereich, heute nur noch den Namen. Der Verweis
   * blieb stehen, und PostgreSQL brach beim Parsen ab — `column b.block does
   * not exist`. Gefragt ist jetzt die ZEILE: trifft das Muster, und gehoert
   * ihre Zeile zum Bereich `purchases`?
   */
  (304, 'Richtig', 'Bereich purchases: items_cost mit Textcast',
        ((select count(*) from zeile z
           where z.txt ~ '^ {10}''items_cost'', t\.items_cost::text'
             and (select a.name from anfang a
                   where a.nr < z.nr order by a.nr desc limit 1) = 'purchases'))::text,
        null),
  (305, 'Richtig', 'Gesamtbefund, bereichsgenau',
        ((select case
                   when (select count(*) from feld f
                          where f.name = 'purchases'
                            and f.schluessel in ('items_cost', 'shipping_cost',
                                                 'buyer_protection_cost',
                                                 'payment_method', 'platform',
                                                 'seller_name')) = 6
                     then 'NACH_0130'
                   when (select count(*) from feld f where f.name = 'purchases') = 10
                     then 'VOR_0130'
                   else 'UNKLAR' end))::text, null),

  -- =====================================================================
  -- 4xx  Stimmt die Funktion mit der Migrationshistorie ueberein?
  -- =====================================================================
  /*
   * WENN DIE FUNKTION UNVERAENDERT IST, steht sie auf dem Stand von `0129`:
   * 28 Bereiche, `purchases` mit zehn Schluesseln, `purchase_receipts` mit 38,
   * `seller` mit 13. Weicht eines davon ab, ist jemand am Rumpf gewesen.
   */
  (401, 'Historie', 'purchases hat zehn Schluessel (Stand 0104/0129)',
        ((select count(*) from feld f where f.name = 'purchases'))::text, '10'),
  (402, 'Historie', 'seller hat dreizehn (0131 macht 26 daraus)',
        ((select count(*) from feld f where f.name = 'seller'))::text, '13'),
  (403, 'Historie', 'sales hat 23 (0130 macht 24 daraus)',
        ((select count(*) from feld f where f.name = 'sales'))::text, '23'),
  (404, 'Historie', 'order_refunds hat acht (0130 macht zwoelf daraus)',
        ((select count(*) from feld f where f.name = 'order_refunds'))::text, '8'),
  (405, 'Historie', 'figures hat sechs (0130 macht neun daraus)',
        ((select count(*) from feld f where f.name = 'figures'))::text, '6'),
  (406, 'Historie', 'der Kommentar nennt 0129 als letzte Aenderung',
        (coalesce(obj_description(to_regprocedure('public.seller_business_backup()'),
                                  'pg_proc'), '(keiner)') like '%0129%')::text, 'true'),
  (407, 'Historie', 'und NICHT 0130 oder 0131',
        ((coalesce(obj_description(to_regprocedure('public.seller_business_backup()'),
                                   'pg_proc'), '') not like '%0130%')
         and (coalesce(obj_description(to_regprocedure(
                'public.seller_business_backup()'), 'pg_proc'), '')
              not like '%0131%'))::text, 'true'),
  (408, 'Historie', 'sie ist stable, security definer, mit leerem search_path',
        ((select count(*) from pg_proc p
           where p.oid = to_regprocedure('public.seller_business_backup()')
             and p.provolatile = 's' and p.prosecdef
             and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                          where c like 'search\_path=%'
                            and nullif(btrim(substring(c from 'search_path=(.*)$'),
                                             '"'), '') is null)))::text, '1'),

  -- =====================================================================
  -- 99x  Und nichts an den Belegen hat sich bewegt
  -- =====================================================================
  (991, 'Beleg', 'Belege / Abrufe / Zaehlerzeilen',
        ((select count(*)::text from public.purchase_receipts) || ' / '
         || (select count(*)::text from public.purchase_receipt_downloads) || ' / '
         || (select count(*)::text from public.purchase_receipt_counters))::text, null),
  (992, 'Beleg', 'Pruefsumme der gespeicherten Fingerabdruecke',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.content_fingerprint,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (993, 'Beleg', 'Pruefsumme der eingefrorenen Positionslisten',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.lines::text,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (994, 'Beleg', 'die Unveraenderlichkeits-Trigger stehen',
        ((select count(*) from pg_trigger
           where not tgisinternal
             and tgname in ('purchase_receipts_immutable_trg',
                            'purchase_receipt_downloads_immutable_trg')))::text, '2')
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
