-- Inhaltsabdruck je Tabelle: nicht nur WIE VIELE Zeilen, sondern WELCHE.
-- Dieselbe Technik benutzen die Rollout-Preflights.
--
-- Erfasst sind ALLE 28 Exportbereiche plus `profiles` — also jede Tabelle,
-- an der Geschaeft, Beleg, Lager, Bestellung oder Stammdatum haengt. Die
-- Zeilenzahlen in `baseline-rows.sql` deckt jede Tabelle ab; hier geht es um
-- den Inhalt der geschaeftskritischen.
select v.tabelle,
       coalesce((xpath('/row/c/text()',
                 query_to_xml(
                   format('select md5(string_agg(t::text, %L order by t.%I)) as c'
                          || ' from public.%I t', '|', v.sortierung, v.tabelle),
                   false, true, '')))[1]::text, '(leer)') as abdruck
  from (values
          -- Einkauf und Belege
          ('purchases',                 'id'),
          ('purchase_items',            'id'),
          ('purchase_receipts',         'id'),
          ('purchase_receipt_downloads','id'),
          ('purchase_receipt_counters', 'year'),
          -- Lager
          ('shop_inventory',            'id'),
          ('inventory_movements',       'id'),
          -- Verkauf und Abrechnung
          ('sales',                     'id'),
          ('sale_items',                'id'),
          ('sale_fees',                 'id'),
          ('sale_refunds',              'id'),
          ('settlement_adjustments',    'id'),
          ('orderbook_name_mappings',   'id'),
          ('seller_monthly_reports',    'id'),
          -- Bestellungen
          ('orders',                    'id'),
          ('order_lines',               'id'),
          ('order_line_events',         'id'),
          ('order_reservations',        'id'),
          ('order_refunds',             'id'),
          ('order_refund_allocations',  'id'),
          ('order_legal_snapshots',     'order_id'),
          ('invoices',                  'id'),
          -- Stammdaten
          ('sellers',                   'id'),
          ('shop_settings',             'id'),
          ('shipping_methods',          'code'),
          ('categories',                'id'),
          ('series',                    'code'),
          ('skylanders',                'sky_id'),
          ('profiles',                  'id')) as v(tabelle, sortierung)
 order by 1;
