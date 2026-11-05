-- ===========================================================================
-- STAGING — DIE NACHKONTROLLE ZU 0180 (AUSGEWAEHLTE, NACHGEWIESENE
--           UEBERNAHME), REIN LESEND
--
-- NACH `supabase/operations/staging-0180.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- SIE BRAUCHT DIE ZWEI BASELINES AUS DEM PREFLIGHT. Der Runner setzt sie
-- selbst (`skyisles.base`, `skyisles.coll`).
--
--   201-210  DIE NEUE FASSUNG: die sieben neuen Ruempfe und die drei
--            ersetzten (Decide, Pending, alte Uebernahme).
--   211      SECURITY DEFINER und ein leerer search_path, acht Funktionen.
--   212-215  RECHTE: Vorschau und Uebernahme nur fuer authenticated; Decide
--            und Pending wie vorher; die alte Uebernahme und die fuenf Helfer
--            fuer keine Clientrolle.
--   221-227  UNBERUEHRT: Lesefunktion, Ledger, Nachweis (0179), pending_set,
--            sale_values (0178), Anlegen (0176), die Sperre.
--   231-253  WAS SICH NICHT BEWEGT HAT — dieselben Werte wie Preflight 131-153.
--
-- SIE RUFT KEINE FUNKTION DES ABGLEICHS AUF.
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
  (201, 'Anlage', 'sales_recon_allowed_0180(text) ist die Fassung aus 0180 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_allowed_0180(text)')),
      '56a9899eaf5465f1b90acc0ccb986b38'),
  (202, 'Anlage', 'sales_recon_take_check(bigint) ist die Fassung aus 0180 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_take_check(bigint)')),
      'bce45f42855c25fc428cab86bd7cf081'),
  (203, 'Anlage', 'sales_recon_decision_problem(bigint,bigint) ist die Fassung aus 0180 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_decision_problem(bigint,bigint)')),
      'ed9d427a8657e78c77ef70d53cc42410'),
  (204, 'Anlage', 'sales_recon_check_selection(bigint[]) ist die Fassung aus 0180 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_check_selection(bigint[])')),
      'b382e469fb58fa8a756f24910b9a8cc8'),
  (205, 'Anlage', 'sales_recon_selection(bigint,bigint[]) ist die Fassung aus 0180 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_selection(bigint,bigint[])')),
      '97c3461ea718a4694d06cf1fc1280a22'),
  (206, 'Anlage', 'seller_recon_preview(bigint,bigint[]) ist die Fassung aus 0180 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_preview(bigint,bigint[])')),
      'f3bc1d34fa3e7b843ca609fe7b0f5569'),
  (207, 'Anlage', 'seller_recon_apply(bigint,bigint[],text) ist die Fassung aus 0180 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)')),
      'b96ceff990dafa33674c71e928c713bb'),
  (208, 'Anlage', 'seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb) ist die Fassung aus 0180 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)')),
      'dffdbe5b16fa39989de47c9c61a77911'),
  (209, 'Anlage', 'seller_recon_pending(bigint) ist die Fassung aus 0180 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_pending(bigint)')),
      'dc140b5971bc752e90ad2344b3db2712'),
  (210, 'Anlage', 'seller_recon_apply(bigint,integer) ist die Fassung aus 0180 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_apply(bigint,integer)')),
      '72cc0079c007847cabd4db20a6109a0c'),
  (211, 'Anlage', 'Helfer, Vorschau, Uebernahme, Decide, Pending und alte Uebernahme: SECURITY DEFINER, genau ein leerer search_path',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.sales_recon_take_check(bigint)'),
                        to_regprocedure('public.sales_recon_decision_problem(bigint,bigint)'),
                        to_regprocedure('public.sales_recon_selection(bigint,bigint[])'),
                        to_regprocedure('public.seller_recon_preview(bigint,bigint[])'),
                        to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)'),
                        to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)'),
                        to_regprocedure('public.seller_recon_pending(bigint)'),
                        to_regprocedure('public.seller_recon_apply(bigint,integer)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')), '8'),
  (212, 'Rechte', 'Vorschau und Uebernahme: authenticated darf, anon und PUBLIC nicht',
      (select ((select (has_function_privilege('authenticated', to_regprocedure('public.seller_recon_preview(bigint,bigint[])'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_recon_preview(bigint,bigint[])'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_recon_preview(bigint,bigint[])') and a.privilege_type = 'EXECUTE' and a.grantee = 0))::text
         )::boolean and (select (has_function_privilege('authenticated', to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))::text
         )::boolean)::text), 'true'),
  (213, 'Rechte', 'Decide und Pending: authenticated darf, anon und PUBLIC nicht — wie vorher',
      (select ((select (has_function_privilege('authenticated', to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))::text
         )::boolean and (select (has_function_privilege('authenticated', to_regprocedure('public.seller_recon_pending(bigint)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_recon_pending(bigint)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_recon_pending(bigint)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))::text
         )::boolean)::text), 'true'),
  (214, 'Rechte', 'die alte Uebernahme seller_recon_apply(bigint, integer): keine Clientrolle (PUBLIC, anon, authenticated)',
      (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.seller_recon_apply(bigint,integer)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))), '0'),
  (215, 'Rechte', 'keine Clientrolle darf einen der fuenf Helfer ausfuehren',
      (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.sales_recon_allowed_0180(text)'),
                        to_regprocedure('public.sales_recon_take_check(bigint)'),
                        to_regprocedure('public.sales_recon_decision_problem(bigint,bigint)'),
                        to_regprocedure('public.sales_recon_check_selection(bigint[])'),
                        to_regprocedure('public.sales_recon_selection(bigint,bigint[])'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))), '0'),
  (221, 'Unberuehrt', 'seller_recon_session(bigint,text,integer,integer) ist weiter die Fassung aus 0179',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)')),
      '5ed52447581cc895efc6a56f268c0da3'),
  (222, 'Unberuehrt', 'sales_recon_ledger(bigint) ist weiter die Fassung aus 0179',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_ledger(bigint)')),
      '07875fe3ba889fefab1c55dbe67005d9'),
  (223, 'Unberuehrt', 'sales_recon_proven(jsonb,text,jsonb,boolean) ist weiter die Fassung aus 0179',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_proven(jsonb,text,jsonb,boolean)')),
      'b7b36ccd5efdd57e661808b62274df68'),
  (224, 'Unberuehrt', 'sales_recon_pending_set(bigint) ist weiter die Fassung aus 0178',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_pending_set(bigint)')),
      '3228eb12e00d7982c5cad5c42ea6f773'),
  (225, 'Unberuehrt', 'sales_recon_sale_values(bigint) ist weiter die Fassung aus 0178',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_sale_values(bigint)')),
      '4c4a01eb05adb6d439450063f04eada9'),
  (226, 'Unberuehrt', 'seller_recon_create(jsonb) ist weiter die Fassung aus 0176',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_create(jsonb)')),
      '21fab5ff4ea2c7cb2550f3db821fce0f'),
  (227, 'Unberuehrt', 'die Verkaeufersperre steht: sales_recon_gate() und can_operate_active_seller()',
      ((to_regprocedure('public.sales_recon_gate()') is not null)
       and (to_regprocedure('public.can_operate_active_seller()') is not null))::text, 'true'),

  -- --------------------------------- Was sich NICHT bewegt haben darf
  (231, 'Unveraendert', 'Sitzungen: Anzahl|Abdruck (jede Spalte) (Preflight 131)',
      case when has_table_privilege('public.sales_recon_sessions', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_sessions t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (232, 'Unveraendert', 'Dateien: Anzahl|Abdruck (jede Spalte) (Preflight 132)',
      case when has_table_privilege('public.sales_recon_files', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_files t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (233, 'Unveraendert', 'Bestellungen: Anzahl|Abdruck (jede Spalte) (Preflight 133)',
      case when has_table_privilege('public.sales_recon_orders', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_orders t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (234, 'Unveraendert', 'Zuordnungen: Anzahl|Abdruck (jede Spalte) (Preflight 134)',
      case when has_table_privilege('public.sales_recon_matches', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_matches t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (235, 'Unveraendert', 'Befunde: Anzahl|Abdruck (jede Spalte) (Preflight 135)',
      case when has_table_privilege('public.sales_recon_findings', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_findings t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (236, 'Unveraendert', 'Entscheidungen: Anzahl|Abdruck (jede Spalte) (Preflight 136)',
      case when has_table_privilege('public.sales_recon_decisions', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_decisions t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (237, 'Unveraendert', 'Uebernahmen: Anzahl|Abdruck (jede Spalte) (Preflight 137)',
      case when has_table_privilege('public.sales_recon_applications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_applications t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

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

  (251, 'Unveraendert', 'Rechte, SECURITY DEFINER und search_path jeder Funktion in public ausser den neuen und den beiden Apply-Fassungen: Abdruck (Preflight 151)',
      (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                             || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                             chr(10) order by p.oid::regprocedure::text))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname not in ('sales_recon_allowed_0180', 'sales_recon_take_check', 'sales_recon_decision_problem', 'sales_recon_check_selection', 'sales_recon_selection', 'seller_recon_preview', 'seller_recon_apply')), null),
  (252, 'Unveraendert', 'Rechte und RLS-Schalter jeder Tabelle, Sicht und Sequenz in public: Abdruck (Preflight 152)',
      (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                             || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')), null),
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
