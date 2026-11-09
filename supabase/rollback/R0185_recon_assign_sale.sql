-- ===========================================================================
-- ROLLBACK OF 0185 — the assignment of an unmatched report order to a sale
--
-- WHAT IT DOES: drops `seller_recon_assign_sale(bigint, bigint, timestamptz)`.
--
-- WHAT IT DOES NOT TOUCH: order numbers already written through it stay —
-- each is a confirmed identity with its own `orderbook_audit` line, and
-- removing one is an ordinary edit of that sale, not a rollback. No table,
-- no other function, no right of anything else.
-- ===========================================================================

drop function if exists public.seller_recon_assign_sale(bigint, bigint, timestamptz);

do $post$
begin
  if to_regprocedure('public.seller_recon_assign_sale(bigint,bigint,timestamptz)') is not null then
    raise exception 'R0185 postcondition: seller_recon_assign_sale still exists';
  end if;
end
$post$;
