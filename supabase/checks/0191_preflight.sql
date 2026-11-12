-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0191 (CREATE_ORDER MIT DEN ANGEZEIGTEN
--           RECHTSFASSUNGEN, NEBEN DER BISHERIGEN), REIN LESEND
--
-- VOR `supabase/operations/staging-0191.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0191 TUT. Eine zweite Ueberladung create_order(…, p_agb_version,
-- p_widerruf_version) mit den Rechten der bisherigen. Keine Daten, kein
-- bestehender Rumpf, kein bestehendes Recht.
--
--   101-106  DIE GRUNDLAGE: die Sechser ist der Rumpf aus 0139 (SECURITY
--            DEFINER, leerer search_path); die Achter steht NOCH NICHT (ein
--            zweiter Lauf zeigt sich hier); legal_document_versions und der
--            Snapshot-Trigger stehen; Auskunft: wer die Sechser ausfuehren darf.
--   141-143  AUSKUNFT: Bestellsnapshots, Bestellungen und Rechnungen.
--   151-153  AUSKUNFT: Rechte und Ruempfe jeder Funktion ausser der neuen,
--            Rechte jeder Tabelle, jede Policy (Nachkontrolle 241-253, Huelle Z1).
--   300-307, 900, 901  der Basis-Vertrag (Shop, Lager, Sammlung) wie bei 0180.
--
-- SIE SCHREIBT NICHTS.
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
  (101, 'Grundlage', 'create_order (sechs Parameter) ist der Rumpf aus 0139',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)')), 'c233337c0ca0555756f21e1abe173593'),
  (102, 'Grundlage', 'create_order gibt es genau einmal — die Achter steht NOCH NICHT (ein zweiter Lauf zeigt sich hier)',
      (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_order'), '1'),
  (103, 'Grundlage', 'die Sechser: SECURITY DEFINER, genau ein leerer search_path — die Achter uebernimmt diese Form',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')), '1'),
  (104, 'Grundlage', 'legal_document_versions steht (0047), die Achter liest sie unter for share',
      (select (to_regclass('public.legal_document_versions') is not null)::text), 'true'),
  (105, 'Grundlage', 'der Snapshot-Trigger aus 0047 steht und ist aktiv',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.orders') and t.tgname = 'orders_snapshot_legal_trg' and t.tgenabled <> 'D'), '1'),
  (106, 'Auskunft', 'wer die Sechser ausfuehren darf (die Achter erhaelt genau diese Empfaenger)',
      (select coalesce(string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by a.grantee), '(keine)')
         from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)') and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), null),
  (107, 'Grundlage', 'legal_versions_public() steht NOCH NICHT oder schon mit dem Rumpf aus 0191 (eine andere Fassung bricht 0191 ab)',
      (select coalesce((select (md5(p.prosrc) = '5e9daa01284d9b06b1b7d8fb053cff36')::text from pg_proc p where p.oid = to_regprocedure('public.legal_versions_public()')), 'fehlt')), null),
  (108, 'Grundlage', 'legal_document_versions bleibt fuer anon und authenticated gesperrt (die Lesefunktion ist der einzige Weg)',
      (select (has_table_privilege('anon', 'public.legal_document_versions', 'select')
               or has_table_privilege('authenticated', 'public.legal_document_versions', 'select'))::text), 'false'),

  -- ------------------------------------- Was sich nicht bewegen darf (Auskunft)
  (141, 'Auskunft', 'Bestellsnapshots: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.order_legal_snapshots', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.order_id)), ''(leer)'') as c from public.order_legal_snapshots t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (142, 'Auskunft', 'Bestellungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.orders', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.orders t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (143, 'Auskunft', 'Rechnungen: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.invoices', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), ''(leer)'') as c from public.invoices t', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  (151, 'Auskunft', 'Rechte, SECURITY DEFINER und search_path jeder Funktion in public ausser der neuen Achter und legal_versions_public(): Abdruck',
      (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                             || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                             chr(10) order by p.oid::regprocedure::text))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.oid <> coalesce(to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)'), 0) and p.oid <> coalesce(to_regprocedure('public.legal_versions_public()'), 0)), null),
  (152, 'Auskunft', 'Rechte und RLS-Schalter jeder Tabelle, Sicht und Sequenz in public: Abdruck',
      (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                             || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') ), null),
  (153, 'Auskunft', 'jede Policy in public: Abdruck',
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
