-- ===========================================================================
-- CAT-06 §9: die Vorschlagsliste fuer die Familienkuratierung
--
-- WOZU. 561 sammelbare Zeilen haben keine Familie. Eine Massenverknuepfung
-- waere falsch — die Namensaehnlichkeit hat in CAT-05 dreimal in die Irre
-- gefuehrt (eine Variante ist nicht ihre Grundfigur; bei Zubehoer ist die
-- Farbe die Identitaet; ein Merkmalswort auf einer Seite ist ein
-- Unterschied). Diese Datei entscheidet nichts. Sie SORTIERT die Faelle in
-- vier Gruppen, damit die Einzelkorrektur nicht beim Suchen anfaengt.
--
--   GRUPPE 1  eindeutig: ein Variantenwort UND eine Grundfigur mit genau
--             diesem Restnamen in DERSELBEN Serie, die schon eine Familie
--             hat. Die Familie der Grundfigur ist der Vorschlag.
--   GRUPPE 2  moeglich: Grundfigur in derselben Serie vorhanden, aber ohne
--             Familie — erst die Grundfigur zuordnen, dann die Variante.
--   GRUPPE 3  unbekanntes Variantenwort (Chrome, Silver, Flocked, Volcanic,
--             LightCore, …). `VARIANT_TOKENS` kennt sie nicht, und das soll
--             so bleiben: die Liste wirkt auf jede Figur, deren Name so
--             beginnt. Hier entscheidet ein Mensch.
--   GRUPPE 4  Klammernamen im Altbestand (`Crusher (Granite)`). Sie duerfen
--             bleiben (CAT-06 §1), muessen aber auffindbar sein.
--
-- SIE SCHREIBT NICHTS und sie verknuepft nichts.
-- ===========================================================================

with sammelbar as (
  select s.sky_id, s.name, s.series_code, s.category_id, s.character_id, s.card_type,
         s.catalog_status
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active
     and not (c.name = any (public.non_collectible_categories()))
),
bekannt as (
  select unnest(array[
    'Legendary', 'Dark', 'Nitro', 'Golden', 'Power Blue', 'Blue', 'Mystical',
    'Metallic', 'Granite', 'Clear', 'Crystal Clear', 'Crystal Red',
    'Crystal Lila', 'Crystal Green', 'Green Crystal', 'Red Crystal',
    'Gold Metallic', 'Pearl', 'Jade', 'Glow', 'Scarlet', 'Molten', 'Bronze',
    'Halloween', 'Easter', 'Royale', 'Jolly', 'Kickoff', 'Quick Draw',
    'Spring Ahead', 'Enchanted', 'Gnarly']) as wort
),
unbekannt as (
  select unnest(array['Chrome', 'LightCore', 'Light Core', 'Silver', 'Flocked',
                      'Polar', 'Springtime', 'Volcanic', 'Winterfest',
                      'Birthday', 'Glitter', 'Crystal']) as wort
),
-- Jede Figur ohne Familie, deren Name mit einem Wort beginnt, samt Restname.
kandidat as (
  select s.sky_id, s.name, s.series_code, s.card_type, w.wort, w.art,
         btrim(substring(s.name from length(w.wort) + 2)) as restname
    from sammelbar s
    join (select wort, 'bekannt' as art from bekannt
          union all select wort, 'unbekannt' as art from unbekannt) w
      on s.name like w.wort || ' %'
   where s.character_id is null
),
-- Die Grundfigur zum Restnamen, in DERSELBEN Serie. Das ist die ganze
-- Sicherheit: ohne sie ist es kein Variantenname, sondern ein Name.
mit_basis as (
  select k.*, b.sky_id as basis_id, b.character_id as basis_familie
    from kandidat k
    left join sammelbar b
      on b.series_code = k.series_code and b.name = k.restname
),
pruef (nr, bereich, pruefung, befund) as (values
  (601, 'Gruppe 1', 'EINDEUTIG: Grundfigur in derselben Serie hat schon eine Familie',
      (select count(*)::text from mit_basis where basis_familie is not null)),
  (602, 'Gruppe 1', 'die Faelle, namentlich (Figur -> Grundfigur -> Familien-id)',
      (select coalesce(string_agg(m.sky_id || ' ' || m.name || ' -> ' || m.basis_id
                                  || ' (Familie ' || m.basis_familie::text || ')',
                                  ' | ' order by m.sky_id), '(keine)')
         from mit_basis m where m.basis_familie is not null)),

  (611, 'Gruppe 2', 'MOEGLICH: Grundfigur vorhanden, aber selbst ohne Familie',
      (select count(*)::text from mit_basis
        where basis_id is not null and basis_familie is null)),
  (612, 'Gruppe 2', 'die ersten zwanzig, namentlich (erst die Grundfigur zuordnen)',
      (select coalesce(string_agg(m.sky_id || ' ' || m.name || ' -> ' || m.basis_id
                                  || ' ' || m.restname, ' | ' order by m.sky_id), '(keine)')
         from (select * from mit_basis
                where basis_id is not null and basis_familie is null
                order by sky_id limit 20) m)),

  (621, 'Gruppe 3', 'UNBEKANNTES WORT: keine Grundfigur in derselben Serie',
      (select count(*)::text from mit_basis where basis_id is null)),
  (622, 'Gruppe 3', 'davon mit unbekanntem Variantenwort',
      (select count(*)::text from mit_basis
        where basis_id is null and art = 'unbekannt')),
  (623, 'Gruppe 3', 'die Woerter mit Anzahl',
      (select coalesce(string_agg(wort || ':' || n::text, ', ' order by wort), '(keine)')
         from (select wort, count(*) as n from mit_basis where basis_id is null
                group by wort) x)),
  (624, 'Gruppe 3', 'die ersten zwanzig, namentlich (Handarbeit)',
      (select coalesce(string_agg(m.sky_id || ' ' || m.name, ' | ' order by m.sky_id),
                       '(keine)')
         from (select * from mit_basis where basis_id is null
                order by sky_id limit 20) m)),

  (631, 'Gruppe 4', 'KLAMMERNAMEN im Altbestand',
      (select count(*)::text from sammelbar where name like '% (%)')),
  (632, 'Gruppe 4', 'davon ohne Familie',
      (select count(*)::text from sammelbar
        where name like '% (%)' and character_id is null)),
  (633, 'Gruppe 4', 'die ersten zwanzig, namentlich',
      (select coalesce(string_agg(s.sky_id || ' ' || s.name
                                  || case when s.character_id is null then ''
                                          else ' [Familie ' || s.character_id::text || ']' end,
                                  ' | ' order by s.sky_id), '(keine)')
         from (select * from sammelbar where name like '% (%)'
                order by sky_id limit 20) s)),

  (641, 'Gesamt', 'sammelbare Zeilen ohne Familie (die Gesamtaufgabe)',
      (select count(*)::text from sammelbar where character_id is null)),
  (642, 'Gesamt', 'davon von dieser Liste erfasst',
      (select count(distinct sky_id)::text from mit_basis)),
  (643, 'Gesamt', 'Info: card_type der erfassten Faelle — eine Edition ist KEINE Familie',
      (select coalesce(string_agg(card_type || ':' || n::text, ', ' order by card_type), '-')
         from (select card_type, count(*) as n from mit_basis group by card_type) x))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
