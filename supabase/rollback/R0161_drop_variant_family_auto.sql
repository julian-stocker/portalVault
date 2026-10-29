-- ===========================================================================
-- RUECKNAHME VON 0161 — die automatische Familienbildung wieder entfernen
--
-- WAS SIE TUT: `drop function if exists
-- public.admin_publish_variant_auto(text, text)`. Danach gibt es Weg B nur
-- noch in der Fassung aus `0159`, mit dem Kennzeichen `p_create_family` —
-- die Oberfläche muss dann wieder fragen.
--
-- WAS SIE NICHT ANFASST:
--
--   * KEINE ZEILE UND KEINE SPALTE. Jede Familie, die diese Funktion
--     angelegt oder zugeordnet hat, BLEIBT. Sie zurueckzunehmen hiesse,
--     redaktionelle Entscheidungen zu loeschen, die inzwischen gelten — und
--     das Journal (`catalog_admin_changes`) haelt jede einzelne fest.
--   * Keine Funktion aus `0158`, `0159` oder `0152`. Diese Datei entfernt
--     EINE Funktion, und zwar die, die `0161` angelegt hat.
--   * Keine Tabelle, keinen Index, keine Richtlinie, keinen Trigger, keine
--     Rechte an fremden Objekten.
--
-- WAS SIE KOSTET: der Bediener muss die Familienfrage wieder selbst
-- beantworten. Fachlich geht nichts verloren.
--
-- SIE IST IDEMPOTENT: steht die Funktion nicht, laeuft sie durch und aendert
-- nichts.
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert.
-- ===========================================================================

do $vor$
begin
  if to_regprocedure('public.admin_publish_variant_auto(text,text)') is null then
    raise notice 'R0161: admin_publish_variant_auto gibt es hier nicht. Der Lauf '
      'aendert nichts.';
  end if;
end
$vor$;

drop function if exists public.admin_publish_variant_auto(text, text);

do $nach$
declare
  v_fam bigint;
  v_var bigint;
begin
  if to_regprocedure('public.admin_publish_variant_auto(text,text)') is not null then
    raise exception 'R0161 Nachbedingung: die Funktion steht noch';
  end if;

  -- Die Wege aus 0158/0159 muessen weiter da sein — sonst hat diese
  -- Ruecknahme mehr entfernt, als ihr gehoert.
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null
     or to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is null
     or to_regprocedure('public.admin_publish_as_variant(text,bigint)') is null
     or to_regprocedure('public.admin_create_character(text)') is null
     or to_regprocedure('public.admin_set_character(text,bigint)') is null then
    raise exception 'R0161 Nachbedingung: eine Funktion aus 0158/0159 ist mit '
      'entfernt worden — das waere ein Schritt zu viel';
  end if;

  -- Und der Beweis, dass keine Zuordnung angetastet wurde.
  select count(*) into v_fam from public.skylanders where character_id is not null;
  select count(*) into v_var from public.skylanders where base_sky_id is not null;
  raise notice 'R0161: die Funktion ist fort. Unberuehrt: % Zeilen mit Familie, '
    '% Varianten mit Basisfigur.', v_fam, v_var;
end
$nach$;
