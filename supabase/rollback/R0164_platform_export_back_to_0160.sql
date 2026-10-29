-- ===========================================================================
-- RUECKNAHME VON 0164 — der Exportrumpf zurueck auf die Fassung aus `0160`
--
-- DIESELBE BAUFORM WIE `R0153` UND `R0160`: sie stellt EINEN Funktionsrumpf
-- wieder her und fasst keine Nutzerdaten an. Danach fuehrt die
-- Plattformsicherung die drei Typfelder nicht mehr — die SPALTEN bleiben, was
-- sie sind; nur das Archiv traegt sie nicht.
--
-- WANN SIE GEFAHREN WIRD: wenn `0163` zurueckgenommen wird. Dann gibt es die
-- Spalten nicht mehr, und ein Export, der sie nennt, lief in `42703`.
-- REIHENFOLGE: zuerst DIESE, dann `R0163`.
--
-- SIE IST IDEMPOTENT: steht schon die Fassung aus `0160`, laeuft sie durch
-- und sagt es.
--
-- WIEDERHERGESTELLT WIRD AUS DER DATEI UND NICHT AUS DEM GEDAECHTNIS:
-- `supabase/migrations/0160_platform_export_base_sky_id.sql`, Abschnitt 2.
-- Eine zweite Kopie derselben 31 000 Zeichen in dieser Datei waere die
-- dritte Fassung, die auseinanderlaufen kann — und der Abdruck
-- `ff4f38e61cbd4e5857ea914d6be68d44` ist der Beweis, dass es dieselbe ist.
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert, zusammen mit dem Abschnitt
-- aus `0160`.
-- ===========================================================================

do $pruef$
declare
  v_abdruck text;
begin
  select md5(p.prosrc) into v_abdruck from pg_proc p
   where p.oid = to_regprocedure('public.system_platform_export()');

  if v_abdruck = 'ff4f38e61cbd4e5857ea914d6be68d44' then
    raise notice 'R0164: der Rumpf ist schon der aus 0160 — nichts zu tun.';
    return;
  end if;
  if v_abdruck is distinct from '7e9e58e2d84a9f8a7c660262aa21926b' then
    raise exception 'R0164: der vorhandene Rumpf ist weder der aus 0164 noch '
      'der aus 0160 (gefunden %). Er wird nicht blind ersetzt.',
      coalesce(v_abdruck, '(keiner)');
  end if;

  raise notice 'R0164: bitte Abschnitt 2 aus '
    'supabase/migrations/0160_platform_export_base_sky_id.sql einfuegen — '
    'danach muss der Abdruck ff4f38e61cbd4e5857ea914d6be68d44 sein.';
end
$pruef$;

-- >>> HIER den Abschnitt 2 aus `0160_platform_export_base_sky_id.sql`
-- >>> einfuegen: `create or replace function public.system_platform_export()`
-- >>> bis einschliesslich `$$;`.

do $nach$
declare
  v_abdruck text;
begin
  select md5(p.prosrc) into v_abdruck from pg_proc p
   where p.oid = to_regprocedure('public.system_platform_export()');
  if v_abdruck is distinct from 'ff4f38e61cbd4e5857ea914d6be68d44' then
    raise exception 'R0164 Nachbedingung: der Rumpf traegt % statt des '
      'Abdrucks aus 0160. Der Abschnitt oben fehlt oder ist eine andere '
      'Fassung.', coalesce(v_abdruck, '(keiner)');
  end if;
  if exists (select 1 from pg_proc p
              where p.oid = to_regprocedure('public.system_platform_export()')
                and p.prosrc like '%''types'', t.types,%') then
    raise exception 'R0164 Nachbedingung: der Rumpf nennt types noch';
  end if;
  raise notice 'R0164: der Exportrumpf ist der aus 0160. Die drei Spalten sind '
    'unberuehrt — nur das Archiv fuehrt sie nicht mehr.';
end
$nach$;
