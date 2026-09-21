-- ===========================================================================
-- 0078 — THE INTERNAL SALE TRIGGER COULD NEVER HAVE FIRED
-- ===========================================================================
--
-- `orders_register_sale()` (0059) writes one Orderbuch sale when an order
-- becomes paid. Its INSERT filled `created_by` with
--
--     new.id * 0 + null
--
-- `new.id` is `orders.id`, a bigint, so that expression is a **bigint-typed
-- NULL** — and `sales.created_by` is `uuid` with a foreign key to
-- `auth.users`. PostgreSQL refuses the assignment outright:
--
--     42804  column "created_by" is of type uuid but expression is of type bigint
--
-- The value was never wrong; only its type was. `x * 0 + null` is null for
-- every x, so the intent was plainly "nobody" — which is correct, because a
-- trigger reacting to a provider webhook runs as the service role and has no
-- `auth.uid()`. The fix writes that same value in a way the column accepts.
-- It is not a cast placed over a wrong value, and it does not invent an
-- actor: `created_by` stays NULL, exactly as every existing internal sale
-- already has it.
--
-- WHY IT SURFACED ONLY NOW, AFTER SITTING THERE SINCE 0059
--
-- The error is raised at runtime, not at definition time, so the migration
-- applied cleanly. It then needed a real payment to arrive AFTER 0059 was
-- applied, and none had: all fourteen internal sales on staging share one
-- `created_at` — 2026-09-18T20:31:20Z — because `0060` backfilled them for
-- orders that had been paid days earlier. The first genuine
-- `confirm_order_payment()` after 0059 was order #65 on 2026-09-21, and it
-- failed immediately, twice, with an identical 500 on both the ordinary and
-- the late-payment path — the two paths share the `update orders set
-- payment_status = 'paid'` that fires this trigger.
--
-- CONSEQUENCE FOR MONEY AND STOCK: none, in either direction. The raise
-- propagates out of `confirm_order_payment()`, so the whole transaction rolls
-- back — no order marked paid, no reservation converted, no inventory
-- movement, not even the `payment_events` row the function writes first. Both
-- failed deliveries left staging byte-identical. Stripe kept the event.
--
-- NO INVENTORY. One function body, one expression.
-- ===========================================================================


create or replace function public.orders_register_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_status <> 'paid' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.payment_status = 'paid' then
    return new;      -- already paid before this statement; nothing new happened
  end if;

  insert into public.sales (channel, order_id, source, currency,
                            buy_in_factor_snapshot, created_by, updated_by)
  values ('skyisles', new.id, 'commerce', new.currency,
          public.orderbook_global_factor(), null, null)
  on conflict (order_id) where order_id is not null do nothing;

  return new;
end;
$$;


comment on function public.orders_register_sale() is
  'Registers one Orderbuch sale when an order becomes paid (0059, type fix 0078). Idempotent through `sales_order_uniq`; creates no inventory movement, because the order''s reservation already did. `created_by` is NULL: the trigger runs from a provider webhook as the service role, and no person created this row.';
