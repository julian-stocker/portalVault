-- ===========================================================================
-- 0074 — TWO FACTS THE VERKAUF SIDE COULD NOT RECORD
-- ===========================================================================
--
-- The item states the owner actually has are eight. Six were already
-- derivable from facts the tables hold — `shipped_at`, `movement_id`,
-- `returned_at`, `return_movement_id`, `settled_at`, `cancelled_at`. Two
-- were not, and both are ordinary:
--
--   NOT SHIPPED   the parcel went out, this piece did not. Out of stock,
--                 damaged in the box, refunded. It must NOT be booked out —
--                 it never left the shelf — and the order must not stay
--                 open because of it.
--
--   RETURN ON ITS WAY   the buyer has announced a return of something that
--                 was booked out. It is not back yet, so nothing is
--                 restocked, but the position is no longer simply "sold".
--
-- WHY `not_shipped_at` IS NOT A HOLE IN THE SETTLE LOCK
--
-- 0073 refuses `settled_at` for any catalog figure that is not marked
-- not-from-stock, because closing something that DID leave the shelf
-- without recording the movement makes stock silently wrong.
--
-- `not_shipped_at` is the opposite case and carries the opposite risk,
-- which is none: the piece never left. Not booking it out is the CORRECT
-- bookkeeping, and the shelf is right either way. So it is allowed for any
-- position — and only while `movement_id` is still NULL, which is the one
-- thing that would make the claim false.
--
-- The two endings stay separate columns rather than one with a reason,
-- precisely so the strict lock on `settled_at` is not loosened to carry a
-- case that does not need it.
--
-- `returned_at` KEEPS ITS MEANING. 0059 calls it "marks the physical fact"
-- — the goods are back. The new column is what comes BEFORE it, and nothing
-- about the existing function changes.
--
-- NO INVENTORY. Two nullable columns, two constraints, two functions that
-- write one timestamp each. Not one movement, not one quantity.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

alter table public.sale_items
  add column if not exists not_shipped_at       timestamptz,
  add column if not exists return_announced_at  timestamptz;

comment on column public.sale_items.not_shipped_at is
  'When this position was marked as deliberately not sent (0074) — out of stock, damaged, refunded. It never left the shelf, so it is never booked out, and the order does not stay open because of it. Allowed only while `movement_id` is NULL.';
comment on column public.sale_items.return_announced_at is
  'When a return was announced for a position that HAD been booked out (0074). The goods are not back yet — `returned_at` is that, unchanged — so nothing is restocked and no movement exists. Allowed only when `movement_id` is not NULL.';

/*
 * NOT SHIPPED AND BOOKED OUT ARE CONTRADICTORY.
 *
 * One says the piece never left, the other that it did. The function checks
 * it too; this is the floor under that check.
 */
alter table public.sale_items
  drop constraint if exists sale_items_not_shipped_has_no_movement;
alter table public.sale_items
  add constraint sale_items_not_shipped_has_no_movement
  check (not_shipped_at is null or movement_id is null);

/*
 * A RETURN NEEDS SOMETHING TO RETURN.
 *
 * Announcing one for a position that never left the shelf would be a claim
 * about an object that is still on it.
 */
alter table public.sale_items
  drop constraint if exists sale_items_return_needs_a_movement;
alter table public.sale_items
  add constraint sale_items_return_needs_a_movement
  check (return_announced_at is null or movement_id is not null);

/*
 * AND THE TWO ENDINGS ARE EXCLUSIVE.
 *
 * `settled_at` is "closed, and there was no stock to move"; `not_shipped_at`
 * is "closed, and the stock stayed where it was". Both at once would be two
 * different explanations of the same position.
 */
alter table public.sale_items
  drop constraint if exists sale_items_one_ending_without_movement;
alter table public.sale_items
  add constraint sale_items_one_ending_without_movement
  check (settled_at is null or not_shipped_at is null);


-- ---------------------------------------------------------------------------
-- 2. Nicht verschickt
-- ---------------------------------------------------------------------------

create or replace function public.seller_set_sale_item_not_shipped(
  p_item_id bigint,
  p_not_shipped boolean default true
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_item record; v_sale record;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;

  /* Taking it back is free: no movement was made and none was prevented. */
  if not p_not_shipped then
    update public.sale_items set not_shipped_at = null, updated_at = now() where id = p_item_id;
    return;
  end if;

  if v_item.not_shipped_at is not null then return; end if;   -- idempotent

  /*
   * THE ONE THING THAT WOULD MAKE THE CLAIM FALSE. A position with a
   * movement left the shelf; saying it was never sent would leave the
   * ledger describing an object nobody can account for.
   */
  if v_item.movement_id is not null then
    raise exception 'this position left the shelf; reverse the booking first'
      using errcode = 'restrict_violation';
  end if;
  if v_item.settled_at is not null then
    raise exception 'this position is already closed' using errcode = 'restrict_violation';
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;
  if v_sale.order_id is not null then
    raise exception 'an order''s lines are owned by commerce' using errcode = 'restrict_violation';
  end if;
  if v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null then
    raise exception 'this historical sale has not been released' using errcode = 'restrict_violation';
  end if;

  update public.sale_items set not_shipped_at = now(), updated_at = now() where id = p_item_id;
end;
$$;

comment on function public.seller_set_sale_item_not_shipped(bigint, boolean) is
  'Mark one sold position as deliberately not sent (0074), or undo it with p_not_shipped = false. The piece never left the shelf, so nothing is booked out and no movement is created; the order stops waiting for it. Refused once a movement exists, for a position already closed another way, for an order line, and for a historical sale 0071 has not released.';

revoke all on function public.seller_set_sale_item_not_shipped(bigint, boolean) from public, anon;
grant execute on function public.seller_set_sale_item_not_shipped(bigint, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Retoure unterwegs
-- ---------------------------------------------------------------------------

create or replace function public.seller_announce_sale_item_return(
  p_item_id bigint,
  p_announced boolean default true
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_item record;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;

  if not p_announced then
    if v_item.returned_at is not null then
      raise exception 'this return has already arrived' using errcode = 'restrict_violation';
    end if;
    update public.sale_items set return_announced_at = null, updated_at = now() where id = p_item_id;
    return;
  end if;

  if v_item.return_announced_at is not null then return; end if;   -- idempotent

  /*
   * SOMETHING HAS TO HAVE LEFT. A return of a position still on the shelf
   * is not a return, and `returned_at` / `Einlagern` would then be offered
   * for an object that never went anywhere.
   */
  if v_item.movement_id is null then
    raise exception 'nothing was booked out of stock for this position'
      using errcode = 'restrict_violation';
  end if;
  if v_item.return_movement_id is not null then
    raise exception 'this return was already restocked' using errcode = 'restrict_violation';
  end if;

  update public.sale_items set return_announced_at = now(), updated_at = now() where id = p_item_id;
end;
$$;

comment on function public.seller_announce_sale_item_return(bigint, boolean) is
  'Record that a return is on its way for a position that WAS booked out (0074), or withdraw the announcement with p_announced = false. Physical arrival stays `returned_at` and restocking stays `return_movement_id`; this is only the step before them. Refused where no movement exists, and refused to withdraw once the goods have arrived. Writes one timestamp and never a movement.';

revoke all on function public.seller_announce_sale_item_return(bigint, boolean) from public, anon;
grant execute on function public.seller_announce_sale_item_return(bigint, boolean) to authenticated;
