-- ===========================================================================
-- 0015 — runtime verification, for STAGING ONLY
--
-- `payment-bootstrap.test.ts` proves what the migration says. This proves what
-- the database does. The two answer different questions and neither replaces
-- the other: a source test cannot tell you that a CHECK constraint fires, that
-- a trigger fires in the right order, or that a transaction actually commits.
--
--   HOW TO RUN
--   Supabase Dashboard -> SQL Editor, on the STAGING project. Paste one
--   section at a time and read the NOTICE output. Every section prints PASS
--   lines and raises on the first failure, so a section that finishes without
--   an error has fully passed.
--
--   WHY IT LEAVES NOTHING BEHIND
--   Every section that writes runs inside `begin ... rollback`. The data is
--   real while the assertions run and gone the moment the section ends, so the
--   suite can be run repeatedly and the database is byte-identical afterwards.
--
--   The one exception is sequences: `next_order_number()` and the identity
--   columns advance and do not roll back. That is harmless — it consumes a few
--   order numbers in a disposable environment and nothing depends on them
--   being contiguous.
--
--   ⚠️  NEVER RUN THIS AGAINST PRODUCTION.
--   Section 0 refuses to continue if it finds an already-populated shop, which
--   is a guard and not a guarantee. Check the project name in the Dashboard
--   header before you paste anything.
-- ===========================================================================


-- ===========================================================================
-- SECTION 0 — preflight
--
-- Reads only. Confirms 0015 is applied and that this is not a live shop.
-- ===========================================================================
do $$
declare
  v_orders   bigint;
  v_missing  text[] := '{}';
  v_name     text;
begin
  foreach v_name in array array[
    'amount_to_cents', 'pending_payment_expiries', 'start_payment_attempt',
    'payment_attempts_protect', 'confirm_order_payment', 'expire_stale_checkouts'
  ] loop
    if not exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
    ) then
      v_missing := v_missing || v_name;
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'FAIL: 0015 is not applied here. Missing: %', v_missing;
  end if;

  -- start_payment_attempt must be the widened version, not 0012's.
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'start_payment_attempt'
       and 'amount_cents' = any (p.proargnames)
  ) then
    raise exception 'FAIL: start_payment_attempt has no amount_cents — 0015 did not replace it';
  end if;

  select count(*) into v_orders from public.orders;
  if v_orders > 50 then
    raise exception
      'REFUSING: % orders exist. This looks like a live shop, not staging.', v_orders;
  end if;

  raise notice 'PASS  0015 is applied (start_payment_attempt returns amount_cents)';
  raise notice 'PASS  environment looks disposable (% existing orders)', v_orders;
end $$;


-- ===========================================================================
-- SECTION 1 — runtime grants
--
-- The point of asking the database rather than reading the migration:
-- start_payment_attempt() was DROPped and re-CREATEd, so Supabase's default
-- privileges applied to it again as if it were brand new. Whether the revoke
-- actually took effect is a fact about this database, not about the file.
--
-- WHAT THIS SECTION IS, AND IS NOT
--
-- This is an ACL test. It asks which privileges exist, and nothing else. It
-- deliberately does NOT try to infer row visibility from grants: an ACL is the
-- outer door, and RLS decides which rows are behind it. Proving that an
-- authenticated customer sees their own order and not somebody else's needs a
-- real signed-in session, which is `verify:rls`'s job and not SQL's. See the
-- coverage note at the end of this section.
--
-- THE CONTRACT BEING CHECKED  (docs/SECURITY.md, 0010 section 9)
--
--   anon             nothing, on all seven tables
--   authenticated    SELECT on orders, order_lines, order_addresses
--                    and nothing else, anywhere
--   service_role     keeps what setup and the payment core need
--
-- `authenticated` holding SELECT on those three tables is required by the
-- contract, not merely tolerated by it: 0010 revokes Supabase's default ALL
-- and then grants exactly that back. A test that forbade it would be
-- inventing a stricter rule than the system was designed to.
-- ===========================================================================
do $$
declare
  v_row   record;
  v_has   boolean;
  v_fails text[] := '{}';
  v_sig   text;
  v_role  text;
  v_fns   text[] := array[
    'public.amount_to_cents(numeric)',
    'public.pending_payment_expiries(interval, integer)',
    'public.start_payment_attempt(bigint, text)',
    'public.confirm_order_payment(text, text, numeric, text, text, text)',
    'public.fail_payment_attempt(text, text, text, text, text)',
    'public.attach_provider_payment(bigint, text, text)',
    'public.expire_stale_checkouts()',
    'public.reservation_ttl()',
    'public.next_order_number()'
  ];
begin
  -- ---- 1a. no client role may execute any payment-core function ---------
  foreach v_sig in array v_fns loop
    foreach v_role in array array['anon', 'authenticated', 'public'] loop
      if has_function_privilege(v_role, v_sig, 'execute') then
        v_fails := v_fails || format('%s unexpectedly has EXECUTE on %s', v_role, v_sig);
      end if;
    end loop;
  end loop;

  -- ---- 1b. service_role must keep execute, or B2.2b is unbuildable ------
  foreach v_sig in array v_fns loop
    if not has_function_privilege('service_role', v_sig, 'execute') then
      v_fails := v_fails || format('service_role is MISSING EXECUTE on %s', v_sig);
    end if;
  end loop;

  if cardinality(v_fails) > 0 then
    raise exception E'FAIL: function grants are wrong:\n  %',
      array_to_string(v_fails, E'\n  ');
  end if;
  raise notice 'PASS  no client role can execute any payment-core function (% checked)',
    cardinality(v_fns);
  raise notice 'PASS  service_role retains execute on all of them (ADR-0051 path intact)';

  -- ---- 1c. client table privileges, one assertion per privilege ---------
  --
  -- The cross join states the contract as a single sentence: the only client
  -- privilege that may exist anywhere is `authenticated` SELECT on the three
  -- order tables. Every one of the 56 combinations is checked on its own and
  -- names itself on failure.
  for v_row in
    select r.role, t.tbl, p.priv,
           (r.role = 'authenticated'
            and p.priv = 'SELECT'
            and t.tbl in ('orders', 'order_lines', 'order_addresses')) as expected
      from (values ('anon'), ('authenticated')) as r(role)
     cross join (values ('orders'), ('order_lines'), ('order_addresses'),
                        ('order_events'), ('order_reservations'),
                        ('payment_attempts'), ('payment_events')) as t(tbl)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
     order by r.role, t.tbl, p.priv
  loop
    v_has := has_table_privilege(v_row.role, 'public.' || v_row.tbl, v_row.priv);

    if v_has and not v_row.expected then
      v_fails := v_fails ||
        format('%s unexpectedly has %s on public.%s', v_row.role, v_row.priv, v_row.tbl);
    elsif v_row.expected and not v_has then
      v_fails := v_fails ||
        format('%s is MISSING %s on public.%s (0010 grants it)',
               v_row.role, v_row.priv, v_row.tbl);
    end if;
  end loop;

  if cardinality(v_fails) > 0 then
    raise exception E'FAIL: client table privileges do not match the contract:\n  %',
      array_to_string(v_fails, E'\n  ');
  end if;

  raise notice 'PASS  anon holds no privilege on any of the seven tables';
  raise notice 'PASS  authenticated holds SELECT on orders, order_lines, order_addresses';
  raise notice 'PASS  authenticated holds no INSERT, UPDATE or DELETE anywhere';
  raise notice 'PASS  authenticated holds nothing on order_events, order_reservations,';
  raise notice '      payment_attempts, payment_events';

  -- ---- 1d. service_role keeps what the server path needs ----------------
  --
  -- SELECT, INSERT and UPDATE only. DELETE is deliberately not asserted:
  -- nothing in the commerce design ever deletes from these tables — they are
  -- append-only and this suite cleans up by ROLLBACK, not by DELETE.
  for v_row in
    select t.tbl, p.priv
      from (values ('orders'), ('order_lines'), ('order_addresses'),
                   ('order_events'), ('order_reservations'),
                   ('payment_attempts'), ('payment_events')) as t(tbl)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE')) as p(priv)
     order by t.tbl, p.priv
  loop
    if not has_table_privilege('service_role', 'public.' || v_row.tbl, v_row.priv) then
      v_fails := v_fails ||
        format('service_role is MISSING %s on public.%s', v_row.priv, v_row.tbl);
    end if;
  end loop;

  if cardinality(v_fails) > 0 then
    raise exception E'FAIL: service_role cannot do its job:\n  %',
      array_to_string(v_fails, E'\n  ');
  end if;
  raise notice 'PASS  service_role retains SELECT, INSERT and UPDATE on all seven tables';

  -- ---- 1e. row level security is switched on ----------------------------
  --
  -- A table-level fact, not a statement about row visibility. Without this,
  -- the SELECT grant in 1c would be an open door rather than a gated one.
  for v_row in
    select c.relname as tbl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('orders', 'order_lines', 'order_addresses',
                         'order_events', 'order_reservations',
                         'payment_attempts', 'payment_events')
       and not c.relrowsecurity
     order by c.relname
  loop
    v_fails := v_fails || format('row level security is OFF on public.%s', v_row.tbl);
  end loop;

  if cardinality(v_fails) > 0 then
    raise exception E'FAIL:\n  %', array_to_string(v_fails, E'\n  ');
  end if;
  raise notice 'PASS  row level security is enabled on all seven tables';

  -- ---- 1f. no write policy exists anywhere ------------------------------
  --
  -- The other half of "the commerce core never writes from a browser": a
  -- write is blocked by the missing grant AND by the absence of any policy
  -- that would permit it. This checks the second half.
  for v_row in
    select tablename, policyname, cmd
      from pg_policies
     where schemaname = 'public'
       and tablename in ('orders', 'order_lines', 'order_addresses',
                         'order_events', 'order_reservations',
                         'payment_attempts', 'payment_events')
       and cmd <> 'SELECT'
     order by tablename, policyname
  loop
    v_fails := v_fails ||
      format('writing policy %s (%s) exists on public.%s',
             v_row.policyname, v_row.cmd, v_row.tablename);
  end loop;

  if cardinality(v_fails) > 0 then
    raise exception E'FAIL: a writing policy exists:\n  %',
      array_to_string(v_fails, E'\n  ');
  end if;
  raise notice 'PASS  no writing policy exists on any commerce table';
end $$;

-- ---------------------------------------------------------------------------
-- COVERAGE NOTE — what section 1 deliberately does NOT prove
--
-- Section 1 proves that `authenticated` holds SELECT on orders, order_lines
-- and order_addresses. It says nothing about WHICH ROWS that returns, because
-- an ACL cannot answer that and neither can SQL run as the table owner.
--
-- These four are currently proved by nothing, anywhere:
--
--   * an authenticated user sees their own orders
--   * an authenticated user does NOT see another user's orders
--   * an authenticated user sees their own order_lines / order_addresses
--   * an authenticated user does NOT see another user's
--
-- `tools/verify-rls.mts` is the right home for them — it already signs real
-- users in and asserts against genuine JWTs — but it predates 0010 and
-- contains no coverage of `orders` at all.
--
-- NOT added here on purpose. This suite runs as the table owner in the SQL
-- Editor, where RLS does not apply, and it creates only guest orders
-- (user_id NULL) because creating auth users needs the Admin API rather than
-- SQL. Adding row-visibility assertions here would require inventing exactly
-- the machinery verify:rls already has, and would blur the ACL/RLS split this
-- section keeps deliberate.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- SECTION 2 — amount conversion, at runtime
--
-- Writes nothing. amount_to_cents() is immutable and takes only a value.
-- ===========================================================================
do $$
declare
  v_case   record;
  v_got    integer;
  v_raised boolean;
begin
  for v_case in
    select * from (values
      (14.99::numeric,      1499),
      (75.00::numeric,      7500),
      (0.01::numeric,          1),
      (0.00::numeric,          0),
      (5.40::numeric,        540),
      (5.4::numeric,         540),   -- one decimal must pad, not truncate
      (123.45::numeric,    12345),
      (9999.99::numeric,  999999),   -- a plausible ceiling for one order
      (99999.99::numeric, 9999999)   -- the widest numeric(10,2) commerce value
    ) as t(amount, expected)
  loop
    v_got := public.amount_to_cents(v_case.amount);
    if v_got <> v_case.expected then
      raise exception 'FAIL: amount_to_cents(%) = %, expected %',
        v_case.amount, v_got, v_case.expected;
    end if;
    raise notice 'PASS  % EUR -> % cents', v_case.amount, v_got;
  end loop;

  -- Sub-cent precision must raise, not round.
  v_raised := false;
  begin
    v_got := public.amount_to_cents(1.005::numeric);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: amount_to_cents(1.005) returned % instead of raising', v_got;
  end if;
  raise notice 'PASS  1.005 is refused rather than rounded';

  v_raised := false;
  begin
    v_got := public.amount_to_cents(0.001::numeric);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: amount_to_cents(0.001) returned % instead of raising', v_got;
  end if;
  raise notice 'PASS  0.001 is refused rather than rounded';

  v_raised := false;
  begin
    v_got := public.amount_to_cents(null);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: amount_to_cents(NULL) returned % instead of raising', v_got;
  end if;
  raise notice 'PASS  NULL is refused rather than returning NULL';
end $$;


-- ===========================================================================
-- SECTION 3 — the payment attempt transition matrix
--
-- Rolls back. Creates one order and drives one attempt through every
-- transition that must be allowed and every one that must not.
-- ===========================================================================
begin;

do $$
declare
  v_order   bigint;
  v_attempt bigint;
  v_status  text;
  v_failed  timestamptz;
  v_ok      boolean;
  v_from    text;
  v_to      text;
begin
  -- Minimal order, inserted directly: this section tests the trigger, not the
  -- checkout, so create_order()'s reservation machinery is noise here. No
  -- catalog row is needed either — order_lines.sky_id is deliberately not a
  -- foreign key (0010:476), and this order has no lines at all.
  insert into public.orders (order_number, request_id, customer_email,
                             items_subtotal, shipping_amount, total_amount)
  values (public.next_order_number(), gen_random_uuid()::text, 'runtime@example.test',
          10.00, 0.00, 10.00)
  returning id into v_order;

  -- ---- created -> pending, still allowed --------------------------------
  insert into public.payment_attempts (order_id, provider, amount, currency)
  values (v_order, 'stripe', 10.00, 'EUR') returning id into v_attempt;

  update public.payment_attempts
     set provider_payment_id = 'cs_runtime_matrix', status = 'pending'
   where id = v_attempt;
  select status into v_status from public.payment_attempts where id = v_attempt;
  if v_status <> 'pending' then
    raise exception 'FAIL: created -> pending did not take (status is %)', v_status;
  end if;
  raise notice 'PASS  created -> pending is allowed';

  -- ---- pending -> expired, still allowed --------------------------------
  update public.payment_attempts
     set status = 'expired', failed_at = now()
   where id = v_attempt;
  select status, failed_at into v_status, v_failed
    from public.payment_attempts where id = v_attempt;
  if v_status <> 'expired' or v_failed is null then
    raise exception 'FAIL: pending -> expired did not take (% / %)', v_status, v_failed;
  end if;
  raise notice 'PASS  pending -> expired is allowed, and stamps failed_at';

  -- ---- expired -> succeeded, THE FIX ------------------------------------
  update public.payment_attempts
     set status = 'succeeded', paid_at = now()
   where id = v_attempt;
  select status, failed_at into v_status, v_failed
    from public.payment_attempts where id = v_attempt;
  if v_status <> 'succeeded' then
    raise exception 'FAIL: expired -> succeeded was refused';
  end if;
  raise notice 'PASS  expired -> succeeded is allowed';

  if v_failed is not null then
    raise exception
      'FAIL: failed_at is still % — the CHECK constraint should have made this impossible',
      v_failed;
  end if;
  raise notice 'PASS  failed_at was cleared by the trigger';

  if (select paid_at from public.payment_attempts where id = v_attempt) is null then
    raise exception 'FAIL: paid_at was not set';
  end if;
  raise notice 'PASS  paid_at is set';

  -- ---- everything else out of a terminal state stays refused ------------
  for v_from, v_to in
    select * from (values
      ('failed',    'succeeded'),
      ('cancelled', 'succeeded'),
      ('succeeded', 'failed'),
      ('succeeded', 'expired'),
      ('succeeded', 'pending'),
      ('expired',   'pending'),
      ('expired',   'created'),
      ('expired',   'failed'),
      ('failed',    'pending')
    ) as t(f, t2)
  loop
    insert into public.payment_attempts (order_id, provider, amount, currency,
                                         status, paid_at, failed_at)
    values (v_order, 'stripe', 10.00, 'EUR', v_from,
            case when v_from = 'succeeded' then now() end,
            case when v_from in ('failed', 'expired', 'cancelled') then now() end)
    returning id into v_attempt;

    v_ok := false;
    begin
      update public.payment_attempts
         set status  = v_to,
             paid_at = case when v_to = 'succeeded' then now()
                            else (select paid_at from public.payment_attempts where id = v_attempt) end
       where id = v_attempt;
    exception when others then
      v_ok := true;
    end;

    if not v_ok then
      raise exception 'FAIL: % -> % was allowed and must not be', v_from, v_to;
    end if;
    raise notice 'PASS  % -> % is refused', v_from, v_to;
  end loop;

  raise notice '----  section 3 complete';
end $$;

rollback;


-- ===========================================================================
-- SECTION 4 — the real late payment, end to end
--
-- Rolls back. This is the defect 0015 exists for: an attempt closed as
-- `expired` by our own sweep, then paid for real. Before 0015 the whole
-- transaction raised and the payment went unrecorded.
-- ===========================================================================
begin;

do $$
declare
  v_cat      bigint;
  v_inv      bigint;
  v_order    bigint;
  v_total    numeric;
  v_attempt    bigint;
  v_outcome    text;
  v_moves      integer;
  v_after_moves integer;
  v_reserved   integer;
  v_qty        integer;
  v_row        record;
begin
  -- ---- seed a sellable article -----------------------------------------
  --
  -- The real dependency chain, in order:
  --   series -> categories -> skylanders -> shop_inventory
  --
  -- `categories.series_code` is a foreign key to `series(code)`, and
  -- `skylanders` carries a COMPOSITE key (category_id, series_code) so a
  -- figure cannot point at a category from a different series. Both rows
  -- therefore have to exist before the figure, and the series code on the
  -- figure must match the one on its category.
  --
  -- 'RT' satisfies series_code_format (^[A-Z]{1,4}$). Position 900 is far
  -- above the real series positions, which matters because series.position
  -- is globally unique — this stays safe even on a staging database that
  -- later gets a real catalog import.
  insert into public.series (code, label, release_year, position)
  values ('RT', 'Runtime Test Series', 2026, 900);

  insert into public.categories (series_code, position, name)
  values ('RT', 91, 'Runtime Test Category') returning id into v_cat;

  insert into public.skylanders (sky_id, name, slug, series_code, category_id)
  values ('SKY-9001', 'Runtime Test Figure', 'runtime-test-figure', 'RT', v_cat);

  insert into public.shop_inventory (sky_id, condition, quantity, sale_price, is_listed)
  values ('SKY-9001', 'loose', 1, 10.00, true) returning id into v_inv;

  -- ---- place a real order, with a real reservation ----------------------
  select o.order_id, o.total_amount into v_order, v_total
    from public.create_order(
      p_request_id      => gen_random_uuid()::text,
      p_email           => 'runtime@example.test',
      p_items           => '[{"sky_id":"SKY-9001","condition":"loose","quantity":1}]'::jsonb,
      p_address         => jsonb_build_object(
                             'first_name','Test','last_name','Runtime',
                             'street','Teststrasse','house_number','1',
                             'postal_code','10115','city','Berlin','country_code','DE'),
      p_shipping_method => 'hermes',
      p_payment_token   => repeat('a', 64)
    ) o;

  select reserved into v_reserved from public.shop_inventory where id = v_inv;
  if v_reserved <> 1 then
    raise exception 'FAIL: expected 1 reserved, found %', v_reserved;
  end if;
  raise notice 'PASS  order % placed, stock reserved', v_order;

  -- ---- open and attach a payment attempt --------------------------------
  select a.attempt_id into v_attempt
    from public.start_payment_attempt(v_order) a;
  perform public.attach_provider_payment(v_attempt, 'cs_runtime_late', 'https://example.test/cs');
  raise notice 'PASS  attempt % attached to cs_runtime_late', v_attempt;

  -- ---- the hold lapses and our own sweep closes everything --------------
  update public.order_reservations
     set expires_at = now() - interval '1 minute'
   where order_id = v_order;

  perform public.expire_stale_checkouts();

  select status into v_outcome from public.payment_attempts where id = v_attempt;
  if v_outcome <> 'expired' then
    raise exception 'FAIL: sweep left the attempt as %, expected expired', v_outcome;
  end if;
  select reserved into v_reserved from public.shop_inventory where id = v_inv;
  if v_reserved <> 0 then
    raise exception 'FAIL: stock was not released (reserved = %)', v_reserved;
  end if;
  raise notice 'PASS  sweep expired the attempt and released the stock';

  select count(*) into v_moves from public.inventory_movements where inventory_id = v_inv;

  -- ---- and THEN the money arrives ---------------------------------------
  select public.confirm_order_payment(
           p_provider            => 'stripe',
           p_provider_payment_id => 'cs_runtime_late',
           p_amount              => v_total,
           p_currency            => 'eur',
           p_provider_event_id   => 'evt_runtime_1',
           p_event_type          => 'checkout.session.completed'
         ) into v_outcome;

  if v_outcome <> 'late_payment_unresolved' then
    raise exception 'FAIL: outcome was %, expected late_payment_unresolved', v_outcome;
  end if;
  raise notice 'PASS  confirm_order_payment committed and returned %', v_outcome;

  -- ---- everything the late-payment contract promises ---------------------
  select * into v_row from public.payment_attempts where id = v_attempt;
  if v_row.status <> 'succeeded' then
    raise exception 'FAIL: attempt is %, expected succeeded', v_row.status;
  end if;
  if v_row.paid_at is null then raise exception 'FAIL: attempt has no paid_at'; end if;
  if v_row.failed_at is not null then
    raise exception 'FAIL: attempt still carries failed_at %', v_row.failed_at;
  end if;
  raise notice 'PASS  attempt is succeeded, paid_at set, failed_at cleared';

  select * into v_row from public.orders where id = v_order;
  if v_row.payment_status <> 'paid' then
    raise exception 'FAIL: order is %, expected paid', v_row.payment_status;
  end if;
  if v_row.paid_at is null then raise exception 'FAIL: order has no paid_at'; end if;
  if not v_row.needs_resolution then
    raise exception 'FAIL: order is not flagged for a human';
  end if;
  raise notice 'PASS  order is paid, paid_at set, needs_resolution true';

  if exists (select 1 from public.order_reservations
              where order_id = v_order and state = 'active') then
    raise exception 'FAIL: a reservation was reactivated';
  end if;
  raise notice 'PASS  no reservation was reactivated';

  select count(*) into v_after_moves from public.inventory_movements where inventory_id = v_inv;
  if v_after_moves <> v_moves then
    raise exception 'FAIL: % inventory movement(s) were written', v_after_moves - v_moves;
  end if;
  select quantity, reserved into v_qty, v_reserved
    from public.shop_inventory where id = v_inv;
  if v_qty <> 1 or v_reserved <> 0 then
    raise exception 'FAIL: stock moved (quantity %, reserved %)', v_qty, v_reserved;
  end if;
  raise notice 'PASS  no inventory movement, no stock booked, nothing oversold';

  if not exists (
    select 1 from public.payment_events
     where provider = 'stripe' and provider_event_id = 'evt_runtime_1'
       and processed_at is not null and outcome = 'late_payment_unresolved'
  ) then
    raise exception 'FAIL: the payment event was not recorded as processed';
  end if;
  raise notice 'PASS  payment event is committed and marked processed';

  -- ---- the same event again -------------------------------------------
  select public.confirm_order_payment(
           p_provider            => 'stripe',
           p_provider_payment_id => 'cs_runtime_late',
           p_amount              => v_total,
           p_currency            => 'eur',
           p_provider_event_id   => 'evt_runtime_1',
           p_event_type          => 'checkout.session.completed'
         ) into v_outcome;
  if v_outcome <> 'duplicate_event' then
    raise exception 'FAIL: redelivery returned %, expected duplicate_event', v_outcome;
  end if;
  raise notice 'PASS  a redelivered event is a duplicate_event';

  -- ---- a DIFFERENT event for the same payment --------------------------
  select public.confirm_order_payment(
           p_provider            => 'stripe',
           p_provider_payment_id => 'cs_runtime_late',
           p_amount              => v_total,
           p_currency            => 'eur',
           p_provider_event_id   => 'evt_runtime_2',
           p_event_type          => 'checkout.session.completed'
         ) into v_outcome;
  if v_outcome <> 'already_confirmed' then
    raise exception 'FAIL: second event returned %, expected already_confirmed', v_outcome;
  end if;
  raise notice 'PASS  a second event for the same payment is already_confirmed';

  select count(*) into v_moves from public.inventory_movements where inventory_id = v_inv;
  if v_moves <> 0 then
    raise exception 'FAIL: % inventory movement(s) after redelivery', v_moves;
  end if;
  select quantity, reserved into v_qty, v_reserved
    from public.shop_inventory where id = v_inv;
  if v_qty <> 1 or v_reserved <> 0 then
    raise exception 'FAIL: stock moved on redelivery (% / %)', v_qty, v_reserved;
  end if;
  raise notice 'PASS  redelivery moved no stock and took no second payment';

  raise notice '----  section 4 complete';
end $$;

rollback;


-- ===========================================================================
-- SECTION 5 — pending_payment_expiries()
--
-- Rolls back. Three attempts with three different holds: one not due, one due
-- within the lead, one already overdue. Then a check that the reader is
-- genuinely read-only.
-- ===========================================================================
begin;

do $$
declare
  v_cat     bigint;
  v_inv     bigint;
  v_order   bigint;
  v_ids     bigint[] := '{}';
  v_i       integer;
  v_before  text;
  v_after   text;
begin
  -- Same chain as section 4: series -> categories -> skylanders -> inventory.
  -- Each section runs in its own transaction and rolls back, so the two never
  -- coexist and both may use series code 'RT' at position 900.
  insert into public.series (code, label, release_year, position)
  values ('RT', 'Runtime Test Series', 2026, 900);

  insert into public.categories (series_code, position, name)
  values ('RT', 92, 'Runtime Test Category') returning id into v_cat;

  insert into public.skylanders (sky_id, name, slug, series_code, category_id)
  values ('SKY-9002', 'Runtime Reader Figure', 'runtime-reader-figure', 'RT', v_cat);

  insert into public.shop_inventory (sky_id, condition, quantity, sale_price, is_listed)
  values ('SKY-9002', 'loose', 9, 10.00, true) returning id into v_inv;

  for v_i in 1..3 loop
    insert into public.orders (order_number, request_id, customer_email,
                               items_subtotal, shipping_amount, total_amount)
    values (public.next_order_number(), gen_random_uuid()::text, 'reader@example.test',
            10.00, 0.00, 10.00)
    returning id into v_order;
    v_ids := v_ids || v_order;

    insert into public.order_lines (order_id, inventory_id, sky_id, condition,
                                    quantity, name_snapshot, unit_price, line_total)
    values (v_order, v_inv, 'SKY-9002', 'loose', 1, 'Runtime Reader Figure', 10.00, 10.00);

    insert into public.order_reservations (order_id, inventory_id, quantity, state, expires_at)
    values (v_order, v_inv, 1, 'active',
            case v_i
              when 1 then now() + interval '15 minutes'  -- not due yet
              when 2 then now() + interval '30 seconds'  -- due within the lead
              else        now() - interval '5 minutes'   -- already overdue
            end);

    insert into public.payment_attempts (order_id, provider, amount, currency,
                                         provider_payment_id, status)
    values (v_order, 'stripe', 10.00, 'EUR', 'cs_reader_' || v_i, 'pending');
  end loop;

  -- ---- a fourth order, whose attempt the provider never saw -------------
  --
  -- Built as its own fixture rather than by clearing the id on one of the
  -- three above. `provider_payment_id` is write-once: 0012's trigger refuses
  -- any change once it is set, NULL included. Resetting one would manufacture
  -- a state the system cannot reach, and the suite would then be asserting
  -- against a database forced into an illegal shape — testing the reader
  -- against a row that could never exist in production proves nothing.
  --
  -- The honest way to have no provider id is to never have attached one:
  -- `start_payment_attempt()` opens an attempt as `created` with the column
  -- NULL, and `attach_provider_payment()` fills it in afterwards. This is
  -- that state, reached the way production reaches it.
  --
  -- Its hold is overdue, but by less than the third order's, so a regression
  -- in the provider-id filter would surface this attempt WITHOUT displacing
  -- the "most overdue sorts first" assertion — the failure stays isolated to
  -- the one check meant to catch it.
  insert into public.orders (order_number, request_id, customer_email,
                             items_subtotal, shipping_amount, total_amount)
  values (public.next_order_number(), gen_random_uuid()::text, 'reader@example.test',
          10.00, 0.00, 10.00)
  returning id into v_order;
  v_ids := v_ids || v_order;

  insert into public.order_lines (order_id, inventory_id, sky_id, condition,
                                  quantity, name_snapshot, unit_price, line_total)
  values (v_order, v_inv, 'SKY-9002', 'loose', 1, 'Runtime Reader Figure', 10.00, 10.00);

  insert into public.order_reservations (order_id, inventory_id, quantity, state, expires_at)
  values (v_order, v_inv, 1, 'active', now() - interval '2 minutes');

  -- 'created', and no provider_payment_id at all.
  insert into public.payment_attempts (order_id, provider, amount, currency, status)
  values (v_order, 'stripe', 10.00, 'EUR', 'created');

  update public.shop_inventory set reserved = 4 where id = v_inv;

  -- ---- who is a candidate at a 60 second lead? --------------------------
  if exists (select 1 from public.pending_payment_expiries('60 seconds', 100)
              where order_id = v_ids[1]) then
    raise exception 'FAIL: an attempt held for 15 more minutes was offered';
  end if;
  raise notice 'PASS  an attempt that is not due yet is not offered';

  if not exists (select 1 from public.pending_payment_expiries('60 seconds', 100)
                  where order_id = v_ids[2]) then
    raise exception 'FAIL: an attempt due within the lead was not offered';
  end if;
  raise notice 'PASS  an attempt due within the lead is offered';

  if not exists (select 1 from public.pending_payment_expiries('60 seconds', 100)
                  where order_id = v_ids[3]) then
    raise exception 'FAIL: an already-overdue hold was not offered';
  end if;
  raise notice 'PASS  an already-overdue hold is offered';

  if (select order_id from public.pending_payment_expiries('60 seconds', 100) limit 1)
     <> v_ids[3] then
    raise exception 'FAIL: the most overdue hold does not sort first';
  end if;
  raise notice 'PASS  the most overdue hold sorts first';

  if (select count(*) from public.pending_payment_expiries('60 seconds', 1)) <> 1 then
    raise exception 'FAIL: p_limit did not bound the result';
  end if;
  raise notice 'PASS  p_limit bounds one tick''s work';

  -- ---- an order that is paid or flagged is never a candidate ------------
  update public.orders set needs_resolution = true where id = v_ids[2];
  if exists (select 1 from public.pending_payment_expiries('60 seconds', 100)
              where order_id = v_ids[2]) then
    raise exception 'FAIL: a flagged order was offered';
  end if;
  raise notice 'PASS  an order needing a human is not offered';

  -- ---- an attempt the provider never saw is never a candidate -----------
  --
  -- v_ids[4] is overdue and its order is pending, so it satisfies every other
  -- condition the reader applies. Only `provider_payment_id is not null`
  -- excludes it, which is the point: there is nothing at the provider to
  -- expire, so offering it to the sweep would be offering it a no-op.
  if exists (select 1 from public.pending_payment_expiries('60 seconds', 100)
              where order_id = v_ids[4]) then
    raise exception 'FAIL: an attempt with no provider payment was offered';
  end if;
  raise notice 'PASS  an attempt the provider never saw is not offered';

  -- ---- the reader mutates nothing ---------------------------------------
  select md5(string_agg(x, '|' order by x)) into v_before from (
    select concat_ws(':', a.id, a.status, coalesce(a.provider_payment_id, '-'),
                     o.payment_status, o.needs_resolution,
                     r.state, r.expires_at, i.quantity, i.reserved) as x
      from public.payment_attempts a
      join public.orders o on o.id = a.order_id
      join public.order_reservations r on r.order_id = o.id
      join public.shop_inventory i on i.id = r.inventory_id
     where o.id = any (v_ids)
  ) s;

  perform public.pending_payment_expiries('60 seconds', 100);
  perform public.pending_payment_expiries('1 hour', 100);
  perform public.pending_payment_expiries('0 seconds', 100);

  select md5(string_agg(x, '|' order by x)) into v_after from (
    select concat_ws(':', a.id, a.status, coalesce(a.provider_payment_id, '-'),
                     o.payment_status, o.needs_resolution,
                     r.state, r.expires_at, i.quantity, i.reserved) as x
      from public.payment_attempts a
      join public.orders o on o.id = a.order_id
      join public.order_reservations r on r.order_id = o.id
      join public.shop_inventory i on i.id = r.inventory_id
     where o.id = any (v_ids)
  ) s;

  if v_before is distinct from v_after then
    raise exception 'FAIL: the reader changed state';
  end if;
  raise notice 'PASS  calling the reader changed nothing';

  raise notice '----  section 5 complete';
end $$;

rollback;


-- ===========================================================================
-- SECTION 6 — final state check
--
-- Run AFTER the sections above. Everything they wrote was rolled back, so
-- this must find nothing.
-- ===========================================================================
do $$
declare
  v_left integer;
begin
  select count(*) into v_left from public.skylanders where sky_id like 'SKY-90%';
  if v_left <> 0 then
    raise exception 'FAIL: % test figure(s) survived a rollback', v_left;
  end if;

  select count(*) into v_left from public.payment_attempts
   where provider_payment_id like 'cs_r%';
  if v_left <> 0 then
    raise exception 'FAIL: % test attempt(s) survived a rollback', v_left;
  end if;

  select count(*) into v_left from public.categories where series_code = 'RT';
  if v_left <> 0 then
    raise exception 'FAIL: % test categor(y/ies) survived a rollback', v_left;
  end if;

  -- Checked last because it is the root of the fixture chain: a surviving
  -- series would also mean the FK from categories had nothing to hold onto.
  select count(*) into v_left from public.series where code = 'RT';
  if v_left <> 0 then
    raise exception 'FAIL: % test series survived a rollback', v_left;
  end if;

  select count(*) into v_left from public.orders
   where customer_email like '%@example.test';
  if v_left <> 0 then
    raise exception 'FAIL: % test order(s) survived a rollback', v_left;
  end if;

  select count(*) into v_left from public.shop_inventory where sky_id like 'SKY-90%';
  if v_left <> 0 then
    raise exception 'FAIL: % test inventory position(s) survived a rollback', v_left;
  end if;

  raise notice 'PASS  the suite left nothing behind';
end $$;
