-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND VOR 0157, REIN LESEND
--
-- VOR `0157_audit_fields_and_automatic_notes.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
--   101-106  DIE GRUNDLAGE: `0156` muss stehen, denn `0157` ersetzt zwei
--            seiner Funktionsruempfe und setzt seine Signaturen voraus.
--   111-116  DIE CONSTRAINT, WIE SIE HEUTE LAUTET — und der Nachweis, dass
--            sie die drei Werte NICHT kennt. Das ist der Grund dieser
--            Migration: `merged_from` hat den ersten echten Merge mit
--            `23514` abgewiesen, und `catalog_status` trifft schon heute
--            jeden Statuswechsel.
--   121-126  WAS WIRKLICH GESCHRIEBEN WIRD, aus den Funktionsruempfen der
--            laufenden Datenbank gelesen — nicht aus einer Vermutung. Nur
--            was hier steht, kommt in die Liste.
--   131-134  `merge_note` gibt es noch nicht, und `admin_note` steht heute
--            noch in der Allowlist.
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
  (102, 'Grundlage', 'catalog_admin_changes steht (0004)',
      (to_regclass('public.catalog_admin_changes') is not null)::text, 'true'),
  (103, 'Grundlage', 'admin_merge_draft(text,text,text,jsonb) steht (0156)',
      (to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)') is not null)::text, 'true'),
  (104, 'Grundlage', 'admin_merge_plan(text,text,text) steht (0156)',
      (to_regprocedure('public.admin_merge_plan(text,text,text)') is not null)::text, 'true'),
  (105, 'Grundlage', 'admin_merge_references(text) steht (0154)',
      (to_regprocedure('public.admin_merge_references(text)') is not null)::text, 'true'),
  (106, 'Grundlage', 'catalog_editorial steht (0041)',
      (to_regclass('public.catalog_editorial') is not null)::text, 'true'),

  -- -------------------------------------- Die Constraint, wie sie heute lautet
  (111, 'Constraint', 'catalog_admin_changes_field_known steht',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), '1'),
  (112, 'Constraint', 'Info: ihr heutiger Wortlaut',
      (select coalesce(max(pg_get_constraintdef(c.oid)), '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), null),
  (113, 'Constraint', 'sie ist geprueft (validated)',
      (select coalesce(max(c.convalidated::text), '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  /*
   * DIE DREI ZEILEN, DIE DEN ANLASS BELEGEN. Steht hier irgendwo `true`,
   * dann kennt die Constraint den Wert schon und dieser Lauf bringt ihn
   * nicht erst — dann ist zu klaeren, woher er kommt.
   */
  (114, 'Constraint', 'sie kennt merged_from NICHT (der Anlass)',
      (select coalesce(max((pg_get_constraintdef(c.oid) not like '%merged_from%')::text),
                       '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (115, 'Constraint', 'sie kennt catalog_status NICHT (trifft schon heute jeden Statuswechsel)',
      (select coalesce(max((pg_get_constraintdef(c.oid) not like '%catalog_status%')::text),
                       '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (116, 'Constraint', 'sie kennt discarded NICHT',
      (select coalesce(max((pg_get_constraintdef(c.oid) not like '%discarded%')::text),
                       '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),

  -- ------------------------------- Was wirklich geschrieben wird
  (121, 'Schreibstellen', 'der Journaltrigger schreibt catalog_status (0152)',
      (select coalesce(max((p.prosrc like '%''catalog_status''%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.log_skylander_editorial_change()')), 'true'),
  (122, 'Schreibstellen', 'admin_merge_draft schreibt merged_from',
      (select coalesce(max((p.prosrc like '%merged_from%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),
  (123, 'Schreibstellen', 'admin_discard_draft schreibt discarded',
      (select coalesce(max((p.prosrc like '%''discarded''%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_discard_draft(text)')), 'true'),
  (124, 'Schreibstellen', 'der Journaltrigger schreibt NICHT name (dann waere name noetig)',
      (select coalesce(max((p.prosrc not like '%new.name is distinct%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.log_skylander_editorial_change()')), 'true'),
  (125, 'Schreibstellen', 'Info: Zeilen im Journal, die diese Rolle nicht lesen darf',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then 'lesbar' else 'KEIN-RECHT' end, null),
  (126, 'Schreibstellen', 'Info: die CHECKs der Tabelle',
      (select coalesce(string_agg(c.conname::text, ', ' order by c.conname), '(keine)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.contype = 'c'), null),

  -- ------------------------------------------ Was es noch nicht gibt
  (131, 'Noch nicht da', 'merge_note(text,text) gibt es nicht',
      (to_regprocedure('public.merge_note(text,text)') is null)::text, 'true'),
  (132, 'Noch nicht da', 'admin_note steht heute noch in der Allowlist',
      (select coalesce(max((p.prosrc like '%''admin_note''%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),
  (133, 'Noch nicht da', 'und der Plan nennt sie heute noch',
      (select coalesce(max((p.prosrc like '%''admin_note''%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_plan(text,text,text)')), 'true'),
  (134, 'Noch nicht da', 'Info: Entwuerfe insgesamt (moegliche Faelle)',
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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0157 ruehrt das nicht an)',
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
