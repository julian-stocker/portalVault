-- ===========================================================================
-- ROLLBACK-PRUEFUNG nach dem abgebrochenen ersten 0124-Versuch
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Betreiber-Simulation, kein set_config, keine Rollenumschaltung.
--
-- ---------------------------------------------------------------------------
-- WARUM ES DIESE DATEI GIBT
--
-- `0124` brach beim ersten Staging-Versuch in der Nachbedingung ab:
--
--   P0001: 0124 Abbruch: der Ledger ruft den Fingerabdruck direkt
--
-- Das war ein Fehlalarm — die Pruefung suchte `purchase_receipt_fingerprint`
-- im Rohtext der Funktionsdefinition und fand den Kommentar, der erklaert,
-- warum der Ledger ihn NICHT direkt ruft.
--
-- PostgreSQL macht DDL transaktional, und ein `raise exception` rollt die
-- ganze implizite Transaktion zurueck. Erwartet ist also ein vollstaendiger
-- Rollback. ERWARTET IST NICHT GEPRUEFT: diese Datei prueft es.
--
-- Waere der Rollback unvollstaendig, waeren die bereits erhobenen
-- Vorher-Baselines (Betreiber 1, 2, 3, je 24 Filterkombinationen) gegen eine
-- Datenbank gemessen, die es nicht mehr gibt — und damit unbrauchbar.
-- Besteht diese Pruefung, bleiben sie gueltig.
--
-- ---------------------------------------------------------------------------
-- WAS 0124 UEBERHAUPT ANFASSEN KANN
--
-- Die Migration enthaelt kein INSERT, UPDATE, DELETE, kein `alter table`,
-- kein `drop`. Nur `create or replace function` (zwei Funktionen),
-- `comment on function` (zwei) und `revoke`/`grant`. Belege, Lagerbestaende
-- und Einkaeufe konnten durch den Lauf nicht veraendert werden, auch nicht
-- bei einem unvollstaendigen Rollback. Die 9xx-Zeilen sind die Bestaetigung
-- dazu, nicht die Sorge.
--
-- DREI DINGE KOENNTEN STEHENGEBLIEBEN SEIN, und jedes hat hier eine Zeile:
--   1. die neue Funktion `purchase_receipt_stale`            -> 101
--   2. der ersetzte Ledger-Rumpf                             -> 102-107
--   3. der neue FUNKTIONSKOMMENTAR am Ledger                 -> 111
--
-- Nummer 3 ist die, die man vergisst: `0124` setzt `comment on function` auf
-- BEIDE Funktionen. Bliebe der 0124-Kommentar am Ledger stehen, waehrend der
-- Rumpf zurueckgerollt ist, saehe keine andere Pruefung das.
--
-- ---------------------------------------------------------------------------
-- ABLESEN
--   ok = true    Bedingung erfuellt
--   ok = false   BLOCKIEREND
--   ok = null    Zahl oder Text zum Vergleich, kein Urteil
--
-- Zeile 9999 muss 0 zeigen. Dann ist der Zustand genau der vor dem Versuch,
-- und der zweite Versuch kann auf denselben Baselines aufbauen.
-- ===========================================================================

with
/*
 * DER LEDGER-RUMPF, EINMAL ROH UND EINMAL OHNE KOMMENTARE.
 *
 * Dieselbe Behandlung, die die korrigierte Nachbedingung von `0124` anwendet.
 * Sie steht hier, damit die Markerzaehlung in 107 nicht denselben Fehler
 * macht, der den Abbruch ausgeloest hat: ein Marker, der nur in einem
 * Kommentar steht, darf nicht als vorhanden zaehlen.
 */
def as (
  select coalesce(pg_get_functiondef(
           to_regprocedure('public.seller_orderbook_ledger('
             || 'integer, integer, text, boolean, text)')), '') as roh
),
code as (
  select regexp_replace(
           regexp_replace(d.roh, '/\*.*?\*/', '', 'g'),
           '--.*', '', 'gn') as txt
    from def d
),

pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Ist der Zustand von vor dem Versuch wiederhergestellt?
  -- =====================================================================
  (101, 'Rollback', 'purchase_receipt_stale existiert NICHT (0124 angelegt, muss weg sein)',
        (to_regprocedure('public.purchase_receipt_stale(bigint, text)') is null)::text, 'true'),
  (102, 'Rollback', 'der Ledger traegt kein status_known',
        (position('status_known' in (select c.txt from code c)) = 0)::text, 'true'),
  (103, 'Rollback', 'und kein receipt_stale',
        (position('receipt_stale' in (select c.txt from code c)) = 0)::text, 'true'),
  (104, 'Rollback', 'und ruft purchase_receipt_stale nicht',
        (position('purchase_receipt_stale' in (select c.txt from code c)) = 0)::text, 'true'),
  (105, 'Rollback', 'und keines der elf neuen Felder ist uebrig',
        ((select count(*) from (values
            ('status_known'), ('has_sender_name'), ('has_sender_street'),
            ('has_sender_postal_code'), ('has_sender_city'), ('has_origin'),
            ('has_agreement'), ('receipt_number'), ('receipt_issued_at'),
            ('receipt_revision'), ('receipt_stale')) t(k)
           where position('''' || t.k || '''' in (select c.txt from code c)) > 0))::text, '0'),
  (106, 'Rollback', 'er liegt wieder in der 0119-Fassung vor (Anzeigename aufgeloest)',
        (position('coalesce(s.display_name_override, s.name,' in
          (select c.txt from code c)) > 0)::text, 'true'),
  (107, 'Rollback', 'und traegt alle 17 Rumpfmarker — KOMMENTARFREI gezaehlt',
        ((select count(*) from (values
            ('p_undated'), ('unknown orderbook status filter'),
            ('v_num := replace('), ('as damaged_items'), ('as missing_items'),
            ('as showcase_items'), ('as open_items'), ('as settled_items'),
            ('as is_incomplete'), ('as is_open'),
            ('public.purchase_market_value(p.id) v'),
            ('s.display_name_override ilike'), ('i.raw_name ilike'),
            ('order by m.purchased_at desc nulls last'),
            ('m.daily_index desc nulls last'),
            ('count(*) filter (where not r.is_test)'),
            ('round(sum(m.total_cost) / sum(m.known_value), 4)')
          ) t(marker)
          where position(t.marker in (select c.txt from code c)) > 0))::text, '17'),

  -- =====================================================================
  -- 11x  Signatur, Eigenschaften, Rechte, Kommentar
  -- =====================================================================
  (110, 'Ledger', 'genau eine Overload',
        ((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'seller_orderbook_ledger'))::text, '1'),
  /*
   * DER FUNKTIONSKOMMENTAR — DIE STILLE SPUR.
   *
   * `0119` setzt ihn mit „The orderbook page and its summary over the same
   * CTE"; `0124` ersetzt ihn durch eine Fassung, die die Belegspalten nennt.
   * Steht hier der 0124-Text, ist der Rollback unvollstaendig, auch wenn der
   * Rumpf stimmt.
   */
  (111, 'Ledger', 'der Funktionskommentar ist noch der aus 0119',
        ((position('The orderbook page and its summary over the same CTE' in
           coalesce(obj_description(
             to_regprocedure('public.seller_orderbook_ledger('
               || 'integer, integer, text, boolean, text)'), 'pg_proc'), '')) > 0)
         and (position('status_known' in
           coalesce(obj_description(
             to_regprocedure('public.seller_orderbook_ledger('
               || 'integer, integer, text, boolean, text)'), 'pg_proc'), '')) = 0))::text,
        'true'),
  (112, 'Ledger', 'Info: der Funktionskommentar, erste 90 Zeichen',
        (left(coalesce(obj_description(
           to_regprocedure('public.seller_orderbook_ledger('
             || 'integer, integer, text, boolean, text)'), 'pg_proc'), '(keiner)'), 90))::text,
        null),
  (113, 'Ledger', 'genau FUENF Argumente, in dieser Reihenfolge (typbasiert)',
        (coalesce((select (p.pronargs = 5
                           and p.proargtypes[0]::regtype = 'integer'::regtype
                           and p.proargtypes[1]::regtype = 'integer'::regtype
                           and p.proargtypes[2]::regtype = 'text'::regtype
                           and p.proargtypes[3]::regtype = 'boolean'::regtype
                           and p.proargtypes[4]::regtype = 'text'::regtype)::text
                     from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text, 'true'),
  (114, 'Ledger', 'stable',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text, 's'),
  (115, 'Ledger', 'security definer',
        (coalesce((select p.prosecdef::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text, 'true'),
  (116, 'Ledger', 'hat eine search_path-Festlegung',
        (exists (select 1 from pg_proc p,
                      unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'seller_orderbook_ledger'
                    and c like 'search\_path=%'))::text, 'true'),
  (117, 'Ledger', 'und sie ist LEER (Anfuehrungszeichen weggerechnet)',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from pg_proc p,
                          unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'
                      and c like 'search\_path=%'), '(leer)'))::text, '(leer)'),
  (118, 'Ledger', 'alle fuenf Argumente haben Standardwerte',
        (coalesce((select p.pronargdefaults::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text, '5'),
  (119, 'Ledger', 'anon darf NICHT ausfuehren',
        (has_function_privilege('anon',
          'public.seller_orderbook_ledger(integer, integer, text, boolean, text)',
          'EXECUTE'))::text, 'false'),
  (120, 'Ledger', 'authenticated darf ausfuehren',
        (has_function_privilege('authenticated',
          'public.seller_orderbook_ledger(integer, integer, text, boolean, text)',
          'EXECUTE'))::text, 'true'),

  -- =====================================================================
  -- 2xx  0125 ist angewendet und unberuehrt
  -- =====================================================================
  (201, '0125', 'authenticated darf den Fingerabdruck nicht ausfuehren',
        (has_function_privilege('authenticated',
          'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE'))::text, 'false'),
  (202, '0125', 'anon ebenfalls nicht',
        (has_function_privilege('anon',
          'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE'))::text, 'false'),
  (203, '0125', 'service_role darf weiterhin',
        (has_function_privilege('service_role',
          'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE'))::text, 'true'),
  (204, '0125', 'die Fingerabdruck-Funktion ist unveraendert stable/secdef',
        (coalesce((select p.provolatile::text || '/' || p.prosecdef::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text,
        's/true'),

  -- =====================================================================
  -- 9xx  Bestand — gegen 0124_preflight.sql vergleichen
  -- =====================================================================
  (901, 'Umgebung', 'Info: Serverversion',
        (current_setting('server_version'))::text, null),
  (902, 'Bestand', 'Einkaeufe (Preflight 901)',
        ((select count(*) from public.purchases))::text, null),
  (903, 'Bestand', 'Einkaufspositionen (Preflight 902)',
        ((select count(*) from public.purchase_items))::text, null),
  (904, 'Bestand', 'Summe total_cost (Preflight 906)',
        (coalesce((select sum(total_cost) from public.purchases), 0))::text, null),
  (905, 'Bestand', 'Eigenbelege (Preflight 907)',
        ((select count(*) from public.purchase_receipts))::text, null),
  (906, 'Bestand', 'Abrufe von Eigenbelegen',
        ((select count(*) from public.purchase_receipt_downloads))::text, null),
  (907, 'Bestand', 'Lagerbewegungen (Preflight 912)',
        ((select count(*) from public.inventory_movements))::text, null),
  (908, 'Bestand', 'Lagerzeilen / Summe Menge (Preflight 913)',
        ((select count(*)::text || ' / ' || coalesce(sum(quantity), 0)::text
            from public.shop_inventory))::text, null),
  /*
   * UND DER FINGERABDRUCK DES BESTEHENDEN BELEGS.
   *
   * Der Preflight hat `105:da0d0be5ec8f533a` gemessen. Derselbe Wert hier
   * heisst: an den belegrelevanten Daten hat sich zwischen den Laeufen nichts
   * bewegt — und damit sind die Vorher-Baselines weiter vergleichbar.
   */
  (921, 'Beleg', 'erste 16 Zeichen je Beleg — muss dem Preflight 923 gleichen',
        (coalesce((select string_agg(
                     r.purchase_id::text || ':' ||
                     left(public.purchase_receipt_fingerprint(r.purchase_id), 16),
                     ' | ' order by r.purchase_id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (922, 'Beleg', 'Belege, deren Fingerabdruck stimmt',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 = public.purchase_receipt_fingerprint(r.purchase_id)))::text, null),

  -- =====================================================================
  -- 99x  Invarianten
  -- =====================================================================
  (991, 'Invariante', 'gebuchte Positionen OHNE Lagerbewegung',
        ((select count(*) from public.purchase_items
           where state = 'booked' and movement_id is null))::text, '0'),
  (992, 'Invariante', 'Positionen mit Sonderzustand UND Lagerbewegung',
        ((select count(*) from public.purchase_items
           where state in ('damaged', 'missing', 'showcase', 'settled')
             and movement_id is not null))::text, '0'),
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
