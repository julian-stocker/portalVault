-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0178 (VERGLEICHSWERTE UND AUSSTEHENDE AENDERUNGEN
--           DES VERKAUFSABGLEICHS), REIN LESEND
--
-- VOR `supabase/operations/staging-0178.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0178 TUT (ADR-0174, Phase 4). Es ersetzt den Rumpf von
-- `seller_recon_session(bigint, text, integer, integer)` — dieselbe Signatur,
-- dieselben Rechte, jeder bisherige Schluessel, dazu `ledger` je Zuordnung —
-- und legt `seller_recon_pending(bigint)` sowie drei interne Hilfsfunktionen
-- an. `seller_recon_decide` und `seller_recon_apply` bleiben, wie sie sind.
-- KEINE Datenanweisung.
--
--   101-107  DIE GRUNDLAGE: die Lesefunktion aus 0172 (Riegel), Apply aus
--            0173, Decide aus 0172, die Pruefung aus 0176, die Sperre, die
--            Rechte und der leere search_path der Lesefunktion.
--   111-112  SIE STEHT NOCH NICHT: keine der vier neuen Funktionen.
--   131-137  AUSKUNFT: die sieben Abgleichstabellen, jede Spalte.
--   141-146  AUSKUNFT: Verkaeufe, Positionen, Erstattungen, Lagerbewegungen,
--            Altbestandsereignisse, Orderbuch-Journal, jede Spalte.
--   151-153  AUSKUNFT: die Rechte jeder Funktion und Tabelle und jede Policy
--            in `public` — Verkaeufer- und Sammlungsrechte eingeschlossen.
--            Die Nachkontrolle nennt dieselben Werte in 231-253; die
--            Einfuege-Huelle vergleicht sie in derselben Transaktion
--            BLOCKIEREND (Z1).
--   300-311, 900, 901  der Basis-Vertrag (Shop, Lager, Sammlung) wie bei 0176.
--
-- GESCHUETZTE TABELLEN. Die Abgleichs- und Orderbuchtabellen sind dem lesenden
-- Pruefzugang NICHT geteilt. Ihre Zeilen stehen hinter `has_table_privilege` +
-- `query_to_xml`: fuer den Pruefzugang `KEIN-RECHT` (Zeile 9998 zaehlt sie,
-- sie blockieren nicht), im SQL-Editor als `postgres` gemessen. Ausgegeben
-- werden nur Anzahlen und md5-Abdruecke, nie ein Wert.
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
  (101, 'Grundlage', 'seller_recon_session ist die Fassung aus 0172 (md5 des Rumpfs) — sonst haelt 0178 an',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)')),
      '42c2f33b00fa40040a36e2a71637e724'),
  (102, 'Grundlage', 'seller_recon_apply ist die Fassung aus 0173 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_apply(bigint,integer)')),
      'f8b1132c27ba1b18123f6c2548f9997c'),
  (103, 'Grundlage', 'seller_recon_decide ist die Fassung aus 0172 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)')),
      '2526d3a77ccf3153158182d0ecd391aa'),
  (104, 'Grundlage', 'sales_recon_validate_payload ist die Fassung aus 0176 — 0178 setzt 0176 voraus',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_validate_payload(jsonb)')),
      '44441ee3b50a6bbf4f4fcbfda21d0e93'),
  (105, 'Grundlage', 'die Verkaeufersperre steht: sales_recon_gate() und can_operate_active_seller()',
      ((to_regprocedure('public.sales_recon_gate()') is not null)
       and (to_regprocedure('public.can_operate_active_seller()') is not null))::text, 'true'),
  (106, 'Grundlage', 'seller_recon_session: authenticated darf, anon und PUBLIC nicht',
      (select (has_function_privilege('authenticated', to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))::text
         ), 'true'),
  (107, 'Grundlage', 'seller_recon_session: SECURITY DEFINER, genau eine search_path-Festlegung, ihr Wert leer',
      (select (p.prosecdef
               and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
               and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                      from unnest(p.proconfig) c where c like 'search\_path=%'))::text
         from pg_proc p where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)')), 'true'),
  (111, 'Luecke', 'seller_recon_pending steht noch nicht',
      (to_regprocedure('public.seller_recon_pending(bigint)') is null)::text, 'true'),
  (112, 'Luecke', 'die drei Hilfsfunktionen stehen noch nicht (pending_set, sale_values, at_analysis)',
      ((to_regprocedure('public.sales_recon_pending_set(bigint)') is null)
       and (to_regprocedure('public.sales_recon_sale_values(bigint)') is null)
       and (to_regprocedure('public.sales_recon_at_analysis(boolean,jsonb,jsonb)') is null))::text, 'true'),

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

  (151, 'Auskunft', 'Rechte, SECURITY DEFINER und search_path jeder Funktion in public ausser den vier neuen: Abdruck',
      (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                             || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                             chr(10) order by p.oid::regprocedure::text))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname not in ('seller_recon_pending', 'sales_recon_pending_set', 'sales_recon_sale_values', 'sales_recon_at_analysis')), null),
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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0178 ruehrt das nicht an)',
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
