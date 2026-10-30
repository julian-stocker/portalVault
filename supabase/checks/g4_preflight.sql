-- ===========================================================================
-- PRODUCTION — DER ZUSTAND VOR DER GRUPPE 0160-0162 (G4'), REIN LESEND
--
-- VOR `supabase/operations/prod-g4-0160-0162.sql` fahren.
-- **Erwartet: Zeile 9999 = `0` UND Zeile 9998 = `0`.**
--
-- WARUM EIN EIGENES BLATT UND NICHT DIE DREI EINZELNEN. Dieselbe Lage wie
-- bei G2' (ADR-0161): auf Production laufen `0160`, `0161` und `0162` als
-- EINE Transaktion, also gibt es die zwei Zwischenzustaende dort nie.
-- `0161_preflight.sql` verlangt den Exportrumpf aus `0160`, und
-- `0162_preflight.sql` verlangt die Journal-Constraint, die `0162` selbst
-- erst baut. Zwei der drei Dateien wuerden hier zu Recht rot melden.
--
-- WAS DIE GRUPPE TUT — UND WAS SIE NICHT TUT
--
-- Sie schreibt **keine einzige Datenzeile**: kein `insert`, kein `update`,
-- kein `delete` ausserhalb von Funktionsruempfen (mechanisch geprueft). Sie
-- ersetzt EINEN Funktionsrumpf (`system_platform_export`), legt DREI
-- Funktionen an und baut die Journal-Constraint einmal neu. Keinen Trigger,
-- keine Spalte, keinen Index, keine Politik.
--
--   101-112  DIE GRUNDLAGE: `base_sky_id` und die zwei Funktionen aus
--            `0159`, die `0161` benutzt; `admin_set_character` und
--            `admin_create_character` aus `0158`; `admin_set_catalog_status`
--            aus `0152`; `admin_merge_references` aus `0159` (die berichtigte
--            Fassung — `0162` zaehlt mit ihr die Verweise); `order_lines`
--            (`0010`), die einzige SKY-ID-Spalte ohne Fremdschluessel;
--            `characters_canonical_name_key`; `is_platform_admin`.
--   121-126  DIE DREI ABWESENHEITEN: `admin_publish_variant_auto`,
--            `admin_set_market_price`, `admin_delete_figure` — und der
--            Exportrumpf ist der aus `0153`, nicht schon der aus `0160`.
--   131-136  DAS JOURNAL VOR DER GRUPPE: zwoelf Werte, `base_sky_id` ist
--            dabei (`0159`), `market_price` und `deleted` noch nicht.
--   141-147  DER EXPORTRUMPF, wie `0160` ihn vorfinden MUSS: Abdruck
--            `92c48444…` (die Fassung aus `0153`), 54 Bereiche, definer,
--            stable, genau eine leere search_path-Festlegung, Formatversion 2.
--   151-158  DER AUSGANGSZUSTAND, als Auskunft und als Vergleichsgrundlage:
--            Katalogzeilen, Sichtbarkeit, Familien, **Zuordnungen von
--            Basisfiguren** und die Ketten-, Serien- und Selbstbezugsproben
--            auf den echten Daten. Zeile 154 ist der Betriebshinweis: bis
--            `0160` liegt, soll keine Zuordnung bestehen — gezaehlt wird
--            sie, verlangt wird sie nicht.
--   161-163  TRIGGER UND RIEGEL an `skylanders`, benannt und nicht gezaehlt.
--            Die Gruppe legt KEINEN Trigger an; die Nachkontrolle vergleicht
--            dieselbe Liste.
--   301-307  SHOP, LAGER UND SAMMLUNG, als Auskunft.
--   900/901  DIE ZWEI BASELINES fuer die Nachkontrolle.
--
-- DIE FELDFOLGE BEIDER VERTRAEGE, AUSGESCHRIEBEN — eine vertauschte Zeile
-- waere eine stille Fehlinformation, weil nach POSITION verglichen wird:
--
-- DER BASIS-VERTRAG — sieben Geschaeftszahlen, eine Zeile, feste Reihenfolge
--
--   skyisles-base-1|angebote|angebote_md5|shopfaehig|sammelbar|lagerzeilen|
--   katalogzeilen|lager_md5|schutz
--
--   1  skyisles-base-1   die Marke. Eine fremde Zeile faellt daran auf
--   2  angebote          count(*) ueber shop_offers()
--   3  angebote_md5      md5 ueber sky_id|condition|price, sortiert
--   4  shopfaehig        count(*) mit is_shop_eligible()
--   5  sammelbar         der Fortschrittsnenner
--   6  lagerzeilen       count(*) ueber shop_inventory
--   7  katalogzeilen     count(*) ueber skylanders
--   8  lager_md5         md5 ueber id|is_listed|sale_price|sale_released
--   9  schutz            left(md5(Felder 2-8, mit | verbunden), 12)
--
-- DER SAMMLUNGS-VERTRAG — fuenf Felder
--
--   skyisles-coll-1|zeilen|konten|sammlung_md5|schutz
--
--   1  skyisles-coll-1   die Marke
--   2  zeilen            count(*) ueber collection_items
--   3  konten            count(distinct user_id)
--   4  sammlung_md5      md5 ueber user_id|sky_id|quantity, sortiert
--   5  schutz            left(md5(Felder 2-4, mit | verbunden), 12)
--
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
  (2, 'Umgebung', 'Info: Journalzeilen in catalog_admin_changes',
      (select count(*)::text from public.catalog_admin_changes), null),

  -- ------------------------------- Die Grundlage, benannt und nicht gezaehlt
  (101, 'Grundlage', 'skylanders.base_sky_id steht (0159) — 0160 nimmt sie in den Export',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'base_sky_id' and not a.attisdropped), '1'),
  (102, 'Grundlage', 'admin_set_variant_base(text,text,boolean) steht (0159) — 0161 ruft sie',
      (to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is not null)::text, 'true'),
  (103, 'Grundlage', 'admin_publish_with_base(text,text,boolean) steht (0159)',
      (to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is not null)::text, 'true'),
  (104, 'Grundlage', 'admin_set_character(text,bigint) steht (0158) — 0161 ruft sie',
      (to_regprocedure('public.admin_set_character(text,bigint)') is not null)::text, 'true'),
  (105, 'Grundlage', 'admin_create_character(text) steht (0158)',
      (to_regprocedure('public.admin_create_character(text)') is not null)::text, 'true'),
  (106, 'Grundlage', 'admin_set_catalog_status(text,text) steht (0152)',
      (to_regprocedure('public.admin_set_catalog_status(text,text)') is not null)::text, 'true'),
  /*
   * ZEILE 107 UND 108 GEHOEREN ZUSAMMEN. `0162` zaehlt mit
   * `admin_merge_references`, was auf eine Zeile zeigt — und sie muss die
   * BERICHTIGTE Fassung aus `0159` sein, die mehrspaltig zaehlt. Die alte
   * aus `0154` wies einen mehrspaltigen Schluessel ab, und seit `0159` gibt
   * es einen.
   */
  (107, 'Grundlage', 'admin_merge_references(text) steht — genau eine Fassung',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_merge_references'), '1'),
  (108, 'Grundlage', 'und es ist die Fassung aus 0159 (zaehlt mehrspaltig ueber confkey)',
      (select (p.prosrc like '%confkey%'
               and p.prosrc not like '%mehrspaltigen Fremdschluessel%')::text
         from pg_proc p where p.oid = to_regprocedure('public.admin_merge_references(text)')),
      'true'),
  (109, 'Grundlage', 'order_lines steht (0010) — 0162 fragt sie eigens, sie hat keinen Fremdschluessel',
      (to_regclass('public.order_lines') is not null)::text, 'true'),
  (110, 'Grundlage', 'characters_canonical_name_key steht (0002) — 0161 braucht den Dublettenschutz',
      (select count(*)::text from pg_class c
        where c.relname = 'characters_canonical_name_key' and c.relkind = 'i'), '1'),
  (111, 'Grundlage', 'is_platform_admin() steht (0026/0077)',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  (112, 'Grundlage', 'system_platform_export(): genau EINE Fassung',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'system_platform_export'), '1'),

  -- ------------------------------------------- Die drei Abwesenheiten
  (121, 'Noch nicht da', 'admin_publish_variant_auto fehlt noch (0161)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_publish_variant_auto'), '0'),
  (122, 'Noch nicht da', 'admin_set_market_price fehlt noch (0162)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_set_market_price'), '0'),
  (123, 'Noch nicht da', 'admin_delete_figure fehlt noch (0162)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_delete_figure'), '0'),
  (124, 'Noch nicht da', 'der Exportrumpf ist NICHT schon der aus 0160',
      (select (md5(p.prosrc) <> 'ff4f38e61cbd4e5857ea914d6be68d44')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (125, 'Noch nicht da', 'und auch nicht der aus 0164',
      (select (md5(p.prosrc) <> '7e9e58e2d84a9f8a7c660262aa21926b')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (126, 'Noch nicht da', 'skylanders.types fehlt noch (das ist 0163, nicht diese Gruppe)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'types' and not a.attisdropped), '0'),

  -- ----------------------------------------- Das Journal VOR der Gruppe
  (131, 'Journal', 'catalog_admin_changes_field_known steht',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), '1'),
  (132, 'Journal', 'sie nennt base_sky_id (0159)',
      (select (pg_get_constraintdef(c.oid) like '%base_sky_id%')::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (133, 'Journal', 'sie nennt market_price NOCH NICHT (0162)',
      (select (pg_get_constraintdef(c.oid) like '%market_price%')::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'false'),
  (134, 'Journal', 'sie nennt deleted NOCH NICHT (0162)',
      (select (pg_get_constraintdef(c.oid) like '%deleted%')::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'false'),
  /*
   * ZEILE 135 IST DIE LEHRE AUS 0152, zum vierten Mal: `0162` baut die
   * Constraint mit `add constraint` OHNE `not valid` neu, die bestehenden
   * Zeilen werden mitgeprueft. Traegt heute eine Zeile ein Feld ausserhalb
   * der vierzehn, scheitert die Gruppe mitten in `0162` und rollt `0160` und
   * `0161` mit zurueck. Hier faellt es vorher auf.
   */
  (135, 'Journal', 'keine Journalzeile traegt ein Feld ausserhalb der vierzehn',
      (select count(*)::text from public.catalog_admin_changes
        where field not in ('catalog_visible', 'display_name_override', 'admin_note',
                            'catalog_group', 'image_override_path', 'card_type',
                            'created', 'catalog_status', 'merged_from', 'discarded',
                            'character_id', 'base_sky_id', 'market_price', 'deleted')), '0'),
  (136, 'Journal', 'Info: welche Feldnamen im Journal wirklich vorkommen',
      (select coalesce(string_agg(distinct field, ', ' order by field), '(keine Zeilen)')
         from public.catalog_admin_changes), null),

  -- -------------------------- Die Exportfunktion, wie 0160 sie vorfinden MUSS
  (141, 'Export', 'Rumpfabdruck ist die Fassung aus 0153',
      (select md5(p.prosrc) from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      '92c48444f99b9e294f9703d0c0ddeaa8'),
  (142, 'Export', '54 Bereiche — 0160 fuegt ein FELD hinzu, keinen Bereich',
      (select ((length(p.prosrc) - length(replace(p.prosrc, 'coalesce((', '')))
               / length('coalesce(('))::text
         from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')),
      '54'),
  (143, 'Export', 'security definer',
      (select p.prosecdef::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (144, 'Export', 'volatility stable',
      (select p.provolatile::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 's'),
  (145, 'Export', 'genau EINE search_path-Festlegung, und ihr Wert ist LEER',
      (select (count(*) = 1 and btrim(min(substring(c from 'search\_path=(.*)$')), '"') = '')::text
         from pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
        where p.oid = to_regprocedure('public.system_platform_export()')
          and c like 'search\_path=%'), 'true'),
  (146, 'Export', 'Formatversion 2',
      (select (p.prosrc like '%''format_version'', 2,%')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (147, 'Export', 'das Feld base_sky_id steht NOCH NICHT im Rumpf',
      (select (p.prosrc like '%base_sky_id%')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'false'),

  -- ------------------------------------------------- Der Ausgangszustand
  (151, 'Daten', 'Info: Katalogzeilen insgesamt',
      (select count(*)::text from public.skylanders), null),
  (152, 'Daten', 'Info: sichtbare Katalogzeilen',
      (select count(*)::text from public.skylanders where catalog_visible), null),
  (153, 'Daten', 'Info: Zeilen mit einer Familie (character_id)',
      (select count(*)::text from public.skylanders where character_id is not null), null),
  /*
   * ZEILE 154 IST DER BETRIEBSHINWEIS, UND SIE BLOCKIERT NICHT. Bis `0160`
   * liegt, fuehrt die Plattformsicherung `base_sky_id` nicht — eine
   * Zuordnung waere in einem Archiv nicht enthalten. Nach G3' soll deshalb
   * keine bestehen. GEZAEHLT wird sie hier, VERLANGT wird sie nicht: `0160`
   * fasst Zuordnungen nicht an, und die Huelle prueft, dass sich die Zahl
   * nicht bewegt. Steht hier etwas anderes als 0, ist das eine Frage an den
   * Bediener und kein Hindernis.
   */
  (154, 'Daten', 'Info: Zeilen mit einer Basisfigur (nach G3'' erwartet 0 — siehe Kopf)',
      (select count(*)::text from public.skylanders where base_sky_id is not null), null),
  (155, 'Daten', 'Ketten (eine Variante als Basisfigur) — muss 0 sein',
      (select count(*)::text from public.skylanders v
        join public.skylanders b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.base_sky_id is not null), '0'),
  (156, 'Daten', 'Zuordnungen ueber Seriengrenzen — muss 0 sein',
      (select count(*)::text from public.skylanders v
        join public.skylanders b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.series_code <> v.series_code), '0'),
  (157, 'Daten', 'Selbstbezuege — muss 0 sein',
      (select count(*)::text from public.skylanders where base_sky_id = sky_id), '0'),
  (158, 'Daten', 'RLS ist an skylanders aktiv',
      (select c.relrowsecurity::text from pg_class c
        where c.oid = to_regclass('public.skylanders')), 'true'),

  -- --------------------------------------- Trigger und Riegel, benannt
  (161, 'Inventar', 'Info: Trigger an skylanders — die Gruppe legt KEINEN an',
      (select coalesce(string_agg(t.tgname, ', ' order by t.tgname), '(keine)')
         from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal), null),
  (162, 'Inventar', 'Info: Riegel an skylanders — die Gruppe legt KEINEN an',
      (select coalesce(string_agg(c.conname, ', ' order by c.conname), '(keine)')
         from pg_constraint c where c.conrelid = to_regclass('public.skylanders')), null),
  (163, 'Inventar', 'der Kettenriegel aus 0159 steht',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_variant_base_guard_trg'), '1'),

  -- ------------------------------------------- Shop, Lager und Sammlung
  (301, 'Shop', 'Info: oeffentliche Angebote',
      (select angebote from basis_mess), null),
  (302, 'Shop', 'Info: shopfaehige Katalogzeilen',
      (select shopfaehig from basis_mess), null),
  (303, 'Shop', 'Info: sammelbare Katalogzeilen (Fortschrittsnenner)',
      (select sammelbar from basis_mess), null),
  (304, 'Shop', 'Info: Lagerzeilen',
      (select lagerzeilen from basis_mess), null),
  (305, 'Shop', 'Info: Sammlungszeilen',
      (select zeilen from coll_mess), null),
  (306, 'Shop', 'Info: Konten mit Sammlung',
      (select konten from coll_mess), null),
  (307, 'Shop', 'Info: Zeilen in catalog_editorial',
      (select count(*)::text from public.catalog_editorial), null),

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
