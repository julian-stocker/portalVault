-- ===========================================================================
-- 0065 — an external sale arrives whole, and a workbook line stays put
--
-- ---------------------------------------------------------------------------
-- WHAT WAS ALREADY THERE, AND IS NOT REBUILT
--
-- Almost everything. The sale side of the Orderbuch has been complete since
-- `0059`/`0062`, and this file adds nothing that already has a home:
--
--   the payout formula      `sale_expected_payout()`            0059
--   several fees per sale   `sale_fees` + `settled_by`          0059
--   buyer-paid shipping     `sales.shipping_charged`            0059
--   the seller's own label  `sale_fees.kind = 'shipping_label'` 0059
--   signed corrections      `settlement_adjustments`            0059
--   the reported payout     `sales.reported_payout_*`           0059
--   Ausbuchen, one unit     `seller_book_sale_item`             0059
--   returns and restocking  `seller_return_sale_item` et al     0059
--   the audit trail         `orderbook_audit` + `orderbook_log` 0062
--
-- In particular there is NO eBay data model here and no `ebay_fee` column.
-- eBay is a layout: the template decides labels and which inputs are shown,
-- and every value it collects lands in the structures above. Staging already
-- proves they are enough — 820 fee rows across four kind/settlement
-- combinations, 282 sales carrying more than one fee, up to four on a single
-- sale.
--
-- ---------------------------------------------------------------------------
-- GAP 1 — A SALE WAS BORN IN PIECES.
--
-- `new-sale.tsx` said so in its own comment: create the sale, then a second
-- call for the amounts, and the fees, adjustments and payout afterwards in
-- Details. Every one of those is its own transaction. A connection dropped
-- between them leaves a sale whose money is wrong in a way nothing flags —
-- and the payout reconciliation, which is the entire point of the screen,
-- silently compares against a half-entered figure.
--
-- `seller_create_sale_with_details` is one statement to the caller. It is
-- thin: it CALLS `seller_create_sale`, `seller_add_sale_item`,
-- `seller_add_sale_fee`, `seller_add_settlement_adjustment` and
-- `seller_set_sale_payout` rather than re-implementing what they validate and
-- audit. If the third fee raises, the sale and everything before it go with
-- it. There is no partial sale.
--
-- THE AMOUNTS ARE SET DIRECTLY, NOT THROUGH `seller_update_sale`, and that is
-- an audit decision rather than a shortcut. `seller_create_sale` writes
-- 0/0/0 as a placeholder; routing the real figures through the update
-- function would file eight `orderbook_audit` rows saying the sale had been
-- *corrected* from zero, seconds after it was created. Nothing was corrected.
-- `orderbook_audit` records what changed after a sale was created or
-- imported, and creation has to stay outside it for that sentence to keep
-- meaning anything.
--
-- ---------------------------------------------------------------------------
-- GAP 2 — A WRONGLY CHOSEN FIGURE COULD NOT BE CORRECTED.
--
-- The purchase side has had `seller_set_purchase_item_sky` since `0054`. The
-- sale side never got one: the only remedy was remove-and-re-add, which loses
-- the position and is three gestures for one mistake.
--
-- `seller_set_sale_item_sky` is deliberately NARROWER than its purchase
-- counterpart. `0054` allows a historical purchase line to be remapped
-- because curating workbook names onto SKY-IDs is what that migration exists
-- for. Nothing equivalent was ever established for sales, the screens have
-- never offered it, and inventing that workflow here would be scope this task
-- did not ask for. So: manual, unbooked, unreturned items only.
--
-- ---------------------------------------------------------------------------
-- GAP 3 — REMOVAL DID NOT PROTECT THE WORKBOOK.
--
-- Exactly the defect `0064` fixed on the purchase side, in the mirror
-- function. `seller_remove_sale_item` (`0059`) refused only an item that owns
-- a movement. On Staging **1 253 of 1 257** sale items are imported history
-- carrying `source_row` and both legacy markers — and history never moves
-- stock, enforced by `sale_items_no_historical_movement()`, so every single
-- one of them has `movement_id is null`.
--
-- The screen happened to hide the control for them. That is a screen, and the
-- function is the boundary.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT DO
--
-- No new table, no new column, no backfill, no RLS change, no policy, no
-- table grant. No eBay-specific storage of any kind. And creation moves NO
-- stock: `record_inventory_movement` appears nowhere below, because
-- `seller_book_sale_item` remains the only way an external sale reaches the
-- ledger, one physical unit at a time.
--
-- DEPENDS ON 0059 (sales, items, fees, adjustments, payout, Ausbuchen),
-- 0062 (audit trail, concurrency token), 0063 (`is_test`).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Correcting which figure a sale item is
--
-- Audited as an `update` on `sale_item`, which `orderbook_audit` already
-- knows as an entity type. `orderbook_log` drops a no-op, so re-picking the
-- same figure files nothing.
--
-- `raw_name`, `source_row`, the legacy markers, `position` and `condition`
-- are deliberately untouched: the identity changes, the provenance does not.
-- No price snapshot is written either — that belongs to Ausbuchen, which is
-- the moment the object actually leaves.
-- ---------------------------------------------------------------------------

create or replace function public.seller_set_sale_item_sky(
  p_item_id bigint,
  p_sky_id  text
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
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then
    raise exception 'no such sale item' using errcode = 'no_data_found';
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;

  if v_sale.order_id is not null then
    raise exception 'an internal sale takes its items from the order'
      using errcode = 'restrict_violation';
  end if;

  -- The movement names the figure that left the shelf. Repointing the row
  -- would leave the two describing different objects.
  if v_item.movement_id is not null then
    raise exception 'this item is booked out; reverse the stock movement before changing which figure it is'
      using errcode = 'restrict_violation';
  end if;
  if v_item.returned_at is not null then
    raise exception 'this item has been returned; its identity is part of that record'
      using errcode = 'restrict_violation';
  end if;

  if v_sale.source = 'excel_order_2026'
     or v_item.source_row is not null
     or v_item.legacy_stock_flag is not null
     or v_item.legacy_shipped_flag is not null
  then
    raise exception 'this item came from the legacy workbook; its provenance is not editable'
      using errcode = 'restrict_violation';
  end if;

  -- A sale item must stay identifiable (`sale_items_identifiable`).
  if nullif(btrim(coalesce(p_sky_id, '')), '') is null then
    raise exception 'a sale item needs a catalog figure' using errcode = 'check_violation';
  end if;

  update public.sale_items
     set sky_id = btrim(p_sky_id),
         updated_at = now()
   where id = p_item_id;

  perform public.orderbook_log(v_item.sale_id, 'sale_item', p_item_id, 'update', 'sky_id',
                               v_item.sky_id, btrim(p_sky_id));
  perform public.orderbook_touch_sale(v_item.sale_id);
end;
$$;

comment on function public.seller_set_sale_item_sky(bigint, text) is
  'Corrects which catalog figure one EXTERNAL, hand-made, unbooked sale item is (0065). Refuses an internal, booked, returned or imported item, never touches raw_name, source row, legacy markers or position, writes no price snapshot and moves no stock. Narrower than its purchase counterpart on purpose — see the file header.';


-- ---------------------------------------------------------------------------
-- 2. Removal, with the workbook protected
--
-- Same name, same signature, one more refusal. The movement check stays
-- first, because "this has left the shelf" is the sentence the operator most
-- needs to read; the return movement is checked with it, since an item that
-- came back still has two ledger entries describing it.
-- ---------------------------------------------------------------------------

create or replace function public.seller_remove_sale_item(p_item_id bigint)
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
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then
    raise exception 'no such sale item' using errcode = 'no_data_found';
  end if;

  if v_item.movement_id is not null or v_item.return_movement_id is not null then
    raise exception 'this item is booked out; reverse the stock movement before removing it'
      using errcode = 'restrict_violation';
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;

  if v_sale.order_id is not null then
    raise exception 'an internal sale takes its items from the order'
      using errcode = 'restrict_violation';
  end if;

  if v_sale.source = 'excel_order_2026'
     or v_item.source_row is not null
     or v_item.legacy_stock_flag is not null
     or v_item.legacy_shipped_flag is not null
  then
    raise exception 'this item came from the legacy workbook; its provenance is not removable'
      using errcode = 'restrict_violation';
  end if;

  delete from public.sale_items where id = p_item_id;

  perform public.orderbook_log(v_item.sale_id, 'sale_item', p_item_id, 'delete', null, null, null);
  perform public.orderbook_touch_sale(v_item.sale_id);
end;
$$;

comment on function public.seller_remove_sale_item(bigint) is
  'Removes one hand-made, unbooked external sale item (0059, hardened and audited in 0065). Refuses an item with either stock movement, an internal sale''s item, and anything carrying legacy provenance — an imported parent, a workbook row number or either legacy marker. Touches no inventory.';


-- ---------------------------------------------------------------------------
-- 3. One external sale, whole
--
-- `p_items` is one element PER PHYSICAL UNIT. Two copies of the same figure
-- are two elements and become two `sale_items` rows, each booked out on its
-- own later. There is no quantity anywhere in this model.
--
--   p_items       [{"sky_id": "SKY-0212"}, {"sky_id": "SKY-0212"}]
--   p_fees        [{"kind": "marketplace", "amount": 3.42, "settled_by": "channel"},
--                  {"kind": "shipping_label", "amount": 2.19, "settled_by": "external"}]
--   p_adjustments [{"amount": -0.35, "reason": "sonstiges", "note": "…"}]
--
-- The element shapes are exactly the arguments of the functions this calls,
-- and it is those functions that decide whether an element is acceptable —
-- `sale_fees_kind_known`, `sale_fees_settled_known`, the positive-amount
-- rule, `sale_fees_other_has_label`, and the catalog foreign key.
-- ---------------------------------------------------------------------------

create or replace function public.seller_create_sale_with_details(
  p_channel          text,
  p_sold_at          date    default null,
  p_country          text    default null,
  p_external_ref     text    default null,
  p_buyer_ref        text    default null,
  p_note             text    default null,
  p_is_test          boolean default false,
  p_items_subtotal   numeric default 0,
  p_shipping_charged numeric default 0,
  p_discount_amount  numeric default 0,
  p_items            jsonb   default '[]'::jsonb,
  p_fees             jsonb   default '[]'::jsonb,
  p_adjustments      jsonb   default '[]'::jsonb,
  p_payout_amount    numeric default null,
  p_payout_ref       text    default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id      bigint;
  v_element jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  -- Shape, before anything is created. A malformed payload must not get as
  -- far as a half-built sale that then rolls back — it should simply be a
  -- refusal the form can show.
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_fees, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_adjustments, '[]'::jsonb)) <> 'array'
  then
    raise exception 'items, fees and adjustments must each be a json array'
      using errcode = 'invalid_parameter_value';
  end if;
  -- Ceilings, not business rules: the largest workbook sale has 27 items and
  -- 4 fees. These stop a malformed client, nothing else.
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 200
     or jsonb_array_length(coalesce(p_fees, '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p_adjustments, '[]'::jsonb)) > 20
  then
    raise exception 'too many items, fees or adjustments in one sale'
      using errcode = 'program_limit_exceeded';
  end if;

  -- Refuses `skyisles`, stamps the source and the test classification.
  v_id := public.seller_create_sale(p_channel, p_sold_at, p_country,
                                    p_external_ref, p_buyer_ref, p_note, p_is_test);

  /*
   * The three customer-facing amounts, written directly.
   *
   * NOT through `seller_update_sale`: see the file header. Creation is not a
   * correction, and routing these through the audited updater would claim it
   * was. The row was created by this transaction and the seller gate has
   * already fired; the table's own CHECK constraints still apply.
   */
  update public.sales
     set items_subtotal   = coalesce(p_items_subtotal, 0),
         shipping_charged = coalesce(p_shipping_charged, 0),
         discount_amount  = coalesce(p_discount_amount, 0)
   where id = v_id;

  for v_element in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every item must be a json object' using errcode = 'invalid_parameter_value';
    end if;
    perform public.seller_add_sale_item(
      v_id,
      nullif(btrim(coalesce(v_element->>'sky_id', '')), ''),
      nullif(btrim(coalesce(v_element->>'raw_name', '')), ''),
      coalesce(nullif(btrim(coalesce(v_element->>'condition', '')), ''), 'loose')
    );
  end loop;

  for v_element in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every fee must be a json object' using errcode = 'invalid_parameter_value';
    end if;
    perform public.seller_add_sale_fee(
      v_id,
      v_element->>'kind',
      (v_element->>'amount')::numeric,
      v_element->>'settled_by',
      nullif(btrim(coalesce(v_element->>'label', '')), ''),
      nullif(btrim(coalesce(v_element->>'note', '')), '')
    );
  end loop;

  for v_element in select * from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every adjustment must be a json object'
        using errcode = 'invalid_parameter_value';
    end if;
    -- The channel is the sale's, never the caller's: an adjustment settled by
    -- a different channel than the sale it belongs to is not a thing.
    perform public.seller_add_settlement_adjustment(
      v_id,
      p_channel,
      (v_element->>'amount')::numeric,
      nullif(btrim(coalesce(v_element->>'reason', '')), ''),
      nullif(btrim(coalesce(v_element->>'external_ref', '')), ''),
      nullif(btrim(coalesce(v_element->>'note', '')), ''),
      (nullif(btrim(coalesce(v_element->>'occurred_at', '')), ''))::date
    );
  end loop;

  /*
   * The reported payout, only when there is one.
   *
   * This one IS audited, through `seller_set_sale_payout` — unlike the three
   * amounts above, what the channel actually paid is a reconciliation fact
   * that arrives from outside, and a record of when it was first entered is
   * worth having even on a sale one second old.
   */
  if p_payout_amount is not null then
    perform public.seller_set_sale_payout(v_id, p_payout_amount, p_payout_ref, null, null);
  end if;

  return v_id;
end;
$$;

comment on function public.seller_create_sale_with_details(text, date, text, text, text, text, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, text) is
  'Creates one external sale together with its amounts, items, fees, adjustments and reported payout in a single transaction (0065). One item element per physical unit — duplicates are expected and are not collapsed. Moves NO stock: seller_book_sale_item remains the only path to the ledger. Delegates to the existing single-purpose functions so their validation and audit behaviour is not duplicated; any invalid element rolls the whole sale back.';


-- ---------------------------------------------------------------------------
-- 4. Grants
--
-- The grant is not the authorization — every function above asks
-- `can_operate_active_seller()` in its own body. `anon` never may.
-- ---------------------------------------------------------------------------

revoke all on function public.seller_set_sale_item_sky(bigint, text) from public, anon;
grant execute on function public.seller_set_sale_item_sky(bigint, text) to authenticated;

revoke all on function public.seller_remove_sale_item(bigint) from public, anon;
grant execute on function public.seller_remove_sale_item(bigint) to authenticated;

revoke all on function public.seller_create_sale_with_details(text, date, text, text, text, text, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, text)
  from public, anon;
grant execute on function public.seller_create_sale_with_details(text, date, text, text, text, text, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, text)
  to authenticated;
