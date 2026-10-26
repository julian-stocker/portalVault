-- ===========================================================================
-- RUECKNAHME VON 0150 — die Verfuegbarkeitsalarme wieder fort
--
-- WAS SIE TUT, in dieser Reihenfolge:
--
--   1. `drop function public.acknowledge_availability_alerts(bigint[])`
--   2. `drop function public.fire_availability_alerts()`
--   3. `drop function public.unwatch_availability(text)`
--   4. `drop function public.watch_availability(text)`
--   5. `drop table public.availability_alerts`
--
-- DIE REIHENFOLGE IST NICHT BELIEBIG — erst die Funktionen, dann die Tabelle.
-- Alle vier lesen oder schreiben `availability_alerts`, und ein `drop table`
-- nimmt sie NICHT mit: weder eine `sql`- noch eine `plpgsql`-Funktion haelt
-- eine Abhaengigkeit auf die Objekte in ihrem Rumpf. Sie blieben als kaputte
-- Funktionen stehen — dieselbe Falle, die `R0145` und `R0146` im Kopf nennen.
-- Richtlinie, die drei Indizes, die Identitaetssequenz und die Rechte gehen
-- mit der Tabelle.
--
-- SIE LOESCHT DATEN, UND SAGT ES VORHER. Und zwar zwei verschiedene Sorten,
-- die beide nirgendwo sonst neu entstehen:
--
--   * JEDER SCHARFE ALARM ist ein ausdruecklicher Wunsch („sag mir, wenn
--     diese Figur wieder da ist"). Niemand merkt, dass er fort ist — es kommt
--     einfach nie eine Meldung.
--   * JEDE MELDUNG samt ihrem Lesezustand ist Historie: was einem Nutzer
--     mitgeteilt wurde und ob er es bestaetigt hat. Nach dieser Ruecknahme
--     und einem neuen `0150` ist die Tabelle leer, und ein Alarm, der schon
--     ausgeloest hatte, muesste neu gesetzt werden.
--
-- Abschnitt 1 zaehlt beides getrennt und BRICHT AB, solange eine Zeile
-- steht. Wer wirklich loeschen will, setzt den Schalter in dieser Datei.
--
-- WAS SIE NICHT ANFASST: `offer_state_live` und `shop_offers()` — sie
-- gehoeren `0146` bzw. `0029`/`0139` und einem Dutzend anderer Stellen.
-- `favorites` ohnehin nicht: `0150` hat sie nie gelesen. Und `offer_state`,
-- `availability_notifications` samt ihren Funktionen bleiben vollstaendig
-- stehen — die alte Bauform wird von dieser Datei nicht beruehrt, in keiner
-- Richtung (ADR-0147: ihr Rueckbau ist ein eigener Schritt mit eigener
-- Freigabe).
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
  v_alle           integer;
  v_scharf         integer;
  v_offen          integer;
  v_zu             integer;
  v_konten         integer;
begin
  if to_regclass('public.availability_alerts') is null then
    raise exception 'R0150 Abbruch: die Tabelle gibt es nicht — 0150 ist hier '
      'nicht angewendet';
  end if;

  select count(*),
         count(*) filter (where notified_at is null),
         count(*) filter (where notified_at is not null and read_at is null),
         count(*) filter (where read_at is not null),
         count(distinct user_id)
    into v_alle, v_scharf, v_offen, v_zu, v_konten
    from public.availability_alerts;

  raise notice 'R0150: % Alarm(e) aus % Konto/Konten wuerden verschwinden — '
    '% scharf, % ausgeloest und unbestaetigt, % abgeschlossen',
    v_alle, v_konten, v_scharf, v_offen, v_zu;

  if v_alle > 0 and not v_auch_mit_daten then
    raise exception 'R0150 Abbruch: % Zeile(n) stehen in der Tabelle. Das ist '
      'kein Fehler, sondern eine Frage: % Konto/Konten haben diese Alarme '
      'ausdruecklich gesetzt, % davon warten noch und % tragen eine Meldung, '
      'die nirgendwo sonst neu entsteht. Wer sie trotzdem verwerfen will, '
      'setzt v_auch_mit_daten in dieser Datei auf true.',
      v_alle, v_konten, v_scharf, v_offen + v_zu;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Fort — erst die vier Funktionen, dann die Tabelle
-- ---------------------------------------------------------------------------
drop function if exists public.acknowledge_availability_alerts(bigint[]);
drop function if exists public.fire_availability_alerts();
drop function if exists public.unwatch_availability(text);
drop function if exists public.watch_availability(text);

drop table public.availability_alerts;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
--
-- Was fort sein muss, ist fort — und was bleiben muss, steht noch. Der
-- zweite Teil ist der wichtigere: eine Ruecknahme, die mehr mitnimmt als
-- ihre Migration angelegt hat, ist keine Ruecknahme.
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer text := 'R0150 Befund';
  v_t   text;
begin
  if to_regclass('public.availability_alerts') is not null then
    raise exception '%: die Tabelle steht noch', v_wer;
  end if;
  for v_t in
    select x from unnest(array['public.watch_availability(text)',
                               'public.unwatch_availability(text)',
                               'public.fire_availability_alerts()',
                               'public.acknowledge_availability_alerts(bigint[])']) x
  loop
    if to_regprocedure(v_t) is not null then
      raise exception '%: % steht noch', v_wer, v_t;
    end if;
  end loop;

  -- Die Identitaetssequenz ging mit der Tabelle; falls nicht, waere sie eine
  -- Waise, die ein neues `0150` am `create table` scheitern liesse.
  if to_regclass('public.availability_alerts_id_seq') is not null then
    raise exception '%: die Identitaetssequenz steht noch', v_wer;
  end if;

  -- Was 0150 vorausgesetzt hat, gehoert ihr nicht.
  if to_regclass('public.offer_state_live') is null then
    raise exception '%: offer_state_live wurde mitgenommen — sie gehoert 0146 '
      'und ist die einzige Definition von "jetzt kaufbar"', v_wer;
  end if;
  if to_regprocedure('public.shop_offers()') is null then
    raise exception '%: shop_offers() wurde mitgenommen', v_wer;
  end if;
  if to_regclass('public.skylanders') is null then
    raise exception '%: skylanders wurde mitgenommen', v_wer;
  end if;
  if to_regprocedure('public.is_collector_account()') is null then
    raise exception '%: is_collector_account() wurde mitgenommen — sie gehoert '
      '0042 und jeder Sammlungsrichtlinie', v_wer;
  end if;

  raise notice 'R0150 ok: availability_alerts und die vier Funktionen sind '
    'fort. offer_state_live, shop_offers, skylanders und '
    'is_collector_account stehen unberuehrt; die alte Bauform (offer_state, '
    'availability_notifications) ist von dieser Datei nicht beruehrt worden.';
end $$;
