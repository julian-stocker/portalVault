-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND VOR 0156, REIN LESEND
--
-- VOR `0156_merge_selected_fields.sql` fahren. **Erwartet: Zeile 9999 = `0`.**
--
--   101-106  DIE GRUNDLAGE, und die wichtigste ist `0154`: beide Funktionen
--            der Zusammenfuehrung MUESSEN stehen. `0156` ersetzt die eine
--            durch eine Weiterleitung und legt die neue Fassung daneben; auf
--            einer Datenbank ohne `0154` waere das keine Erweiterung,
--            sondern eine halbe Einfuehrung.
--   111-112  DASS ES `admin_merge_plan` und die Vierparameterfassung noch
--            nicht gibt.
--   121-124  DER AUSGANGSZUSTAND der Zusammenfuehrung: wie viele Entwuerfe
--            es ueberhaupt gibt, wie viele Fassungen von `admin_merge_draft`
--            heute stehen (es muss GENAU EINE sein, sonst ersetzt `0156`
--            nicht das, was es meint), und dass heute kein offenes
--            EXECUTE-Recht darauf liegt.
--
-- `0155` ist KEINE Vorbedingung: `admin_discard_draft` wird nicht angefasst.
-- Zeile 105 fragt sie nur als Auskunft ab.
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
  (101, 'Grundlage', 'skylanders steht (0001)',
      (to_regclass('public.skylanders') is not null)::text, 'true'),
  (102, 'Grundlage', 'is_platform_admin() steht (0026/0077)',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  /*
   * DIE ECHTE ABHAENGIGKEIT. `0156` setzt `0154` voraus — es ersetzt dessen
   * Dreiparameterfassung durch eine Weiterleitung und benutzt dessen
   * Referenzzaehlung. Fehlte eine der beiden, entstuende eine halbe
   * Einfuehrung: eine neue Funktion, die eine fehlende aufruft.
   */
  (103, 'Grundlage', 'admin_merge_draft(text,text,text) steht (0154)',
      (to_regprocedure('public.admin_merge_draft(text,text,text)') is not null)::text, 'true'),
  (104, 'Grundlage', 'admin_merge_references(text) steht (0154) — 0156 benutzt sie',
      (to_regprocedure('public.admin_merge_references(text)') is not null)::text, 'true'),
  (105, 'Grundlage', 'Info: admin_discard_draft(text) steht (0155, nicht erforderlich)',
      (to_regprocedure('public.admin_discard_draft(text)') is not null)::text, null),
  (106, 'Grundlage', 'skylanders.catalog_status steht (0152)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), '1'),

  -- ------------------------------------------ Die Funktionen gibt es noch nicht
  (111, 'Noch nicht da', 'admin_merge_plan(text,text,text) gibt es nicht',
      (to_regprocedure('public.admin_merge_plan(text,text,text)') is null)::text, 'true'),
  (112, 'Noch nicht da', 'admin_merge_draft(text,text,text,jsonb) gibt es nicht',
      (to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)') is null)::text, 'true'),

  -- --------------------------------- Der Ausgangszustand der Zusammenfuehrung
  /*
   * GENAU EINE FASSUNG. `create or replace` trifft eine Signatur; stuenden
   * heute zwei Fassungen von `admin_merge_draft`, ersetzte `0156` nur eine
   * davon und die andere liefe mit der alten Logik weiter. Das waere der
   * stille Fall, den diese Zeile verhindert.
   */
  (121, 'Ausgangszustand', 'genau EINE Fassung von admin_merge_draft steht heute',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_merge_draft'), '1'),
  (122, 'Ausgangszustand', 'sie ist security definer',
      (select p.prosecdef::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text)')), 'true'),
  (123, 'Ausgangszustand', 'kein offenes EXECUTE-Recht auf ihr',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text)')
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))), '0'),
  (124, 'Ausgangszustand', 'Info: Entwuerfe insgesamt (moegliche Faelle)',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), null),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0156 ruehrt das nicht an)',
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
