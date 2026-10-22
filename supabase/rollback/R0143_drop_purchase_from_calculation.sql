-- ===========================================================================
-- RUECKNAHME VON 0143 — die Uebernahme ins Orderbuch wieder fort
--
-- WAS SIE TUT: `drop function seller_create_purchase_from_calculation`.
--
-- WAS SIE NICHT ANFASST:
--
--   * `seller_create_purchase_with_items` — sie gehoert `0064`/`0120` und
--     ist der einzige Weg, einen Einkauf anzulegen. Nach dieser Ruecknahme
--     ist sie es wieder ausschliesslich.
--   * Bestehende EINKAEUFE. Keiner verschwindet, keiner aendert sich.
--   * Bestehende VERKNUEPFUNGEN. `purchase_calculations.purchase_id` bleibt
--     stehen, wo sie gesetzt ist: die Zuordnung ist ein Nachweis, welcher
--     Einkauf aus welcher Bewertung entstand, und den wirft man nicht fort,
--     weil ein Weg dorthin entfaellt. Die Oberflaeche zeigt danach weiter
--     „Einkauf ansehen"; nur neu uebernehmen kann sie nicht mehr.
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert.
-- ===========================================================================

do $$
declare
  v_sig text := 'uuid, date, numeric, text, boolean, jsonb, text, text, numeric, '
                || 'numeric, numeric, text, text, text';
  v_n   integer;
begin
  if to_regprocedure('public.seller_create_purchase_from_calculation(' || v_sig || ')')
     is null then
    raise exception 'R0143 Abbruch: die Funktion gibt es nicht — 0143 ist hier '
      'nicht angewendet';
  end if;

  select count(*) into v_n from public.purchase_calculations
   where purchase_id is not null;
  raise notice 'R0143: % verknuepfte Kalkulation(en) — sie bleiben verknuepft', v_n;
end $$;


drop function public.seller_create_purchase_from_calculation(uuid, date, numeric,
  text, boolean, jsonb, text, text, numeric, numeric, numeric, text, text, text);


do $$
begin
  if to_regprocedure('public.seller_create_purchase_from_calculation(uuid, date, '
                     'numeric, text, boolean, jsonb, text, text, numeric, numeric, '
                     'numeric, text, text, text)') is not null then
    raise exception 'R0143 Befund: die Funktion steht noch';
  end if;
  if to_regprocedure('public.seller_create_purchase_with_items(date, numeric, text, '
                     'boolean, jsonb, text, text, numeric, numeric, numeric, text, '
                     'text, text)') is null then
    raise exception 'R0143 Befund: seller_create_purchase_with_items wurde '
      'mitgenommen — sie gehoert 0064/0120';
  end if;
  if to_regclass('public.purchase_calculations') is null then
    raise exception 'R0143 Befund: purchase_calculations wurde mitgenommen';
  end if;
  raise notice 'R0143 ok: die Uebernahmefunktion ist fort, '
    'seller_create_purchase_with_items und purchase_calculations stehen unberuehrt.';
end $$;
