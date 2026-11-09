-- ===========================================================================
-- STAGING — DIE NACHKONTROLLE ZU 0181 (POSITIONEN IMPORTIERTER VERKAEUFE
--           KORRIGIEREN), REIN LESEND
--
-- NACH `supabase/operations/staging-0181-0182.sql` fahren (0181 und 0182).
-- **Erwartet: Zeile 9999 = `0`.**
--
-- SIE BRAUCHT DIE ZWEI BASELINES AUS DEM PREFLIGHT. Der Runner setzt sie
-- selbst (`skyisles.base`, `skyisles.coll`).
--
--   201-210  DIE NEUE FASSUNG: die acht neuen Ruempfe und beide ersetzten
--            Sync-Funktionen.
--   211      SECURITY DEFINER und ein leerer search_path, zehn Funktionen.
--   212-215  RECHTE: die drei Korrekturwege und die Lesefunktion nur fuer
--            authenticated; Helfer und Trigger fuer keine Clientrolle; der
--            Sync (beide) nur service_role; die Spur ohne Clientrecht, RLS an,
--            append-only.
--   216      DIE SPUR IST LEER.
--   217-219  DIE SICHERUNGEN (0182): beide Ruempfe, der Bereich ohne
--            Kontoidentitaet, Formatversion 4 bzw. 1.
--   221-223  UNBERUEHRT: Journalhelfer (0062), normale Positionswege
--            (0065/0110), die Sperre.
--   241-253  WAS SICH NICHT BEWEGT HAT — dieselben Werte wie Preflight 141-153.
--
-- SIE RUFT KEINE KORREKTURFUNKTION AUF.
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
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ------------------------------------------------------- Die neue Fassung
  (201, 'Anlage', 'seller_correct_legacy_sale_item(bigint,text,timestamptz) ist die Fassung aus 0181 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_correct_legacy_sale_item(bigint,text,timestamptz)')),
      '3d79cf1706961107464a720035c914e6'),
  (202, 'Anlage', 'seller_add_legacy_sale_item(bigint,text,text,text,timestamptz) ist die Fassung aus 0181 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)')),
      'd7b5ba1020ce4490299e2fe21075e7f3'),
  (203, 'Anlage', 'seller_remove_legacy_added_item(bigint,timestamptz) ist die Fassung aus 0181 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_remove_legacy_added_item(bigint,timestamptz)')),
      'd20ab29004e12c2c5d308bf024c964ed'),
  (204, 'Anlage', 'seller_sale_item_corrections(bigint) ist die Fassung aus 0181 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_sale_item_corrections(bigint)')),
      '547a44013c3b29e563ef7c390a586bac'),
  (205, 'Anlage', 'sales_legacy_correction_sale(bigint,timestamptz) ist die Fassung aus 0181 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_legacy_correction_sale(bigint,timestamptz)')),
      '715081a60a5bc9b667634cda7dc70fbc'),
  (206, 'Anlage', 'sales_legacy_correction_item(public.sale_items) ist die Fassung aus 0181 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_legacy_correction_item(public.sale_items)')),
      'ca3e1200efc8753d94f9034a3024cbe5'),
  (207, 'Anlage', 'sales_legacy_correction_figure(text) ist die Fassung aus 0181 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_legacy_correction_figure(text)')),
      '230487e64d50e8ec669b55f20882d629'),
  (208, 'Anlage', 'sale_item_corrections_append_only() ist die Fassung aus 0181 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sale_item_corrections_append_only()')),
      'aedd3c64076884fbf29d0308f5e26ec7'),
  (209, 'Anlage', 'system_sync_legacy_sale_item(bigint,text,text,text,text) ist die Fassung aus 0181 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)')),
      '54b6c5d96992db8fce723732d277b3f6'),
  (210, 'Anlage', 'system_sync_legacy_sale_group(bigint,date) ist die Fassung aus 0181 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)')),
      'b020a3d90901b3d64585b534eb8b119e'),
  (211, 'Anlage', 'die acht neuen Funktionen und beide Sync-Funktionen: SECURITY DEFINER, genau ein leerer search_path',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.seller_correct_legacy_sale_item(bigint,text,timestamptz)'),
                        to_regprocedure('public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)'),
                        to_regprocedure('public.seller_remove_legacy_added_item(bigint,timestamptz)'),
                        to_regprocedure('public.seller_sale_item_corrections(bigint)'),
                        to_regprocedure('public.sales_legacy_correction_sale(bigint,timestamptz)'),
                        to_regprocedure('public.sales_legacy_correction_item(public.sale_items)'),
                        to_regprocedure('public.sales_legacy_correction_figure(text)'),
                        to_regprocedure('public.sale_item_corrections_append_only()'),
                        to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)'),
                        to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')), '10'),
  (212, 'Rechte', 'die drei Korrekturwege und die Lesefunktion: authenticated darf, anon und PUBLIC nicht',
      (select ((has_function_privilege('authenticated', to_regprocedure('public.seller_correct_legacy_sale_item(bigint,text,timestamptz)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_correct_legacy_sale_item(bigint,text,timestamptz)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_correct_legacy_sale_item(bigint,text,timestamptz)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))
           and (has_function_privilege('authenticated', to_regprocedure('public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))
           and (has_function_privilege('authenticated', to_regprocedure('public.seller_remove_legacy_added_item(bigint,timestamptz)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_remove_legacy_added_item(bigint,timestamptz)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_remove_legacy_added_item(bigint,timestamptz)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))
           and (has_function_privilege('authenticated', to_regprocedure('public.seller_sale_item_corrections(bigint)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_sale_item_corrections(bigint)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_sale_item_corrections(bigint)') and a.privilege_type = 'EXECUTE' and a.grantee = 0)))::text), 'true'),
  (213, 'Rechte', 'keine Clientrolle darf einen der drei Helfer oder den Trigger der Spur ausfuehren',
      (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.sales_legacy_correction_sale(bigint,timestamptz)'),
                        to_regprocedure('public.sales_legacy_correction_item(public.sale_items)'),
                        to_regprocedure('public.sales_legacy_correction_figure(text)'),
                        to_regprocedure('public.sale_item_corrections_append_only()'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))), '0'),
  (214, 'Rechte', 'beide Sync-Funktionen: service_role darf, keine Clientrolle — wie vorher',
      (has_function_privilege('service_role', to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)'), 'execute')
       and (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) = '0'
       and has_function_privilege('service_role', to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)'), 'execute')
       and (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) = '0')::text, 'true'),
  (215, 'Rechte', 'die Spur: RLS an, kein Recht fuer anon oder authenticated, der Append-only-Trigger steht',
      ((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.sale_item_corrections'))
       and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                        where c.oid = to_regclass('public.sale_item_corrections')
                          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated')))
       and exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.sale_item_corrections')
                    and t.tgname = 'sale_item_corrections_append_only' and not t.tgisinternal))::text, 'true'),
  (216, 'Anlage', 'die Spur ist leer — 0181 schreibt keine Zeile',
      case when has_table_privilege('public.sale_item_corrections', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.sale_item_corrections', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '0'),
  (217, 'Sicherung', 'seller_business_backup() und system_platform_export() sind die Fassungen aus 0182 (md5 der Ruempfe)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()')) || ',' || (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')),
      'b42609b64d8771f1792a09b344ba80de,307e1c10a99afdaa683292e2a495e8ad'),
  (218, 'Sicherung', 'beide Sicherungen fuehren den Bereich sale_item_corrections, ohne corrected_by',
      ((select count(*) from pg_proc p where p.oid in (to_regprocedure('public.seller_business_backup()'), to_regprocedure('public.system_platform_export()'))
          and strpos(p.prosrc, '''sale_item_corrections'', coalesce((') > 0
          and strpos(p.prosrc, '''corrected_by''') = 0) = 2)::text, 'true'),
  (219, 'Sicherung', 'die Plattformsicherung nennt Formatversion 4, die Betriebssicherung weiter 1',
      ((select strpos(p.prosrc, '''format_version'', 4,') > 0 from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()'))
       and (select strpos(p.prosrc, '''format_version'',  1,') > 0 from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()')))::text, 'true'),

  -- ------------------------------------------------------------- Unberuehrt
  (221, 'Unberuehrt', 'die drei Journalhelfer sind weiter die Fassungen aus 0062',
      (select string_agg(md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
        where p.oid in (to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)'),
                        to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)'),
                        to_regprocedure('public.orderbook_touch_sale(bigint)'))),
      '3152b6595d78de9b479199da28b05411,a8a7e665d64e656e0ecc6515f55b3cb7,cd7584eabbe65b43d834b2709d6ff792'),
  (222, 'Unberuehrt', 'die normalen Positionswege sind weiter die Fassungen aus 0065/0110',
      (select string_agg(md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
        where p.oid in (to_regprocedure('public.hold_sale_item(bigint)'),
                        to_regprocedure('public.seller_add_sale_item(bigint,text,text,text)'),
                        to_regprocedure('public.seller_remove_sale_item(bigint)'),
                        to_regprocedure('public.seller_set_sale_item_sky(bigint,text)'))),
      'bf3502a3f6f5ec849a4ef22785063431,da912f44a62052d52fd6da1bd8cfdd19,81011d31798d10ab12bac5f0e906be91,f46a0011b33230e66f782e12acc81cf6'),
  (223, 'Unberuehrt', 'die Betriebssperre steht: can_operate_active_seller()',
      (to_regprocedure('public.can_operate_active_seller()') is not null)::text, 'true'),

  -- ----------------------------- Was sich nicht bewegt hat (Preflight 141-153)
  (241, 'Unveraendert', 'Verkaeufe: Anzahl|Abdruck (jede Spalte) (Preflight 141)',
      case when has_table_privilege('public.sales', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (242, 'Unveraendert', 'Verkaufspositionen: Anzahl|Abdruck (jede Spalte) (Preflight 142)',
      case when has_table_privilege('public.sale_items', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sale_items t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (243, 'Unveraendert', 'Erstattungen: Anzahl|Abdruck (jede Spalte) (Preflight 143)',
      case when has_table_privilege('public.sale_refunds', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sale_refunds t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (244, 'Unveraendert', 'Lagerbewegungen: Anzahl|Abdruck (jede Spalte) (Preflight 144)',
      case when has_table_privilege('public.inventory_movements', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.inventory_movements t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (245, 'Unveraendert', 'Altbestandsereignisse: Anzahl|Abdruck (jede Spalte) (Preflight 145)',
      case when has_table_privilege('public.legacy_stock_events', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.legacy_stock_events t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (246, 'Unveraendert', 'Orderbuch-Journal: Anzahl|Abdruck (jede Spalte) (Preflight 146)',
      case when has_table_privilege('public.orderbook_audit', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.orderbook_audit t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (247, 'Unveraendert', 'Reservierungen: Anzahl|Abdruck (jede Spalte) (Preflight 147)',
      case when has_table_privilege('public.order_reservations', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.order_reservations t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (248, 'Unveraendert', 'Gebuehren: Anzahl|Abdruck (jede Spalte) (Preflight 148)',
      case when has_table_privilege('public.sale_fees', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sale_fees t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  (251, 'Unveraendert', 'Rechte, SECURITY DEFINER und search_path jeder Funktion in public ausser den acht neuen: Abdruck (Preflight 151)',
      (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                             || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                             chr(10) order by p.oid::regprocedure::text))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname not in ('seller_correct_legacy_sale_item', 'seller_add_legacy_sale_item', 'seller_remove_legacy_added_item', 'seller_sale_item_corrections', 'sales_legacy_correction_sale', 'sales_legacy_correction_item', 'sales_legacy_correction_figure', 'sale_item_corrections_append_only')), null),
  (252, 'Unveraendert', 'Rechte und RLS-Schalter jeder Tabelle, Sicht und Sequenz in public ausser der neuen Spur: Abdruck (Preflight 152)',
      (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                             || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') and c.relname not in ('sale_item_corrections', 'sale_item_corrections_id_seq')), null),
  (253, 'Unveraendert', 'jede Policy in public (Verkaeufer, Sammlung, alles): Abdruck (Preflight 153)',
      (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                             || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                             chr(10) order by pl.tablename, pl.policyname)), '(keine)')
         from pg_policies pl where pl.schemaname = 'public'), null),

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
   * DREI ZUSTAENDE, NICHT ZWEI.
   *
   *   ok = true   die Pruefung stimmt
   *   ok = false  sie weicht ab           → zaehlt in 9999, blockiert
   *   ok = null   Auskunft ODER OFFEN     → zaehlt nicht in 9999
   *
   * `KEIN-RECHT` heisst: diese Zeile liest ein Objekt, auf das die
   * aufrufende Rolle kein `select` hat. Das ist KEINE Abweichung — es ist
   * eine nicht durchgefuehrte Pruefung, und als solche wird sie in Zeile
   * 9998 GEZAEHLT UND GEMELDET. Sie als bestanden zu buchen waere die
   * stille Ignorierung, die es hier nicht gibt.
   */
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
/*
 * ZEILE 9998 — WAS DIESE ROLLE NICHT PRUEFEN KONNTE.
 *
 * Der lesende Pruefzugang `skyisles_agent` hat `select` auf zwoelf Tabellen;
 * `offer_state` und `offer_state_live` gehoeren bewusst nicht dazu (0146
 * erteilt gar kein Clientrecht darauf). Fuer ihn bleiben die beiden
 * Datenzeilen offen — die ~100 Katalogzeilen laufen trotzdem durch, und das
 * ist der Punkt: EIN fehlendes Recht darf nicht hundert gute Pruefungen
 * mitnehmen.
 *
 * Im SQL-Editor (als `postgres`) ist die Zahl 0 und jede Zeile gemessen.
 */
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte '
       '(0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
