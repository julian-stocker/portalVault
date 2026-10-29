-- ===========================================================================
-- CAT-08 ANALYSE, Teil 2: ALLE Paare der Namensregel, zum Nachsehen.
--
-- `cat08_family_automation.sql` zaehlt; diese Datei NENNT. Die Entscheidung,
-- ob eine Namensregel automatisch zuordnen darf, haengt nicht an einer Quote,
-- sondern daran, ob unter den Treffern ein FALSCHER ist — und das sieht nur,
-- wer sie alle liest.
--
-- Vier Gruppen, und die dritte ist die, auf die es ankommt:
--
--   801-806  ueber SERIEN HINWEG, ein Wort Vorsatz. Diese Paare wuerde die
--            Familiensuche benutzen, und ein einzelnes Wort ist der
--            verdaechtigste Fall ("Fire X" kann ein Element sein).
--   811-816  ueber Serien hinweg, mehrere Woerter Vorsatz.
--   821-826  INNERHALB einer Serie — dort waere es eine Basisfigur, keine
--            Familie.
--   831-836  die Gegenprobe: Paare, bei denen beide Seiten kuratiert sind.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with sammelbar as (
  select s.sky_id, s.name, s.series_code, s.character_id, s.base_sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active
     and not (c.name = any (public.non_collectible_categories()))
),
paar as (
  select lang.sky_id as lang_id, lang.name as lang_name,
         lang.series_code as lang_serie, lang.character_id as lang_familie,
         kurz.sky_id as kurz_id, kurz.name as kurz_name,
         kurz.series_code as kurz_serie, kurz.character_id as kurz_familie,
         btrim(left(lang.name, length(lang.name) - length(kurz.name) - 1)) as vorsatz
    from sammelbar lang
    join sammelbar kurz
      on kurz.sky_id <> lang.sky_id
     and lang.name <> kurz.name
     and lang.name like '% ' || kurz.name
),
wort as (
  select unnest(array[
    'Legendary', 'Dark', 'Nitro', 'Golden', 'Power Blue', 'Blue', 'Mystical',
    'Metallic', 'Granite', 'Pearl', 'Jade', 'Glow', 'Scarlet', 'Molten',
    'Bronze', 'Halloween', 'Easter', 'Royale', 'Jolly', 'Kickoff',
    'Quick Draw', 'Spring Ahead', 'Enchanted', 'Gnarly', 'Chrome',
    'LightCore', 'Light Core', 'Silver', 'Flocked', 'Polar', 'Springtime',
    'Volcanic', 'Winterfest', 'Birthday', 'Eon''s Elite', 'Elite',
    'Clear Crystal', 'Green Crystal', 'Red Crystal', 'Gold Metallic',
    'Crystal Clear', 'Crystal Red', 'Crystal Lila', 'Crystal Green']) as w
),
unbekannt as (
  select p.* from paar p
   where not exists (select 1 from wort w where w.w = p.vorsatz)
),
/* Je Paar genau eine Zeile: dieselbe Namenspaarung kommt mehrfach vor, wenn
   eine Figur in mehreren Serien steht. Fuer das Nachsehen zaehlt der NAME. */
namenspaar as (
  select distinct lang_name, kurz_name, vorsatz,
         (lang_serie = kurz_serie) as gleiche_serie
    from unbekannt
),
pruef (nr, bereich, pruefung, befund) as (values
  (801, 'Serien, 1 Wort', 'Anzahl verschiedener Namenspaare',
      (select count(*)::text from namenspaar
        where not gleiche_serie and vorsatz not like '% %')),
  (802, 'Serien, 1 Wort', 'alle, namentlich',
      (select coalesce(string_agg(x.lang_name || ' -> ' || x.kurz_name
                                  || ' [' || x.vorsatz || ']', ' | '
                                  order by x.vorsatz, x.lang_name), '(keine)')
         from namenspaar x where not x.gleiche_serie and x.vorsatz not like '% %')),

  (811, 'Serien, mehrere', 'Anzahl verschiedener Namenspaare',
      (select count(*)::text from namenspaar
        where not gleiche_serie and vorsatz like '% %')),
  (812, 'Serien, mehrere', 'alle, namentlich',
      (select coalesce(string_agg(x.lang_name || ' -> ' || x.kurz_name
                                  || ' [' || x.vorsatz || ']', ' | '
                                  order by x.vorsatz, x.lang_name), '(keine)')
         from namenspaar x where not x.gleiche_serie and x.vorsatz like '% %')),

  (821, 'Gleiche Serie', 'Anzahl verschiedener Namenspaare',
      (select count(*)::text from namenspaar where gleiche_serie)),
  (822, 'Gleiche Serie', 'alle, namentlich',
      (select coalesce(string_agg(x.lang_name || ' -> ' || x.kurz_name
                                  || ' [' || x.vorsatz || ']', ' | '
                                  order by x.vorsatz, x.lang_name), '(keine)')
         from namenspaar x where x.gleiche_serie)),

  (831, 'Gegenprobe', 'Paare, in denen BEIDE Seiten kuratiert sind',
      (select count(*)::text from paar
        where lang_familie is not null and kurz_familie is not null)),
  (832, 'Gegenprobe', 'davon mit UNGLEICHER Familie (jede einzelne waere ein Fehlurteil)',
      (select count(*)::text from paar
        where lang_familie is not null and kurz_familie is not null
          and lang_familie <> kurz_familie)),
  (833, 'Gegenprobe', 'die bestaetigten Paare, namentlich (die ersten 30)',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select distinct p.lang_name || ' = ' || p.kurz_name as z
           from paar p
          where p.lang_familie is not null and p.kurz_familie is not null
            and p.lang_familie = p.kurz_familie
          order by 1 limit 30) x)),
  (834, 'Gegenprobe', 'Figuren MIT Familie, zu denen die Regel GAR NICHTS findet',
      (select count(*)::text from sammelbar s
        where s.character_id is not null
          and not exists (select 1 from paar p
                           where p.lang_id = s.sky_id or p.kurz_id = s.sky_id))),
  (835, 'Gegenprobe', 'Info: die Familien und ihre Mitgliederzahl',
      (select coalesce(string_agg('F' || x.character_id::text || ':' || x.n::text,
                                  ', ' order by x.n desc, x.character_id), '(keine)')
         from (select character_id, count(*) as n from sammelbar
                where character_id is not null group by character_id) x)),
  (836, 'Gegenprobe', 'Info: je Familie der kuerzeste Mitgliedsname',
      (select coalesce(string_agg(x.kurz, ', ' order by x.kurz), '(keine)')
         from (select distinct on (character_id) character_id, name as kurz
                 from sammelbar where character_id is not null
                order by character_id, length(name), name) x))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
