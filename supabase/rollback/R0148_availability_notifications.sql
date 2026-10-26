-- ===========================================================================
-- RUECKNAHME VON 0148 — die persoenlichen Meldungen wieder fort
--
-- WAS SIE TUT, in dieser Reihenfolge:
--
--   1. `drop function public.claim_availability_notifications()`
--   2. `drop table public.availability_notifications`
--
-- DIE REIHENFOLGE IST NICHT BELIEBIG. Die Funktion schreibt in die Tabelle.
-- Eine `language sql`-Funktion haelt zwar eine Abhaengigkeit, aber die
-- Reihenfolge ist trotzdem die richtige: zuerst der Schreiber, dann das
-- Geschriebene.
--
-- SIE LOESCHT DATEN, UND SAGT ES VORHER. Jede gespeicherte Meldung
-- verschwindet. Das ist der einzige nicht wiederherstellbare Teil von
-- `0148`: `offer_state.announced_*` bleibt, also gilt jede gemeldete Phase
-- weiterhin als gemeldet — nach einer Ruecknahme und einem erneuten `0148`
-- entsteht fuer DIESE Phasen also KEINE neue Meldung. Das ist die richtige
-- Richtung: lieber eine verlorene Anzeige als eine zweite Benachrichtigung
-- fuer dasselbe Ereignis.
--
-- WAS SIE NICHT ANFASST: `offer_state` (samt `announced_*` und
-- `buyable_since`), `favorites`, `offer_availability_due()`,
-- `offer_availability_grace()`, Shop, Lager, Bestellungen, Sammlung.
-- ===========================================================================

do $$
declare
  v_n integer;
begin
  if to_regclass('public.availability_notifications') is null then
    raise notice 'R0148: public.availability_notifications steht nicht — nichts zu tun';
    return;
  end if;
  select count(*) into v_n from public.availability_notifications;
  raise notice 'R0148: % gespeicherte Meldung(en) werden geloescht. '
    'offer_state.announced_* bleibt, diese Phasen gelten also weiter als '
    'gemeldet.', v_n;
end $$;

drop function if exists public.claim_availability_notifications();

drop table if exists public.availability_notifications;

do $$
begin
  if to_regclass('public.availability_notifications') is not null then
    raise exception 'R0148 ABBRUCH: die Tabelle steht noch';
  end if;
  if to_regprocedure('public.claim_availability_notifications()') is not null then
    raise exception 'R0148 ABBRUCH: die Funktion steht noch';
  end if;
  if to_regclass('public.offer_state') is null
     or to_regclass('public.favorites') is null
     or to_regprocedure('public.offer_availability_due()') is null then
    raise exception 'R0148 ABBRUCH: 0146/0147 sind beschaedigt';
  end if;
  raise notice 'R0148 ok: Tabelle und Funktion fort; offer_state, favorites und '
    'die Erkennung aus 0147 unberuehrt.';
end $$;
