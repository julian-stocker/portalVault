-- ===========================================================================
-- 0073 — WHAT MAY LEAVE THE SHELF, AND WHAT MAY ONLY BE FILED AWAY
-- ===========================================================================
--
-- 0071 released 22 workbook sales and cancelled one of them. 0072 taught the
-- ledger to count three endings. This is the pair of functions that decide
-- which ending a position is allowed to reach.
--
--   a catalog figure that came off the shelf   Ausbuchen -> a movement
--   anything else                              Erledigt  -> no movement
--
-- THE LOCK, AND WHY `sky_id IS NULL` IS NOT ENOUGH
--
-- On the Einkauf side `settled` needed one condition: no catalog figure. The
-- Verkauf side has a case that condition does not cover.
--
-- The workbook's column L (header `T`) marks whether a sold copy was taken
-- out of tracked stock. 48 rows carry `-` there. 23 of them are the
-- cancelled order. The other 25 are SHIPPED lines — `M = x` — where the
-- owner deliberately did not take the piece from the shelf. Sixteen are
-- Battlecast card packs with no catalog row at all; nine are real figures,
-- and every one of those figures has OTHER sales marked `x`. The marker
-- therefore belongs to the shipment, not to the figure.
--
-- Such a line can carry a sky_id and still sit inside a released order.
-- Booking it would take a piece off a shelf the workbook says it never stood
-- on: the copy that was shipped and any copy still in stock are different
-- objects. The marker decides, not the presence of a sky_id.
--
-- So the rule is:
--
--     settled is allowed when   sky_id is null              (no shelf exists)
--                        or     legacy_stock_flag = '-'     (the owner said
--                                                            it did not come
--                                                            from the shelf)
--
-- `legacy_stock_flag` is provenance written once by the import and by
-- nothing else — there is no RPC that sets it, so this cannot be turned into
-- a general door. A hand-made sale carries NULL there and its figures can
-- only ever end by being booked. And the same marker now BARS booking, so a
-- not-from-stock line has exactly one ending and it is the right one.
--
-- Read from the row under the same `for update` lock as everything else. An
-- RPC client chooses the item; it never gets to say what kind of item it is.
--
-- NO INVENTORY IS CREATED HERE. `seller_settle_sale_item` writes one
-- timestamp. `seller_book_sale_item` keeps the movement it always made, via
-- `record_inventory_movement` — there is no second stock path and this adds
-- none.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Ausbuchen — three more refusals, one relaxation
-- ---------------------------------------------------------------------------

create or replace function public.seller_book_sale_item(p_item_id bigint)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_item record; v_sale record; v_mid bigint; v_price numeric;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;
  if v_item.movement_id is not null then return v_item.movement_id; end if;  -- already booked

  select * into v_sale from public.sales where id = v_item.sale_id;

  /*
   * THE RELAXATION. A workbook sale is still refused — unless 0071 released
   * it, by name, after the owner confirmed the parcel shipped and the pieces
   * never left the shelf. `stock_released_at` is NULL on all 271 others, so
   * the refusal they get is the one they had.
   */
  if v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null then
    raise exception 'historical sales never move stock' using errcode = 'restrict_violation';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'this order was cancelled; nothing left the shelf'
      using errcode = 'restrict_violation';
  end if;
  if v_sale.order_id is not null then
    raise exception 'the order already moved this stock' using errcode = 'restrict_violation';
  end if;
  if v_item.settled_at is not null then
    raise exception 'this position is already closed without a movement'
      using errcode = 'restrict_violation';
  end if;
  if v_item.sky_id is null then
    raise exception 'this item is not a catalog figure and has no stock position'
      using errcode = 'check_violation';
  end if;
  /*
   * NOT FROM THE SHELF, SO NOT OFF THE SHELF. The workbook's own `-` in
   * column L. Booking it would remove a piece that this sale never held.
   */
  if v_item.legacy_stock_flag = '-' then
    raise exception 'the workbook records this copy as not taken from stock; close it instead'
      using errcode = 'restrict_violation';
  end if;

  -- Raises if the shelf cannot cover it without eating a reservation.
  v_mid := public.record_inventory_movement(
    v_item.sky_id, v_item.condition, -1, 'sale_external',
    null, null, 'Orderbuch: externer Verkauf #' || v_sale.id);

  select market_price into v_price from public.skylanders where sky_id = v_item.sky_id;

  update public.sale_items
     set movement_id = v_mid,
         -- Frozen here, because this is the moment the object left.
         market_price_snapshot = v_price,
         market_price_snapshot_at = now(),
         updated_at = now()
   where id = p_item_id;

  /*
   * ONE FACTOR PER SALE, frozen at the first Ausbuchen — byte for byte as
   * 0059 wrote it, `updated_by` included.
   */
  update public.sales
     set buy_in_factor_snapshot = coalesce(buy_in_factor_snapshot, public.orderbook_global_factor()),
         updated_at = now(), updated_by = (select auth.uid())
   where id = v_sale.id;

  return v_mid;
end;
$$;

comment on function public.seller_book_sale_item(bigint) is
  'Take one sold catalog figure off the shelf: one `sale_external` movement of -1, the market price frozen, and the sale''s buy-in factor frozen on the first one (0059, released historical sales and the not-from-stock refusal 0073). Refuses an internal sale, a cancelled one, a workbook sale that 0071 did not release, a position already closed without a movement, a non-catalog article, and a line the workbook marked `legacy_stock_flag = ''-''` — shipped, but never taken from stock.';

revoke all on function public.seller_book_sale_item(bigint) from public, anon;
grant execute on function public.seller_book_sale_item(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Erledigt — the ending for everything that never stood on a shelf
-- ---------------------------------------------------------------------------

create or replace function public.seller_settle_sale_item(
  p_item_id bigint,
  p_settled boolean default true
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

  /* Taking it back needs no permission beyond the seller role: nothing
     irreversible happened, and a mis-click should not need a migration. */
  if not p_settled then
    update public.sale_items set settled_at = null, updated_at = now() where id = p_item_id;
    return;
  end if;

  if v_item.settled_at is not null then return; end if;   -- idempotent

  if v_item.movement_id is not null then
    raise exception 'this position left the shelf; reverse the booking first'
      using errcode = 'restrict_violation';
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;
  if v_sale.order_id is not null then
    raise exception 'an order''s lines are owned by commerce' using errcode = 'restrict_violation';
  end if;
  /*
   * A workbook sale that nobody released is still frozen. Settling it would
   * be a state change on a historical record, which is the thing 0071 hands
   * out one order at a time.
   */
  if v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null then
    raise exception 'this historical sale has not been released' using errcode = 'restrict_violation';
  end if;

  /*
   * THE LOCK.
   *
   * Two ways to be outside figure inventory, and no third. A catalog figure
   * from a hand-made sale carries `legacy_stock_flag` NULL and hits neither,
   * so it cannot be closed except by being booked — which is the point: an
   * ending without a movement must never become a way to make stock
   * disappear quietly.
   */
  if v_item.sky_id is not null and v_item.legacy_stock_flag is distinct from '-' then
    raise exception 'a catalog figure leaves stock by being booked, never by being closed'
      using errcode = 'check_violation';
  end if;

  update public.sale_items set settled_at = now(), updated_at = now() where id = p_item_id;
end;
$$;

comment on function public.seller_settle_sale_item(bigint, boolean) is
  'Close one sold position WITHOUT an inventory movement (0073), or reopen it with p_settled = false. Allowed only where there is no figure inventory to leave: a position with no sky_id, or one the workbook marked `legacy_stock_flag = ''-''` — shipped but deliberately not taken from stock. Refused for any other catalog figure, for a booked position, for an order line, and for a historical sale 0071 has not released. Writes one timestamp and never a movement.';

revoke all on function public.seller_settle_sale_item(bigint, boolean) from public, anon;
grant execute on function public.seller_settle_sale_item(bigint, boolean) to authenticated;
