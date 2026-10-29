-- ===========================================================================
-- CAT-08 ANALYSE, Teil 4: die Namensregel MIT dem Figurenfilter, den das
-- Projekt schon hat.
--
-- DER BEFUND AUS TEIL 3. Unter 314 Namenspaaren stehen drei falsche Freunde,
-- und alle drei haben dieselbe Ursache:
--
--   Crypt Crusher [Fahrzeuge]  -> Crusher [Giants]   ein Fahrzeug, kein Giant
--   Fire Torch    [Traps]      -> Torch   [Figuren]  ein Trap heisst
--   Life Torch    [Traps]      -> Torch   [Figuren]  <Element> <Form>
--
-- Die Traps sind genau der Fall, den `src/lib/catalog/variant.ts` schon
-- beschreibt: „Dark Sword" ist kein dunkles Schwert, sondern ein Trap des
-- Elements Dark. Und ein Fahrzeug ist kein Charakter.
--
-- DAS PROJEKT HAT DIE REGEL SCHON. `src/lib/catalog/character-data.test.ts`
-- haelt fest, dass keine Charakterfamilie einen Trap, ein Fahrzeug, einen
-- Kreationskristall, ein Magic Item, eine Trophy oder eine Location enthaelt
-- (`NOT_FIGURES`). Diese Datei misst, was die Namensregel taugt, wenn sie
-- GENAU DIESEN Filter benutzt — statt eines neuen, erfundenen.
--
--   101-108  die Paare nach dem Filter, und ob die drei falschen Freunde weg
--            sind.
--   201-206  was die Familiensuche dann anbietet: eindeutig, nichts,
--            mehrdeutig.
--   301-306  die Entwuerfe: was waere automatisch, was bliebe Handarbeit.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with keine_figur as (
  select unnest(array['Traps', 'Trap Items', 'Fahrzeuge', 'Kreationskristalle',
                      'Magic Items', 'Trophies', 'Locations & Truhen']) as kat
),
figur as (
  -- Sammelbar UND ein Charakter: beides muss gelten.
  select s.sky_id, s.name, s.series_code, s.character_id, s.base_sky_id,
         s.catalog_status, c.name as kategorie
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active
     and not (c.name = any (public.non_collectible_categories()))
     and not exists (select 1 from keine_figur k where k.kat = c.name)
),
paar as (
  select lang.sky_id as lang_id, lang.name as lang_name,
         lang.series_code as lang_serie, lang.character_id as lang_familie,
         kurz.sky_id as kurz_id, kurz.name as kurz_name,
         kurz.series_code as kurz_serie, kurz.character_id as kurz_familie
    from figur lang
    join figur kurz
      on kurz.sky_id <> lang.sky_id
     and (lang.name = kurz.name or lang.name like '% ' || kurz.name)
),
angebot as (
  select o.sky_id, o.name, o.series_code, o.catalog_status,
         count(distinct p.fam) as familien, min(p.fam) as eine
    from figur o
    left join (
      select lang_id as sky_id, kurz_familie as fam from paar
      union all
      select kurz_id as sky_id, lang_familie as fam from paar
    ) p on p.sky_id = o.sky_id and p.fam is not null
   where o.character_id is null
   group by o.sky_id, o.name, o.series_code, o.catalog_status
),
entwurf_basis as (
  select e.sky_id, e.name, e.series_code,
         count(b.sky_id) as basen, min(b.sky_id) as basis_id,
         min(b.character_id) as basis_familie
    from figur e
    left join figur b
      on b.series_code = e.series_code and b.sky_id <> e.sky_id
     and b.catalog_status <> 'draft' and b.base_sky_id is null
     and e.name like '% ' || b.name
   where e.catalog_status = 'draft'
   group by e.sky_id, e.name, e.series_code
),
pruef (nr, bereich, pruefung, befund) as (values
  (101, 'Mit Filter', 'Zeilen, die als Charakter in Frage kommen',
      (select count(*)::text from figur)),
  (102, 'Mit Filter', 'ausgeschlossene Zeilen (Traps, Fahrzeuge, Kristalle, ...)',
      (select count(*)::text from public.skylanders s
        join public.categories c on c.id = s.category_id
       where s.is_active
         and not (c.name = any (public.non_collectible_categories()))
         and exists (select 1 from keine_figur k where k.kat = c.name))),
  (103, 'Mit Filter', 'Namenspaare nach dem Filter (vorher 314)',
      (select count(*)::text from paar)),
  (104, 'Mit Filter', 'Crypt Crusher ist weg',
      (select case when count(*) = 0 then 'ja' else 'NEIN' end::text from paar
        where lang_name = 'Crypt Crusher' or kurz_name = 'Crypt Crusher')),
  (105, 'Mit Filter', 'Fire Torch und Life Torch sind weg',
      (select case when count(*) = 0 then 'ja' else 'NEIN' end::text from paar
        where lang_name in ('Fire Torch', 'Life Torch'))),
  (106, 'Mit Filter', 'Paare, in denen BEIDE kuratiert sind',
      (select count(*)::text from paar
        where lang_familie is not null and kurz_familie is not null)),
  (107, 'Mit Filter', 'davon WIDERSPRUECHLICH (muss 0 sein)',
      (select count(*)::text from paar
        where lang_familie is not null and kurz_familie is not null
          and lang_familie <> kurz_familie)),
  (108, 'Mit Filter', 'Trefferquote an den kuratierten Paaren',
      (select case when count(*) = 0 then '-'
                   else round(100.0 * count(*) filter (where lang_familie = kurz_familie)
                              / count(*), 1)::text || ' %' end
         from paar where lang_familie is not null and kurz_familie is not null)),

  (201, 'Angebot', 'Charakterzeilen ohne Familie',
      (select count(*)::text from angebot)),
  (202, 'Angebot', 'davon mit GENAU EINEM Familienangebot (automatisch moeglich)',
      (select count(*)::text from angebot where familien = 1)),
  (203, 'Angebot', 'davon mit KEINEM Angebot (neue Familie)',
      (select count(*)::text from angebot where familien = 0)),
  (204, 'Angebot', 'davon MEHRDEUTIG (Handarbeit)',
      (select count(*)::text from angebot where familien > 1)),
  (205, 'Angebot', 'die eindeutigen, namentlich',
      (select coalesce(string_agg(a.sky_id || ' ' || a.name || ' -> F'
                                  || a.eine::text, ' | ' order by a.sky_id), '(keine)')
         from angebot a where a.familien = 1)),
  (206, 'Angebot', 'die mehrdeutigen, namentlich',
      (select coalesce(string_agg(a.sky_id || ' ' || a.name || ' ('
                                  || a.familien::text || ')', ' | ' order by a.sky_id),
                       '(keine)')
         from angebot a where a.familien > 1)),

  (301, 'Entwuerfe', 'Entwuerfe (Charakterzeilen)',
      (select count(*)::text from entwurf_basis)),
  (302, 'Entwuerfe', 'mit genau einer Basisfigur derselben Serie',
      (select count(*)::text from entwurf_basis where basen = 1)),
  (303, 'Entwuerfe', 'davon Basisfigur MIT Familie — Uebernahme, kein Raten',
      (select count(*)::text from entwurf_basis
        where basen = 1 and basis_familie is not null)),
  (304, 'Entwuerfe', 'davon Basisfigur OHNE Familie — hier greift die Suche',
      (select count(*)::text from entwurf_basis
        where basen = 1 and basis_familie is null)),
  (305, 'Entwuerfe', 'und davon: die Suche findet fuer die Basisfigur genau eine',
      (select count(*)::text from entwurf_basis e
        join angebot a on a.sky_id = e.basis_id
       where e.basen = 1 and e.basis_familie is null and a.familien = 1)),
  (306, 'Entwuerfe', 'die Suche findet NICHTS — neue Familie nach der Basisfigur',
      (select count(*)::text from entwurf_basis e
        join angebot a on a.sky_id = e.basis_id
       where e.basen = 1 and e.basis_familie is null and a.familien = 0)),
  (307, 'Entwuerfe', 'die Suche ist MEHRDEUTIG — Dialog muss fragen',
      (select count(*)::text from entwurf_basis e
        join angebot a on a.sky_id = e.basis_id
       where e.basen = 1 and e.basis_familie is null and a.familien > 1)),
  (308, 'Entwuerfe', 'die Faelle aus 305, namentlich',
      (select coalesce(string_agg(e.sky_id || ' ' || e.name || ' -> ' || e.basis_id
                                  || ' -> F' || a.eine::text, ' | ' order by e.sky_id),
                       '(keine)')
         from entwurf_basis e join angebot a on a.sky_id = e.basis_id
        where e.basen = 1 and e.basis_familie is null and a.familien = 1))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
