-- ===========================================================================
-- ROLLBACK OF 0186 — the order number confirmed despite excluded rivals
--
-- WHAT IT DOES: drops `seller_recon_confirm_order_ref(bigint, bigint,
-- timestamptz, jsonb, text)`. 0180's take check and 0185's assignment were
-- never changed by 0186 and stay as they are.
--
-- WHAT IT DOES NOT TOUCH: order numbers already written through it stay —
-- each is a confirmed identity with its journal lines (the number and every
-- `rival_excluded`). No table, no other function, no right of anything else.
-- ===========================================================================

drop function if exists public.seller_recon_confirm_order_ref(bigint, bigint, timestamptz, jsonb, text);

do $post$
begin
  if to_regprocedure('public.seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)') is not null then
    raise exception 'R0186 postcondition: seller_recon_confirm_order_ref still exists';
  end if;
end
$post$;
