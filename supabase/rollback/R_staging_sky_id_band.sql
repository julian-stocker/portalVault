-- ===========================================================================
-- RUECKNAHME DER SKY-ID-BEREICHSSPERRE AUF STAGING
--
-- Nimmt zurueck, was `supabase/operations/staging-sky-id-band.sql` gesetzt hat:
-- Unter- und Obergrenze an `public.sky_id_seq`. Als `postgres` im Projekt
-- qqxcpesbwfxzgytkdsac.
--
-- *** SIE STELLT DEN STAND VOR DER SPERRE NICHT WIEDER HER ***
--
-- Das kann sie nicht. `restart with 928` hat `last_value` gesetzt, und wo die
-- Sequenz vorher stand, weiss nur das A5-NOTICE des Laufs. Diese Datei
-- verlangt die Zahl deshalb als Angabe und raet nicht:
--
--     select set_config('skyisles.zurueck', '890', true);
--
-- DEN WERT AUS DEM A5-NOTICE DES LAUFS NEHMEN, nicht aus diesem Kommentar.
-- `890` steht hier als Beispiel und ist mit Sicherheit falsch.
--
-- *** WANN SIE NICHT DIE RICHTIGE DATEI IST ***
--
-- Ist unter der Sperre schon eine Nummer vergeben worden — etwa durch die
-- Umnummerierung von SKY-0821 —, dann ist das Zuruecksetzen der Zaehlung
-- GEFAEHRLICH: die Sequenz wuerde eine Nummer ein zweites Mal vergeben, und
-- eine SKY-ID wird niemals wiederverwendet (ADR-0001). A2 bricht dann ab.
-- Wer in diesem Zustand nur die Grenzen loesen will, nimmt die Zahl aus dem
-- aktuellen `last_value` und nicht die alte.
-- ===========================================================================

begin;

do $w$
declare
  v_zurueck bigint;
  v_last    bigint;
  v_im_band bigint;
begin
  -- A1 — die Umgebung. Nach einer Umnummerierung ist das Paar unvollstaendig;
  --      dann ist A1 bewusst streng und verlangt eine bewusste Entscheidung.
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821','SKY-0822')) < 1 then
    raise exception 'A1 ABBRUCH: kein Staging-Marker gefunden. Diese Datei '
      'laeuft nur auf STAGING.';
  end if;

  -- A2 — unter der Sperre darf noch nichts vergeben worden sein.
  select count(*) into v_im_band from (
      select sky_id from public.skylanders
       where sky_id between 'SKY-0928' and 'SKY-4999'
    union
      select entity_id from public.catalog_admin_changes
       where entity = 'skylander' and entity_id between 'SKY-0928' and 'SKY-4999') q;
  if v_im_band > 0 then
    raise exception 'A2 ABBRUCH: im Band stehen schon % SKY-ID(s). Ein '
      'Zuruecksetzen der Zaehlung vergaebe sie ein zweites Mal (ADR-0001). '
      'Diese Datei ist hier die falsche.', v_im_band;
  end if;

  -- A3 — die Zahl muss angegeben sein, und sie muss unter dem Band liegen.
  v_zurueck := nullif(btrim(coalesce(current_setting('skyisles.zurueck', true), '')), '')::bigint;
  if v_zurueck is null then
    raise exception 'A3 ABBRUCH: skyisles.zurueck ist nicht gesetzt. Die Zahl '
      'steht im A5-NOTICE des Laufs; sie wird nicht geraten.';
  end if;
  if v_zurueck >= 928 then
    raise exception 'A3 ABBRUCH: % liegt im neuen Band. Das war nicht der '
      'Stand vor der Sperre.', v_zurueck;
  end if;

  select last_value into v_last from public.sky_id_seq;
  raise notice 'A4: Sequenz steht bei %, wird auf % zurueckgesetzt, Grenzen fallen.',
    v_last, v_zurueck;
end
$w$;

-- Die eine wirksame Anweisung. `start with 1` wie vor der Sperre; die
-- Zaehlung selbst kommt aus der Angabe.
do $r$
declare v_zurueck bigint := current_setting('skyisles.zurueck', true)::bigint;
begin
  execute format('alter sequence public.sky_id_seq minvalue 1 maxvalue %s '
                 'start with 1 restart with %s',
                 9223372036854775807::text, v_zurueck::text);
end
$r$;

do $n$
declare v_min bigint; v_max bigint; v_last bigint;
begin
  select min_value, max_value into v_min, v_max from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq';
  select last_value into v_last from public.sky_id_seq;
  if v_min <> 1 or v_max <> 9223372036854775807 then
    raise exception 'Nachbedingung: die Grenzen stehen noch (% .. %).', v_min, v_max;
  end if;
  raise notice 'ok: Grenzen gefallen, Sequenz bei %. Der reservierte Bereich ab '
    'SKY-9000 ist damit wieder nur per Konvention geschuetzt.', v_last;
end
$n$;

commit;
