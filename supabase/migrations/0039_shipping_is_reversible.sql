-- ===========================================================================
-- 0039 — shipping is a status, not an event; and a line remembers its series
--
-- THREE CHANGES, ONE ROUND OF ADMIN FULFILMENT WORK
--
--   A  `shipped` can go back to `unfulfilled`
--   B  `admin_order()` hands the administrator the picture it already stores
--   C  a new order line remembers which series it belonged to
--
-- A — WHY SHIPPING WAS ONE-WAY, AND WHY IT SHOULD NOT BE
--
-- `0018` allowed exactly one transition and `0023` kept that. The reasoning
-- was sound for what it addressed: `preparing`, `completed` and `cancelled`
-- are in the CHECK with no workflow behind them, and allowing them would
-- create states nothing can leave.
--
-- `unfulfilled` is not one of those. It is where every order starts and it has
-- a workflow. "Versendet" is an informational fulfilment status the customer
-- reads — not a financial event, not an inventory event. A parcel that was
-- marked shipped by a mis-tap on a phone is a wrong statement to the customer,
-- and the operator must be able to correct a wrong statement.
--
-- What does NOT become reversible: the money, the stock, the payment, the
-- journal. `orders_protect_immutable()` still freezes identity and amounts on
-- every update, `order_events` is still append-only, and the sale movement is
-- written on the PAYMENT path (`convert_order_reservations()`), not here.
-- Un-shipping touches two columns.
--
-- B — THE PICTURE WAS ALREADY THERE
--
-- `order_lines.image_snapshot` has existed since `0010` and `my_order()` has
-- always projected it; `admin_order()` simply never did. The administrator
-- picking figures for a parcel is the person who needs it most. No new source,
-- no live lookup — the snapshot the order already holds.
--
-- C — SERIES, AND THE HONEST TREATMENT OF ITS ABSENCE
--
-- `order_lines` never snapshotted the series. It cannot be recovered: the only
-- route is `sky_id -> skylanders -> series`, which is MUTABLE CURRENT CATALOG
-- and exactly what ADR-0033 keeps out of a historical order.
--
-- So this migration adds the column, fills nothing, and **backfills nothing**.
-- Orders placed before it keep `NULL` for ever and the admin renders "—". A
-- backfill would write today's catalog into yesterday's order and call it a
-- snapshot, which is worse than an empty cell: an empty cell is true.
--
-- WHY A TRIGGER RATHER THAN A SIXTH `create_order()`
--
-- `create_order()` is 263 lines and has been replaced six times. Transcribing
-- it to add one field would put the whole checkout at risk for a display
-- column. A `before insert` trigger on `order_lines` captures the series in
-- the same transaction, from the same table `create_order()` priced the line
-- against, and covers every insert path rather than one. It fires only on
-- INSERT, which is also what makes "no backfill" structural rather than a
-- promise: existing rows are never visited.
--
-- NO DEPENDENCY ON `0035`, which stays unapplied on Production. This needs
-- `orders`, `order_lines`, `order_events`, `skylanders`, `series` and
-- `is_shop_admin()`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The column. Nullable, unfilled, and that is the point.
-- ---------------------------------------------------------------------------
alter table public.order_lines
  add column if not exists series_snapshot text;

comment on column public.order_lines.series_snapshot is
  'The series label as it stood when the order was placed, e.g. "Spyro''s Adventure" (ADR-0074). NULL on every line written before 0039 and on any line whose figure could not be resolved: historical series is NOT recoverable, because the only source is the mutable current catalog. Never backfilled, never joined live.';

-- Present or absent, never blank. A blank string would render as an empty cell
-- and read as "no series" rather than "not recorded".
alter table public.order_lines
  drop constraint if exists order_lines_series_snapshot_shape;
alter table public.order_lines
  add constraint order_lines_series_snapshot_shape
  check (series_snapshot is null or length(btrim(series_snapshot)) > 0);


-- ---------------------------------------------------------------------------
-- 2. Capturing it, at the moment the line is written
--
-- Only when the caller did not supply one, so a later `create_order()` may
-- pass the value from its own resolution pass without this fighting it.
--
-- A figure that cannot be resolved leaves NULL rather than raising: a display
-- column must never be able to fail a checkout.
-- ---------------------------------------------------------------------------
create or replace function public.order_lines_capture_series()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.series_snapshot is null then
    select se.label
      into new.series_snapshot
      from public.skylanders s
      join public.series se on se.code = s.series_code
     where s.sky_id = new.sky_id;
  end if;

  return new;
end;
$$;

comment on function public.order_lines_capture_series() is
  'Fills order_lines.series_snapshot from the catalog at INSERT time, once, for new lines only (ADR-0074). Fires on INSERT only, which is why no historical row is ever touched. Leaves NULL when the figure cannot be resolved rather than failing a checkout.';

drop trigger if exists order_lines_series_snapshot on public.order_lines;
create trigger order_lines_series_snapshot
  before insert on public.order_lines
  for each row execute function public.order_lines_capture_series();


-- ---------------------------------------------------------------------------
-- 3. Two transitions, and what stays frozen
--
-- Minimal change to `0023`'s function: one more allowed pair, and `shipped_at`
-- cleared when the status goes back.
--
-- An obsolete `shipped_at` is not kept "in case it ships again". It would be a
-- date on an order that is not shipped, and a later shipment gets its own
-- server clock reading — that is what a shipping date means.
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
    /*
     * V1 designs exactly two transitions, and they are each other's inverse.
     * `preparing`, `completed` and `cancelled` remain in the CHECK with no
     * workflow behind them; allowing them here would still mean allowing
     * states nothing can leave.
     */
    if not (
      (old.fulfillment_status = 'unfulfilled' and new.fulfillment_status = 'shipped')
      or
      (old.fulfillment_status = 'shipped' and new.fulfillment_status = 'unfulfilled')
    ) then
      raise exception 'fulfillment cannot go from % to %', old.fulfillment_status, new.fulfillment_status
        using errcode = 'restrict_violation';
    end if;

    if new.needs_resolution is distinct from old.needs_resolution then
      raise exception 'fulfillment must not change needs_resolution'
        using errcode = 'restrict_violation';
    end if;

    -- Server time on the way out, nothing on the way back. Whatever the caller
    -- passed is discarded in both directions.
    if new.fulfillment_status = 'shipped' then
      new.shipped_at := now();
    else
      new.shipped_at := null;
    end if;
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
  'Allows the two fulfilment transitions V1 has, unfulfilled <-> shipped, sets shipped_at from the server clock when shipping and clears it when the status goes back, freezes it outside a transition, and refuses to let fulfilment change needs_resolution. Says nothing about tracking_number, which is a separate state (ADR-0062, ADR-0074).';


-- ---------------------------------------------------------------------------
-- 4. admin_unmark_order_shipped() — the correction
--
-- Its own function rather than a flag on the shipping one, for the reason
-- `0023` gave about tracking: two different actions should not be one call
-- where the caller names which it meant.
--
-- Note what is absent: no inventory, no reservation, no payment column, no
-- order line, no amount, no tracking number, no mail. Two columns and a
-- journal entry.
-- ---------------------------------------------------------------------------
create or replace function public.admin_unmark_order_shipped(p_order_number text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select o.* into v_order
    from public.orders o
   where o.order_number = p_order_number
     for update;

  if not found then
    raise exception 'unknown order %', p_order_number using errcode = 'no_data_found';
  end if;

  if v_order.fulfillment_status <> 'shipped' then
    raise exception 'order % is %, and only a shipped order can be set back',
      v_order.order_number, v_order.fulfillment_status
      using errcode = 'check_violation';
  end if;

  /*
   * `tracking_number` is deliberately not in this UPDATE.
   *
   * The parcel reference is a fact about a label that was bought; the status
   * is a statement to the customer. Correcting the statement does not unbuy
   * the label, and an operator who wants the number gone can clear it with
   * `admin_set_tracking_number()`, which is where that decision belongs.
   *
   * `shipped_at` is not in it either — the trigger clears it, so no caller can
   * name or keep a shipping date.
   */
  update public.orders
     set fulfillment_status = 'unfulfilled'
   where id = v_order.id;

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order.id, 'order_unshipped', 'admin', (select auth.uid()),
          jsonb_build_object('kept_tracking', v_order.tracking_number is not null));

  return 'unfulfilled';
end;
$$;

comment on function public.admin_unmark_order_shipped(text) is
  'Sets a shipped order back to unfulfilled and clears shipped_at (ADR-0074). Keeps the tracking number, writes no inventory movement, no reservation, no payment column and no mail. Administrators only.';

revoke all on function public.admin_unmark_order_shipped(text) from public, anon;
grant execute on function public.admin_unmark_order_shipped(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. The readers — two more snapshot fields, nothing else
--
-- Both are reproduced in full because PostgreSQL has no way to add one key to
-- a function body. The ONLY differences from `0023` are `image` and `series`
-- in `admin_order()`'s lines, and `series` in `my_order()`'s.
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
    -- `image` and `series` are new here. Both come from the LINE, never from
    -- `skylanders`: the order says what was sold, not what it is called today.
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sky_id', l.sky_id, 'condition', l.condition,
               'name', l.name_snapshot, 'image', l.image_snapshot,
               'series', l.series_snapshot, 'quantity', l.quantity,
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


-- `my_order()` gains `series` for the same reason and from the same column.
-- The customer page does not render it today and is not redesigned to; the
-- field is there so the historical record is complete wherever it is read.
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
               'series', l.series_snapshot, 'quantity', l.quantity,
               'unit_price', l.unit_price, 'line_total', l.line_total)
               order by l.id)
        from public.order_lines l
       where l.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. What this migration deliberately does NOT do
--
-- No backfill of `series_snapshot`. Not one row. See section 1.
-- No change to `create_order()`, `admin_mark_order_shipped()`,
-- `admin_set_tracking_number()`, `convert_order_reservations()` or any mail
-- function.
-- No new transition beyond `unfulfilled <-> shipped`.
-- No relaxation of `orders_protect_immutable()` or the append-only triggers.
-- No special case for sandbox orders: a test order ships and un-ships exactly
-- as a real one does.
-- No dependency on `0035`.
-- ---------------------------------------------------------------------------
