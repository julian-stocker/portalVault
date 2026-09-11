-- ===========================================================================
-- 0021 — commerce has a mode, and in one of them only named testers may buy
--
-- THE PROBLEM
--
-- SkyIsles needs to be exercised on the real domain, with real accounts and
-- the real database, while Stripe stays in test mode and no ordinary visitor
-- can reach a checkout. Until now "can somebody buy" was not a question the
-- system asked at all: `create_order()` sold to anyone who could reach it.
--
-- THE SHAPE
--
-- One column, one small table, one predicate.
--
--   commerce_settings.mode   closed | sandbox | live
--   commerce_testers         who may buy while the mode is sandbox
--   commerce_checkout_allowed()  the single answer, asked by create_order()
--
-- This is deliberately NOT a feature-flag framework. It is one domain
-- question with three answers, in the table that already holds the commerce
-- configuration and that no client may read.
--
-- WHY THE MODE ALSO LANDS ON THE ORDER
--
-- `orders.commerce_mode` records which world an order was placed in, and the
-- immutability trigger freezes it. A test order must still be recognisable as
-- a test order years later, long after the shop has gone live — a flag that
-- is derived from today's setting would silently rewrite history the moment
-- the setting changes.
--
-- It is also the payment guard: an order may only be paid while the mode it
-- was placed in is still the current one. A sandbox order was priced against
-- test-mode Stripe, so paying it with live keys would be a real charge for a
-- test purchase. The comparison makes that unreachable.
--
-- FAIL CLOSED
--
-- The column defaults to `closed`, so applying this migration stops checkout
-- until somebody deliberately opens it. That is the intended behaviour: on
-- production, silence is the safe answer.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- No role system. `commerce_testers` is an additive permission exactly as
-- `shop_admins` is, and neither implies the other — an administrator is not
-- a tester unless somebody says so. No e-mail address appears in any
-- authorisation path; the admin search may read one, but only to find a
-- `user_id` (ADR-0032).
-- ===========================================================================


-- ===========================================================================
-- 1. The mode
-- ===========================================================================

alter table public.commerce_settings
  add column if not exists mode text not null default 'closed';

alter table public.commerce_settings
  drop constraint if exists commerce_settings_mode_known;

alter table public.commerce_settings
  add constraint commerce_settings_mode_known
    check (mode in ('closed', 'sandbox', 'live'));

comment on column public.commerce_settings.mode is
  'closed = nobody may check out. sandbox = only signed-in accounts listed in commerce_testers, never guests. live = ordinary public commerce. A CHECK rather than an enum, like every other closed set in this schema.';


-- Readable by nobody, like everything else on this table. The public learns
-- what it needs from commerce_access() and nothing more.
create or replace function public.commerce_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.mode from public.commerce_settings s where s.id;
$$;

comment on function public.commerce_mode() is
  'The current commerce mode. Internal: every caller that should see it goes through commerce_access() or an admin function.';

revoke all on function public.commerce_mode() from public, anon, authenticated;


-- ===========================================================================
-- 2. Who may buy in sandbox
--
-- The same shape as `shop_admins`, for the same reasons: the identity is the
-- user id and nothing else, and a deleted account leaves no permission
-- behind. There is nothing here worth preserving after the account is gone.
-- ===========================================================================

create table if not exists public.commerce_testers (
  user_id    uuid        primary key,

  granted_at timestamptz not null default now(),
  granted_by uuid,
  note       text,

  constraint commerce_testers_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete cascade,

  -- Who switched it on. Not an authorisation, a record — and it must survive
  -- that person's own account being deleted.
  constraint commerce_testers_granted_by_fk foreign key (granted_by)
    references auth.users (id)
    on update cascade
    on delete set null
);

comment on table public.commerce_testers is
  'Additive permission: these accounts may check out while commerce_settings.mode is sandbox. Not a role, and unrelated to shop_admins — an administrator is not a tester unless listed here.';

alter table public.commerce_testers enable row level security;
revoke all on public.commerce_testers from anon, authenticated;


-- The caller. Mirrors is_shop_admin() exactly.
create or replace function public.is_commerce_tester()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.commerce_testers
     where user_id = (select auth.uid())
  );
$$;

comment on function public.is_commerce_tester() is
  'True when the calling account is a commerce tester. Reads commerce_testers only: being a shop administrator grants nothing here.';

revoke all on function public.is_commerce_tester() from public, anon, authenticated;


-- A named account, for the privileged callers that hold a user id rather than
-- a session — the payment path. Mirrors is_shop_admin_for() from 0019.
create or replace function public.is_commerce_tester_for(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and exists (
       select 1 from public.commerce_testers t where t.user_id = p_user_id
     );
$$;

comment on function public.is_commerce_tester_for(uuid) is
  'True when the named account is a commerce tester. For callers that hold a user id instead of a session.';

revoke all on function public.is_commerce_tester_for(uuid) from public, anon, authenticated;


-- ===========================================================================
-- 3. The one predicate
--
-- Everything that gates a checkout asks this and nothing else, so there is
-- one place where the rule lives and one place to read it.
-- ===========================================================================

create or replace function public.commerce_checkout_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case public.commerce_mode()
           when 'live'    then true
           -- Signed in AND named. A guest has no user id, so the second
           -- condition alone already excludes guest checkout — the first is
           -- there to say so out loud.
           when 'sandbox' then (select auth.uid()) is not null
                               and public.is_commerce_tester()
           else false
         end;
$$;

comment on function public.commerce_checkout_allowed() is
  'May the calling identity start a checkout right now? closed = never, sandbox = signed-in testers only (never guests), live = anyone.';

revoke all on function public.commerce_checkout_allowed() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- The narrow public projection.
--
-- The interface has to know whether to offer a checkout at all, and the
-- settings table is unreadable on purpose. This answers exactly the question
-- the caller could answer anyway by pressing the button, and nothing else:
-- no limits, no salt, no tester list, and not even the mode name — a visitor
-- learns that checkout is off, not that we are mid-test.
-- ---------------------------------------------------------------------------
create or replace function public.commerce_access()
returns table (may_checkout boolean, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select public.commerce_checkout_allowed(),
         case
           when public.commerce_checkout_allowed() then 'open'
           when public.commerce_mode() = 'sandbox' then 'testers_only'
           else 'closed'
         end;
$$;

comment on function public.commerce_access() is
  'What the current caller may do, for the interface. Never the mode itself, never the tester list, never a setting.';

revoke all on function public.commerce_access() from public;
grant execute on function public.commerce_access() to anon, authenticated;


-- ===========================================================================
-- 4. The order remembers which world it was placed in
--
-- Every order that exists today was placed against Stripe in test mode —
-- there has never been a live key in any deployment — so `sandbox` is the
-- truthful backfill rather than a convenient one.
--
-- No DEFAULT afterwards, deliberately. `create_order()` is the only way an
-- order comes into existence; if a future path forgets to stamp the mode it
-- should fail loudly instead of inheriting a plausible-looking value.
-- ===========================================================================

alter table public.orders
  add column if not exists commerce_mode text;

update public.orders set commerce_mode = 'sandbox' where commerce_mode is null;

alter table public.orders
  alter column commerce_mode set not null;

alter table public.orders
  drop constraint if exists orders_commerce_mode_known;

alter table public.orders
  add constraint orders_commerce_mode_known
    check (commerce_mode in ('closed', 'sandbox', 'live'));

comment on column public.orders.commerce_mode is
  'The commerce mode in force when this order was placed, frozen for ever. A sandbox order stays recognisable as a test order after the shop goes live. Also the payment guard: an order may only be paid while its own mode is the current one.';

create index if not exists orders_sandbox_idx
  on public.orders (placed_at desc)
  where commerce_mode = 'sandbox';


-- The immutability trigger gains one line. `closed` is in the CHECK only so
-- the column can never disagree with the settings column; no order can be
-- placed in that mode, because the predicate above refuses first.
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
     or new.commerce_mode   is distinct from old.commerce_mode
     or new.items_subtotal  is distinct from old.items_subtotal
     or new.shipping_amount is distinct from old.shipping_amount
     or new.discount_amount is distinct from old.discount_amount
     or new.total_amount    is distinct from old.total_amount then
    raise exception 'an order''s identity and amounts are immutable'
      using errcode = 'restrict_violation';
  end if;

  -- The one permitted change: a deleted account releases its order.
  if new.user_id is distinct from old.user_id and new.user_id is not null then
    raise exception 'an order cannot be reassigned to another account'
      using errcode = 'restrict_violation';
  end if;

  -- The abuse fingerprint may only ever be cleared, never set or rewritten.
  -- It exists to throttle unpaid checkouts and has no purpose afterwards, so
  -- dropping it at payment is data minimisation rather than a loss.
  if new.client_hash is distinct from old.client_hash and new.client_hash is not null then
    raise exception 'the client fingerprint cannot be changed, only cleared'
      using errcode = 'restrict_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;


-- ===========================================================================
-- 5. create_order() asks the gate first, and stamps what it was told
--
-- Byte-for-byte the 0016 function with two changes: the permission question
-- at the very top, and `commerce_mode` on the INSERT. Everything else — the
-- two passes, the frozen amounts, the idempotent request id, the capability
-- hash — is untouched, because none of it is what this migration is about.
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
  'Creates an order from a cart, stores the hash of the caller''s payment capability, and holds the stock — in one transaction. Refuses outright unless commerce_checkout_allowed() says this caller may buy, and stamps the mode it was told onto the order. Every position is priced once, the amounts are final before the order row is written, and nothing updates them afterwards.';

revoke all on function public.create_order(text, text, jsonb, jsonb, text, text) from public;
grant execute on function public.create_order(text, text, jsonb, jsonb, text, text) to anon, authenticated;


-- ===========================================================================
-- 6. The payment path asks the same questions again
--
-- `create_order()` is the gate, but a gate that is only checked once is a
-- gate somebody walks around. Two more places ask, and each asks the version
-- of the question that belongs to it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 6a. May this caller pay for this order?
--
-- The 0013 contract, plus one clause: while the mode is sandbox, the account
-- the order belongs to must still be a tester. Withdrawing somebody's tester
-- flag therefore also stops the checkouts they have already opened — which is
-- what "a user who is not enabled cannot use sandbox commerce" has to mean if
-- it is to mean anything.
--
-- `is_commerce_tester_for(o.user_id)` is false for a NULL user id, so a guest
-- order can never be paid in sandbox either. Guest orders cannot be created
-- in sandbox in the first place; this is the second lock on that door.
-- ---------------------------------------------------------------------------
create or replace function public.authorize_order_payment(
  p_order_id bigint,
  p_user_id  uuid default null,
  p_token    text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.orders o
     where o.id = p_order_id
       and (
            -- The account that placed it.
            (p_user_id is not null and o.user_id = p_user_id)
            -- Or the capability issued when it was placed.
         or (
              p_token is not null
              and p_token <> ''
              and o.payment_token_hash is not null
              and o.payment_token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
            )
       )
       and (
            public.commerce_mode() <> 'sandbox'
         or public.is_commerce_tester_for(o.user_id)
       )
  );
$$;

comment on function public.authorize_order_payment(bigint, uuid, text) is
  'May this caller pay for this order: the account that placed it, or the capability issued when it was placed. While the mode is sandbox the order must also belong to a current tester, which excludes guests and withdrawn testers.';

revoke all on function public.authorize_order_payment(bigint, uuid, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6b. May this order be paid at all, right now?
--
-- The 0015 function with one more refusal, in the block that already holds
-- every other reason an order is not payable. It raises `check_violation`,
-- which create-payment already maps to a clean 409 — no new error path.
-- ---------------------------------------------------------------------------
create or replace function public.start_payment_attempt(
  p_order_id bigint,
  p_provider text default 'stripe'
)
returns table (
  attempt_id            bigint,
  amount                numeric,
  amount_cents          integer,
  currency              text,
  status                text,
  reused                boolean,
  created_at            timestamptz,
  provider_payment_id   text,
  provider_checkout_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_open   record;
  v_new    record;
  v_lines  integer;
  v_active integer;
begin
  select o.* into v_order
    from public.orders o
   where o.id = p_order_id
     for update;

  if not found then
    raise exception 'no such order' using errcode = 'no_data_found';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'order % is %, and cannot be paid', v_order.order_number, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  if v_order.needs_resolution then
    raise exception 'order % needs to be looked at before it can be paid', v_order.order_number
      using errcode = 'check_violation';
  end if;

  -- The world it was placed in must still be the world we are in.
  --
  -- A sandbox order was priced and reserved while Stripe was in test mode;
  -- opening an attempt for it after the shop went live would ask a customer
  -- for real money on a test purchase, and the reverse would settle a real
  -- order with test money. Neither is recoverable by an apology, so neither
  -- is reachable.
  if v_order.commerce_mode is distinct from public.commerce_mode() then
    raise exception 'order % was placed in a different commerce mode', v_order.order_number
      using errcode = 'check_violation';
  end if;

  -- Everything it ordered must still be held. A partly-held order cannot be
  -- completed, so it must not be offered for payment.
  select count(*) into v_lines from public.order_lines l where l.order_id = p_order_id;
  select count(*) into v_active
    from public.order_reservations r
   where r.order_id = p_order_id
     and r.state = 'active'
     and r.expires_at > now();

  if v_active < v_lines then
    raise exception 'the hold on order % has lapsed', v_order.order_number
      using errcode = 'check_violation';
  end if;

  -- Already paying. Hand back what is there, including whatever the provider
  -- already knows about it.
  select a.* into v_open
    from public.payment_attempts a
   where a.order_id = p_order_id
     and a.status in ('created', 'pending')
     for update;

  if found then
    attempt_id            := v_open.id;
    amount                := v_open.amount;
    amount_cents          := public.amount_to_cents(v_open.amount);
    currency              := v_open.currency;
    status                := v_open.status;
    reused                := true;
    created_at            := v_open.created_at;
    provider_payment_id   := v_open.provider_payment_id;
    provider_checkout_url := v_open.provider_checkout_url;
    return next;
    return;
  end if;

  insert into public.payment_attempts (order_id, provider, amount, currency)
  values (p_order_id, p_provider, v_order.total_amount, v_order.currency)
  returning * into v_new;

  insert into public.order_events (order_id, event_type, actor_kind)
  values (p_order_id, 'payment_attempt_started', 'system');

  attempt_id            := v_new.id;
  amount                := v_new.amount;
  amount_cents          := public.amount_to_cents(v_new.amount);
  currency              := v_new.currency;
  status                := v_new.status;
  reused                := false;
  created_at            := v_new.created_at;
  provider_payment_id   := v_new.provider_payment_id;
  provider_checkout_url := v_new.provider_checkout_url;
  return next;
end;
$$;

comment on function public.start_payment_attempt(bigint, text) is
  'Opens or reuses the payment attempt for an order. Refuses an order that is not pending, needs a human, has lost its hold, or was placed in a commerce mode other than the current one.';

revoke all on function public.start_payment_attempt(bigint, text)
  from public, anon, authenticated;


-- ===========================================================================
-- 7. The admin surface
--
-- Four functions, each with `is_shop_admin()` in its own body — the grant is
-- to `authenticated` as a whole, so the check inside is the authorisation.
--
-- One rule runs through all of them: an e-mail address is something you may
-- SEARCH by, never something you may be authorised by. `admin_find_accounts()`
-- returns a `user_id`, and `admin_set_commerce_tester()` accepts nothing else.
-- ===========================================================================

create or replace function public.admin_commerce_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode    text;
  v_testers jsonb;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select s.mode into v_mode from public.commerce_settings s where s.id;

  select coalesce(jsonb_agg(t order by t ->> 'granted_at' desc), '[]'::jsonb)
    into v_testers
    from (
      select jsonb_build_object(
               'user_id',    ct.user_id,
               'username',   p.username,
               'email',      u.email,
               'granted_at', ct.granted_at,
               'note',       ct.note,
               'is_admin',   public.is_shop_admin_for(ct.user_id)
             ) as t
        from public.commerce_testers ct
        left join public.profiles p on p.id = ct.user_id
        left join auth.users   u on u.id = ct.user_id
    ) rows;

  return jsonb_build_object(
    'mode', v_mode,
    'testers', v_testers,
    -- How many orders carry each mode. The operator's answer to "did this
    -- test touch anything real", without reading the orders themselves.
    'orders_by_mode', coalesce(
      (select jsonb_object_agg(o.commerce_mode, o.n)
         from (select commerce_mode, count(*) as n
                 from public.orders group by commerce_mode) o),
      '{}'::jsonb)
  );
end;
$$;

comment on function public.admin_commerce_state() is
  'The commerce mode, the tester list and how many orders were placed in each mode. Administrators only.';

revoke all on function public.admin_commerce_state() from public, anon;
grant execute on function public.admin_commerce_state() to authenticated;


-- ---------------------------------------------------------------------------
-- Search, and only search.
--
-- This is the one place in the schema that reads an address from auth.users,
-- and it exists so that an administrator can find the account behind a person
-- they already know. It returns the `user_id` because that is the only thing
-- the next step accepts. Nothing here decides anything (ADR-0032).
--
-- Exact-prefix matching on a trimmed query, capped at ten rows, and an empty
-- query returns nothing: this is a lookup box, not a user directory to browse.
-- ---------------------------------------------------------------------------
create or replace function public.admin_find_accounts(p_query text)
returns table (
  user_id   uuid,
  username  text,
  email     text,
  is_tester boolean,
  is_admin  boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if length(v_query) < 3 then
    return;
  end if;

  return query
    select u.id,
           p.username,
           u.email::text,
           public.is_commerce_tester_for(u.id),
           public.is_shop_admin_for(u.id)
      from auth.users u
      left join public.profiles p on p.id = u.id
     where lower(u.email::text) like v_query || '%'
        or lower(coalesce(p.username, '')) like v_query || '%'
     order by u.created_at
     limit 10;
end;
$$;

comment on function public.admin_find_accounts(text) is
  'Finds accounts by the beginning of their username or address, so an administrator can name a user_id. The address is a search key here and nowhere else — it never authorises anything.';

revoke all on function public.admin_find_accounts(text) from public, anon;
grant execute on function public.admin_find_accounts(text) to authenticated;


create or replace function public.admin_set_commerce_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_mode is null or p_mode not in ('closed', 'sandbox', 'live') then
    raise exception 'unknown commerce mode %', coalesce(p_mode, '(null)')
      using errcode = 'check_violation';
  end if;

  update public.commerce_settings
     set mode = p_mode, updated_at = now()
   where id;

  -- Not an order event — this belongs to no order. The change is visible in
  -- the setting itself and in every order placed after it, which is the only
  -- record that matters: an order's mode cannot be rewritten afterwards.
end;
$$;

comment on function public.admin_set_commerce_mode(text) is
  'Switches commerce between closed, sandbox and live. Administrators only. Orders already placed keep the mode they were placed in.';

revoke all on function public.admin_set_commerce_mode(text) from public, anon;
grant execute on function public.admin_set_commerce_mode(text) to authenticated;


create or replace function public.admin_set_commerce_tester(
  p_user_id uuid,
  p_enabled boolean,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_user_id is null then
    raise exception 'a tester is named by account, never by address'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'no such account' using errcode = 'no_data_found';
  end if;

  if coalesce(p_enabled, false) then
    insert into public.commerce_testers (user_id, granted_by, note)
    values (p_user_id, (select auth.uid()), nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (user_id) do update
      set note = excluded.note;
  else
    -- Withdrawing is a plain delete: unlike the movement journal there is
    -- nothing here worth keeping. What the tester did is in their orders,
    -- and every one of those is stamped `sandbox` for ever.
    delete from public.commerce_testers where user_id = p_user_id;
  end if;
end;
$$;

comment on function public.admin_set_commerce_tester(uuid, boolean, text) is
  'Grants or withdraws sandbox checkout for one account, named by user_id only. Withdrawing also stops checkouts that account has already opened.';

revoke all on function public.admin_set_commerce_tester(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_commerce_tester(uuid, boolean, text) to authenticated;


-- ===========================================================================
-- 8. Putting the stock back after a test purchase
--
-- A sandbox order goes through the real inventory path — that is the point of
-- testing on production — so it really does lower real stock. This books the
-- counter-movements, which is the only way anything is ever corrected in this
-- schema (ADR-0037): nothing is edited, nothing is deleted, a new movement
-- says what happened.
--
-- `return` rather than `correction`: the goods did not come back from a
-- recount, they came back because the sale was not a sale. `return` is the
-- one reason that allows both directions, precisely for this.
--
-- Idempotent through an order event. Running it twice books nothing twice.
-- ===========================================================================

create or replace function public.admin_revert_sandbox_stock(p_order_number text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    record;
  v_row      record;
  v_reverted integer := 0;
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
    raise exception 'no such order' using errcode = 'no_data_found';
  end if;

  -- The whole safety of this function. A live order's stock is a real
  -- customer's goods, and no button in the admin area may put it back.
  if v_order.commerce_mode <> 'sandbox' then
    raise exception 'order % was not placed in sandbox', v_order.order_number
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from public.order_events e
     where e.order_id = v_order.id
       and e.event_type = 'sandbox_stock_reverted'
  ) then
    return 0;
  end if;

  -- Only what was actually converted. A late payment converts fewer positions
  -- than the order has lines, and putting back stock that never left would
  -- invent goods.
  for v_row in
    select r.quantity, i.sky_id, i.condition
      from public.order_reservations r
      join public.shop_inventory i on i.id = r.inventory_id
     where r.order_id = v_order.id
       and r.state = 'converted'
     order by r.id
  loop
    perform public.apply_inventory_movement(
      v_row.sky_id,
      v_row.condition,
      v_row.quantity,
      'return',
      null, null,
      'sandbox test order ' || v_order.order_number,
      (select auth.uid())
    );
    v_reverted := v_reverted + 1;
  end loop;

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order.id, 'sandbox_stock_reverted', 'admin', (select auth.uid()),
          jsonb_build_object('positions', v_reverted));

  return v_reverted;
end;
$$;

comment on function public.admin_revert_sandbox_stock(text) is
  'Books return movements for every position a sandbox order actually sold, so a test purchase does not distort real stock. Refuses any order not placed in sandbox. Idempotent: a second call books nothing.';

revoke all on function public.admin_revert_sandbox_stock(text) from public, anon;
grant execute on function public.admin_revert_sandbox_stock(text) to authenticated;


-- ===========================================================================
-- 9. The order document says which world the order came from
--
-- The 0019 function with two more fields on the `order` object. An operator
-- looking at a test order must be able to see that it is one without cross-
-- referencing anything, and must be able to see whether its stock is still
-- missing from the shelf.
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
      'tracking_number',    v_order.tracking_number,
      'is_guest',           v_order.user_id is null,
      -- Which world this order came from, and — for a sandbox one — whether
      -- the stock it took has already been put back.
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
  'One order as a document: header, address, lines, history and mail delivery, plus the commerce mode it was placed in and whether its sandbox stock has been returned. No client_hash, no payment_token_hash, no request_id, no internal id.';

revoke all on function public.admin_order(text) from public, anon;
grant execute on function public.admin_order(text) to authenticated;


-- ===========================================================================
-- 10. And so does the order list
--
-- A test order must be recognisable at a glance, not only after opening it.
-- The column is appended, so nothing that reads the existing ones moves.
-- The function is dropped and recreated because a `returns table` signature
-- cannot grow in place — the same reason 0007 and 0019 did it.
-- ===========================================================================

drop function if exists public.admin_orders(boolean, integer, integer);

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
  attention          integer,
  commerce_mode      text
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
           r.attention,
           r.commerce_mode
      from ranked r
     where not p_open_only or r.attention <= 1
     order by r.attention, r.placed_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

comment on function public.admin_orders(boolean, integer, integer) is
  'The order list, sorted by what needs attention first, with the commerce mode each order was placed in.';

revoke all on function public.admin_orders(boolean, integer, integer) from public, anon;
grant execute on function public.admin_orders(boolean, integer, integer) to authenticated;
