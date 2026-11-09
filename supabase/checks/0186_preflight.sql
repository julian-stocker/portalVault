-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0186 (BESTELLNUMMER TROTZ KONKURRENZ ZUORDNEN,
--           JEDER KONKURRENT EINZELN AUSGESCHLOSSEN), REIN LESEND
--
-- VOR `supabase/operations/staging-0186.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0186 TUT. Eine Funktion, `seller_recon_confirm_order_ref(bigint, bigint,
-- timestamptz, jsonb, text)`: traegt die Bestellnummer an einem Verkauf ein,
-- wenn der Betrieb jeden Konkurrenten (0180) einzeln ausgeschlossen und eine
-- Begruendung angegeben hat — nur dieses eine Feld, je Konkurrent eine
-- Journalzeile. 0180 und 0185 bleiben Wort fuer Wort. KEINE Datenanweisung
-- im Lauf.
--
--   101-104  DIE GRUNDLAGE: Journal, Versionspruefung, Orderbuch-Bearbeitung,
--            CSV-Pruefung (0180), Anlagewege (0183, 0184), einfache Zuordnung
--            (0185) als bekannte Fassungen; Tabellen, Sperre, Index; die
--            gelesenen Spalten.
--   111      SIE STEHT NOCH NICHT.
--   141-149  AUSKUNFT: Verkaeufe, Positionen, Erstattungen, Lagerbewegungen,
--            Journal, Reservierungen, Gebuehren, Abgleichszuordnungen und
--            -bestellungen, jede Spalte.
--   151-153  AUSKUNFT: die Rechte jeder Funktion (ausser der neuen) und jeder
--            Tabelle in `public` und jede Policy. Die Nachkontrolle nennt
--            dieselben Werte in 241-253; die Einfuege-Huelle vergleicht sie
--            BLOCKIEREND (Z1).
--   300-311, 900, 901  der Basis-Vertrag (Shop, Lager, Sammlung) wie bei 0180.
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
  (101, 'Grundlage', 'Journal, Versionspruefung, Orderbuch-Bearbeitung, CSV-Uebernahmepruefung (0180), die Anlagewege (0183, 0184) und die einfache Zuordnung (0185) sind die bekannten Fassungen',
      (select string_agg(md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
        where p.oid in (to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)'),
                        to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)'),
                        to_regprocedure('public.sales_recon_take_check(bigint)'),
                        to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)'),
                        to_regprocedure('public.seller_recon_assign_sale(bigint,bigint,timestamptz)'),
                        to_regprocedure('public.seller_recon_create_sale(bigint,jsonb)'),
                        to_regprocedure('public.seller_update_sale(bigint,date,boolean,text,numeric,numeric,numeric,text,text,text,timestamptz)'))),
      '3152b6595d78de9b479199da28b05411,a8a7e665d64e656e0ecc6515f55b3cb7,bce45f42855c25fc428cab86bd7cf081,ba97349be8b2a96194fde5a38460840b,2ecac417b66bc59c3272440d296f9e67,75e9d24e44b2467b551e8c620f840ba0,5515f1af50aebb6b9ced82c1235b181a'),
  (102, 'Grundlage', 'die Abgleichstabellen, die Betriebssperre, v1_sale_condition() und der Bestellnummer-Index (0171) stehen',
      ((to_regclass('public.sales_recon_orders') is not null) and (to_regclass('public.sales_recon_matches') is not null)
       and (to_regclass('public.sales_recon_sessions') is not null)
       and (to_regprocedure('public.can_operate_active_seller()') is not null)
       and (to_regprocedure('public.v1_sale_condition()') is not null)
       and (to_regclass('public.sales_external_order_ref_per_channel') is not null))::text, 'true'),
  (103, 'Grundlage', 'sales_recon_orders und sales_recon_matches und sales_recon_sessions fuehren die Spalten, die 0186 liest',
      (select count(*)::text from pg_attribute a
        where a.attnum > 0 and not a.attisdropped
          and ((a.attrelid = to_regclass('public.sales_recon_orders')
                and a.attname in ('id', 'session_id', 'channel', 'order_ref', 'sold_on', 'lines'))
            or (a.attrelid = to_regclass('public.sales_recon_matches')
                and a.attname in ('session_id', 'order_id', 'sale_id', 'category'))
            or (a.attrelid = to_regclass('public.sales_recon_sessions')
                and a.attname in ('id', 'state')))), '12'),
  (104, 'Auskunft', 'davon SECURITY DEFINER mit genau einem leeren search_path (von 7)',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)'),
                        to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)'),
                        to_regprocedure('public.sales_recon_take_check(bigint)'),
                        to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)'),
                        to_regprocedure('public.seller_recon_assign_sale(bigint,bigint,timestamptz)'),
                        to_regprocedure('public.seller_recon_create_sale(bigint,jsonb)'),
                        to_regprocedure('public.seller_update_sale(bigint,date,boolean,text,numeric,numeric,numeric,text,text,text,timestamptz)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')), null),
  (111, 'Luecke', 'seller_recon_confirm_order_ref steht noch nicht',
      (to_regprocedure('public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)') is null)::text, 'true'),

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
  (145, 'Auskunft', 'Orderbuch-Journal: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.orderbook_audit', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.orderbook_audit t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (146, 'Auskunft', 'Reservierungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.order_reservations', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.order_reservations t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (147, 'Auskunft', 'Gebuehren: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sale_fees', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sale_fees t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (148, 'Auskunft', 'Abgleich: Zuordnungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales_recon_matches', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_matches t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (149, 'Auskunft', 'Abgleich: Bestellungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales_recon_orders', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_orders t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  (151, 'Auskunft', 'Rechte, SECURITY DEFINER und search_path jeder Funktion in public ausser den acht neuen: Abdruck',
      (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                             || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                             chr(10) order by p.oid::regprocedure::text))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname not in ('seller_recon_confirm_order_ref')), null),
  (152, 'Auskunft', 'Rechte und RLS-Schalter jeder Tabelle, Sicht und Sequenz in public ausser der neuen Spur: Abdruck',
      (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                             || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') ), null),
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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0186 ruehrt das nicht an)',
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
