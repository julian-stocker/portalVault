-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0180 (AUSGEWAEHLTE, NACHGEWIESENE UEBERNAHME),
--           REIN LESEND
--
-- VOR `supabase/operations/staging-0180.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0180 TUT (ADR-0178). Es ersetzt die Ruempfe von `seller_recon_decide`
-- (0172), `seller_recon_pending` (0178) und `seller_recon_apply(bigint,
-- integer)` (0173; danach weist sie jeden Aufruf ab und hat kein Clientrecht
-- mehr) und legt sieben Funktionen an: die Vorschau
-- `seller_recon_preview(bigint, bigint[])`, die Uebernahme
-- `seller_recon_apply(bigint, bigint[], text)` und fuenf interne Helfer.
-- KEINE Datenanweisung.
--
--   101-109  DIE GRUNDLAGE: Decide (0172), Apply (0173), Pending (0178) als
--            Riegel; Lesefunktion, Ledger, Nachweis (0179), pending_set und
--            sale_values (0178), die Sperre, die Rechte der alten Uebernahme,
--            SECURITY DEFINER und leerer search_path der drei Ersetzten.
--   111      SIE STEHT NOCH NICHT: keine der sieben neuen Funktionen.
--   131-137  AUSKUNFT: die sieben Abgleichstabellen, jede Spalte.
--   141-146  AUSKUNFT: Verkaeufe, Positionen, Erstattungen, Lagerbewegungen,
--            Altbestandsereignisse, Orderbuch-Journal, jede Spalte.
--   151-153  AUSKUNFT: die Rechte jeder Funktion (ausser den neuen und den
--            beiden Apply-Fassungen, deren Rechte 0180 bewusst aendert und die
--            Nachkontrolle einzeln prueft) und Tabelle in `public` und jede
--            Policy. Die Nachkontrolle nennt dieselben Werte in 231-253; die
--            Einfuege-Huelle vergleicht sie BLOCKIEREND (Z1).
--   300-311, 900, 901  der Basis-Vertrag (Shop, Lager, Sammlung) wie bei 0179.
--
-- GESCHUETZTE TABELLEN hinter `has_table_privilege` + `query_to_xml`: fuer den
-- Pruefzugang `KEIN-RECHT` (9998), im SQL-Editor als `postgres` gemessen.
-- Ausgegeben werden nur Anzahlen und md5-Abdruecke, nie ein Wert.
--
-- SIE SCHREIBT NICHTS UND RUFT KEINE ABGLEICHSFUNKTION AUF.
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
  (101, 'Grundlage', 'seller_recon_decide ist die Fassung aus 0172 (md5 des Rumpfs) — sonst haelt 0180 an',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)')),
      '2526d3a77ccf3153158182d0ecd391aa'),
  (102, 'Grundlage', 'seller_recon_apply(bigint, integer) ist die Fassung aus 0173 — sonst haelt 0180 an',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_apply(bigint,integer)')),
      'f8b1132c27ba1b18123f6c2548f9997c'),
  (103, 'Grundlage', 'seller_recon_pending ist die Fassung aus 0178 — sonst haelt 0180 an',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_pending(bigint)')),
      '51213fd88afb5441a487dc89bba2ac06'),
  (104, 'Grundlage', 'seller_recon_session ist die Fassung aus 0179 — 0180 setzt 0179 voraus',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)')),
      '5ed52447581cc895efc6a56f268c0da3'),
  (105, 'Grundlage', 'sales_recon_ledger und sales_recon_proven sind die Fassungen aus 0179',
      (select string_agg(md5(p.prosrc), ',' order by p.proname) from pg_proc p
        where p.oid in (to_regprocedure('public.sales_recon_ledger(bigint)'),
                        to_regprocedure('public.sales_recon_proven(jsonb,text,jsonb,boolean)'))),
      '07875fe3ba889fefab1c55dbe67005d9,b7b36ccd5efdd57e661808b62274df68'),
  (106, 'Grundlage', 'sales_recon_pending_set und sales_recon_sale_values sind die Fassungen aus 0178',
      (select string_agg(md5(p.prosrc), ',' order by p.proname) from pg_proc p
        where p.oid in (to_regprocedure('public.sales_recon_pending_set(bigint)'),
                        to_regprocedure('public.sales_recon_sale_values(bigint)'))),
      '3228eb12e00d7982c5cad5c42ea6f773,4c4a01eb05adb6d439450063f04eada9'),
  (107, 'Grundlage', 'die Verkaeufersperre steht: sales_recon_gate() und can_operate_active_seller()',
      ((to_regprocedure('public.sales_recon_gate()') is not null)
       and (to_regprocedure('public.can_operate_active_seller()') is not null))::text, 'true'),
  (108, 'Grundlage', 'seller_recon_apply(bigint, integer): authenticated darf, anon und PUBLIC nicht — 0180 entzieht das',
      (select (has_function_privilege('authenticated', to_regprocedure('public.seller_recon_apply(bigint,integer)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_recon_apply(bigint,integer)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_recon_apply(bigint,integer)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))::text
         ), 'true'),
  (109, 'Grundlage', 'Decide, Pending und alte Uebernahme: SECURITY DEFINER, genau eine search_path-Festlegung, ihr Wert leer',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)'),
                        to_regprocedure('public.seller_recon_pending(bigint)'),
                        to_regprocedure('public.seller_recon_apply(bigint,integer)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')), '3'),
  (111, 'Luecke', 'keine der sieben neuen Funktionen von 0180 steht schon',
      (select count(*)::text from unnest(array['sales_recon_allowed_0180(text)', 'sales_recon_take_check(bigint)', 'sales_recon_decision_problem(bigint,bigint)', 'sales_recon_check_selection(bigint[])', 'sales_recon_selection(bigint,bigint[])', 'seller_recon_preview(bigint,bigint[])', 'seller_recon_apply(bigint,bigint[],text)']) f where to_regprocedure('public.' || f) is not null), '0'),

  -- ------------------------------------- Was sich nicht bewegen darf (Auskunft)
  (131, 'Auskunft', 'Sitzungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales_recon_sessions', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_sessions t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (132, 'Auskunft', 'Dateien: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales_recon_files', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_files t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (133, 'Auskunft', 'Bestellungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales_recon_orders', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_orders t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (134, 'Auskunft', 'Zuordnungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales_recon_matches', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_matches t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (135, 'Auskunft', 'Befunde: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales_recon_findings', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_findings t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (136, 'Auskunft', 'Entscheidungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales_recon_decisions', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_decisions t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (137, 'Auskunft', 'Uebernahmen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales_recon_applications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales_recon_applications t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  (141, 'Auskunft', 'Verkaeufe: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sales t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (142, 'Auskunft', 'Verkaufspositionen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sale_items', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sale_items t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (143, 'Auskunft', 'Erstattungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sale_refunds', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.sale_refunds t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (144, 'Auskunft', 'Lagerbewegungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.inventory_movements', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.inventory_movements t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (145, 'Auskunft', 'Altbestandsereignisse: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.legacy_stock_events', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.legacy_stock_events t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (146, 'Auskunft', 'Orderbuch-Journal: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.orderbook_audit', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.orderbook_audit t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  (151, 'Auskunft', 'Rechte, SECURITY DEFINER und search_path jeder Funktion in public ausser den neuen und den beiden Apply-Fassungen: Abdruck',
      (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                             || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                             chr(10) order by p.oid::regprocedure::text))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname not in ('sales_recon_allowed_0180', 'sales_recon_take_check', 'sales_recon_decision_problem', 'sales_recon_check_selection', 'sales_recon_selection', 'seller_recon_preview', 'seller_recon_apply')), null),
  (152, 'Auskunft', 'Rechte und RLS-Schalter jeder Tabelle, Sicht und Sequenz in public: Abdruck',
      (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                             || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')), null),
  (153, 'Auskunft', 'jede Policy in public (Verkaeufer, Sammlung, alles): Abdruck',
      (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                             || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                             chr(10) order by pl.tablename, pl.policyname)), '(keine)')
         from pg_policies pl where pl.schemaname = 'public'), null),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0180 ruehrt das nicht an)',
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
