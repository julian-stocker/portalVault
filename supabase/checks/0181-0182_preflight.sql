-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0181 (POSITIONEN IMPORTIERTER VERKAEUFE
--           KORRIGIEREN), REIN LESEND
--
-- VOR `supabase/operations/staging-0181-0182.sql` fahren — EIN gemeinsamer
-- Lauf fuer 0181 und 0182 (wie 0169 bis 0174): die Spur entsteht nie ohne
-- ihre Sicherung.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0181 TUT (ADR-0179). Es legt die append-only Spur
-- `sale_item_corrections` an, acht Funktionen (drei Korrekturwege, eine
-- Lesefunktion, drei interne Helfer, den Trigger der Spur) und ersetzt den
-- 0182 nimmt die Spur in beide Sicherungen auf (Betriebssicherung 36
-- Bereiche, Plattformsicherung 62, Formatversion 4). 0181 ersetzt den
-- Rumpf von `system_sync_legacy_sale_item` (0088) — zeichengleich bis auf die
-- Ablehnung einer korrigierten Zeile — und den von
-- `system_sync_legacy_sale_group` (0089) — zeichengleich bis auf die Ablehnung
-- eines im Orderbuch korrigierten Datums. KEINE Datenanweisung.
--
--   101-109  DIE GRUNDLAGE: die Journalhelfer (0062), beide Sync-Funktionen
--            (0088, 0089) als Riegel, die normalen Positionswege (0065/0110), die Sperre, die
--            Spalten von sale_items, Rechte und search_path.
--   111      SIE STEHT NOCH NICHT: weder die Spur noch eine neue Funktion.
--   112      DIE SICHERUNGEN sind die Fassungen aus 0174 — Riegel fuer 0182.
--   141-148  AUSKUNFT: Verkaeufe, Positionen, Erstattungen, Lagerbewegungen,
--            Altbestandsereignisse, Orderbuch-Journal, Reservierungen,
--            Gebuehren, jede Spalte.
--   151-153  AUSKUNFT: die Rechte jeder Funktion (ausser den acht neuen) und
--            Tabelle in `public` (ausser der neuen Spur) und jede Policy. Die
--            Nachkontrolle nennt dieselben Werte in 241-253; die
--            Einfuege-Huelle vergleicht sie BLOCKIEREND (Z1).
--   300-311, 900, 901  der Basis-Vertrag (Shop, Lager, Sammlung) wie bei 0180.
--
-- GESCHUETZTE TABELLEN hinter `has_table_privilege` + `query_to_xml`: fuer den
-- Pruefzugang `KEIN-RECHT` (9998), im SQL-Editor als `postgres` gemessen.
-- Ausgegeben werden nur Anzahlen und md5-Abdruecke, nie ein Wert.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
basis_mess as (
  -- Die sieben Zahlen, einmal gerechnet, hier und in Zeile 900 benutzt.
  select
    /*
     * DIE ZWEI FELDER, DIE `shop_offers()` BRAUCHEN — und das ist die einzige
     * Stelle des Basis-Vertrags, an der ein Recht fehlen kann.
     *
     * Fehlt `execute`, steht hier `KEIN-RECHT`: die Zeilen 811 und 812 sind
     * dann OFFEN (Zeile 9998 zaehlt sie), die uebrigen fuenf Felder werden
     * weiter gemessen und verglichen. Ein fehlendes Recht nimmt also nicht
     * die ganze Baseline mit — aber es wird auch nicht stillschweigend
     * uebergangen.
     */
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.shop_offers()',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote,
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select md5(coalesce(string_agg(o.sky_id || ''|'' || o.condition || ''|'' '
             '|| coalesce(o.price::text, ''''), '
             ''';'' order by o.sky_id, o.condition), '''')) as c '
             'from public.shop_offers() o',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote_md5,
    (select count(*)::text from public.skylanders s
      where public.is_shop_eligible(s.sky_id))                             as shopfaehig,
    (select count(*)::text from sammelbar)                                 as sammelbar,
    (select count(*)::text from public.shop_inventory)                     as lagerzeilen,
    (select count(*)::text from public.skylanders)                         as katalogzeilen,
    (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                    || coalesce(i.sale_price::text, '-') || '|'
                                    || i.sale_released::text,
                                    E'\n' order by i.id)), '(leer)')
       from public.shop_inventory i)                                       as lager_md5
),
basis_feld as (
  select angebote || '|' || angebote_md5 || '|' || shopfaehig || '|' || sammelbar
         || '|' || lagerzeilen || '|' || katalogzeilen || '|' || lager_md5 as kern,
         m.*
    from basis_mess m
),
basis_zeile as (
  select 'skyisles-base-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from basis_feld f
),
coll_mess as (
  -- Die drei Zahlen der Sammlung, einmal gerechnet.
  select
    (select count(*)::text from public.collection_items)                   as zeilen,
    (select count(distinct user_id)::text from public.collection_items)    as konten,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    E'\n' order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                    as sammlung_md5
),
coll_feld as (
  select zeilen || '|' || konten || '|' || sammlung_md5 as kern, m.*
    from coll_mess m
),
coll_zeile as (
  select 'skyisles-coll-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from coll_feld f
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ---------------------------------------------------------- Die Grundlage
  (101, 'Grundlage', 'orderbook_guard_stale, orderbook_log, orderbook_touch_sale sind die Fassungen aus 0062 (md5 der Ruempfe)',
      (select string_agg(md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
        where p.oid in (to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)'),
                        to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)'),
                        to_regprocedure('public.orderbook_touch_sale(bigint)'))),
      '3152b6595d78de9b479199da28b05411,a8a7e665d64e656e0ecc6515f55b3cb7,cd7584eabbe65b43d834b2709d6ff792'),
  (102, 'Grundlage', 'system_sync_legacy_sale_item ist die Fassung aus 0088 — sonst haelt 0181 an',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)')),
      '864a99c5017b3de08056bfed740b8b56'),
  (108, 'Grundlage', 'system_sync_legacy_sale_group ist die Fassung aus 0089 — sonst haelt 0181 an',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)')),
      '6de873975a90579e1dcc8f2de0987f42'),
  (109, 'Grundlage', 'system_sync_legacy_sale_group: service_role darf, keine Clientrolle; SECURITY DEFINER, leerer search_path',
      (has_function_privilege('service_role', to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)'), 'execute')
       and (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) = '0'
       and (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')) = '1')::text, 'true'),
  (103, 'Grundlage', 'die normalen Positionswege sind die bekannten Fassungen (0065, 0110) — 0181 laesst sie unberuehrt',
      (select string_agg(md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
        where p.oid in (to_regprocedure('public.hold_sale_item(bigint)'),
                        to_regprocedure('public.seller_add_sale_item(bigint,text,text,text)'),
                        to_regprocedure('public.seller_remove_sale_item(bigint)'),
                        to_regprocedure('public.seller_set_sale_item_sky(bigint,text)'))),
      'bf3502a3f6f5ec849a4ef22785063431,da912f44a62052d52fd6da1bd8cfdd19,81011d31798d10ab12bac5f0e906be91,f46a0011b33230e66f782e12acc81cf6'),
  (104, 'Grundlage', 'die Betriebssperre und die Tabellen stehen: can_operate_active_seller(), skylanders, sale_items, order_reservations',
      ((to_regprocedure('public.can_operate_active_seller()') is not null)
       and (to_regclass('public.skylanders') is not null)
       and (to_regclass('public.sale_items') is not null)
       and (to_regclass('public.order_reservations') is not null))::text, 'true'),
  (105, 'Grundlage', 'sale_items fuehrt die Spalten, die 0181 liest und schreibt',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.sale_items') and a.attnum > 0 and not a.attisdropped
          and a.attname in ('sky_id', 'raw_name', 'position', 'condition', 'source_row', 'legacy_stock_flag',
                              'legacy_shipped_flag', 'movement_id', 'return_movement_id', 'returned_at',
                              'return_announced_at', 'settled_at', 'not_shipped_at', 'updated_at')), '14'),
  (106, 'Grundlage', 'system_sync_legacy_sale_item: service_role darf, keine Clientrolle (PUBLIC, anon, authenticated)',
      (has_function_privilege('service_role', to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)'), 'execute')
       and (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) = '0')::text, 'true'),
  (107, 'Grundlage', 'die drei Journalhelfer und der Sync: SECURITY DEFINER, genau ein leerer search_path',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)'),
                        to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)'),
                        to_regprocedure('public.orderbook_touch_sale(bigint)'),
                        to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')), '4'),
  (112, 'Grundlage', 'seller_business_backup() und system_platform_export() sind die Fassungen aus 0174 — sonst haelt 0182 an',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()')) || ',' || (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')),
      '3a798f506f5f43e5b1b69dc242a1b16f,23be72d581589b063d6938a863757b31'),
  (111, 'Luecke', 'die Spur sale_item_corrections und keine der acht neuen Funktionen von 0181 steht schon',
      ((to_regclass('public.sale_item_corrections') is null)
       and (select count(*) from unnest(array['seller_correct_legacy_sale_item(bigint,text,timestamptz)', 'seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)', 'seller_remove_legacy_added_item(bigint,timestamptz)', 'seller_sale_item_corrections(bigint)', 'sales_legacy_correction_sale(bigint,timestamptz)', 'sales_legacy_correction_item(public.sale_items)', 'sales_legacy_correction_figure(text)', 'sale_item_corrections_append_only()']) f
             where to_regprocedure('public.' || f) is not null) = 0)::text, 'true'),

  -- ------------------------------------- Was sich nicht bewegen darf (Auskunft)
  (141, 'Auskunft', 'Verkaeufe: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (142, 'Auskunft', 'Verkaufspositionen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sale_items', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sale_items t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (143, 'Auskunft', 'Erstattungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sale_refunds', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sale_refunds t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (144, 'Auskunft', 'Lagerbewegungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.inventory_movements', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.inventory_movements t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (145, 'Auskunft', 'Altbestandsereignisse: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.legacy_stock_events', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.legacy_stock_events t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (146, 'Auskunft', 'Orderbuch-Journal: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.orderbook_audit', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.orderbook_audit t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (147, 'Auskunft', 'Reservierungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.order_reservations', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.order_reservations t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (148, 'Auskunft', 'Gebuehren: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sale_fees', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sale_fees t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  (151, 'Auskunft', 'Rechte, SECURITY DEFINER und search_path jeder Funktion in public ausser den acht neuen: Abdruck',
      (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                             || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                             chr(10) order by p.oid::regprocedure::text))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname not in ('seller_correct_legacy_sale_item', 'seller_add_legacy_sale_item', 'seller_remove_legacy_added_item', 'seller_sale_item_corrections', 'sales_legacy_correction_sale', 'sales_legacy_correction_item', 'sales_legacy_correction_figure', 'sale_item_corrections_append_only')), null),
  (152, 'Auskunft', 'Rechte und RLS-Schalter jeder Tabelle, Sicht und Sequenz in public ausser der neuen Spur: Abdruck',
      (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                             || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') and c.relname not in ('sale_item_corrections', 'sale_item_corrections_id_seq')), null),
  (153, 'Auskunft', 'jede Policy in public (Verkaeufer, Sammlung, alles): Abdruck',
      (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                             || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                             chr(10) order by pl.tablename, pl.policyname)), '(keine)')
         from pg_policies pl where pl.schemaname = 'public'), null),

   -- --------------------------- Die Zahlen des Betriebs (Basis-Vertrag)
  (301, 'Shop', 'oeffentliche Angebote',
      (select angebote from basis_mess), null),
  (302, 'Shop', 'Angebots-Abdruck',
      (select angebote_md5 from basis_mess), null),
  (303, 'Shop', 'shopfaehige Katalogzeilen',
      (select shopfaehig from basis_mess), null),
  (304, 'Shop', 'sammelbare Katalogzeilen',
      (select sammelbar from basis_mess), null),
  (305, 'Shop', 'Lagerzeilen',
      (select lagerzeilen from basis_mess), null),
  (306, 'Shop', 'Katalogzeilen',
      (select katalogzeilen from basis_mess), null),
  (307, 'Shop', 'Lager-Abdruck',
      (select lager_md5 from basis_mess), null),
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0181 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

  (900, 'BASIS', 'Shop-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from basis_zeile), null),
  (901, 'BASIS', 'Sammlungs-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from coll_zeile), null)
),
ergebnis as (
  /*
   * DREI ZUSTAENDE, NICHT ZWEI (ADR-0139).
   *
   *   ok = true   die Pruefung stimmt
   *   ok = false  sie weicht ab           → zaehlt in 9999, blockiert
   *   ok = null   Auskunft ODER OFFEN     → zaehlt nicht in 9999
   *
   * `KEIN-RECHT` heisst: diese Zeile greift auf ein Objekt zu, auf das die
   * aufrufende Rolle kein Recht hat. Das ist KEINE Abweichung, sondern eine
   * nicht durchgefuehrte Pruefung — Zeile 9998 zaehlt sie.
   */
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte '
       '(0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
