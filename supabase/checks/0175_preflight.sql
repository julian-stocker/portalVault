-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0175 (KONTOLOESCHUNG IM VERKAUFSABGLEICH), REIN LESEND
--
-- VOR `supabase/operations/staging-0175.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0175 TUT (ADR-0176). Es ersetzt NUR den Rumpf von
-- `sales_recon_evidence_is_append_only()`: ein Konto, das im Abgleich
-- entschieden oder angewendet hat, laesst sich wieder loeschen — der
-- Kontoverweis wird dabei leer, sonst aendert sich nichts. Trigger,
-- Fremdschluessel, Rechte und Zeilen bleiben. KEINE Datenanweisung.
--
--   101-105  DIE GRUNDLAGE: Tabellen, zwei Trigger, der Rumpf aus 0169 (Riegel),
--            keine Clientrolle, die zwei Fremdschluessel mit on delete set null.
--   131-133  AUSKUNFT: die Belege ohne Kontoverweis, dazu die gesetzten
--            Kontoverweise — die Nachkontrolle nennt dieselben in 231-233.
--
-- GESCHUETZTE TABELLEN. Die Abgleichstabellen sind dem lesenden Pruefzugang
-- NICHT geteilt (ADR-0174). Ihre Zeilen stehen hinter `has_table_privilege` +
-- `query_to_xml`: fuer den Pruefzugang `KEIN-RECHT` (Zeile 9998 zaehlt sie,
-- sie blockieren nicht), im SQL-Editor als `postgres` gemessen.
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
  (101, 'Grundlage', 'die beiden Belegtabellen aus 0169 stehen',
      ((to_regclass('public.sales_recon_decisions') is not null and to_regclass('public.sales_recon_applications') is not null))::text, 'true'),
  (102, 'Grundlage', 'die zwei Nur-Erweitern-Trigger stehen, BEFORE UPDATE OR DELETE, aktiv',
      (select count(*)::text from pg_trigger t
        where t.tgrelid in (to_regclass('public.sales_recon_decisions'), to_regclass('public.sales_recon_applications'))
          and not t.tgisinternal and t.tgenabled = 'O'
          and t.tgtype & 27 = 27 and t.tgfoid = to_regprocedure('public.sales_recon_evidence_is_append_only()')), '2'),
  (103, 'Grundlage', 'die Triggerfunktion ist die Fassung aus 0169 (md5 des Rumpfs)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_recon_evidence_is_append_only()')),
      'aedd3c64076884fbf29d0308f5e26ec7'),
  (104, 'Grundlage', 'keine Clientrolle darf die Triggerfunktion ausfuehren',
      (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = to_regprocedure('public.sales_recon_evidence_is_append_only()') and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))), '0'),
  (105, 'Grundlage', 'decided_by und applied_by verweisen auf auth.users mit on delete set null',
      (select count(*)::text from pg_constraint c
        where c.conname in ('sales_recon_decisions_decided_by_fk', 'sales_recon_applications_applied_by_fk')
          and c.contype = 'f' and c.confdeltype = 'n'), '2'),

  -- ------------------------------------- Was sich nicht bewegen darf (Auskunft)
  (131, 'Auskunft', 'Entscheidungen: Anzahl|Abdruck ohne decided_by',
      case when has_table_privilege('public.sales_recon_decisions', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg((to_jsonb(d) - ''decided_by'')::text, chr(10) order by d.id)), ''(leer)'') as c from public.sales_recon_decisions d', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (132, 'Auskunft', 'Anwendungen: Anzahl|Abdruck ohne applied_by',
      case when has_table_privilege('public.sales_recon_applications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg((to_jsonb(a) - ''applied_by'')::text, chr(10) order by a.id)), ''(leer)'') as c from public.sales_recon_applications a', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (133, 'Auskunft', 'Kontoverweise gesetzt: Entscheidungen|Anwendungen',
      case when has_table_privilege('public.sales_recon_decisions', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select (select count(*) from public.sales_recon_decisions where decided_by is not null)::text || ''|'' || (select count(*) from public.sales_recon_applications where applied_by is not null)::text as c', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0175 ruehrt das nicht an)',
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
