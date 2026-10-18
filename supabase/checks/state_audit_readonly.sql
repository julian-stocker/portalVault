-- ===========================================================================
-- WELCHE MIGRATIONEN SIND IN DIESER DATENBANK WIRKLICH ANGEWENDET?
--
-- Dieselbe Datei fuer BEIDE Projekte. Sie liest ausschliesslich den Katalog
-- (`pg_proc`, `pg_trigger`, `pg_class`) und beantwortet die Frage nicht aus
-- einer Akte, sondern aus dem lebenden Zustand: fuer jede Funktion, die
-- `0126`-`0134` anfassen, wird `md5(prosrc)` gegen die Abdruecke der
-- bekannten Fassungen verglichen.
--
-- DIE ABDRUECKE SIND NACHGERECHNET, NICHT GERATEN. Sie stammen aus den
-- Migrationsdateien dieses Repositorys; das Verfahren ist an der bereits
-- unabhaengig geprueften Marke aus `0131_function_body_check.sql`
-- (`24c3810288bb20929fe995554a267adf` = STAND_0131) verifiziert.
--
-- REIN LESEND. Ein einziges SELECT. Kein DDL, keine Datenanweisung, keine
-- Transaktion bleibt offen. Es gibt keinen Sollwert und kein `9999`: diese
-- Datei stellt fest, sie bewertet nicht.
--
-- SO WIRD SIE BENUTZT
--   1. Projektkennung aus der Adresszeile des SQL-Editors ins Protokoll.
--      Staging = qqxcpesbwfxzgytkdsac, Production = zmiwxswrpkmizvqsgype.
--   2. Diese Datei ausfuehren, Ergebnis vollstaendig uebernehmen.
--   3. Die Spalte `befund` je Zeile lesen: sie nennt die Migration, deren
--      Fassung dort lebt — oder `UNBEKANNT`, wenn der Rumpf keiner bekannten
--      Fassung entspricht. `FEHLT` heisst: die Funktion gibt es nicht.
-- ===========================================================================

with fp (funktion, signatur) as (values
  ('seller_remove_purchase_item', 'public.seller_remove_purchase_item(bigint)'),
  ('seller_update_purchase',
   'public.seller_update_purchase(bigint, date, numeric, text, text, text,'
   || ' numeric, numeric, numeric, text, text, boolean, text, text, text,'
   || ' text, text, text, text, text, text)'),
  ('seller_purchase', 'public.seller_purchase(bigint)'),
  ('seller_save_purchase_edit',
   'public.seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)'),
  ('seller_business_backup', 'public.seller_business_backup()'),
  ('purchase_items_touch_purchase', 'public.purchase_items_touch_purchase()'),
  ('seller_issue_purchase_receipt_correction',
   'public.seller_issue_purchase_receipt_correction(bigint)'),
  ('purchases_paid_total_is_final', 'public.purchases_paid_total_is_final()')
),
lebend as (
  select fp.funktion,
         fp.signatur,
         (select md5(p.prosrc) from pg_proc p
           where p.oid = to_regprocedure(fp.signatur)) as abdruck
    from fp
),
-- Die bekannten Fassungen. Jede Zeile: Abdruck -> welche Migration.
bekannt (abdruck, fassung) as (values
  ('6264cb2985c3f8d3b00a4e5f3145d814', '0053'),
  ('e5d81ce3a368bfeb21f54caf73739cb0', '0064'),
  ('616cedcc5198b7da3d4b6594f7df8ebd', '0132'),
  ('6ff4f4fe149c9fb8890a29d9eeac5d1d', '0053'),
  ('266ed588cf1f0e31dc1a699dfd0a1be9', '0116'),
  ('145b0ea68e2ebaf424553abab8c24cf6', '0121'),
  ('ab566b2304daf201b1be67844e82df20', '0132'),
  ('0800a24a680040fe3ee60c11b60dc697', '0053'),
  ('9c36638ed0c70271ddcaccfe803a15dc', '0116'),
  ('ce5a8aa4c3fbf26461fd91724e2f2c0c', '0119'),
  ('a4d1420cd705f0e7bf015b8722afb72a', '0134'),
  ('89f94aea582bc564d028ccb29c847fd3', '0126'),
  ('4a713a639ce2c4ca66bab0f8d356eef7', '0127'),
  ('a3c922657e1c6410858b7c4b2bb7aae5', '0104'),
  ('5a0de6bec562779d5f945c096e1f77d6', '0129'),
  ('a27b61db988df7627a4992b1770ac626', '0130'),
  ('24c3810288bb20929fe995554a267adf', '0131'),
  ('b52230267bc03a9dcf76cc8395660222', '0126'),
  ('2986635747adf5371977718a2bd8d806', '0128'),
  ('2ec43969fb6ea7adb0b1a4616e6889f4', '0133')
),
funktionsstand as (
  select l.funktion,
         case when l.abdruck is null then 'FEHLT'
              else coalesce((select b.fassung from bekannt b
                              where b.abdruck = l.abdruck), 'UNBEKANNT')
         end as befund,
         coalesce(l.abdruck, '(keine)') as abdruck
    from lebend l
),
zeilen (nr, bereich, gegenstand, befund) as (

  -- ------------------------------------------------------------- Umgebung
  select 1, 'Umgebung', 'Testfiguren SKY-9101/SKY-9998 (Staging 2, Production 0)',
         (select count(*)::text from public.skylanders
           where sky_id in ('SKY-9101', 'SKY-9998'))
  union all
  select 2, 'Umgebung', 'Einkaeufe insgesamt / davon importiert',
         (select count(*)::text from public.purchases) || ' / '
         || (select count(*)::text from public.purchases where source <> 'manual')
  union all
  select 3, 'Umgebung', 'Eigenbelege / Lagerzeilen / Lagerbewegungen',
         (select count(*)::text from public.purchase_receipts) || ' / '
         || (select count(*)::text from public.shop_inventory) || ' / '
         || (select count(*)::text from public.inventory_movements)

  -- ---------------------------------------------------- Funktionsfassungen
  union all
  select 10, 'Fassung', 'seller_save_purchase_edit  (0126 -> 0127)',
         (select befund || '   md5 ' || abdruck from funktionsstand
           where funktion = 'seller_save_purchase_edit')
  union all
  select 11, 'Fassung', 'purchase_items_touch_purchase  (0126)',
         (select befund from funktionsstand where funktion = 'purchase_items_touch_purchase')
  union all
  select 12, 'Fassung', 'seller_issue_purchase_receipt_correction  (0128)',
         (select befund from funktionsstand
           where funktion = 'seller_issue_purchase_receipt_correction')
  union all
  select 13, 'Fassung', 'seller_business_backup  (0104 -> 0129 -> 0130 -> 0131)',
         (select befund || '   md5 ' || abdruck from funktionsstand
           where funktion = 'seller_business_backup')
  union all
  select 14, 'Fassung', 'seller_remove_purchase_item  (0053 -> 0064 -> 0132)',
         (select befund || '   md5 ' || abdruck from funktionsstand
           where funktion = 'seller_remove_purchase_item')
  union all
  select 15, 'Fassung', 'seller_update_purchase  (0053 -> 0116 -> 0121 -> 0132)',
         (select befund || '   md5 ' || abdruck from funktionsstand
           where funktion = 'seller_update_purchase')
  union all
  select 16, 'Fassung', 'purchases_paid_total_is_final  (0133, sonst FEHLT)',
         (select befund from funktionsstand where funktion = 'purchases_paid_total_is_final')
  union all
  select 17, 'Fassung', 'seller_purchase  (0053 -> 0116 -> 0119 -> 0134)',
         (select befund || '   md5 ' || abdruck from funktionsstand
           where funktion = 'seller_purchase')

  -- --------------------------------------------------------------- Trigger
  union all
  select 20, 'Trigger', 'purchase_items_touch_purchase_trg  (0126)',
         coalesce((select t.tgenabled::text from pg_trigger t
                    where not t.tgisinternal
                      and t.tgname = 'purchase_items_touch_purchase_trg'), 'FEHLT')
  union all
  select 21, 'Trigger', 'purchases_paid_total_immutable_trg  (0133)',
         coalesce((select t.tgenabled::text from pg_trigger t
                    where not t.tgisinternal
                      and t.tgname = 'purchases_paid_total_immutable_trg'), 'FEHLT')
  union all
  select 22, 'Trigger', 'purchase_receipts_immutable_trg  (0122)',
         coalesce((select t.tgenabled::text from pg_trigger t
                    where not t.tgisinternal
                      and t.tgname = 'purchase_receipts_immutable_trg'), 'FEHLT')
  union all
  select 23, 'Trigger', 'inventory_movements_append_only  (0003)',
         coalesce((select t.tgenabled::text from pg_trigger t
                    where not t.tgisinternal
                      and t.tgname = 'inventory_movements_append_only'), 'FEHLT')

  -- ----------------------------------------------------------- Belegsperre
  union all
  select 30, 'Belege', 'Ausstellung: API-Rollen mit EXECUTE (muss 0 sein)',
         (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.seller_issue_purchase_receipt(bigint)')
             and a.privilege_type = 'EXECUTE'
             and a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
  union all
  select 31, 'Belege', 'Korrektur: API-Rollen mit EXECUTE (muss 0 sein)',
         (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure(
             'public.seller_issue_purchase_receipt_correction(bigint)')
             and a.privilege_type = 'EXECUTE'
             and a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
  union all
  select 32, 'Belege', 'Abruf bestehender Belege bleibt erlaubt (erwartet >= 1)',
         (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.seller_purchase_receipt_history(bigint)')
             and a.privilege_type = 'EXECUTE'
             and a.grantee::regrole::text = 'authenticated')

  -- ------------------------------------------------------------- Lagerbild
  union all
  select 40, 'Bestand', 'Positionen mit Eroeffnungsbestand / Summe',
         (select (count(*) filter (where d.diff <> 0))::text || ' / '
                 || coalesce(sum(d.diff), 0)::text
            from (select i.quantity - coalesce((select sum(m.delta)
                                                  from public.inventory_movements m
                                                 where m.inventory_id = i.id), 0) as diff
                    from public.shop_inventory i) d)
  union all
  select 41, 'Bestand', 'Positionen mit NEGATIVEM Eroeffnungsbestand (muss 0 sein)',
         (select count(*)::text from public.shop_inventory i
           where i.quantity < coalesce((select sum(m.delta)
                                          from public.inventory_movements m
                                         where m.inventory_id = i.id), 0))
  union all
  select 42, 'Bestand', 'Importzeilen: ohne jedes Herkunftsmerkmal (muss 0 sein)',
         (select count(*)::text from public.purchase_items i
            join public.purchases p on p.id = i.purchase_id
           where p.source <> 'manual'
             and i.state <> 'reconciled_legacy'
             and i.source_row is null
             and i.legacy_booked_flag is null
             and i.legacy_condition_flag is null)
  union all
  select 43, 'Bestand', 'Importzeilen je Zustand',
         (select string_agg(z.state || '=' || z.n::text, ', ' order by z.state)
            from (select i.state, count(*) as n
                    from public.purchase_items i
                    join public.purchases p on p.id = i.purchase_id
                   where p.source <> 'manual'
                   group by i.state) z)

  -- ------------------------------------------------- Katalog und Zubehoer
  union all
  select 50, 'Katalog', 'Katalogzeilen insgesamt / aktiv / redaktionell sichtbar',
         (select count(*)::text from public.skylanders) || ' / '
         || (select count(*)::text from public.skylanders where is_active) || ' / '
         || (select count(*)::text from public.skylanders where catalog_visible)
  union all
  select 51, 'Katalog', 'Zeilen in der Kategorie Spiele (Software, nicht sammelbar)',
         (select count(*)::text from public.skylanders s
            join public.categories c on c.id = s.category_id
           where c.name = 'Spiele')
  union all
  select 52, 'Katalog', 'davon aktiv UND sichtbar — also in der Einkaufsauswahl waehlbar',
         (select count(*)::text from public.skylanders s
            join public.categories c on c.id = s.category_id
           where c.name = 'Spiele' and s.is_active and s.catalog_visible)
  union all
  select 53, 'Katalog', 'Serien / Kategorien insgesamt',
         (select count(*)::text from public.series) || ' / '
         || (select count(*)::text from public.categories)
  union all
  select 54, 'Katalog', 'Kategorien, die als nicht sammelbar gelten',
         (select array_to_string(public.non_collectible_categories(), ', '))
  union all
  select 55, 'Zubehoer', 'Einkaufspositionen OHNE Katalogbezug (sky_id is null)',
         (select count(*)::text from public.purchase_items where sky_id is null)
  union all
  select 56, 'Zubehoer', 'davon je Zustand',
         coalesce((select string_agg(z.state || '=' || z.n::text, ', ' order by z.state)
            from (select state, count(*) as n from public.purchase_items
                   where sky_id is null group by state) z), '(keine)')
  union all
  select 57, 'Zubehoer', 'Lagerzeilen, die auf eine Spiele-Zeile zeigen',
         (select count(*)::text from public.shop_inventory i
            join public.skylanders s on s.sky_id = i.sky_id
            join public.categories c on c.id = s.category_id
           where c.name = 'Spiele')
  union all
  select 58, 'Zubehoer', 'Verkaufspositionen, die auf eine Spiele-Zeile zeigen',
         (select count(*)::text from public.sale_items si
            join public.skylanders s on s.sky_id = si.sky_id
            join public.categories c on c.id = s.category_id
           where c.name = 'Spiele')
)
select nr, bereich, gegenstand, befund from zeilen order by nr;
