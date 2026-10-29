-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND VOR 0154, REIN LESEND
--
-- VOR `0154_merge_draft_into_figure.sql` fahren. **Erwartet: Zeile 9999 = `0`.**
--
--   101-104  DIE GRUNDLAGE: `skylanders`, `is_platform_admin()` und — neu
--            gegenueber `0152` — die Spalte `catalog_status`. `0154` liest
--            sie, um Entwurf von Bestand zu unterscheiden.
--   111-112  DASS ES DIE BEIDEN FUNKTIONEN NOCH NICHT GIBT.
--   121-124  DIE FREMDSCHLUESSEL AUF `skylanders`, und zwar GEZAEHLT und auf
--            Einspaltigkeit geprueft. `admin_merge_references()` leitet sie
--            zur Laufzeit her; ein mehrspaltiger wuerde dort eine Ausnahme
--            ausloesen, und das soll hier schon auffallen.
--   131-134  der Bestand, den `0154` NICHT anfassen darf — als Auskunft.
--
-- EINE RECHTEGESCHUETZTE ZEILE: 134 liest `catalog_editorial`, und das darf
-- der lesende Pruefzugang nicht. Sie meldet `KEIN-RECHT`, zaehlt in 9998 und
-- blockiert NICHT (ADR-0139, ADR-0141).
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
  (101, 'Grundlage', 'skylanders steht (0001)',
      (to_regclass('public.skylanders') is not null)::text, 'true'),
  (102, 'Grundlage', 'is_platform_admin() steht (0026/0077)',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  (103, 'Grundlage', 'skylanders.catalog_status steht (0152) — 0154 liest sie',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), '1'),
  (104, 'Grundlage', 'catalog_editorial steht (0004) — 0154 loescht dort die Notiz des Entwurfs',
      (to_regclass('public.catalog_editorial') is not null)::text, 'true'),

  -- -------------------------------------------- Die beiden gibt es noch nicht
  (111, 'Noch nicht da', 'admin_merge_references(text) gibt es nicht',
      (to_regprocedure('public.admin_merge_references(text)') is null)::text, 'true'),
  (112, 'Noch nicht da', 'admin_merge_draft(text,text,text) gibt es nicht',
      (to_regprocedure('public.admin_merge_draft(text,text,text)') is null)::text, 'true'),

  -- ------------------------------------- Die Fremdschluessel auf skylanders
  /*
   * SIE SIND DER GEGENSTAND DER FUNKTION. `admin_merge_references()` leitet
   * sie zur Laufzeit aus `pg_constraint` her — eine getippte Liste waere
   * beim naechsten still falsch. Hier wird nur FESTGEHALTEN, wie viele es
   * gerade sind, damit die Nachkontrolle dieselbe Zahl sieht.
   */
  (121, 'Verweise', 'Info: Fremdschluessel auf skylanders',
      (select count(*)::text from pg_constraint c
        where c.contype = 'f' and c.confrelid = 'public.skylanders'::regclass), null),
  (122, 'Verweise', 'alle einspaltig — sonst kann die Funktion sie nicht zaehlen',
      (select count(*)::text from pg_constraint c
        where c.contype = 'f' and c.confrelid = 'public.skylanders'::regclass
          and array_length(c.conkey, 1) <> 1), '0'),
  (123, 'Verweise', 'Info: davon catalog_editorial (zaehlt bewusst NICHT mit)',
      (select count(*)::text from pg_constraint c
        where c.contype = 'f' and c.confrelid = 'public.skylanders'::regclass
          and c.conrelid = 'public.catalog_editorial'::regclass), null),

  -- ------------------------------------- Der Bestand, den 0154 nicht anfasst
  (131, 'Bestand', 'Info: Entwuerfe',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), null),
  (132, 'Bestand', 'Info: public / hidden',
      (select (count(*) filter (where catalog_status = 'public'))::text || ' / '
              || (count(*) filter (where catalog_status = 'hidden'))::text
         from public.skylanders), null),
  (133, 'Bestand', 'kein Entwurf ist sichtbar',
      (select count(*)::text from public.skylanders
        where catalog_status = 'draft' and catalog_visible), '0'),
  (134, 'Bestand', 'Info: Zeilen in catalog_editorial',
      case when to_regclass('public.catalog_editorial') is null then '(keine Tabelle)'
           when has_table_privilege('public.catalog_editorial', 'select')
             then (xpath('/row/c/text()', query_to_xml(
                 'select count(*) as c from public.catalog_editorial',
                 false, true, '')))[1]::text
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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0154 ruehrt das nicht an)',
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
