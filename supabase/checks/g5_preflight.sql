-- ===========================================================================
-- PRODUCTION — DER ZUSTAND VOR DER GRUPPE 0163-0164 (G5'), REIN LESEND
--
-- VOR `supabase/operations/prod-g5-0163-0164.sql` fahren.
-- **Erwartet: Zeile 9999 = `0` UND Zeile 9998 = `0`.**
--
-- DIESE GRUPPE IST DIE ZWEITE, DIE IN JEDE KATALOGZEILE SCHREIBT (nach
-- `0152`). `0163` legt drei Spalten an und belegt sie in VIER Anweisungen
-- erstmalig; `0164` nimmt sie in die Plattformsicherung auf. Deshalb messen
-- Preflight und Nachkontrolle hier mehr als sonst.
--
-- *** KEINE FEST CODIERTE ZAHL AUS STAGING ***
--
-- Auf Staging wurden 21 LightCore-Figuren belegt, auf Production werden es
-- 20 — und das ist kein Fehler, sondern Rechnen: `0163` traegt eine
-- KURATIERTE Liste von 21 SKY-IDs, und `SKY-0854` existiert auf Production
-- nicht (sie gehoert zu den Staging-Katalogarbeiten, Nachweis
-- `resources/analysis/prod-ab-0821.csv`). Die Migration belegt mit
-- `= any (liste)`, trifft also genau die vorhandenen.
--
-- DESHALB STEHT HIER KEINE 21 UND KEINE 20, sondern die LISTE: Zeile 151
-- zaehlt, wie viele ihrer IDs der Katalog wirklich hat. Die Nachkontrolle
-- rechnet dieselbe Zahl noch einmal und vergleicht sie mit den belegten —
-- eine BEZIEHUNG, keine Konstante. Auf beiden Umgebungen exakt.
--
--   101-110  DIE GRUNDLAGE: `card_type` (`0030`), `catalog_group`
--            (`0040`), `catalog_status` (`0152`), `is_platform_admin`, und
--            der Exportrumpf ist der aus `0160`.
--   111-118  DIE ACHT ABWESENHEITEN: die drei Spalten, die drei CHECKs, der
--            Trigger und die zwei neuen Funktionen.
--   121-124  DIE ZWEI RUEMPFE, DIE 0163 ERSETZT, mit ihren Abdruecken aus
--            `0157`. `0163` traegt dieses Tor selbst; hier faellt es VOR der
--            Transaktion auf.
--   131-134  DAS JOURNAL: vierzehn Werte, `types` und `visible_type` noch
--            nicht, und keine Zeile ausserhalb der sechzehn.
--   141-148  DIE KARTENKUNST, die unberuehrt bleiben MUSS: Verteilung und
--            Abdruck von `card_type`. ADR-0160 haelt fest, dass der Type
--            eine MENGE ist und die Kartenkunst eine eigene Spalte bleibt;
--            `cat10_projection_proof.sql` hat gegen 701 Zeilen bewiesen,
--            dass die Projektion nicht verlustfrei ist.
--   151-156  DIE ERSTBELEGUNG, VORAUSBERECHNET: wie viele Zeilen die
--            kuratierte LightCore-Liste trifft, wie viele eine Gruppe
--            tragen, wie viele `card_type <> 'standard'` haben.
--   161-163  TRIGGER UND RIEGEL, benannt. Die Gruppe legt EINEN Trigger und
--            DREI Riegel an.
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

with lightcore (liste) as (values (array[
    'SKY-0129', 'SKY-0130', 'SKY-0140', 'SKY-0143', 'SKY-0146',
    'SKY-0157', 'SKY-0159', 'SKY-0166', 'SKY-0171', 'SKY-0172',
    'SKY-0243', 'SKY-0246', 'SKY-0251', 'SKY-0252', 'SKY-0263',
    'SKY-0265', 'SKY-0266', 'SKY-0294', 'SKY-0295', 'SKY-0296',
    'SKY-0854'])),
sammelbar as (
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

  -- ------------------------------------------------------------ Die Grundlage
  (101, 'Grundlage', 'skylanders.card_type steht (0030) — die KARTENKUNST, sie bleibt',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'card_type' and not a.attisdropped), '1'),
  (102, 'Grundlage', 'categories.catalog_group steht (0040) — 0163 leitet daraus ab',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.categories')
          and a.attname = 'catalog_group' and not a.attisdropped), '1'),
  (103, 'Grundlage', 'skylanders.catalog_status steht (0152)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), '1'),
  (104, 'Grundlage', 'skylanders.base_sky_id steht (0159)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'base_sky_id' and not a.attisdropped), '1'),
  (105, 'Grundlage', 'is_platform_admin() steht (0026/0077)',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  (106, 'Grundlage', 'system_platform_export(): genau EINE Fassung',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'system_platform_export'), '1'),
  (107, 'Grundlage', 'und ihr Rumpf ist der aus 0160 — 0164 setzt ihn voraus',
      (select md5(p.prosrc) from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      'ff4f38e61cbd4e5857ea914d6be68d44'),
  (108, 'Grundlage', 'admin_set_figure_types und admin_set_visible_type sind die, die 0163 anlegt',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname in ('admin_set_figure_types', 'admin_set_visible_type')), '0'),
  (109, 'Grundlage', 'admin_merge_plan(text,text,text) steht (0156/0157)',
      (to_regprocedure('public.admin_merge_plan(text,text,text)') is not null)::text, 'true'),
  (110, 'Grundlage', 'admin_merge_draft: genau ZWEI Fassungen (3- und 4-armig)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_merge_draft'), '2'),

  -- -------------------------------------------- Die acht Abwesenheiten
  (111, 'Noch nicht da', 'skylanders.types fehlt noch (0163)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'types' and not a.attisdropped), '0'),
  (112, 'Noch nicht da', 'skylanders.visible_type fehlt noch (0163)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'visible_type' and not a.attisdropped), '0'),
  (113, 'Noch nicht da', 'skylanders.visible_type_decided fehlt noch (0163)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'visible_type_decided' and not a.attisdropped), '0'),
  (114, 'Noch nicht da', 'die drei CHECKs aus 0163 fehlen noch',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname in ('skylanders_types_known', 'skylanders_visible_type_member',
                            'skylanders_visible_type_decided')), '0'),
  (115, 'Noch nicht da', 'der Trigger skylanders_canonical_types fehlt noch',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_canonical_types'), '0'),
  (116, 'Noch nicht da', 'admin_set_figure_types fehlt noch',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_set_figure_types'), '0'),
  (117, 'Noch nicht da', 'admin_set_visible_type fehlt noch',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_set_visible_type'), '0'),
  (118, 'Noch nicht da', 'der Exportrumpf ist NICHT schon der aus 0164',
      (select (md5(p.prosrc) <> '7e9e58e2d84a9f8a7c660262aa21926b')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),

  -- --------------------------- Die zwei Ruempfe, die 0163 ersetzt
  /*
   * `0163` traegt dieses Tor selbst und bricht ab, wenn die Abdruecke nicht
   * stimmen. Hier stehen sie noch einmal, weil ein Abbruch mitten in der
   * Gruppe die Erstbelegung mit zurueckrollt — teuer, wenn auch sicher.
   */
  (121, 'Ruempfe', 'admin_merge_plan traegt den Abdruck aus 0157',
      (select md5(p.prosrc) from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_plan(text,text,text)')),
      'ef512e9ea093ae36926d3f0333bd0622'),
  (122, 'Ruempfe', 'admin_merge_draft(…,jsonb) traegt den Abdruck aus 0157',
      (select md5(p.prosrc) from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')),
      '0b724dff0bb0fe535e3e5b9ec3573298'),
  (123, 'Ruempfe', 'keiner der zwei nennt types schon',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_merge_plan(text,text,text)'),
                        to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
          and p.prosrc like '%types%'), '0'),
  (124, 'Ruempfe', 'admin_merge_references ist die Fassung aus 0159',
      (select (p.prosrc like '%confkey%')::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_references(text)')), 'true'),

  -- ----------------------------------------- Das Journal VOR der Gruppe
  (131, 'Journal', 'sie nennt market_price und deleted (0162)',
      (select (pg_get_constraintdef(c.oid) like '%market_price%'
               and pg_get_constraintdef(c.oid) like '%deleted%')::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (132, 'Journal', 'sie nennt types NOCH NICHT (0163)',
      (select (pg_get_constraintdef(c.oid) like '%types%')::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'false'),
  (133, 'Journal', 'sie nennt visible_type NOCH NICHT (0163)',
      (select (pg_get_constraintdef(c.oid) like '%visible_type%')::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'false'),
  (134, 'Journal', 'keine Journalzeile traegt ein Feld ausserhalb der sechzehn',
      (select count(*)::text from public.catalog_admin_changes
        where field not in ('catalog_visible', 'display_name_override', 'admin_note',
                            'catalog_group', 'image_override_path', 'card_type',
                            'created', 'catalog_status', 'merged_from', 'discarded',
                            'character_id', 'base_sky_id', 'market_price', 'deleted',
                            'types', 'visible_type')), '0'),

  -- -------------------------------------- Die Kartenkunst, die bleibt
  (141, 'Kartenkunst', 'Info: Verteilung von card_type',
      (select string_agg(card_type || '=' || n::text, ', ' order by card_type)
         from (select card_type, count(*) as n from public.skylanders group by card_type) x), null),
  (142, 'Kartenkunst', 'Info: ABDRUCK von card_type — die Nachkontrolle nennt ihn wieder',
      (select coalesce(md5(string_agg(sky_id || '|' || card_type, E'\n' order by sky_id)), '(leer)')
         from public.skylanders), null),
  (143, 'Kartenkunst', 'Info: Zeilen mit card_type <> standard',
      (select count(*)::text from public.skylanders where card_type <> 'standard'), null),

  -- ------------------------------------ Die Erstbelegung, vorausberechnet
  /*
   * ZEILE 151 IST DIE ZAHL, DIE NACH DER MIGRATION WIEDERKOMMEN MUSS — und
   * sie ist GERECHNET, nicht abgeschrieben: wie viele der 21 kuratierten
   * LightCore-IDs dieser Katalog wirklich hat. Auf Staging 21, auf
   * Production 20 (SKY-0854 fehlt dort). Die Nachkontrolle rechnet sie noch
   * einmal und vergleicht sie mit den belegten.
   */
  (151, 'Erstbelegung', 'Info: Zeilen, die die kuratierte LightCore-Liste trifft',
      (select count(*)::text from public.skylanders s, lightcore l
        where s.sky_id = any (l.liste)), null),
  (152, 'Erstbelegung', 'Info: Laenge der kuratierten Liste (Staging trifft alle, Production eine weniger)',
      (select array_length(liste, 1)::text from lightcore), null),
  (153, 'Erstbelegung', 'Info: Zeilen, deren Kategorie eine Gruppe traegt',
      (select count(*)::text from public.skylanders s
        join public.categories c on c.id = s.category_id
       where c.catalog_group is not null), null),
  (154, 'Erstbelegung', 'Info: Zeilen mit card_type = special (LightCore-Kandidaten)',
      (select count(*)::text from public.skylanders where card_type = 'special'), null),
  (155, 'Erstbelegung', 'Info: Zeilen mit catalog_status = draft',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), null),
  (156, 'Erstbelegung', 'RLS ist an skylanders aktiv',
      (select c.relrowsecurity::text from pg_class c
        where c.oid = to_regclass('public.skylanders')), 'true'),

  -- --------------------------------------- Trigger und Riegel, benannt
  (161, 'Inventar', 'Info: Trigger an skylanders — die Gruppe legt EINEN an',
      (select coalesce(string_agg(t.tgname, ', ' order by t.tgname), '(keine)')
         from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal), null),
  (162, 'Inventar', 'Info: Riegel an skylanders — die Gruppe legt DREI an',
      (select coalesce(string_agg(c.conname, ', ' order by c.conname), '(keine)')
         from pg_constraint c where c.conrelid = to_regclass('public.skylanders')
          and c.contype in ('c', 'f', 'u', 'p')), null),
  (163, 'Inventar', 'der Kettenriegel aus 0159 steht',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_variant_base_guard_trg'), '1'),

  -- ------------------------------------------- Shop, Lager und Sammlung
  (301, 'Shop', 'Info: oeffentliche Angebote', (select angebote from basis_mess), null),
  (302, 'Shop', 'Info: shopfaehige Katalogzeilen', (select shopfaehig from basis_mess), null),
  (303, 'Shop', 'Info: sammelbare Katalogzeilen', (select sammelbar from basis_mess), null),
  (304, 'Shop', 'Info: Lagerzeilen', (select lagerzeilen from basis_mess), null),
  (305, 'Shop', 'Info: Sammlungszeilen', (select zeilen from coll_mess), null),
  (306, 'Shop', 'Info: Konten mit Sammlung', (select konten from coll_mess), null),
  (307, 'Shop', 'Info: Zeilen in catalog_editorial',
      (select count(*)::text from public.catalog_editorial), null),

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
