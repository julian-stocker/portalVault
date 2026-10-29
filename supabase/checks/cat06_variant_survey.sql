-- ===========================================================================
-- CAT-06 PHASE 1: die Bestandsaufnahme zur Variantenverwaltung
--
-- WAS SCHON DA IST, und deshalb wird hier gemessen statt gebaut:
--
--   `skylanders.character_id` -> `characters.id` (`0002`) ist die
--   Familienbeziehung. Stabile ID, kuratiert, EINE Spalte (zwei
--   widersprechende Familien sind damit strukturell unmoeglich), nullable
--   („nicht zuverlaessig bekannt"), und ihr Spaltenkommentar nennt genau den
--   Anwendungsfall: „other figures of this character".
--
--   `withCharacterFamily()` (ADR-0070b) laesst den kuratierten Charakter den
--   Sortierschluessel bestimmen; `FAMILY_ORDER`/`familyRank()` ordnen
--   innerhalb der Familie; `compareFigures()` setzt beides zusammen.
--
-- DIE FRAGE IST ALSO NICHT, OB ES EIN MODELL GIBT, sondern wie weit die
-- KURATIERUNG reicht und wo die Namensregel versagt.
--
--   501-508  DER BESTAND: Zeilen, Status, Editionen.
--   511-518  DIE ABDECKUNG: wie viele Zeilen eine Familie haben, wie viele
--            Familien es gibt, wie gross sie sind.
--   521-526  DIE FAMILIEN UEBER GRENZEN: Familien mit Figuren in mehreren
--            Serien oder Kategorien. Das ist der Fall, in dem die
--            Sortierung sie TRENNT — und zwar absichtlich, weil Serie und
--            Kategorie zuerst sortieren.
--   531-540  WO DIE NAMENSREGEL VERSAGT: Figuren, deren Name mit einem
--            Variantenwort beginnt. `variant.ts` erkennt eine Variante nur,
--            wenn der Restname in DERSELBEN Serie als Sammelobjekt
--            existiert. `Chrome`, `LightCore` und `Silver` stehen gar nicht
--            in der Tokenliste — „Chrome Spyro" ist deshalb keine erkannte
--            Variante und sortiert alphabetisch unter C.
--   541-546  DIE SONDEREDITIONEN, gezaehlt: Legendary, Dark, Chrome,
--            LightCore — je mit und ohne Familie.
--
-- SIE SCHREIBT NICHTS. Nur `skylanders`, `characters` und `categories`,
-- alle drei weltlesbar.
-- ===========================================================================

with sammelbar as (
  select s.*, c.name as kat_name
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active
     and not (c.name = any (public.non_collectible_categories()))
),
fam as (
  select s.character_id, count(*) as zeilen,
         count(distinct s.series_code) as serien,
         count(distinct s.category_id) as kategorien
    from public.skylanders s
   where s.character_id is not null
   group by s.character_id
),
-- Figuren, deren Name mit einem der Variantenwoerter beginnt.
token as (
  select unnest(array[
    'Legendary', 'Dark', 'Nitro', 'Golden', 'Power Blue', 'Blue', 'Mystical',
    'Metallic', 'Granite', 'Clear', 'Crystal Clear', 'Crystal Red',
    'Crystal Lila', 'Crystal Green', 'Green Crystal', 'Red Crystal',
    'Gold Metallic', 'Pearl', 'Jade', 'Glow', 'Scarlet', 'Molten', 'Bronze',
    'Halloween', 'Easter', 'Royale', 'Jolly', 'Kickoff', 'Quick Draw',
    'Spring Ahead', 'Enchanted', 'Gnarly']) as wort
),
-- Woerter, die die Tokenliste NICHT kennt — der eigentliche Fall von CAT-06.
unbekannt as (
  select unnest(array['Chrome', 'LightCore', 'Light Core', 'Silver',
                      'Flocked', 'Polar', 'Springtime', 'Volcanic',
                      'Winterfest', 'Birthday']) as wort
),
mit_token as (
  select s.sky_id, s.name, s.series_code, s.character_id, s.card_type,
         t.wort,
         btrim(substring(s.name from length(t.wort) + 2)) as restname
    from sammelbar s
    join token t on s.name like t.wort || ' %'
),
mit_unbekannt as (
  select s.sky_id, s.name, s.series_code, s.character_id, s.card_type, u.wort,
         btrim(substring(s.name from length(u.wort) + 2)) as restname
    from sammelbar s
    join unbekannt u on s.name like u.wort || ' %'
),
pruef (nr, bereich, pruefung, befund) as (values
  -- --------------------------------------------------------- Der Bestand
  (501, 'Bestand', 'Katalogzeilen insgesamt',
      (select count(*)::text from public.skylanders)),
  (502, 'Bestand', 'davon sammelbar (aktiv, keine Nicht-Sammelkategorie)',
      (select count(*)::text from sammelbar)),
  (503, 'Bestand', 'je Status',
      (select coalesce(string_agg(st || ':' || n::text, ', ' order by st), '-')
         from (select catalog_status as st, count(*) as n
                 from public.skylanders group by catalog_status) x)),
  (504, 'Bestand', 'je Edition (card_type)',
      (select coalesce(string_agg(ct || ':' || n::text, ', ' order by ct), '-')
         from (select card_type as ct, count(*) as n
                 from public.skylanders group by card_type) x)),
  (505, 'Bestand', 'Serien mit sammelbaren Zeilen',
      (select count(distinct series_code)::text from sammelbar)),
  (506, 'Bestand', 'Kategorien mit sammelbaren Zeilen',
      (select count(distinct category_id)::text from sammelbar)),
  (507, 'Bestand', 'Entwuerfe (die moeglichen CAT-06-Faelle)',
      (select count(*)::text from public.skylanders where catalog_status = 'draft')),
  (508, 'Bestand', 'Zeilen in characters',
      case when has_table_privilege('public.characters', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$ select count(*)::text as c from public.characters $q$, false, true, '')))[1]::text, '(leer)')
           else 'KEIN-RECHT' end),
  (511, 'Abdeckung', 'sammelbare Zeilen MIT character_id',
      (select count(*)::text from sammelbar where character_id is not null)),
  (512, 'Abdeckung', 'sammelbare Zeilen OHNE character_id',
      (select count(*)::text from sammelbar where character_id is null)),
  (513, 'Abdeckung', 'Familien, auf die ueberhaupt eine Figur zeigt',
      (select count(*)::text from fam)),
  (514, 'Abdeckung', 'Familien mit MEHR als einer Figur (echte Familien)',
      (select count(*)::text from fam where zeilen > 1)),
  (515, 'Abdeckung', 'Familien mit genau einer Figur',
      (select count(*)::text from fam where zeilen = 1)),
  (516, 'Abdeckung', 'groesste Familie (Zeilen)',
      (select coalesce(max(zeilen)::text, '0') from fam)),
  (517, 'Abdeckung', 'characters-Zeilen, auf die KEINE Figur zeigt (Familie ohne Mitglied)',
      case when has_table_privilege('public.characters', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$ select count(*)::text as c from public.characters c where not exists (select 1 from public.skylanders s where s.character_id = c.id) $q$, false, true, '')))[1]::text, '(leer)')
           else 'KEIN-RECHT' end),
  (518, 'Abdeckung', 'Familien OHNE Standardfigur (card_type = standard)',
      (select count(*)::text from fam f
        where not exists (select 1 from public.skylanders s
                           where s.character_id = f.character_id
                             and s.card_type = 'standard'))),

  -- ------------------------------------------- Familien ueber Grenzen hinweg
  (521, 'Grenzen', 'Familien mit Figuren in MEHREREN Serien',
      (select count(*)::text from fam where serien > 1)),
  (522, 'Grenzen', 'Familien mit Figuren in MEHREREN Kategorien',
      (select count(*)::text from fam where kategorien > 1)),
  (523, 'Grenzen', 'Info: die Familien mit mehreren Serien, namentlich',
      case when has_table_privilege('public.characters', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$ select coalesce(string_agg(x.nm || ' (' || x.serien::text || ')', ', ' order by x.nm), '(keine)') as c from (select c.canonical_name as nm, count(distinct s.series_code) as serien from public.skylanders s join public.characters c on c.id = s.character_id group by c.canonical_name having count(distinct s.series_code) > 1) x $q$, false, true, '')))[1]::text, '(leer)')
           else 'KEIN-RECHT' end),
  (524, 'Grenzen', 'Info: die Familien mit mehreren Kategorien, namentlich',
      case when has_table_privilege('public.characters', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$ select coalesce(string_agg(x.nm || ' (' || x.kat::text || ')', ', ' order by x.nm), '(keine)') as c from (select c.canonical_name as nm, count(distinct s.category_id) as kat from public.skylanders s join public.characters c on c.id = s.character_id group by c.canonical_name having count(distinct s.category_id) > 1) x $q$, false, true, '')))[1]::text, '(leer)')
           else 'KEIN-RECHT' end),
  (525, 'Grenzen', 'Figuren, deren Familienname von ihrem eigenen Namen abweicht',
      case when has_table_privilege('public.characters', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$ select count(*)::text as c from public.skylanders s join public.characters c on c.id = s.character_id where s.name <> c.canonical_name $q$, false, true, '')))[1]::text, '(leer)')
           else 'KEIN-RECHT' end),
  (526, 'Grenzen', 'davon: der Familienname steckt NICHT im Figurennamen',
      case when has_table_privilege('public.characters', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$ select count(*)::text as c from public.skylanders s join public.characters c on c.id = s.character_id where position(lower(c.canonical_name) in lower(s.name)) = 0 $q$, false, true, '')))[1]::text, '(leer)')
           else 'KEIN-RECHT' end),
  (531, 'Namensregel', 'sammelbare Figuren, deren Name mit einem BEKANNTEN Token beginnt',
      (select count(*)::text from mit_token)),
  (532, 'Namensregel', 'davon: Restname existiert in DERSELBEN Serie (Regel greift)',
      (select count(*)::text from mit_token m
        where exists (select 1 from sammelbar s2
                       where s2.series_code = m.series_code and s2.name = m.restname))),
  (533, 'Namensregel', 'davon: Restname existiert NICHT (Regel greift nicht)',
      (select count(*)::text from mit_token m
        where not exists (select 1 from sammelbar s2
                           where s2.series_code = m.series_code and s2.name = m.restname))),
  (534, 'Namensregel', 'davon ohne Familie UND ohne greifende Regel (kuratieren noetig)',
      (select count(*)::text from mit_token m
        where m.character_id is null
          and not exists (select 1 from sammelbar s2
                           where s2.series_code = m.series_code and s2.name = m.restname))),
  (535, 'Namensregel', 'Info: die ersten davon, namentlich',
      (select coalesce(string_agg(m.sky_id || ' ' || m.name, ' | ' order by m.sky_id), '(keine)')
         from (select * from mit_token m
                where m.character_id is null
                  and not exists (select 1 from sammelbar s2
                                   where s2.series_code = m.series_code and s2.name = m.restname)
                order by m.sky_id limit 12) m)),
  (536, 'Namensregel', 'Figuren mit UNBEKANNTEM Variantenwort (Chrome, LightCore, Silver, …)',
      (select count(*)::text from mit_unbekannt)),
  (537, 'Namensregel', 'davon: Restname existiert in derselben Serie (eindeutige Familie)',
      (select count(*)::text from mit_unbekannt m
        where exists (select 1 from sammelbar s2
                       where s2.series_code = m.series_code and s2.name = m.restname))),
  (538, 'Namensregel', 'davon schon kuratiert (character_id gesetzt)',
      (select count(*)::text from mit_unbekannt where character_id is not null)),
  (539, 'Namensregel', 'Info: die unbekannten Woerter mit Anzahl',
      (select coalesce(string_agg(wort || ':' || n::text, ', ' order by wort), '(keine)')
         from (select wort, count(*) as n from mit_unbekannt group by wort) x)),
  (540, 'Namensregel', 'Info: Beispiele, namentlich (die ersten zwoelf)',
      (select coalesce(string_agg(m.sky_id || ' ' || m.name || ' -> ' || m.restname,
                                  ' | ' order by m.sky_id), '(keine)')
         from (select * from mit_unbekannt order by sky_id limit 12) m)),

  -- ------------------------------------------------- Die Sondereditionen
  (541, 'Editionen', 'Name beginnt mit Legendary: insgesamt / ohne Familie',
      (select count(*)::text || ' / '
           || count(*) filter (where character_id is null)::text
         from sammelbar where name like 'Legendary %')),
  (542, 'Editionen', 'Name beginnt mit Dark: insgesamt / ohne Familie',
      (select count(*)::text || ' / '
           || count(*) filter (where character_id is null)::text
         from sammelbar where name like 'Dark %')),
  (543, 'Editionen', 'Name enthaelt Chrome: insgesamt / ohne Familie',
      (select count(*)::text || ' / '
           || count(*) filter (where character_id is null)::text
         from sammelbar where name ilike '%chrome%')),
  (544, 'Editionen', 'Name enthaelt LightCore oder Light Core: insgesamt / ohne Familie',
      (select count(*)::text || ' / '
           || count(*) filter (where character_id is null)::text
         from sammelbar where name ilike '%light core%' or name ilike '%lightcore%')),
  (545, 'Editionen', 'card_type <> standard, aber OHNE Familie',
      (select count(*)::text from sammelbar
        where card_type <> 'standard' and character_id is null)),
  (546, 'Editionen', 'card_type <> standard MIT Familie',
      (select count(*)::text from sammelbar
        where card_type <> 'standard' and character_id is not null))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
