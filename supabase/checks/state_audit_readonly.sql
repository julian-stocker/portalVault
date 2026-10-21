-- ===========================================================================
-- WELCHE MIGRATIONEN SIND IN DIESER DATENBANK WIRKLICH ANGEWENDET?
--
-- Dieselbe Datei fuer BEIDE Projekte. Sie liest ausschliesslich den Katalog
-- (`pg_proc`, `pg_trigger`, `pg_class`) und beantwortet die Frage nicht aus
-- einer Akte, sondern aus dem lebenden Zustand: fuer jede Funktion, die
-- `0126`-`0141` anfassen, wird `md5(prosrc)` gegen die Abdruecke der
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
  ('purchases_paid_total_is_final', 'public.purchases_paid_total_is_final()'),
  -- ----------------------------------------------- 0135-0141 (Zubehoer)
  --
  -- Die SIGNATUREN aendern sich dabei nicht, die RUEMPFE schon. Deshalb
  -- stehen sie hier: `to_regprocedure` sagt nur, DASS es sie gibt, und der
  -- Abdruck sagt, WELCHE Fassung lebt. Genau das ist der Unterschied
  -- zwischen „Nummer in einer Akte" und „Zustand dieser Datenbank".
  ('non_collectible_categories', 'public.non_collectible_categories()'),
  ('catalog_item_type_for_category',
   'public.catalog_item_type_for_category(text)'),
  ('is_shop_eligible', 'public.is_shop_eligible(text)'),
  ('shop_offers', 'public.shop_offers()'),
  ('shop_quantity_available',
   'public.shop_quantity_available(text, text, integer)'),
  ('create_order',
   'public.create_order(text, text, jsonb, jsonb, text, text)'),
  ('reserve_for_order', 'public.reserve_for_order(bigint)'),
  ('admin_shop_listing_audit', 'public.admin_shop_listing_audit()')
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
  -- --------------------------------------------- 0135-0141 (Zubehoer)
  -- Nachgerechnet aus den Migrationsdateien, mit demselben Verfahren wie
  -- die uebrigen: der Text zwischen `as $$` und `$$;`.
  ('f3bbdf2fe67d7df22c8f1886fbf7fce7', '0006'),   -- non_collectible_categories
  ('a7bc3dcee5e49103b6ea8a0d9c915f14', '0137'),   -- dieselbe, fuenf Kategorien
  ('158d60d57aeda4cf799e86ccb25edadd', '0135'),   -- catalog_item_type_for_category
  ('3c2f7ef30ace699335d1d49782b3112e', '0137'),   -- dieselbe, mit Portale
  ('52964f1bef2a41221256e83e867e46da', '0008'),   -- is_shop_eligible
  ('e6a305dfa7ac840382a13bb4c47ef201', '0135'),   -- dieselbe, mit item_type
  ('a3fa6b7fb22757396970de0d35875747', '0029'),   -- shop_offers, vier Spalten
  ('bae40c227756c5a89f82f4678190131a', '0139'),   -- dieselbe, fuenf Spalten
  ('0ed58c0de13e340db0aaef72576147e7', '0028'),   -- shop_quantity_available
  ('fed0d4c91fc1b9c8467f7e3074b05560', '0139'),   -- dieselbe, neues Tor
  ('a2290da73fa5c521c65bb9cff7e813f6', '0040'),   -- create_order
  ('c233337c0ca0555756f21e1abe173593', '0139'),   -- dieselbe, neues Tor
  ('53670151bda6f8238410597fbb0381d7', '0010'),   -- reserve_for_order
  ('8b1034cc3712e82a79c1a1fd5aeeb868', '0139'),   -- dieselbe, neues Tor
  ('1011312ffdb5ec38014a777f3d6858a9', '0041'),   -- admin_shop_listing_audit
  ('f36137c40155375b92bae76b5dd63740', '0139'),   -- dieselbe, fuenf Gruende
  ('a32b148cebe00ee0d0d469f96fd2028e', '0140'),   -- seller_business_backup
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
  -- `0136` nimmt `item_type` in den Bereich figures auf. Ohne diese Zeile
  -- meldete Pruefung 13 nach der Migration `UNBEKANNT` — ein Fehlalarm an
  -- einer Datei, die feststellt und nicht bewertet, waere besonders teuer.
  ('f6d08440707ba72a8040a8d1e666c092', '0136'),
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
  -- BERICHTIGT AM 2026-10-18: hier stand „Staging 2, Production 0". Falsch —
  -- `verify:rls` legt `SKY-9998` als DAUERHAFTE Fixture an, deren
  -- Fremdschluessel ON DELETE RESTRICT tragen, und vor dem 2026-09-09 gab es
  -- nur ein Projekt. Diese Zeile nennt die Figuren, statt eine Umgebung zu
  -- behaupten.
  select 1, 'Umgebung', 'vorhandene Testfiguren (SKY-9000 und hoeher)',
         coalesce((select string_agg(s.sky_id, ', ' order by s.sky_id)
                     from public.skylanders s
                    where s.sky_id >= 'SKY-9000'), '(keine)')
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
  select 13, 'Fassung', 'seller_business_backup  (0104 -> 0129 -> 0130 -> 0131 -> 0136)',
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
  /*
   * BERICHTIGT AM 2026-10-18. Die bisherige Zaehlung war in zwei Faellen
   * blind, und beide sind die gefaehrlichen:
   *   * `proacl is null` heisst „Standardrechte" — fuer eine Funktion also
   *     EXECUTE fuer PUBLIC. `aclexplode(NULL)` liefert null Zeilen, die
   *     Zaehlung meldete also genau dann 0, wenn alles offen steht.
   *   * PUBLIC steht als `grantee = 0` ohne Rollennamen und fiel durch den
   *     Vergleich mit den drei Rollennamen hindurch (ADR-0125, 0124).
   * Jetzt zaehlt die Zeile die VERLETZUNGEN inklusive beider Faelle.
   */
  select 30, 'Belege', 'Ausstellung offen fuer PUBLIC/anon/authenticated/service_role oder NULL-ACL',
         (select count(*)::text from pg_proc p
           where p.oid = to_regprocedure('public.seller_issue_purchase_receipt(bigint)')
             and (p.proacl is null
                  or exists (select 1 from aclexplode(p.proacl) a
                              where a.privilege_type = 'EXECUTE'
                                and (a.grantee = 0
                                     or a.grantee::regrole::text
                                        in ('anon', 'authenticated', 'service_role')))))
  union all
  select 31, 'Belege', 'Korrektur offen fuer dieselben (muss 0 sein)',
         (select count(*)::text from pg_proc p
           where p.oid = to_regprocedure(
             'public.seller_issue_purchase_receipt_correction(bigint)')
             and (p.proacl is null
                  or exists (select 1 from aclexplode(p.proacl) a
                              where a.privilege_type = 'EXECUTE'
                                and (a.grantee = 0
                                     or a.grantee::regrole::text
                                        in ('anon', 'authenticated', 'service_role')))))
  union all
  select 33, 'Belege', 'ACL beider Ausstellungsfunktionen im Volltext',
         coalesce((select string_agg(p.proname::text || ' = '
                            || coalesce(array_to_string(p.proacl::text[], ' '), '(NULL!)'),
                            ' | ' order by p.proname::text)
            from pg_proc p
           where p.oid in (
                   to_regprocedure('public.seller_issue_purchase_receipt(bigint)'),
                   to_regprocedure(
                     'public.seller_issue_purchase_receipt_correction(bigint)'))), '(keine)')
  union all
  select 34, 'Belege', 'Testfiguren im oeffentlichen Angebot (muss 0 sein)',
         (select count(*)::text from public.shop_offers() ofr where ofr.sky_id >= 'SKY-9000')
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

  -- ------------------------------------- Der Schemastand 0135 bis 0141
  --
  -- NUR UEBER `information_schema` UND `to_regprocedure`, niemals durch
  -- Lesen der Spalten selbst. Eine Abfrage, die `item_type` AUSWAEHLT,
  -- scheitert auf einer Datenbank, die sie nicht hat — und genau diese
  -- Datei soll auf beiden laufen. (Derselbe Fehler hat am 2026-10-20 den
  -- Preflight von `0139` auf Staging abgebrochen.)
  --
  -- Deshalb steht hier, WAS es gibt, und nicht, was darin steht. Die
  -- Werte messen die Pre- und Postflights der jeweiligen Migration, die
  -- ohnehin nur dort laufen, wo die Spalte existiert.
  union all
  select 60, 'Schema', 'skylanders.item_type (0135)',
         (select case when count(*) = 1 then 'steht' else 'FEHLT' end
            from information_schema.columns
           where table_schema = 'public' and table_name = 'skylanders'
             and column_name = 'item_type')
  union all
  select 61, 'Schema', 'Trigger skylanders_item_type_trg (0135)',
         (select case when count(*) = 1 then 'steht' else 'FEHLT' end
            from pg_trigger t
           where not t.tgisinternal
             and t.tgrelid = 'public.skylanders'::regclass
             and t.tgname = 'skylanders_item_type_trg')
  union all
  select 62, 'Schema', 'Kategorien mit dem Namen Portale (0138)',
         (select count(*)::text from public.categories where name = 'Portale')
  union all
  select 63, 'Schema', 'shop_inventory.sale_released (0139)',
         (select case when count(*) = 1 then 'steht' else 'FEHLT' end
            from information_schema.columns
           where table_schema = 'public' and table_name = 'shop_inventory'
             and column_name = 'sale_released')
  union all
  select 64, 'Schema', 'shop_inventory.delivery_scope (0139)',
         (select case when count(*) = 1 then 'steht' else 'FEHLT' end
            from information_schema.columns
           where table_schema = 'public' and table_name = 'shop_inventory'
             and column_name = 'delivery_scope')
  union all
  select 65, 'Schema', 'skylanders.usk_rating (0139)',
         (select case when count(*) = 1 then 'steht' else 'FEHLT' end
            from information_schema.columns
           where table_schema = 'public' and table_name = 'skylanders'
             and column_name = 'usk_rating')
  union all
  select 66, 'Schema', 'die drei CHECKs aus 0135/0139',
         (select coalesce(string_agg(c.conname::text, ', ' order by c.conname::text),
                          '(keine)')
            from pg_constraint c
           where c.conname in ('skylanders_item_type_known',
                               'skylanders_usk_rating_known',
                               'shop_inventory_delivery_scope_known'))
  union all
  select 67, 'Schema', 'die aufgehobene Kopplung disc_case/loose (muss FEHLT sein)',
         (select case when count(*) = 0 then 'FEHLT (richtig)' else 'STEHT — Befund' end
            from pg_constraint where conname = 'shop_inventory_case_is_not_loose')
  union all
  select 68, 'Schema', 'Spalten, die shop_offers() liefert (0029 = 4, 0139 = 5)',
         (select count(*)::text
            from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(nm, md)
           where p.oid = to_regprocedure('public.shop_offers()') and a.md = 't')
  union all
  select 69, 'Schema', 'die Funktionen aus 0137 bis 0141',
         (select string_agg(x.name || '=' || x.stand, ', ' order by x.name)
            from (values
                   ('seller_create_catalog_item',
                    'public.seller_create_catalog_item(text, text, text)'),
                   ('is_position_sellable', 'public.is_position_sellable(bigint)'),
                   ('seller_set_sale_release',
                    'public.seller_set_sale_release(text, text, boolean)'),
                   ('seller_set_delivery_scope',
                    'public.seller_set_delivery_scope(text, text, text)'),
                   ('admin_set_usk_rating',
                    'public.admin_set_usk_rating(text, smallint)'),
                   ('seller_sale_state', 'public.seller_sale_state()')
                 ) as f(name, sig)
            cross join lateral (select f.name as name,
                                       case when to_regprocedure(f.sig) is null
                                            then 'FEHLT' else 'steht' end as stand) x)
)
select nr, bereich, gegenstand, befund from zeilen order by nr;
