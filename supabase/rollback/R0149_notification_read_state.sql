-- ===========================================================================
-- R0149 — `read_at` UND IHREN SCHREIBWEG ZURUECKNEHMEN
--
-- Nimmt `0149` zurueck: der Schreibweg verschwindet, der Teilindex
-- verschwindet, die Spalte verschwindet. Danach steht wieder der Stand von
-- `0148`: Meldungen existieren, aber es gibt kein „gelesen".
--
-- UMGEKEHRTE REIHENFOLGE. Erst die Funktion, dann der Index, dann die
-- Spalte: eine Funktion, die eine Spalte nennt, die es nicht mehr gibt,
-- waere zwischen zwei Anweisungen kaputt. `language sql` prueft den Rumpf
-- beim Anlegen, nicht bei jedem Aufruf — ein `drop column` wuerde sie
-- stehenlassen und erst beim naechsten Aufruf scheitern.
--
-- WAS VERLOREN GEHT, UND DAS IST DER PREIS: welche Meldungen jemand gelesen
-- hat. Die Meldungen selbst bleiben; sie sind danach alle wieder „neu",
-- weil „neu" ohne die Spalte der einzige Zustand ist. Beim erneuten
-- Anwenden von `0149` kommt die Spalte leer zurueck, und die Oberflaeche
-- zeigt dieselben Meldungen ein zweites Mal als neu.
--
-- WAS NICHT ZURUECKGENOMMEN WIRD: `availability_notifications` selbst
-- (`R0148`), `offer_state.announced_*` und `buyable_since` (`R0147`,
-- `R0146`). Dieses Rollback ist das kleinste von vier und laesst die drei
-- darunter unberuehrt.
-- ===========================================================================

-- 1. Der Schreibweg. Zuerst, siehe Kopf.
drop function if exists public.mark_availability_notifications_read(text[]);

-- 2. Der Teilindex. Faellt mit der Spalte ohnehin; ausdruecklich, damit das
--    Rollback vollstaendig lesbar ist und nicht von einer Nebenwirkung lebt.
drop index if exists public.availability_notifications_unread_idx;

-- 3. Die Spalte.
alter table public.availability_notifications
  drop column if exists read_at;

-- 4. Der Kommentar auf der Tabelle sagt wieder, was gilt.
comment on table public.availability_notifications is
  'Persoenliche Verfuegbarkeitsmeldungen (0148, Phase 4 S3): je Nutzer, Figur und Verfuegbarkeitsphase genau eine. Der Primaerschluessel (user_id, sky_id, buyable_since) IST der Duplikatschutz — nicht die Anwendungslogik. Geschrieben wird ausschliesslich von claim_availability_notifications(); Clients haben nur SELECT auf ihre eigenen Zeilen. Keine read_at-Spalte: 0149 wurde zurueckgenommen.';

-- ---------------------------------------------------------------------------
-- NACHWEIS
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer text := 'R0149 ABBRUCH';
  v_n   integer;
  v_t   text;
begin
  select count(*) into v_n
    from pg_attribute a
   where a.attrelid = to_regclass('public.availability_notifications')
     and a.attname = 'read_at'
     and a.attnum > 0 and not a.attisdropped;
  if v_n <> 0 then
    raise exception '%: read_at steht noch', v_wer;
  end if;

  select count(*) into v_n
    from pg_attribute a
   where a.attrelid = to_regclass('public.availability_notifications')
     and a.attnum > 0 and not a.attisdropped;
  if v_n <> 5 then
    raise exception '%: % Spalten statt der 5 aus 0148', v_wer, v_n;
  end if;

  if to_regprocedure(
       'public.mark_availability_notifications_read(text[])') is not null then
    raise exception '%: mark_availability_notifications_read(text[]) steht noch',
      v_wer;
  end if;

  if to_regclass('public.availability_notifications_unread_idx') is not null then
    raise exception '%: der Teilindex steht noch', v_wer;
  end if;

  /* Die Tabelle selbst, ihre Richtlinie und der Schreibweg aus 0148 sind
     unberuehrt — dieses Rollback nimmt 0149 zurueck und nicht 0148. */
  select count(*) into v_n from public.availability_notifications;
  raise notice 'R0149: % Meldung(en) bleiben liegen und gelten wieder alle '
    'als neu', v_n;

  select coalesce(string_agg(pol.polname::text, ', ' order by pol.polname), '(keine)')
    into v_t
    from pg_policy pol
   where pol.polrelid = to_regclass('public.availability_notifications');
  if v_t <> 'availability_notifications_select_own' then
    raise exception '%: die Richtlinien lauten "%" statt der einen aus 0148',
      v_wer, v_t;
  end if;

  if to_regprocedure('public.claim_availability_notifications()') is null then
    raise exception '%: claim_availability_notifications() fehlt — dieses '
      'Rollback nimmt 0148 nicht zurueck', v_wer;
  end if;

  raise notice 'R0149 ok: read_at, Teilindex und '
    'mark_availability_notifications_read() sind weg. 0148 steht '
    'unveraendert: Tabelle mit 5 Spalten, EINE select-Richtlinie, '
    'claim_availability_notifications().';
end $$;
