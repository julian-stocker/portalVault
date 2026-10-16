-- ===========================================================================
-- PREFLIGHT fuer Migration 0129  —  Eigenbelege in der Betriebssicherung
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Betreiber-Simulation, kein set_config, keine Rollenumschaltung. Sie ruft
-- `seller_business_backup()` NICHT auf: die Funktion liest zwar nur, liefert
-- aber Kaeuferanschriften und Belegdaten — ein Preflight braucht das nicht,
-- und was er nicht abruft, kann er nicht in ein Protokoll schreiben.
--
-- Zeile 9999 muss 0 zeigen.
--
-- ---------------------------------------------------------------------------
-- WAS 0129 VORAUSSETZT
--
-- Die Funktion aus `0104` und die drei Belegtabellen aus `0122` — samt den
-- zwei Verweisspalten aus `0128`. Ohne sie waere die Kette nur halb im Export,
-- und genau das soll nicht passieren.
--
-- EIN SICHERER ZUSTAND DARF NICHT BLOCKIEREN: laeuft dieser Preflight nach
-- `0129`, steht in 210 `NACH_0129` statt `VOR_0129`.
-- ===========================================================================

with
def as (
  select coalesce(pg_get_functiondef(to_regprocedure('public.seller_business_backup()')),
                  '') as d
),
/*
 * DERSELBE TEXT OHNE KOMMENTARE.
 *
 * `pg_get_functiondef` liefert den Rumpf zeichengetreu, und der Rumpf aus
 * `0104` ist voller Prosa. Wer darin SUCHT, sucht kommentarfrei — `0124` ist
 * zweimal an einer Pruefung gescheitert, die Prosa fuer Code hielt.
 */
code as (
  select regexp_replace(regexp_replace(d.d, '/\*.*?\*/', '', 'g'),
                        '--.*', '', 'gn') as d
    from def d
),

pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Die Funktion aus 0104
  -- =====================================================================
  (101, '0104', 'seller_business_backup() ist da',
        (to_regprocedure('public.seller_business_backup()') is not null)::text, 'true'),
  (102, '0104', 'sie ist stable und security definer',
        ((select count(*) from pg_proc p
           where p.oid = to_regprocedure('public.seller_business_backup()')
             and p.provolatile = 's' and p.prosecdef))::text, '1'),
  (103, '0104', 'mit leerem search_path',
        ((select count(*) from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
           where p.oid = to_regprocedure('public.seller_business_backup()')
             and c like 'search\_path=%'
             and nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '') is null))::text,
        '1'),
  (104, '0104', 'PUBLIC und anon duerfen sie nicht abrufen',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.seller_business_backup()')
             and a.privilege_type = 'EXECUTE'
             and (a.grantee = 0 or a.grantee::regrole::text = 'anon')))::text, '0'),
  (105, '0104', 'authenticated darf',
        (has_function_privilege('authenticated', 'public.seller_business_backup()',
                                'EXECUTE'))::text, 'true'),
  (106, '0104', 'Info: Anzahl Bereiche im heutigen Rumpf',
        ((select count(*) from code d,
               regexp_matches(d.d, '^\s{6}''([a-z_]+)'', coalesce\(\(', 'gn') as m(k)))::text,
        null),
  (107, '0104', 'der Betreiberwaechter steht als erste Bedingung',
        ((select position('can_operate_active_seller()' in d.d) > 0 from code d))::text,
        'true'),
  (108, '0104', 'und die Momentaufnahme wird belegt',
        ((select position('pg_current_snapshot()' in d.d) > 0 from code d))::text, 'true'),

  -- =====================================================================
  -- 12x  Die drei Tabellen und ihre Spalten
  -- =====================================================================
  (121, '0122', 'die drei Belegtabellen stehen',
        ((select count(*) from information_schema.tables
           where table_schema = 'public'
             and table_name in ('purchase_receipts', 'purchase_receipt_downloads',
                                'purchase_receipt_counters')))::text, '3'),
  /*
   * JEDE SPALTE, DIE DER EXPORT NENNEN WIRD, MUSS ES GEBEN.
   *
   * `0047` hat die Lehre teuer bezahlt: eine Anweisung mit der falschen
   * Tabelle ist wohlgeformter Text, und 63 Quelltextpruefungen sahen nichts.
   */
  (122, '0128', 'purchase_receipts hat alle 38 Spalten, die mitkommen',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchase_receipts'
             and column_name in ('id', 'purchase_id', 'receipt_number', 'issued_at',
               'revision', 'supersedes_id', 'supersedes_number', 'supersedes_issued_at',
               'format_version', 'content_fingerprint', 'buyer_legal_name',
               'buyer_trade_name', 'buyer_street', 'buyer_postal_code', 'buyer_city',
               'buyer_country', 'buyer_email', 'buyer_vat_id', 'seller_platform',
               'seller_handle', 'sender_name', 'sender_street', 'sender_postal_code',
               'sender_city', 'sender_country', 'listing_ref', 'listing_title',
               'listing_url', 'listing_details', 'purchased_at', 'items_cost',
               'shipping_cost', 'buyer_protection_cost', 'total_cost', 'currency',
               'payment_method', 'agreement_note', 'lines')))::text, '38'),
  (123, '0122', 'purchase_receipt_downloads hat die vier Spalten',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchase_receipt_downloads'
             and column_name in ('id', 'receipt_id', 'delivered_at', 'byte_count')))::text,
        '4'),
  (124, '0122', 'purchase_receipt_counters hat die zwei Spalten',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchase_receipt_counters'
             and column_name in ('year', 'next_number')))::text, '2'),
  /*
   * UND DIE ZWEI KONTOIDENTITAETEN GIBT ES — sie bleiben ABSICHTLICH draussen.
   * Steht hier 0, hat jemand das Schema geaendert, und die Begruendung im
   * Manifest zeigt auf etwas, das es nicht mehr gibt.
   */
  (125, 'Manifest', 'issued_by und delivered_by existieren (und bleiben draussen)',
        ((select count(*) from information_schema.columns
           where table_schema = 'public'
             and (table_name = 'purchase_receipts' and column_name = 'issued_by'
                  or table_name = 'purchase_receipt_downloads'
                     and column_name = 'delivered_by')))::text, '2'),
  (126, '0128', 'die Verweisspalten sind da — sonst waere die Kette halb im Export',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchase_receipts'
             and column_name in ('supersedes_number', 'supersedes_issued_at')))::text, '2'),

  -- =====================================================================
  -- 2xx  Zustandsbefund
  -- =====================================================================
  (201, '0129', 'Info: purchase_receipts ist schon ein Bereich',
        ((select position('from public.purchase_receipts t' in d.d) > 0 from code d))::text,
        null),
  (210, '0129', 'Gesamtbefund',
        ((select case
                   when position('from public.purchase_receipts t' in d.d) > 0
                        and position('from public.purchase_receipt_downloads t' in d.d) > 0
                        and position('from public.purchase_receipt_counters t' in d.d) > 0
                     then 'NACH_0129'
                   when position('purchase_receipt' in d.d) = 0
                     then 'VOR_0129'
                   else 'UNKLAR'
                 end from code d))::text, null),
  (211, '0129', 'der Befund ist VOR_0129 oder NACH_0129, nicht UNKLAR',
        ((select case
                   when position('from public.purchase_receipts t' in d.d) > 0
                        and position('from public.purchase_receipt_downloads t' in d.d) > 0
                        and position('from public.purchase_receipt_counters t' in d.d) > 0
                     then 'true'
                   when position('purchase_receipt' in d.d) = 0
                     then 'true'
                   else 'false'
                 end from code d))::text, 'true'),

  -- =====================================================================
  -- 9xx  Eingangsseitige Baseline
  -- =====================================================================
  (901, 'Umgebung', 'Info: Serverversion',
        (current_setting('server_version'))::text, null),
  (902, 'Bestand', 'Einkaeufe / Positionen',
        ((select count(*)::text from public.purchases) || ' / '
         || (select count(*)::text from public.purchase_items))::text, null),
  (911, 'Beleg', 'Eigenbelege / Abrufe / Zaehlerzeilen',
        ((select count(*)::text from public.purchase_receipts) || ' / '
         || (select count(*)::text from public.purchase_receipt_downloads) || ' / '
         || (select count(*)::text from public.purchase_receipt_counters))::text, null),
  (912, 'Beleg', 'Pruefsumme ueber die gespeicherten Fingerabdruecke',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.content_fingerprint,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (913, 'Beleg', 'Pruefsumme ueber die eingefrorenen Positionslisten',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.lines::text,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),

  -- =====================================================================
  -- 99x  Invarianten
  -- =====================================================================
  (991, 'Invariante', 'kein Beleg mit revision > 1 ohne Vorgaenger',
        ((select count(*) from public.purchase_receipts
           where revision > 1 and supersedes_id is null))::text, '0'),
  (992, 'Invariante', 'jede Kette bleibt beim selben Einkauf',
        ((select count(*) from public.purchase_receipts r
           join public.purchase_receipts v on v.id = r.supersedes_id
          where r.purchase_id <> v.purchase_id))::text, '0'),
  (993, 'Invariante', 'jeder Abruf gehoert zu einem vorhandenen Beleg',
        ((select count(*) from public.purchase_receipt_downloads d
           where not exists (select 1 from public.purchase_receipts r
                              where r.id = d.receipt_id)))::text, '0'),
  (994, 'Invariante', 'der Zaehler liegt nicht hinter der hoechsten vergebenen Nummer',
        ((select count(*) from public.purchase_receipt_counters c
           where c.next_number
                 < coalesce((select max(substring(r.receipt_number from 11)::integer)
                               from public.purchase_receipts r
                              where r.receipt_number
                                    like 'SI-E-' || c.year::text || '-%'), 0)))::text, '0')
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
