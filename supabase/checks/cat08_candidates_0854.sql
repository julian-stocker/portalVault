-- ===========================================================================
-- CAT-08: WAS DIE SUCHE BEI SKY-0854 ANBIETET — und bei einem Trap und einem
-- Fahrzeug.
--
-- Diese Datei baut die fuenf Filter aus `fetchBaseFigures` in SQL nach:
-- dieselbe Serie · dieselbe ARTIKELART · keine Variante (`base_sky_id is
-- null`) · kein Entwurf · nicht sie selbst. Dazu den Rang
-- (`base-figure-rank.ts`): wessen Name an einer Wortgrenze am Ende des
-- Entwurfsnamens steht, steht oben.
--
-- SIE PRUEFT NICHTS — sie zeigt die Liste, die der Dialog zeigen wuerde.
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with klasse (kategorie, art) as (values
  ('Figuren', 'character'), ('Giants große Figuren', 'character'),
  ('Giants neue Figuren', 'character'), ('Giants Series 2 Figuren', 'character'),
  ('Minis', 'character'), ('Senseis', 'character'), ('Sidekicks', 'character'),
  ('SWAP Force', 'character'), ('Swap Force neue Figuren', 'character'),
  ('Trap Masters', 'character'), ('Trap Team neue Figuren', 'character'),
  ('Trap Team Series Figuren', 'character'), ('Varianten & LightCore', 'character'),
  ('Traps', 'trap'), ('Trap Items', 'trap'), ('Fahrzeuge', 'vehicle'),
  ('Kreationskristalle', 'crystal'), ('Magic Items', 'magic_item'),
  ('Trophies', 'trophy'), ('Locations & Truhen', 'location'),
  ('Portale', 'portal'), ('Spiele', 'game'), ('Bundles', 'bundle'),
  ('Taschen', 'bag'), ('Zubehör', 'accessory')
),
aktiv as (
  select s.sky_id, s.name, s.series_code, s.base_sky_id, s.catalog_status,
         s.character_id, c.name as kategorie, k.art
    from public.skylanders s
    join public.categories c on c.id = s.category_id
    left join klasse k on k.kategorie = c.name
   where s.is_active
),
/* Die drei Entwuerfe, an denen gezeigt wird. */
frage (sky_id) as (values ('SKY-0854'), ('SKY-0880'), ('SKY-0899')),
entwurf as (
  select a.* from aktiv a join frage f on f.sky_id = a.sky_id
),
kandidat as (
  select e.sky_id as fuer, e.name as fuer_name, e.art as fuer_art,
         e.series_code as serie,
         b.sky_id, b.name, b.kategorie, b.catalog_status,
         (select count(*) from aktiv v where v.base_sky_id = b.sky_id) as varianten,
         /* Der Rang: Wortgrenzen-Suffix, Laenge des gemeinsamen Endes. */
         case when lower(b.name) <> lower(e.name)
               and right(lower(e.name), length(b.name) + 1) = ' ' || lower(b.name)
              then length(b.name) else 0 end as rang
    from entwurf e
    join aktiv b
      on b.series_code = e.series_code
     and b.art = e.art
     and b.sky_id <> e.sky_id
     and b.base_sky_id is null
     and b.catalog_status <> 'draft'
),
pruef (nr, bereich, pruefung, befund) as (values
  (101, 'SKY-0854', 'Entwurf: Name, Serie, Kategorie, Art, Status',
      (select coalesce(max(e.name || ' | ' || e.series_code || ' | ' || e.kategorie
                           || ' | ' || coalesce(e.art, '(keine Art)') || ' | '
                           || e.catalog_status
                           || ' | Basis ' || coalesce(e.base_sky_id, '-')), '(fehlt)')
         from entwurf e where e.sky_id = 'SKY-0854')),
  (102, 'SKY-0854', 'wie viele Kandidaten die fuenf Filter uebrig lassen',
      (select count(*)::text from kandidat where fuer = 'SKY-0854')),
  (103, 'SKY-0854', 'die ersten acht — genau das zeigt der Dialog',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select k.sky_id || ' ' || k.name || ' [' || k.kategorie || ', Rang '
                || k.rang::text
                || case when k.varianten > 0
                        then ', ' || k.varianten::text || ' Varianten' else '' end
                || ']' as z
           from kandidat k where k.fuer = 'SKY-0854'
          order by k.rang desc, k.name, k.sky_id limit 8) x)),
  (104, 'SKY-0854', 'Kandidaten mit Rang > 0 (verwandter Name)',
      (select coalesce(string_agg(k.sky_id || ' ' || k.name || ' (Rang '
                                  || k.rang::text || ')', ' | '
                                  order by k.rang desc), '(keine)')
         from kandidat k where k.fuer = 'SKY-0854' and k.rang > 0)),
  (105, 'SKY-0854', 'kaemen ohne den Artikelartfilter Portale oder Traps mit?',
      (select coalesce(string_agg(x.z, ' | ' order by x.z), '(keine)') from (
         select distinct b.kategorie || ' (' || count(*)::text || ')' as z
           from entwurf e
           join aktiv b on b.series_code = e.series_code and b.sky_id <> e.sky_id
            and b.base_sky_id is null and b.catalog_status <> 'draft'
          where e.sky_id = 'SKY-0854' and b.art is distinct from e.art
          group by b.kategorie) x)),

  (201, 'Trap SKY-0880', 'Entwurf',
      (select coalesce(max(e.name || ' | ' || e.series_code || ' | ' || e.kategorie
                           || ' | ' || coalesce(e.art, '(keine Art)')), '(fehlt)')
         from entwurf e where e.sky_id = 'SKY-0880')),
  (202, 'Trap SKY-0880', 'Kandidaten insgesamt',
      (select count(*)::text from kandidat where fuer = 'SKY-0880')),
  (203, 'Trap SKY-0880', 'die ersten acht',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select k.sky_id || ' ' || k.name || ' [' || k.kategorie || ', Rang '
                || k.rang::text || ']' as z
           from kandidat k where k.fuer = 'SKY-0880'
          order by k.rang desc, k.name, k.sky_id limit 8) x)),
  (204, 'Trap SKY-0880', 'und es sind ausschliesslich Traps',
      (select coalesce(string_agg(distinct k.kategorie, ', '), '(keine)')
         from kandidat k where k.fuer = 'SKY-0880')),

  (301, 'Fahrzeug SKY-0899', 'Entwurf',
      (select coalesce(max(e.name || ' | ' || e.series_code || ' | ' || e.kategorie
                           || ' | ' || coalesce(e.art, '(keine Art)')), '(fehlt)')
         from entwurf e where e.sky_id = 'SKY-0899')),
  (302, 'Fahrzeug SKY-0899', 'Kandidaten insgesamt',
      (select count(*)::text from kandidat where fuer = 'SKY-0899')),
  (303, 'Fahrzeug SKY-0899', 'die ersten acht',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select k.sky_id || ' ' || k.name || ' [' || k.kategorie || ', Rang '
                || k.rang::text || ']' as z
           from kandidat k where k.fuer = 'SKY-0899'
          order by k.rang desc, k.name, k.sky_id limit 8) x)),
  (304, 'Fahrzeug SKY-0899', 'und es sind ausschliesslich Fahrzeuge',
      (select coalesce(string_agg(distinct k.kategorie, ', '), '(keine)')
         from kandidat k where k.fuer = 'SKY-0899')),

  (401, 'Ohne Art', 'Zeilen in einer Kategorie ohne Artzuordnung',
      (select count(*)::text from aktiv where art is null)),
  (402, 'Ohne Art', 'welche Kategorien das sind',
      (select coalesce(string_agg(distinct kategorie, ', '), '(keine)')
         from aktiv where art is null))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
