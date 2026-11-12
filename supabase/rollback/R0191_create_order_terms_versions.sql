-- ===========================================================================
-- R0191 — Rücknahme von 0191: die gekoppelte create_order() und
--         legal_versions_public() entfernen
--
-- Nur nach eigener Freigabe, und nur solange 0192 NICHT angewendet ist (oder
-- nachdem `R0192` die Sechser wiederhergestellt hat): ohne die Sechser wäre
-- create_order() danach ganz fort, und niemand könnte mehr bestellen. Die
-- Datei bricht in diesem Fall ab, statt es zu tun.
--
-- ERST DER CODE, DANN DIESE DATEI. Der Code aus AP5 ruft die Achter-Signatur
-- und liest die aktuelle Fassung über `legal_versions_public()`; ohne beide
-- zeigen Rechtsseiten und Checkout „nicht verfügbar“, und niemand kann über
-- ihn bestellen. Diese Datei läuft also erst, wenn das vorherige Deployment
-- wieder ausgeliefert ist (Runbook in ADR-0184).
--
-- 0191 hat nichts anderes angelegt und nichts verändert. Eine zweite
-- Ausführung ist folgenlos.
-- ===========================================================================

begin;

do $pre_r0191$
begin
  if to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)') is null then
    raise exception 'R0191 refused: the six-parameter create_order is gone (0192 applied) — run R0192 first';
  end if;
end
$pre_r0191$;

drop function if exists public.create_order(text, text, jsonb, jsonb, text, text, text, text);
drop function if exists public.legal_versions_public();

do $r0191$
begin
  if to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)') is not null
     or to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)') is null
     or to_regprocedure('public.legal_versions_public()') is not null then
    raise exception 'R0191 postcondition: expected only the six-parameter create_order and no legal_versions_public()';
  end if;
end
$r0191$;

notify pgrst, 'reload schema';

commit;
