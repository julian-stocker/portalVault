-- ===========================================================================
-- STAGING: WELCHE MIGRATIONEN STEHEN, UND WELCHE AUSDRUECKLICH NICHT
--
-- NUR FUER STAGING (`qqxcpesbwfxzgytkdsac`). Diese Datei behauptet einen
-- Zustand, der auf Production ANDERS und dort richtig ist — `0133` steht auf
-- Production seit dem 2026-10-18. Auf Production gefahren meldet sie deshalb
-- zu Recht Abweichungen; das ist kein Befund, sondern der falsche Ort.
-- Zeile 101 ist der Riegel dagegen.
--
-- WOZU SIE DA IST. Vor und nach jedem Lauf von `0135`/`0136` muss belegt
-- sein, dass `0133` und `0134` weiterhin NICHT angewendet sind — nicht aus
-- einer Akte, sondern aus dem lebenden Katalog. `state_audit_readonly.sql`
-- stellt denselben Zustand fest, aber ohne Sollwert und ohne `9999`: sie
-- misst, sie bewertet nicht. Diese Datei bewertet.
--
-- DER UMGEBUNGSSTEMPEL (Zeile 101). `SKY-0821` und `SKY-0822` sind
-- Charakterimport-Fixturen, die **bewusst nie nach Production uebernommen**
-- wurden (`PROJECT_STATUS.md`: „Production haelt bewusst kein SKY-0821",
-- „`SKY-0822` wurde nicht uebernommen"). Ihre Anwesenheit ist damit ein
-- Hinweis auf Staging — kein Beweis. Die Projektkennung aus der Adresszeile
-- des SQL-Editors gehoert weiterhin ins Protokoll; der Stempel faengt nur den
-- Fall ab, dass eine Staging-Datei im falschen Fenster landet.
--
-- NUR LESEN. Ein einziges SELECT ueber `pg_proc`, `pg_trigger`,
-- `information_schema` und `public.skylanders`. Kein DO-Block, kein DDL, kein
-- DML, keine Rechteaenderung, kein Funktionsaufruf der Geschaeftslogik. Es
-- werden keine personenbezogenen Daten gelesen und keine ausgegeben.
--
-- Zeile 9999 muss 0 zeigen.
-- ===========================================================================

with fp (funktion, signatur) as (values
  ('seller_remove_purchase_item', 'public.seller_remove_purchase_item(bigint)'),
  ('seller_update_purchase',
   'public.seller_update_purchase(bigint, date, numeric, text, text, text,'
   || ' numeric, numeric, numeric, text, text, boolean, text, text, text,'
   || ' text, text, text, text, text, text)'),
  ('seller_purchase', 'public.seller_purchase(bigint)'),
  ('seller_business_backup', 'public.seller_business_backup()'),
  ('purchases_paid_total_is_final', 'public.purchases_paid_total_is_final()')
),
lebend as (
  select fp.funktion,
         (select md5(p.prosrc) from pg_proc p
           where p.oid = to_regprocedure(fp.signatur)) as abdruck,
         (select p.prosrc from pg_proc p
           where p.oid = to_regprocedure(fp.signatur)) as rumpf
    from fp
),
/*
 * Die bekannten Fassungen — nachgerechnet aus den Migrationsdateien dieses
 * Repositorys, nicht geraten. Das Verfahren ist an der unabhaengig geprueften
 * Marke aus `0131_function_body_check.sql` verifiziert
 * (`24c3810288bb20929fe995554a267adf` = Stand `0131`).
 */
bekannt (abdruck, fassung) as (values
  ('e5d81ce3a368bfeb21f54caf73739cb0', '0064'),
  ('616cedcc5198b7da3d4b6594f7df8ebd', '0132'),
  ('145b0ea68e2ebaf424553abab8c24cf6', '0121'),
  ('ab566b2304daf201b1be67844e82df20', '0132'),
  ('ce5a8aa4c3fbf26461fd91724e2f2c0c', '0119'),
  ('a4d1420cd705f0e7bf015b8722afb72a', '0134'),
  ('24c3810288bb20929fe995554a267adf', '0131'),
  ('f6d08440707ba72a8040a8d1e666c092', '0136'),
  -- Nachgerechnet wie die uebrigen: der Text zwischen `as $$` und `$$;` aus
  -- `0140_business_backup_sale_release.sql`. Das Verfahren ist an `0136`
  -- verifiziert, dessen Marke oben unabhaengig belegt ist.
  ('a32b148cebe00ee0d0d469f96fd2028e', '0140'),
  ('2ec43969fb6ea7adb0b1a4616e6889f4', '0133')
),
stand as (
  select l.funktion,
         case when l.abdruck is null then 'FEHLT'
              else coalesce((select b.fassung from bekannt b
                              where b.abdruck = l.abdruck), 'UNBEKANNT') end as fassung,
         l.rumpf
    from lebend l
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ------------------------------------------------------------- Umgebung
  (101, 'Umgebung', 'Stempel: SKY-0821 UND SKY-0822 vorhanden (auf Production bewusst nicht)',
      (select (count(*) = 2)::text from public.skylanders
        where sky_id in ('SKY-0821', 'SKY-0822')), 'true'),
  (102, 'Umgebung', 'Info: hoechste SKY-ID unter SKY-9000',
      (select max(sky_id) from public.skylanders where sky_id < 'SKY-9000'), null),
  (103, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ---------------------------------------------------- 0132 IST angewendet
  (201, '0132 steht', 'seller_remove_purchase_item ist die Fassung aus 0132',
      (select fassung from stand where funktion = 'seller_remove_purchase_item'), '0132'),
  (202, '0132 steht', 'seller_update_purchase ist die Fassung aus 0132',
      (select fassung from stand where funktion = 'seller_update_purchase'), '0132'),
  (203, '0132 steht', 'und der Riegel auf die bezahlte Summe ist im Rumpf',
      (select (position('total_cost' in rumpf) > 0)::text from stand
        where funktion = 'seller_update_purchase'), 'true'),

  -- --------------------------------------------- 0133 ist NICHT angewendet
  (211, '0133 fehlt', 'die Funktion purchases_paid_total_is_final gibt es NICHT',
      (select fassung from stand where funktion = 'purchases_paid_total_is_final'), 'FEHLT'),
  (212, '0133 fehlt', 'der Trigger purchases_paid_total_immutable_trg gibt es NICHT',
      (select count(*)::text from pg_trigger t
        where not t.tgisinternal
          and t.tgrelid = 'public.purchases'::regclass
          and t.tgname = 'purchases_paid_total_immutable_trg'), '0'),
  (213, '0133 fehlt', 'Info: alle nicht-internen Trigger auf purchases',
      coalesce((select string_agg(t.tgname::text, ', ' order by t.tgname::text)
                  from pg_trigger t
                 where not t.tgisinternal
                   and t.tgrelid = 'public.purchases'::regclass), '(keine)'), null),

  -- --------------------------------------------- 0134 ist NICHT angewendet
  (221, '0134 fehlt', 'seller_purchase ist die Fassung aus 0119',
      (select fassung from stand where funktion = 'seller_purchase'), '0119'),
  (222, '0134 fehlt', 'und ihr Rumpf gibt source_row NICHT aus',
      (select (position('''source_row'', i.source_row' in rumpf) > 0)::text
         from stand where funktion = 'seller_purchase'), 'false'),

  -- ------------------------------- 0135 und 0136: Messung, kein Sollwert
  -- Diese Datei laeuft VOR und NACH dem Lauf. Was sich dabei aendern DARF,
  -- steht hier ohne Erwartung — was sich nicht aendern darf, mit.
  (231, 'Z1', 'Info: Spalte skylanders.item_type (0135)',
      (select case when count(*) = 1 then 'steht' else 'fehlt' end
         from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'item_type'), null),
  (232, 'Z1', 'Info: Stand der Betriebssicherung (0131 vor 0136, 0136 danach)',
      (select fassung from stand where funktion = 'seller_business_backup'), null),
  (233, 'Z1', 'der Stand der Betriebssicherung ist bekannt, nicht UNBEKANNT',
      (select case when fassung in ('0131', '0136', '0140') then 'ja'
                   else 'nein: ' || fassung end
         from stand where funktion = 'seller_business_backup'), 'ja'),

  -- --------------------------- 0139 und 0140: welcher Stand steht gerade?
  --
  -- WOFUER DIESE VIER ZEILEN DA SIND. Dieses Projekt fuehrt keine
  -- `supabase_migrations.schema_migrations` — Migrationen werden von Hand
  -- angewendet, und das Register ist `supabase/migrations/APPLIED.md`
  -- (`disaster_recovery_pg_dump.md`, Abschnitt 4). Damit niemand raten
  -- muss, ob `0139`/`0140` schon gelaufen sind, beantwortet die DATENBANK
  -- die Frage selbst. Ohne Sollwert: dieselbe Datei laeuft vor und nach
  -- dem Lauf, und was sich aendern DARF, steht hier ohne Erwartung.
  --
  -- Der eigentliche Schutz vor einem zweiten Lauf ist das aber nicht — der
  -- steht in den Migrationen: `0139` bricht mit „steht schon" ab, `0140`
  -- mit „% Feldzeilen statt 353". Probelauf P39 faehrt beides nach.
  (241, '0139', 'Info: Spalte shop_inventory.sale_released',
      (select case when count(*) = 1 then 'steht' else 'fehlt' end
         from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'sale_released'), null),
  (242, '0139', 'Info: Spalte shop_inventory.delivery_scope',
      (select case when count(*) = 1 then 'steht' else 'fehlt' end
         from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'delivery_scope'), null),
  (243, '0139', 'Info: Spalte skylanders.usk_rating',
      (select case when count(*) = 1 then 'steht' else 'fehlt' end
         from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'usk_rating'), null),
  (244, '0139', 'die drei Spalten stehen ENTWEDER alle ODER keine',
      (select case when count(*) in (0, 3) then 'ja' else 'nein: ' || count(*)::text end
         from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'shop_inventory'
                and column_name in ('sale_released', 'delivery_scope'))
            or (table_name = 'skylanders' and column_name = 'usk_rating'))), 'ja'),
  (245, '0140', 'Info: die Sicherung kennt die drei Felder (0140 steht)',
      (select case when position('sale_released' in prosrc) > 0
                     and position('delivery_scope' in prosrc) > 0
                     and position('usk_rating' in prosrc) > 0
                   then 'ja' else 'nein' end
         from pg_proc where oid = to_regprocedure('public.seller_business_backup()')), null),
  (246, '0140', 'und sie passt zu den Spalten: ohne 0139 kein 0140',
      (select case
                when position('sale_released' in p.prosrc) = 0 then 'ja'
                when exists (select 1 from information_schema.columns
                              where table_schema = 'public'
                                and table_name = 'shop_inventory'
                                and column_name = 'sale_released') then 'ja'
                else 'nein: 0140 steht, 0139 fehlt' end
         from pg_proc p
        where p.oid = to_regprocedure('public.seller_business_backup()')), 'ja')
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
