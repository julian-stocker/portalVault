-- ===========================================================================
-- DIAGNOSE zum Abbruch von 0131
--
--   ERROR: P0001: 0131 Abbruch:  fehlt im Bereich seller
--   CONTEXT: PL/pgSQL function inline_code_block line 114 at RAISE
--
-- Auffaellig war der LEERE Feldname. Diese Datei beantwortet zwei Fragen:
--
--   1. Steht die Datenbank noch auf Stand `0130`, oder ist ein Teil von `0131`
--      durchgekommen? Entscheidend ist die Schluesselzahl im Bereich `seller`:
--      13 heisst `0130`, 26 heisst `0131`.
--   2. Welche der 13 erwarteten Feldnamen fuehrt der Bereich `seller` heute,
--      und welche nicht?
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Rollenumschaltung. Sie ruft `seller_business_backup()` NICHT auf — gelesen
-- wird ihre DEFINITION.
--
-- KEINE VERKAEUFERDATEN. Ausgegeben werden ausschliesslich SPALTENNAMEN und
-- Zahlen. Aus `public.sellers` wird nichts gelesen ausser einer Zeilenzahl;
-- kein Name, keine Anschrift, keine Registernummer erscheint.
--
-- Zeile 9999 muss 0 zeigen. Zeigt sie mehr, sagen die 2xx-Zeilen, was vom
-- abgebrochenen Versuch stehen geblieben ist.
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

/* Die 13 Feldnamen, die `0131` dem Bereich `seller` hinzufuegen soll. */
soll (feld) as (
  values ('is_active'), ('register_court'), ('register_number'), ('w_id'),
         ('phone'), ('direct_contact'), ('transactional_reply_to'),
         ('withdrawal_contact_email'), ('complaints_contact_email'),
         ('dispute_participation'), ('dispute_body'), ('dispatch_statement'),
         ('return_postage_borne_by')
),

pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 0xx  Der Parser beweist sich selbst — blockierend
  -- =====================================================================
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

  -- =====================================================================
  -- 1xx  Auf welchem Stand ist die Funktion?
  -- =====================================================================
  (101, 'Stand', 'Info: Schluesselzahl im Bereich seller (13 = 0130, 26 = 0131)',
        ((select count(*) from feld f where f.name = 'seller'))::text, null),
  (102, 'Stand', 'Info: Schluesselzahl insgesamt (339 = 0130, 352 = 0131)',
        ((select count(*) from feld f))::text, null),
  (103, 'Stand', 'Gesamtbefund',
        ((select case
                   when (select count(*) from feld f where f.name = 'seller') = 13
                        and (select count(*) from feld f) = 339
                     then 'STAND_0130'
                   when (select count(*) from feld f where f.name = 'seller') = 26
                        and (select count(*) from feld f) = 352
                     then 'STAND_0131'
                   else 'UNKLAR' end))::text, null),
  /*
   * DIE EIGENTLICHE RUECKROLLFRAGE.
   *
   * Die Datei besteht aus vier Anweisungen: zwei DO-Bloecke, ein
   * `create or replace function` und ein `comment on`. Der SQL-Editor schickt
   * sie als EINE Anfrage; ein Fehler im letzten DO-Block rollt deshalb auch
   * die neue Funktionsfassung zurueck. Erwartet wird also `STAND_0130` —
   * steht hier `STAND_0131`, war es keine Transaktion, und die Funktion ist
   * schon getauscht.
   */
  (104, 'Stand', 'die Rueckrollung ist vollstaendig: noch Stand 0130',
        ((select case
                   when (select count(*) from feld f where f.name = 'seller') = 13
                        and (select count(*) from feld f) = 339
                     then 'STAND_0130'
                   when (select count(*) from feld f where f.name = 'seller') = 26
                        and (select count(*) from feld f) = 352
                     then 'STAND_0131'
                   else 'UNKLAR' end))::text, 'STAND_0130'),
  (105, 'Stand', 'der Funktionskommentar nennt 0130',
        (coalesce(obj_description(to_regprocedure('public.seller_business_backup()'),
                                  'pg_proc'), '(keiner)') like '%0130%')::text, 'true'),
  (106, 'Stand', 'und NICHT 0131',
        (coalesce(obj_description(to_regprocedure('public.seller_business_backup()'),
                                  'pg_proc'), '') not like '%0131%')::text, 'true'),

  -- =====================================================================
  -- 2xx  Die 13 erwarteten Feldnamen gegen den Bereich seller
  -- =====================================================================
  (201, 'Vergleich', 'Info: die Schluessel, die der Bereich seller heute fuehrt',
        (coalesce((select string_agg(f.schluessel, ', ' order by f.schluessel)
                     from feld f where f.name = 'seller'), '(keine)'))::text, null),
  (202, 'Vergleich', 'Info: von den 13 erwarteten sind schon da',
        (coalesce((select string_agg(s.feld, ', ' order by s.feld) from soll s
                    where exists (select 1 from feld f
                                   where f.name = 'seller'
                                     and f.schluessel = s.feld)), '(keine)'))::text,
        null),
  (203, 'Vergleich', 'Info: von den 13 erwarteten fehlen noch',
        (coalesce((select string_agg(s.feld, ', ' order by s.feld) from soll s
                    where not exists (select 1 from feld f
                                       where f.name = 'seller'
                                         and f.schluessel = s.feld)), '(keines)'))::text,
        null),
  (204, 'Vergleich', 'Anzahl der 13, die noch fehlen (13 = unveraendert 0130)',
        ((select count(*) from soll s
           where not exists (select 1 from feld f
                              where f.name = 'seller'
                                and f.schluessel = s.feld)))::text, '13'),
  /*
   * UND DIE SPALTEN GIBT ES IM SCHEMA.
   *
   * Nur Namen, keine Werte: `information_schema.columns`. Dass die Spalten da
   * sind, hat der Preflight schon gesagt — hier steht es neben dem Befund,
   * damit klar ist, dass der Abbruch NICHTS mit dem Schema zu tun hatte.
   */
  (205, 'Schema', 'alle 13 Spalten existieren auf public.sellers',
        ((select count(*) from soll s
           where exists (select 1 from information_schema.columns c
                          where c.table_schema = 'public' and c.table_name = 'sellers'
                            and c.column_name = s.feld)))::text, '13'),
  (206, 'Schema', 'genau eine aktive Verkaeuferzeile (nur die Zahl)',
        ((select count(*) from public.sellers where is_active))::text, '1'),

  -- =====================================================================
  -- 3xx  Was 0130 gebracht hat, ist unveraendert da
  -- =====================================================================
  (301, '0130', 'der Bereich purchases fuehrt die sechs Kostenteil-Schluessel',
        ((select count(*) from feld f
           where f.name = 'purchases'
             and f.schluessel in ('items_cost', 'shipping_cost',
                                  'buyer_protection_cost', 'payment_method',
                                  'platform', 'seller_name')))::text, '6'),
  (302, '0130', 'und die uebrigen Ergaenzungen stehen',
        ((select count(*) from feld f
           where (f.name = 'sales' and f.schluessel = 'sale_day')
              or (f.name = 'order_reservations' and f.schluessel = 'sale_item_id')
              or (f.name = 'figures' and f.schluessel = 'category_id')
              or (f.name = 'shop_settings' and f.schluessel = 'id')))::text, '4'),
  (303, 'Schritt c', 'die neun privaten Felder stehen NUR in purchase_receipts',
        ((select count(*) from feld f
           where f.schluessel in ('sender_name', 'sender_street', 'sender_postal_code',
                                  'sender_city', 'sender_country', 'listing_title',
                                  'listing_url', 'listing_details', 'agreement_note')
             and f.name <> 'purchase_receipts'))::text, '0'),

  -- =====================================================================
  -- 99x  Und an den Belegen hat sich nichts bewegt
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
                            'purchase_receipt_downloads_immutable_trg')))::text, '2'),
  (995, 'Beleg', 'die zwei Teilindizes der Kette stehen',
        ((select count(*) from pg_indexes
           where schemaname = 'public'
             and indexname in ('purchase_receipts_origin_uniq',
                               'purchase_receipts_supersedes_uniq')))::text, '2')
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
