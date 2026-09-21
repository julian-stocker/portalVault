-- ===========================================================================
-- 0081 — closing the workbook positions the reconciliation already accounted
--        for (ADR-0102)
--
-- WHY 0073 REFUSES THESE, AND WHY THAT WAS RIGHT
--
-- `seller_settle_sale_item()` closes a sold position without a movement, and
-- it guards that hard: a catalog figure whose `legacy_stock_flag` is not `-`
-- is refused, because "an ending without a movement must never become a way
-- to make stock disappear quietly". At the time the shelf was the unknown and
-- the ledger was the only record, so that was exactly the right lock.
--
-- WHAT CHANGED
--
-- The workbook's column F is now the agreed physical truth, and the stock
-- reconciliation brings `shop_inventory` onto it with explicit, append-only
-- `correction` movements. Once that has run, these 187 positions are ALREADY
-- reflected in the stock on the shelf. Booking them out a second time would
-- remove the same units twice; leaving them open would leave the Orderbuch
-- permanently claiming work that is done.
--
-- So the missing state is not "book it" and not "it never left" — it is
-- "accounted for during the legacy reconciliation", and that needs its own
-- door rather than a widening of the old one. `seller_settle_sale_item()` is
-- untouched and keeps refusing exactly what it refused before.
--
-- THE POPULATION THIS CAN TOUCH, AND NOTHING ELSE
--
--   * the sale is a workbook import, not a test, not cancelled, not an order
--   * `0071` has released it
--   * the position never moved: no movement, no return, not marked unshipped
--   * the workbook recorded NO outcome for it — `legacy_stock_flag` is null
--     or empty. A row the workbook marked `x`, `-` or `r` already has its
--     answer and is not this function's business.
--
-- Anything else raises. There are no parameters beyond the item, so there is
-- nothing to widen it with from the outside.
--
-- IT WRITES ONE TIMESTAMP AND A NOTE. No movement, no quantity, no price.
--
-- THREE FUNCTIONS, THE SAME SHAPE AS THE LEDGER'S
--
-- `apply_...` holds the rules and is callable by nobody. `seller_...` is the
-- product path and asks for the operator role. `system_...` is the migration
-- path and is authorised by its EXECUTE grant alone, which only service_role
-- holds — the same arrangement `record_inventory_movement` and
-- `system_record_inventory_movement` have had since 0003. Splitting it this
-- way is what keeps the one-shot closing tool from needing a role the
-- product would then also have.
-- ===========================================================================

create or replace function public.apply_reconciled_legacy_settlement(
  p_item_id bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_sale record;
begin
  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then
    raise exception 'no such sale item' using errcode = 'no_data_found';
  end if;

  -- Idempotent: running the closing tool twice is expected and harmless.
  if v_item.settled_at is not null then
    return;
  end if;

  if v_item.movement_id is not null or v_item.return_movement_id is not null then
    raise exception 'this position has a stock movement; it is not an open legacy line'
      using errcode = 'restrict_violation';
  end if;

  if v_item.not_shipped_at is not null then
    raise exception 'this position is already closed as not shipped'
      using errcode = 'restrict_violation';
  end if;

  -- The workbook's own outcome wins wherever it has one.
  if coalesce(v_item.legacy_stock_flag, '') <> '' then
    raise exception 'the workbook recorded an outcome (%) for this position'
      , v_item.legacy_stock_flag
      using errcode = 'restrict_violation';
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;

  if v_sale.source <> 'excel_order_2026' then
    raise exception 'only imported workbook sales are reconciled this way'
      using errcode = 'restrict_violation';
  end if;
  if v_sale.order_id is not null then
    raise exception 'an order''s lines are owned by commerce'
      using errcode = 'restrict_violation';
  end if;
  if v_sale.is_test or v_sale.cancelled_at is not null then
    raise exception 'this sale is a test or was cancelled'
      using errcode = 'restrict_violation';
  end if;
  -- The same gate 0071 and 0073 apply: a frozen historical sale is released
  -- one order at a time, by a person, and this is not the way around that.
  if v_sale.stock_released_at is null then
    raise exception 'this historical sale has not been released'
      using errcode = 'restrict_violation';
  end if;

  update public.sale_items
     set settled_at = now(),
         updated_at = now(),
         note = concat_ws(' | ', nullif(note, ''),
                'Legacy-Abgleich 0081: Bestandswirkung bereits über die Reconciliation auf Excel F erfasst; kein Inventory-Movement.')
   where id = p_item_id;
end;
$$;

comment on function public.apply_reconciled_legacy_settlement(bigint) is
  'The rules for closing one workbook sale position the legacy reconciliation already accounted for (0081). Internal: no role holds EXECUTE. Call it through seller_settle_reconciled_legacy_item() or system_settle_reconciled_legacy_item().';

revoke all on function public.apply_reconciled_legacy_settlement(bigint) from public, anon, authenticated;

-- The product path: a Seller Operator closing a line from the Orderbuch.
create or replace function public.seller_settle_reconciled_legacy_item(
  p_item_id bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.apply_reconciled_legacy_settlement(p_item_id);
end;
$$;

comment on function public.seller_settle_reconciled_legacy_item(bigint) is
  'Close one imported workbook sale position whose stock effect the legacy reconciliation already carried into shop_inventory (0081). Writes settled_at and a note, never a movement. Only for a released, uncancelled, non-test workbook sale line with no movement and no workbook outcome of its own; everything else raises. seller_settle_sale_item() is unchanged and still refuses these.';

revoke all on function public.seller_settle_reconciled_legacy_item(bigint) from public, anon;
grant execute on function public.seller_settle_reconciled_legacy_item(bigint) to authenticated;

-- The migration path. No role check in the body: the authorization IS the
-- EXECUTE privilege, which only service_role holds. A request arriving as
-- anon or authenticated is refused by Postgres before the body runs.
create or replace function public.system_settle_reconciled_legacy_item(
  p_item_id bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.apply_reconciled_legacy_settlement(p_item_id);
end;
$$;

comment on function public.system_settle_reconciled_legacy_item(bigint) is
  'The one-shot closing tool''s path into apply_reconciled_legacy_settlement() (0081). service_role only, by grant rather than by check.';

revoke all on function public.system_settle_reconciled_legacy_item(bigint) from public, anon, authenticated;
grant execute on function public.system_settle_reconciled_legacy_item(bigint) to service_role;
