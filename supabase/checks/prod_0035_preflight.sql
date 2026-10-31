-- ===========================================================================
-- PRODUCTION — PREFLIGHT ZU 0035, REIN LESEND
--
-- EINE ANWEISUNG, kein `begin`, kein `do`, kein `set_config`. Im SQL-Editor
-- des Projekts zmiwxswrpkmizvqsgype als `postgres`.
-- **Erwartet: Zeile 9999 = `0`.** Zeile 900 ist die Baseline — vollstaendig
-- kopieren und in den Postflight eintragen.
--
--   101-104  DIE UMGEBUNG, positiv und am Schema
--   111-116  DIE FUNKTION LIEGT NICHT, und alles, was sie braucht, liegt
--   121-124  DER VERGLEICH MIT STAGING, soweit er von hier moeglich ist
--   131-134  DIE BILDVERWEISE und wer sie gesetzt hat
-- ===========================================================================

with
fn as (
  select p.oid, p.proname::text as name from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
),
mess as (
  select
    (select count(*)::text from public.skylanders)            as katalogzeilen,
    (select count(*)::text from public.catalog_admin_changes) as journalzeilen,
    (select count(*)::text from public.shop_inventory)        as lagerzeilen,
    (select count(*)::text from public.collection_items)      as sammlungszeilen,
    (select count(*)::text from public.skylanders
      where image_override_path is not null)                  as mit_bildverweis,
    (select coalesce(md5(string_agg(s.sky_id || '|' || coalesce(s.image_override_path, '~'),
                                    chr(10) order by s.sky_id collate "C")), '(leer)')
       from public.skylanders s)                              as bildabdruck
),
feld as (
  select katalogzeilen || '|' || journalzeilen || '|' || lagerzeilen || '|'
      || sammlungszeilen || '|' || mit_bildverweis || '|' || bildabdruck as kern, m.*
    from mess m
),
baseline as (
  select 'skyisles-p0035-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.* from feld f
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (101, 'Umgebung', '0133: die Triggerfunktion liegt — nur auf Production',
      (select (to_regprocedure('public.purchases_paid_total_is_final()') is not null)::text),
      'true'),
  (102, 'Umgebung', '0133: und ihr Trigger auf purchases auch',
      (select (count(*) > 0)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.purchases')
          and t.tgname = 'purchases_paid_total_immutable_trg' and not t.tgisinternal),
      'true'),
  (103, 'Umgebung', 'sky_id_seq traegt NICHT das Staging-Band',
      (select (count(*) = 0)::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'
          and min_value = 928 and max_value = 4999), 'true'),
  (104, 'Umgebung', 'Info: das Production-Band steht',
      (select min_value::text || '..' || max_value::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'), null),

  (111, 'Funktion', 'system_set_image_override liegt NICHT — in keiner Fassung',
      (select count(*)::text from fn where name = 'system_set_image_override'), '0'),
  (112, 'Vorbedingung', 'skylanders.image_override_path steht',
      (select (count(*) = 1)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'image_override_path' and not a.attisdropped), 'true'),
  (113, 'Vorbedingung', 'die Journal-Constraint laesst image_override_path zu',
      (select (coalesce(pg_get_constraintdef(c.oid), '') like '%''image_override_path''%')::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (114, 'Vorbedingung', 'die Rolle service_role gibt es',
      (select (count(*) = 1)::text from pg_roles where rolname = 'service_role'), 'true'),
  (115, 'Vorbedingung', 'der Trigger skylanders_log_editorial steht (0004) — er '
                        'schreibt die Journalzeile',
      (select (count(*) > 0)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_log_editorial' and not t.tgisinternal), 'true'),
  (116, 'Vorbedingung', 'heute hat niemand EXECUTE darauf — sie liegt ja nicht',
      (select coalesce(string_agg(g.grantee, ',' order by g.grantee collate "C"), '(keiner)')
         from (select distinct (aclexplode(p.proacl)).grantee::regrole::text as grantee
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'system_set_image_override') g),
      '(keiner)'),

  /*
   * DER VERGLEICH MIT STAGING ist von hier nur halb moeglich — diese Datei
   * sieht nur eine Datenbank. Was sie leisten kann: den Weg nennen, der auf
   * BEIDEN liegt, und den Rumpfabdruck melden, den die Migrationsdatei
   * vorgibt. Die Gegenprobe gegen Staging faehrt
   * `supabase/checks/cat09_delete_references.sql`-artig der Betreiber, oder
   * sie ergibt sich aus dem Postflight: dort MUSS der Abdruck
   * `f269a6fe05349cad53c0cf44a8e01e11` herauskommen — derselbe Wert, den der
   * Rumpf aus `supabase/migrations/0035_system_set_image_override.sql`
   * ergibt (889 Zeichen, am 2026-10-30 nachgerechnet).
   */
  (121, 'Vergleich', 'admin_set_image_override liegt hier — der ADMINweg ist da, '
                     'nur der serverseitige fehlt',
      (select (count(*) > 0)::text from fn where name = 'admin_set_image_override'), 'true'),
  (122, 'Vergleich', 'Info: der erwartete Rumpfabdruck nach dem Lauf',
      'f269a6fe05349cad53c0cf44a8e01e11', null),
  (123, 'Vergleich', 'keine andere Funktion nennt system_set_image_override im Rumpf',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and position('system_set_image_override' in p.prosrc) > 0),
      '0'),

  /*
   * WER HAT DIE BILDVERWEISE GESETZT? `changed_by = NULL` heisst „ueber die
   * Service-Rolle ODER nach dem Loeschen des Kontos" (0004). Es ist ein
   * Hinweis, kein Beweis — und genau deshalb steht hier kein Sollwert.
   */
  (131, 'Bildverweise', 'Zeilen mit image_override_path',
      (select mit_bildverweis from mess), null),
  (132, 'Bildverweise', 'Journalzeilen dazu, gesamt',
      (select count(*)::text from public.catalog_admin_changes
        where field = 'image_override_path'), null),
  (133, 'Bildverweise', 'davon mit changed_by NULL — ein serverseitiger Weg hat '
                        'geschrieben, WELCHER sagt die Zeile nicht',
      (select count(*)::text from public.catalog_admin_changes
        where field = 'image_override_path' and changed_by is null), null),
  (134, 'Bildverweise', 'juengste solche Zeile',
      (select coalesce(max(changed_at)::text, '(keine)') from public.catalog_admin_changes
        where field = 'image_override_path'), null),

  (900, 'BASIS', 'Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from baseline), null)
),
ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte (0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
