-- ---------------------------------------------------------------------------
-- R0166 — Ruecknahme von 0166
--
-- Entfernt `admin_create_variant_figure` und sonst nichts. Keine Zeile wird
-- angefasst: Figuren, die ueber die Funktion entstanden sind, bleiben mit
-- ihrer SKY-ID, ihrer Zuordnung, ihren Types und ihren Journalzeilen stehen —
-- sie sind gewoehnliche Katalogzeilen, und nichts an ihnen haengt an der
-- Funktion. Der Dialog „Neue Figur" meldet danach bei einer Variante
-- verstaendlich, dass die Migration fehlt; eigenstaendige Figuren gehen weiter.
--
-- Idempotent.
-- ---------------------------------------------------------------------------
begin;

drop function if exists public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text);

do $nach$
begin
  if to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)') is not null then
    raise exception 'R0166: die Funktion steht noch.';
  end if;
  raise notice 'R0166 ok: admin_create_variant_figure entfernt; keine Zeile beruehrt.';
end
$nach$;

commit;
