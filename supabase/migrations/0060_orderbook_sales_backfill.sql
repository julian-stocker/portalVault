-- ===========================================================================
-- 0060 — the orders that were already paid when 0059 arrived
--
-- `orders_register_sale_trg` fires when an order BECOMES paid. Fourteen
-- Staging orders were already paid before the trigger existed, and a trigger
-- cannot fire retroactively — so they would have been the only paid orders in
-- history with no sale, and the gap would have looked like a bug in the
-- trigger rather than in its start date.
--
-- SAFE TO RUN TWICE. `on conflict (order_id) do nothing` against
-- `sales_order_uniq` — the same guarantee the trigger relies on.
--
-- IT CREATES NO INVENTORY MOVEMENT. Each of these orders already converted its
-- reservation into one; this only records that a sale exists.
-- ===========================================================================

insert into public.sales (channel, order_id, source, currency, buy_in_factor_snapshot)
select 'skyisles', o.id, 'commerce', o.currency, public.orderbook_global_factor()
  from public.orders o
 where o.payment_status = 'paid'
on conflict (order_id) where order_id is not null do nothing;
