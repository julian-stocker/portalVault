-- ===========================================================================
-- RUECKNAHME VON 0151 — die Live-Sicht wieder fort
--
-- WAS SIE TUT: `drop view public.offer_state_live`. Das ist alles; `0151`
-- hat nichts anderes angelegt.
--
-- *** SIE VERWEIGERT, SOLANGE IRGENDWER DIE SICHT LIEST — UND DAS IST DER
-- *** GANZE ZWECK DIESER DATEI
--
-- PostgreSQL schuetzt hier NICHT. Eine Sicht haelt Abhaengigkeiten nur zu
-- Objekten, die sie SELBST liest; was UMGEKEHRT sie liest, steht nirgends im
-- Katalog, sobald es ein Funktionsrumpf ist — weder `sql` noch `plpgsql`
-- tragen eine Abhaengigkeit auf die Objekte in ihrem Rumpf (dieselbe Falle,
-- die `R0145`, `R0146` und `R0150` im Kopf nennen, nur in der anderen
-- Richtung). Ein `drop view` liefe also glatt durch und hinterliesse vier
-- kaputte Funktionen, die erst beim naechsten Aufruf auffallen — also
-- moeglicherweise erst, wenn ein Sammler eine Glocke drueckt.
--
-- Deshalb steht hier eine NAMENSLISTE, und sie ist gemessen und nicht
-- geraten: jedes Objekt, dessen Rumpf `offer_state_live` nennt.
--
--   public.refresh_offer_state()          0146/0147  — zieht den Spiegel nach
--   public.offer_availability_due()       0147       — die Faelligkeitsfrage
--   public.watch_availability(text)       0150       — scharf stellen
--   public.fire_availability_alerts()     0150       — der Abgleich
--
-- Steht eines davon, bricht diese Datei ab. Wer die Sicht trotzdem verwerfen
-- will, nimmt ZUERST die Leser zurueck (`R0150`, `R0147`) oder setzt den
-- Schalter unten.
--
-- WAS SIE NICHT ANFASST: `shop_offers()` und `v1_sale_condition()` — sie
-- gehoeren `0029`/`0139` bzw. `0028` und einem Dutzend anderer Stellen. Und
-- sie fasst `offer_state`, `favorites` und `availability_notifications`
-- nicht an, in keiner Richtung.
--
-- *** WICHTIG FUER DEN SPAETEREN RUECKBAU DER ALTEN ARCHITEKTUR (M9) ***
--
-- Diese Datei ist NICHT der Weg, um `0146` zurueckzunehmen. `R0146`
-- enthaelt `drop view if exists public.offer_state_live` und wuerde die
-- Sicht mitnehmen — nach der Einfuehrung von `0150` waere das ein Bruch der
-- neuen Benachrichtigungsfunktion. Der Rueckbau braucht deshalb eine eigene
-- Fassung, die den Spiegel nimmt und die Sicht LAESST; Anforderungen und
-- Begruendung stehen in `supabase/checks/0151_staging_run.md`, Abschnitt
-- „Der spaetere Rueckbau". Sie wird erst mit M9 geschrieben und braucht eine
-- eigene Freigabe (Entscheidung E-4).
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Liest irgendwer die Sicht?
--
-- Der Schalter steht absichtlich IN der Datei und nicht in einem Kommentar:
-- wer sie unveraendert faehrt, zerbricht nichts.
-- ---------------------------------------------------------------------------
do $$
declare
  -- Auf `true` setzen, um die Sicht auch dann zu verwerfen, wenn sie
  -- gelesen wird. Die Leser sind danach KAPUTT, bis sie neu entstehen.
  v_auch_mit_lesern boolean := false;
  v_leser           text;
  v_n               integer;
begin
  if to_regclass('public.offer_state_live') is null then
    raise notice 'R0151: public.offer_state_live steht nicht — nichts zu tun';
    return;
  end if;

  select coalesce(string_agg(x, ', ' order by x), '(keiner)'), count(*)
    into v_leser, v_n
    from unnest(array['public.refresh_offer_state()',
                      'public.offer_availability_due()',
                      'public.watch_availability(text)',
                      'public.fire_availability_alerts()']) x
   where to_regprocedure(x) is not null;

  raise notice 'R0151: % Leser der Sicht vorhanden: %', v_n, v_leser;

  if v_n > 0 and not v_auch_mit_lesern then
    raise exception 'R0151 Abbruch: % Funktion(en) lesen die Sicht in ihrem '
      'Rumpf (%). PostgreSQL haelt darauf KEINE Abhaengigkeit, ein drop view '
      'liefe also durch und hinterliesse sie kaputt — bemerkt erst beim '
      'naechsten Aufruf. Erst die Leser zuruecknehmen (R0150, R0147), dann '
      'diese Datei. Oder v_auch_mit_lesern in dieser Datei auf true setzen.',
      v_n, v_leser;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Fort
--
-- `if exists`: diese Datei darf auf einer Umgebung laufen, auf der `0151`
-- nie angewendet wurde, ohne zu scheitern.
-- ---------------------------------------------------------------------------
drop view if exists public.offer_state_live;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
--
-- Was fort sein muss, ist fort — und was bleiben muss, steht noch. Der
-- zweite Teil ist der wichtigere: eine Ruecknahme, die mehr mitnimmt als
-- ihre Migration angelegt hat, ist keine Ruecknahme.
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer text := 'R0151 Befund';
begin
  if to_regclass('public.offer_state_live') is not null then
    raise exception '%: die Sicht steht noch', v_wer;
  end if;

  if to_regprocedure('public.shop_offers()') is null then
    raise exception '%: shop_offers() wurde mitgenommen — sie gehoert '
      '0029/0139 und jeder Angebotsfrage dieses Projekts', v_wer;
  end if;
  if to_regprocedure('public.v1_sale_condition()') is null then
    raise exception '%: v1_sale_condition() wurde mitgenommen — sie gehoert '
      '0028', v_wer;
  end if;
  if to_regclass('public.shop_inventory') is null then
    raise exception '%: shop_inventory wurde mitgenommen', v_wer;
  end if;

  raise notice 'R0151 ok: offer_state_live ist fort. shop_offers, '
    'v1_sale_condition und shop_inventory stehen unberuehrt; offer_state, '
    'favorites und availability_notifications sind von dieser Datei nicht '
    'beruehrt worden.';
end $$;
