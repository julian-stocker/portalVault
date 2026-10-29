-- ===========================================================================
-- CAT-08 / 0161: REICHT NAMENSGLEICHHEIT ALS IDENTITAETSBEWEIS?
--
-- DIE FRAGE DES BETREIBERS, und sie ist die richtige. Stufe 1 benutzt eine
-- vorhandene Familie wieder, wenn ihr Name GENAU dem Namen der Basisfigur
-- entspricht. Das ist nur dann sicher, wenn kein Name im Katalog fuer ZWEI
-- verschiedene Charaktere steht.
--
-- Diese Datei prueft das von der Katalogseite her — `characters` darf der
-- lesende Pruefzugang nicht lesen, aber die Zuordnung steht in
-- `skylanders.character_id`, und die reicht:
--
--   Traegt ein Name, der mehrfach vorkommt, je ZWEI verschiedene
--   `character_id`, dann beweist Namensgleichheit nichts.
--
--   101-108  mehrfach vorkommende Namen und ihre Familien.
--   201-206  die drei Faelle, die der Betreiber ausdruecklich genannt hat.
--   301-306  die Abdruecke der fuenf Funktionen aus `0158`/`0159`, damit
--            `0161` nachweisen kann, dass sie unveraendert geblieben sind.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with keine_figur as (
  select unnest(array['Traps', 'Trap Items', 'Fahrzeuge', 'Kreationskristalle',
                      'Magic Items', 'Trophies', 'Locations & Truhen']) as kat
),
figur as (
  select s.sky_id, s.name, s.series_code, s.character_id, s.base_sky_id,
         s.catalog_status, c.name as kategorie
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active
     and not (c.name = any (public.non_collectible_categories()))
     and not exists (select 1 from keine_figur k where k.kat = c.name)
),
mehrfach as (
  select lower(name) as kleinname, count(*) as zeilen,
         count(distinct character_id) as familien,
         count(character_id) as mit_familie,
         string_agg(sky_id || '/' || series_code
                    || coalesce('/F' || character_id::text, '/-'), ' ' order by sky_id) as wo
    from figur
   group by lower(name)
  having count(*) > 1
),
/* Und derselbe Name ueber ALLE sammelbaren Zeilen — auch Traps und
   Fahrzeuge. Diese Zeilen bekommen nie eine Familie, aber sie zeigen, wo
   Namensgleichheit ueberhaupt zweierlei bedeuten kann. */
mehrfach_alle as (
  select lower(s.name) as kleinname, count(*) as zeilen,
         count(distinct c.name) as kategorien,
         string_agg(distinct c.name, ', ') as wo
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active
     and not (c.name = any (public.non_collectible_categories()))
   group by lower(s.name)
  having count(distinct c.name) > 1
),
pruef (nr, bereich, pruefung, befund) as (values
  (101, 'Namensgleichheit', 'Charakterzeilen insgesamt',
      (select count(*)::text from figur)),
  (102, 'Namensgleichheit', 'Namen, die mehr als einmal vorkommen',
      (select count(*)::text from mehrfach)),
  (103, 'Namensgleichheit', 'davon mit ZWEI ODER MEHR verschiedenen Familien '
                            '(muss 0 sein — sonst beweist der Name nichts)',
      (select count(*)::text from mehrfach where familien > 1)),
  (104, 'Namensgleichheit', 'diese Faelle, namentlich',
      (select coalesce(string_agg(m.kleinname || ': ' || m.wo, ' | '
                                  order by m.kleinname), '(keine)')
         from mehrfach m where m.familien > 1)),
  (105, 'Namensgleichheit', 'mehrfache Namen MIT genau einer Familie (die Regel traegt)',
      (select count(*)::text from mehrfach where familien = 1)),
  (106, 'Namensgleichheit', 'mehrfache Namen ohne jede Familie (dort entsteht eine neue)',
      (select count(*)::text from mehrfach where familien = 0)),
  (107, 'Namensgleichheit', 'alle mehrfachen Namen, namentlich',
      (select coalesce(string_agg(m.kleinname || ' (' || m.zeilen::text || 'x'
                                  || case when m.familien = 1 then ', F' else ', ohne' end
                                  || ')', ' | ' order by m.kleinname), '(keine)')
         from mehrfach m)),
  (108, 'Namensgleichheit', 'gleiche Namen ueber KATEGORIEGRENZEN (dort kann einer '
                            'zweierlei heissen)',
      (select coalesce(string_agg(a.kleinname || ': ' || a.wo, ' | '
                                  order by a.kleinname), '(keine)')
         from mehrfach_alle a)),

  (201, 'Die drei Faelle', 'Chop Chop: alle Zeilen',
      (select coalesce(string_agg(f.sky_id || ' ' || f.name || ' ' || f.series_code
                                  || ' ' || f.kategorie
                                  || coalesce(' F' || f.character_id::text, ' ohne')
                                  || ' ' || f.catalog_status, ' | ' order by f.sky_id),
                       '(keine)')
         from figur f where f.name like '%Chop Chop%')),
  (202, 'Die drei Faelle', 'Stump Smash: alle Zeilen',
      (select coalesce(string_agg(f.sky_id || ' ' || f.name || ' ' || f.series_code
                                  || ' ' || f.kategorie
                                  || coalesce(' F' || f.character_id::text, ' ohne')
                                  || ' ' || f.catalog_status, ' | ' order by f.sky_id),
                       '(keine)')
         from figur f where f.name like '%Stump Smash%')),
  (203, 'Die drei Faelle', 'Wrecking Ball: alle Zeilen',
      (select coalesce(string_agg(f.sky_id || ' ' || f.name || ' ' || f.series_code
                                  || ' ' || f.kategorie
                                  || coalesce(' F' || f.character_id::text, ' ohne')
                                  || ' ' || f.catalog_status, ' | ' order by f.sky_id),
                       '(keine)')
         from figur f where f.name like '%Wrecking Ball%')),

  (301, 'Abdruecke', 'admin_set_variant_base(text,text,boolean)',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)'))),
  (302, 'Abdruecke', 'admin_publish_with_base(text,text,boolean)',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_with_base(text,text,boolean)'))),
  (303, 'Abdruecke', 'admin_create_character(text)',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_create_character(text)'))),
  (304, 'Abdruecke', 'admin_set_character(text,bigint)',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_character(text,bigint)'))),
  (305, 'Abdruecke', 'admin_publish_as_variant(text,bigint)',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_as_variant(text,bigint)'))),
  (306, 'Abdruecke', 'admin_set_catalog_status(text,text)',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_catalog_status(text,text)')))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
