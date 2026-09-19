-- ===========================================================================
-- 0064 — a parcel is entered as one thing, and a historical line stays put
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS AT ALL
--
-- Two gaps, and only two. Everything else the new Einkauf workflow needs was
-- already here and is deliberately left alone:
--
--   removing an unbooked item      `seller_remove_purchase_item`  (0053)
--   changing which figure it is    `seller_set_purchase_item_sky` (0054)
--   adding one to an existing      `seller_add_purchase_item`     (0053)
--   refusing a booked item         both of the above, plus the FK
--
-- GAP 1 — CREATION WAS NOT ONE OPERATION.
--
-- The screen could only say: create the purchase, then add item 1, then item
-- 2, then item 3. Each is its own request and its own transaction, so a
-- connection dropped after the fourth of five leaves a purchase that exists,
-- is missing a figure, and that nobody asked for in that shape. The operator
-- pressed one button, so one thing has to happen.
--
-- `seller_create_purchase_with_items` is that one thing. It is thin on
-- purpose: it CALLS the two functions that already exist rather than
-- re-implementing what they validate, so there is still exactly one
-- definition of "what a purchase is" and one of "what an item is". A plpgsql
-- function is a single statement to the caller — if the third item raises,
-- the purchase and the first two go with it. Nothing partial can survive.
--
-- GAP 2 — REMOVAL DID NOT PROTECT THE WORKBOOK.
--
-- `seller_remove_purchase_item` (0053) refused an item that owns an inventory
-- movement, which was the whole danger at the time: no screen offered removal
-- and the only items that existed were hand-made. Both facts have changed.
-- The detail page now offers `Entfernen`, and 2 114 of the 2 115 purchase
-- items on Staging are reconciled legacy lines carrying `source_row` from the
-- workbook — provenance that no importer will ever regenerate, because this
-- project does not re-import.
--
-- Those lines have `movement_id is null`. Under the old rule they were one
-- click from being gone. They are not deletable here.
--
-- WHAT THIS DOES NOT DO
--
-- No inventory. `seller_add_purchase_item` touches none and neither does
-- anything below; `record_inventory_movement`, `shop_inventory` and
-- `inventory_movements` are not named in this file at all. No RLS change, no
-- policy, no table grant. No column is added, dropped or altered. Nothing is
-- backfilled and no existing row is written.
--
-- DEPENDS ON 0053 (purchases, items, add/remove), 0054 (identity remap),
-- 0063 (`is_test` and the four-argument `seller_create_purchase`).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Creating a purchase and the units in it, atomically
--
-- `p_items` is one element PER PHYSICAL UNIT, never a quantity. Three Wash
-- Bucklers are three elements, become three rows and later three separate
-- bookings — the same shape the table has had since 0053, because a purchase
-- item IS one object and a quantity column would be a second way to say the
-- same thing that could disagree with the first.
--
--   [{"sky_id": "SKY-0212"},
--    {"sky_id": "SKY-0212"},
--    {"raw_name": "Portal of Power"}]
--
-- The element shape is exactly `seller_add_purchase_item`'s arguments, and it
-- is that function which decides whether an element is acceptable. Repeating
-- the "a figure or a name" rule here would be a second copy of it.
-- ---------------------------------------------------------------------------

create or replace function public.seller_create_purchase_with_items(
  p_purchased_at date,
  p_total_cost   numeric,
  p_note         text    default null,
  p_is_test      boolean default false,
  p_items        jsonb   default '[]'::jsonb
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id      bigint;
  v_items   jsonb;
  v_element jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  -- A missing list is an empty one: a purchase with no items is legitimate
  -- and becomes `Unvollständig` (0063), which is a state the owner may want
  -- on purpose when only the date and the amount are known yet.
  v_items := coalesce(p_items, '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'the item list must be a json array'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * A ceiling, not a business rule. The largest real parcel in the workbook
   * is 65 units; 200 is far above anything anybody enters by hand and far
   * below the point where one request becomes a problem. It exists so a
   * malformed client cannot ask for a hundred thousand rows in one
   * transaction.
   */
  if jsonb_array_length(v_items) > 200 then
    raise exception 'a purchase may be created with at most 200 items at once'
      using errcode = 'program_limit_exceeded';
  end if;

  v_id := public.seller_create_purchase(p_purchased_at, p_total_cost, p_note, p_is_test);

  for v_element in select * from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every item must be a json object'
        using errcode = 'invalid_parameter_value';
    end if;
    /*
     * Delegated on purpose. `seller_add_purchase_item` assigns the position,
     * rejects an element that is neither a catalog figure nor a name, and
     * lets the foreign key reject a sky_id that is not in the catalog. All of
     * that happens inside this transaction, so a bad element three rows down
     * takes the purchase with it.
     */
    perform public.seller_add_purchase_item(
      v_id,
      nullif(btrim(coalesce(v_element->>'sky_id', '')), ''),
      nullif(btrim(coalesce(v_element->>'raw_name', '')), ''),
      coalesce(nullif(btrim(coalesce(v_element->>'condition', '')), ''), 'loose')
    );
  end loop;

  return v_id;
end;
$$;

comment on function public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb) is
  'Creates one purchase together with its initial items in a single transaction (0064). One element per physical unit — duplicates are expected and are not collapsed. Stocks nothing: `seller_book_purchase_item` remains the only path into inventory. Delegates to seller_create_purchase and seller_add_purchase_item so their validation is not duplicated; an invalid element rolls the whole purchase back.';


-- ---------------------------------------------------------------------------
-- 2. Removal, with the workbook protected
--
-- Same signature, same name, one more thing it refuses. The movement check is
-- unchanged and still first, because "this is in stock" is the sentence the
-- operator most needs to read.
--
-- WHAT COUNTS AS HISTORICAL, and why it is asked three ways. Each of the
-- three is sufficient on its own and each would be enough today; together
-- they mean no single field has to stay correct for ever:
--
--   the parent's `source`   an imported purchase owns imported lines
--   the item's `state`      `reconciled_legacy` is the workbook's own state
--   `source_row` and the    the workbook's row number and its two markers,
--   legacy markers          which a hand-made item never has
--
-- On Staging the three agree exactly: 2 114 items are historical by all
-- three, 1 is historical by none. They are stated separately anyway — a
-- future import that forgot one of them must not open a hole.
--
-- WHAT IT STILL ALLOWS, deliberately: correcting which figure a historical
-- line IS. That is `seller_set_purchase_item_sky` and it is the entire point
-- of 0054 — a workbook name mapped to the wrong SKY-ID has to be fixable, and
-- doing so changes a classification while the line, its row number and its
-- provenance stay exactly where they are. Deleting the line is the different
-- act, and that is the one refused here.
-- ---------------------------------------------------------------------------

create or replace function public.seller_remove_purchase_item(p_item_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item   record;
  v_source text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.purchase_items where id = p_item_id for update;
  if not found then
    raise exception 'no such purchase item' using errcode = 'no_data_found';
  end if;

  -- Unchanged from 0053. The foreign key would refuse it anyway; this says
  -- why in a sentence a person can act on.
  if v_item.movement_id is not null then
    raise exception 'this item is already in inventory; reverse the booking before removing it'
      using errcode = 'restrict_violation';
  end if;

  select p.source into v_source from public.purchases p where p.id = v_item.purchase_id;

  if v_source is distinct from 'manual'
     or v_item.state = 'reconciled_legacy'
     or v_item.source_row is not null
     or v_item.legacy_booked_flag is not null
     or v_item.legacy_condition_flag is not null
  then
    raise exception 'this item came from the legacy workbook; its provenance is not removable'
      using errcode = 'restrict_violation';
  end if;

  delete from public.purchase_items where id = p_item_id;
end;
$$;

comment on function public.seller_remove_purchase_item(bigint) is
  'Removes one hand-made, unbooked purchase item (0053, hardened in 0064). Refuses an item that owns an inventory movement and refuses anything carrying legacy provenance — an imported parent, the reconciled_legacy state, a workbook row number or either legacy marker. Correcting a historical line''s FIGURE remains possible through seller_set_purchase_item_sky; only deleting the line is refused. Touches no inventory.';


-- ---------------------------------------------------------------------------
-- 3. Grants
--
-- The grant is not the authorization — every function above checks
-- `can_operate_active_seller()` in its own body. This is only what lets
-- PostgREST see them, and `anon` never may.
-- ---------------------------------------------------------------------------

revoke all on function public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb)
  from public, anon;
grant execute on function public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb)
  to authenticated;

revoke all on function public.seller_remove_purchase_item(bigint) from public, anon;
grant execute on function public.seller_remove_purchase_item(bigint) to authenticated;
