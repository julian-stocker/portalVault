-- ===========================================================================
-- PREFLIGHT fuer Migration 0130  —  Kostenteile und Katalogordnung im Export
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Rollenumschaltung. Sie ruft `seller_business_backup()` NICHT auf: die
-- Funktion liefert Kaeuferanschriften, und eine Pruefdatei schreibt keine
-- personenbezogenen Daten in ein Protokoll. Geprueft wird ihre DEFINITION.
--
-- Zeile 9999 muss 0 zeigen. Die 9xx-Zeilen sind die Baseline fuer den
-- Postflight — `0130` aendert keine Zeile.
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
  -- 1xx  Woraus 0130 aufsetzt
  -- =====================================================================
  (101, '0104', 'seller_business_backup() ist da, stable, security definer',
        ((select count(*) from pg_proc p
           where p.oid = to_regprocedure('public.seller_business_backup()')
             and p.provolatile = 's' and p.prosecdef))::text, '1'),
  (102, '0129', 'die drei Belegbereiche sind im Rumpf',
        ((select count(*) from (values ('from public.purchase_receipts t'),
            ('from public.purchase_receipt_downloads t'),
            ('from public.purchase_receipt_counters t')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '3'),
  (103, '0129', 'der eingefrorene Snapshot kommt mit',
        ((select position('''lines'', t.lines' in d.d) > 0 from code d))::text, 'true'),
  (104, '0104', 'Info: Anzahl Bereiche im heutigen Rumpf',
        ((select count(*) from code d,
               regexp_matches(d.d, '^\s{6}''([a-z_]+)'', coalesce\(\(', 'gn') as m(k)))::text,
        null),
  (105, '0104', 'es sind 28',
        ((select count(*) from code d,
               regexp_matches(d.d, '^\s{6}''([a-z_]+)'', coalesce\(\(', 'gn') as m(k)))::text,
        '28'),

  -- =====================================================================
  -- 12x  Die 18 Spalten, die 0130 nennen wird, gibt es
  -- =====================================================================
  /*
   * EIN TIPPFEHLER IM SPALTENNAMEN FAELLT ERST BEIM ERSTEN DOWNLOAD AUF — und
   * zwar als 500 ohne Grund. `0047` hat die Lehre bezahlt, `0129` ein zweites
   * Mal mit einem Namen, der einer Funktion gehoerte.
   */
  (121, 'Spalten', 'purchases: die sechs Kostenteil- und Herkunftsspalten',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchases'
             and column_name in ('items_cost', 'shipping_cost', 'buyer_protection_cost',
                                 'payment_method', 'platform', 'seller_name')))::text, '6'),
  (122, 'Spalten', 'sales.sale_day',
        (exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sales'
                    and column_name = 'sale_day'))::text, 'true'),
  (123, 'Spalten', 'order_reservations.sale_item_id',
        (exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'order_reservations'
                    and column_name = 'sale_item_id'))::text, 'true'),
  (124, 'Spalten', 'order_refunds: die vier Zeitpunkt- und Ergebnisspalten',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'order_refunds'
             and column_name in ('requested_at', 'settled_at', 'provider_status',
                                 'failure_code')))::text, '4'),
  (125, 'Spalten', 'skylanders: category_id, is_active, source',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'skylanders'
             and column_name in ('category_id', 'is_active', 'source')))::text, '3'),
  (126, 'Spalten', 'series.position, categories.position, shop_settings.id',
        ((select count(*) from information_schema.columns
           where table_schema = 'public'
             and (table_name = 'series' and column_name = 'position'
                  or table_name = 'categories' and column_name = 'position'
                  or table_name = 'shop_settings' and column_name = 'id')))::text, '3'),

  -- =====================================================================
  -- 13x  Und die neun personenbezogenen Einkaufsfelder sind NOCH NICHT drin
  -- =====================================================================
  /*
   * Das ist die Zusicherung, die `0130` einhalten muss. Steht hier schon
   * etwas, hat jemand sie vorab aufgenommen — und das gehoert geklaert, nicht
   * fortgeschrieben.
   */
  /*
   * BEREICHSGENAU — der Einkauf, nicht der Belegsnapshot.
   *
   * Im Bereich `purchase_receipts` stehen genau diese Felder berechtigt: ein
   * Eigenbeleg friert den Ankauf ein. Gefragt ist der Bereich `purchases`.
   */
  (131, 'Schritt c', 'kein Absenderfeld im Bereich purchases',
        ((select count(*) from feld f
           where f.name = 'purchases'
             and f.schluessel in ('sender_name', 'sender_street', 'sender_postal_code',
                                  'sender_city', 'sender_country')))::text, '0'),
  (132, 'Schritt c', 'kein Inserats- oder Vereinbarungsfeld im Bereich purchases',
        ((select count(*) from feld f
           where f.name = 'purchases'
             and f.schluessel in ('listing_title', 'listing_url', 'listing_details',
                                  'agreement_note')))::text, '0'),
  (134, 'Schritt c', 'Info: wo sender_name wirklich steht',
        (coalesce((select string_agg(f.name, ', ' order by f.name) from feld f
                    where f.schluessel = 'sender_name'), '(in keinem)'))::text,
        'purchase_receipts'),
  (133, 'Schritt c', 'die Spalten existieren aber — der Ausschluss ist eine Entscheidung',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchases'
             and column_name in ('sender_name', 'sender_street', 'sender_postal_code',
                                 'sender_city', 'sender_country', 'listing_title',
                                 'listing_url', 'listing_details',
                                 'agreement_note')))::text, '9'),

  -- =====================================================================
  -- 2xx  Zustandsbefund
  -- =====================================================================
  /*
   * AUCH DER ZUSTANDSBEFUND BEREICHSGENAU. `items_cost` steht seit `0129` im
   * Belegsnapshot — im ganzen Rumpf gesucht, las der erste Entwurf daraus
   * „0130 ist schon angewendet".
   */
  (201, '0130', 'Gesamtbefund',
        ((select case
                   when (select count(*) from feld f
                          where f.name = 'purchases'
                            and f.schluessel in ('items_cost', 'shipping_cost',
                                                 'buyer_protection_cost',
                                                 'payment_method', 'platform',
                                                 'seller_name')) = 6
                     then 'NACH_0130'
                   when (select count(*) from feld f
                          where f.name = 'purchases'
                            and f.schluessel in ('items_cost', 'shipping_cost',
                                                 'buyer_protection_cost',
                                                 'payment_method', 'platform',
                                                 'seller_name')) = 0
                     then 'VOR_0130'
                   else 'UNKLAR' end))::text, null),
  (202, '0130', 'der Befund ist VOR_0130 oder NACH_0130, nicht UNKLAR',
        ((select case
                   when (select count(*) from feld f
                          where f.name = 'purchases'
                            and f.schluessel in ('items_cost', 'shipping_cost',
                                                 'buyer_protection_cost',
                                                 'payment_method', 'platform',
                                                 'seller_name')) in (0, 6)
                     then 'true' else 'false' end))::text, 'true'),
  (203, '0130', 'Info: Schluesselzahl im Bereich purchases (10 vor, 16 nach)',
        ((select count(*) from feld f where f.name = 'purchases'))::text, null),

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
