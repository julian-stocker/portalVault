-- ===========================================================================
-- R0190 — Rücknahme von 0190: seller_legal_public() entfernen
--
-- Nur nach eigener Freigabe, und nur solange AP5 nicht ausgeliefert ist: die
-- umgestellten Rechtsseiten lesen diese Funktion und zeigen ohne sie ihren
-- Fehlerzustand.
--
-- 0190 hat nichts anderes angelegt und nichts verändert — keine Tabelle,
-- keine Zeile, keine bestehenden Rechte. Die Rücknahme ist deshalb genau
-- eine Anweisung, und eine zweite Ausführung ist folgenlos.
-- ===========================================================================

begin;

drop function if exists public.seller_legal_public();

do $r0190$
begin
  if to_regprocedure('public.seller_legal_public()') is not null then
    raise exception 'R0190 postcondition: seller_legal_public() still exists';
  end if;
end
$r0190$;

commit;
