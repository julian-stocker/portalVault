-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0164, REIN LESEND
--
-- VOR `0164_platform_export_types.sql` fahren. **ERST `0163`, DANN `0164`.**
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0164 TUT. Sie ersetzt EINEN Funktionsrumpf und fuegt drei Felder in den
-- Katalogbereich der Plattformsicherung ein. Keine Tabelle, keine Spalte,
-- keine Zeile, kein Recht.
--
--   101-106  DIE GRUNDLAGE: die drei Spalten aus `0163` stehen, und der
--            Exportrumpf ist der aus `0160` (`ff4f38e6…`).
--   111-114  DIE LUECKE, DIE SIE SCHLIESST: das Archiv fuehrt heute weder
--            Menge noch Banner. Zeile 112 misst es am Rumpf.
--   121-126  WAS GESICHERT WERDEN MUSS: wie viele Zeilen eine Menge tragen
--            und wie viele ein Banner — das ist, was ohne diese Migration
--            bei einer Wiederherstellung fehlte.
--
-- SIE SCHREIBT NICHTS und ruft den Export nicht auf.
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
  (101, 'Grundlage', 'die drei Spalten aus 0163 stehen',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname in ('types', 'visible_type', 'visible_type_decided')
          and not a.attisdropped), '3'),
  (102, 'Grundlage', 'system_platform_export() steht (0105)',
      (to_regprocedure('public.system_platform_export()') is not null)::text,
      'true'),
  (103, 'Grundlage', 'DER ABDRUCK IST DER AUS 0160 — eine fremde Fassung wird '
                     'nicht ueberschrieben',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      'ff4f38e61cbd4e5857ea914d6be68d44'),
  (104, 'Grundlage', 'seine Laenge',
      (select coalesce(length(p.prosrc)::text, '-') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      '31114'),
  (105, 'Grundlage', 'und er fuehrt die Felder aus 0153 und 0160',
      (select coalesce(max((p.prosrc like '%''catalog_status'', t.catalog_status,%'
                        and p.prosrc like '%''base_sky_id'', t.base_sky_id,%')::text),
                       '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (106, 'Grundlage', 'format_version ist 2 und bleibt es',
      (select coalesce(max((p.prosrc like '%''format_version'', 2,%')::text),
                       '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),

  -- ------------------------------------------ Die Luecke, die sie schliesst
  /*
   * ZEILE 111 IST DER GRUND FUER DIESE MIGRATION. Der Rumpf nennt die drei
   * Spalten NICHT — ein Archiv von heute traegt die Typmenge also nicht, und
   * eine Wiederherstellung brachte jede Zeile ohne Types und ohne Banner
   * zurueck.
   */
  (111, 'Luecke', 'der Rumpf nennt types NOCH NICHT',
      (select coalesce(max((p.prosrc like '%''types'', t.types,%')::text),
                       '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'false'),
  (112, 'Luecke', 'und visible_type ebenso nicht',
      (select coalesce(max((p.prosrc like '%''visible_type'', t.visible_type,%')::text),
                       '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'false'),
  (113, 'Luecke', 'und visible_type_decided auch nicht',
      (select coalesce(max((p.prosrc like
                            '%''visible_type_decided'', t.visible_type_decided,%')::text),
                       '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'false'),

  -- ------------------------------------------- Was gesichert werden muss
  (121, 'Einsatz', 'Zeilen mit mindestens einem Type — sie waeren im Archiv '
                   'von heute nicht wiederzufinden',
      (select count(*)::text from public.skylanders where cardinality(types) > 0),
      null),
  (122, 'Einsatz', 'Zeilen mit einem Banner — dasselbe, und es ist aus nichts '
                   'ableitbar',
      (select count(*)::text from public.skylanders where visible_type is not null),
      null),
  (123, 'Einsatz', 'Zeilen mit ausdruecklichem „–" (entschieden, kein Banner) — '
                   'ohne das Kennzeichen waeren sie danach wieder unentschieden',
      (select count(*)::text from public.skylanders
        where visible_type is null and visible_type_decided), null),
  (124, 'Einsatz', 'Abdruck der Typmenge — die Nachkontrolle nennt ihn wieder',
      (select coalesce(md5(string_agg(sky_id || '|' || array_to_string(types, ',')
                                      || '|' || coalesce(visible_type, '-')
                                      || '|' || visible_type_decided::text,
                                      E'\n' order by sky_id)), '(leer)')
         from public.skylanders), null),
  (125, 'Einsatz', 'und der der Kartenkunst — 0164 fasst sie nicht an',
      (select coalesce(md5(string_agg(sky_id || '|' || card_type, E'\n'
                                      order by sky_id)), '(leer)')
         from public.skylanders), null),

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
