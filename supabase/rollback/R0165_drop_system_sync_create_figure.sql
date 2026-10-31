-- ===========================================================================
-- RUECKNAHME VON 0165 — der Systemweg fuer die Figurenanlage verschwindet
--
-- WAS SIE TUT: sie entfernt GENAU EINE Funktion.
--
-- WAS SIE NICHT ANFASST, und das ist hier fast die ganze Datei:
--
--   * KEINE ANGELEGTE FIGUR. Jede Zeile, die `0165` erzeugt hat, bleibt
--     stehen — mit ihrer SKY-ID, ihrem Namen, ihrem Status, ihrer Kategorie.
--     Eine Figur ist eine dauerhafte Identitaet (ADR-0001); sie verschwindet
--     nicht, weil der Weg verschwindet, auf dem sie entstanden ist.
--   * KEINE JOURNALZEILE. Die `created`-Eintraege bleiben in
--     `catalog_admin_changes`. Das ist der Zweck eines Journals, und der
--     Trigger `catalog_admin_changes_append_only` (0004) liesse es ohnehin
--     nicht zu.
--   * KEINE Spalte, keine Tabelle, keine Constraint, kein Trigger, keine
--     andere Funktion. `0165` hat nichts davon angelegt oder veraendert.
--   * NICHT `sky_id_seq`. `0165` hat sie nie angefasst, also gibt es hier
--     nichts zurueckzudrehen.
--
-- SIE VERWIRFT KEINE DATEN. Das ist der Unterschied zu `R0163` oder `R0135`:
-- `0165` fuegt dem Schema nur eine Moeglichkeit hinzu, keine Information.
-- Nach der Ruecknahme ist der Katalog Zeile fuer Zeile derselbe; es fehlt
-- nur der Weg, eine weitere Figur mit vorgegebener SKY-ID anzulegen.
--
-- FOLGE FUER DEN ABGLEICH: ohne diese Funktion kann der Katalogsync keine
-- Figur mehr uebernehmen, ohne die Zusage zu brechen, dass kein erfolgreicher
-- Schreibvorgang ohne seinen erforderlichen Journaleintrag zurueckbleibt.
-- Feldaenderungen an bestehenden Zeilen sind davon NICHT betroffen — die
-- laufen ueber den Tabellentrigger (Klasse A) und die vorhandenen
-- `admin_set_*`-Funktionen (Klasse B).
-- ===========================================================================

do $vor$
begin
  if to_regprocedure(
       'public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint)')
     is null then
    raise notice 'R0165: die Funktion steht nicht — nichts zu tun.';
  end if;
end
$vor$;

drop function if exists public.system_sync_create_figure(
  text, text, text, text, bigint, text, text, text, text, text, smallint);

do $nach$
begin
  if to_regprocedure(
       'public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint)')
     is not null then
    raise exception 'R0165 Nachbedingung: die Funktion steht noch.';
  end if;

  if to_regprocedure('public.system_set_image_override(text,text)') is null then
    raise exception 'R0165 Nachbedingung: system_set_image_override ist fort — '
      'diese Ruecknahme fasst sie nicht an.';
  end if;

  raise notice 'R0165 ok: system_sync_create_figure ist fort, sonst nichts.';
end
$nach$;
