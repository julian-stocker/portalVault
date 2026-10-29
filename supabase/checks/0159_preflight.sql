-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND VOR 0159, REIN LESEND
--
-- VOR `0159_variant_base_figure.sql` fahren. **Erwartet: Zeile 9999 = `0`.**
--
--   101-108  DIE GRUNDLAGE: `0158` muss stehen, denn `0159` benutzt
--            `admin_set_character` und `admin_create_character` und ERSETZT
--            den Rumpf von `admin_merge_references`.
--   111-116  WAS ES NOCH NICHT GIBT: die Spalte, die drei Riegel, der
--            Trigger, die zwei Funktionen, der zwoelfte Journalwert.
--   121-126  DER RUMPF VON `admin_merge_references`, WIE ER HEUTE IST — und
--            der Nachweis, dass er einen MEHRSPALTIGEN Fremdschluessel
--            ausdruecklich abweist. Das ist der Anlass fuer Abschnitt 4b:
--            `0159` legt genau so einen an, und ohne die Korrektur braeche
--            danach jede Zusammenfuehrung.
--   131-136  DER AUSGANGSZUSTAND: 0 Zuordnungen, und die Zahlen, gegen die
--            die Nachkontrolle vergleicht. `0159` ordnet nichts zu.
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
  (102, 'Grundlage', 'skylanders.character_id steht (0002)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'character_id' and not a.attisdropped), '1'),
  (103, 'Grundlage', 'admin_set_character(text,bigint) steht (0158)',
      (to_regprocedure('public.admin_set_character(text,bigint)') is not null)::text, 'true'),
  (104, 'Grundlage', 'admin_create_character(text) steht (0158)',
      (to_regprocedure('public.admin_create_character(text)') is not null)::text, 'true'),
  (105, 'Grundlage', 'admin_set_catalog_status(text,text) steht (0152) — Weg B benutzt sie',
      (to_regprocedure('public.admin_set_catalog_status(text,text)') is not null)::text, 'true'),
  (106, 'Grundlage', 'admin_merge_references(text) steht (0154) — 0159 ersetzt ihren Rumpf',
      (to_regprocedure('public.admin_merge_references(text)') is not null)::text, 'true'),
  (107, 'Grundlage', 'die Constraint ist die aus 0158 (kennt character_id)',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%character_id%')::text), '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (108, 'Grundlage', 'is_platform_admin() steht (0026/0077)',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),

  -- ---------------------------------------- Was es noch nicht gibt
  (111, 'Noch nicht da', 'skylanders.base_sky_id gibt es nicht',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'base_sky_id' and not a.attisdropped), '0'),
  (112, 'Noch nicht da', 'skylanders_base_same_series gibt es nicht',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_base_same_series'), '0'),
  (113, 'Noch nicht da', 'skylanders_id_series_uniq gibt es nicht',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_id_series_uniq'), '0'),
  (114, 'Noch nicht da', 'der Kettenriegel (Trigger) gibt es nicht',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_variant_base_guard_trg' and not t.tgisinternal), '0'),
  (115, 'Noch nicht da', 'admin_set_variant_base und admin_publish_with_base fehlen',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('admin_set_variant_base', 'admin_publish_with_base')), '0'),
  (116, 'Noch nicht da', 'die Constraint kennt base_sky_id NICHT (der zwoelfte Wert)',
      (select coalesce(max((pg_get_constraintdef(c.oid) not like '%base_sky_id%')::text),
                       '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),

  -- --------------------- Der Anlass fuer Abschnitt 4b (die Referenzzaehlung)
  /*
   * ZEILE 122 IST DER GRUND, WARUM `0159` EINEN FREMDEN RUMPF ERSETZT.
   * `admin_merge_references` nimmt heute blind `conkey[1]` und weist einen
   * mehrspaltigen Fremdschluessel ausdruecklich ab. `0159` legt genau so
   * einen an — ohne die Korrektur braeche danach JEDE Zusammenfuehrung und
   * JEDES Verwerfen. Gefunden hat das der Probelauf P67, vor dem SQL-Editor.
   */
  (121, 'Anlass', 'Info: der heutige Abdruck von admin_merge_references',
      (select coalesce(max(md5(p.prosrc)), '(keine)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_references(text)')), null),
  (122, 'Anlass', 'sie weist einen MEHRSPALTIGEN Fremdschluessel heute ab',
      (select coalesce(max((p.prosrc like '%mehrspaltigen Fremdschluessel%')::text),
                       '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_references(text)')), 'true'),
  (123, 'Anlass', 'und sie leitet die Spalte NICHT ueber confkey her',
      (select coalesce(max((p.prosrc not like '%confkey%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_references(text)')), 'true'),
  (124, 'Anlass', 'Fremdschluessel auf skylanders heute (alle einspaltig)',
      (select count(*)::text from pg_constraint c
        where c.confrelid = to_regclass('public.skylanders') and c.contype = 'f'), null),
  (125, 'Anlass', 'davon MEHRSPALTIG (muss heute 0 sein)',
      (select count(*)::text from pg_constraint c
        where c.confrelid = to_regclass('public.skylanders') and c.contype = 'f'
          and array_length(c.conkey, 1) <> 1), '0'),
  (126, 'Anlass', 'alle zeigen auf sky_id (keiner auf slug)',
      (select count(*)::text from pg_constraint c
        where c.confrelid = to_regclass('public.skylanders') and c.contype = 'f'
          and not exists (select 1 from generate_subscripts(c.confkey, 1) as g(i)
                           join pg_attribute a2
                             on a2.attrelid = c.confrelid and a2.attnum = c.confkey[g.i]
                          where a2.attname = 'sky_id')), '0'),

  -- --------------------------------- Der Ausgangszustand
  (131, 'Ausgangszustand', 'Katalogzeilen insgesamt',
      (select count(*)::text from public.skylanders), null),
  (132, 'Ausgangszustand', 'Zeilen MIT Familie',
      (select count(*)::text from public.skylanders where character_id is not null), null),
  (133, 'Ausgangszustand', 'Entwuerfe',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), null),
  (134, 'Ausgangszustand', 'Journalzeilen mit field = base_sky_id (muss 0 sein)',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.catalog_admin_changes where field = 'base_sky_id'$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, '0'),
  (135, 'Ausgangszustand', 'Serien mit aktiven Zeilen',
      (select count(distinct series_code)::text from public.skylanders
        where is_active), null),
  (136, 'Ausgangszustand', 'Info: sky_id ist Primaerschluessel (traegt die Eindeutigkeit)',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders') and c.contype = 'p'), '1'),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0159 ruehrt das nicht an)',
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
