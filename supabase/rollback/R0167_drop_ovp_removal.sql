-- ---------------------------------------------------------------------------
-- R0167 — Ruecknahme von 0167
--
-- NUR SOLANGE NICHTS ENTFERNT IST. Steht ein Grabstein, bricht sie ab: der
-- Grabstein ist das Versprechen, dass eine entfernte SKY-ID nie wieder
-- angelegt wird (ADR-0001). Ihn zu entfernen hiesse, dieses Versprechen
-- zurueckzunehmen — das ist keine Ruecknahme einer Migration, sondern eine
-- eigene Entscheidung.
--
-- Eine ENTFERNTE Figur kommt durch diese Datei nicht zurueck; dafuer gibt es
-- keinen Weg, und das ist gewollt.
--
-- Idempotent.
-- ---------------------------------------------------------------------------
begin;

do $vor$
begin
  if to_regclass('public.catalog_removed_sky_ids') is not null
     and (select count(*) from public.catalog_removed_sky_ids) > 0 then
    raise exception 'R0167 Abbruch: % Grabstein(e) stehen. Nach einer Entfernung wird '
      '0167 nicht zurueckgenommen.', (select count(*) from public.catalog_removed_sky_ids);
  end if;
end
$vor$;

drop trigger if exists skylanders_refuse_removed_trg on public.skylanders;
drop function if exists public.skylanders_refuse_removed();
drop function if exists public.system_remove_ovp_figure(text);
drop table if exists public.catalog_removed_sky_ids;

do $nach$
begin
  if to_regclass('public.catalog_removed_sky_ids') is not null
     or to_regprocedure('public.system_remove_ovp_figure(text)') is not null then
    raise exception 'R0167: es steht noch etwas.';
  end if;
  raise notice 'R0167 ok: Grabstein, Anlage-Riegel und Entfernungsfunktion entfernt; keine Katalogzeile beruehrt.';
end
$nach$;

commit;
