-- ===========================================================================
-- CAT-08 ANALYSE, Teil 3: wo die Namensregel ZWEI VERSCHIEDENE SORTEN
-- zusammenlegen wuerde.
--
-- DER VERDACHT, der beim Nachsehen von Teil 2 entstanden ist: „Crypt Crusher"
-- endet auf „Crusher", aber das eine ist ein Fahrzeug und das andere ein
-- Giant. Die Namensregel kann das nicht wissen — die KATEGORIE kann es.
--
-- Diese Datei prueft deshalb jedes Paar auf Kategorie und `item_type` beider
-- Seiten. Ein Paar, dessen Seiten in verschiedenen Kategorien liegen, ist der
-- Kandidat fuer einen falschen Freund; ein Paar innerhalb derselben Kategorie
-- ist der Normalfall.
--
--   901-906  die Paare mit VERSCHIEDENER Kategorie, namentlich. Das ist die
--            Liste, die ein Mensch lesen muss.
--   911-914  dieselbe Frage fuer `item_type`.
--   921-926  die Gegenprobe: wie viele Paare innerhalb derselben Kategorie
--            liegen, und wie die kuratierten Familien dazu stehen.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with sammelbar as (
  select s.sky_id, s.name, s.series_code, s.character_id, s.item_type,
         c.name as kategorie
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active
     and not (c.name = any (public.non_collectible_categories()))
),
paar as (
  select lang.sky_id as lang_id, lang.name as lang_name, lang.kategorie as lang_kat,
         lang.item_type as lang_typ, lang.series_code as lang_serie,
         lang.character_id as lang_familie,
         kurz.sky_id as kurz_id, kurz.name as kurz_name, kurz.kategorie as kurz_kat,
         kurz.item_type as kurz_typ, kurz.series_code as kurz_serie,
         kurz.character_id as kurz_familie
    from sammelbar lang
    join sammelbar kurz
      on kurz.sky_id <> lang.sky_id
     and (lang.name = kurz.name or lang.name like '% ' || kurz.name)
),
pruef (nr, bereich, pruefung, befund) as (values
  (901, 'Kategorie', 'Paare insgesamt',
      (select count(*)::text from paar)),
  (902, 'Kategorie', 'Paare mit VERSCHIEDENER Kategorie — die Verdachtsliste',
      (select count(*)::text from paar where lang_kat <> kurz_kat)),
  (903, 'Kategorie', 'diese Paare, namentlich (mit Kategorien)',
      (select coalesce(string_agg(x.z, ' | ' order by x.z), '(keine)') from (
         select distinct p.lang_name || ' [' || p.lang_kat || '/' || p.lang_serie
                || '] -> ' || p.kurz_name || ' [' || p.kurz_kat || '/'
                || p.kurz_serie || ']' as z
           from paar p where p.lang_kat <> p.kurz_kat) x)),
  (904, 'Kategorie', 'davon ueber Serien hinweg (dort waere es eine FAMILIE)',
      (select count(*)::text from paar
        where lang_kat <> kurz_kat and lang_serie <> kurz_serie)),
  (905, 'Kategorie', 'davon mit mindestens einer kuratierten Familie',
      (select count(*)::text from paar
        where lang_kat <> kurz_kat
          and (lang_familie is not null or kurz_familie is not null))),
  (906, 'Kategorie', 'und mit ZWEI kuratierten, die GLEICH sind (dann ist es doch einer)',
      (select count(*)::text from paar
        where lang_kat <> kurz_kat and lang_familie is not null
          and kurz_familie is not null and lang_familie = kurz_familie)),

  (911, 'item_type', 'Paare mit verschiedenem item_type',
      (select count(*)::text from paar where lang_typ <> kurz_typ)),
  (912, 'item_type', 'diese Paare, namentlich',
      (select coalesce(string_agg(x.z, ' | ' order by x.z), '(keine)') from (
         select distinct p.lang_name || ' [' || p.lang_typ || '] -> '
                || p.kurz_name || ' [' || p.kurz_typ || ']' as z
           from paar p where p.lang_typ <> p.kurz_typ) x)),
  (913, 'item_type', 'Info: welche Kategorien ueberhaupt vorkommen',
      (select coalesce(string_agg(x.kategorie || ':' || x.n::text, ', '
                                  order by x.n desc), '(keine)')
         from (select kategorie, count(*) as n from sammelbar
                group by kategorie) x)),
  (914, 'item_type', 'Info: welche item_type vorkommen',
      (select coalesce(string_agg(x.item_type || ':' || x.n::text, ', '
                                  order by x.n desc), '(keine)')
         from (select item_type, count(*) as n from sammelbar
                group by item_type) x)),

  (921, 'Gegenprobe', 'Paare innerhalb DERSELBEN Kategorie',
      (select count(*)::text from paar where lang_kat = kurz_kat)),
  (922, 'Gegenprobe', 'davon mit zwei kuratierten Familien',
      (select count(*)::text from paar
        where lang_kat = kurz_kat and lang_familie is not null
          and kurz_familie is not null)),
  (923, 'Gegenprobe', 'davon ungleich (muss 0 sein, sonst ist die Regel falsch)',
      (select count(*)::text from paar
        where lang_kat = kurz_kat and lang_familie is not null
          and kurz_familie is not null and lang_familie <> kurz_familie)),
  (924, 'Gegenprobe', 'Figuren ohne Familie, denen die Regel bei GLEICHER Kategorie '
                      'genau eine anbietet',
      (select count(*)::text from (
         select o.sky_id
           from sammelbar o
           join paar p on (p.lang_id = o.sky_id or p.kurz_id = o.sky_id)
          where o.character_id is null
            and case when p.lang_id = o.sky_id then p.kurz_familie else p.lang_familie end
                is not null
            and p.lang_kat = p.kurz_kat
          group by o.sky_id
         having count(distinct case when p.lang_id = o.sky_id then p.kurz_familie
                                    else p.lang_familie end) = 1) x)),
  (925, 'Gegenprobe', 'dieselbe Zahl OHNE die Kategorieregel (der Unterschied ist der Gewinn)',
      (select count(*)::text from (
         select o.sky_id
           from sammelbar o
           join paar p on (p.lang_id = o.sky_id or p.kurz_id = o.sky_id)
          where o.character_id is null
            and case when p.lang_id = o.sky_id then p.kurz_familie else p.lang_familie end
                is not null
          group by o.sky_id
         having count(distinct case when p.lang_id = o.sky_id then p.kurz_familie
                                    else p.lang_familie end) = 1) x))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
