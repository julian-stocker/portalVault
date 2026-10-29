-- ===========================================================================
-- 0161: IST DIE FUNKTION AUF STAGING DIE AUS DER DATEI?
--
-- DIE FRAGE DES BETREIBERS, und die Nachkontrolle beantwortet sie nur
-- teilweise: sie prueft MUSTER im Rumpf (Advisory-Lock, Sperrordnung, Veto),
-- nicht den Rumpf als Ganzes. Diese Datei nennt den ABDRUCK — damit „die
-- Datei im Repository ist die ausgefuehrte Fassung" gemessen ist und nicht
-- geschlussfolgert.
--
-- Erwartet wird `adf679deb5d42fad5dff15bd1641f318` bei 6553 Zeichen; das ist
-- der Rumpf zwischen `as $$` und `$$;` in
-- `supabase/migrations/0161_variant_family_auto.sql`, so wie PostgreSQL ihn
-- speichert. Dazu die Abdruecke der sechs Funktionen, die unveraendert
-- bleiben mussten.
--
-- SIE SCHREIBT NICHTS und ruft keine der Funktionen auf.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (101, 'Abdruck', 'admin_publish_variant_auto: der Rumpf IST der aus der Datei',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'adf679deb5d42fad5dff15bd1641f318'),
  (102, 'Abdruck', 'und er ist 6553 Zeichen lang',
      (select coalesce(length(p.prosrc)::text, '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      '6553'),
  /*
   * DIE PARAMETERNAMEN SIND TEIL DES VERTRAGS, nicht Beschriftung. PostgREST
   * ruft eine Funktion mit BENANNTEN Argumenten: `actions.ts` schickt
   * `{ p_sky_id, p_base_sky_id }`. Heissen sie in der Datenbank anders,
   * antwortet der Aufruf mit `PGRST202` — und zwar erst im Betrieb.
   */
  (103, 'Abdruck', 'die Parameternamen sind die, die actions.ts schickt',
      (select coalesce(pg_get_function_identity_arguments(p.oid), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'p_sky_id text, p_base_sky_id text'),
  (104, 'Abdruck', 'Info: der Kommentar nennt 0161',
      (select coalesce((obj_description(
                 to_regprocedure('public.admin_publish_variant_auto(text,text)'),
                 'pg_proc') like '%0161%')::text, 'kein Kommentar')), 'true'),

  -- Die sechs, die unveraendert bleiben mussten (Anforderung 1).
  (111, 'Unveraendert', 'admin_set_variant_base',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)')),
      'b47289cb9b630ba5d3b6b186955539f6'),
  (112, 'Unveraendert', 'admin_publish_with_base',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_with_base(text,text,boolean)')),
      '3df170dff2915bc2e4e9092cae289e27'),
  (113, 'Unveraendert', 'admin_create_character',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_create_character(text)')),
      '5f8137b4acd0a325b8c2c1572850e3ea'),
  (114, 'Unveraendert', 'admin_set_character',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_character(text,bigint)')),
      '4b02bf104a095e61c9df29c50fe34647'),
  (115, 'Unveraendert', 'admin_publish_as_variant',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_as_variant(text,bigint)')),
      '99339dc5a2d51a165e0ce88c5012502d'),
  (116, 'Unveraendert', 'admin_set_catalog_status',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_catalog_status(text,text)')),
      'e3c76fa571341e737c41fc2c3d6cdb8e'),
  (117, 'Unveraendert', 'system_platform_export (0160) — derselbe Abdruck wie nach 0160',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      'ff4f38e61cbd4e5857ea914d6be68d44'),

  -- Und der Bestand, als Auskunft fuer die Akte.
  (131, 'Bestand', 'Info: Entwuerfe',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), null),
  (132, 'Bestand', 'Info: Zeilen mit Familie',
      (select count(*)::text from public.skylanders where character_id is not null), null),
  (133, 'Bestand', 'Info: Varianten mit Basisfigur',
      (select count(*)::text from public.skylanders where base_sky_id is not null), null),
  (134, 'Bestand', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),
  (135, 'Bestand', 'Namen mit ZWEI verschiedenen Familien (muss 0 bleiben)',
      (select count(*)::text from (
         select lower(s.name) from public.skylanders s
          join public.categories c on c.id = s.category_id
         where s.is_active
           and not (c.name = any (public.non_collectible_categories()))
           and not (c.name = any (array['Traps', 'Trap Items', 'Fahrzeuge',
                                        'Kreationskristalle', 'Magic Items',
                                        'Trophies', 'Locations & Truhen']))
         group by lower(s.name) having count(distinct s.character_id) > 1) x), '0'),
  (136, 'Bestand', 'Ketten (muss 0 sein)',
      (select count(*)::text from public.skylanders v
        join public.skylanders b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.base_sky_id is not null), '0'),
  (137, 'Bestand', 'Zuordnungen ueber Seriengrenzen (muss 0 sein)',
      (select count(*)::text from public.skylanders v
        join public.skylanders b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.series_code <> v.series_code), '0')
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
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
