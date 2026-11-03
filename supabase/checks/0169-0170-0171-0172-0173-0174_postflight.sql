-- ===========================================================================
-- STAGING — DIE NACHKONTROLLE ZU 0169–0174 (VERKAUFSABGLEICH), REIN LESEND
--
-- NACH `supabase/operations/staging-0169-0170-0171-0172-0173-0174.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- SIE BRAUCHT DIE ZWEI BASELINES AUS DEM PREFLIGHT. Der Runner setzt sie
-- selbst (`skyisles.base`, `skyisles.coll`).
--
--   201-207  DIE SIEBEN TABELLEN: angelegt, RLS an, kein Clientrecht, die
--            zwei Nur-Erweitern-Trigger, die Eindeutigkeiten, leer.
--   211-219  DIE 22 FUNKTIONEN: angelegt, SECURITY DEFINER, leerer
--            search_path; die zwoelf Betriebsfunktionen nur fuer
--            authenticated, die zehn Hilfsfunktionen fuer keine Clientrolle.
--   221      0171: der Index fuer Bestellnummern je Kanal.
--   231-237  WAS SICH NICHT BEWEGT HAT — dieselben Zahlen wie Preflight 131-137.
--   241-244  0174: die Sicherungen fuehren die sieben Tabellen, Rechte unveraendert.
--
-- GESCHUETZTE TABELLEN wie im Preflight hinter `has_table_privilege` +
-- `query_to_xml`: fuer den Pruefzugang offen (9998), als `postgres` gemessen.
--
-- SIE RUFT KEINE FUNKTION AUF.
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
fn as (
  select p.oid, p.proname, p.prosecdef, p.proacl,
         /*
          * AUSGEPACKT, NICHT VERGLICHEN. PostgreSQL quotiert den Wert:
          * `set search_path = ''` liegt als `search_path=""` ab.
          */
         (select substring(c from 'search\_path=(.*)$')
            from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%') as pfadwert,
         (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%') as pfadanzahl,
         p.proname in ('seller_recon_candidates', 'seller_recon_aliases', 'seller_recon_create', 'seller_recon_sessions', 'seller_recon_session', 'seller_recon_decide', 'seller_recon_close', 'seller_recon_discard', 'seller_recon_thin_snapshots', 'seller_recon_apply', 'seller_cancel_external_sale', 'seller_uncancel_external_sale') as betrieb
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('seller_recon_candidates', 'seller_recon_aliases', 'seller_recon_create', 'seller_recon_sessions', 'seller_recon_session', 'seller_recon_decide', 'seller_recon_close', 'seller_recon_discard', 'seller_recon_thin_snapshots', 'seller_recon_apply', 'seller_cancel_external_sale', 'seller_uncancel_external_sale', 'sales_recon_gate', 'sales_recon_no_contact', 'sales_recon_only_keys', 'sales_recon_text', 'sales_recon_number', 'sales_recon_day', 'sales_recon_array', 'sales_recon_numbers_only', 'sales_recon_allowed', 'sales_recon_evidence_is_append_only')
),
tab as (
  select c.oid, c.relname, c.relrowsecurity, c.relacl, c.relowner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('sales_recon_sessions', 'sales_recon_files', 'sales_recon_orders', 'sales_recon_matches', 'sales_recon_findings', 'sales_recon_decisions', 'sales_recon_applications')
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ------------------------------------------------- Die sieben Tabellen
  (201, 'Anlage', 'die sieben Abgleichstabellen stehen',
      (select count(*)::text from tab), '7'),
  (202, 'Anlage', 'RLS ist auf allen sieben an',
      (select count(*)::text from tab where relrowsecurity), '7'),
  (203, 'Rechte', 'anon, authenticated und PUBLIC haben auf keiner der sieben ein Recht',
      (select count(*)::text from tab, aclexplode(coalesce(tab.relacl, acldefault('r', tab.relowner))) a
        where a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated')), '0'),
  (204, 'Anlage', 'Entscheidungen und Anwendungen sind nur erweiterbar (zwei Trigger)',
      (select count(*)::text from pg_trigger t
        where t.tgname in ('sales_recon_decisions_append_only', 'sales_recon_applications_append_only')
          and not t.tgisinternal), '2'),
  (205, 'Anlage', 'die Eindeutigkeiten stehen (offene Sitzung je Dateisatz, 1:1 je Sitzung, eine Anwendung je Entscheidung)',
      ((to_regclass('public.sales_recon_sessions_open_files_uniq') is not null)::int
       + (to_regclass('public.sales_recon_matches_order_once') is not null)::int
       + (to_regclass('public.sales_recon_matches_sale_once') is not null)::int
       + (select count(*)::int from pg_constraint c where c.conname = 'sales_recon_applications_once'))::text, '4'),
  (206, 'Rechte', 'der Pruefzugang skyisles_agent hat auf keiner der sieben ein Recht',
      (select count(*)::text from tab, aclexplode(coalesce(tab.relacl, acldefault('r', tab.relowner))) a
        where a.grantee::regrole::text = 'skyisles_agent'), '0'),
  (207, 'Daten', 'die sieben Tabellen sind leer — die Gruppe schreibt keine Zeile',
      case when has_table_privilege('public.sales_recon_sessions', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select ((select count(*) from public.sales_recon_sessions) + (select count(*) from public.sales_recon_files) + (select count(*) from public.sales_recon_orders) + (select count(*) from public.sales_recon_matches) + (select count(*) from public.sales_recon_findings) + (select count(*) from public.sales_recon_decisions) + (select count(*) from public.sales_recon_applications))::text as c', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '0'),

  -- ------------------------------------------------- Die 22 Funktionen
  (211, 'Anlage', 'die 22 Funktionen stehen, jede genau einmal',
      (select count(distinct proname)::text || '/' || count(*)::text from fn), '22/22'),
  (212, 'Anlage', 'SECURITY DEFINER: die zwoelf Betriebsfunktionen, der Rollenwaechter und der Nur-Erweitern-Trigger — nicht die acht reinen Pruefhilfen',
      (select count(*)::text from fn where prosecdef), '14'),
  (213, 'Anlage', 'jede mit genau einem LEEREN search_path',
      (select count(*)::text from fn where pfadanzahl = 1 and pfadwert = '""'), '22'),
  (214, 'Rechte', 'authenticated darf die zwoelf Betriebsfunktionen',
      (select count(*)::text from fn where betrieb and has_function_privilege('authenticated', oid, 'execute')), '12'),
  (215, 'Rechte', 'anon darf keine der 22',
      (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute')), '0'),
  (216, 'Rechte', 'PUBLIC darf keine der 22',
      (select count(*)::text from fn, aclexplode(coalesce(fn.proacl, acldefault('f', 0))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'), '0'),
  (217, 'Rechte', 'authenticated darf keine der zehn Hilfsfunktionen',
      (select count(*)::text from fn where not betrieb and has_function_privilege('authenticated', oid, 'execute')), '0'),

  -- ------------------------------------------------------------- 0171
  (221, 'Anlage', 'der Index fuer Bestellnummern je Kanal steht und ist eindeutig',
      (select count(*)::text from pg_index i
        where i.indexrelid = to_regclass('public.sales_external_order_ref_per_channel') and i.indisunique), '1'),

  -- --------------------------------- Was sich NICHT bewegt haben darf
  (231, 'Unveraendert', 'Verkaeufe: Anzahl|Abdruck (Preflight 131)',
      case when has_table_privilege('public.sales', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(s.id::text || ''|'' || coalesce(s.sold_at::text, ''-'') || ''|'' || coalesce(s.items_subtotal::text, ''-'') || ''|'' || coalesce(s.discount_amount::text, ''-'') || ''|'' || coalesce(s.shipping_charged::text, ''-'') || ''|'' || coalesce(s.external_order_ref, ''-'') || ''|'' || coalesce(s.cancelled_at::text, ''-'') || ''|'' || s.updated_at::text, chr(10) order by s.id)), ''(leer)'') as c from public.sales s', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (232, 'Unveraendert', 'Verkaufspositionen: Anzahl|Abdruck (Preflight 132)',
      case when has_table_privilege('public.sale_items', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(i.id::text || ''|'' || i.sale_id::text || ''|'' || coalesce(i.sky_id, ''-'') || ''|'' || coalesce(i.raw_name, ''-'') || ''|'' || coalesce(i.movement_id::text, ''-'') || ''|'' || coalesce(i.settled_at::text, ''-''), chr(10) order by i.id)), ''(leer)'') as c from public.sale_items i', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (233, 'Unveraendert', 'Erstattungen: Anzahl|Summe (Preflight 133)',
      case when has_table_privilege('public.sale_refunds', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(sum(amount), 0)::text as c from public.sale_refunds', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (234, 'Unveraendert', 'Auditzeilen des Verkaufsbuchs (Preflight 134)',
      case when has_table_privilege('public.orderbook_audit', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.orderbook_audit', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (235, 'Unveraendert', 'aktive externe Holds: Anzahl|Menge (Preflight 135)',
      case when has_table_privilege('public.order_reservations', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(sum(quantity), 0)::text as c from public.order_reservations where sale_item_id is not null and state = ''active''', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (236, 'Unveraendert', 'Lagerbewegungen (Preflight 136)',
      case when has_table_privilege('public.inventory_movements', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.inventory_movements', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (237, 'Unveraendert', 'Legacy-Lagerereignisse (Preflight 137)',
      case when has_table_privilege('public.legacy_stock_events', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.legacy_stock_events', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  -- ------------------------------------------------- 0174: die Sicherungen
  (241, 'Sicherung', 'Betriebssicherung ist die Fassung aus 0174 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()')),
      '3a798f506f5f43e5b1b69dc242a1b16f'),
  (242, 'Sicherung', 'Plattformsicherung ist die Fassung aus 0174 (md5 des Rumpfs, format_version 3)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')),
      '23be72d581589b063d6938a863757b31'),
  (243, 'Sicherung', 'beide Sicherungen nennen jede der sieben Abgleichstabellen',
      (select count(*)::text from pg_proc p, unnest(array['sales_recon_sessions', 'sales_recon_files',
              'sales_recon_orders', 'sales_recon_matches', 'sales_recon_findings', 'sales_recon_decisions',
              'sales_recon_applications']) t(name)
        where p.oid in (to_regprocedure('public.seller_business_backup()'), to_regprocedure('public.system_platform_export()'))
          and p.prosrc like '%public.' || t.name || '%'), '14'),
  (244, 'Rechte', 'beide Sicherungen bleiben ohne EXECUTE fuer anon und PUBLIC',
      (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.seller_business_backup()'), to_regprocedure('public.system_platform_export()'))
          and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '0'),

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
