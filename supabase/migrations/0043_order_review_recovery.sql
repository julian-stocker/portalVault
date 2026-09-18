-- ===========================================================================
-- 0043 — a flagged order needs a way out
--
-- WHAT WAS MISSING
--
-- `needs_resolution` has existed since `0010` with the comment "never cleared
-- automatically". That was right — and nothing cleared it MANUALLY either, in
-- any migration or any screen. A seller could be handed a paid order and have
-- no workflow at all: the order says "Prüfung erforderlich — Versand
-- gesperrt", the database refuses to ship it, and there the matter ended.
--
-- THE TWO WAYS IN, WHICH ARE NOT THE SAME PROBLEM
--
--   late_payment_unresolved   The money arrived after the reservation had
--                             expired and been released. The order is PAID and
--                             no stock was ever booked. Real, and repairable:
--                             if the goods are on the shelf today, booking the
--                             sale now leaves exactly the state a converted
--                             reservation would have left.
--
--   payment_amount_mismatch   The money does not match the attempt. Nothing
--                             about stock repairs that, and the order is not
--                             marked paid. **No recovery here.** A financial
--                             discrepancy is answered with a refund or a
--                             correction, by a human, outside this function.
--
-- SO THIS IS NOT AN UNLOCK BUTTON. It repairs one specific, checkable
-- inconsistency and refuses everything else. If the stock is not there, the
-- booking raises, the transaction rolls back and the order stays blocked —
-- which is the correct answer, because shipping goods you do not have is the
-- thing `needs_resolution` exists to prevent.
--
-- WHOSE JOB IT IS
--
-- The seller's. This is order operations, not platform administration
-- (ADR-0077): `can_operate_active_seller()`, never `is_shop_admin()`.
--
-- DEPENDS ON `0041` (the seller predicate) and the inventory journal from
-- `0003`/`0025`. NOT on `0042`, and not on `0035`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. What is actually wrong with this order?
--
-- A read, so the screen can say why rather than only that. It answers three
-- things: which cause flagged the order, whether that cause is repairable at
-- all, and — for the repairable one — whether the goods are there right now.
-- ---------------------------------------------------------------------------
create or replace function public.seller_order_review(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order   record;
  v_cause   text;
  v_lines   jsonb;
  v_short   integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select o.* into v_order
    from public.orders o
   where o.order_number = p_order_number;

  if not found then
    raise exception 'unknown order %', p_order_number using errcode = 'no_data_found';
  end if;

  if not v_order.needs_resolution then
    return jsonb_build_object('flagged', false);
  end if;

  /*
   * The cause comes from the journal, which is append-only and therefore the
   * only account of what happened that cannot have been edited afterwards.
   * A money mismatch outranks a late payment: if both are recorded, the
   * financial question is the one that has to be answered first.
   */
  select case
           when exists (select 1 from public.order_events e
                         where e.order_id = v_order.id
                           and e.event_type = 'payment_amount_mismatch')
             then 'payment_amount_mismatch'
           when exists (select 1 from public.order_events e
                         where e.order_id = v_order.id
                           and e.event_type = 'late_payment_unresolved')
             then 'late_payment_unresolved'
           else 'unknown'
         end
    into v_cause;

  -- Per line: what the order owes, and what is free on the shelf today.
  -- `quantity - reserved` because somebody else's live reservation is not
  -- stock this order may take.
  select coalesce(jsonb_agg(jsonb_build_object(
           'sky_id',    l.sky_id,
           'condition', l.condition,
           'name',      l.name_snapshot,
           'required',  l.quantity,
           'available', greatest(coalesce(i.quantity, 0) - coalesce(i.reserved, 0), 0)
         ) order by l.id), '[]'::jsonb),
         coalesce(sum(case
           when coalesce(i.quantity, 0) - coalesce(i.reserved, 0) < l.quantity then 1 else 0
         end), 0)
    into v_lines, v_short
    from public.order_lines l
    left join public.shop_inventory i
      on i.sky_id = l.sky_id and i.condition = l.condition
   where l.order_id = v_order.id;

  return jsonb_build_object(
    'flagged',   true,
    'cause',     v_cause,
    -- Only one cause has a repair, and only when the goods are there.
    'resolvable', v_cause = 'late_payment_unresolved'
                  and v_order.payment_status = 'paid'
                  and v_short = 0,
    'short_positions', v_short,
    'lines', v_lines
  );
end;
$$;

comment on function public.seller_order_review(text) is
  'Why an order is flagged and whether it can be repaired (ADR-0079). Seller operators only. Reads the append-only journal for the cause and current stock for the answer; changes nothing.';

revoke all on function public.seller_order_review(text) from public, anon;
grant execute on function public.seller_order_review(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Booking the stock a late payment never took
--
-- The repair, and only the repair. It books one `sale` movement per line
-- through the existing journal — the same call the reservation conversion
-- would have made — and only then clears the flag.
--
-- `apply_inventory_movement()` refuses to take a position below its reserved
-- quantity, so a shortfall raises and the whole transaction rolls back: no
-- partial booking, no cleared flag, order still blocked. That refusal is the
-- safety property, not an error path to work around.
-- ---------------------------------------------------------------------------
create or replace function public.seller_resolve_stock_shortfall(p_order_number text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_line   record;
  v_booked integer := 0;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select o.* into v_order
    from public.orders o
   where o.order_number = p_order_number
     for update;

  if not found then
    raise exception 'unknown order %', p_order_number using errcode = 'no_data_found';
  end if;

  if not v_order.needs_resolution then
    raise exception 'order % is not flagged', v_order.order_number
      using errcode = 'check_violation';
  end if;

  -- A money mismatch is not repaired by moving goods. Refused by name, so the
  -- seller learns which problem they actually have.
  if exists (select 1 from public.order_events e
              where e.order_id = v_order.id
                and e.event_type = 'payment_amount_mismatch') then
    raise exception
      'order % has a payment discrepancy; that is settled with the payment, not with stock',
      v_order.order_number using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.order_events e
                  where e.order_id = v_order.id
                    and e.event_type = 'late_payment_unresolved') then
    raise exception 'order % was not flagged for an unbooked late payment', v_order.order_number
      using errcode = 'check_violation';
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'order % is %, and only a paid order may be booked',
      v_order.order_number, v_order.payment_status using errcode = 'check_violation';
  end if;

  -- Booked once. The event below is the record that makes a second call
  -- impossible even if the flag were somehow set again.
  if exists (select 1 from public.order_events e
              where e.order_id = v_order.id
                and e.event_type = 'stock_booked_after_late_payment') then
    raise exception 'order % has already been booked', v_order.order_number
      using errcode = 'check_violation';
  end if;

  /*
   * An ACTIVE reservation means the ordinary path is still open and this
   * function would double-book. Only a released one gets here — which is what
   * `late_payment_unresolved` means.
   */
  if exists (select 1 from public.order_reservations r
              where r.order_id = v_order.id and r.state = 'active') then
    raise exception 'order % still holds stock; convert its reservation instead',
      v_order.order_number using errcode = 'check_violation';
  end if;

  for v_line in
    select l.sky_id, l.condition, l.quantity
      from public.order_lines l
     where l.order_id = v_order.id
     order by l.id
  loop
    -- Raises if the shelf cannot cover it. Nothing is caught: a shortfall must
    -- roll the whole thing back.
    perform public.apply_inventory_movement(
      v_line.sky_id, v_line.condition, -v_line.quantity, 'sale',
      null, null,
      'late payment booked for order ' || v_order.order_number,
      (select auth.uid())
    );
    v_booked := v_booked + 1;
  end loop;

  update public.orders
     set needs_resolution = false
   where id = v_order.id;

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order.id, 'stock_booked_after_late_payment', 'admin', (select auth.uid()),
          jsonb_build_object('positions', v_booked));

  return 'resolved';
end;
$$;

comment on function public.seller_resolve_stock_shortfall(text) is
  'Books the stock a late payment never took and clears the review flag (ADR-0079). Seller operators only. Repairs one specific inconsistency: it refuses a payment discrepancy, refuses an order that still holds a reservation, refuses a second run, and rolls back entirely if the shelf cannot cover the order — leaving it blocked, which is the point.';

revoke all on function public.seller_resolve_stock_shortfall(text) from public, anon;
grant execute on function public.seller_resolve_stock_shortfall(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. What this migration deliberately does NOT do
--
-- No `needs_resolution = false` that anybody can call on any order. The flag
-- clears only as the last step of a repair that actually happened.
--
-- No recovery for `payment_amount_mismatch`. That is a money question and
-- needs a refund or a correction, not a migration.
--
-- No change to `admin_mark_order_shipped()`, `admin_unmark_order_shipped()`,
-- `admin_set_tracking_number()` or `orders_protect_fulfillment()`: 0039's
-- reversible fulfilment is untouched, and a tracking number entered before the
-- repair survives it.
--
-- No weakening of any invariant for the sake of an old test order. The flagged
-- Staging order happens to be repairable because its goods are in stock; one
-- that is not stays blocked.
--
-- No account-type change (0042 stands), no `seller_id`, no marketplace.
-- ---------------------------------------------------------------------------
