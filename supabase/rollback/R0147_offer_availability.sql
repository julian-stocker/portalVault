-- ===========================================================================
-- RUECKNAHME VON 0147 — die Verfuegbarkeitskante wieder fort
--
-- WAS SIE TUT, in dieser Reihenfolge:
--
--   1. `drop function public.offer_availability_due()`
--   2. `create or replace function public.refresh_offer_state()` auf die
--      Fassung aus `0146` zurueck
--   3. `alter table public.offer_state drop column buyable_since`
--   4. `drop function public.offer_availability_grace()`
--
-- DIE REIHENFOLGE IST NICHT BELIEBIG. Die Entscheidungsfunktion liest die
-- Spalte und die Karenzzeit; `refresh_offer_state()` schreibt die Spalte.
-- Erst wenn niemand sie mehr nennt, kann sie fallen. Eine `plpgsql`-Funktion
-- haelt keine Abhaengigkeit auf die Objekte in ihrem Rumpf — sie bliebe als
-- kaputte Funktion stehen, wenn man die Spalte zuerst nimmt.
--
-- WAS VERLOREN GEHT: `buyable_since`, also die Phasengrenzen. Danach weiss
-- niemand mehr, seit wann eine Figur ununterbrochen kaufbar ist; der naechste
-- Lauf nach einem erneuten `0147` setzt sie auf „jetzt". Fuer die bereits
-- gemeldeten Zeilen ist das folgenlos (sie tragen `announced_at`), fuer eine
-- laufende, noch nicht gemeldete Phase heisst es: die Karenzzeit beginnt von
-- vorn. Es entsteht KEINE falsche Meldung, nur eine spaetere.
--
-- WAS NICHT VERLOREN GEHT: `announced_*`. Diese Ruecknahme fasst sie nicht
-- an — der gemeldete Stand ist der einzige nicht wiederherstellbare Teil des
-- Spiegels, und er gehoert `0146`.
--
-- NICHTS AN SHOP, LAGER ODER SAMMLUNG.
-- ===========================================================================

do $$
begin
  if to_regclass('public.offer_state') is null then
    raise exception 'R0147 ABBRUCH: public.offer_state fehlt — 0146 ist nicht angewendet';
  end if;
end $$;

drop function if exists public.offer_availability_due();

-- Die Fassung aus `0146`, Wort fuer Wort: ohne `buyable_since`.
create or replace function public.refresh_offer_state()
returns table (ran boolean, reason text, rows_checked integer, rows_changed integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_letzte  timestamptz;
  v_erst    boolean;
  v_geprueft integer := 0;
  v_geaendert integer := 0;
begin
  select max(s.checked_at) into v_letzte from public.offer_state s;
  if v_letzte is not null and now() - v_letzte < public.offer_state_window() then
    return query select false, 'throttled'::text, 0, 0;
    return;
  end if;

  if not pg_try_advisory_xact_lock(146, 1) then
    return query select false, 'locked'::text, 0, 0;
    return;
  end if;

  select max(s.checked_at) into v_letzte from public.offer_state s;
  if v_letzte is not null and now() - v_letzte < public.offer_state_window() then
    return query select false, 'throttled'::text, 0, 0;
    return;
  end if;

  v_erst := not exists (select 1 from public.offer_state);

  select count(*) into v_geaendert
    from (
      select l.sky_id, true as buyable, l.cheapest_cents
        from public.offer_state_live l
      union all
      select s.sky_id, false, null::integer
        from public.offer_state s
       where not exists (select 1 from public.offer_state_live l
                          where l.sky_id = s.sky_id)
    ) soll
    left join public.offer_state alt on alt.sky_id = soll.sky_id
   where alt.sky_id is null
      or alt.buyable is distinct from soll.buyable
      or alt.cheapest_cents is distinct from soll.cheapest_cents;

  insert into public.offer_state as s
    (sky_id, buyable, cheapest_cents, changed_at, checked_at,
     announced_buyable, announced_cents, announced_at)
  select
    l.sky_id, true, l.cheapest_cents, now(), now(),
    case when v_erst then true end,
    case when v_erst then l.cheapest_cents end,
    case when v_erst then now() end
  from public.offer_state_live l
  on conflict (sky_id) do update
     set buyable        = true,
         cheapest_cents = excluded.cheapest_cents,
         changed_at     = case
                            when s.buyable is distinct from true
                              or s.cheapest_cents is distinct from excluded.cheapest_cents
                            then now()
                            else s.changed_at
                          end,
         checked_at     = now();

  update public.offer_state s
     set buyable        = false,
         cheapest_cents = null,
         changed_at     = case when s.buyable then now() else s.changed_at end,
         checked_at     = now()
   where not exists (select 1 from public.offer_state_live l
                      where l.sky_id = s.sky_id);

  select count(*) into v_geprueft from public.offer_state;
  return query select true, 'ran'::text, v_geprueft, v_geaendert;
end;
$$;

alter table public.offer_state
  drop constraint if exists offer_state_buyable_since_present;

alter table public.offer_state
  drop column if exists buyable_since;

drop function if exists public.offer_availability_grace();

do $$
declare
  v_n integer;
begin
  select count(*) into v_n from pg_attribute a
   where a.attrelid = 'public.offer_state'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_n <> 8 then
    raise exception 'R0147 ABBRUCH: offer_state hat % Spalten, erwartet 8', v_n;
  end if;
  if to_regprocedure('public.offer_availability_due()') is not null
     or to_regprocedure('public.offer_availability_grace()') is not null then
    raise exception 'R0147 ABBRUCH: eine der neuen Funktionen steht noch';
  end if;
  raise notice 'R0147 ok: buyable_since fort, beide Funktionen fort, '
    'refresh_offer_state() auf der Fassung aus 0146, announced_* unberuehrt.';
end $$;
