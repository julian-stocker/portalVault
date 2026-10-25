-- ===========================================================================
-- RUECKNAHME VON 0146 — der Angebotsspiegel wieder fort
--
-- WAS SIE TUT, in dieser Reihenfolge:
--
--   1. `drop function public.refresh_offer_state()`
--   2. `drop view public.offer_state_live`
--   3. `drop table public.offer_state`
--   4. `drop function public.offer_state_window()`
--
-- DIE REIHENFOLGE IST NICHT BELIEBIG. Die Funktion liest die Sicht, die
-- Sicht liest `shop_offers()`, und `offer_state_window()` wird von der
-- Funktion gefragt. Eine `plpgsql`-Funktion haelt keine Abhaengigkeit auf
-- die Objekte in ihrem Rumpf — sie bliebe als kaputte Funktion stehen, wenn
-- man die Tabelle zuerst nimmt.
--
-- SIE LOESCHT DATEN, UND SAGT ES VORHER. Die `announced_*`-Spalten sind der
-- einzige nicht wiederherstellbare Teil des Spiegels: `buyable`,
-- `cheapest_cents` und `changed_at` entstehen beim naechsten
-- `refresh_offer_state()` neu, der gemeldete Stand nicht. Nach dieser
-- Ruecknahme und einem neuen `0146` ist die Tabelle leer, die
-- Erstbefuellung setzt `announced_* = Ist-Zustand`, und damit ist nichts
-- doppelt gemeldet — **solange S2 noch nicht steht**. Liefe S2 schon, waere
-- der Verlust der `announced_*` genau der Fall, in dem jede Figur neu
-- gemeldet wuerde; Abschnitt 1 zaehlt deshalb, was verschwinden wuerde, und
-- BRICHT AB, sobald ein gemeldeter Stand darin steht.
--
-- WAS SIE NICHT ANFASST: `shop_offers()`, `v1_sale_condition()`,
-- `reservation_ttl()`, `shop_inventory`, `skylanders`, `shop_settings`,
-- `favorites`. Nichts davon gehoert `0146`.
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Wie viel wuerde verschwinden?
--
-- Der Schalter steht absichtlich IN der Datei und nicht in einem Kommentar:
-- wer sie unveraendert faehrt, loescht keinen gemeldeten Stand.
-- ---------------------------------------------------------------------------
do $$
declare
  -- Auf `true` setzen, um auch gemeldete Staende zu verwerfen.
  v_auch_gemeldet boolean := false;
  v_zeilen    integer;
  v_gemeldet  integer;
begin
  if to_regclass('public.offer_state') is null then
    raise exception 'R0146 Abbruch: die Tabelle gibt es nicht — 0146 ist hier '
      'nicht angewendet';
  end if;

  select count(*), count(*) filter (where announced_at is not null)
    into v_zeilen, v_gemeldet
    from public.offer_state;

  raise notice 'R0146: % Spiegelzeile(n), davon % mit gemeldetem Stand',
    v_zeilen, v_gemeldet;

  if v_gemeldet > 0 and not v_auch_gemeldet then
    raise exception 'R0146 Abbruch: % Zeile(n) tragen einen GEMELDETEN Stand '
      '(announced_at). Das ist kein Fehler, sondern eine Frage: dieser Stand '
      'ist der einzige Teil des Spiegels, der nicht aus shop_offers() neu '
      'entsteht. Wird er verworfen und laeuft S2 schon, meldet die naechste '
      'Pruefung JEDE Figur erneut. Wer das trotzdem will, setzt '
      'v_auch_gemeldet in dieser Datei auf true.', v_gemeldet;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Fort — Funktion, Sicht, Tabelle, Fensterfunktion
-- ---------------------------------------------------------------------------
drop function if exists public.refresh_offer_state();

drop view if exists public.offer_state_live;

drop table public.offer_state;

drop function if exists public.offer_state_window();


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
--
-- Was fort sein muss, ist fort — und was bleiben muss, steht noch. Der
-- zweite Teil ist der wichtigere: eine Ruecknahme, die mehr mitnimmt als
-- ihre Migration angelegt hat, ist keine Ruecknahme.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.offer_state') is not null then
    raise exception 'R0146 Befund: die Tabelle steht noch';
  end if;
  if to_regclass('public.offer_state_live') is not null then
    raise exception 'R0146 Befund: die Sicht steht noch';
  end if;
  if to_regprocedure('public.refresh_offer_state()') is not null then
    raise exception 'R0146 Befund: refresh_offer_state() steht noch';
  end if;
  if to_regprocedure('public.offer_state_window()') is not null then
    raise exception 'R0146 Befund: offer_state_window() steht noch';
  end if;

  if to_regprocedure('public.shop_offers()') is null then
    raise exception 'R0146 Befund: shop_offers() wurde mitgenommen — sie '
      'gehoert 0029/0139 und dem ganzen Shop';
  end if;
  if to_regprocedure('public.v1_sale_condition()') is null then
    raise exception 'R0146 Befund: v1_sale_condition() wurde mitgenommen';
  end if;
  if to_regprocedure('public.reservation_ttl()') is null then
    raise exception 'R0146 Befund: reservation_ttl() wurde mitgenommen — sie '
      'gehoert 0010 und dem Warenkorb';
  end if;
  if to_regclass('public.shop_inventory') is null then
    raise exception 'R0146 Befund: shop_inventory wurde mitgenommen';
  end if;
  if to_regclass('public.favorites') is null then
    raise exception 'R0146 Befund: favorites wurde mitgenommen — sie gehoert '
      '0145';
  end if;

  raise notice 'R0146 ok: offer_state, offer_state_live, '
    'refresh_offer_state und offer_state_window sind fort. shop_offers, '
    'v1_sale_condition, reservation_ttl, shop_inventory und favorites stehen '
    'unberuehrt.';
end $$;
