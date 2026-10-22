-- ===========================================================================
-- RUECKNAHME VON 0142 — die gespeicherten Kalkulationen wieder fort
--
-- WAS SIE TUT: `drop table public.purchase_calculations`. Richtlinien,
-- Indizes, Trigger und Rechte gehen mit der Tabelle; `set_updated_at()`
-- bleibt — sie gehoert `0001` und drei anderen Tabellen.
--
-- SIE LOESCHT DATEN, UND SAGT ES VORHER. Jede gespeicherte Kalkulation ist
-- fort, und zwar fuer jedes Konto. Abschnitt 1 zaehlt, was verschwinden
-- wuerde, und BRICHT AB, wenn es mehr als null ist — wer wirklich loeschen
-- will, setzt den Schalter unten.
--
-- Der Arbeitsstand im Browser ist davon NICHT betroffen: er liegt in
-- `localStorage` und kennt diese Tabelle nicht. Nach dieser Ruecknahme
-- rechnet der Kalkulator weiter, nur speichern kann er nicht mehr.
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Wie viel wuerde verschwinden?
--
-- Der Schalter steht absichtlich IN der Datei und nicht in einem Kommentar:
-- wer sie unveraendert faehrt, loescht nichts.
-- ---------------------------------------------------------------------------
do $$
declare
  -- Auf `true` setzen, um auch Zeilen zu verwerfen.
  v_auch_mit_daten boolean := false;
  v_n              integer;
begin
  if to_regclass('public.purchase_calculations') is null then
    raise exception 'R0142 Abbruch: die Tabelle gibt es nicht — 0142 ist hier '
      'nicht angewendet';
  end if;

  select count(*) into v_n from public.purchase_calculations;
  raise notice 'R0142: % gespeicherte Kalkulation(en) wuerden verschwinden', v_n;

  if v_n > 0 and not v_auch_mit_daten then
    raise exception 'R0142 Abbruch: % Zeile(n) stehen in der Tabelle. Das ist '
      'kein Fehler, sondern eine Frage: diese Kalkulationen hat jemand '
      'ausdruecklich gespeichert. Wer sie trotzdem verwerfen will, setzt '
      'v_auch_mit_daten in dieser Datei auf true.', v_n;
  end if;

  -- Eine bereits uebernommene Kalkulation ist der Nachweis, welcher Einkauf
  -- aus welcher Bewertung entstand. Sie fortzuwerfen loescht keinen Einkauf,
  -- aber die Verbindung dorthin.
  select count(*) into v_n from public.purchase_calculations
   where purchase_id is not null;
  if v_n > 0 then
    raise notice 'R0142 Hinweis: davon % mit einem Einkauf verknuepft — die '
      'Einkaeufe bleiben, die Zuordnung ist fort', v_n;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Fort
-- ---------------------------------------------------------------------------
drop table public.purchase_calculations;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.purchase_calculations') is not null then
    raise exception 'R0142 Befund: die Tabelle steht noch';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'R0142 Befund: set_updated_at() wurde mitgenommen — sie '
      'gehoert 0001 und drei anderen Tabellen';
  end if;
  if to_regclass('public.purchases') is null then
    raise exception 'R0142 Befund: public.purchases wurde mitgenommen';
  end if;
  raise notice 'R0142 ok: purchase_calculations ist fort, set_updated_at und '
    'purchases stehen unberuehrt.';
end $$;
