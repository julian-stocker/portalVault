-- ===========================================================================
-- 0011 — what a checkout has to decide: shipping, and under which tax rules
--
-- Phase B1. Two facts an order could not yet record, one place that decides
-- them, and nothing else. No payment, no provider, no invoice, no mail.
--
-- 1. WHICH TAX RULES APPLIED
--
-- SkyIsles is operated under the German small-business scheme (§ 19 UStG): no
-- VAT is levied, no VAT is shown, and the price is the price.
--
-- This is deliberately NOT modelled as `tax_rate = 0`. A zero rate means "a
-- taxable transaction, taxed at zero"; § 19 means the tax is not levied at
-- all. The difference is invisible in arithmetic and decisive on paper — a
-- zero rate would produce an invoice with a 0,00 € VAT line and an accounting
-- export with a tax column that must not exist. So the column holds a regime,
-- never a percentage.
--
-- It is snapshotted per order and frozen, because the regime is a property of
-- the moment of sale. The § 19 scheme has revenue limits; a shop that grows
-- out of them switches, and every order placed before that switch stays a
-- § 19 order. Deriving it later from a date would be exactly the retroactive
-- reconstruction ADR-0033 and ADR-0049 exist to prevent.
--
-- 2. HOW IT SHIPS
--
-- Two methods, Germany only, one flat price each, free above a threshold on
-- the goods value. That is the whole rule, and it lives here rather than in
-- the interface: the browser may choose a method, never a price.
--
-- The order keeps the code AND the display name. The name is a snapshot for
-- the same reason a line keeps `name_snapshot` — renaming a carrier must not
-- rewrite what a customer was told they were buying.
--
-- ADDITIVE. No existing table is altered beyond two new nullable-safe columns
-- on `orders`; no data is touched. `create_order` is dropped and recreated
-- because a function's argument list cannot be extended in place — the same
-- step 0007 took, for the same reason.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The tax regime, as a name rather than a number
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists tax_regime text not null default 'small_business_19';

alter table public.orders
  drop constraint if exists orders_tax_regime_known;

alter table public.orders
  add constraint orders_tax_regime_known
    check (tax_regime in ('small_business_19'));

comment on column public.orders.tax_regime is
  'Which tax rules applied when this order was placed. small_business_19 = German small-business scheme (§ 19 UStG): no VAT levied, none shown. Deliberately a regime and never a rate — a 0 % rate is a different thing and would produce a VAT line that must not exist. Frozen after insert.';

-- A CHECK rather than an enum, as everywhere else in this schema: adding
-- `standard_rate` or `margin_scheme_25a` later is a constraint swap, while an
-- enum value can never be removed again.


-- ---------------------------------------------------------------------------
-- 2. How the order shipped
--
-- Both columns, not just the code. `shipping_amount` already exists and keeps
-- what was actually charged — including 0,00 € when the order crossed the
-- free-shipping threshold. The method is recorded even then: "Hermes, free"
-- is what happened, and "free shipping" is not a carrier.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists shipping_method_code text,
  add column if not exists shipping_method_name text;

alter table public.orders
  drop constraint if exists orders_shipping_method_known;

alter table public.orders
  add constraint orders_shipping_method_known
    check (shipping_method_code is null or shipping_method_code in ('hermes', 'dhl'));

alter table public.orders
  drop constraint if exists orders_shipping_method_complete;

-- A code without a name would let a later rename rewrite history; a name
-- without a code would leave nothing to match on.
alter table public.orders
  add constraint orders_shipping_method_complete
    check ((shipping_method_code is null) = (shipping_method_name is null));

comment on column public.orders.shipping_method_code is
  'The carrier the customer chose, as a stable identifier. Nullable only so the column could be added to a table that already existed; every order created since carries one.';
comment on column public.orders.shipping_method_name is
  'The carrier''s name as it was shown at checkout. A snapshot: renaming a carrier must not rewrite what a customer was told.';


-- ---------------------------------------------------------------------------
-- 3. The shipping rule, in one place
--
-- Deliberately three small functions rather than a table:
--
--   * two methods and one threshold is a rule, not data. A table would add
--     RLS, grants and a mutable row that could silently change a live price.
--   * changing a price is then a migration — which is the right weight for a
--     change that alters what customers are charged.
--
-- The catalog is the single source both the interface and `create_order` read,
-- so a displayed price and a charged price cannot disagree.
-- ---------------------------------------------------------------------------
create or replace function public.free_shipping_threshold()
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 75.00::numeric;
$$;

comment on function public.free_shipping_threshold() is
  'Goods value from which shipping is free, measured on items_subtotal — before any discount, which is the only figure that exists today and the one a customer can verify in their basket.';


create or replace function public.shipping_catalog()
returns table (code text, name text, base_price numeric, sort_order integer)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('hermes', 'Hermes', 5.49::numeric, 1),
    ('dhl',    'DHL',    6.49::numeric, 2)
  ) as t(code, name, base_price, sort_order);
$$;

comment on function public.shipping_catalog() is
  'The shipping methods V1 offers, Germany only. Hermes is first and is the default at checkout.';


-- What this method actually costs for this goods value. Raises on anything
-- else: an unknown method is a bad request, not a free delivery.
create or replace function public.shipping_amount_for(
  p_code            text,
  p_items_subtotal  numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base numeric;
begin
  select c.base_price into v_base
    from public.shipping_catalog() c
   where c.code = p_code;

  if v_base is null then
    raise exception 'unknown shipping method %', coalesce(p_code, '(null)')
      using errcode = 'check_violation';
  end if;

  if p_items_subtotal is null or p_items_subtotal < 0 then
    raise exception 'a shipping quote needs a goods value'
      using errcode = 'check_violation';
  end if;

  -- At or above the threshold, both methods are free. The method is still the
  -- method — only its price changed.
  if p_items_subtotal >= public.free_shipping_threshold() then
    return 0.00;
  end if;

  return v_base;
end;
$$;

comment on function public.shipping_amount_for(text, numeric) is
  'The authoritative shipping charge for one method and one goods value. The only place the rule exists: create_order() charges what this returns, and the checkout displays what this returns.';


-- What the checkout renders: every method with the price this basket would
-- actually pay. One call, and it cannot drift from what is charged.
-- SECURITY DEFINER for the same reason `shop_offers()` is: this is the public
-- face of two functions no client may call. An INVOKER function would run the
-- inner `shipping_catalog()` and `shipping_amount_for()` as the caller and be
-- refused — which is exactly what happened when 0011 was first applied.
create or replace function public.shipping_quote(p_items_subtotal numeric)
returns table (code text, name text, amount numeric, is_default boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.code,
    c.name,
    public.shipping_amount_for(c.code, greatest(coalesce(p_items_subtotal, 0), 0)),
    (c.sort_order = 1)
  from public.shipping_catalog() c
  order by c.sort_order;
$$;

comment on function public.shipping_quote(numeric) is
  'Every shipping method with the price this basket would pay, in display order. Public: shipping prices are public information. The charged price comes from the same function, so the two cannot disagree.';

revoke all on function public.free_shipping_threshold()          from public, anon, authenticated;
revoke all on function public.shipping_catalog()                 from public, anon, authenticated;
revoke all on function public.shipping_amount_for(text, numeric) from public, anon, authenticated;
revoke all on function public.shipping_quote(numeric)            from public, anon, authenticated;

-- Only the display projection is public. The pieces behind it stay internal,
-- so there is exactly one shape a client can ask for.
grant execute on function public.shipping_quote(numeric) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. The new facts are frozen too
--
-- Replaces the trigger function from 0010 in place — same name, same
-- signature, so the trigger itself is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.orders_protect_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_number   is distinct from old.order_number
     or new.request_id  is distinct from old.request_id
     or new.placed_at   is distinct from old.placed_at
     or new.currency    is distinct from old.currency
     or new.customer_email  is distinct from old.customer_email
     or new.items_subtotal  is distinct from old.items_subtotal
     or new.shipping_amount is distinct from old.shipping_amount
     or new.discount_amount is distinct from old.discount_amount
     or new.total_amount    is distinct from old.total_amount
     -- Since 0011: what was charged and under which rules is as fixed as the
     -- amount itself. An invoice has to be reproducible from these.
     or new.tax_regime           is distinct from old.tax_regime
     or new.shipping_method_code is distinct from old.shipping_method_code
     or new.shipping_method_name is distinct from old.shipping_method_name then
    raise exception 'an order''s identity and amounts are immutable'
      using errcode = 'restrict_violation';
  end if;

  -- The one permitted change: a deleted account releases its order.
  if new.user_id is distinct from old.user_id and new.user_id is not null then
    raise exception 'an order cannot be reassigned to another account'
      using errcode = 'restrict_violation';
  end if;

  -- The abuse fingerprint may only ever be cleared, never set or rewritten.
  if new.client_hash is distinct from old.client_hash and new.client_hash is not null then
    raise exception 'the client fingerprint cannot be changed, only cleared'
      using errcode = 'restrict_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. create_order(), now with a shipping method
--
-- Dropped and recreated: PostgreSQL cannot extend a function's argument list
-- in place, and an overload would leave the old four-argument version callable
-- — an order without shipping. 0007 took the same step for the same reason.
--
-- WHAT THE CALLER MAY STILL NOT SAY
--
-- Unchanged from 0010, and now one item longer: no price, no subtotal, no
-- total, no discount, **no shipping amount**. The caller names a method; this
-- function decides what it costs. Choosing DHL and sending 0,00 € changes
-- nothing, because there is no parameter to send it in.
--
-- GERMANY ONLY
--
-- V1 ships to Germany. The country is validated here rather than left to the
-- form: a checkout that posts `country_code: "CH"` is refused, not quietly
-- charged German postage.
-- ---------------------------------------------------------------------------
drop function if exists public.create_order(text, text, jsonb, jsonb);

create or replace function public.create_order(
  p_request_id      text,
  p_email           text,
  p_items           jsonb,
  p_address         jsonb,
  p_shipping_method text
)
-- Returns the amounts as well as the number, because the caller cannot read
-- them back: a guest order has no auth.uid() and is therefore unreadable by
-- any client until the token view exists. Handing the confirmed figures back
-- from the transaction that decided them is both simpler and more honest than
-- letting the browser display its own arithmetic.
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
  v_subtotal numeric(10,2) := 0;
  v_lines    integer := 0;
  v_client   text;
  v_country  text;
  v_ship_name text;
  v_shipping numeric(10,2);
begin
  if p_request_id is null or length(p_request_id) < 8 then
    raise exception 'a checkout needs a request id' using errcode = 'check_violation';
  end if;

  -- Already done. Hand back the same order rather than making a second one.
  select o.id, o.order_number, o.items_subtotal, o.shipping_amount, o.total_amount
    into v_order_id, v_number, items_subtotal, shipping_amount, total_amount
    from public.orders o
   where o.request_id = p_request_id;
  if found then
    order_id := v_order_id;
    order_number := v_number;
    return next;
    return;
  end if;

  if p_email is null or p_email not like '%@%' then
    raise exception 'a checkout needs a contact address' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a checkout needs at least one article' using errcode = 'check_violation';
  end if;

  -- Germany only in V1. Checked before anything is written.
  v_country := upper(coalesce(p_address ->> 'country_code', ''));
  if v_country <> 'DE' then
    raise exception 'SkyIsles delivers to Germany only' using errcode = 'check_violation';
  end if;

  -- The method has to exist. The price it implies is decided further down,
  -- once the goods value is known.
  select c.name into v_ship_name
    from public.shipping_catalog() c
   where c.code = p_shipping_method;

  if v_ship_name is null then
    raise exception 'unknown shipping method %', coalesce(p_shipping_method, '(null)')
      using errcode = 'check_violation';
  end if;

  v_client := public.request_client_hash();
  perform public.enforce_checkout_limits(p_email, v_user_id, v_client);

  insert into public.orders
    (request_id, user_id, customer_email, client_hash, items_subtotal, total_amount,
     shipping_method_code, shipping_method_name)
  values
    (p_request_id, v_user_id, p_email, v_client, 0, 0,
     p_shipping_method, v_ship_name)
  returning id, orders.order_number into v_order_id, v_number;

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

    insert into public.order_lines
      (order_id, sky_id, condition, quantity, name_snapshot, image_snapshot,
       unit_price, line_total, inventory_id)
    values
      (v_order_id, v_sky_id, v_cond, v_qty, v_name, v_image,
       v_price, round(v_price * v_qty, 2), v_inv_id);

    v_subtotal := v_subtotal + round(v_price * v_qty, 2);
    v_lines := v_lines + 1;
  end loop;

  if v_lines = 0 then
    raise exception 'a checkout needs at least one article' using errcode = 'check_violation';
  end if;

  -- Now the goods value is known, so the shipping charge is decided — by the
  -- one function that decides it, from a figure the caller never supplied.
  v_shipping := public.shipping_amount_for(p_shipping_method, v_subtotal);

  update public.orders
     set items_subtotal  = v_subtotal,
         shipping_amount = v_shipping,
         total_amount    = v_subtotal + v_shipping
   where id = v_order_id;

  insert into public.order_addresses
    (order_id, kind, first_name, last_name, company, street, house_number,
     address_line_2, postal_code, city, country_code, phone)
  values
    (v_order_id, 'shipping',
     p_address ->> 'first_name', p_address ->> 'last_name', p_address ->> 'company',
     p_address ->> 'street', p_address ->> 'house_number', p_address ->> 'address_line_2',
     p_address ->> 'postal_code', p_address ->> 'city',
     v_country, p_address ->> 'phone');

  -- All of it or none of it. A failure here rolls back the order too.
  perform public.reserve_for_order(v_order_id);

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

comment on function public.create_order(text, text, jsonb, jsonb, text) is
  'Creates an order from a cart and holds its stock, in one transaction. Prices, the shipping charge and availability are read from the database; the caller names a shipping method but never its price, and nothing it says about money is used. Germany only. Works for guests (auth.uid() may be NULL). Idempotent through request_id.';

revoke all on function public.create_order(text, text, jsonb, jsonb, text) from public;
grant execute on function public.create_order(text, text, jsonb, jsonb, text) to anon, authenticated;
