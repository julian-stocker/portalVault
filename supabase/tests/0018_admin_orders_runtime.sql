-- ===========================================================================
-- 0018 — runtime verification of Admin Orders V1, STAGING ONLY
--
-- `orders.test.ts` proves what the migration says. This proves what the
-- database does when it runs: that a trigger fires, that a refusal is a
-- refusal, and above all that shipping an order moves **no stock and no
-- money**.
--
--   HOW TO RUN
--   Supabase Dashboard -> SQL Editor, on the STAGING project. One section at a
--   time. Each raises on the first failure, so a section that finishes without
--   an error has passed.
--
--   WHY IT LEAVES NOTHING BEHIND
--   Every section runs inside `begin ... rollback`. Sequences advance and do
--   not roll back, which is harmless on a disposable project.
--
--   ⚠️  NEVER RUN THIS AGAINST PRODUCTION.
-- ===========================================================================


-- ===========================================================================
-- SECTION 0 — preflight. Reads only.
-- ===========================================================================
do $$
declare v_inv bigint; v_missing text[] := '{}';
begin
  select count(*) into v_inv from public.shop_inventory;
  if v_inv > 50 then
    raise exception 'This does not look like staging (% inventory rows). STOP.', v_inv;
  end if;

  if to_regprocedure('public.admin_orders(boolean,integer,integer)') is null
    then v_missing := v_missing || 'admin_orders'; end if;
  if to_regprocedure('public.admin_order(text)') is null
    then v_missing := v_missing || 'admin_order'; end if;
  if to_regprocedure('public.admin_mark_order_shipped(text,text)') is null
    then v_missing := v_missing || 'admin_mark_order_shipped'; end if;
  if to_regclass('public.orders') is null then v_missing := v_missing || 'orders'; end if;

  if array_length(v_missing, 1) > 0 then
    raise exception '0018 not applied, missing: %', array_to_string(v_missing, ', ');
  end if;

  raise notice 'PASS  section 0 — 0018 applied';
end $$;


-- ===========================================================================
-- SECTION 1 — the guard allows exactly one transition
--
-- Direct UPDATEs, bypassing admin_mark_order_shipped() entirely. That is the
-- point: the trigger has to hold for a writer that does not exist yet.
-- ===========================================================================
begin;
do $$
declare v_id bigint; v_sky text; v_cond text;
begin
  -- Jeder Abschnitt legt seine EIGENE Bestellung an und rollt sie zurueck.
  -- Bewusst nicht "die neueste Bestellung": auf diesem Projekt ist das die
  -- historische Referenz des ersten Stripe-E2E, und die wird nicht angefasst
  -- -- auch nicht innerhalb einer Transaktion, die zurueckrollt.
  select i.sky_id, i.condition into v_sky, v_cond
    from public.shop_offers() f
    join public.shop_inventory i on i.sky_id=f.sky_id and i.condition=f.condition
   where f.available order by i.id limit 1;
  if v_sky is null then raise exception 'no offered position with stock'; end if;

  select o.order_id into v_id from public.create_order(
    gen_random_uuid()::text, 'admin-0018-s1@example.test',
    jsonb_build_array(jsonb_build_object('sky_id', v_sky, 'condition', v_cond, 'quantity', 1)),
    jsonb_build_object('first_name','A','last_name','B','street','S','house_number','1',
                       'postal_code','10115','city','Berlin','country_code','DE'),
    'hermes', repeat('1', 64)) o;

  -- unfulfilled -> shipped: allowed, and shipped_at is set by the trigger
  update public.orders set fulfillment_status = 'shipped' where id = v_id;
  if (select shipped_at from public.orders where id = v_id) is null then
    raise exception 'the trigger did not set shipped_at';
  end if;

  -- shipped -> anything: refused
  begin
    update public.orders set fulfillment_status = 'unfulfilled' where id = v_id;
    raise exception 'shipped -> unfulfilled was allowed';
  exception when restrict_violation then null;
  end;
  begin
    update public.orders set fulfillment_status = 'completed' where id = v_id;
    raise exception 'shipped -> completed was allowed';
  exception when restrict_violation then null;
  end;

  raise notice 'PASS  section 1 — one transition, shipped_at set by the trigger';
end $$;
rollback;


-- ===========================================================================
-- SECTION 2 — a caller cannot name a shipping date, and cannot edit tracking
-- ===========================================================================
begin;
do $$
declare v_id bigint; v_when timestamptz; v_sky text; v_cond text;
begin
  -- Jeder Abschnitt legt seine EIGENE Bestellung an und rollt sie zurueck.
  -- Bewusst nicht "die neueste Bestellung": auf diesem Projekt ist das die
  -- historische Referenz des ersten Stripe-E2E, und die wird nicht angefasst
  -- -- auch nicht innerhalb einer Transaktion, die zurueckrollt.
  select i.sky_id, i.condition into v_sky, v_cond
    from public.shop_offers() f
    join public.shop_inventory i on i.sky_id=f.sky_id and i.condition=f.condition
   where f.available order by i.id limit 1;
  if v_sky is null then raise exception 'no offered position with stock'; end if;

  select o.order_id into v_id from public.create_order(
    gen_random_uuid()::text, 'admin-0018-s2@example.test',
    jsonb_build_array(jsonb_build_object('sky_id', v_sky, 'condition', v_cond, 'quantity', 1)),
    jsonb_build_object('first_name','A','last_name','B','street','S','house_number','1',
                       'postal_code','10115','city','Berlin','country_code','DE'),
    'hermes', repeat('2', 64)) o;

  -- A supplied date is discarded in favour of the server clock.
  update public.orders
     set fulfillment_status = 'shipped',
         shipped_at = timestamptz '2001-01-01 00:00:00+00',
         tracking_number = 'ABC123'
   where id = v_id;

  select shipped_at into v_when from public.orders where id = v_id;
  if v_when < now() - interval '1 minute' then
    raise exception 'a caller-supplied shipping date survived: %', v_when;
  end if;

  -- And the tracking number is recorded with the shipment, not edited later.
  begin
    update public.orders set tracking_number = 'DIFFERENT' where id = v_id;
    raise exception 'a tracking number was edited after shipping';
  exception when restrict_violation then null;
  end;

  raise notice 'PASS  section 2 — server owns shipped_at, tracking is write-once';
end $$;
rollback;


-- ===========================================================================
-- SECTION 3 — fulfilment may not change needs_resolution in the same breath
-- ===========================================================================
begin;
do $$
declare v_id bigint; v_sky text; v_cond text;
begin
  -- Jeder Abschnitt legt seine EIGENE Bestellung an und rollt sie zurueck.
  -- Bewusst nicht "die neueste Bestellung": auf diesem Projekt ist das die
  -- historische Referenz des ersten Stripe-E2E, und die wird nicht angefasst
  -- -- auch nicht innerhalb einer Transaktion, die zurueckrollt.
  select i.sky_id, i.condition into v_sky, v_cond
    from public.shop_offers() f
    join public.shop_inventory i on i.sky_id=f.sky_id and i.condition=f.condition
   where f.available order by i.id limit 1;
  if v_sky is null then raise exception 'no offered position with stock'; end if;

  select o.order_id into v_id from public.create_order(
    gen_random_uuid()::text, 'admin-0018-s3@example.test',
    jsonb_build_array(jsonb_build_object('sky_id', v_sky, 'condition', v_cond, 'quantity', 1)),
    jsonb_build_object('first_name','A','last_name','B','street','S','house_number','1',
                       'postal_code','10115','city','Berlin','country_code','DE'),
    'hermes', repeat('3', 64)) o;

  update public.orders set needs_resolution = true where id = v_id;

  begin
    update public.orders
       set fulfillment_status = 'shipped', needs_resolution = false
     where id = v_id;
    raise exception 'fulfilment cleared needs_resolution';
  exception when restrict_violation then null;
  end;

  -- The payment path may still set it — that must not have been broken.
  update public.orders set needs_resolution = false where id = v_id;
  update public.orders set needs_resolution = true  where id = v_id;

  raise notice 'PASS  section 3 — the flag survives fulfilment, payment may still set it';
end $$;
rollback;


-- ===========================================================================
-- SECTION 4 — the existing payment and expiry paths still work
--
-- The guard runs on every UPDATE to orders. This is the section that would
-- have caught it breaking confirm_order_payment() or expire_stale_checkouts().
-- ===========================================================================
begin;
do $$
declare v_id bigint; v_sky text; v_cond text;
begin
  -- Jeder Abschnitt legt seine EIGENE Bestellung an und rollt sie zurueck.
  -- Bewusst nicht "die neueste Bestellung": auf diesem Projekt ist das die
  -- historische Referenz des ersten Stripe-E2E, und die wird nicht angefasst
  -- -- auch nicht innerhalb einer Transaktion, die zurueckrollt.
  select i.sky_id, i.condition into v_sky, v_cond
    from public.shop_offers() f
    join public.shop_inventory i on i.sky_id=f.sky_id and i.condition=f.condition
   where f.available order by i.id limit 1;
  if v_sky is null then raise exception 'no offered position with stock'; end if;

  select o.order_id into v_id from public.create_order(
    gen_random_uuid()::text, 'admin-0018-s4@example.test',
    jsonb_build_array(jsonb_build_object('sky_id', v_sky, 'condition', v_cond, 'quantity', 1)),
    jsonb_build_object('first_name','A','last_name','B','street','S','house_number','1',
                       'postal_code','10115','city','Berlin','country_code','DE'),
    'hermes', repeat('4', 64)) o;

  -- What confirm_order_payment() does to an order.
  update public.orders set payment_status = 'pending', paid_at = null where id = v_id;
  update public.orders set payment_status = 'paid', paid_at = now() where id = v_id;
  update public.orders set needs_resolution = true where id = v_id;

  -- What expire_stale_checkouts() does.
  update public.orders set payment_status = 'pending', paid_at = null, needs_resolution = false
   where id = v_id;
  update public.orders set payment_status = 'expired' where id = v_id;

  raise notice 'PASS  section 4 — payment and expiry updates are unaffected';
end $$;
rollback;


-- ===========================================================================
-- SECTION 5 — admin_mark_order_shipped() refuses what it must
-- ===========================================================================
begin;
do $$
declare
  v_inv bigint; v_sky text; v_cond text; v_num text; v_id bigint;
begin
  select i.id, i.sky_id, i.condition into v_inv, v_sky, v_cond
    from public.shop_offers() f
    join public.shop_inventory i on i.sky_id=f.sky_id and i.condition=f.condition
   where f.available order by i.id limit 1;
  if v_inv is null then raise exception 'no offered position with stock'; end if;

  select o.order_id, o.order_number into v_id, v_num from public.create_order(
    gen_random_uuid()::text, 'admin-0018@example.test',
    jsonb_build_array(jsonb_build_object('sky_id', v_sky, 'condition', v_cond, 'quantity', 1)),
    jsonb_build_object('first_name','A','last_name','B','street','S','house_number','1',
                       'postal_code','10115','city','Berlin','country_code','DE'),
    'hermes', repeat('a', 64)) o;

  -- Not an administrator.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-4000-8000-000000000009','role','authenticated')::text, true);
  begin
    perform public.admin_mark_order_shipped(v_num, null);
    raise exception 'a non-administrator shipped an order';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- An administrator, for the duration of this rolled-back section.
  --
  -- `is_shop_admin()` reads `auth.uid()` against `shop_admins`, and a SQL
  -- Editor session has neither. Granting the role permanently is a change to
  -- who may act on the shop — that belongs to a person, not to a test — so it
  -- is created here and disappears with the rollback.
  insert into public.shop_admins (user_id, note)
  select u.id, 'runtime fixture 0018, rolled back' from auth.users u order by u.created_at limit 1
  on conflict (user_id) do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', (select sa.user_id from public.shop_admins sa limit 1),
                      'role', 'authenticated')::text, true);

  -- Unpaid.
  begin
    perform public.admin_mark_order_shipped(v_num, null);
    raise exception 'an unpaid order was shipped';
  exception when check_violation then null;
  end;

  -- Paid but flagged.
  update public.orders set payment_status='paid', paid_at=now(), needs_resolution=true where id=v_id;
  begin
    perform public.admin_mark_order_shipped(v_num, null);
    raise exception 'a flagged order was shipped';
  exception when check_violation then null;
  end;

  -- Unknown order.
  begin
    perform public.admin_mark_order_shipped('SI-9999-999999', null);
    raise exception 'an unknown order was shipped';
  exception when no_data_found then null;
  end;

  raise notice 'PASS  section 5 — not-admin, unpaid, flagged and unknown all refused';
end $$;
rollback;


-- ===========================================================================
-- SECTION 6 — the happy path moves NO stock and NO money
--
-- The section this suite exists for.
-- ===========================================================================
begin;
do $$
declare
  v_inv bigint; v_sky text; v_cond text; v_num text; v_id bigint;
  v_qty integer; v_res integer; v_mv integer; v_events integer;
  v_qty2 integer; v_res2 integer; v_mv2 integer; v_outcome text;
begin
  select i.id, i.sky_id, i.condition into v_inv, v_sky, v_cond
    from public.shop_offers() f
    join public.shop_inventory i on i.sky_id=f.sky_id and i.condition=f.condition
   where f.available order by i.id limit 1;

  select o.order_id, o.order_number into v_id, v_num from public.create_order(
    gen_random_uuid()::text, 'admin-0018b@example.test',
    jsonb_build_array(jsonb_build_object('sky_id', v_sky, 'condition', v_cond, 'quantity', 1)),
    jsonb_build_object('first_name','A','last_name','B','street','S','house_number','1',
                       'postal_code','10115','city','Berlin','country_code','DE'),
    'hermes', repeat('b', 64)) o;

  update public.orders set payment_status='paid', paid_at=now() where id=v_id;

  -- An administrator, for the duration of this rolled-back section.
  --
  -- `is_shop_admin()` reads `auth.uid()` against `shop_admins`, and a SQL
  -- Editor session has neither. Granting the role permanently is a change to
  -- who may act on the shop — that belongs to a person, not to a test — so it
  -- is created here and disappears with the rollback.
  insert into public.shop_admins (user_id, note)
  select u.id, 'runtime fixture 0018, rolled back' from auth.users u order by u.created_at limit 1
  on conflict (user_id) do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', (select sa.user_id from public.shop_admins sa limit 1),
                      'role', 'authenticated')::text, true);

  select quantity, reserved into v_qty, v_res from public.shop_inventory where id=v_inv;
  select count(*) into v_mv from public.inventory_movements where inventory_id=v_inv;

  select public.admin_mark_order_shipped(v_num, '  0034 0434 1612  ') into v_outcome;
  if v_outcome <> 'shipped' then raise exception 'expected shipped, got %', v_outcome; end if;

  if (select fulfillment_status from public.orders where id=v_id) <> 'shipped' then
    raise exception 'not marked shipped';
  end if;
  if (select shipped_at from public.orders where id=v_id) is null then
    raise exception 'shipped_at not set';
  end if;
  if (select tracking_number from public.orders where id=v_id) <> '0034 0434 1612' then
    raise exception 'tracking number was not trimmed to the stored form: %',
      (select tracking_number from public.orders where id=v_id);
  end if;

  select quantity, reserved into v_qty2, v_res2 from public.shop_inventory where id=v_inv;
  select count(*) into v_mv2 from public.inventory_movements where inventory_id=v_inv;
  if v_qty2 <> v_qty or v_res2 <> v_res or v_mv2 <> v_mv then
    raise exception 'shipping moved stock: quantity %->%, reserved %->%, movements %->%',
      v_qty, v_qty2, v_res, v_res2, v_mv, v_mv2;
  end if;

  if (select payment_status from public.orders where id=v_id) <> 'paid' then
    raise exception 'shipping changed the payment status';
  end if;
  if (select needs_resolution from public.orders where id=v_id) then
    raise exception 'shipping set needs_resolution';
  end if;

  select count(*) into v_events
    from public.order_events where order_id=v_id and event_type='order_shipped';
  if v_events <> 1 then raise exception 'expected one order_shipped event, got %', v_events; end if;

  -- A second attempt is refused, so fulfilment runs forward once.
  begin
    perform public.admin_mark_order_shipped(v_num, null);
    raise exception 'an order was shipped twice';
  exception when check_violation then null;
  end;

  raise notice 'PASS  section 6 — shipped once, tracking trimmed, no stock and no money moved';
end $$;
rollback;


-- ===========================================================================
-- SECTION 7 — reads are administrator-only. Nothing left behind.
-- ===========================================================================
begin;
do $$
declare v_n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-4000-8000-000000000009','role','authenticated')::text, true);

  begin
    select count(*) into v_n from public.admin_orders();
    raise exception 'a non-administrator read the order list';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.admin_order('SI-2026-000001');
    raise exception 'a non-administrator read an order';
  exception when insufficient_privilege then null;
  end;

  reset role;
  raise notice 'PASS  section 7 — both reads refuse a non-administrator';
end $$;
rollback;

do $$
declare v_left integer;
begin
  select count(*) into v_left from public.orders where customer_email like 'admin-0018%%';
  if v_left <> 0 then raise exception '% fixture orders survived the rollback', v_left; end if;
  raise notice 'PASS  nothing left behind';
end $$;
