-- ===========================================================================
-- 0016 — create_order() must never write a placeholder amount
--
-- A defect fix, and the only one in this file. One function is replaced. No
-- table, no trigger, no constraint, no grant, no policy changes.
--
-- THE DEFECT
--
-- Since 0010, `create_order()` has inserted the order with zero amounts and
-- patched them a few statements later:
--
--     insert into public.orders (... items_subtotal, total_amount ...)
--     values                    (... 0, 0 ...)
--     ...
--     update public.orders
--        set items_subtotal = v_subtotal, ...
--
-- and `orders_protect_immutable()` — introduced in the same migration, and
-- carried forward unchanged by 0011 and 0013 — refuses exactly that:
--
--     if ... new.items_subtotal is distinct from old.items_subtotal ... then
--       raise exception 'an order''s identity and amounts are immutable'
--         using errcode = 'restrict_violation';
--
-- The two cannot both hold. Every call raised SQLSTATE 23001 and rolled back,
-- so **no order could be created at all**, in any environment. There is no
-- input that avoids it: an order must have at least one line, every offered
-- article has a price, so `v_subtotal` is always greater than the zero it
-- replaces — and even a hypothetical zero-subtotal order would trip the
-- trigger on `shipping_amount`, because free shipping needs a subtotal of at
-- least 75.
--
-- It went unnoticed because every test of this function is a source-text
-- assertion. The trigger names the amount columns and the function contains
-- an UPDATE; both statements are true, and no string comparison can see that
-- they contradict each other. `create_order()` had never once been executed.
-- The staging runtime suite found it on its third run.
--
-- THE FIX, AND WHY IT IS THIS ONE
--
-- The amounts are computed **before** the order row exists, so there is
-- nothing to update afterwards. The trigger is untouched and the invariant it
-- protects becomes literally true: an order's amounts are fixed from its
-- first INSERT, with no window in which they are legally mutable.
--
-- The alternative — permitting the change while the old amount is still zero
-- — was rejected. It would turn "an order's amounts are immutable" into
-- "immutable, except briefly", weaken a guarantee `docs/SECURITY.md` states
-- without qualification, and leave an order row with zero amounts visible to
-- anything reading concurrently between the two statements.
--
-- RESOLVE ONCE, USE TWICE
--
-- Lines cannot be inserted before the order (`order_lines.order_id` is a
-- foreign key), and the subtotal is not known until every line is priced. The
-- resolution is therefore split from the writing:
--
--   pass 1  read and validate every position, price it, and keep the snapshot
--   -----   compute the subtotal, then the shipping charge
--   INSERT  the order, with its final amounts
--   pass 2  write the lines from the snapshots taken in pass 1
--
-- Pass 2 re-reads nothing. That is a correctness requirement, not tidiness:
-- this runs at READ COMMITTED, so a second lookup of the same article could
-- legitimately return a different price than the one the subtotal was built
-- from, and the order would charge one figure while its lines showed another.
-- Every position is priced exactly once.
--
-- The snapshots are carried in a `jsonb` array rather than a new composite
-- type, so this migration adds nothing to the schema. Money survives that
-- round trip exactly: `jsonb` stores a JSON number as PostgreSQL `numeric`,
-- and `->>` then `::numeric(10,2)` is a text round trip with no binary
-- floating point anywhere in it.
--
-- WHAT DOES NOT CHANGE
--
--   * the signature — still `(text, text, jsonb, jsonb, text, text)`
--   * privileges — `create or replace` preserves them, so 0013's
--     `grant execute ... to anon, authenticated` still stands. Deliberately
--     not restated: this migration issues no GRANT and no REVOKE
--   * every validation, in the same order, with the same error codes
--   * the idempotent retry on `request_id`, including its capability check.
--     It still updates nothing
--   * `shop_price()` and `is_shop_eligible()` remain the only authority on
--     price and availability. The caller still names no amount — there is no
--     parameter for one
--   * `reserve_for_order()` remains the final revalidation under row locks,
--     called at the same point
--   * the address, the `placed` event, and the returned columns
-- ===========================================================================

create or replace function public.create_order(
  p_request_id      text,
  p_email           text,
  p_items           jsonb,
  p_address         jsonb,
  p_shipping_method text,
  p_payment_token   text
)
returns table (
  order_id        bigint,
  order_number    text,
  items_subtotal  numeric,
  shipping_amount numeric,
  total_amount    numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id bigint;
  v_number   text;
  v_user_id  uuid := (select auth.uid());
  v_item     jsonb;
  v_sky_id   text;
  v_cond     text;
  v_qty      integer;
  v_price    numeric(10,2);
  v_name     text;
  v_image    text;
  v_inv_id   bigint;
  v_line_total numeric(10,2);
  v_subtotal numeric(10,2) := 0;
  v_lines    integer := 0;
  v_client   text;
  v_country  text;
  v_ship_name text;
  v_shipping numeric(10,2);
  v_token_hash text;
  v_existing record;

  -- The positions, priced and snapshotted, between pass 1 and pass 2. Never
  -- leaves this function and never reaches the caller.
  v_resolved jsonb := '[]'::jsonb;
begin
  if p_request_id is null or length(p_request_id) < 8 then
    raise exception 'a checkout needs a request id' using errcode = 'check_violation';
  end if;

  -- The capability is required. An order nobody can prove they placed is an
  -- order nobody can pay for.
  if p_payment_token is null or length(p_payment_token) < 32 then
    raise exception 'a checkout needs a payment capability' using errcode = 'check_violation';
  end if;

  v_token_hash := encode(sha256(convert_to(p_payment_token, 'utf8')), 'hex');

  -- Already done. Hand it back only to a caller that can prove it is the one
  -- that created it — the same token, not merely the same request id.
  select o.id, o.order_number, o.items_subtotal, o.shipping_amount, o.total_amount,
         o.payment_token_hash
    into v_existing
    from public.orders o
   where o.request_id = p_request_id;

  if found then
    if v_existing.payment_token_hash is distinct from v_token_hash then
      raise exception 'this checkout belongs to somebody else'
        using errcode = 'insufficient_privilege';
    end if;

    order_id        := v_existing.id;
    order_number    := v_existing.order_number;
    items_subtotal  := v_existing.items_subtotal;
    shipping_amount := v_existing.shipping_amount;
    total_amount    := v_existing.total_amount;
    return next;
    return;
  end if;

  if p_email is null or p_email not like '%@%' then
    raise exception 'a checkout needs a contact address' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a checkout needs at least one article' using errcode = 'check_violation';
  end if;

  v_country := upper(coalesce(p_address ->> 'country_code', ''));
  if v_country <> 'DE' then
    raise exception 'SkyIsles delivers to Germany only' using errcode = 'check_violation';
  end if;

  select c.name into v_ship_name
    from public.shipping_catalog() c
   where c.code = p_shipping_method;

  if v_ship_name is null then
    raise exception 'unknown shipping method %', coalesce(p_shipping_method, '(null)')
      using errcode = 'check_violation';
  end if;

  v_client := public.request_client_hash();
  perform public.enforce_checkout_limits(p_email, v_user_id, v_client);

  -- -------------------------------------------------------------------------
  -- Pass 1 — resolve and price every position. Writes nothing.
  --
  -- Identical to what the loop always did, except that the line is kept
  -- instead of inserted: the order it belongs to does not exist yet.
  -- -------------------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_sky_id := v_item ->> 'sky_id';
    v_cond   := v_item ->> 'condition';
    v_qty    := nullif(v_item ->> 'quantity', '')::integer;

    if v_qty is null or v_qty < 1 or v_qty > public.max_cart_quantity() then
      raise exception 'invalid quantity for %', v_sky_id using errcode = 'check_violation';
    end if;

    select i.id,
           public.shop_price(i.sale_price, s.market_price, st.price_percentage),
           coalesce(s.display_name_override, s.name),
           coalesce(s.image_override_path, s.image_file)
      into v_inv_id, v_price, v_name, v_image
      from public.shop_inventory i
      join public.skylanders s on s.sky_id = i.sky_id
      cross join public.shop_settings st
     where i.sky_id = v_sky_id
       and i.condition = v_cond
       and i.is_listed
       and public.is_shop_eligible(i.sky_id);

    if v_inv_id is null or v_price is null then
      raise exception 'article % / % is not offered', v_sky_id, v_cond
        using errcode = 'no_data_found';
    end if;

    v_line_total := round(v_price * v_qty, 2);

    v_resolved := v_resolved || jsonb_build_object(
      'inventory_id', v_inv_id,
      'sky_id',       v_sky_id,
      'condition',    v_cond,
      'quantity',     v_qty,
      'name',         v_name,
      'image',        v_image,
      'unit_price',   v_price,
      'line_total',   v_line_total
    );

    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines + 1;
  end loop;

  if v_lines = 0 then
    raise exception 'a checkout needs at least one article' using errcode = 'check_violation';
  end if;

  v_shipping := public.shipping_amount_for(p_shipping_method, v_subtotal);

  -- -------------------------------------------------------------------------
  -- The order, with the amounts it will keep for ever.
  --
  -- This is the whole fix. `orders_protect_immutable()` sees one INSERT and
  -- no UPDATE, and `orders_total_is_the_sum` holds on the first row written:
  -- discount_amount defaults to 0, so total = subtotal + shipping - 0.
  -- -------------------------------------------------------------------------
  insert into public.orders
    (request_id, user_id, customer_email, client_hash,
     items_subtotal, shipping_amount, total_amount,
     shipping_method_code, shipping_method_name, payment_token_hash)
  values
    (p_request_id, v_user_id, p_email, v_client,
     v_subtotal, v_shipping, v_subtotal + v_shipping,
     p_shipping_method, v_ship_name, v_token_hash)
  returning id, orders.order_number into v_order_id, v_number;

  -- -------------------------------------------------------------------------
  -- Pass 2 — write the lines from pass 1's snapshots.
  --
  -- No lookup here, by design. Re-reading would risk pricing a line
  -- differently from the subtotal the order was just charged for.
  -- -------------------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(v_resolved)
  loop
    insert into public.order_lines
      (order_id, sky_id, condition, quantity, name_snapshot, image_snapshot,
       unit_price, line_total, inventory_id)
    values
      (v_order_id,
       v_item ->> 'sky_id',
       v_item ->> 'condition',
       (v_item ->> 'quantity')::integer,
       v_item ->> 'name',
       v_item ->> 'image',
       (v_item ->> 'unit_price')::numeric(10,2),
       (v_item ->> 'line_total')::numeric(10,2),
       (v_item ->> 'inventory_id')::bigint);
  end loop;

  insert into public.order_addresses
    (order_id, kind, first_name, last_name, company, street, house_number,
     address_line_2, postal_code, city, country_code, phone)
  values
    (v_order_id, 'shipping',
     p_address ->> 'first_name', p_address ->> 'last_name', p_address ->> 'company',
     p_address ->> 'street', p_address ->> 'house_number', p_address ->> 'address_line_2',
     p_address ->> 'postal_code', p_address ->> 'city',
     v_country, p_address ->> 'phone');

  perform public.reserve_for_order(v_order_id);

  -- No token, no hash and no fragment of either: an event is a record of what
  -- happened, not a place to leak a secret.
  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id)
  values (v_order_id, 'placed', case when v_user_id is null then 'system' else 'customer' end, v_user_id);

  order_id        := v_order_id;
  order_number    := v_number;
  items_subtotal  := v_subtotal;
  shipping_amount := v_shipping;
  total_amount    := v_subtotal + v_shipping;
  return next;
end;
$$;

comment on function public.create_order(text, text, jsonb, jsonb, text, text) is
  'Creates an order from a cart, stores the hash of the caller''s payment capability, and holds the stock — in one transaction. Every position is priced once, the amounts are final before the order row is written, and nothing updates them afterwards. Prices, shipping and availability come from the database; the caller names a shipping method and a capability, never an amount. A repeated request_id returns the same order only to a caller presenting the same capability. The token itself is never stored, returned or logged.';
