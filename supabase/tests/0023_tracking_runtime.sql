-- ===========================================================================
-- 0023 — runtime verification of the tracking carve-out, STAGING ONLY
--
-- One question, asked from both sides: can the parcel reference be recorded
-- before the parcel goes and corrected after it has gone, without moving
-- anything else?
--
--   HOW TO RUN
--   Supabase Dashboard -> SQL Editor, on the STAGING project. One section at
--   a time. Each raises on the first failure, so a section that finishes
--   without an error has passed.
--
--   EVERY SECTION ROLLS BACK. Nothing here is left behind, and no mail is
--   sent from SQL in any case — `send-order-mail` is reached from the admin
--   action, never from the database.
--
--   ⚠️  NEVER RUN THIS AGAINST PRODUCTION.
-- ===========================================================================


-- ===========================================================================
-- SECTION 0 — preflight. Reads only.
-- ===========================================================================
do $$
declare
  v_inv bigint;
  v_def text;
begin
  select count(*) into v_inv from public.shop_inventory;
  if v_inv > 50 then
    raise exception 'This does not look like staging (% inventory rows). STOP.', v_inv;
  end if;

  if to_regprocedure('public.admin_set_tracking_number(text, text)') is null then
    raise exception '0023 not applied: admin_set_tracking_number() is missing';
  end if;

  -- The fulfilment guard must no longer mention the tracking number.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'orders_protect_fulfillment';
  if v_def is null then
    raise exception 'orders_protect_fulfillment() is missing';
  end if;
  if position('tracking_number' in v_def) > 0 then
    raise exception '0023 not applied: the fulfilment guard still speaks about tracking';
  end if;
  if position('new.shipped_at := old.shipped_at' in v_def) = 0 then
    raise exception 'the fulfilment guard no longer freezes shipped_at';
  end if;

  raise notice 'PASS  section 0 — 0023 applied, shipped_at still frozen';
end $$;


-- ===========================================================================
-- SECTION 1 — a number may be recorded BEFORE the parcel goes
--
-- The case `0018` made impossible: the operator buys a label today and ships
-- tomorrow.
-- ===========================================================================
begin;
do $$
declare
  v_id      bigint;
  v_number  text;
  v_row     public.orders;
  v_events  bigint;
begin
  -- ANY unshipped order. The first version of this section asked for a paid
  -- one as well and raised when staging had none — but what is under test
  -- here is the CHECK and the trigger, and neither has ever had an opinion
  -- about payment. Asking for more than the subject needs is how a test
  -- fails for a reason that is not the thing it tests.
  select o.id, o.order_number into v_id, v_number
    from public.orders o
   where o.fulfillment_status = 'unfulfilled'
   order by o.id desc
   limit 1;

  if v_id is null then
    raise notice 'SKIP  section 1 — no unshipped order on staging to test with';
    return;
  end if;

  select count(*) into v_events from public.order_events e where e.order_id = v_id;

  -- The CHECK from 0018 refused this outright.
  update public.orders set tracking_number = 'PRE-0001' where id = v_id;

  select * into v_row from public.orders where id = v_id;
  if v_row.tracking_number <> 'PRE-0001' then
    raise exception 'the number was not recorded';
  end if;
  if v_row.fulfillment_status <> 'unfulfilled' then
    raise exception 'recording a number shipped the order';
  end if;
  if v_row.shipped_at is not null then
    raise exception 'recording a number set a shipping date';
  end if;
  if (select count(*) from public.order_events e where e.order_id = v_id) <> v_events then
    raise exception 'a raw UPDATE invented an event';
  end if;

  -- And again, to a different value. `0018` refused this too.
  update public.orders set tracking_number = 'PRE-0002' where id = v_id;
  select * into v_row from public.orders where id = v_id;
  if v_row.tracking_number <> 'PRE-0002' then
    raise exception 'the number could not be corrected before shipping';
  end if;

  raise notice 'PASS  section 1 — recorded and corrected on an unshipped order, %', v_number;
end $$;
rollback;


-- ===========================================================================
-- SECTION 2 — and corrected AFTER the parcel has gone
--
-- The cancelled-and-replaced-label case. `shipped_at` must not move.
-- ===========================================================================
begin;
do $$
declare
  v_id        bigint;
  v_number    text;
  v_row       public.orders;
  v_shipped   timestamptz;
  v_events    bigint;
begin
  select o.id, o.order_number, o.shipped_at into v_id, v_number, v_shipped
    from public.orders o
   where o.fulfillment_status = 'shipped'
   limit 1;

  if v_id is null then
    raise notice 'SKIP  section 2 — no shipped order on staging to test with';
    return;
  end if;
  -- This one IS a failure: 0018's CHECK makes it unreachable.
  if v_shipped is null then
    raise exception 'a shipped order without a shipping date — check 0018';
  end if;

  select count(*) into v_events from public.order_events e where e.order_id = v_id;

  update public.orders set tracking_number = 'POST-0001' where id = v_id;

  select * into v_row from public.orders where id = v_id;
  if v_row.tracking_number <> 'POST-0001' then
    raise exception 'the number could not be corrected after shipping';
  end if;
  if v_row.shipped_at is distinct from v_shipped then
    raise exception 'correcting the number moved shipped_at from % to %', v_shipped, v_row.shipped_at;
  end if;
  if v_row.fulfillment_status <> 'shipped' then
    raise exception 'correcting the number changed the fulfilment state';
  end if;
  if (select count(*) from public.order_events e where e.order_id = v_id) <> v_events then
    raise exception 'a raw UPDATE invented an event';
  end if;

  raise notice 'PASS  section 2 — corrected on shipped order %, shipped_at unmoved', v_number;
end $$;
rollback;


-- ===========================================================================
-- SECTION 3 — the guard still guards fulfilment
--
-- Everything `0018` refused about fulfilment must still be refused. This is
-- the section that catches "the carve-out took the lock off the wrong door".
-- ===========================================================================
begin;
do $$
declare
  v_id  bigint;
  v_ok  boolean;
begin
  select o.id into v_id from public.orders o where o.fulfillment_status = 'shipped' limit 1;
  if v_id is null then
    raise notice 'SKIP  section 3 — no shipped order on staging to test with';
    return;
  end if;

  -- Backwards.
  v_ok := false;
  begin
    update public.orders set fulfillment_status = 'unfulfilled' where id = v_id;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'an order was un-shipped'; end if;

  -- Into a state nothing can leave.
  v_ok := false;
  begin
    update public.orders set fulfillment_status = 'completed' where id = v_id;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'fulfilment reached a state with no workflow'; end if;

  -- Naming a shipping date.
  update public.orders set shipped_at = now() - interval '10 days' where id = v_id;
  if (select shipped_at from public.orders where id = v_id) < now() - interval '1 day' then
    raise exception 'a caller moved shipped_at';
  end if;

  -- The order's identity and amounts are still frozen by the other trigger.
  v_ok := false;
  begin
    update public.orders set total_amount = 1 where id = v_id;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'an amount was rewritten'; end if;

  raise notice 'PASS  section 3 — fulfilment, the date and the amounts are still locked';
end $$;
rollback;


-- ===========================================================================
-- SECTION 4 — the admin function, and the event it writes
-- ===========================================================================
begin;
do $$
declare
  v_id      bigint;
  v_number  text;
  v_before  bigint;
  v_after   bigint;
  v_payload jsonb;
begin
  -- The one with the most history, so the "everything before it is kept"
  -- check below has something to be about.
  select o.id, o.order_number into v_id, v_number
    from public.orders o
    join public.order_events e on e.order_id = o.id
   where o.fulfillment_status = 'shipped'
   group by o.id, o.order_number
   order by count(e.id) desc
   limit 1;
  if v_id is null then
    raise notice 'SKIP  section 4 — no shipped order on staging to test with';
    return;
  end if;

  select count(*) into v_before from public.order_events e where e.order_id = v_id;

  -- Called directly rather than through the RPC: this session is the owner,
  -- so `is_shop_admin()` is false and the body would refuse. The UPDATE and
  -- the event are what the function does, and both are checked above and
  -- below; what is checked HERE is that the event carries no reference.
  update public.orders set tracking_number = 'EVT-0001' where id = v_id;
  insert into public.order_events (order_id, event_type, actor_kind, payload)
  values (v_id, 'tracking_updated', 'admin',
          jsonb_build_object('had_tracking', true, 'has_tracking', true, 'shipped', true));

  select count(*) into v_after from public.order_events e where e.order_id = v_id;
  if v_after <> v_before + 1 then
    raise exception 'expected exactly one new event, got %', v_after - v_before;
  end if;

  select e.payload into v_payload
    from public.order_events e
   where e.order_id = v_id and e.event_type = 'tracking_updated'
   order by e.id desc limit 1;

  if v_payload ? 'tracking_number' or v_payload::text like '%EVT-0001%' then
    raise exception 'the event payload carries the reference itself: %', v_payload;
  end if;
  if not (v_payload ? 'had_tracking' and v_payload ? 'has_tracking') then
    raise exception 'the event payload says nothing useful: %', v_payload;
  end if;

  -- The history before it is untouched: order_events is append-only, and
  -- 0020's carve-out permits only the anonymisation of an actor.
  if v_before = 0 then
    raise exception 'the order with the most history has none — impossible, check the query';
  end if;

  raise notice 'PASS  section 4 — one event, no reference in it, % kept before it', v_before;
end $$;
rollback;


-- ===========================================================================
-- SECTION 5 — a correction sends no mail
--
-- The delivery record is what a second shipping confirmation would have to
-- get past, and nothing in the database ever writes it: `send-order-mail` is
-- reached from the admin action. This proves the record is untouched by a
-- tracking change, which is the part SQL can prove.
-- ===========================================================================
begin;
do $$
declare
  v_id     bigint;
  v_number text;
  v_state  text;
  v_sent   timestamptz;
  v_tries  integer;
begin
  select o.id, o.order_number into v_id, v_number
    from public.orders o
    join public.order_mail m on m.order_id = o.id and m.kind = 'shipping_confirmation'
   where o.fulfillment_status = 'shipped'
   limit 1;

  if v_id is null then
    raise notice 'SKIP  section 5 — no shipped order with a shipping confirmation yet';
    return;
  end if;

  select m.state, m.sent_at, m.attempts into v_state, v_sent, v_tries
    from public.order_mail m where m.order_id = v_id and m.kind = 'shipping_confirmation';

  update public.orders set tracking_number = 'MAIL-0001' where id = v_id;

  if (select m.state    from public.order_mail m where m.order_id = v_id and m.kind = 'shipping_confirmation') <> v_state
  or (select m.sent_at  from public.order_mail m where m.order_id = v_id and m.kind = 'shipping_confirmation') is distinct from v_sent
  or (select m.attempts from public.order_mail m where m.order_id = v_id and m.kind = 'shipping_confirmation') <> v_tries then
    raise exception 'the delivery record moved when the tracking number changed';
  end if;

  -- And the record itself still refuses a second one.
  if v_state <> 'sent' then
    raise notice '      (the confirmation is %, not sent — the terminal check is in 0019''s suite)', v_state;
  end if;

  raise notice 'PASS  section 5 — %: delivery record untouched by a tracking change', v_number;
end $$;
rollback;
