-- ===========================================================================
-- CAT-07 ANALYSE: taugt eine direkte Basisfigur-Referenz, und was steht ihr
-- im Weg?
--
-- DIE FRAGE, DIE DIESE DATEI ENTSCHEIDET. CAT-07 will eine Variante
-- „unmittelbar bei ihrer Basisfigur" sortieren. Die Katalogsortierung
-- vergleicht aber SERIE, dann KATEGORIE, dann erst den Gruppierungsschluessel
-- (`compareFigures()`). Liegt eine Variante in einer ANDEREN Kategorie als
-- ihre Basisfigur, trennt die Kategorie sie — und zwar absichtlich, denn die
-- Kategorie ist die Blockordnung des Betreibers.
--
-- Also: wie oft kommt das vor? Daran haengt, ob die Sortierung erweitert
-- werden kann, ohne eine bestehende Gruppierung zu beschaedigen.
--
--   801-806  DIE SERIE: wie viele Varianten haetten ueberhaupt eine
--            Basisfigur in DERSELBEN Serie. Nur die duerfen zugeordnet
--            werden.
--   811-816  DIE KATEGORIE, und das ist der Kern: gleiche Serie, aber
--            andere Kategorie. Jede solche Zeile ist ein Fall, in dem
--            „unmittelbar daneben" und „Kategorieordnung" sich
--            widersprechen.
--   821-826  DIE FAMILIE: wo eine Variante schon eine `character_id` hat
--            und die Basisfigur eine andere oder keine. Das sind die
--            Konflikte, die eine automatische Uebernahme still ueberschreiben
--            wuerde.
--   831-834  DIE KETTEN: Figuren, die nach der Namensregel Variante einer
--            Figur waeren, die selbst Variante ist. Varianten von Varianten
--            sind verboten — hier steht, ob es solche Faelle ueberhaupt gibt.
--   841-844  DIE STRUKTUR: ob `(sky_id, series_code)` eindeutig ist (dann
--            traegt ein zusammengesetzter Fremdschluessel die Serienregel
--            ohne Trigger) und ob `skylanders` schon einen Selbstbezug hat.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with sammelbar as (
  select s.sky_id, s.name, s.series_code, s.category_id, s.character_id,
         s.card_type, s.catalog_status, c.name as kat_name, c.position as kat_pos
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active
     and not (c.name = any (public.non_collectible_categories()))
),
wort as (
  select unnest(array[
    'Legendary', 'Dark', 'Nitro', 'Golden', 'Power Blue', 'Blue', 'Mystical',
    'Metallic', 'Granite', 'Clear', 'Crystal Clear', 'Crystal Red',
    'Crystal Lila', 'Crystal Green', 'Green Crystal', 'Red Crystal',
    'Gold Metallic', 'Pearl', 'Jade', 'Glow', 'Scarlet', 'Molten', 'Bronze',
    'Halloween', 'Easter', 'Royale', 'Jolly', 'Kickoff', 'Quick Draw',
    'Spring Ahead', 'Enchanted', 'Gnarly', 'Chrome', 'LightCore',
    'Light Core', 'Silver', 'Flocked', 'Polar', 'Springtime', 'Volcanic',
    'Winterfest', 'Birthday']) as w
),
-- Jede Figur, deren Name mit einem Variantenwort beginnt, samt Restname.
kandidat as (
  select s.*, w.w, btrim(substring(s.name from length(w.w) + 2)) as restname
    from sammelbar s join wort w on s.name like w.w || ' %'
),
-- Und die Basisfigur zum Restnamen in DERSELBEN Serie.
paar as (
  select k.sky_id as v_id, k.name as v_name, k.series_code as v_serie,
         k.category_id as v_kat, k.kat_name as v_kat_name,
         k.character_id as v_fam, k.card_type as v_edition, k.w,
         b.sky_id as b_id, b.name as b_name, b.category_id as b_kat,
         b.kat_name as b_kat_name, b.character_id as b_fam
    from kandidat k
    join sammelbar b on b.series_code = k.series_code and b.name = k.restname
),
pruef (nr, bereich, pruefung, befund) as (values
  -- --------------------------------------------------- Die Serie
  (801, 'Serie', 'sammelbare Zeilen insgesamt',
      (select count(*)::text from sammelbar)),
  (802, 'Serie', 'Namen mit Variantenwort (bekannt ODER heute unbekannt)',
      (select count(*)::text from kandidat)),
  (803, 'Serie', 'davon MIT Basisfigur in derselben Serie — die zuordenbaren',
      (select count(*)::text from paar)),
  (804, 'Serie', 'davon OHNE Basisfigur in derselben Serie — nicht zuordenbar',
      (select count(*)::text from kandidat k
        where not exists (select 1 from sammelbar b
                           where b.series_code = k.series_code and b.name = k.restname))),
  (805, 'Serie', 'Info: Basisfigur existiert, aber in einer ANDEREN Serie (verboten)',
      (select count(*)::text from kandidat k
        where not exists (select 1 from sammelbar b
                           where b.series_code = k.series_code and b.name = k.restname)
          and exists (select 1 from sammelbar b2 where b2.name = k.restname))),
  (806, 'Serie', 'Basisfiguren, die mehr als eine Variante bekaemen',
      (select count(*)::text from (
        select b_id from paar group by b_id having count(*) > 1) x)),

  -- ------------------------------- Die Kategorie (der entscheidende Punkt)
  (811, 'Kategorie', 'Paare mit GLEICHER Kategorie — hier sortiert heute schon alles richtig',
      (select count(*)::text from paar where v_kat = b_kat)),
  /*
   * DIE ZAHL, AN DER DIE ARCHITEKTUR HAENGT. Jede dieser Zeilen ist ein Fall,
   * in dem „unmittelbar bei der Basisfigur" und die Kategorieordnung des
   * Betreibers sich widersprechen. Ist sie 0, kann die Sortierung erweitert
   * werden, ohne eine bestehende Gruppierung anzufassen. Ist sie gross, ist
   * es eine Produktentscheidung und keine technische.
   */
  (812, 'Kategorie', 'Paare mit ANDERER Kategorie — hier widersprechen sich die Regeln',
      (select count(*)::text from paar where v_kat <> b_kat)),
  (813, 'Kategorie', 'die betroffenen Kategoriepaare, namentlich',
      (select coalesce(string_agg(distinct v_kat_name || ' -> ' || b_kat_name, ' | '),
                       '(keine)') from paar where v_kat <> b_kat)),
  (814, 'Kategorie', 'Beispiele dafuer (die ersten zehn)',
      (select coalesce(string_agg(p.v_id || ' ' || p.v_name || ' [' || p.v_kat_name
                                  || '] -> ' || p.b_id || ' ' || p.b_name || ' ['
                                  || p.b_kat_name || ']', ' | ' order by p.v_id), '(keine)')
         from (select * from paar where v_kat <> b_kat order by v_id limit 10) p)),
  (815, 'Kategorie', 'Info: Kategorien, die NUR Varianten enthalten wuerden',
      (select coalesce(string_agg(x.kat_name, ', ' order by x.kat_name), '(keine)')
         from (select s.kat_name, count(*) as alle,
                      count(*) filter (where exists (select 1 from paar p
                                                      where p.v_id = s.sky_id)) as varianten
                 from sammelbar s group by s.kat_name) x
        where x.alle = x.varianten and x.alle > 0)),
  (816, 'Kategorie', 'Info: alle Kategorienamen mit Position',
      (select coalesce(string_agg(distinct kat_name || '(' || kat_pos::text || ')', ', '),
                       '(keine)') from sammelbar)),

  -- ------------------------------------------------- Die Familie
  (821, 'Familie', 'Paare, in denen die Basisfigur eine Familie hat',
      (select count(*)::text from paar where b_fam is not null)),
  (822, 'Familie', 'davon: die Variante hat KEINE — Uebernahme waere konfliktfrei',
      (select count(*)::text from paar where b_fam is not null and v_fam is null)),
  (823, 'Familie', 'davon: die Variante hat DIESELBE — nichts zu tun',
      (select count(*)::text from paar where b_fam is not null and v_fam = b_fam)),
  /*
   * DIE KONFLIKTE. Eine automatische Uebernahme aus der Basisfigur wuerde
   * diese Zuordnungen still ueberschreiben. Sie muessen auffallen, nicht
   * durchlaufen.
   */
  (824, 'Familie', 'KONFLIKT: Variante und Basisfigur haben VERSCHIEDENE Familien',
      (select count(*)::text from paar
        where b_fam is not null and v_fam is not null and v_fam <> b_fam)),
  (825, 'Familie', 'Variante hat eine Familie, die Basisfigur keine (umgekehrter Fall)',
      (select count(*)::text from paar where b_fam is null and v_fam is not null)),
  (826, 'Familie', 'beide ohne Familie — eine neue waere anzulegen',
      (select count(*)::text from paar where b_fam is null and v_fam is null)),

  -- -------------------------------------------------- Die Ketten
  (831, 'Ketten', 'Figuren, deren Basisfigur selbst eine Variante waere (verboten)',
      (select count(*)::text from paar p
        where exists (select 1 from paar q where q.v_id = p.b_id))),
  (832, 'Ketten', 'die Faelle, namentlich',
      (select coalesce(string_agg(p.v_id || ' ' || p.v_name || ' -> ' || p.b_name
                                  || ' (selbst Variante)', ' | ' order by p.v_id), '(keine)')
         from paar p where exists (select 1 from paar q where q.v_id = p.b_id))),
  (833, 'Ketten', 'Figuren, die sich selbst zugeordnet wuerden (muss 0 sein)',
      (select count(*)::text from paar where v_id = b_id)),
  (834, 'Ketten', 'Info: Basisfiguren mit den meisten Varianten',
      (select coalesce(string_agg(x.b_name || ':' || x.n::text, ', ' order by x.n desc),
                       '(keine)')
         from (select b_name, count(*) as n from paar group by b_name
                order by count(*) desc limit 6) x)),

  -- ------------------------------------------------ Die Struktur
  (841, 'Struktur', 'ist (sky_id, series_code) eindeutig? (traegt den Serienriegel)',
      (select case when count(*) = count(distinct sky_id) then 'ja — sky_id ist PK'
                   else 'NEIN' end from public.skylanders)),
  (842, 'Struktur', 'hat skylanders schon einen Selbstbezug?',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.confrelid = to_regclass('public.skylanders') and c.contype = 'f')),
  (843, 'Struktur', 'vorhandene eindeutige Einschraenkungen auf skylanders',
      (select coalesce(string_agg(c.conname::text || ':' || pg_get_constraintdef(c.oid),
                                  ' | ' order by c.conname), '(keine)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.contype in ('p', 'u'))),
  (844, 'Struktur', 'Info: der zusammengesetzte Fremdschluessel auf categories (die Vorlage)',
      (select coalesce(string_agg(pg_get_constraintdef(c.oid), ' | '), '(keiner)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders') and c.contype = 'f'
          and c.confrelid = to_regclass('public.categories')))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
