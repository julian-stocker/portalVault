-- ===========================================================================
-- 0018 — Admin Orders V1: seeing an order, and shipping it
--
-- Before money may be taken in production, the operator has to be able to see
-- a paid order and act on it. Today they cannot: `0010` revokes every commerce
-- table from every client role and grants `select` back only through
-- `*_select_own`, so the administrator — an ordinary `authenticated` user —
-- sees their own orders and nothing else. `order_events` and
-- `order_reservations` carry no client privilege at all, and `0010` said what
-- was meant to happen: "The administrator reads them through a function."
--
-- This is that function, plus the one write that fulfilment needs.
--
-- WHAT THIS MIGRATION DOES NOT TOUCH
--
-- No inventory, no reservation, no payment column, no `needs_resolution`.
-- Shipping is logistics: the sale was booked when `confirm_order_payment()`
-- converted the reservation, and marking a parcel as gone changes nothing
-- about stock or money.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Two columns' worth of schema
--
-- `tracking_number` is stored raw, exactly as the carrier issued it. No format
-- validation: DHL, Hermes, DPD and the rest disagree, and a check that knows
-- one of them would reject the others. Only three things are enforced —
-- non-empty, no surrounding whitespace (so the trimmed form is the stored
-- form, not a convention), and a ceiling no real carrier approaches.
--
-- It is also meaningless on an order that has not shipped, so the constraint
-- says so rather than leaving it to the caller.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists tracking_number text;

alter table public.orders
  drop constraint if exists orders_tracking_number_shape;
alter table public.orders
  add constraint orders_tracking_number_shape
  check (
    tracking_number is null
    or (
      length(tracking_number) between 1 and 64
      and tracking_number = btrim(tracking_number)
      and fulfillment_status <> 'unfulfilled'
    )
  );

-- `paid_at` has been tied to `payment_status` since 0010. `shipped_at` was
-- not tied to anything, which was harmless only because nothing wrote it.
alter table public.orders
  drop constraint if exists orders_shipped_at_consistent;
alter table public.orders
  add constraint orders_shipped_at_consistent
  check (shipped_at is null or fulfillment_status <> 'unfulfilled');


-- ---------------------------------------------------------------------------
-- 2. The fulfilment guard — defence in depth, not the business rule
--
-- `admin_mark_order_shipped()` below checks everything that matters: the
-- caller is an administrator, the order is paid, it is not flagged for a
-- human, and it has not shipped already. This trigger checks **none** of that
-- and is not meant to. It answers one narrower question that must hold no
-- matter who writes: **is this a state change the machine allows at all?**
--
-- Nothing in the database writes `fulfillment_status` today — verified across
-- every migration before this one was written. `confirm_order_payment()`,
-- `expire_stale_checkouts()` and `fail_payment_attempt()` touch
-- `payment_status` only, so this breaks no existing payment, expiry or
-- cleanup path. The trigger exists precisely so the *next* writer cannot
-- quietly introduce a transition nobody designed.
--
-- IT OWNS `shipped_at`
--
-- The timestamp is set here rather than by the caller, so "the client never
-- supplies a shipping date" is structural instead of a convention. Every
-- other update carries the old value forward untouched.
--
-- IT REFUSES TO LET FULFILMENT TOUCH `needs_resolution`
--
-- Narrowly: `needs_resolution` may still change — `confirm_order_payment()`
-- sets it, and a future resolution flow must be able to clear it. What may
-- not happen is both changing in one statement, which is how a flag that
-- means "a human must look at this" gets cleared as a side effect of pressing
-- a shipping button.
-- ---------------------------------------------------------------------------
create or replace function public.orders_protect_fulfillment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_changed boolean := new.fulfillment_status is distinct from old.fulfillment_status;
begin
  if v_changed then
    -- V1 designs exactly one transition. `preparing`, `completed` and
    -- `cancelled` exist in the CHECK and have no workflow behind them yet;
    -- allowing them here would mean allowing states nothing can leave.
    if not (old.fulfillment_status = 'unfulfilled' and new.fulfillment_status = 'shipped') then
      raise exception 'fulfillment cannot go from % to %', old.fulfillment_status, new.fulfillment_status
        using errcode = 'restrict_violation';
    end if;

    if new.needs_resolution is distinct from old.needs_resolution then
      raise exception 'fulfillment must not change needs_resolution'
        using errcode = 'restrict_violation';
    end if;

    -- Server time, always. Whatever the caller passed is discarded.
    new.shipped_at := now();
  else
    -- No transition: neither of these may drift.
    new.shipped_at := old.shipped_at;

    if new.tracking_number is distinct from old.tracking_number then
      raise exception 'a tracking number is recorded with the shipment, not edited afterwards'
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.orders_protect_fulfillment() is
  'Allows exactly one fulfilment transition, unfulfilled -> shipped, sets shipped_at from the server clock, refuses a tracking number outside that transition, and refuses to let fulfilment change needs_resolution. Defence in depth: the business rules live in admin_mark_order_shipped().';

drop trigger if exists orders_fulfillment_guard on public.orders;
create trigger orders_fulfillment_guard
  before update on public.orders
  for each row execute function public.orders_protect_fulfillment();

revoke all on function public.orders_protect_fulfillment()
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. admin_orders() — the list
--
-- Ordered by how much attention a row needs, not by date: an order that needs
-- a human comes first, then money that is waiting to be sent, then everything
-- else. The operator opens this page to find work, and the work is at the top.
--
-- `client_hash` and `payment_token_hash` are deliberately absent here and in
-- every projection below. They are abuse and authorisation internals with no
-- operational use, and the fewer places they exist, the better.
-- ---------------------------------------------------------------------------
create or replace function public.admin_orders(
  p_open_only boolean default false,
  p_limit     integer default 100,
  p_offset    integer default 0
)
returns table (
  order_number       text,
  placed_at          timestamptz,
  payment_status     text,
  fulfillment_status text,
  needs_resolution   boolean,
  total_amount       numeric,
  line_count         integer,
  customer_email     text,
  attention          integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    with ranked as (
      -- The attention rule, written once. Two copies — one to return and one
      -- to sort by — is two things that must agree and eventually will not.
      select o.*,
             case
               when o.needs_resolution then 0                                 -- a human is required
               when o.payment_status = 'paid'
                and o.fulfillment_status = 'unfulfilled' then 1               -- paid, not sent
               when o.payment_status = 'pending' then 2                       -- still in flight
               else 3                                                         -- settled or closed
             end as attention
        from public.orders o
    )
    select r.order_number,
           r.placed_at,
           r.payment_status,
           r.fulfillment_status,
           r.needs_resolution,
           r.total_amount,
           (select count(*)::integer from public.order_lines l where l.order_id = r.id),
           r.customer_email,
           r.attention
      from ranked r
     where not p_open_only or r.attention <= 1
     order by r.attention, r.placed_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

comment on function public.admin_orders(boolean, integer, integer) is
  'The order list for the administrator, ordered by how much attention each row needs: flagged first, then paid-and-unsent, then pending, then settled. Never returns the abuse fingerprint or the payment capability hash.';

revoke all on function public.admin_orders(boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_orders(boolean, integer, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. admin_order() — one order, as one document
--
-- Header, address, lines and journal in a single `jsonb` result and a single
-- round trip. Four typed functions would be four grants, four tests and four
-- places to drift; `jsonb` is already how `create_order()` carries its
-- snapshots and how `order_events` stores its payload, so this is the shape
-- the schema already speaks.
-- ---------------------------------------------------------------------------
create or replace function public.admin_order(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_result jsonb;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select o.* into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'order', jsonb_build_object(
      'order_number',       v_order.order_number,
      'placed_at',          v_order.placed_at,
      'paid_at',            v_order.paid_at,
      'shipped_at',         v_order.shipped_at,
      'payment_status',     v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status,
      'needs_resolution',   v_order.needs_resolution,
      'customer_email',     v_order.customer_email,
      'items_subtotal',     v_order.items_subtotal,
      'shipping_amount',    v_order.shipping_amount,
      'discount_amount',    v_order.discount_amount,
      'total_amount',       v_order.total_amount,
      'shipping_method',    v_order.shipping_method_name,
      'tracking_number',    v_order.tracking_number,
      'is_guest',           v_order.user_id is null
    ),
    'address', (
      select jsonb_build_object(
               'first_name', a.first_name, 'last_name', a.last_name,
               'company', a.company, 'street', a.street,
               'house_number', a.house_number, 'address_line_2', a.address_line_2,
               'postal_code', a.postal_code, 'city', a.city,
               'country_code', a.country_code, 'phone', a.phone)
        from public.order_addresses a
       where a.order_id = v_order.id
       limit 1
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sky_id', l.sky_id, 'condition', l.condition,
               'name', l.name_snapshot, 'quantity', l.quantity,
               'unit_price', l.unit_price, 'line_total', l.line_total)
               order by l.id)
        from public.order_lines l
       where l.order_id = v_order.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_type', e.event_type, 'actor_kind', e.actor_kind,
               'created_at', e.created_at, 'payload', e.payload)
               order by e.id)
        from public.order_events e
       where e.order_id = v_order.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.admin_order(text) is
  'One order for the administrator as a single document: header, shipping address, immutable lines and the event journal. NULL when there is no such order. Never returns the abuse fingerprint, the payment capability hash or any internal id.';

revoke all on function public.admin_order(text) from public, anon, authenticated;
grant execute on function public.admin_order(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. admin_mark_order_shipped() — the only write fulfilment needs
--
-- Four refusals, and the third is the one that matters:
--
--   not an administrator     the same predicate every editorial write uses
--   not paid                 shipping an unpaid order gives goods away
--   needs_resolution         paid, but nothing was converted and no stock was
--                            booked (ADR-0050). Shipping it would hand over
--                            goods the ledger still counts as present.
--   already shipped          fulfilment runs forward once
--
-- `needs_resolution` is a BLOCK here, never a flag this function clears. Such
-- an order needs a person to decide between restocking and refunding, and V1
-- has neither — so it stops, visibly, rather than being sent by accident.
--
-- WRITES NOTHING ELSE. No inventory movement, no reservation, no payment
-- column. The sale was booked at confirmation; this records that a parcel
-- left.
-- ---------------------------------------------------------------------------
create or replace function public.admin_mark_order_shipped(
  p_order_number    text,
  p_tracking_number text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    record;
  v_tracking text;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- Surrounding whitespace is a paste artefact, not part of the number. This
  -- is not the name rule from CLAUDE.md: that protects article and category
  -- names from being "corrected"; a carrier reference has no such meaning.
  v_tracking := nullif(btrim(coalesce(p_tracking_number, '')), '');
  if v_tracking is not null and length(v_tracking) > 64 then
    raise exception 'a tracking number of % characters is not plausible', length(v_tracking)
      using errcode = 'check_violation';
  end if;

  select o.* into v_order
    from public.orders o
   where o.order_number = p_order_number
     for update;

  if not found then
    raise exception 'unknown order %', p_order_number using errcode = 'no_data_found';
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'order % is %, and only a paid order may be shipped',
      v_order.order_number, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  if v_order.needs_resolution then
    raise exception 'order % needs to be looked at before it can be shipped',
      v_order.order_number
      using errcode = 'check_violation';
  end if;

  if v_order.fulfillment_status <> 'unfulfilled' then
    raise exception 'order % is already %', v_order.order_number, v_order.fulfillment_status
      using errcode = 'check_violation';
  end if;

  -- `shipped_at` is deliberately absent: the trigger sets it from the server
  -- clock, so no caller can name a shipping date.
  update public.orders
     set fulfillment_status = 'shipped',
         tracking_number    = v_tracking
   where id = v_order.id;

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order.id, 'order_shipped', 'admin', (select auth.uid()),
          case when v_tracking is null then '{}'::jsonb
               else jsonb_build_object('has_tracking', true) end);

  return 'shipped';
end;
$$;

comment on function public.admin_mark_order_shipped(text, text) is
  'Marks a paid, unflagged, unshipped order as shipped and records an order_shipped event with the administrator as actor. Refuses an unpaid order and refuses one that needs resolution; never clears that flag. Writes no inventory movement, no reservation and no payment column.';

revoke all on function public.admin_mark_order_shipped(text, text)
  from public, anon, authenticated;
grant execute on function public.admin_mark_order_shipped(text, text) to authenticated;
