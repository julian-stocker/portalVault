-- ===========================================================================
-- DIAGNOSE CAT-05H, Teil 3: alle dreizehn verweisenden Tabellen
--
-- WARUM VOLLSTAENDIG UND NICHT ZWEI. Teil 1 hat `collection_items` und
-- `shop_inventory` gemessen — das sind zwei von DREIZEHN. `delete from
-- public.skylanders` scheitert an JEDER verweisenden Zeile mit `23503`, und
-- dieser Fehlercode ist in der Oberflaeche NICHT zugeordnet: er wird zu
-- „Das hat nicht geklappt."
--
-- `admin_merge_references()` zaehlt zwar alle zwoelf (ohne
-- `catalog_editorial`, die dem Entwurf selbst gehoert) und wuerde vorher
-- abbrechen — mit einer Meldung, die die Oberflaeche sehr wohl kennt. Dass
-- der Betreiber den Auffangtext gesehen hat, heisst also entweder: es gibt
-- keine Verweise, oder einer entgeht der Zaehlung. Diese Datei entscheidet
-- das, Tabelle fuer Tabelle.
--
-- JEDE ZEILE IST EINGEKAPSELT. Ein `case when has_table_privilege(...)`
-- allein genuegt NICHT: der Planer loest die Unterabfrage trotzdem auf, und
-- die ganze Datei bricht mit „permission denied" ab. Genau das ist beim
-- ersten Lauf passiert. `query_to_xml` fuehrt die Abfrage erst aus, wenn der
-- Zweig gewaehlt ist (ADR-0141).
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund) as (values
  (301, 'Verweise', 'availability_notifications: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.availability_notifications', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.availability_notifications', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (302, 'Verweise', 'cart_items: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.cart_items', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.cart_items', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (303, 'Verweise', 'catalog_editorial: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.catalog_editorial', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.catalog_editorial', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (304, 'Verweise', 'collection_items: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.collection_items', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.collection_items', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (305, 'Verweise', 'favorites: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.favorites', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.favorites', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (306, 'Verweise', 'inventory_import_mappings: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.inventory_import_mappings', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.inventory_import_mappings', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (307, 'Verweise', 'inventory_import_rows: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.inventory_import_rows', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.inventory_import_rows', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (308, 'Verweise', 'legacy_stock_events: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.legacy_stock_events', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.legacy_stock_events', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (309, 'Verweise', 'offer_state: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.offer_state', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.offer_state', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (310, 'Verweise', 'orderbook_name_mappings: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.orderbook_name_mappings', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.orderbook_name_mappings', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (311, 'Verweise', 'purchase_items: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.purchase_items', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.purchase_items', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (312, 'Verweise', 'sale_items: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.sale_items', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.sale_items', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (313, 'Verweise', 'shop_inventory: SKY-0824 | SKY-0103',
      case when has_table_privilege('public.shop_inventory', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select count(*) filter (where sky_id = ''SKY-0824'')::text || '' | '' || count(*) filter (where sky_id = ''SKY-0103'')::text as c from public.shop_inventory', false, true, '')))[1]::text, '0 | 0')
           else 'KEIN-RECHT' end),
  (399, 'Verweise', 'Info: was admin_merge_references() durchgeht (ohne catalog_editorial)',
      (select count(*)::text from pg_constraint c
        where c.contype = 'f'
          and c.confrelid = to_regclass('public.skylanders')
          and c.conrelid <> to_regclass('public.catalog_editorial')))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
