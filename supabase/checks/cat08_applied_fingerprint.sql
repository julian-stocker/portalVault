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
  /*
   * NACHGEZOGEN AUF 0168 am 2026-11-10 (M-05, F5) — belegt wie 117.
   *
   * `admin_set_variant_base` wird in dieser Reihenfolge definiert: `0159`,
   * **`0168`** (`0168_variant_family_inheritance.sql`, auf Staging seit
   * 2026-11-02). Aus den Migrationsdateien gerechnet:
   *
   *     0159  4928 Zeichen  ->  b47289cb9b630ba5d3b6b186955539f6
   *     0168  3434 Zeichen  ->  62ecc99220dab9e1b80a5a2a11b9f6f9
   *
   * Der Suite-Lauf vom 2026-11-10 hat `62ecc992…` gemessen; eine lesende
   * Katalogmessung am selben Tag dazu 3434 Zeichen und den Kommentar aus
   * `0168` (md5 `1d311441…`, 526 Zeichen). Der alte Sollwert war der Rumpf aus
   * `0159`; die Datenbank fuehrt den aus `0168`. Veraltet war die Erwartung.
   * `src/lib/admin/check-fingerprints.test.ts` haelt jeden Sollwert dieser
   * Datei gegen die LETZTE definierende Migration.
   */
  (111, 'Unveraendert', 'admin_set_variant_base (0168)',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)')),
      '62ecc99220dab9e1b80a5a2a11b9f6f9'),
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
  /*
   * NACHGEZOGEN AUF 0164 am 2026-10-30 — und zwar belegt, nicht angepasst,
   * bis es passt.
   *
   * Diese Zeile erwartete `ff4f38e6…` und „derselbe Abdruck wie nach 0160".
   * Der Staging-Suite-Lauf vom 2026-10-30 hat `7e9e58e2…` gemessen und damit
   * als EINZIGE der acht Rumpfpruefungen dieser Datei angeschlagen.
   *
   * DER BEWEIS, dass die Abweichung die Pruefung und nicht die Datenbank
   * betrifft: `system_platform_export()` wird in dieser Reihenfolge ersetzt —
   * `0105`, `0144`, `0153`, `0160`, **`0164`**. Rechnet man den Rumpf aus den
   * Migrationsdateien selbst, kommt heraus:
   *
   *     0160  31 114 Zeichen  ->  ff4f38e61cbd4e5857ea914d6be68d44
   *     0164  31 248 Zeichen  ->  7e9e58e2d84a9f8a7c660262aa21926b
   *
   * Der alte Sollwert IST der Rumpf aus `0160`, der gemessene IST der Rumpf
   * aus `0164` — zeichengleich mit der Fassung im Repository. `0164` ist auf
   * Staging angewendet (`APPLIED.md`, Zeile der Staging-Uebersicht:
   * `0152`-`0164`). Die Datenbank fuehrt also genau den Stand, den die Akte
   * nennt; veraltet war die Erwartung.
   *
   * Die anderen sieben Rumpfpruefungen (101, 111-116) stimmen unveraendert
   * mit ihrer jeweils letzten definierenden Migration ueberein; nachgerechnet
   * am 2026-10-30 ueber alle acht.
   *
   * UEBER PRODUCTION SAGT DAS NICHTS. Diese Datei ist eine
   * Staging-Pruefung. Eine erste Fassung dieses Kommentars behauptete, auf
   * Production sei `0164` offen und der Rumpf weiter der aus `0160` — das war
   * aus `APPLIED.md` uebernommen und NICHT gemessen. Am 2026-10-30 hat eine
   * lesende Messung dort Objekte aus `0159`, `0161`, `0162` und `0163`
   * gefunden, die laut Akte fehlen sollten. Der Production-Stand ist deshalb
   * ein offener Widerspruch; er wird mit
   * `supabase/checks/prod_0159_0165_state.sql` geklaert, nicht hier
   * behauptet.
   *
   * NOCHMALS NACHGEZOGEN, AUF 0182, am 2026-11-10 (M-05, F5). Seit 2026-10-30
   * kamen zwei weitere Definitionen dazu: `0174` (Abgleich in der Sicherung)
   * und **`0182`** (Positionskorrekturen), beide auf Staging angewendet
   * (`APPLIED.md`). Aus den Dateien:
   *
   *     0174  35 715 Zeichen  ->  23be72d581589b063d6938a863757b31
   *     0182  36 366 Zeichen  ->  307e1c10a99afdaa683292e2a495e8ad
   *
   * Gemessen auf Staging: `307e1c10…`, 36 366 Zeichen, Kommentar aus `0182`
   * (md5 `fa4cacbf…`, 1775 Zeichen). Weder `0164` noch `0174` wird hier
   * angenommen: ein Rumpf aus einer frueheren Fassung waere eine stille
   * Ruecknahme.
   */
  (117, 'Unveraendert', 'system_platform_export (0182) — derselbe Abdruck wie nach 0182',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      '307e1c10a99afdaa683292e2a495e8ad'),

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
