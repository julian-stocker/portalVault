-- ===========================================================================
-- CAT-08 ANALYSE: laesst sich die Familienbildung automatisieren — und wo
-- nicht?
--
-- DIE FRAGE. CAT-08 will, dass der Bediener beim Veroeffentlichen einer
-- Variante NUR die Basisfigur waehlt. Alles andere soll SkyIsles selbst tun:
-- Familie der Basisfigur uebernehmen, sonst eine passende suchen, sonst eine
-- anlegen — und bei Mehrdeutigkeit NICHTS tun.
--
-- DAS STEHT GEGEN EINE DOKUMENTIERTE ENTSCHEIDUNG. ADR-0034: „Charakter-
-- zuordnungen werden kuratiert, niemals aus Namen geraten." Diese Datei
-- entscheidet nicht, ob die Regel faellt — sie MISST, wie teuer das waere:
-- wie oft eine Namensregel eindeutig ist, wie oft sie mehrdeutig ist, und wo
-- sie etwas zusammenlegen wuerde, was nicht zusammengehoert.
--
-- SIE LIEST `characters` NICHT. Der lesende Pruefzugang darf das nicht
-- (ADR-0141), und es ist auch nicht noetig: eine Familie IST eine Menge von
-- `skylanders`-Zeilen mit derselben `character_id`. Jede Zahl hier kommt aus
-- dem Katalog selbst.
--
--   101-109  DER BESTAND: sammelbare Zeilen, Familien, Entwuerfe.
--   201-208  DIE AUFGABE: die Entwuerfe mit einer Basisfigur DERSELBEN Serie,
--            und ob diese Basisfigur schon eine Familie hat. Nur wo sie
--            KEINE hat, braucht es ueberhaupt eine Suche.
--   301-312  DIE NAMENSREGEL, und das ist der Kern. Zwei Figuren gelten als
--            derselbe Charakter, wenn der Name der einen mit dem Namen der
--            anderen an einer WORTGRENZE endet („Mega Ram Spyro" endet auf
--            „ Spyro"). Hier wird gezaehlt, wie oft das eindeutig ist.
--   401-409  DIE MEHRDEUTIGKEIT: Faelle, in denen die Regel ZWEI verschiedene
--            Familien anbietet. Genau diese darf die Automatik nicht
--            entscheiden.
--   501-508  DIE FALSCHEN FREUNDE: Suffixtreffer, deren Vorsatz KEIN
--            bekanntes Varianten- oder Editionswort ist. Jede dieser Zeilen
--            ist ein Verdacht auf zwei verschiedene Charaktere mit
--            aehnlichem Namen.
--   601-609  DIE BEISPIELE DES BETREIBERS, namentlich nachgesehen.
--   701-706  DIE KLAMMERNAMEN und die Ketten — die beiden Faelle, die
--            ausdruecklich NICHT automatisch gehen sollen.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with sammelbar as (
  select s.sky_id, s.name, s.series_code, s.category_id, s.character_id,
         s.base_sky_id, s.card_type, s.catalog_status
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active
     and not (c.name = any (public.non_collectible_categories()))
),
/*
 * DIE NAMENSREGEL, EINMAL DEFINIERT.
 *
 * `kurz` ist der Name, der ganz am Ende des laengeren steht — an einer
 * WORTGRENZE, nicht irgendwo im Text. Ohne die Wortgrenze wuerde „Hot Dog"
 * in „Hot Dog" und in „Shot Dog" gleich gut passen; mit ihr nicht.
 *
 * Die Gleichheit (`lang.name = kurz.name`) kommt extra dazu: zwei Figuren
 * gleichen Namens in verschiedenen Serien sind derselbe Charakter, und das
 * ist der haeufigste Fall ueberhaupt.
 */
paar as (
  select lang.sky_id   as lang_id,   lang.name as lang_name,
         lang.series_code as lang_serie, lang.character_id as lang_familie,
         kurz.sky_id   as kurz_id,   kurz.name as kurz_name,
         kurz.series_code as kurz_serie, kurz.character_id as kurz_familie,
         case when lang.name = kurz.name then 'gleich' else 'suffix' end as art,
         case when lang.name = kurz.name then ''
              else btrim(left(lang.name, length(lang.name) - length(kurz.name) - 1))
         end as vorsatz
    from sammelbar lang
    join sammelbar kurz
      on kurz.sky_id <> lang.sky_id
     and (lang.name = kurz.name or lang.name like '% ' || kurz.name)
),
/* Das bekannte Vokabular: Varianten-, Editions- und Formwoerter. Es
   entscheidet NICHTS — es sortiert nur, was nachgesehen werden muss. */
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
/* Jede Figur ohne Familie, und was die Namensregel ueber andere Serien
   hinweg an Familien anbietet. DAS ist die Zahl, an der alles haengt. */
ohne_familie as (
  select s.sky_id, s.name, s.series_code, s.catalog_status
    from sammelbar s where s.character_id is null
),
angebot as (
  select o.sky_id, o.name, o.series_code, o.catalog_status,
         count(distinct p.partner_familie) as familien,
         min(p.partner_familie)            as eine,
         count(*)                          as treffer
    from ohne_familie o
    left join (
      /* Verwandte in BEIDE Richtungen: der laengere und der kuerzere Name. */
      select lang_id as sky_id, kurz_familie as partner_familie,
             kurz_serie as partner_serie from paar
      union all
      select kurz_id as sky_id, lang_familie as partner_familie,
             lang_serie as partner_serie from paar
    ) p on p.sky_id = o.sky_id and p.partner_familie is not null
   group by o.sky_id, o.name, o.series_code, o.catalog_status
),
entwurf as (
  select s.* from sammelbar s where s.catalog_status = 'draft'
),
/* Zu jedem Entwurf die moegliche Basisfigur DERSELBEN Serie nach derselben
   Regel — und nur eine, wenn sie eindeutig ist. */
entwurf_basis as (
  select e.sky_id, e.name, e.series_code,
         count(b.sky_id)                                as basen,
         min(b.sky_id)                                  as basis_id,
         min(b.character_id)                            as basis_familie,
         count(b.character_id)                          as basen_mit_familie
    from entwurf e
    left join sammelbar b
      on b.series_code = e.series_code
     and b.sky_id <> e.sky_id
     and b.catalog_status <> 'draft'
     and b.base_sky_id is null
     and e.name like '% ' || b.name
   group by e.sky_id, e.name, e.series_code
),
pruef (nr, bereich, pruefung, befund) as (values
  -- ------------------------------------------------------------ Der Bestand
  (101, 'Bestand', 'sammelbare Katalogzeilen',
      (select count(*)::text from sammelbar)),
  (102, 'Bestand', 'davon MIT Familie',
      (select count(*)::text from sammelbar where character_id is not null)),
  (103, 'Bestand', 'davon OHNE Familie',
      (select count(*)::text from sammelbar where character_id is null)),
  (104, 'Bestand', 'verschiedene Familien im Katalog',
      (select count(distinct character_id)::text from sammelbar
        where character_id is not null)),
  (105, 'Bestand', 'Familien mit Mitgliedern in MEHREREN Serien',
      (select count(*)::text from (select character_id from sammelbar
         where character_id is not null
         group by character_id having count(distinct series_code) > 1) x)),
  (106, 'Bestand', 'Entwuerfe',
      (select count(*)::text from entwurf)),
  (107, 'Bestand', 'Varianten mit Basisfigur (0159)',
      (select count(*)::text from sammelbar where base_sky_id is not null)),
  (108, 'Bestand', 'Groesse der groessten Familie',
      (select coalesce(max(n)::text, '0') from (select count(*) as n from sammelbar
         where character_id is not null group by character_id) x)),
  (109, 'Bestand', 'Familien mit genau EINEM Mitglied',
      (select count(*)::text from (select character_id from sammelbar
         where character_id is not null
         group by character_id having count(*) = 1) x)),

  -- ------------------------------------------------------------ Die Aufgabe
  (201, 'Aufgabe', 'Entwuerfe MIT genau einer moeglichen Basisfigur derselben Serie',
      (select count(*)::text from entwurf_basis where basen = 1)),
  (202, 'Aufgabe', 'Entwuerfe mit MEHREREN moeglichen Basisfiguren (Bediener waehlt)',
      (select count(*)::text from entwurf_basis where basen > 1)),
  (203, 'Aufgabe', 'Entwuerfe ohne jede Basisfigur derselben Serie (Weg A oder C)',
      (select count(*)::text from entwurf_basis where basen = 0)),
  /*
   * ZEILE 204 IST DIE WICHTIGSTE DIESER GRUPPE. Hat die Basisfigur eine
   * Familie, ist die Uebernahme KEIN Raten — sie folgt der Entscheidung, die
   * der Bediener mit der Wahl der Basisfigur getroffen hat. `0159` tut das
   * schon.
   */
  (204, 'Aufgabe', 'davon mit Basisfigur, die SCHON eine Familie hat (0159 kann es heute)',
      (select count(*)::text from entwurf_basis
        where basen = 1 and basis_familie is not null)),
  (205, 'Aufgabe', 'und mit Basisfigur OHNE Familie — nur HIER braucht es eine Suche',
      (select count(*)::text from entwurf_basis
        where basen = 1 and basis_familie is null)),
  (206, 'Aufgabe', 'die Faelle aus 205, namentlich (die ersten fuenfzehn)',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select e.sky_id || ' ' || e.name || ' -> ' || e.basis_id as z
           from entwurf_basis e
          where e.basen = 1 and e.basis_familie is null
          order by e.sky_id limit 15) x)),
  (207, 'Aufgabe', 'die Faelle aus 204, namentlich (die ersten fuenfzehn)',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select e.sky_id || ' ' || e.name || ' -> ' || e.basis_id
                || ' [Familie ' || e.basis_familie::text || ']' as z
           from entwurf_basis e
          where e.basen = 1 and e.basis_familie is not null
          order by e.sky_id limit 15) x)),
  (208, 'Aufgabe', 'Entwuerfe mit mehreren Basen, namentlich (die ersten zehn)',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select e.sky_id || ' ' || e.name || ' (' || e.basen::text || ' Basen)' as z
           from entwurf_basis e where e.basen > 1 order by e.sky_id limit 10) x)),

  -- ------------------------------------------------------- Die Namensregel
  (301, 'Namensregel', 'Paare insgesamt (gleicher Name ODER Suffix an der Wortgrenze)',
      (select count(*)::text from paar)),
  (302, 'Namensregel', 'davon mit GLEICHEM Namen (verschiedene Serien, derselbe Charakter)',
      (select count(*)::text from paar where art = 'gleich')),
  (303, 'Namensregel', 'davon Suffixtreffer (laengerer Name endet auf kuerzeren)',
      (select count(*)::text from paar where art = 'suffix')),
  (304, 'Namensregel', 'Suffixtreffer mit BEKANNTEM Vorsatz (Varianten-/Editionswort)',
      (select count(*)::text from paar p
        where p.art = 'suffix' and exists (select 1 from wort w where w.w = p.vorsatz))),
  (305, 'Namensregel', 'Suffixtreffer mit UNBEKANNTEM Vorsatz — die muessen angesehen werden',
      (select count(*)::text from paar p
        where p.art = 'suffix' and not exists (select 1 from wort w where w.w = p.vorsatz))),
  (306, 'Namensregel', 'die unbekannten Vorsaetze mit Anzahl',
      (select coalesce(string_agg(x.vorsatz || ':' || x.n::text, ', ' order by x.n desc,
                                  x.vorsatz), '(keine)')
         from (select p.vorsatz, count(*) as n from paar p
                where p.art = 'suffix'
                  and not exists (select 1 from wort w where w.w = p.vorsatz)
                group by p.vorsatz) x)),
  (307, 'Namensregel', 'Figuren ohne Familie, fuer die die Regel GENAU EINE Familie anbietet',
      (select count(*)::text from angebot where familien = 1)),
  (308, 'Namensregel', 'Figuren ohne Familie, fuer die sie KEINE anbietet (neu anlegen)',
      (select count(*)::text from angebot where familien = 0)),
  (309, 'Namensregel', 'Figuren ohne Familie mit ZWEI ODER MEHR Angeboten (Handarbeit)',
      (select count(*)::text from angebot where familien > 1)),
  (310, 'Namensregel', 'die eindeutigen Faelle, namentlich (die ersten fuenfzehn)',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select a.sky_id || ' ' || a.name || ' -> Familie ' || a.eine::text as z
           from angebot a where a.familien = 1 order by a.sky_id limit 15) x)),
  (311, 'Namensregel', 'Anteil der eindeutigen an allen Figuren ohne Familie',
      (select case when count(*) = 0 then '-'
                   else round(100.0 * count(*) filter (where familien = 1)
                              / count(*), 1)::text || ' %' end from angebot)),
  (312, 'Namensregel', 'Info: wie viele Verwandte ein eindeutiger Fall im Schnitt hat',
      (select coalesce(round(avg(treffer), 2)::text, '-') from angebot
        where familien = 1)),

  -- --------------------------------------------------- Die Mehrdeutigkeit
  (401, 'Mehrdeutig', 'Figuren ohne Familie mit mehreren Familienangeboten, namentlich',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select a.sky_id || ' ' || a.name || ' (' || a.familien::text || ' Familien)' as z
           from angebot a where a.familien > 1 order by a.sky_id limit 15) x)),
  (402, 'Mehrdeutig', 'Paare, in denen BEIDE Seiten eine Familie haben — und VERSCHIEDENE',
      (select count(*)::text from paar
        where lang_familie is not null and kurz_familie is not null
          and lang_familie <> kurz_familie)),
  (403, 'Mehrdeutig', 'diese Widersprueche, namentlich (die ersten zehn)',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select p.lang_id || ' ' || p.lang_name || ' [F' || p.lang_familie::text
                || '] vs ' || p.kurz_id || ' ' || p.kurz_name || ' [F'
                || p.kurz_familie::text || ']' as z
           from paar p
          where p.lang_familie is not null and p.kurz_familie is not null
            and p.lang_familie <> p.kurz_familie
          order by p.lang_id limit 10) x)),
  (404, 'Mehrdeutig', 'Paare, in denen beide dieselbe Familie haben (die Regel bestaetigt sich)',
      (select count(*)::text from paar
        where lang_familie is not null and kurz_familie is not null
          and lang_familie = kurz_familie)),
  /*
   * ZEILE 405 IST DIE GEGENPROBE DER REGEL: wo beide Seiten schon kuratiert
   * sind, sagt die Datenlage, ob die Namensregel richtig geraten HAETTE.
   * Bestaetigung gegen Widerspruch — das ist ihre gemessene Trefferquote.
   */
  (405, 'Mehrdeutig', 'Trefferquote der Regel an bereits kuratierten Paaren',
      (select case when count(*) = 0 then '(keine Paare mit zwei Familien)'
                   else round(100.0 * count(*) filter (where lang_familie = kurz_familie)
                              / count(*), 1)::text || ' % bestaetigt' end
         from paar where lang_familie is not null and kurz_familie is not null)),
  (406, 'Mehrdeutig', 'Figuren, die nach der Regel mit MEHREREN kuerzeren Namen enden',
      (select count(*)::text from (select lang_id from paar where art = 'suffix'
         group by lang_id having count(distinct kurz_name) > 1) x)),
  (407, 'Mehrdeutig', 'diese Faelle, namentlich',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select p.lang_name || ' -> ' || string_agg(p.kurz_name, ' / '
                                                   order by length(p.kurz_name) desc) as z
           from paar p where p.art = 'suffix'
          group by p.lang_id, p.lang_name having count(distinct p.kurz_name) > 1
          limit 10) x)),

  -- ---------------------------------------------------- Die falschen Freunde
  (501, 'Falsche Freunde', 'Suffixpaare mit unbekanntem Vorsatz, namentlich (die ersten 25)',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select p.lang_name || ' -> ' || p.kurz_name || ' [' || p.vorsatz || ']' as z
           from paar p
          where p.art = 'suffix'
            and not exists (select 1 from wort w where w.w = p.vorsatz)
          order by p.vorsatz, p.lang_name limit 25) x)),
  (502, 'Falsche Freunde', 'davon in DERSELBEN Serie (dort waere es eine Basisfigur)',
      (select count(*)::text from paar p
        where p.art = 'suffix' and p.lang_serie = p.kurz_serie
          and not exists (select 1 from wort w where w.w = p.vorsatz))),
  (503, 'Falsche Freunde', 'und ueber Serien hinweg (dort waere es eine FAMILIE)',
      (select count(*)::text from paar p
        where p.art = 'suffix' and p.lang_serie <> p.kurz_serie
          and not exists (select 1 from wort w where w.w = p.vorsatz))),
  (504, 'Falsche Freunde', 'Vorsaetze aus genau EINEM Wort (verdaechtiger als mehrere)',
      (select count(*)::text from paar p
        where p.art = 'suffix' and p.vorsatz not like '% %'
          and not exists (select 1 from wort w where w.w = p.vorsatz))),

  -- ------------------------------------------- Die Beispiele des Betreibers
  (601, 'Beispiele', 'Spyro-Zeilen: Name, Serie, Familie, Basisfigur',
      (select coalesce(string_agg(s.sky_id || ' ' || s.name || ' ' || s.series_code
                                  || ' F' || coalesce(s.character_id::text, '-')
                                  || ' B' || coalesce(s.base_sky_id, '-'),
                                  ' | ' order by s.sky_id), '(keine)')
         from sammelbar s where s.name like '%Spyro%')),
  (602, 'Beispiele', 'Pop-Fizz-Zeilen',
      (select coalesce(string_agg(s.sky_id || ' ' || s.name || ' ' || s.series_code
                                  || ' F' || coalesce(s.character_id::text, '-'),
                                  ' | ' order by s.sky_id), '(keine)')
         from sammelbar s where s.name like '%Pop Fizz%')),
  (603, 'Beispiele', 'Boomer-Zeilen (die Klammer darf NICHT greifen)',
      (select coalesce(string_agg(s.sky_id || ' ' || s.name || ' ' || s.series_code
                                  || ' F' || coalesce(s.character_id::text, '-'),
                                  ' | ' order by s.sky_id), '(keine)')
         from sammelbar s where s.name like '%Boomer%')),
  (604, 'Beispiele', 'was die Regel fuer Mega Ram Spyro anbietet',
      (select coalesce(string_agg(p.kurz_id || ' ' || p.kurz_name || ' ' || p.kurz_serie
                                  || ' F' || coalesce(p.kurz_familie::text, '-'),
                                  ' | ' order by p.kurz_id), '(nichts)')
         from paar p where p.lang_name like 'Mega Ram %')),
  (605, 'Beispiele', 'was die Regel fuer Big Bubble Pop Fizz anbietet',
      (select coalesce(string_agg(p.kurz_id || ' ' || p.kurz_name || ' ' || p.kurz_serie
                                  || ' F' || coalesce(p.kurz_familie::text, '-'),
                                  ' | ' order by p.kurz_id), '(nichts)')
         from paar p where p.lang_name like 'Big Bubble %')),
  (606, 'Beispiele', 'was die Regel fuer Chrome Spyro anbietet',
      (select coalesce(string_agg(p.kurz_id || ' ' || p.kurz_name || ' ' || p.kurz_serie
                                  || ' F' || coalesce(p.kurz_familie::text, '-'),
                                  ' | ' order by p.kurz_id), '(nichts)')
         from paar p where p.lang_name like 'Chrome Spyro%')),
  (607, 'Beispiele', 'und fuer Eon''s Elite Boomer (2) — erwartet: nichts',
      (select coalesce(string_agg(p.kurz_name, ' | '), '(nichts)')
         from paar p where p.lang_name like '%Boomer (2)%')),

  -- --------------------------------------------- Klammernamen und Ketten
  (701, 'Klammern', 'sammelbare Zeilen mit Klammer im Namen',
      (select count(*)::text from sammelbar where name like '% (%)')),
  (702, 'Klammern', 'davon ohne Familie',
      (select count(*)::text from sammelbar
        where name like '% (%)' and character_id is null)),
  (703, 'Klammern', 'Klammernamen, bei denen die Regel ueberhaupt etwas anbietet',
      (select count(*)::text from (select distinct p.lang_id from paar p
         where p.lang_name like '% (%)') x)),
  (704, 'Ketten', 'Basisfiguren, die SELBST eine Variante sind (muss 0 sein)',
      (select count(*)::text from sammelbar v
        join sammelbar b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.base_sky_id is not null)),
  (705, 'Ketten', 'moegliche Basisfiguren, die schon Varianten TRAGEN',
      (select count(distinct b.sky_id)::text from entwurf_basis e
        join sammelbar b on b.sky_id = e.basis_id
       where exists (select 1 from sammelbar v where v.base_sky_id = b.sky_id))),
  (706, 'Ketten', 'Entwuerfe, die schon Varianten tragen (koennen nicht Variante werden)',
      (select count(*)::text from entwurf e
        where exists (select 1 from sammelbar v where v.base_sky_id = e.sky_id)))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
