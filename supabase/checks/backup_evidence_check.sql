-- ===========================================================================
-- Sind die beiden Production-Sicherungen WIRKLICH entstanden? — rein lesend
--
-- Fuer das Admin-Backup gibt es dafuer eine eigene Historie: `0105`/`0106`
-- fuehren `platform_export_runs` append-only mit Triggerschutz. Dort steht
-- der Nachweis, nicht in einer Erinnerung.
--
--   `generated` = der Server hat das vollstaendige Archiv ausgeliefert.
--   `received`  = der Browser-Fetch war abgeschlossen, der vollstaendige Blob
--                 lag clientseitig vor, und genau EIN `generated`-Lauf war
--                 eindeutig zuordenbar. **Nur `received` zaehlt.**
--
-- Dass die Datei dauerhaft auf einer Platte liegt, behauptet `received`
-- ausdruecklich NICHT — das kann ein Browser nicht beweisen. Diese Pruefung
-- auch nicht; sie zeigt, was die Datenbank bezeugen kann.
--
-- Fuer das Business-Backup gibt es keine Historie (`0104` fuehrt keine). Die
-- drei Bestandszahlen unten sind die Gegenzahlen, gegen die die
-- heruntergeladene Datei zu halten ist.
--
-- KEINE PERSONENBEZOGENEN DATEN. Ausgegeben werden Zustaende, Zahlen,
-- Zeitpunkte und Pruefsummen — kein Name, keine Anschrift, keine Adresse.
--
-- NUR LESEN. Ein einziges SELECT.
-- ===========================================================================

with letzter as (
  select r.* from public.platform_export_runs r
   where r.status = 'received'
   order by r.received_at desc nulls last, r.id desc
   limit 1
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  -- --- Admin-Backup: die Historie ----------------------------------------
  (101, 'Admin', 'Laeufe insgesamt in der Historie',
        (select count(*)::text from public.platform_export_runs), null),
  (102, 'Admin', 'davon mit Zustand received (nur die zaehlen)',
        (select count(*)::text from public.platform_export_runs
          where status = 'received'), null),
  (103, 'Admin', 'davon mit Zustand failed',
        (select count(*)::text from public.platform_export_runs
          where status = 'failed'), '0'),
  (104, 'Admin', 'gibt es ueberhaupt einen received-Lauf?',
        (select (count(*) > 0)::text from public.platform_export_runs
          where status = 'received'), 'true'),

  -- --- Admin-Backup: der juengste bestaetigte Lauf -----------------------
  (111, 'Admin', 'juengster received-Lauf: Zeitpunkt',
        coalesce((select l.received_at::text from letzter l), '(keiner)'), null),
  (112, 'Admin', 'Bereiche im Archiv',
        coalesce((select l.section_count::text from letzter l), '(keiner)'), '53'),
  (113, 'Admin', 'Formatversion',
        coalesce((select l.format_version::text from letzter l), '(keiner)'), null),
  (114, 'Admin', 'Groesse in Bytes',
        coalesce((select l.size_bytes::text from letzter l), '(keiner)'), null),
  (115, 'Admin', 'SHA-256 des Archivs (gegen die lokale Datei halten)',
        coalesce((select l.sha256 from letzter l), '(keiner)'), null),
  (116, 'Admin', 'Storage-Dateien im Archiv',
        coalesce((select l.storage_file_count::text from letzter l), '(keiner)'), null),
  (117, 'Admin', 'fehlende Storage-Dateien (muss 0 sein)',
        coalesce((select l.storage_missing_count::text from letzter l), '(keiner)'), '0'),
  (118, 'Admin', 'Abbruchstufe des juengsten Laufs (muss leer sein)',
        coalesce((select coalesce(l.failure_stage, '(keine)') from letzter l),
                 '(keiner)'), '(keine)'),
  (119, 'Admin', 'Quellprojekt des Archivs',
        coalesce((select l.source_project from letzter l), '(keiner)'), null),

  -- --- Business-Backup: die Gegenzahlen ----------------------------------
  /* 25 ist der Stand VOR dem Rollout (`0104`). Nach `0131` sind es 28 —
     dann ist diese Zeile mit 28 zu lesen, nicht als Befund. */
  (201, 'Business', 'Exportbereiche, die die Funktion heute fuehrt',
        (select count(*)::text from regexp_matches(
           coalesce(pg_get_functiondef(
             to_regprocedure('public.seller_business_backup()')), ''),
           '\n      ''[a-z_0-9]+'', coalesce\(\(', 'g')), '25'),
  (202, 'Business', 'Einkaeufe (muss zur Datei passen)',
        (select count(*)::text from public.purchases), null),
  (203, 'Business', 'Einkaufspositionen',
        (select count(*)::text from public.purchase_items), null),
  (204, 'Business', 'Lagerzeilen / Lagersumme',
        (select count(*)::text || ' / '
                || coalesce(sum(i.quantity), 0)::text
           from public.shop_inventory i), null),
  (205, 'Business', 'Eigenbelege (erwartet 0 vor Freigabe B)',
        (select count(*)::text from public.purchase_receipts), '0'),
  (206, 'Business', 'Abrufnachweise',
        (select count(*)::text from public.purchase_receipt_downloads), '0'),

  -- --- Was keine der beiden Sicherungen enthaelt -------------------------
  (301, 'Luecke', 'Info: Tabellen in public (Schema ist in KEINER Sicherung)',
        (select count(*)::text from pg_class
          where relnamespace = 'public'::regnamespace and relkind = 'r'), null),
  (302, 'Luecke', 'Info: Funktionen in public',
        (select count(*)::text from pg_proc p
          where p.pronamespace = 'public'::regnamespace), null),
  (303, 'Luecke', 'Info: Sequenzen in public (Staende sind in KEINER Sicherung)',
        (select count(*)::text from pg_class
          where relnamespace = 'public'::regnamespace and relkind = 'S'), null)
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
