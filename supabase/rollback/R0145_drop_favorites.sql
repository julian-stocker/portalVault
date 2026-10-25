-- ===========================================================================
-- RUECKNAHME VON 0145 — die Favoriten wieder fort
--
-- WAS SIE TUT: `drop function public.favorite_demand(text[])` und
-- `drop table public.favorites`. Richtlinien, Index und Rechte gehen mit der
-- Tabelle. `is_collector_account()` und `can_operate_active_seller()`
-- bleiben — sie gehoeren `0041`/`0042` und einem Dutzend anderer Stellen.
--
-- SIE LOESCHT DATEN, UND SAGT ES VORHER. Jede vorgemerkte Figur ist fort,
-- und zwar fuer jedes Konto. Abschnitt 1 zaehlt, was verschwinden wuerde, und
-- BRICHT AB, wenn es mehr als null ist — wer wirklich loeschen will, setzt
-- den Schalter unten.
--
-- DIE SAMMLUNG IST NICHT BETROFFEN. `collection_items` ist eine andere
-- Tabelle, und keine der beiden liest die andere. Nach dieser Ruecknahme
-- besitzt jedes Konto genau dieselben Figuren wie vorher; nur was jemand
-- vorgemerkt hatte, ist fort.
--
-- REIHENFOLGE. Erst die Funktion, dann die Tabelle: `favorite_demand()`
-- liest `favorites`, und ein `drop table` wuerde sie als abhaengiges Objekt
-- nicht mitnehmen (eine `plpgsql`-Funktion haelt keine Abhaengigkeit auf
-- die Tabellen in ihrem Rumpf). Sie bliebe als kaputte Funktion stehen.
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
  v_konten         integer;
begin
  if to_regclass('public.favorites') is null then
    raise exception 'R0145 Abbruch: die Tabelle gibt es nicht — 0145 ist hier '
      'nicht angewendet';
  end if;

  select count(*), count(distinct user_id) into v_n, v_konten
    from public.favorites;
  raise notice 'R0145: % Favorit(en) aus % Konto/Konten wuerden verschwinden',
    v_n, v_konten;

  if v_n > 0 and not v_auch_mit_daten then
    raise exception 'R0145 Abbruch: % Zeile(n) stehen in der Tabelle. Das ist '
      'kein Fehler, sondern eine Frage: diese Figuren haben % Konto/Konten '
      'ausdruecklich vorgemerkt, und die Angabe entsteht nirgendwo sonst neu. '
      'Wer sie trotzdem verwerfen will, setzt v_auch_mit_daten in dieser '
      'Datei auf true.', v_n, v_konten;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Fort — erst die Funktion, dann die Tabelle
-- ---------------------------------------------------------------------------
drop function if exists public.favorite_demand(text[]);

drop table public.favorites;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
--
-- Was fort sein muss, ist fort — und was bleiben muss, steht noch. Der
-- zweite Teil ist der wichtigere: eine Ruecknahme, die mehr mitnimmt als
-- ihre Migration angelegt hat, ist keine Ruecknahme.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.favorites') is not null then
    raise exception 'R0145 Befund: die Tabelle steht noch';
  end if;
  if to_regprocedure('public.favorite_demand(text[])') is not null then
    raise exception 'R0145 Befund: favorite_demand(text[]) steht noch';
  end if;

  if to_regclass('public.collection_items') is null then
    raise exception 'R0145 Befund: collection_items wurde mitgenommen — die '
      'Sammlung hat mit den Favoriten nichts zu tun';
  end if;
  if to_regclass('public.skylanders') is null then
    raise exception 'R0145 Befund: skylanders wurde mitgenommen';
  end if;
  if to_regprocedure('public.is_collector_account()') is null then
    raise exception 'R0145 Befund: is_collector_account() wurde mitgenommen — '
      'sie gehoert 0042 und jeder Sammlungsrichtlinie';
  end if;
  if to_regprocedure('public.can_operate_active_seller()') is null then
    raise exception 'R0145 Befund: can_operate_active_seller() wurde '
      'mitgenommen — sie gehoert 0041 und jeder seller_*-Funktion';
  end if;

  raise notice 'R0145 ok: favorites und favorite_demand sind fort. '
    'collection_items, skylanders, is_collector_account und '
    'can_operate_active_seller stehen unberuehrt.';
end $$;
