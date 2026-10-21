-- ===========================================================================
-- R0141 — die Lesefunktion wieder fort
--
-- Sie liest nur; es geht nichts verloren. In `begin` / `commit` klammern.
-- ===========================================================================
drop function if exists public.seller_sale_state();

do $$
begin
  if to_regprocedure('public.seller_sale_state()') is not null then
    raise exception 'R0141 Abbruch: seller_sale_state steht noch';
  end if;
  raise notice 'R0141 ok: seller_sale_state ist fort';
end $$;
