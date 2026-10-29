-- ===========================================================================
-- DIAGNOSE CAT-05I: die Audit-Constraint hat den Merge blockiert
--
-- DER BEFUND DES BETREIBERS (2026-10-28, erster echter Merge-Versuch)
--   SQLSTATE 23514, Constraint `catalog_admin_changes_field_known`
--   Zeile: entity=skylander, entity_id=SKY-0103, field=merged_from,
--          old_value=SKY-0824, new_value='2 Feld(er)'
--   Der ganze Vorgang wurde zurueckgerollt — richtig so, es ist EINE
--   Transaktion.
--
-- WAS DIESE DATEI FESTSTELLT, REIN LESEND:
--
--   401-404  DIE CONSTRAINT SELBST, wortgetreu. `0004` hat sie angelegt,
--            `0007` und `0033` haben sie erweitert; danach KEINE Migration
--            mehr. Ihre Liste kennt sieben Werte.
--   411-416  WELCHE FELDER WIRKLICH GESCHRIEBEN WERDEN. Drei Stellen
--            schreiben Werte, die in dieser Liste FEHLEN:
--              `catalog_status`  — der Trigger aus `0152` (schon angewendet!)
--              `merged_from`     — `admin_merge_draft` aus `0154`/`0156`
--              `discarded`       — `admin_discard_draft` aus `0155`
--            Der PGlite-Probelauf konnte das nie sehen: das Stub-Schema
--            traegt keine CHECK-Constraints. Deshalb war P60 gruen, obwohl
--            `0152` denselben Fehler ausloest.
--   421-424  OB ES SCHON SOLCHE ZEILEN GIBT. Stehen `catalog_status`-Zeilen
--            im Journal, waere die Constraint auf Staging doch weiter —
--            dann sagt die Datenbank etwas anderes als die Migrationen, und
--            das ist zu untersuchen, bevor irgendetwas geaendert wird.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with con as (
  select c.conname::text as name, pg_get_constraintdef(c.oid) as def, c.convalidated
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.contype = 'c'
),
pruef (nr, bereich, pruefung, befund) as (values
  (401, 'Constraint', 'catalog_admin_changes steht',
      (to_regclass('public.catalog_admin_changes') is not null)::text),
  (402, 'Constraint', 'alle CHECKs der Tabelle (Name)',
      (select coalesce(string_agg(name, ', ' order by name), '(keine)') from con)),
  /*
   * DIE ENTSCHEIDENDE ZEILE: der Wortlaut. Daran laesst sich ablesen, welche
   * Werte `field` haben darf — und `merged_from` ist nicht darunter.
   */
  (403, 'Constraint', 'Wortlaut von catalog_admin_changes_field_known',
      (select coalesce(max(def), '(fehlt)') from con
        where name = 'catalog_admin_changes_field_known')),
  (404, 'Constraint', 'ist sie geprueft (validated)?',
      (select coalesce(max(convalidated::text), '(fehlt)') from con
        where name = 'catalog_admin_changes_field_known')),

  -- ------------------- Welche Werte die drei Schreibstellen wirklich nennen
  /*
   * DIE ZWEITE ENTSCHEIDENDE ZEILE. `0152` hat `log_skylander_editorial_change`
   * ERSETZT, damit der Trigger auch `catalog_status` journalisiert — die
   * Constraint aber NICHT erweitert. Steht hier `true`, dann loest JEDER
   * Statuswechsel denselben Fehler 23514 aus, und zwar schon heute, ganz
   * ohne Zusammenfuehrung.
   *
   * Dass `0152` trotzdem durchgelaufen ist, hat einen Grund und keinen
   * Widerspruch: der Backfill laeuft in Abschnitt 2, die Ersetzung des
   * Triggers erst in Abschnitt 5. Die 626 Backfill-Zeilen sahen den neuen
   * Trigger also nie.
   */
  (411, 'Schreibstellen', 'der ERSETZTE Journaltrigger (0152) schreibt catalog_status',
      (select coalesce(max((p.prosrc like '%''catalog_status''%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.log_skylander_editorial_change()'))),
  (417, 'Schreibstellen', 'admin_set_catalog_status schreibt selbst ins Journal?',
      (select coalesce(max((p.prosrc like '%catalog_admin_changes%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_catalog_status(text,text)'))),
  (412, 'Schreibstellen', 'admin_merge_draft(…,jsonb) schreibt merged_from',
      (select coalesce(max((p.prosrc like '%merged_from%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))),
  (413, 'Schreibstellen', 'admin_discard_draft schreibt discarded',
      (select coalesce(max((p.prosrc like '%''discarded''%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_discard_draft(text)'))),
  (414, 'Schreibstellen', 'der Journaltrigger aus 0004/0033 — welche Felder er nennt',
      (select coalesce(max(
          case when p.prosrc like '%catalog_visible%' then 'catalog_visible ' else '' end
       || case when p.prosrc like '%display_name_override%' then 'display_name_override ' else '' end
       || case when p.prosrc like '%image_override_path%' then 'image_override_path ' else '' end
       || case when p.prosrc like '%card_type%' then 'card_type' else '' end), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.log_skylander_editorial_change()'))),
  (415, 'Schreibstellen', 'schreibt der Journaltrigger auch name? (dann waere name noetig)',
      (select coalesce(max((p.prosrc like '%new.name is distinct%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.log_skylander_editorial_change()'))),
  (416, 'Schreibstellen', 'admin_create_figure schreibt created (erlaubt)',
      (select coalesce(max((p.prosrc like '%''created''%')::text), '(fehlt)')
         from pg_proc p
        where p.proname = 'admin_create_figure'
          and p.pronamespace = to_regnamespace('public') limit 1)),

  -- ---------------------------- Gibt es solche Zeilen schon im Journal?
  (421, 'Journal', 'Zeilen je field (nur die Namen und Zahlen)',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select coalesce(string_agg(f || ':' || n::text, ', ' order by f), '(leer)') as c from (select field as f, count(*) as n from public.catalog_admin_changes group by field) x$q$,
                 false, true, '')))[1]::text, '(leer)')
           else 'KEIN-RECHT' end),
  (422, 'Journal', 'Zeilen mit field = catalog_status',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.catalog_admin_changes where field = 'catalog_status'$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end),
  (423, 'Journal', 'Zeilen mit field = merged_from oder discarded',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.catalog_admin_changes where field in ('merged_from','discarded')$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end),
  (424, 'Journal', 'Entwuerfe mit interner Notiz, und wie viele den veralteten Bildhinweis tragen',
      case when has_table_privilege('public.catalog_editorial', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text || ' mit Notiz, davon ' || count(*) filter (where e.admin_note like '%Bildrechte ungeklaert%')::text || ' veraltet' as c from public.catalog_editorial e join public.skylanders s on s.sky_id = e.sky_id where s.catalog_status = 'draft'$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end)
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
