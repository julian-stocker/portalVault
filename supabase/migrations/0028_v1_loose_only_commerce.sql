-- ===========================================================================
-- 0028 - V1 sells loose figures, enforced at the database border
--
-- WHY
--
-- SkyIsles V1 supports LOOSE figures and nothing else: no condition to
-- choose, no OVP listing, no OVP navigation and no way to buy one. The
-- application now says so on every public surface - the catalogue card, the
-- availability filter, the quick view, the figure page, the shop grid and the
-- cart all resolve to one predicate (`v1BuyableOffers`, built on
-- `V1_CONDITION`).
--
-- That is a statement about what the product shows, not about what it will
-- accept. `shop_quantity_available()` and `create_order()` match whatever
-- condition the caller names, and both are reachable over PostgREST with the
-- anon key - so a request built outside this application could still buy a
-- boxed position: real stock, at a real price, through a purchase the product
-- does not offer. Hiding something is not refusing it.
--
-- WHAT THIS IS NOT
--
-- Not a data model change. `shop_inventory.condition` keeps both values, its
-- CHECK constraint is untouched, no row is read or written by this migration,
-- and every boxed position stays exactly as it is - which is the point: OVP
-- is a product we have not designed yet, and its data has to survive until we
-- do. `order_lines.condition` keeps both values too, so historical boxed
-- orders stay readable.
--
-- Not a widening of anybody's rights either. Both functions are replaced with
-- their own current definitions plus one rule, and both grants are re-stated
-- verbatim below so the privileges are visible rather than inherited.
--
-- WHICH DEFINITIONS THIS REPLACES
--
--   shop_quantity_available(text, text, integer)         - 0009, unchanged since
--   create_order(text, text, jsonb, jsonb, text, text)   - 0021, the current one
--
-- The six-argument `create_order` is the only one. The five-argument shim was
-- dropped in 0014 and is deliberately NOT re-created here: `create or replace`
-- on a different argument list would not replace anything, it would resurrect
-- the legacy overload and leave PostgREST with two candidates.
--
-- ATOMICITY
--
-- `create_order()` resolves and prices every position in pass 1, which writes
-- nothing, and only then inserts the order, its lines, its address, its
-- reservation and its event. The new check raises inside pass 1, so at the
-- moment a boxed line is rejected there is nothing to roll back - and even if
-- there were, the exception propagates out of a plpgsql function running in
-- the caller's transaction, which aborts it whole. A mixed request of one
-- loose and one boxed article therefore leaves no order, no line, no address,
-- no event, no inventory movement and no change to `reserved`.
--
-- ROLLBACK
--
-- Re-apply `shop_quantity_available` from 0009 and `create_order` from 0021,
-- then drop `v1_sale_condition()`. Nothing else is touched, so there is
-- nothing else to undo.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The condition V1 sells, written once
--
-- The application has `V1_CONDITION` in `lib/shop/offer.ts`; this is its
-- counterpart, so the two rules below cannot drift apart from each other, and
-- a test can hold both against the application's value.
--
-- `immutable`, so the planner may fold it into a predicate. Granted to
-- nobody: both callers are `security definer` and execute as the owner, so no
-- client ever needs the right to call this directly.
-- ---------------------------------------------------------------------------
create or replace function public.v1_sale_condition()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'loose'::text
$$;

comment on function public.v1_sale_condition() is
  'The one condition SkyIsles V1 sells (0028). Mirrors V1_CONDITION in the application. boxed remains a valid stock condition and a valid value of shop_inventory.condition and order_lines.condition - it is simply not sold. Granted to nobody: only security definer functions call it.';

revoke all on function public.v1_sale_condition() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 1. "Could this be bought right now?" - now answers no for boxed
--
-- The definition below is the one from 0009, unchanged except for the single
-- added predicate. Same signature, same `stable` sql function, same boolean
-- contract: a condition this shop does not sell is not buyable, which is the
-- answer the function already gives for a sold-out, unlisted or unpriced
-- position. No count is published either way.
-- ---------------------------------------------------------------------------
create or replace function public.shop_quantity_available(
  p_sky_id    text,
  p_condition text,
  p_quantity  integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_quantity is not null
    and p_quantity >= 1
    and p_quantity <= public.max_cart_quantity()
    and exists (
      select 1
        from public.shop_inventory i
        join public.skylanders s on s.sky_id = i.sky_id
        cross join public.shop_settings st
       where i.sky_id    = p_sky_id
         and i.condition = p_condition
         -- V1 sells loose only (0028). A boxed position is real stock and
         -- stays in the table; it is simply not something this shop sells,
         -- so the honest answer is the same `false` a sold-out position
         -- already gets. No new error semantics for a boolean function.
         and i.condition = public.v1_sale_condition()
         and i.is_listed
         and public.is_shop_eligible(i.sky_id)
         -- Something without a price is not an offer, however released it is.
         and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
         -- The whole point. `available_quantity` is `quantity - reserved`,
         -- generated by the table (0003) — one definition, compared here,
         -- never returned.
         and i.available_quantity >= p_quantity
    );
$$;
comment on function public.shop_quantity_available(text, text, integer) is
  'Whether this article, in this condition, could be bought in this quantity right now: eligible, listed, priced, in stock - and in the one condition V1 sells (0028). Returns a boolean and never a count; no stock level is published. Reserves nothing and writes nothing.';


-- ---------------------------------------------------------------------------
-- 2. Ordering - a boxed line is refused, and refuses the whole order
--
-- The definition below is the one from 0021, unchanged except for the single
-- added validation in pass 1. The commerce-mode gate, the capability hash,
-- the idempotent retry, the two-pass pricing and the immutable amounts are
-- all carried over exactly as they stand.
-- ---------------------------------------------------------------------------
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

  -- Which world this order belongs to, read once and stamped on the row.
  v_mode text := public.commerce_mode();
begin
  -- ---------------------------------------------------------------------------
  -- Before anything else, including the shape checks: may this caller buy?
  --
  -- The gate is here rather than in the server action because this function is
  -- reachable over PostgREST with the anon key. A check in TypeScript would be
  -- one request away from being skipped; this one cannot be.
  --
  -- Deliberately the same refusal for all three reasons — closed, not signed
  -- in, not a tester. A caller learns that they may not check out, not why,
  -- and not that a sandbox exists.
  -- ---------------------------------------------------------------------------
  if not public.commerce_checkout_allowed() then
    raise exception 'checkout is not open to this caller'
      using errcode = 'insufficient_privilege';
  end if;

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

    -- V1 SELLS LOOSE ONLY (0028).
    --
    -- Validated explicitly rather than left to the lookup below. Without this,
    -- a boxed line would fall through to `article % / % is not offered`, which
    -- is misleading: the position exists, is listed, is eligible and is
    -- priced. What is wrong is the request, so it is refused the way every
    -- other unacceptable argument to this function is refused -- the same
    -- errcode an invalid quantity raises, which the application already maps
    -- to the same outcome (`UNAVAILABLE` in lib/commerce/actions.ts).
    --
    -- Placed in pass 1, which writes nothing: no order row exists yet, no
    -- line, no address, no reservation. See the header on atomicity.
    if v_cond is distinct from public.v1_sale_condition() then
      raise exception 'condition % is not offered', coalesce(v_cond, '(null)')
        using errcode = 'check_violation';
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
    (request_id, user_id, customer_email, client_hash, commerce_mode,
     items_subtotal, shipping_amount, total_amount,
     shipping_method_code, shipping_method_name, payment_token_hash)
  values
    (p_request_id, v_user_id, p_email, v_client, v_mode,
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
  'Creates an order from a cart, stores the hash of the caller''''s payment capability, and holds the stock — in one transaction. Refuses outright unless commerce_checkout_allowed() says this caller may buy, and stamps the mode it was told onto the order. Every position is priced once, the amounts are final before the order row is written, and nothing updates them afterwards. Since 0028 a line whose condition is not the one V1 sells is refused in pass 1, before anything is written, so a mixed request leaves no order behind.';


-- ---------------------------------------------------------------------------
-- 3. Privileges - re-stated, not widened
--
-- `create or replace` keeps an existing function's ACL, so these two pairs
-- already hold and are written out rather than assumed: a privilege nobody
-- can see in the migration is a privilege nobody reviews. They are character
-- for character the pairs from 0009 and 0021.
--
-- `v1_sale_condition()` is genuinely new, and PostgreSQL grants EXECUTE to
-- PUBLIC on a new function - which is why its own REVOKE is above, next to
-- its definition.
-- ---------------------------------------------------------------------------
revoke all on function public.shop_quantity_available(text, text, integer) from public;
grant execute on function public.shop_quantity_available(text, text, integer) to anon, authenticated;

revoke all on function public.create_order(text, text, jsonb, jsonb, text, text) from public;
grant execute on function public.create_order(text, text, jsonb, jsonb, text, text) to anon, authenticated;
