-- ===========================================================================
-- RUECKNAHME von 0133 — den Trigger auf purchases wieder entfernen
--
-- NICHT TEIL DER MIGRATIONSKETTE. Nur nach ausdruecklicher Entscheidung, in
-- `begin` / `commit` geklammert.
--
-- WAS SIE TUT: sie entfernt den Trigger `purchases_paid_total_immutable_trg`
-- und seine Funktion. Danach ist die bezahlte Summe eines importierten
-- Einkaufs wieder mit einem direkten `update` als `postgres` aenderbar — der
-- Riegel aus `0132` in `seller_update_purchase` bleibt und deckt weiterhin
-- jeden Weg der Anwendung ab.
--
-- WANN MAN DAS WILL: um einen echten Erfassungsfehler in einer historischen
-- Summe zu korrigieren. Dafuer ist die mildere Form besser als die Ruecknahme:
--
--     alter table public.purchases disable trigger purchases_paid_total_immutable_trg;
--     -- die eine Korrektur, protokolliert
--     alter table public.purchases enable  trigger purchases_paid_total_immutable_trg;
--
-- Das laesst den Schutz stehen und macht die Ausnahme sichtbar. Diese Datei
-- ist fuer den Fall, dass `0133` als Ganzes zurueckgenommen werden soll.
--
-- WAS SIE NICHT TUT: sie faesst keine Daten an. Kein `insert`, `update`,
-- `delete`, kein DDL an einer Spalte.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_trigger
                  where not tgisinternal
                    and tgname = 'purchases_paid_total_immutable_trg') then
    raise exception 'R0133 Abbruch: der Trigger steht hier nicht — 0133 ist nicht angewendet';
  end if;
end $$;

drop trigger if exists purchases_paid_total_immutable_trg on public.purchases;

drop function if exists public.purchases_paid_total_is_final();

do $$
begin
  if exists (select 1 from pg_trigger
              where not tgisinternal
                and tgname = 'purchases_paid_total_immutable_trg') then
    raise exception 'R0133 Abbruch: der Trigger steht noch';
  end if;
  if to_regprocedure('public.purchases_paid_total_is_final()') is not null then
    raise exception 'R0133 Abbruch: die Triggerfunktion steht noch';
  end if;
  /* Was bleiben MUSS: der Riegel in der Funktion, die die Anwendung ruft. */
  if position('the paid total of an imported purchase is final' in
        coalesce((select p.prosrc from pg_proc p
                   where p.oid = to_regprocedure(
                     'public.seller_update_purchase(bigint, date, numeric, text,'
                     || ' text, text, numeric, numeric, numeric, text, text,'
                     || ' boolean, text, text, text, text, text, text, text,'
                     || ' text, text)')), '')) = 0 then
    raise exception 'R0133 Abbruch: auch der Riegel aus 0132 ist weg — dann waere die Zahlung voellig offen';
  end if;
  raise notice 'R0133: der Trigger ist entfernt, der Riegel aus 0132 steht';
end $$;
