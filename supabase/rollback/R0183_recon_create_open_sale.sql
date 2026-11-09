-- ===========================================================================
-- ROLLBACK OF 0183 — the creation of an open sale from the CSV reconciliation
--
-- WHAT IT DOES: drops `seller_recon_create_sale(bigint, jsonb)`. Nothing else.
--
-- WHAT IT DOES NOT TOUCH: sales created through it stay — each is a business
-- event with its own journal lines, and its positions may already be held,
-- booked or shipped. No table, no other function, no right of anything else.
-- ===========================================================================

drop function if exists public.seller_recon_create_sale(bigint, jsonb);

do $post$
begin
  if to_regprocedure('public.seller_recon_create_sale(bigint,jsonb)') is not null then
    raise exception 'R0183 postcondition: seller_recon_create_sale still exists';
  end if;
end
$post$;
