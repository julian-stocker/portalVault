-- ===========================================================================
-- PRODUCTION — DER ZUSTAND NACH DER GRUPPE 0160-0162 (G4'), REIN LESEND
--
-- NACH `supabase/operations/prod-g4-0160-0162.sql` fahren.
-- **Erwartet: Zeile 9999 = `0` UND Zeile 9998 = `0`.**
--
--   101-107  DIE EXPORTFUNKTION aus `0160`: Abdruck `ff4f38e6…`, weiter 54
--            Bereiche, `base_sky_id` im Rumpf, Formatversion UNVERAENDERT 2,
--            definer, stable, eine leere search_path-Festlegung.
--   111-116  DIE DREI NEUEN FUNKTIONEN, je genau einmal und mit ihrer
--            Signatur — und keine zusaetzliche Ueberladung.
--   121-124  DIE RECHTE: `authenticated` ja, `anon` und PUBLIC nein, bei
--            allen drei; dazu `search_path` leer und definer.
--   131-134  DAS JOURNAL KENNT VIERZEHN WERTE: die zwoelf von vorher plus
--            `market_price` und `deleted`. Zeile 133 ist die Lehre aus
--            `0152`: wer eine Spalte journalisiert, muss ihren Namen in die
--            Liste aufnehmen, sonst scheitert jede Aenderung mit `23514`.
--   141-149  UNBERUEHRT UND UNVERAENDERT: Zeilenzahl, Sichtbarkeit,
--            Familien, Zuordnungen, Ketten, Trigger- und Riegelliste. Die
--            Gruppe schreibt KEINE Datenzeile, also muss hier alles stehen
--            wie im Preflight.
--   151-156  DIE BESTEHENDEN FUNKTIONEN aus `0152` bis `0159` stehen noch —
--            keine ist durch eine Ueberladung ersetzt worden.
--   801-833  DIE ZWEI VERTRAEGE gegen die Baselines aus dem Preflight.
--
-- BLEIBT EIN PLATZHALTER STEHEN, LAEUFT DIESE DATEI NICHT DURCH: die Huelle
-- der Nachkontrolle bricht vorher ab (ABBRUCH B2a bis B2h), und die Zeilen
-- 801 bis 804 bzw. 821 bis 824 sind die zweite Lage.
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
neu (nr, sig, kurz) as (values
  (201, 'public.admin_publish_variant_auto(text,text)', 'admin_publish_variant_auto'),
  (202, 'public.admin_set_market_price(text,numeric)', 'admin_set_market_price'),
  (203, 'public.admin_delete_figure(text)', 'admin_delete_figure')
),
neu_mess as (
  select n.*, to_regprocedure(n.sig) as oid,
         (select count(*) from pg_proc p
           where p.pronamespace = to_regnamespace('public') and p.proname = n.kurz) as fassungen
    from neu n
),
neu_detail as (
  select m.*, p.prosecdef,
         (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%')                         as pfadanzahl,
         (select btrim(substring(c from 'search\_path=(.*)$'), '"')
            from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%')                         as pfadwert,
         (select count(*) from aclexplode(p.proacl) a
           where a.grantee = 0 and a.privilege_type = 'EXECUTE')  as fuer_public
    from neu_mess m left join pg_proc p on p.oid = m.oid
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ------------------------------------------- Die Exportfunktion (0160)
  (101, 'Export', 'Rumpfabdruck ist die Fassung aus 0160',
      (select md5(p.prosrc) from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      'ff4f38e61cbd4e5857ea914d6be68d44'),
  (102, 'Export', 'weiter 54 Bereiche — 0160 fuegt ein FELD hinzu, keinen Bereich',
      (select ((length(p.prosrc) - length(replace(p.prosrc, 'coalesce((', '')))
               / length('coalesce(('))::text
         from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')),
      '54'),
  (103, 'Export', 'das Feld base_sky_id steht im Rumpf',
      (select (p.prosrc like '%base_sky_id%')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (104, 'Export', 'die Formatversion ist UNVERAENDERT 2',
      (select (p.prosrc like '%''format_version'', 2,%')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (105, 'Export', 'security definer',
      (select p.prosecdef::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (106, 'Export', 'volatility stable',
      (select p.provolatile::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 's'),
  (107, 'Export', 'genau EINE search_path-Festlegung, und ihr Wert ist LEER',
      (select (count(*) = 1 and btrim(min(substring(c from 'search\_path=(.*)$')), '"') = '')::text
         from pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
        where p.oid = to_regprocedure('public.system_platform_export()')
          and c like 'search\_path=%'), 'true'),

  -- ------------------------------------------- Die drei neuen Funktionen
  (111, 'Funktionen', 'admin_publish_variant_auto(text,text) steht (0161)',
      (select case when oid is null then 'fehlt' else 'steht' end from neu_detail where nr = 201), 'steht'),
  (112, 'Funktionen', 'admin_set_market_price(text,numeric) steht (0162)',
      (select case when oid is null then 'fehlt' else 'steht' end from neu_detail where nr = 202), 'steht'),
  (113, 'Funktionen', 'admin_delete_figure(text) steht (0162)',
      (select case when oid is null then 'fehlt' else 'steht' end from neu_detail where nr = 203), 'steht'),
  (114, 'Funktionen', 'je Name GENAU EINE Fassung — keine Ueberladung',
      (select count(*)::text from neu_detail where fassungen <> 1), '0'),
  (115, 'Funktionen', 'Info: Name und Anzahl der Fassungen',
      (select string_agg(kurz || '=' || fassungen::text, ', ' order by kurz) from neu_detail), null),
  (116, 'Funktionen', 'keine davon fehlt',
      (select count(*)::text from neu_detail where oid is null), '0'),

  -- ------------------------------------------------------------- Die Rechte
  (121, 'Rechte', 'execute fuer authenticated bei allen drei',
      (select count(*)::text from neu_detail
        where has_function_privilege('authenticated', sig, 'execute')), '3'),
  (122, 'Rechte', 'und fuer anon bei keiner',
      (select count(*)::text from neu_detail
        where has_function_privilege('anon', sig, 'execute')), '0'),
  (123, 'Rechte', 'und fuer PUBLIC bei keiner',
      (select coalesce(sum(fuer_public), 0)::text from neu_detail), '0'),
  (124, 'Rechte', 'alle drei: security definer und search_path leer gesetzt',
      (select count(*)::text from neu_detail
        where prosecdef and pfadanzahl = 1 and pfadwert = ''), '3'),

  -- ------------------------------------------- Das Journal kennt 14 Werte
  (131, 'Journal', 'catalog_admin_changes_field_known steht',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), '1'),
  (132, 'Journal', 'sie nennt weiter die zwoelf von vorher',
      (select (pg_get_constraintdef(c.oid) like '%catalog_visible%'
               and pg_get_constraintdef(c.oid) like '%display_name_override%'
               and pg_get_constraintdef(c.oid) like '%admin_note%'
               and pg_get_constraintdef(c.oid) like '%catalog_group%'
               and pg_get_constraintdef(c.oid) like '%image_override_path%'
               and pg_get_constraintdef(c.oid) like '%card_type%'
               and pg_get_constraintdef(c.oid) like '%created%'
               and pg_get_constraintdef(c.oid) like '%catalog_status%'
               and pg_get_constraintdef(c.oid) like '%merged_from%'
               and pg_get_constraintdef(c.oid) like '%discarded%'
               and pg_get_constraintdef(c.oid) like '%character_id%'
               and pg_get_constraintdef(c.oid) like '%base_sky_id%')::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (133, 'Journal', 'sie nennt market_price (0162) — sonst scheitert jede Preisaenderung mit 23514',
      (select (pg_get_constraintdef(c.oid) like '%market_price%')::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (134, 'Journal', 'sie nennt deleted (0162) — sonst scheitert jede Loeschung',
      (select (pg_get_constraintdef(c.oid) like '%deleted%')::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),

  -- --------------------------------------------- Unberuehrt und unveraendert
  /*
   * DIE GRUPPE SCHREIBT KEINE DATENZEILE. Diese Zeilen muessen deshalb genau
   * das zeigen, was der Preflight gezeigt hat — Zeile fuer Zeile dieselben
   * Nummern: 151/152/153/154 des Preflights entsprechen 141/142/143/144 hier.
   */
  (141, 'Unveraendert', 'Info: Katalogzeilen (muss Zeile 151 des Preflights treffen)',
      (select count(*)::text from public.skylanders), null),
  (142, 'Unveraendert', 'Info: sichtbare Katalogzeilen (Zeile 152)',
      (select count(*)::text from public.skylanders where catalog_visible), null),
  (143, 'Unveraendert', 'Info: Zeilen mit Familie (Zeile 153)',
      (select count(*)::text from public.skylanders where character_id is not null), null),
  (144, 'Unveraendert', 'Info: Zeilen mit Basisfigur (Zeile 154)',
      (select count(*)::text from public.skylanders where base_sky_id is not null), null),
  (145, 'Unveraendert', 'Ketten — muss 0 sein',
      (select count(*)::text from public.skylanders v
        join public.skylanders b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.base_sky_id is not null), '0'),
  (146, 'Unveraendert', 'Info: Trigger an skylanders (muss Zeile 161 des Preflights treffen)',
      (select coalesce(string_agg(t.tgname, ', ' order by t.tgname), '(keine)')
         from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal), null),
  (147, 'Unveraendert', 'Info: Riegel an skylanders (Zeile 162)',
      (select coalesce(string_agg(c.conname, ', ' order by c.conname), '(keine)')
         from pg_constraint c where c.conrelid = to_regclass('public.skylanders')), null),
  (148, 'Unveraendert', 'RLS ist weiter aktiv',
      (select c.relrowsecurity::text from pg_class c
        where c.oid = to_regclass('public.skylanders')), 'true'),
  (149, 'Unveraendert', 'Info: Journalzeilen (muss Zeile 2 des Preflights treffen — '
                        'keine der drei schreibt eine)',
      (select count(*)::text from public.catalog_admin_changes), null),

  -- ------------------------------- Die bestehenden Funktionen stehen noch
  (151, 'Erhalten', 'admin_set_variant_base und admin_publish_with_base (0159)',
      ((to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is not null
        and to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is not null))::text,
      'true'),
  (152, 'Erhalten', 'admin_merge_references(text), und weiter die Fassung aus 0159',
      (select (p.prosrc like '%confkey%')::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_references(text)')), 'true'),
  (153, 'Erhalten', 'admin_merge_draft: weiter ZWEI Fassungen (3- und 4-armig)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_merge_draft'), '2'),
  (154, 'Erhalten', 'admin_discard_draft, admin_merge_plan, merge_note (0155/0156/0157)',
      ((to_regprocedure('public.admin_discard_draft(text)') is not null
        and to_regprocedure('public.admin_merge_plan(text,text,text)') is not null
        and to_regprocedure('public.merge_note(text,text)') is not null))::text, 'true'),
  (155, 'Erhalten', 'admin_set_character, admin_create_character, admin_publish_as_variant (0158)',
      ((to_regprocedure('public.admin_set_character(text,bigint)') is not null
        and to_regprocedure('public.admin_create_character(text)') is not null
        and to_regprocedure('public.admin_publish_as_variant(text,bigint)') is not null))::text,
      'true'),
  (156, 'Erhalten', 'admin_set_catalog_status und admin_set_catalog_visible (0152/0039)',
      ((to_regprocedure('public.admin_set_catalog_status(text,text)') is not null
        and to_regprocedure('public.admin_set_catalog_visible(text,boolean)') is not null))::text,
      'true'),

  -- -------------------------------------------------------- Die Belegsperre
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
