-- ===========================================================================
-- 0033 - slug parity: public.slugify() against src/lib/catalog/slug.ts
--
-- RUN THIS ON STAGING, IN THE SQL EDITOR, AFTER APPLYING 0033.
--
-- WHY IT IS A FILE AND NOT A UNIT TEST
--
-- vitest.config.mts collects src/**/*.test.ts and nothing in this product
-- talks to a database from a test - there is no DOM and no connection. So the
-- TypeScript suite holds the two implementations against each other by
-- READING the SQL, step by step, in src/lib/catalog/slug-sql-parity.test.ts,
-- and this file is the half that EXECUTES it.
--
-- The expected values below were not typed by hand. They were produced by
-- calling the TypeScript slugify() over these same names, so a disagreement
-- here is a real disagreement between the two implementations rather than a
-- transcription mistake.
--
-- IT WRITES NOTHING. Every statement is a select.
-- ===========================================================================

do $$
declare
  v_case record;
  v_got  text;
  v_bad  int := 0;
begin
  for v_case in
    select * from (values
      ('Drobot', 'drobot'),
      ('Spyro''s Adventure', 'spyros-adventure'),
      ('Spyro (Series 2)', 'spyro-series-2'),
      ('Game (Xbox 360)', 'game-xbox-360'),
      ('Dino-Rang', 'dino-rang'),
      ('Grim Creeper - Lightcore', 'grim-creeper-lightcore'),
      ('Eon''s Elite Boomer', 'eons-elite-boomer'),
      ('Start Strike (LC, Enchanted)', 'start-strike-lc-enchanted'),
      ('Turbo Charge D.K.', 'turbo-charge-d-k'),
      ('Kaos in OVP', 'kaos-in-ovp'),
      ('Elite Boomer - ohne OVP', 'elite-boomer-ohne-ovp'),
      ('Legendary Grim Creemper', 'legendary-grim-creemper'),
      ('Blitzstrahl Über', 'blitzstrahl-ueber'),
      ('Käpt''n Blaubär', 'kaeptn-blaubaer'),
      ('Straße', 'strasse'),
      ('ẞSTRASSE', 'ssstrasse'),
      ('Zoo Lou (Légendaire)', 'zoo-lou-legendaire'),
      ('Spüle Öl Ära', 'spuele-oel-aera'),
      ('  Trim   Me  ', 'trim-me'),
      ('Spyro’s', 'spyros'),
      ('café crème', 'cafe-creme'),
      ('---weird---', 'weird'),
      ('Double Trouble 1.5', 'double-trouble-1-5'),
      ('Horn Blast Whirwind (Clear Crystal)', 'horn-blast-whirwind-clear-crystal'),
      ('Schöner Söldner', 'schoener-soeldner'),
      ('ÄÖÜäöü', 'aeoeueaeoeue')
    ) as t(name, expected)
  loop
    v_got := public.slugify(v_case.name);
    if v_got is distinct from v_case.expected then
      raise warning 'MISMATCH  input=%  sql=%  ts=%', v_case.name, v_got, v_case.expected;
      v_bad := v_bad + 1;
    end if;
  end loop;

  if v_bad > 0 then
    raise exception '% of the slug fixtures disagree between SQL and TypeScript', v_bad;
  end if;

  raise notice 'slug parity: all fixtures agree';
end;
$$;


-- ---------------------------------------------------------------------------
-- The three-stage rule of ADR-0011, read-only.
--
-- Stage 1 is the bare name. Stage 2 qualifies with the SERIES LABEL, never
-- the code. Stage 3 appends the SKY-ID and cannot collide.
--
-- Every name below is already taken by the row it comes from, so stage 1 is
-- guaranteed to be contested and stage 2 is what comes back.
-- ---------------------------------------------------------------------------
select
  s.sky_id,
  s.slug                                                     as already_taken,
  public.next_figure_slug(s.name, s.series_code, 'SKY-0821')  as a_new_figure_would_get
from public.skylanders s
order by s.sky_id
limit 5;


-- ---------------------------------------------------------------------------
-- The allocator has not been drawn from yet.
--
-- last_value 821 with is_called = false means "821 has never been issued".
-- After the first successful create it reads 821 with is_called = true.
-- ---------------------------------------------------------------------------
select last_value, is_called from public.sky_id_seq;


-- ---------------------------------------------------------------------------
-- Nothing sits in the productive range yet, and the reserved band is intact.
-- ---------------------------------------------------------------------------
select
  count(*) filter (where sky_id between 'SKY-0821' and 'SKY-8999') as in_productive_range,
  count(*) filter (where sky_id >= 'SKY-9000')                     as in_reserved_range,
  count(*) filter (where source = 'admin')                         as admin_created,
  count(*)                                                         as total
from public.skylanders;
