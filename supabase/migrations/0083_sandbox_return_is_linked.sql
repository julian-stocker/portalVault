-- ===========================================================================
-- 0083 — a sandbox return had no way back to its order
--
-- WHAT WAS MISSING
--
-- When a sandbox test order is paid, `convert_reservations` books the sale
-- and writes the movement's id into `order_reservations.movement_id`. That
-- link is what lets any reader ask "did this movement belong to a test?"
-- without reading a note.
--
-- `admin_revert_sandbox_stock` has no such link. It calls
-- `apply_inventory_movement` directly, discards the id it gets back and
-- leaves the connection to the order in a free-text note:
--
--     'sandbox test order ' || v_order.order_number
--
-- So the sale of a test order is structurally identifiable and its return —
-- the very movement that undoes it — is not. A stock screen that hides test
-- activity would hide the withdrawal and show the deposit, which is worse
-- than showing both.
--
-- THE SMALLEST CHANGE THAT FIXES IT
--
-- One column beside the one that already exists. `movement_id` holds the
-- movement that took the stock out; `reverted_movement_id` holds the one
-- that put it back. Same table, same shape, same lifetime — and the loop
-- that books the return already iterates exactly those reservation rows, so
-- there is nothing to match up and nothing to guess.
--
-- WHY NOT A FLAG ON `inventory_movements`
--
-- Because it would be a second truth. Whether a movement belongs to a test
-- is already decided by the order (`commerce_mode`) or the sale
-- (`is_test`); a flag beside that can disagree with it, and then somebody
-- has to decide which one is right. A reference cannot disagree.
-- ===========================================================================

alter table public.order_reservations
  add column if not exists reverted_movement_id bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'order_reservations_reverted_movement_fk'
  ) then
    alter table public.order_reservations
      add constraint order_reservations_reverted_movement_fk
        foreign key (reverted_movement_id)
        references public.inventory_movements (id)
        on update cascade
        on delete restrict;
  end if;
end;
$$;

comment on column public.order_reservations.reverted_movement_id is
  'The return movement that put this reservation''s stock back after a sandbox test order (0083). Mirrors movement_id, which holds the sale that took it out. NULL for everything that was never reverted. Structural: it is what lets a reader identify a test return without reading a note.';

-- One return per reservation, and one reservation per return. A second row
-- claiming the same movement would make the link ambiguous, which is the
-- one thing it exists to avoid.
create unique index if not exists order_reservations_one_return_each
  on public.order_reservations (reverted_movement_id)
  where reverted_movement_id is not null;

-- ---------------------------------------------------------------------------
-- The same function, keeping the id it already had in its hand.
--
-- Everything else is unchanged: the sandbox guard, the idempotency check,
-- the event it writes and the count it returns. The loop now selects the
-- reservation's id as well, so the UPDATE knows which row to write.
-- ---------------------------------------------------------------------------
create or replace function public.admin_revert_sandbox_stock(p_order_number text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order       record;
  v_row         record;
  v_movement_id bigint;
  v_reverted    integer := 0;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select o.* into v_order
    from public.orders o
   where o.order_number = p_order_number
   for update;

  if not found then
    raise exception 'no such order' using errcode = 'no_data_found';
  end if;

  -- The whole safety of this function. A live order's stock is a real
  -- customer's goods, and no button in the admin area may put it back.
  if v_order.commerce_mode <> 'sandbox' then
    raise exception 'order % was not placed in sandbox', v_order.order_number
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from public.order_events e
     where e.order_id = v_order.id
       and e.event_type = 'sandbox_stock_reverted'
  ) then
    return 0;
  end if;

  -- Only what was actually converted. A late payment converts fewer positions
  -- than the order has lines, and putting back stock that never left would
  -- invent goods.
  for v_row in
    select r.id, r.quantity, i.sky_id, i.condition
      from public.order_reservations r
      join public.shop_inventory i on i.id = r.inventory_id
     where r.order_id = v_order.id
       and r.state = 'converted'
     order by r.id
  loop
    v_movement_id := public.apply_inventory_movement(
      v_row.sky_id,
      v_row.condition,
      v_row.quantity,
      'return',
      null, null,
      'sandbox test order ' || v_order.order_number,
      (select auth.uid())
    );

    -- The new half. Same transaction as the movement, so the two cannot
    -- come apart (0083).
    update public.order_reservations
       set reverted_movement_id = v_movement_id
     where id = v_row.id;

    v_reverted := v_reverted + 1;
  end loop;

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order.id, 'sandbox_stock_reverted', 'admin', (select auth.uid()),
          jsonb_build_object('positions', v_reverted));

  return v_reverted;
end;
$$;

comment on function public.admin_revert_sandbox_stock(text) is
  'Books return movements for every position a sandbox order actually sold, so a test purchase does not distort real stock, and records each return in order_reservations.reverted_movement_id (0083). Refuses any order not placed in sandbox. Idempotent: a second call books nothing.';

revoke all on function public.admin_revert_sandbox_stock(text) from public, anon;
grant execute on function public.admin_revert_sandbox_stock(text) to authenticated;
