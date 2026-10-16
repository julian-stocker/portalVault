-- ===========================================================================
-- EXPORT-BASELINE fuer 0129  —  womit die heruntergeladene Datei verglichen wird
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Rollenumschaltung. Sie ruft `seller_business_backup()` NICHT auf: die
-- Funktion liefert Kaeuferanschriften, und eine Pruefdatei soll keine
-- personenbezogenen Daten in ein Protokoll schreiben. Verglichen wird die
-- ZEILENZAHL je Bereich und die Belegkette — nicht der Inhalt.
--
-- ---------------------------------------------------------------------------
-- WOZU
--
-- Der Postflight von `0129` prueft die DEFINITION der Exportfunktion. Ob die
-- heruntergeladene Datei wirklich enthaelt, was in der Datenbank steht, zeigt
-- erst ein Vergleich — und dafuer braucht es eine Gegenzahl. Diese Datei ist
-- die Gegenzahl.
--
-- ABLESEN
--   VIER BEREICHE HEISSEN IN DER DATEI ANDERS ALS IHRE TABELLE:
--     orderbook_name_mappings -> name_mappings
--     seller_monthly_reports  -> monthly_reports
--     skylanders              -> figures
--     sellers                 -> seller
--   Die betroffenen Zeilen nennen beides. Wer nach dem Tabellennamen in der
--   JSON-Datei sucht, findet ihn nicht — das ist kein fehlender Bereich.
--
--   Die 1xx-Zeilen nennen je Bereich die erwartete Zeilenzahl — GENAU die 28
--   Bereiche, die `src/lib/backup/manifest.ts` fuehrt und `0129` ausgibt,
--   nicht einen mehr. Der erste Entwurf hatte 29: eine Zeile fuer
--   `orderbook_global_factor`, und das ist eine FUNKTION. Ein Test haelt beide
--   Richtungen jetzt fest (`check-sql-references.test.ts`). Sie gehoeren
--   neben `.counts` aus der JSON-Datei. Die 2xx-Zeilen sind die Belegkette,
--   Feld fuer Feld. Die 3xx-Zeilen sind Pruefsummen, die in der Datei
--   nachrechenbar sind.
--
-- Zeile 9999 muss 0 zeigen: sie prueft nur die Invarianten, nicht die Zahlen —
-- eine Zeilenzahl ist kein Urteil.
--
-- Belegnummern in der Ausgabe sind STAGING-TESTREFERENZEN.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Zeilenzahl je Bereich — gegen `.counts` in der Datei
  -- =====================================================================
  (101, 'counts', 'shop_inventory',
        ((select count(*) from public.shop_inventory))::text, null),
  (102, 'counts', 'inventory_movements',
        ((select count(*) from public.inventory_movements))::text, null),
  (103, 'counts', 'purchases',
        ((select count(*) from public.purchases))::text, null),
  (104, 'counts', 'purchase_items',
        ((select count(*) from public.purchase_items))::text, null),
  (105, 'counts', 'purchase_receipts',
        ((select count(*) from public.purchase_receipts))::text, null),
  (106, 'counts', 'purchase_receipt_downloads',
        ((select count(*) from public.purchase_receipt_downloads))::text, null),
  (107, 'counts', 'purchase_receipt_counters',
        ((select count(*) from public.purchase_receipt_counters))::text, null),
  (108, 'counts', 'sales',
        ((select count(*) from public.sales))::text, null),
  (109, 'counts', 'sale_items',
        ((select count(*) from public.sale_items))::text, null),
  (110, 'counts', 'sale_fees',
        ((select count(*) from public.sale_fees))::text, null),
  (111, 'counts', 'sale_refunds',
        ((select count(*) from public.sale_refunds))::text, null),
  (112, 'counts', 'settlement_adjustments',
        ((select count(*) from public.settlement_adjustments))::text, null),
  (113, 'counts', 'orderbook_name_mappings  -> JSON: name_mappings',
        ((select count(*) from public.orderbook_name_mappings))::text, null),
  /*
   * HIER STAND `orderbook_global_factor` ALS BEREICH. Das war falsch: der Name
   * gehoert einer FUNKTION aus `0059` und niemals einer Tabelle. Im Export
   * kommt er genau einmal vor — als Metadatum `buy_in_factor`, Ergebnis eines
   * Funktionsaufrufs. Die Zeile liess sich auf Staging nicht ausfuehren
   * (`42P01: relation does not exist`) und hat 28 Bereiche zu 29 gemacht.
   *
   * DER BUY-IN-FAKTOR WIRD HIER NICHT ABGEFRAGT. Er ist ein
   * Geschaeftsgeheimnis (ADR-0103, `0103`), und eine Pruefdatei schreibt ihn
   * nicht in ein Protokoll. Vergleiche `.buy_in_factor` aus der Datei
   * stattdessen mit der Zahl, die `/business` anzeigt.
   */
  (115, 'counts', 'orders',
        ((select count(*) from public.orders))::text, null),
  (116, 'counts', 'order_lines',
        ((select count(*) from public.order_lines))::text, null),
  (117, 'counts', 'order_line_events',
        ((select count(*) from public.order_line_events))::text, null),
  (118, 'counts', 'order_reservations',
        ((select count(*) from public.order_reservations))::text, null),
  (119, 'counts', 'order_refunds',
        ((select count(*) from public.order_refunds))::text, null),
  (120, 'counts', 'order_refund_allocations',
        ((select count(*) from public.order_refund_allocations))::text, null),
  (121, 'counts', 'order_legal_snapshots',
        ((select count(*) from public.order_legal_snapshots))::text, null),
  (122, 'counts', 'invoices',
        ((select count(*) from public.invoices))::text, null),
  (123, 'counts', 'seller_monthly_reports  -> JSON: monthly_reports',
        ((select count(*) from public.seller_monthly_reports))::text, null),
  (124, 'counts', 'sellers  -> JSON: seller',
        ((select count(*) from public.sellers))::text, null),
  (125, 'counts', 'shop_settings',
        ((select count(*) from public.shop_settings))::text, null),
  (126, 'counts', 'skylanders (nur die gehandelten)  -> JSON: figures',
        ((select count(*) from public.skylanders s
           where s.sky_id in (select sky_id from public.shop_inventory
                              union select sky_id from public.purchase_items
                              union select sky_id from public.sale_items
                              union select sky_id from public.order_lines)))::text, null),
  (127, 'counts', 'series',
        ((select count(*) from public.series))::text, null),
  (128, 'counts', 'categories',
        ((select count(*) from public.categories))::text, null),
  (129, 'counts', 'shipping_methods',
        ((select count(*) from public.shipping_methods))::text, null),
  (130, 'counts', 'Info: Summe aller 28 Bereichszeilen',
        ((select count(*) from public.shop_inventory)
         + (select count(*) from public.inventory_movements)
         + (select count(*) from public.purchases)
         + (select count(*) from public.purchase_items)
         + (select count(*) from public.purchase_receipts)
         + (select count(*) from public.purchase_receipt_downloads)
         + (select count(*) from public.purchase_receipt_counters)
         + (select count(*) from public.sales)
         + (select count(*) from public.sale_items)
         + (select count(*) from public.sale_fees)
         + (select count(*) from public.sale_refunds)
         + (select count(*) from public.settlement_adjustments)
         + (select count(*) from public.orderbook_name_mappings)
         + (select count(*) from public.orders)
         + (select count(*) from public.order_lines)
         + (select count(*) from public.order_line_events)
         + (select count(*) from public.order_reservations)
         + (select count(*) from public.order_refunds)
         + (select count(*) from public.order_refund_allocations)
         + (select count(*) from public.order_legal_snapshots)
         + (select count(*) from public.invoices)
         + (select count(*) from public.seller_monthly_reports)
         + (select count(*) from public.sellers)
         + (select count(*) from public.shop_settings)
         + (select count(*) from public.skylanders s
             where s.sky_id in (select sky_id from public.shop_inventory
                                union select sky_id from public.purchase_items
                                union select sky_id from public.sale_items
                                union select sky_id from public.order_lines))
         + (select count(*) from public.series)
         + (select count(*) from public.categories)
         + (select count(*) from public.shipping_methods))::text, null),

  /*
   * DIE METADATEN, DIE SICH OHNE GEHEIMNIS VERGLEICHEN LASSEN.
   *
   * `.inventory_units` und `.commerce_mode` stehen in der Datei und sagen,
   * woher sie stammt. `seller_legal_name` steht auch darin, wird hier aber
   * nicht abgefragt: Regel 5 dieses Ordners.
   */
  (131, 'Metadaten', 'inventory_units — Summe shop_inventory.quantity',
        (coalesce((select sum(i.quantity) from public.shop_inventory i), 0))::text, null),
  (132, 'Metadaten', 'commerce_mode',
        (coalesce((select s.mode from public.commerce_settings s limit 1), '(keiner)'))::text,
        null),
  (133, 'Metadaten', 'Info: dieses Projekt ist Staging, nicht Production',
        (current_database())::text, null),

  -- =====================================================================
  -- 2xx  Die Belegkette, Feld fuer Feld
  -- =====================================================================
  (201, 'Beleg', 'je Beleg: id · Nummer · Revision · supersedes_id',
        (coalesce((select string_agg(
                     r.id::text || ' · ' || r.receipt_number || ' · r' || r.revision::text
                     || ' · ' || coalesce(r.supersedes_id::text, '-'),
                     '  |  ' order by r.id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (202, 'Beleg', 'je Beleg: supersedes_number · supersedes_issued_at',
        (coalesce((select string_agg(
                     r.receipt_number || ' -> '
                     || coalesce(r.supersedes_number, '(kein Verweis)') || ' · '
                     || coalesce(to_char(r.supersedes_issued_at,
                                         'YYYY-MM-DD"T"HH24:MI:SSOF'), '-'),
                     '  |  ' order by r.id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (203, 'Beleg', 'je Beleg: format_version · Positionszahl · Betrag',
        (coalesce((select string_agg(
                     r.receipt_number || ' · f' || r.format_version::text || ' · '
                     || jsonb_array_length(r.lines)::text || ' Pos · '
                     || r.total_cost::text,
                     '  |  ' order by r.id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (204, 'Beleg', 'je Beleg: die ersten 16 Zeichen des Fingerabdrucks',
        (coalesce((select string_agg(
                     r.receipt_number || ':' || left(r.content_fingerprint, 16),
                     '  |  ' order by r.id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (205, 'Beleg', 'je Beleg: md5 der eingefrorenen Positionsliste',
        (coalesce((select string_agg(
                     r.receipt_number || ':' || md5(r.lines::text),
                     '  |  ' order by r.id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (206, 'Beleg', 'je Beleg: die SKY-IDs der eingefrorenen Liste, in Reihenfolge',
        (coalesce((select string_agg(x.zeile, '  |  ' order by x.id)
                     from (select r.id,
                                  r.receipt_number || ': ' || coalesce((
                                    select string_agg(coalesce(l ->> 'sky_id', '(ohne)'), ',')
                                      from jsonb_array_elements(r.lines) l), '(leer)')
                                  as zeile
                             from public.purchase_receipts r) x), '(keine Belege)'))::text,
        null),
  (207, 'Beleg', 'je Beleg: bestaetigte Abrufe und erster Abruf',
        (coalesce((select string_agg(
                     r.receipt_number || ': ' || (select count(*)::text
                                                    from public.purchase_receipt_downloads d
                                                   where d.receipt_id = r.id)
                     || ' · ' || coalesce((select to_char(min(d.delivered_at),
                                                          'YYYY-MM-DD HH24:MI')
                                             from public.purchase_receipt_downloads d
                                            where d.receipt_id = r.id), '-'),
                     '  |  ' order by r.id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (208, 'Beleg', 'je Abruf: id · receipt_id · byte_count',
        (coalesce((select string_agg(
                     d.id::text || ' · ' || d.receipt_id::text || ' · '
                     || d.byte_count::text,
                     '  |  ' order by d.id)
                     from public.purchase_receipt_downloads d), '(keine Abrufe)'))::text,
        null),
  (209, 'Beleg', 'der Nummernzaehler: Jahr · naechste Nummer',
        (coalesce((select string_agg(c.year::text || ' · ' || c.next_number::text,
                                     '  |  ' order by c.year)
                     from public.purchase_receipt_counters c), '(keiner)'))::text, null),
  (210, 'Beleg', 'welche Fassung ist aktuell (niemand ersetzt sie)',
        (coalesce((select string_agg(r.receipt_number, ', ' order by r.id)
                     from public.purchase_receipts r
                    where not exists (select 1 from public.purchase_receipts s
                                       where s.supersedes_id = r.id)), '(keine)'))::text,
        null),

  -- =====================================================================
  -- 3xx  Pruefsummen, in der Datei nachrechenbar
  -- =====================================================================
  (301, 'Pruefsumme', 'md5 ueber id:content_fingerprint aller Belege',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.content_fingerprint,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (302, 'Pruefsumme', 'md5 ueber id:lines aller Belege',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.lines::text,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (303, 'Pruefsumme', 'md5 ueber die Kette (id:revision:supersedes_id)',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.revision::text || ':'
                                         || coalesce(r.supersedes_id::text, '-'),
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),

  -- =====================================================================
  -- 4xx  Die Luecke bei den Einkaufsfeldern — nachgezaehlt
  -- =====================================================================
  /*
   * DER EXPORT TRAEGT 10 DER 31 SPALTEN VON `purchases`.
   *
   * Drei weitere sind im Manifest begruendet ausgelassen (`created_by`,
   * `updated_by`, `import_fingerprint`). Die uebrigen 18 sind weder drin noch
   * begruendet draussen — das Manifest ist von `0104`, die Spalten kamen mit
   * `0113` bis `0121`. Diese Zeilen zaehlen, wie viele Einkaeufe davon
   * ueberhaupt betroffen sind.
   */
  (401, 'Luecke', 'Spalten von purchases insgesamt',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchases'))::text, '31'),
  (402, 'Luecke', 'Einkaeufe mit Kostenaufteilung (items_cost gesetzt)',
        ((select count(*) from public.purchases where items_cost is not null))::text, null),
  (403, 'Luecke', 'Einkaeufe mit Absenderangaben',
        ((select count(*) from public.purchases
           where coalesce(sender_name, sender_street, sender_postal_code,
                          sender_city, sender_country) is not null))::text, null),
  (404, 'Luecke', 'Einkaeufe mit Inseratsangaben',
        ((select count(*) from public.purchases
           where coalesce(listing_title, listing_url, listing_details) is not null))::text,
        null),
  (405, 'Luecke', 'Einkaeufe mit Plattform oder Verkaeufername',
        ((select count(*) from public.purchases
           where coalesce(platform, seller_name) is not null))::text, null),
  /*
   * UND WIE VIELE DAVON EIN BELEG AUFFAENGT.
   *
   * Fuer einen Einkauf MIT Beleg traegt der Snapshot Absender, Inserat,
   * Kostenteile und Zahlungsart selbst — die Luecke im Einkaufsbereich ist
   * dort also gedeckt. Fuer einen Einkauf OHNE Beleg nicht.
   */
  (406, 'Luecke', 'Einkaeufe mit Absender- oder Inseratsangaben OHNE Eigenbeleg',
        ((select count(*) from public.purchases p
           where coalesce(p.sender_name, p.sender_street, p.listing_title,
                          p.listing_url, p.agreement_note) is not null
             and not exists (select 1 from public.purchase_receipts r
                              where r.purchase_id = p.id)))::text, null),

  -- =====================================================================
  -- 99x  Invarianten — hier wird geurteilt
  -- =====================================================================
  (991, 'Invariante', 'kein Beleg mit revision > 1 ohne Vorgaenger',
        ((select count(*) from public.purchase_receipts
           where revision > 1 and supersedes_id is null))::text, '0'),
  (992, 'Invariante', 'jeder Verweis nennt Nummer und Datum seines Vorgaengers',
        ((select count(*) from public.purchase_receipts r
           join public.purchase_receipts v on v.id = r.supersedes_id
          where r.supersedes_number is distinct from v.receipt_number
             or r.supersedes_issued_at is distinct from v.issued_at))::text, '0'),
  (993, 'Invariante', 'kein Beleg wird zweimal ersetzt',
        ((select count(*) from (select supersedes_id from public.purchase_receipts
                                 where supersedes_id is not null
                                 group by supersedes_id having count(*) > 1) d))::text, '0'),
  (994, 'Invariante', 'je Einkauf genau eine aktuelle Fassung',
        ((select count(*) from (select r.purchase_id
                                  from public.purchase_receipts r
                                 where not exists (select 1
                                                     from public.purchase_receipts s
                                                    where s.supersedes_id = r.id)
                                 group by r.purchase_id having count(*) > 1) d))::text, '0'),
  (995, 'Invariante', 'jeder Abruf gehoert zu einem vorhandenen Beleg',
        ((select count(*) from public.purchase_receipt_downloads d
           where not exists (select 1 from public.purchase_receipts r
                              where r.id = d.receipt_id)))::text, '0'),
  (996, 'Invariante', 'der Zaehler liegt nicht hinter der hoechsten Nummer des Jahres',
        ((select count(*) from public.purchase_receipt_counters c
           where c.next_number
                 < coalesce((select max(substring(r.receipt_number from 11)::integer)
                               from public.purchase_receipts r
                              where r.receipt_number
                                    like 'SI-E-' || c.year::text || '-%'), 0)))::text, '0'),
  (997, 'Invariante', 'kein Beleg ohne Position',
        ((select count(*) from public.purchase_receipts
           where jsonb_array_length(lines) = 0))::text, '0')
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
