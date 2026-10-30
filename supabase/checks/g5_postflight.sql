-- ===========================================================================
-- PRODUCTION — DER ZUSTAND NACH DER GRUPPE 0163-0164 (G5'), REIN LESEND
--
-- NACH `supabase/operations/prod-g5-0163-0164.sql` fahren.
-- **Erwartet: Zeile 9999 = `0` UND Zeile 9998 = `0`.**
--
--   101-108  DIE DREI SPALTEN und die drei Riegel: `types` (text[], NOT
--            NULL, Vorgabe `{}`), `visible_type` (nullbar),
--            `visible_type_decided` (NOT NULL, Vorgabe false), die
--            Mitgliedschafts-CHECK, die Entschieden-CHECK, die
--            Bekannt-CHECK und der Trigger.
--   111-118  DIE ERSTBELEGUNG, gegen die Daten gerechnet: jede Zeile hat
--            eine Menge, jede Menge ist kanonisch (sortiert, ohne
--            Doppelte), jedes sichtbare Banner ist Mitglied seiner Menge,
--            jedes gesetzte Banner ist entschieden — und die LIGHTCORE-ZAHL
--            ist die, die die kuratierte Liste hergibt. **Keine Konstante:**
--            Zeile 114 zaehlt die Liste, Zeile 115 die belegten, Zeile 116
--            verlangt Gleichheit. Auf Staging 21, auf Production 20.
--   121-124  DIE KARTENKUNST IST UNVERAENDERT. Zeile 122 ist der Abdruck —
--            er muss Zeile 142 des Preflights ZEICHENGLEICH treffen. ADR-0160:
--            der Type ist eine Menge, `card_type` bleibt eine eigene Spalte,
--            und die Projektion ist nicht verlustfrei (bewiesen gegen 701
--            Zeilen in `cat10_projection_proof.sql`).
--   131-136  DIE VIER FUNKTIONEN: die zwei neuen einmal je, und
--            `admin_merge_plan` und `admin_merge_draft` ERSETZT und nicht
--            ueberladen — `admin_merge_draft` bleibt bei ZWEI Fassungen.
--   141-144  DIE RECHTE der vier.
--   151-154  DAS JOURNAL KENNT SECHZEHN WERTE (`types`, `visible_type` dazu).
--   161-167  DIE EXPORTFUNKTION aus `0164`: Abdruck `7e9e58e2…`, die drei
--            Felder im Rumpf, Formatversion UNVERAENDERT 2, 54 Bereiche.
--   171-176  UNBERUEHRT: Zeilenzahl, Sichtbarkeit, Status, Familien,
--            Zuordnungen, Journalzeilen, RLS.
--   801-833  DIE ZWEI VERTRAEGE gegen die Baselines aus dem Preflight.
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
basis_roh as (
  /*
   * DER PLATZHALTER ZAEHLT NICHT ALS BASELINE. Die Huelle bringt die
   * `set_config`-Zeile schon mit, damit niemand sie vergisst — und genau
   * deshalb muss ein NICHT ersetzter Platzhalter so behandelt werden wie
   * eine fehlende Zeile.
   */
  select nullif(nullif(btrim(coalesce(current_setting('skyisles.base', true), '')), ''),
                'BASIS-HIER-EINSETZEN') as roh
),
basis_teil as (
  select roh,
         case when roh is null then null else string_to_array(roh, '|') end as t
    from basis_roh
),
basis as (
  select roh, t,
         (t is not null and array_length(t, 1) = 9)                 as neun,
         (t is not null and t[1] = 'skyisles-base-1')               as marke,
         case when t is not null and array_length(t, 1) = 9
              then t[9] = left(md5(array_to_string(t[2:8], '|')), 12)
         end                                                        as schutz_ok,
         (t is not null and array_length(t, 1) = 9
          and t[1] = 'skyisles-base-1'
          and t[9] = left(md5(array_to_string(t[2:8], '|')), 12))   as gueltig
    from basis_teil
),
coll_mess as (
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
coll_roh as (
  select nullif(nullif(btrim(coalesce(current_setting('skyisles.coll', true), '')), ''),
                'SAMMLUNG-HIER-EINSETZEN') as roh
),
coll_teil as (
  /*
   * `k` UND NICHT `t`, UND DAS IST KEIN SCHOENHEITSWUNSCH.
   *
   * Der Basis-Vertrag oben legt seine Felder in `t` ab und entscheidet mit
   * `gueltig`. `staging-oneshot.test.ts` haelt fuer die ganze Familie fest,
   * dass GENAU SIEBEN Vergleiche ihren Sollwert aus `when gueltig then t[…]`
   * holen — so faellt auf, wenn einer davon heimlich aus der Messung kaeme.
   * Haette der zweite Vertrag dieselben Namen, waeren es zehn Treffer, und
   * der Waechter koennte die beiden nicht mehr trennen. Er schlug beim
   * ersten Lauf dieser Datei genau deshalb an und hatte recht damit.
   *
   * Zwei Vertraege, zwei Namen: `t`/`gueltig` fuer den Shop,
   * `k`/`coll_gueltig` fuer die Sammlung.
   */
  select roh,
         case when roh is null then null else string_to_array(roh, '|') end as k
    from coll_roh
),
coll as (
  select roh, k,
         (k is not null and k[1] = 'skyisles-coll-1')               as marke,
         case when k is not null and array_length(k, 1) = 5
              then k[5] = left(md5(array_to_string(k[2:4], '|')), 12)
         end                                                        as schutz_ok,
         (k is not null and array_length(k, 1) = 5
          and k[1] = 'skyisles-coll-1'
          and k[5] = left(md5(array_to_string(k[2:4], '|')), 12))   as coll_gueltig
    from coll_teil
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- --------------------------------------------- Die drei Spalten und Riegel
  (101, 'Spalten', 'skylanders.types steht und ist text[]',
      (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'types' and not a.attisdropped), 'text[]'),
  (102, 'Spalten', 'types ist NOT NULL',
      (select a.attnotnull::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'types' and not a.attisdropped), 'true'),
  (103, 'Spalten', 'visible_type steht und ist nullbar',
      (select (not a.attnotnull)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'visible_type' and not a.attisdropped), 'true'),
  (104, 'Spalten', 'visible_type_decided steht und ist NOT NULL',
      (select a.attnotnull::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'visible_type_decided' and not a.attisdropped), 'true'),
  (105, 'Spalten', 'CHECK skylanders_types_known steht',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_types_known'), '1'),
  (106, 'Spalten', 'CHECK skylanders_visible_type_member steht — das Banner ist Mitglied',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_visible_type_member'), '1'),
  (107, 'Spalten', 'CHECK skylanders_visible_type_decided steht',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_visible_type_decided'), '1'),
  (108, 'Spalten', 'der Trigger ist BEFORE INSERT OR UPDATE OF types, FOR EACH ROW',
      (select (t.tgtype & 2 > 0)::text || '|' || (t.tgtype & 1 > 0)::text
         from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_canonical_types'), 'true|true'),

  -- -------------------------------------------------------- Die Erstbelegung
  (111, 'Erstbelegung', 'jede Zeile hat eine Menge (keine ist NULL)',
      (select count(*)::text from public.skylanders where types is null), '0'),
  (112, 'Erstbelegung', 'jede Menge ist kanonisch — sortiert und ohne Doppelte',
      (select count(*)::text from public.skylanders s
        where s.types is distinct from coalesce(
          (select array_agg(t order by t) from (select distinct unnest(s.types) as t) x),
          '{}'::text[])), '0'),
  (113, 'Erstbelegung', 'jedes gesetzte Banner ist Mitglied seiner Menge',
      (select count(*)::text from public.skylanders
        where visible_type is not null and not (visible_type = any (types))), '0'),
  /*
   * DIE DREI ZEILEN, DIE OHNE JEDE KONSTANTE AUSKOMMEN. 114 zaehlt, wie
   * viele der 21 kuratierten LightCore-IDs dieser Katalog hat; 115 zaehlt
   * die belegten; 116 verlangt Gleichheit. Auf Staging sind beide 21, auf
   * Production beide 20 — und die Pruefung ist auf beiden exakt.
   */
  (114, 'Erstbelegung', 'Info: Zeilen, die die kuratierte LightCore-Liste trifft',
      (select count(*)::text from public.skylanders s, lightcore l
        where s.sky_id = any (l.liste)), null),
  (115, 'Erstbelegung', 'Info: Zeilen mit lightcore in der Menge',
      (select count(*)::text from public.skylanders where 'lightcore' = any (types)), null),
  (116, 'Erstbelegung', 'und die zwei Zahlen sind GLEICH — keine fest codierte Zahl',
      (select ((select count(*) from public.skylanders s, lightcore l
                 where s.sky_id = any (l.liste))
             = (select count(*) from public.skylanders where 'lightcore' = any (types)))::text),
      'true'),
  (117, 'Erstbelegung', 'kein lightcore ausserhalb der kuratierten Liste',
      (select count(*)::text from public.skylanders s
        where 'lightcore' = any (s.types)
          and not exists (select 1 from lightcore l where s.sky_id = any (l.liste))), '0'),
  (118, 'Erstbelegung', 'Info: Verteilung der Mengengroessen',
      (select string_agg(n::text || ' Type(s): ' || anzahl::text, ', ' order by n)
         from (select array_length(types, 1) as n, count(*) as anzahl
                 from public.skylanders group by 1) x), null),

  -- ------------------------------------------- Die Kartenkunst ist unberuehrt
  (121, 'Kartenkunst', 'Info: Verteilung von card_type (muss Zeile 141 des Preflights treffen)',
      (select string_agg(card_type || '=' || n::text, ', ' order by card_type)
         from (select card_type, count(*) as n from public.skylanders group by card_type) x), null),
  (122, 'Kartenkunst', 'ABDRUCK von card_type — muss Zeile 142 des Preflights ZEICHENGLEICH treffen',
      (select coalesce(md5(string_agg(sky_id || '|' || card_type, E'\n' order by sky_id)), '(leer)')
         from public.skylanders), null),
  (123, 'Kartenkunst', 'card_type ist weiter eine eigene Spalte und NOT NULL',
      (select a.attnotnull::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'card_type' and not a.attisdropped), 'true'),
  (124, 'Kartenkunst', 'keine Zeile hat card_type verloren',
      (select count(*)::text from public.skylanders where card_type is null), '0'),

  -- ------------------------------------------------------- Die vier Funktionen
  (131, 'Funktionen', 'admin_set_figure_types(text,text[]) steht (0163)',
      (to_regprocedure('public.admin_set_figure_types(text,text[])') is not null)::text, 'true'),
  (132, 'Funktionen', 'admin_set_visible_type(text,text) steht (0163)',
      (to_regprocedure('public.admin_set_visible_type(text,text)') is not null)::text, 'true'),
  (133, 'Funktionen', 'je GENAU EINE Fassung — keine Ueberladung',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname in ('admin_set_figure_types', 'admin_set_visible_type')), '2'),
  (134, 'Funktionen', 'admin_merge_plan ist ERSETZT und nennt types',
      (select (p.prosrc like '%types%')::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_plan(text,text,text)')), 'true'),
  (135, 'Funktionen', 'admin_merge_draft bleibt bei ZWEI Fassungen (3- und 4-armig)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_merge_draft'), '2'),
  (136, 'Funktionen', 'und die vierarmige nennt types',
      (select (p.prosrc like '%types%')::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),

  -- ------------------------------------------------------------- Die Rechte
  (141, 'Rechte', 'execute fuer authenticated bei den zwei neuen',
      (select count(*)::text from (values
         ('public.admin_set_figure_types(text,text[])'),
         ('public.admin_set_visible_type(text,text)')) v(sig)
        where has_function_privilege('authenticated', v.sig, 'execute')), '2'),
  (142, 'Rechte', 'und fuer anon bei keiner',
      (select count(*)::text from (values
         ('public.admin_set_figure_types(text,text[])'),
         ('public.admin_set_visible_type(text,text)')) v(sig)
        where has_function_privilege('anon', v.sig, 'execute')), '0'),
  (143, 'Rechte', 'und fuer PUBLIC bei keiner',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.admin_set_figure_types(text,text[])'),
                        to_regprocedure('public.admin_set_visible_type(text,text)'))
          and a.grantee = 0 and a.privilege_type = 'EXECUTE'), '0'),
  (144, 'Rechte', 'beide: security definer und search_path leer',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_figure_types(text,text[])'),
                        to_regprocedure('public.admin_set_visible_type(text,text)'))
          and p.prosecdef
          and (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
                where c like 'search\_path=%') = 1), '2'),

  -- ------------------------------------------- Das Journal kennt 16 Werte
  (151, 'Journal', 'sie nennt types (0163)',
      (select (pg_get_constraintdef(c.oid) like '%''types''%')::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (152, 'Journal', 'sie nennt visible_type (0163)',
      (select (pg_get_constraintdef(c.oid) like '%visible_type%')::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (153, 'Journal', 'und weiter die vierzehn von vorher',
      (select (pg_get_constraintdef(c.oid) like '%market_price%'
               and pg_get_constraintdef(c.oid) like '%deleted%'
               and pg_get_constraintdef(c.oid) like '%base_sky_id%'
               and pg_get_constraintdef(c.oid) like '%character_id%'
               and pg_get_constraintdef(c.oid) like '%catalog_status%'
               and pg_get_constraintdef(c.oid) like '%created%')::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (154, 'Journal', 'keine Journalzeile traegt ein Feld ausserhalb der sechzehn',
      (select count(*)::text from public.catalog_admin_changes
        where field not in ('catalog_visible', 'display_name_override', 'admin_note',
                            'catalog_group', 'image_override_path', 'card_type',
                            'created', 'catalog_status', 'merged_from', 'discarded',
                            'character_id', 'base_sky_id', 'market_price', 'deleted',
                            'types', 'visible_type')), '0'),

  -- ------------------------------------------- Die Exportfunktion (0164)
  (161, 'Export', 'Rumpfabdruck ist die Fassung aus 0164',
      (select md5(p.prosrc) from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      '7e9e58e2d84a9f8a7c660262aa21926b'),
  (162, 'Export', 'weiter 54 Bereiche',
      (select ((length(p.prosrc) - length(replace(p.prosrc, 'coalesce((', '')))
               / length('coalesce(('))::text
         from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')), '54'),
  (163, 'Export', 'das Feld types steht im Rumpf',
      (select (p.prosrc like '%t.types%')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (164, 'Export', 'das Feld visible_type steht im Rumpf',
      (select (p.prosrc like '%visible_type%')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (165, 'Export', 'und base_sky_id aus 0160 steht weiter darin',
      (select (p.prosrc like '%base_sky_id%')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (166, 'Export', 'die Formatversion ist UNVERAENDERT 2',
      (select (p.prosrc like '%''format_version'', 2,%')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (167, 'Export', 'definer, stable, eine leere search_path-Festlegung',
      (select (p.prosecdef and p.provolatile = 's'
               and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c
                     where c like 'search\_path=%'))::text
         from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),

  -- --------------------------------------------------------- Unberuehrt
  (171, 'Unberuehrt', 'Info: Katalogzeilen (muss Zeile 1 des Preflights treffen)',
      (select count(*)::text from public.skylanders), null),
  (172, 'Unberuehrt', 'Info: sichtbare Katalogzeilen',
      (select count(*)::text from public.skylanders where catalog_visible), null),
  (173, 'Unberuehrt', 'keine Zeile hat ihren Status verloren',
      (select count(*)::text from public.skylanders where catalog_status is null), '0'),
  (174, 'Unberuehrt', 'Info: Zeilen mit Familie und mit Basisfigur',
      (select count(*)::text from public.skylanders where character_id is not null)
      || ' / ' ||
      (select count(*)::text from public.skylanders where base_sky_id is not null), null),
  (175, 'Unberuehrt', 'Info: Journalzeilen (muss Zeile 2 des Preflights treffen)',
      (select count(*)::text from public.catalog_admin_changes), null),
  (176, 'Unberuehrt', 'RLS ist weiter aktiv, keine Politik liest types',
      (select (c.relrowsecurity and not exists (
                select 1 from pg_policy pol
                 where pol.polrelid = to_regclass('public.skylanders')
                   and pg_get_expr(pol.polqual, pol.polrelid) like '%types%'))::text
         from pg_class c where c.oid = to_regclass('public.skylanders')), 'true'),

  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

  (801, 'Basis', 'eine Shop-Baseline ist uebergeben worden',
      (select case when roh is null
                   then 'FEHLT (oder der Platzhalter steht noch drin): Zeile 900 des '
                        || 'Preflights in set_config(''skyisles.base'', ''…'', true) '
                        || 'einsetzen und MIT diesem SELECT zusammen ausfuehren'
                   else 'ja' end from basis), 'ja'),
  (802, 'Basis', 'sie traegt die Marke skyisles-base-1',
      (select coalesce(marke::text, 'keine Baseline') from basis), 'true'),
  (803, 'Basis', 'sie hat neun Felder',
      (select case when t is null then 'keine Baseline'
                   else array_length(t, 1)::text end from basis), '9'),
  (804, 'Basis', 'die Schutzsumme stimmt — kein Feld vertauscht, keine Stelle fort',
      (select coalesce(schutz_ok::text, 'nicht pruefbar') from basis), 'true'),

  (811, 'Shop', 'oeffentliche Angebote wie vor der Migration',
      (select angebote from basis_mess),
      (select case when gueltig then t[2] else '(keine gueltige Basis)' end from basis)),
  (812, 'Shop', 'Angebots-Abdruck wie vor der Migration',
      (select angebote_md5 from basis_mess),
      (select case when gueltig then t[3] else '(keine gueltige Basis)' end from basis)),
  (813, 'Shop', 'shopfaehige Katalogzeilen wie vor der Migration',
      (select shopfaehig from basis_mess),
      (select case when gueltig then t[4] else '(keine gueltige Basis)' end from basis)),
  (814, 'Shop', 'sammelbare Katalogzeilen wie vor der Migration',
      (select sammelbar from basis_mess),
      (select case when gueltig then t[5] else '(keine gueltige Basis)' end from basis)),
  (815, 'Shop', 'Lagerzeilen wie vor der Migration',
      (select lagerzeilen from basis_mess),
      (select case when gueltig then t[6] else '(keine gueltige Basis)' end from basis)),
  (816, 'Shop', 'Katalogzeilen wie vor der Migration',
      (select katalogzeilen from basis_mess),
      (select case when gueltig then t[7] else '(keine gueltige Basis)' end from basis)),
  (817, 'Shop', 'Lager-Abdruck wie vor der Migration',
      (select lager_md5 from basis_mess),
      (select case when gueltig then t[8] else '(keine gueltige Basis)' end from basis)),

  -- ============================ Die Sammlungs-Baseline aus dem Preflight
  /*
   * DIE ZUSAGE, DIE 0145 GIBT: die Wunschliste kommt DANEBEN, die Sammlung
   * bleibt, wie sie war. Diese sechs Zeilen sind die Messung dazu.
   */
  (821, 'Sammlung', 'eine Sammlungs-Baseline ist uebergeben worden',
      (select case when roh is null
                   then 'FEHLT (oder der Platzhalter steht noch drin): Zeile 901 des '
                        || 'Preflights in set_config(''skyisles.coll'', ''…'', true) '
                        || 'einsetzen und MIT diesem SELECT zusammen ausfuehren'
                   else 'ja' end from coll), 'ja'),
  (822, 'Sammlung', 'sie traegt die Marke skyisles-coll-1',
      (select coalesce(marke::text, 'keine Baseline') from coll), 'true'),
  (823, 'Sammlung', 'sie hat fuenf Felder',
      (select case when k is null then 'keine Baseline'
                   else array_length(k, 1)::text end from coll), '5'),
  (824, 'Sammlung', 'die Schutzsumme stimmt',
      (select coalesce(schutz_ok::text, 'nicht pruefbar') from coll), 'true'),

  (831, 'Sammlung', 'Sammlungszeilen wie vor der Migration',
      (select zeilen from coll_mess),
      (select case when coll_gueltig then k[2]
                   else '(keine gueltige Basis)' end from coll)),
  (832, 'Sammlung', 'Konten mit Sammlung wie vor der Migration',
      (select konten from coll_mess),
      (select case when coll_gueltig then k[3]
                   else '(keine gueltige Basis)' end from coll)),
  (833, 'Sammlung', 'Sammlungs-Abdruck wie vor der Migration — Inhalt UND Reihenfolge',
      (select sammlung_md5 from coll_mess),
      (select case when coll_gueltig then k[4]
                   else '(keine gueltige Basis)' end from coll)),

  -- ------------------------------------------------------------ Zum Nachlesen
  /*
   * DIE NUMMERN 818 UND 819 SIND DIE DER FAMILIE. `0142` bis `0144` fuehren
   * den heutigen Stand unter 819, und `staging-oneshot.test.ts` prueft das
   * fuer jede Datei des Basis-Vertrags. Eine eigene Nummerierung hier waere
   * eine zweite Ordnung fuer dieselbe Sache.
   */
  (818, 'Basis', 'Info: die uebergebene Baseline, wie sie gelesen wurde',
      (select coalesce(roh, '(keine)') from basis), null),
  (819, 'Basis', 'Info: der heutige Stand als Baseline-Zeile',
      (select zeile from basis_zeile), null),
  (828, 'Sammlung', 'Info: die uebergebene Sammlungs-Baseline, wie sie gelesen wurde',
      (select coalesce(roh, '(keine)') from coll), null),
  (829, 'Sammlung', 'Info: der heutige Sammlungsstand als Baseline-Zeile',
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
