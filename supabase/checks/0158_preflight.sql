-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND VOR 0158, REIN LESEND
--
-- VOR `0158_figure_families.sql` fahren. **Erwartet: Zeile 9999 = `0`.**
--
--   101-106  DIE GRUNDLAGE: `characters` und `character_id` (`0002`),
--            `admin_set_catalog_status` (`0152`, Weg B benutzt sie), der
--            Dublettenindex auf dem gefalteten Familiennamen, und die
--            Constraint aus `0157`.
--   111-114  DASS ES DIE DREI FUNKTIONEN NOCH NICHT GIBT, und dass die
--            Constraint `character_id` noch NICHT kennt — ohne diese
--            Migration waere jede Zuordnung derselbe Fehler `23514` wie in
--            CAT-05I.
--   121-128  DER AUSGANGSZUSTAND DER KURATIERUNG: wie viele Zeilen eine
--            Familie haben, wie viele Familien es gibt, wie viele Figuren
--            ohne Familie dastehen. Diese Zahlen sind der Nullpunkt fuer
--            die spaetere Einzelkorrektur — `0158` aendert KEINE davon.
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
  (101, 'Grundlage', 'characters steht (0002)',
      (to_regclass('public.characters') is not null)::text, 'true'),
  (102, 'Grundlage', 'skylanders.character_id steht (0002)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'character_id' and not a.attisdropped), '1'),
  (103, 'Grundlage', 'admin_set_catalog_status(text,text) steht (0152) — Weg B benutzt sie',
      (to_regprocedure('public.admin_set_catalog_status(text,text)') is not null)::text, 'true'),
  (104, 'Grundlage', 'characters_canonical_name_key steht (0002) — der Dublettenschutz',
      (select count(*)::text from pg_class c
        where c.relname = 'characters_canonical_name_key' and c.relkind = 'i'), '1'),
  (105, 'Grundlage', 'die Constraint ist die aus 0157 (kennt merged_from)',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%merged_from%')::text), '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (106, 'Grundlage', 'is_platform_admin() steht (0026/0077)',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),

  -- ---------------------------------------- Was es noch nicht gibt
  (111, 'Noch nicht da', 'admin_create_character(text) gibt es nicht',
      (to_regprocedure('public.admin_create_character(text)') is null)::text, 'true'),
  (112, 'Noch nicht da', 'admin_set_character(text,bigint) gibt es nicht',
      (to_regprocedure('public.admin_set_character(text,bigint)') is null)::text, 'true'),
  (113, 'Noch nicht da', 'admin_publish_as_variant(text,bigint) gibt es nicht',
      (to_regprocedure('public.admin_publish_as_variant(text,bigint)') is null)::text, 'true'),
  (114, 'Noch nicht da', 'die Constraint kennt character_id NICHT (der Anlass)',
      (select coalesce(max((pg_get_constraintdef(c.oid) not like '%character_id%')::text),
                       '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),

  -- ------------------------------ Der Ausgangszustand der Kuratierung
  /*
   * DIESE ZAHLEN SIND DER NULLPUNKT. `0158` aendert keine von ihnen — sie
   * legt Funktionen an und sonst nichts. Die Nachkontrolle vergleicht
   * dagegen; bewegt sich eine, hat etwas anderes geschrieben.
   */
  (121, 'Kuratierung', 'Katalogzeilen MIT Familie',
      (select count(*)::text from public.skylanders where character_id is not null), null),
  (122, 'Kuratierung', 'Katalogzeilen OHNE Familie',
      (select count(*)::text from public.skylanders where character_id is null), null),
  (123, 'Kuratierung', 'Familien, auf die eine Figur zeigt',
      (select count(distinct character_id)::text from public.skylanders
        where character_id is not null), null),
  (124, 'Kuratierung', 'Info: Zeilen in characters',
      case when has_table_privilege('public.characters', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.characters$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, null),
  (125, 'Kuratierung', 'Familien mit Figuren in mehreren Serien',
      (select count(*)::text from (
        select character_id from public.skylanders where character_id is not null
         group by character_id having count(distinct series_code) > 1) x), null),
  (126, 'Kuratierung', 'keine Figur zeigt auf eine Familie, die es nicht gibt',
      case when has_table_privilege('public.characters', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.skylanders s where s.character_id is not null and not exists (select 1 from public.characters c where c.id = s.character_id)$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, '0'),
  (127, 'Kuratierung', 'Entwuerfe (die moeglichen CAT-06-Faelle)',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), null),
  (128, 'Kuratierung', 'Journalzeilen mit field = character_id (muss 0 sein)',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.catalog_admin_changes where field = 'character_id'$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, '0'),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0158 ruehrt das nicht an)',
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
