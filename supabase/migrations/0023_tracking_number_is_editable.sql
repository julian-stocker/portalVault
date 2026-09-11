-- ===========================================================================
-- 0023 — a tracking number is a fact about a parcel, not a property of an event
--
-- WHAT WENT WRONG
--
-- `0018` welded the two together. Two rules did it:
--
--   1. the CHECK `orders_tracking_number_shape` required
--      `fulfillment_status <> 'unfulfilled'`, so a tracking number could not
--      exist on an order that had not shipped yet;
--   2. `orders_protect_fulfillment()` raised on any change to
--      `tracking_number` outside the one `unfulfilled -> shipped` transition,
--      so once written it could never be corrected.
--
-- Together: a number could only be recorded at the exact moment of shipping,
-- and never again.
--
-- THE REAL WORKFLOW, WHICH THAT FORBIDS
--
-- The operator buys a shipping label first, records its number, and marks the
-- order shipped later — sometimes the next day. Occasionally a label is
-- cancelled and replaced, which means the number on a shipped order is now
-- wrong and must be corrected. Neither was possible.
--
-- THE MODEL
--
-- Two independent states.
--
--   fulfillment_status   has it gone?        one transition, still guarded
--   tracking_number      which parcel is it?  editable, before and after
--
-- WHAT DOES NOT CHANGE
--
-- `shipped_at` still comes from the server clock and only at the transition;
-- editing a number never moves it. Fulfilment still runs `unfulfilled ->
-- shipped` and nothing else. Fulfilment still may not touch
-- `needs_resolution`. The order's identity, amounts and address remain frozen
-- by `orders_protect_immutable()` and the append-only triggers — none of
-- which this migration touches.
--
-- And a correction sends **no mail**. `send-order-mail` is reached from
-- `admin_mark_order_shipped()`'s caller, never from here; `order_mail`'s
-- primary key would refuse a second `shipping_confirmation` anyway, and
-- `sent` is terminal even against `force` (ADR-0059). Three reasons, and the
-- first one is that this function does not call it.
-- ===========================================================================


-- ===========================================================================
-- 1. A number may exist before the parcel does
--
-- The shape rule keeps what it was for — a plausible, trimmed reference — and
-- drops the clause that tied it to a state.
-- ===========================================================================

alter table public.orders
  drop constraint if exists orders_tracking_number_shape;

alter table public.orders
  add constraint orders_tracking_number_shape
  check (
    tracking_number is null
    or (
      length(tracking_number) between 1 and 64
      and tracking_number = btrim(tracking_number)
    )
  );

comment on column public.orders.tracking_number is
  'The carrier reference, stored raw. Independent of fulfillment_status since 0023: it may be recorded before the parcel goes and corrected afterwards, and doing so never moves shipped_at (ADR-0062).';


-- ===========================================================================
-- 2. The fulfilment guard stops guarding something that is not fulfilment
--
-- Everything it did about fulfilment is unchanged, line for line. The only
-- removal is the refusal to let `tracking_number` differ outside the
-- transition — which was never a fulfilment rule, it was a second rule
-- wearing the same coat.
-- ===========================================================================

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
    -- No transition. `shipped_at` still may not drift: a correction to the
    -- parcel reference is not a second shipment, and the date a thing went
    -- out is not something an edit gets to move.
    new.shipped_at := old.shipped_at;
  end if;

  return new;
end;
$$;

comment on function public.orders_protect_fulfillment() is
  'Allows exactly one fulfilment transition, unfulfilled -> shipped, sets shipped_at from the server clock and freezes it outside that transition, and refuses to let fulfilment change needs_resolution. Since 0023 it says nothing about tracking_number, which is a separate state (ADR-0062).';


-- ===========================================================================
-- 3. Recording and correcting the number
--
-- Its own function, because it is its own action. Folding it into
-- `admin_mark_order_shipped()` would mean an operator could only correct a
-- number by pretending to ship again.
-- ===========================================================================

create or replace function public.admin_set_tracking_number(
  p_order_number    text,
  p_tracking_number text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    record;
  v_tracking text;
  v_before   text;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- Surrounding whitespace is a paste artefact, not part of the number. The
  -- same rule `admin_mark_order_shipped()` has applied since 0018, and not
  -- the name rule from CLAUDE.md: that protects article and category names
  -- from being "corrected"; a carrier reference has no such meaning.
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

  v_before := v_order.tracking_number;

  -- Nothing to record. Returning early rather than writing an event for a
  -- non-change keeps the history readable.
  if v_tracking is not distinct from v_before then
    return 'unchanged';
  end if;

  -- `fulfillment_status` and `shipped_at` are deliberately absent from this
  -- statement. The trigger pins `shipped_at` to its old value anyway; leaving
  -- both out means this function cannot ship anything even by accident.
  update public.orders
     set tracking_number = v_tracking
   where id = v_order.id;

  -- The history, and enough of it to answer "what happened to that parcel".
  -- Booleans rather than the numbers themselves: an event payload is read by
  -- more eyes than the order is, and the old reference has no purpose there.
  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order.id, 'tracking_updated', 'admin', (select auth.uid()),
          jsonb_build_object(
            'had_tracking', v_before is not null,
            'has_tracking', v_tracking is not null,
            'shipped',      v_order.fulfillment_status = 'shipped'));

  return case
           when v_tracking is null then 'cleared'
           when v_before is null   then 'recorded'
           else 'replaced'
         end;
end;
$$;

comment on function public.admin_set_tracking_number(text, text) is
  'Records, replaces or clears an order''s carrier reference, before or after shipping. Never changes fulfillment_status or shipped_at, and never sends a mail. Writes a tracking_updated event; a no-op change writes nothing.';

revoke all on function public.admin_set_tracking_number(text, text) from public, anon;
grant execute on function public.admin_set_tracking_number(text, text) to authenticated;


-- ===========================================================================
-- 4. Shipping no longer discards a number that is already there
--
-- The 0018 function with one change: `coalesce`. Before this migration a
-- number could not exist on an unshipped order, so passing none and writing
-- NULL was a no-op. Now it would throw away the label the operator bought
-- yesterday.
-- ===========================================================================

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
  --
  -- `coalesce`: shipping without naming a number keeps the one that is
  -- already recorded. Overwriting it with NULL would discard a label the
  -- operator bought before the parcel went out — which is now a real case.
  update public.orders
     set fulfillment_status = 'shipped',
         tracking_number    = coalesce(v_tracking, v_order.tracking_number)
   where id = v_order.id;

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order.id, 'order_shipped', 'admin', (select auth.uid()),
          jsonb_build_object(
            'has_tracking',
            coalesce(v_tracking, v_order.tracking_number) is not null));

  return 'shipped';
end;
$$;

comment on function public.admin_mark_order_shipped(text, text) is
  'Marks a paid, unflagged, unshipped order as shipped and sets shipped_at from the server clock. A tracking number may be given here or recorded beforehand with admin_set_tracking_number(); shipping without one keeps whatever is already on the order.';

revoke all on function public.admin_mark_order_shipped(text, text) from public, anon;
grant execute on function public.admin_mark_order_shipped(text, text) to authenticated;


-- ===========================================================================
-- 5. The projections name the carrier, not only its label
--
-- A link needs the code. `shipping_method_name` is what was shown to the
-- customer and may be renamed; `shipping_method_code` is what the shipping
-- catalogue keys on, and building a URL from a display name would break the
-- first time somebody writes "DHL Paket".
-- ===========================================================================

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
      'shipping_method_code', v_order.shipping_method_code,
      'tracking_number',    v_order.tracking_number,
      'is_guest',           v_order.user_id is null,
      'commerce_mode',      v_order.commerce_mode,
      'stock_reverted',     exists (
                              select 1 from public.order_events se
                               where se.order_id = v_order.id
                                 and se.event_type = 'sandbox_stock_reverted')
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
    ), '[]'::jsonb),
    'mail', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', m.kind,
               'state', public.order_mail_effective_state(m.state, m.claimed_at),
               'sent_at', m.sent_at,
               'attempts', m.attempts,
               'last_error', m.last_error,
               'updated_at', m.updated_at)
               order by m.kind)
        from public.order_mail m
       where m.order_id = v_order.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.admin_order(text) is
  'One order as a document: header, address, lines, history and mail delivery, plus the commerce mode, the carrier code and whether sandbox stock has been returned. No client_hash, no payment_token_hash, no request_id, no internal id.';

revoke all on function public.admin_order(text) from public, anon;
grant execute on function public.admin_order(text) to authenticated;


-- The customer's own order says it too: the account page shows the same link.

create or replace function public.my_order(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if (select auth.uid()) is null then
    return null;
  end if;

  select o.* into v_order
    from public.orders o
   where o.order_number = p_order_number
     and o.user_id = (select auth.uid());

  if not found then
    -- Unknown and not-yours answer the same, as everywhere else.
    return null;
  end if;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'order_number',       v_order.order_number,
      'placed_at',          v_order.placed_at,
      'paid_at',            v_order.paid_at,
      'shipped_at',         v_order.shipped_at,
      'payment_status',     v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status,
      'needs_resolution',   v_order.needs_resolution,
      'customer_email',     v_order.customer_email,
      'currency',           v_order.currency,
      'items_subtotal',     v_order.items_subtotal,
      'shipping_amount',    v_order.shipping_amount,
      'discount_amount',    v_order.discount_amount,
      'total_amount',       v_order.total_amount,
      'shipping_method',    v_order.shipping_method_name,
      -- The code as well as the label: a tracking link is built from the
      -- carrier the catalogue keys on, never from a display name somebody
      -- may rename to "DHL Paket" (ADR-0062).
      'shipping_method_code', v_order.shipping_method_code,
      'tracking_number',    v_order.tracking_number,
      'commerce_mode',      v_order.commerce_mode
    ),
    -- The address as it was agreed, not as the account holds it today. This
    -- is the whole point of the snapshot (ADR-0049).
    'address', (
      select jsonb_build_object(
               'first_name', a.first_name, 'last_name', a.last_name,
               'company', a.company, 'street', a.street,
               'house_number', a.house_number, 'address_line_2', a.address_line_2,
               'postal_code', a.postal_code, 'city', a.city,
               'country_code', a.country_code, 'phone', a.phone)
        from public.order_addresses a
       where a.order_id = v_order.id and a.kind = 'shipping'
       limit 1
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sky_id', l.sky_id, 'condition', l.condition,
               'name', l.name_snapshot, 'image', l.image_snapshot,
               'quantity', l.quantity,
               'unit_price', l.unit_price, 'line_total', l.line_total)
               order by l.id)
        from public.order_lines l
       where l.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.my_order(text) is
  'One of the calling account''s own orders as a document, including the address snapshot as it was at the time and the carrier code behind the tracking number. An unknown order and somebody else''s order both return null.';

revoke all on function public.my_order(text) from public, anon;
grant execute on function public.my_order(text) to authenticated;
