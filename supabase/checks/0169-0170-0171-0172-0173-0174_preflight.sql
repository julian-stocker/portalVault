-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0169–0174 (VERKAUFSABGLEICH), REIN LESEND
--
-- VOR `supabase/operations/staging-0169-0170-0171-0172-0173-0174.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS DIE GRUPPE TUT (ADR-0174). Sieben neue Tabellen fuer den
-- Verkaufsabgleich (0169), Storno und Storno-Ruecknahme externer Verkaeufe
-- (0170), eine eindeutige Bestellnummer je Kanal (0171), die lesenden und
-- protokollierenden Funktionen (0172), das Anwenden (0173) und die neuen
-- Bereiche in Betriebs- und Plattformsicherung (0174). Sie enthaelt KEINE
-- Datenanweisung: kein Verkauf, keine Position, kein Lager wird angefasst.
--
--   101-105  DIE GRUNDLAGE: Verkaufsbuch, Audit, Holds, die aufgerufenen Funktionen.
--   106      KEINE der beiden Sicherungen ist fuer PUBLIC oder anon ausfuehrbar.
--   107-108  DIE AUSGANGSRUEMPFE der beiden Sicherungsfunktionen (Riegel von 0174).
--   109-110  IHRE RECHTE, wie gemessen — die Nachkontrolle erwartet dieselben in 245-246.
--   111-114  SIE STEHT NOCH NICHT.
--   121      KEINE Bestellnummer steht heute doppelt in einem Kanal (sonst stoppt 0171).
--   131-137  AUSKUNFT: was sich durch die Gruppe nicht bewegen darf — die
--            Nachkontrolle nennt dieselben Zahlen in 231-237.
--
-- GESCHUETZTE TABELLEN. `sales`, `sale_items`, `sale_refunds`, `orderbook_audit`,
-- `order_reservations`, `inventory_movements` und `legacy_stock_events` sind
-- dem lesenden Pruefzugang NICHT geteilt (ADR-0139/0140). Ihre Zeilen stehen
-- hinter `has_table_privilege` + `query_to_xml`: fuer den Pruefzugang
-- `KEIN-RECHT` (Zeile 9998 zaehlt sie, sie blockieren nicht), im SQL-Editor
-- als `postgres` gemessen. Dem Pruefzugang wird KEIN Recht erteilt.
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
  (101, 'Grundlage', 'das Verkaufsbuch steht (sales, sale_items, sale_refunds — 0059)',
      ((to_regclass('public.sales') is not null and to_regclass('public.sale_items') is not null
        and to_regclass('public.sale_refunds') is not null))::text, 'true'),
  (102, 'Grundlage', 'das Audit steht (orderbook_audit — 0062)',
      (to_regclass('public.orderbook_audit') is not null)::text, 'true'),
  (103, 'Grundlage', 'die externen Holds stehen (order_reservations.sale_item_id — 0109)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.order_reservations')
          and a.attname = 'sale_item_id' and not a.attisdropped), '1'),
  (104, 'Grundlage', 'die aufgerufenen Funktionen stehen (0041, 0062, 0091, 0110)',
      ((to_regprocedure('public.can_operate_active_seller()') is not null)::int
       + (to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)') is not null)::int
       + (to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)') is not null)::int
       + (to_regprocedure('public.orderbook_touch_sale(bigint)') is not null)::int
       + (to_regprocedure('public.seller_update_sale(bigint,date,boolean,text,numeric,numeric,numeric,text,text,text,timestamptz)') is not null)::int
       + (to_regprocedure('public.seller_add_sale_refund(bigint,numeric,timestamptz,text,text,text)') is not null)::int
       + (to_regprocedure('public.hold_sale_item(bigint)') is not null)::int
       + (to_regprocedure('public.release_sale_item_hold(bigint)') is not null)::int)::text, '8'),
  (105, 'Grundlage', 'sales_cancelled_is_not_released steht (0071)',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.sales') and c.conname = 'sales_cancelled_is_not_released'), '1'),
  /*
   * 107/108 — DIE AUSGANGSRUEMPFE FUER 0174. `0174` ersetzt die beiden
   * Sicherungsfunktionen nur, wenn GENAU diese Fassungen stehen; sonst bricht
   * es ab, statt eine fremde Fassung zu ueberschreiben. Gemessen wird hier,
   * damit dieser Abbruch nicht erst im Lauf auffaellt.
   */
  (107, 'Grundlage', 'Betriebssicherung ist die Fassung aus 0140 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()')),
      'a32b148cebe00ee0d0d469f96fd2028e'),
  (108, 'Grundlage', 'Plattformsicherung ist die Fassung aus 0164 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')),
      '7e9e58e2d84a9f8a7c660262aa21926b'),
  /*
   * 109/110 — DIE RECHTE DER BEIDEN SICHERUNGSFUNKTIONEN, so wie sie auf
   * Staging stehen (gemessen 2026-11-03). `0174` vergibt und entzieht nichts:
   * es haelt die ACL vor dem Ersetzen fest und bricht ab, wenn sie danach
   * anders aussieht. Das `service_role`-Recht auf der Betriebssicherung ist
   * Supabases Voreinstellung und bleibt — darueber entscheidet die zentrale
   * Sicherung (ab 0175), nicht diese Gruppe. Steht hier etwas anderes, ist
   * die Umgebung nicht die gemessene: STOPP, nicht anpassen.
   * 106 — PUBLIC und anon duerfen keine der beiden ausfuehren; sonst bricht
   * `0174` schon im Vorblock ab. Eine NULL-ACL ist die Voreinstellung und
   * erlaubt PUBLIC — deshalb `acldefault`.
   */
  (106, 'Grundlage', 'keine der beiden Sicherungen ist fuer PUBLIC oder anon ausfuehrbar',
      (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.seller_business_backup()'), to_regprocedure('public.system_platform_export()'))
          and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '0'),
  (109, 'Grundlage', 'Rechte der Betriebssicherung (ACL, bleibt durch 0174 unveraendert)',
      (select coalesce(p.proacl::text, '(default)') from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()')),
      '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  (110, 'Grundlage', 'Rechte der Plattformsicherung (ACL, bleibt durch 0174 unveraendert)',
      (select coalesce(p.proacl::text, '(default)') from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')),
      '{postgres=X/postgres,authenticated=X/postgres}'),

  -- ------------------------------------------------- Sie steht noch nicht
  (111, 'Luecke', 'keine der sieben Abgleichstabellen steht',
      (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname like 'sales\_recon\_%' and c.relkind = 'r'), '0'),
  (112, 'Luecke', 'keine Abgleichsfunktion steht',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proname like 'seller\_recon\_%' or p.proname like 'sales\_recon\_%')), '0'),
  (113, 'Luecke', 'Storno und Ruecknahme stehen noch nicht',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('seller_cancel_external_sale', 'seller_uncancel_external_sale')), '0'),
  (114, 'Luecke', 'der Index fuer Bestellnummern je Kanal steht noch nicht',
      (to_regclass('public.sales_external_order_ref_per_channel') is null)::text, 'true'),

  -- -------------------------------- Die eine Vorbedingung aus Daten (0171)
  (121, 'Vorbedingung', 'keine Bestellnummer steht doppelt in einem Kanal (ohne Testverkaeufe)',
      case when has_table_privilege('public.sales', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*) as c from (select 1 from public.sales where external_order_ref is not null and not is_test group by channel, external_order_ref having count(*) > 1) d', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '0'),

  -- --------------------------- Was sich durch die Gruppe NICHT bewegen darf
  (131, 'Unveraendert', 'Verkaeufe: Anzahl|Abdruck (Datum, Betraege, Referenz, Storno, Stand)',
      case when has_table_privilege('public.sales', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(s.id::text || ''|'' || coalesce(s.sold_at::text, ''-'') || ''|'' || coalesce(s.items_subtotal::text, ''-'') || ''|'' || coalesce(s.discount_amount::text, ''-'') || ''|'' || coalesce(s.shipping_charged::text, ''-'') || ''|'' || coalesce(s.external_order_ref, ''-'') || ''|'' || coalesce(s.cancelled_at::text, ''-'') || ''|'' || s.updated_at::text, chr(10) order by s.id)), ''(leer)'') as c from public.sales s', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (132, 'Unveraendert', 'Verkaufspositionen: Anzahl|Abdruck',
      case when has_table_privilege('public.sale_items', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(i.id::text || ''|'' || i.sale_id::text || ''|'' || coalesce(i.sky_id, ''-'') || ''|'' || coalesce(i.raw_name, ''-'') || ''|'' || coalesce(i.movement_id::text, ''-'') || ''|'' || coalesce(i.settled_at::text, ''-''), chr(10) order by i.id)), ''(leer)'') as c from public.sale_items i', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (133, 'Unveraendert', 'Erstattungen: Anzahl|Summe',
      case when has_table_privilege('public.sale_refunds', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(sum(amount), 0)::text as c from public.sale_refunds', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (134, 'Unveraendert', 'Auditzeilen des Verkaufsbuchs',
      case when has_table_privilege('public.orderbook_audit', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.orderbook_audit', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (135, 'Unveraendert', 'aktive externe Holds: Anzahl|Menge',
      case when has_table_privilege('public.order_reservations', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(sum(quantity), 0)::text as c from public.order_reservations where sale_item_id is not null and state = ''active''', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (136, 'Unveraendert', 'Lagerbewegungen',
      case when has_table_privilege('public.inventory_movements', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.inventory_movements', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (137, 'Unveraendert', 'Legacy-Lagerereignisse',
      case when has_table_privilege('public.legacy_stock_events', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.legacy_stock_events', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0164 ruehrt das nicht an)',
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
