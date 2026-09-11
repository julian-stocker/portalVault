-- ===========================================================================
-- Webhook runtime verification (B2.3) — STAGING ONLY
--
-- DELIBERATELY UNNUMBERED. The other suite is `0015_runtime_verification.sql`
-- because it verifies migration 0015. This one verifies no migration at all:
-- B2.3 added none, and numbering it would have claimed a migration that does
-- not exist — which is exactly the gap the contiguity guard in
-- `payment.test.ts` catches.
--
-- B2.3 adds NO migration. What it adds is a caller, and this suite proves that
-- the two functions that caller uses behave as `stripe-webhook` assumes when
-- they are actually executed — not as the source text says they do.
--
-- `webhook.test.ts` proves that we route an event to the right function with
-- the right arguments. This proves what happens next. Neither replaces the
-- other, and the gap between them is exactly where ADR-0053's defect lived.
--
--   HOW TO RUN
--   Supabase Dashboard -> SQL Editor, on the STAGING project. Paste one
--   section at a time and read the NOTICE output. Each section raises on the
--   first failure, so a section that finishes without an error has passed.
--
--   WHY IT LEAVES NOTHING BEHIND
--   Every section runs inside `begin ... rollback`. Sequences advance and do
--   not roll back, which is harmless in a disposable environment.
--
--   ⚠️  NEVER RUN THIS AGAINST PRODUCTION.
--   Section 0 refuses to continue if it finds a populated shop. That is a
--   guard, not a guarantee — check the project name in the Dashboard header.
-- ===========================================================================


-- ===========================================================================
-- SECTION 0 — preflight. Reads only.
-- ===========================================================================
do $$
declare
  v_paid    bigint;
  v_missing text[] := '{}';
begin
  select count(*) into v_paid from public.orders where paid_at is not null;
  if v_paid > 5 then
    raise exception 'This looks like a live shop (% paid orders). STOP.', v_paid;
  end if;

  if to_regprocedure('public.confirm_order_payment(text,text,numeric,text,text,text)') is null
    then v_missing := v_missing || 'confirm_order_payment'; end if;
  if to_regprocedure('public.fail_payment_attempt(text,text,text,text,text)') is null
    then v_missing := v_missing || 'fail_payment_attempt'; end if;
  if to_regprocedure('public.start_payment_attempt(bigint,text)') is null
    then v_missing := v_missing || 'start_payment_attempt'; end if;

  if array_length(v_missing, 1) > 0 then
    raise exception '0012/0015 not fully applied, missing: %', array_to_string(v_missing, ', ');
  end if;

  raise notice 'PASS  section 0 — functions present, % paid orders', v_paid;
end $$;


-- ===========================================================================
-- SECTION 1 — the happy path, end to end
--
-- What the webhook causes for a paid checkout: the attempt succeeds, the order
-- is paid, every reservation converts, and exactly one sale movement per line
-- appears. This is the only path in the system that may write sale_skyisles.
-- ===========================================================================
begin;
do $$
declare
  v_inv       bigint;
  v_sky       text;
  v_cond      text;
  v_order     bigint;
  v_attempt   bigint;
  v_session   text := 'cs_test_runtime_' || gen_random_uuid()::text;
  v_outcome   text;
  v_reserved  integer;
  v_qty       integer;
  v_sales     integer;
  v_converted integer;
begin
  -- The fixture must come from the PUBLIC OFFER, not from raw stock.
  --
  -- `create_order()` sells only what `shop_offers()` lists, and a position can
  -- hold stock while being unlisted, hidden from the catalog, or in a
  -- non-collectible category. Picking on `quantity - reserved >= 1` alone
  -- finds such a position and the order is refused with `is not offered` —
  -- which is the function being right and the fixture being wrong.
  select i.id, i.sky_id, i.condition
    into v_inv, v_sky, v_cond
    from public.shop_offers() o
    join public.shop_inventory i
      on i.sky_id = o.sky_id and i.condition = o.condition
   where o.available
   order by i.id
   limit 1;

  if v_inv is null then
    raise exception 'no publicly offered position with stock — seed one first';
  end if;

  select quantity, reserved into v_qty, v_reserved from public.shop_inventory where id = v_inv;

  select o.order_id into v_order from public.create_order(
    gen_random_uuid()::text,
    'runtime-0017@example.test',
    jsonb_build_array(jsonb_build_object(
      'sky_id',   v_sky,
      'condition',v_cond,
      'quantity', 1)),
    jsonb_build_object('first_name','A','last_name','B','street','S','house_number','1',
                       'postal_code','10115','city','Berlin','country_code','DE'),
    'hermes',
    repeat('a', 64)
  ) o;

  select s.attempt_id into v_attempt from public.start_payment_attempt(v_order) s;
  perform public.attach_provider_payment(v_attempt, v_session, 'https://checkout.stripe.com/x');

  -- Exactly what the Edge Function sends: the amount as the order's own
  -- figure, the currency lower case as Stripe delivers it.
  select public.confirm_order_payment(
    'stripe', v_session,
    (select total_amount from public.orders where id = v_order),
    'eur',
    'evt_runtime_0017_a', 'checkout.session.completed'
  ) into v_outcome;

  if v_outcome <> 'confirmed' then
    raise exception 'expected confirmed, got %', v_outcome;
  end if;

  if (select payment_status from public.orders where id = v_order) <> 'paid' then
    raise exception 'order not paid';
  end if;
  if (select paid_at from public.orders where id = v_order) is null then
    raise exception 'paid_at not set';
  end if;
  if (select needs_resolution from public.orders where id = v_order) then
    raise exception 'a clean payment must not need resolution';
  end if;
  if (select status from public.payment_attempts where id = v_attempt) <> 'succeeded' then
    raise exception 'attempt not succeeded';
  end if;

  select count(*) into v_converted
    from public.order_reservations where order_id = v_order and state = 'converted';
  if v_converted <> 1 then raise exception 'expected 1 converted reservation, got %', v_converted; end if;

  if (select movement_id from public.order_reservations where order_id = v_order) is null then
    raise exception 'converted reservation carries no movement';
  end if;

  select count(*) into v_sales
    from public.inventory_movements
   where inventory_id = v_inv and reason = 'sale_skyisles';
  if v_sales <> 1 then raise exception 'expected exactly 1 sale movement, got %', v_sales; end if;

  -- Stock left, reservation cleared.
  if (select quantity from public.shop_inventory where id = v_inv) <> v_qty - 1 then
    raise exception 'quantity did not drop by one';
  end if;
  if (select reserved from public.shop_inventory where id = v_inv) <> v_reserved then
    raise exception 'reserved did not return to its starting value';
  end if;

  raise notice 'PASS  section 1 — confirmed, one sale movement, stock booked once';
end $$;
rollback;


-- ===========================================================================
-- SECTION 2 — the same event five times books one sale
--
-- Stripe retries. `(provider, provider_event_id)` is the lock, and only a row
-- with `processed_at` set is a genuine duplicate.
-- ===========================================================================
begin;
do $$
declare
  v_inv     bigint;
  v_sky     text;
  v_cond    text;
  v_order   bigint;
  v_attempt bigint;
  v_session text := 'cs_test_dup_' || gen_random_uuid()::text;
  v_outcome text;
  v_sales   integer;
begin
  -- The fixture must come from the PUBLIC OFFER, not from raw stock.
  --
  -- `create_order()` sells only what `shop_offers()` lists, and a position can
  -- hold stock while being unlisted, hidden from the catalog, or in a
  -- non-collectible category. Picking on `quantity - reserved >= 1` alone
  -- finds such a position and the order is refused with `is not offered` —
  -- which is the function being right and the fixture being wrong.
  select i.id, i.sky_id, i.condition
    into v_inv, v_sky, v_cond
    from public.shop_offers() o
    join public.shop_inventory i
      on i.sky_id = o.sky_id and i.condition = o.condition
   where o.available
   order by i.id
   limit 1;

  if v_inv is null then
    raise exception 'no publicly offered position with stock — seed one first';
  end if;
  select o.order_id into v_order from public.create_order(
    gen_random_uuid()::text, 'dup-0017@example.test',
    jsonb_build_array(jsonb_build_object(
      'sky_id',   v_sky,
      'condition',v_cond,
      'quantity', 1)),
    jsonb_build_object('first_name','A','last_name','B','street','S','house_number','1',
                       'postal_code','10115','city','Berlin','country_code','DE'),
    'hermes', repeat('b', 64)
  ) o;
  select s.attempt_id into v_attempt from public.start_payment_attempt(v_order) s;
  perform public.attach_provider_payment(v_attempt, v_session, 'https://checkout.stripe.com/x');

  for i in 1..5 loop
    select public.confirm_order_payment(
      'stripe', v_session,
      (select total_amount from public.orders where id = v_order),
      'eur', 'evt_runtime_0017_dup', 'checkout.session.completed'
    ) into v_outcome;

    if i = 1 and v_outcome <> 'confirmed' then
      raise exception 'first delivery: expected confirmed, got %', v_outcome;
    end if;
    if i > 1 and v_outcome <> 'duplicate_event' then
      raise exception 'delivery %: expected duplicate_event, got %', i, v_outcome;
    end if;
  end loop;

  select count(*) into v_sales
    from public.inventory_movements where inventory_id = v_inv and reason = 'sale_skyisles';
  if v_sales <> 1 then raise exception 'five deliveries produced % sale movements', v_sales; end if;

  raise notice 'PASS  section 2 — five deliveries, one sale';
end $$;
rollback;


-- ===========================================================================
-- SECTION 3 — the late payment, which is now a real situation
--
-- pg_cron expires a checkout after 20 minutes; a Stripe session stays payable
-- for 32. Between those two numbers the money can arrive for an order whose
-- hold is already gone. Nothing may be converted, nothing oversold, and a
-- human has to look at it (ADR-0050, ADR-0052).
-- ===========================================================================
begin;
do $$
declare
  v_inv     bigint;
  v_sky     text;
  v_cond    text;
  v_order   bigint;
  v_attempt bigint;
  v_session text := 'cs_test_late_' || gen_random_uuid()::text;
  v_outcome text;
  v_sales   integer;
  v_qty     integer;
begin
  -- The fixture must come from the PUBLIC OFFER, not from raw stock.
  --
  -- `create_order()` sells only what `shop_offers()` lists, and a position can
  -- hold stock while being unlisted, hidden from the catalog, or in a
  -- non-collectible category. Picking on `quantity - reserved >= 1` alone
  -- finds such a position and the order is refused with `is not offered` —
  -- which is the function being right and the fixture being wrong.
  select i.id, i.sky_id, i.condition
    into v_inv, v_sky, v_cond
    from public.shop_offers() o
    join public.shop_inventory i
      on i.sky_id = o.sky_id and i.condition = o.condition
   where o.available
   order by i.id
   limit 1;

  if v_inv is null then
    raise exception 'no publicly offered position with stock — seed one first';
  end if;

  select quantity into v_qty from public.shop_inventory where id = v_inv;

  select o.order_id into v_order from public.create_order(
    gen_random_uuid()::text, 'late-0017@example.test',
    jsonb_build_array(jsonb_build_object(
      'sky_id',   v_sky,
      'condition',v_cond,
      'quantity', 1)),
    jsonb_build_object('first_name','A','last_name','B','street','S','house_number','1',
                       'postal_code','10115','city','Berlin','country_code','DE'),
    'hermes', repeat('c', 64)
  ) o;
  select s.attempt_id into v_attempt from public.start_payment_attempt(v_order) s;
  perform public.attach_provider_payment(v_attempt, v_session, 'https://checkout.stripe.com/x');

  -- Age the hold, then let the sweep do exactly what pg_cron does.
  update public.order_reservations
     set expires_at = now() - interval '1 minute'
   where order_id = v_order;
  perform public.expire_stale_checkouts();

  if (select payment_status from public.orders where id = v_order) <> 'expired' then
    raise exception 'sweep did not expire the order';
  end if;
  if (select status from public.payment_attempts where id = v_attempt) <> 'expired' then
    raise exception 'sweep did not expire the attempt';
  end if;

  -- Now the money arrives anyway. This is the transition ADR-0052 opened.
  select public.confirm_order_payment(
    'stripe', v_session,
    (select total_amount from public.orders where id = v_order),
    'eur', 'evt_runtime_0017_late', 'checkout.session.async_payment_succeeded'
  ) into v_outcome;

  if v_outcome <> 'late_payment_unresolved' then
    raise exception 'expected late_payment_unresolved, got %', v_outcome;
  end if;
  if (select status from public.payment_attempts where id = v_attempt) <> 'succeeded' then
    raise exception 'expired -> succeeded was refused';
  end if;
  if (select failed_at from public.payment_attempts where id = v_attempt) is not null then
    raise exception 'failed_at was not cleared by the trigger';
  end if;
  if not (select needs_resolution from public.orders where id = v_order) then
    raise exception 'a late payment must be flagged for a human';
  end if;

  select count(*) into v_sales
    from public.inventory_movements where inventory_id = v_inv and reason = 'sale_skyisles';
  if v_sales <> 0 then raise exception 'a late payment must not book stock, got % movements', v_sales; end if;
  if (select quantity from public.shop_inventory where id = v_inv) <> v_qty then
    raise exception 'stock changed on a late payment';
  end if;

  raise notice 'PASS  section 3 — paid, flagged, nothing oversold';
end $$;
rollback;


-- ===========================================================================
-- SECTION 4 — the wrong amount sells nothing
-- ===========================================================================
begin;
do $$
declare
  v_inv     bigint;
  v_sky     text;
  v_cond    text;
  v_order   bigint;
  v_attempt bigint;
  v_session text := 'cs_test_amount_' || gen_random_uuid()::text;
  v_outcome text;
  v_sales   integer;
begin
  -- The fixture must come from the PUBLIC OFFER, not from raw stock.
  --
  -- `create_order()` sells only what `shop_offers()` lists, and a position can
  -- hold stock while being unlisted, hidden from the catalog, or in a
  -- non-collectible category. Picking on `quantity - reserved >= 1` alone
  -- finds such a position and the order is refused with `is not offered` —
  -- which is the function being right and the fixture being wrong.
  select i.id, i.sky_id, i.condition
    into v_inv, v_sky, v_cond
    from public.shop_offers() o
    join public.shop_inventory i
      on i.sky_id = o.sky_id and i.condition = o.condition
   where o.available
   order by i.id
   limit 1;

  if v_inv is null then
    raise exception 'no publicly offered position with stock — seed one first';
  end if;
  select o.order_id into v_order from public.create_order(
    gen_random_uuid()::text, 'amount-0017@example.test',
    jsonb_build_array(jsonb_build_object(
      'sky_id',   v_sky,
      'condition',v_cond,
      'quantity', 1)),
    jsonb_build_object('first_name','A','last_name','B','street','S','house_number','1',
                       'postal_code','10115','city','Berlin','country_code','DE'),
    'hermes', repeat('d', 64)
  ) o;
  select s.attempt_id into v_attempt from public.start_payment_attempt(v_order) s;
  perform public.attach_provider_payment(v_attempt, v_session, 'https://checkout.stripe.com/x');

  select public.confirm_order_payment(
    'stripe', v_session, 0.01, 'eur',
    'evt_runtime_0017_amount', 'checkout.session.completed'
  ) into v_outcome;

  if v_outcome <> 'amount_mismatch' then
    raise exception 'expected amount_mismatch, got %', v_outcome;
  end if;
  if (select status from public.payment_attempts where id = v_attempt) <> 'failed' then
    raise exception 'a mismatched attempt must be closed';
  end if;
  if (select payment_status from public.orders where id = v_order) <> 'pending' then
    raise exception 'the order must not be marked paid';
  end if;
  if not (select needs_resolution from public.orders where id = v_order) then
    raise exception 'a mismatch must be flagged for a human';
  end if;

  select count(*) into v_sales
    from public.inventory_movements where inventory_id = v_inv and reason = 'sale_skyisles';
  if v_sales <> 0 then raise exception 'a mismatch booked stock'; end if;

  -- A wrong currency must be refused the same way, and 'EUR' vs 'eur' must NOT
  -- be: confirm_order_payment() upper-cases before comparing, which is what
  -- lets the Edge Function forward Stripe's lower-case value untouched.
  raise notice 'PASS  section 4 — mismatch closed the attempt, sold nothing';
end $$;
rollback;


-- ===========================================================================
-- SECTION 5 — an unmatched session is SEEN but not PROCESSED
--
-- The contract the Edge Function's 500 depends on: a webhook that arrives
-- before attach_provider_payment() has committed must be retried, so its event
-- row must stay unprocessed.
-- ===========================================================================
begin;
do $$
declare
  v_outcome   text;
  v_processed timestamptz;
begin
  select public.confirm_order_payment(
    'stripe', 'cs_test_never_attached_0017', 9.31, 'eur',
    'evt_runtime_0017_unknown', 'checkout.session.completed'
  ) into v_outcome;

  if v_outcome <> 'unknown_payment' then
    raise exception 'expected unknown_payment, got %', v_outcome;
  end if;

  select processed_at into v_processed
    from public.payment_events
   where provider = 'stripe' and provider_event_id = 'evt_runtime_0017_unknown';

  if v_processed is not null then
    raise exception 'an unmatched event must stay unprocessed so a retry runs again';
  end if;

  raise notice 'PASS  section 5 — seen, unprocessed, retryable';
end $$;
rollback;


-- ===========================================================================
-- SECTION 6 — expired and failed close the attempt and leave the order alone
-- ===========================================================================
begin;
do $$
declare
  v_inv     bigint;
  v_sky     text;
  v_cond    text;
  v_order   bigint;
  v_attempt bigint;
  v_session text := 'cs_test_close_' || gen_random_uuid()::text;
  v_outcome text;
begin
  -- The fixture must come from the PUBLIC OFFER, not from raw stock.
  --
  -- `create_order()` sells only what `shop_offers()` lists, and a position can
  -- hold stock while being unlisted, hidden from the catalog, or in a
  -- non-collectible category. Picking on `quantity - reserved >= 1` alone
  -- finds such a position and the order is refused with `is not offered` —
  -- which is the function being right and the fixture being wrong.
  select i.id, i.sky_id, i.condition
    into v_inv, v_sky, v_cond
    from public.shop_offers() o
    join public.shop_inventory i
      on i.sky_id = o.sky_id and i.condition = o.condition
   where o.available
   order by i.id
   limit 1;

  if v_inv is null then
    raise exception 'no publicly offered position with stock — seed one first';
  end if;
  select o.order_id into v_order from public.create_order(
    gen_random_uuid()::text, 'close-0017@example.test',
    jsonb_build_array(jsonb_build_object(
      'sky_id',   v_sky,
      'condition',v_cond,
      'quantity', 1)),
    jsonb_build_object('first_name','A','last_name','B','street','S','house_number','1',
                       'postal_code','10115','city','Berlin','country_code','DE'),
    'hermes', repeat('e', 64)
  ) o;
  select s.attempt_id into v_attempt from public.start_payment_attempt(v_order) s;
  perform public.attach_provider_payment(v_attempt, v_session, 'https://checkout.stripe.com/x');

  select public.fail_payment_attempt(
    'stripe', v_session, 'expired', 'evt_runtime_0017_expired', 'checkout.session.expired'
  ) into v_outcome;

  if v_outcome <> 'closed' then raise exception 'expected closed, got %', v_outcome; end if;
  if (select status from public.payment_attempts where id = v_attempt) <> 'expired' then
    raise exception 'attempt not expired';
  end if;

  -- The order is untouched on purpose: its reservation is still running and
  -- the customer may start a fresh attempt with what is left of the hold.
  if (select payment_status from public.orders where id = v_order) <> 'pending' then
    raise exception 'closing an attempt must not close the order';
  end if;
  if (select state from public.order_reservations where order_id = v_order) <> 'active' then
    raise exception 'closing an attempt must not release the hold';
  end if;

  -- A second delivery of the same event changes nothing.
  select public.fail_payment_attempt(
    'stripe', v_session, 'expired', 'evt_runtime_0017_expired', 'checkout.session.expired'
  ) into v_outcome;
  if v_outcome <> 'duplicate_event' then
    raise exception 'expected duplicate_event on redelivery, got %', v_outcome;
  end if;

  -- An unmatched expiry: the Edge Function answers 200 for this one, so the
  -- outcome only has to be survivable, not retried.
  select public.fail_payment_attempt(
    'stripe', 'cs_test_unmatched_expiry_0017', 'expired',
    'evt_runtime_0017_orphan', 'checkout.session.expired'
  ) into v_outcome;
  if v_outcome <> 'unknown_payment' then
    raise exception 'expected unknown_payment for an orphaned expiry, got %', v_outcome;
  end if;

  raise notice 'PASS  section 6 — attempt closed, order and hold untouched';
end $$;
rollback;


-- ===========================================================================
-- SECTION 7 — nothing was left behind. Reads only.
-- ===========================================================================
do $$
declare
  v_events bigint;
begin
  select count(*) into v_events
    from public.payment_events where provider_event_id like 'evt_runtime_0017%';
  if v_events <> 0 then
    raise exception '% runtime event rows survived the rollback', v_events;
  end if;
  raise notice 'PASS  section 7 — nothing left behind';
end $$;
