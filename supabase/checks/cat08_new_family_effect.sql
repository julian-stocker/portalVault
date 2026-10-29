-- ===========================================================================
-- CAT-08 ANALYSE, Teil 5: was die automatische Familienbildung HEUTE wirklich
-- taete.
--
-- Teil 4 hat gezeigt: in 34 von 34 Faellen findet die Suche nichts, und die
-- Automatik legte eine neue Familie an. Diese Datei nennt diese 34 Faelle
-- namentlich — und stellt die eine Frage, die danach noch offen ist:
--
--   WUERDEN ZWEI DIESER 34 NEUEN FAMILIEN DENSELBEN CHARAKTER SPALTEN?
--
-- Wenn zwei Basisfiguren verschiedener Serien derselbe Charakter sind
-- („Lava Barf Eruptor" und „Lava Lance Eruptor" sind beide Eruptor), legte
-- die Automatik zwei Familien an, wo eine gehoert. Das waere keine falsche
-- Zuordnung, aber eine Zersplitterung — und sie faellt erst auf, wenn jemand
-- sie sucht.
--
--   101-104  die 34 Faelle, namentlich.
--   201-205  die Zersplitterungsfrage, gemessen.
--   301-305  was danach zu tun bleibt.
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
entwurf_basis as (
  select e.sky_id as entwurf_id, e.name as entwurf_name, e.series_code,
         count(b.sky_id) as basen, min(b.sky_id) as basis_id
    from figur e
    left join figur b
      on b.series_code = e.series_code and b.sky_id <> e.sky_id
     and b.catalog_status <> 'draft' and b.base_sky_id is null
     and e.name like '% ' || b.name
   where e.catalog_status = 'draft'
   group by e.sky_id, e.name, e.series_code
),
fall as (
  select eb.*, b.name as basis_name, b.character_id as basis_familie,
         b.series_code as basis_serie
    from entwurf_basis eb
    join figur b on b.sky_id = eb.basis_id
   where eb.basen = 1 and b.character_id is null
),
/* Die kuenftigen Familiennamen: je Basisfigur einer. */
neuer_name as (
  select distinct basis_id, basis_name from fall
),
/* Und die Frage: endet ein kuenftiger Familienname auf einen anderen? */
spaltung as (
  select a.basis_id as a_id, a.basis_name as a_name,
         b.basis_id as b_id, b.basis_name as b_name
    from neuer_name a
    join neuer_name b
      on a.basis_id <> b.basis_id
     and (a.basis_name like '% ' || b.basis_name or a.basis_name = b.basis_name)
),
pruef (nr, bereich, pruefung, befund) as (values
  (101, 'Die Faelle', 'Entwuerfe, deren Basisfigur keine Familie hat',
      (select count(*)::text from fall)),
  (102, 'Die Faelle', 'verschiedene Basisfiguren darunter — so viele Familien entstuenden',
      (select count(*)::text from neuer_name)),
  (103, 'Die Faelle', 'alle, namentlich (Entwurf -> Basisfigur)',
      (select coalesce(string_agg(f.entwurf_id || ' ' || f.entwurf_name || ' -> '
                                  || f.basis_id || ' ' || f.basis_name,
                                  ' | ' order by f.basis_name, f.entwurf_id), '(keine)')
         from fall f)),
  (104, 'Die Faelle', 'die kuenftigen Familiennamen, alphabetisch',
      (select coalesce(string_agg(n.basis_name, ', ' order by n.basis_name), '(keine)')
         from neuer_name n)),

  (201, 'Zersplitterung', 'Paare kuenftiger Familiennamen, bei denen einer auf den '
                          'anderen endet (muss 0 sein, sonst spaltet die Automatik)',
      (select count(*)::text from spaltung)),
  (202, 'Zersplitterung', 'diese Paare, namentlich',
      (select coalesce(string_agg(s.a_name || ' / ' || s.b_name, ' | '
                                  order by s.a_name), '(keine)')
         from spaltung s)),
  (203, 'Zersplitterung', 'kuenftige Familiennamen, die auf eine SCHON kuratierte Figur '
                          'enden (dann gehoerte die Familie dorthin)',
      (select count(*)::text from neuer_name n
        join figur k on k.character_id is not null
         and (n.basis_name like '% ' || k.name)
       where true)),
  (204, 'Zersplitterung', 'diese Faelle, namentlich',
      (select coalesce(string_agg(distinct n.basis_name || ' endet auf ' || k.name
                                  || ' [F' || k.character_id::text || ']', ' | '),
                       '(keine)')
         from neuer_name n
         join figur k on k.character_id is not null
          and n.basis_name like '% ' || k.name)),
  (205, 'Zersplitterung', 'kuenftige Familiennamen, die es als Familiennamen schon '
                          'geben koennte (gleiche Schreibweise wie eine kuratierte Figur)',
      (select coalesce(string_agg(distinct n.basis_name, ', '), '(keine)')
         from neuer_name n
         join figur k on lower(k.name) = lower(n.basis_name)
          and k.character_id is not null)),

  (301, 'Danach', 'Charakterzeilen ohne Familie, die KEIN Entwurf sind',
      (select count(*)::text from figur
        where character_id is null and catalog_status <> 'draft')),
  (302, 'Danach', 'Entwuerfe ohne Basisfigur derselben Serie (Weg A oder C)',
      (select count(*)::text from entwurf_basis where basen = 0)),
  (303, 'Danach', 'diese Entwuerfe, die ersten zwanzig',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select eb.entwurf_id || ' ' || eb.entwurf_name as z
           from entwurf_basis eb where eb.basen = 0
          order by eb.entwurf_id limit 20) x)),
  (304, 'Danach', 'Info: Familien heute',
      (select count(distinct character_id)::text from figur
        where character_id is not null)),
  (305, 'Danach', 'Info: Familien nach der Automatik (heute + neue)',
      (select (count(distinct character_id) + (select count(*) from neuer_name))::text
         from figur where character_id is not null))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
