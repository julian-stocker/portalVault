-- ===========================================================================
-- 0010 — the commerce core: orders, their snapshots, and reserved stock
--
-- Phase A of Commerce V1. It makes two things possible that were not before:
--
--   1. an order can exist                   orders, lines, addresses, events
--   2. stock can be held for one            order_reservations + `reserved`
--
-- and deliberately nothing else. There is no payment, no provider, no
-- invoice, no email and no tax arithmetic in this file. Those are later
-- phases, and two of them are still waiting on decisions that are not
-- technical (the tax regime, the payment provider).
--
-- WHAT THIS DOES NOT TOUCH
--
-- Every existing shop object keeps working exactly as it did: `shop_offers()`,
-- `shop_quantity_available()`, `is_shop_eligible()`, `shop_price()`,
-- `record_inventory_movement()` and `apply_inventory_movement()` are not
-- altered, dropped or re-signed. The cart stays local and non-binding
-- (ADR-0043). The one behavioural change is that `shop_inventory.reserved`
-- finally gets written — the column has existed since 0003 for exactly this,
-- so `available_quantity` (`quantity - reserved`, generated) and every guard
-- that already reads it start working for reservations without being changed.
--
-- THE RESERVATION RULE, IN ONE SENTENCE
--
-- A cart reserves nothing; a checkout reserves everything or nothing.
--
-- CONCURRENCY
--
-- The pattern is the one `apply_inventory_movement` established in 0003 and
-- is not reinvented here: lock the position with SELECT ... FOR UPDATE, then
-- make the availability test part of the UPDATE's WHERE clause so there is no
-- window between deciding and writing. What this file adds is that several
-- positions are locked at once, always in ascending `id` order, so two
-- checkouts over overlapping carts queue instead of deadlocking.
--
-- IDEMPOTENCY
--
-- Three separate guarantees, each enforced by the database rather than by
-- calling code:
--
--   creating an order      unique (request_id)
--   reserving              unique (order_id, inventory_id)
--   converting to a sale   the reservation's own state, changed under the
--                          same lock, plus unique (movement_id)
--
-- Nothing here trusts a caller to "only call it once".
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. How long a checkout may hold stock
--
-- One definition, in the database, because the server decides this and the
-- browser must never be able to. A function rather than a constant in code so
-- that changing it is a one-line migration and not a deployment.
--
-- 20 minutes: long enough for a PayPal detour or a banking app with 2FA,
-- short enough that a one-of-a-kind figure is not withheld from everyone else
-- for half an hour after somebody wandered off. Most used Skylanders are
-- single items, which is what makes the upper bound matter more than the
-- lower one.
--
-- Mirrored by RESERVATION_TTL_MINUTES in src/lib/commerce/reservation.ts;
-- src/lib/commerce/schema.test.ts reads both and fails if they disagree —
-- the same coupling max_cart_quantity() has with cart.ts.
-- ---------------------------------------------------------------------------
create or replace function public.reservation_ttl()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '20 minutes';
$$;

comment on function public.reservation_ttl() is
  'How long a checkout may hold stock before the reservation expires. Server-side only: no client may choose it. Mirrored by RESERVATION_TTL_MINUTES in src/lib/commerce/reservation.ts.';


-- ---------------------------------------------------------------------------
-- 2. Order numbers
--
-- What the customer quotes and what a later invoice references. Not the
-- primary key: a bigint identity stays internal, exactly as it does for
-- shop_inventory and inventory_movements, and the public handle is a separate,
-- readable value.
--
-- A sequence, so two simultaneous checkouts cannot receive the same number —
-- `nextval` is atomic and does not participate in rollback. That last part is
-- the point rather than a defect: an abandoned checkout leaves a gap, and a
-- gap in ORDER numbers means nothing. (Invoice numbers are a different matter
-- and will get their own sequence in the invoice phase, drawn only when an
-- invoice is actually issued.)
--
-- The year is a prefix for human legibility in support, not a reset: the
-- counter runs on across years, so a number is unique for the life of the
-- shop and can never be re-issued.
-- ---------------------------------------------------------------------------
create sequence if not exists public.order_number_seq as bigint start with 1000 increment by 1;

comment on sequence public.order_number_seq is
  'Feeds order_number. Starts at 1000 so the first orders do not advertise that they are the first. Gaps are abandoned checkouts and are expected.';

create or replace function public.next_order_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'SI-' || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('public.order_number_seq')::text, 6, '0');
$$;

comment on function public.next_order_number() is
  'The next public order number, e.g. SI-2026-001000. Race-free via a sequence. Used as a column default; never called by a client.';

-- All three, not just PUBLIC. Supabase's default privileges grant EXECUTE on
-- every new function in `public` to `anon` and `authenticated` explicitly, so
-- revoking the implicit PUBLIC grant alone leaves those two in place. That is
-- how these very functions were briefly reachable after 0010 was first applied.
-- next_order_number() matters most: it is volatile and calls nextval(), so a
-- caller who reaches it can burn order numbers.
revoke all on function public.reservation_ttl()   from public, anon, authenticated;
revoke all on function public.next_order_number() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Checkout limits — the reservation hoarding defence
--
-- THE THREAT
--
-- `create_order()` holds real stock for twenty minutes and must stay callable
-- without an account, because the cart works without one (ADR-0043). A script
-- that calls it repeatedly could keep every single-item figure — which is most
-- of them — permanently unavailable, at no cost to itself. A timeout does not
-- help: a bot simply reserves again the moment the hold lapses.
--
-- WHY THIS LIVES IN THE DATABASE AND NOT IN THE SERVER ACTION
--
-- The application talks to PostgREST with the **anon key** and the visitor's
-- session (ADR-0014, ADR-0017). A server action and a browser calling the RPC
-- directly therefore arrive as the *same* database role, and the anon key is
-- public by design. A limit enforced in TypeScript would be bypassed by one
-- `curl`. The only place a limit cannot be routed around is here.
--
-- WHAT IT COUNTS
--
-- Three questions about one identity, all answered from state that already
-- exists — no counter table, no scheduler, no external service:
--
--   how many checkouts is it holding open?     open reservations
--   how much stock is it sitting on?           reserved units
--   how fast is it creating orders?            orders in the last hour
--
-- IDENTITY IS THREE THINGS, NOT ONE
--
-- Any single dimension is trivially rotated: a bot changes its email between
-- calls, and a signed-in attacker is not the problem. So an order matches an
-- identity if **any** of the account, the address or the client fingerprint
-- matches, and all three are counted together.
--
-- PRIVACY
--
-- The fingerprint is a SHA-256 of the caller's address and a random salt that
-- never leaves the database. **No raw IP address is stored anywhere.** The
-- hash cannot be reversed without the salt, is useless outside this project,
-- and is dropped from an order as soon as it is paid (a paid order needs no
-- abuse fingerprint). Where no address is available the value is NULL and the
-- dimension simply does not apply — it is never a shared constant bucket,
-- which would throttle every visitor as one.
-- ---------------------------------------------------------------------------
create table public.commerce_settings (
  id boolean primary key default true,

  -- Random, generated once, readable by nobody. Without it the fingerprint
  -- below is not reproducible, which is exactly the point.
  client_salt text not null default gen_random_uuid()::text,

  -- Deliberately generous: these stop a script, not a customer. A person who
  -- abandons a checkout, retries after a failed payment and corrects their
  -- basket stays far below all three.
  max_open_checkouts   integer not null default 5,
  max_reserved_units   integer not null default 25,
  max_orders_per_hour  integer not null default 10,

  updated_at timestamptz not null default now(),

  constraint commerce_settings_singleton check (id),
  constraint commerce_settings_limits_positive
    check (max_open_checkouts > 0 and max_reserved_units > 0 and max_orders_per_hour > 0)
);

insert into public.commerce_settings (id) values (true) on conflict (id) do nothing;

comment on table public.commerce_settings is
  'One row. Holds the checkout abuse limits and the salt for the client fingerprint. No client role may read it: the salt is what makes the fingerprint irreversible.';

alter table public.commerce_settings enable row level security;
revoke all on public.commerce_settings from anon, authenticated;


-- The caller's address, hashed. NULL when there is none to hash.
create or replace function public.request_client_hash()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_headers text := current_setting('request.headers', true);
  v_ip      text;
  v_salt    text;
begin
  if v_headers is null or v_headers = '' then
    return null;
  end if;

  -- The left-most entry is the original client; the rest are proxies.
  v_ip := btrim(split_part(coalesce(v_headers::json ->> 'x-forwarded-for', ''), ',', 1));
  if v_ip = '' then
    return null;
  end if;

  select s.client_salt into v_salt from public.commerce_settings s where s.id;
  if v_salt is null then
    return null;
  end if;

  return encode(sha256(convert_to(v_salt || ':' || v_ip, 'utf8')), 'hex');
exception
  when others then
    -- A malformed header must never stop a checkout. Losing one dimension is
    -- acceptable; refusing to sell is not.
    return null;
end;
$$;

comment on function public.request_client_hash() is
  'A salted SHA-256 of the caller''s address, or NULL when none is available. Never stores or returns the address itself (docs/SECURITY.md).';

revoke all on function public.request_client_hash() from public, anon, authenticated;


-- Raises when an identity is already holding more than it should.
create or replace function public.enforce_checkout_limits(
  p_email       text,
  p_user_id     uuid,
  p_client_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits    record;
  v_open      integer;
  v_units     integer;
  v_recent    integer;
begin
  select * into v_limits from public.commerce_settings where id;

  -- Open checkouts and the stock they are sitting on, in one pass.
  select count(distinct o.id), coalesce(sum(r.quantity), 0)
    into v_open, v_units
    from public.orders o
    join public.order_reservations r on r.order_id = o.id
   where r.state = 'active'
     and r.expires_at > now()
     and (
          (p_user_id is not null and o.user_id = p_user_id)
       or lower(o.customer_email) = lower(p_email)
       or (p_client_hash is not null and o.client_hash = p_client_hash)
     );

  if v_open >= v_limits.max_open_checkouts then
    raise exception 'too many checkouts are already open for this customer'
      using errcode = 'too_many_connections';
  end if;

  if v_units >= v_limits.max_reserved_units then
    raise exception 'too much stock is already held for this customer'
      using errcode = 'too_many_connections';
  end if;

  select count(*)
    into v_recent
    from public.orders o
   where o.placed_at > now() - interval '1 hour'
     and (
          (p_user_id is not null and o.user_id = p_user_id)
       or lower(o.customer_email) = lower(p_email)
       or (p_client_hash is not null and o.client_hash = p_client_hash)
     );

  if v_recent >= v_limits.max_orders_per_hour then
    raise exception 'too many checkouts started recently'
      using errcode = 'too_many_connections';
  end if;
end;
$$;

comment on function public.enforce_checkout_limits(text, uuid, text) is
  'Refuses a checkout when one identity — account, address or client fingerprint — is already holding too many open checkouts, too much stock, or has started too many orders in the last hour. Enforced in the database because a server action and a direct RPC call arrive as the same role.';

revoke all on function public.enforce_checkout_limits(text, uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. orders
--
-- The order is also the checkout session. A separate `checkout_sessions`
-- table was considered and rejected: an abandoned session *is* an order that
-- was never paid, and a second table for it would add a join, a second
-- lifecycle and the question of which of the two is right when they diverge.
--
-- TWO STATUSES, NOT ONE
--
-- Paid and shipped are orthogonal. Squeezed into a single column they produce
-- values like `paid_shipped_partially_refunded`, and the combinatorics grow
-- with every new case. Two small closed sets are both smaller and complete.
--
-- Withdrawal, return and complaint are deliberately absent from both. They
-- are separate processes with their own lifecycles — one order may carry two
-- partial withdrawals, a half-arrived return and a complaint at once, which
-- no status column can express. They arrive as their own tables in a later
-- phase.
--
-- WHAT IS NOT HERE, ON PURPOSE
--
--   tax        The regime (§19, §25a, Regelbesteuerung) is an open question
--              for the operator's tax adviser, and each implies a different
--              invoice. Guessing it would be worse than leaving it out:
--              invoices are immutable, so a wrong format is permanent. The
--              invoice phase adds these columns once the answer exists.
--   provider   No payment provider has been chosen. Provider columns arrive
--              with the provider, in the payment phase.
--   shipping   `shipping_amount` exists and is 0 for now. Carrier, countries
--              and prices are open user decisions; the column is here because
--              the total has to be a sum of named parts, not because Phase A
--              knows what to put in it.
-- ---------------------------------------------------------------------------
create table public.orders (
  id            bigint      generated always as identity primary key,

  -- What the customer sees and support quotes. Fixed at insert by the default
  -- and frozen by the trigger in section 9.
  order_number  text        not null default public.next_order_number(),

  -- Idempotency for the checkout button. A double submit carries the same
  -- request_id and gets the same order back instead of a second one.
  request_id    text        not null,

  -- NULL for a guest, and NULL again if the account is later deleted.
  --
  -- ON DELETE SET NULL, never CASCADE. This is the single most important
  -- foreign key in the file: an order is a commercial document with a
  -- retention obligation, and deleting an account must not destroy it. The
  -- same choice inventory_movements.created_by already makes for the same
  -- reason.
  user_id       uuid,

  -- Who to reach about this order, as it was at the time. Carries the order
  -- when the account is gone, and is the only contact a guest order has.
  customer_email text       not null,

  currency      text        not null default 'EUR',

  -- Every amount is a decided fact, never recomputed for display.
  items_subtotal  numeric(10,2) not null,
  shipping_amount numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  total_amount    numeric(10,2) not null,

  payment_status     text not null default 'pending',
  fulfillment_status text not null default 'unfulfilled',

  -- Set when something needs a human: a payment that arrived after the stock
  -- was gone, an amount that does not match. Never resolved automatically.
  --
  -- The payment phase sets it when `convert_order_reservations()` converts
  -- fewer positions than the order has lines — which is exactly the late
  -- payment case: the hold lapsed, the stock went to somebody else, and the
  -- money arrived anyway. Nothing may be oversold to paper over that; an
  -- operator decides between restocking and refunding.
  needs_resolution boolean not null default false,

  -- The salted fingerprint of whoever placed it, for the abuse limits in
  -- section 3. Never an address, and cleared once the order is paid: a paid
  -- order has nothing left to throttle.
  client_hash text,

  placed_at    timestamptz not null default now(),
  paid_at      timestamptz,
  shipped_at   timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at   timestamptz not null default now(),

  constraint orders_number_unique  unique (order_number),
  constraint orders_request_unique unique (request_id),

  constraint orders_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete set null,

  constraint orders_email_present check (customer_email <> '' and customer_email like '%@%'),
  constraint orders_currency_iso  check (currency ~ '^[A-Z]{3}$'),

  -- The closed sets. A CHECK rather than an enum, as with
  -- shop_inventory_condition_known: adding a value later is a constraint
  -- swap, while an enum value cannot be removed again.
  constraint orders_payment_status_known
    check (payment_status in (
      'pending',             -- created, not yet paid
      'paid',
      'failed',              -- an attempt failed; the order may still be paid
      'expired',             -- nobody paid in time
      'cancelled',
      'refunded',
      'partially_refunded'
    )),

  constraint orders_fulfillment_status_known
    check (fulfillment_status in (
      'unfulfilled',
      'preparing',
      'shipped',
      'completed',
      'cancelled'
    )),

  constraint orders_amounts_not_negative
    check (items_subtotal >= 0 and shipping_amount >= 0
           and discount_amount >= 0 and total_amount >= 0),

  -- The total is a sum of named parts, and the database says so. A rounding
  -- slip in application code cannot produce an order whose parts do not add up.
  constraint orders_total_is_the_sum
    check (total_amount = items_subtotal + shipping_amount - discount_amount),

  -- A timestamp is a fact about a state, so the two may not disagree.
  constraint orders_paid_at_matches_status
    check ((paid_at is not null) = (payment_status in ('paid', 'refunded', 'partially_refunded')))
);

comment on table public.orders is
  'One customer order. Also the checkout session: an abandoned checkout is an unpaid order. Payment and fulfillment are tracked separately; withdrawal, return and complaint are separate processes and deliberately not statuses here.';
comment on column public.orders.user_id is
  'The account, or NULL for a guest. ON DELETE SET NULL: deleting an account must never delete a commercial document.';
comment on column public.orders.customer_email is
  'Contact address at the time of the order. Carries the order when the account is gone.';
comment on column public.orders.shipping_amount is
  'Snapshot of the shipping charge. 0 in Phase A: carrier, countries and prices are still open decisions.';
comment on column public.orders.needs_resolution is
  'Something needs a human — a late payment with no stock left, an amount mismatch. Never cleared automatically.';

create index orders_user_idx    on public.orders (user_id) where user_id is not null;
create index orders_placed_idx  on public.orders (placed_at desc);
create index orders_open_idx    on public.orders (payment_status, fulfillment_status);
create index orders_client_idx  on public.orders (client_hash, placed_at) where client_hash is not null;


-- ---------------------------------------------------------------------------
-- 5. order_lines — the snapshot (ADR-0033)
--
-- After the order exists, nothing here depends on `skylanders`,
-- `shop_inventory` or `shop_settings` any more. A later rename, a market
-- price update, a change to the shop-wide percentage or a manual override
-- must not move a line of a historical order by a cent or a character.
--
-- `sky_id` is kept for reporting, and it is deliberately NOT a foreign key
-- with a cascade that could rewrite or remove the row: the line remembers what
-- was sold, not what that article is called today.
-- ---------------------------------------------------------------------------
create table public.order_lines (
  id       bigint generated always as identity primary key,
  order_id bigint not null,

  -- Which article, in the identity the whole shop uses (ADR-0037, ADR-0043).
  sky_id    text    not null,
  condition text    not null,
  quantity  integer not null,

  -- The display snapshot: what stood on the screen when it was bought.
  --
  -- `name_snapshot` is the catalog name as the server knows it — the
  -- administrator's override where one exists, otherwise the imported name.
  -- Not the browser's string: a name that ends up on an invoice must not come
  -- from the buyer. The UI arranges the same name differently for variants
  -- ("Legendary Bash" is shown as "Bash (Legendary)", ADR-0030); that is a
  -- rearrangement of this value, not different information.
  --
  -- `image_snapshot` is the stable reference, not a URL: an uploaded picture's
  -- full address depends on the storage host, which is environment
  -- configuration and has no business being frozen into an order. The two
  -- sources stay distinguishable by shape, exactly as their CHECK constraints
  -- define them — `SKY-0001/<hash>.webp` for an override, `<hash>.webp` for an
  -- imported file (ADR-0046).
  name_snapshot  text not null,
  image_snapshot text,

  -- The money snapshot. Determined by the server from shop_price(), never
  -- accepted from a browser.
  unit_price      numeric(10,2) not null,
  discount_amount numeric(10,2) not null default 0,
  line_total      numeric(10,2) not null,

  -- The stock position this line was reserved against and will be booked
  -- against. Kept so the journal and the order can be reconciled; ON DELETE
  -- RESTRICT because a position with history cannot be removed anyway.
  inventory_id bigint,

  created_at timestamptz not null default now(),

  constraint order_lines_order_fk foreign key (order_id)
    references public.orders (id)
    on update cascade
    on delete restrict,

  constraint order_lines_inventory_fk foreign key (inventory_id)
    references public.shop_inventory (id)
    on update cascade
    on delete restrict,

  -- One line per article and condition. Two lines for the same thing could
  -- never be reconciled against one reservation.
  constraint order_lines_article_unique unique (order_id, sky_id, condition),

  constraint order_lines_sky_id_format check (sky_id ~ '^SKY-[0-9]{4}$'),
  constraint order_lines_condition_known check (condition in ('loose', 'boxed')),
  constraint order_lines_quantity_positive check (quantity > 0),
  constraint order_lines_name_present check (name_snapshot <> ''),
  constraint order_lines_price_positive check (unit_price > 0),
  constraint order_lines_discount_not_negative check (discount_amount >= 0),
  constraint order_lines_total_is_the_sum
    check (line_total = round(unit_price * quantity, 2) - discount_amount)
);

comment on table public.order_lines is
  'One article in an order, frozen at the moment of purchase (ADR-0033). Never updated and never deleted: a paid line is a fact, and corrections are separate documents.';
comment on column public.order_lines.sky_id is
  'Reporting reference only. Deliberately not a cascading foreign key — the line remembers what was sold, not what it is called today.';

create index order_lines_order_idx on public.order_lines (order_id);
create index order_lines_sky_idx   on public.order_lines (sky_id, condition);


-- ---------------------------------------------------------------------------
-- 6. order_addresses
--
-- A table rather than columns on `orders`, for three reasons: shipping and
-- billing have identical structure, a billing address is optional and would
-- otherwise be a second set of mostly-NULL columns, and the order row stays
-- about the order.
--
-- It is a snapshot with no link to any editable profile address. Editing a
-- saved address later must not rewrite where a parcel was actually sent.
-- Guests have no profile at all, which is the same requirement from the other
-- direction.
--
-- Street and house number are separate fields on purpose: DHL and every label
-- API want them apart, and splitting a single line afterwards is guesswork.
--
-- `country_code` is stored but NOT validated against a list of delivery
-- countries — which countries SkyIsles ships to is an open decision, and a
-- CHECK constraint written today would have to be migrated away tomorrow.
-- ---------------------------------------------------------------------------
create table public.order_addresses (
  id       bigint generated always as identity primary key,
  order_id bigint not null,
  kind     text   not null,

  first_name     text not null,
  last_name      text not null,
  company        text,
  street         text not null,
  house_number   text not null,
  address_line_2 text,
  postal_code    text not null,
  city           text not null,
  country_code   text not null,
  phone          text,

  created_at timestamptz not null default now(),

  constraint order_addresses_order_fk foreign key (order_id)
    references public.orders (id)
    on update cascade
    on delete restrict,

  constraint order_addresses_one_per_kind unique (order_id, kind),
  constraint order_addresses_kind_known check (kind in ('shipping', 'billing')),
  constraint order_addresses_country_format check (country_code ~ '^[A-Z]{2}$'),
  constraint order_addresses_required_present
    check (first_name <> '' and last_name <> '' and street <> ''
           and house_number <> '' and postal_code <> '' and city <> '')
);

comment on table public.order_addresses is
  'Where an order was actually sent and billed, frozen at purchase. No link to any editable profile address, and no delivery-country CHECK: the list of countries is still an open decision.';


-- ---------------------------------------------------------------------------
-- 7. order_events — the audit trail
--
-- Append-only, in the spirit of inventory_movements: the order carries its own
-- state, and this records how it got there. Deliberately not event sourcing —
-- the row is the truth, this is the history.
-- ---------------------------------------------------------------------------
create table public.order_events (
  id       bigint generated always as identity primary key,
  order_id bigint not null,

  event_type text not null,

  -- Who caused it. `actor_user_id` follows the journal's rule: a deleted
  -- account leaves the event, anonymised, rather than taking it away.
  actor_kind    text not null,
  actor_user_id uuid,

  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint order_events_order_fk foreign key (order_id)
    references public.orders (id)
    on update cascade
    on delete restrict,

  constraint order_events_actor_fk foreign key (actor_user_id)
    references auth.users (id)
    on update cascade
    on delete set null,

  constraint order_events_actor_kind_known
    check (actor_kind in ('customer', 'admin', 'provider', 'system')),
  constraint order_events_type_present check (event_type <> '')
);

comment on table public.order_events is
  'Append-only history of an order. Never updated, never deleted. Not event sourcing: the order row holds the state, this holds how it was reached.';

create index order_events_order_idx on public.order_events (order_id, created_at);


-- ---------------------------------------------------------------------------
-- 8. order_reservations
--
-- The book. `shop_inventory.reserved` stays the authoritative number and is
-- kept in step in the same transaction — it was not replaced by a sum over
-- this table, because `available_quantity` is a generated stored column over
-- `quantity - reserved`, the partial index for listed positions uses it,
-- `apply_inventory_movement` guards itself with it and `shop_offers()` derives
-- `available` from it. Four places would have had to change; instead the two
-- are reconciled by a verifier, exactly as `SUM(delta) = quantity` already is.
--
-- Expired rows are NOT deleted. A released reservation is a fact about what
-- was held and when, and the reconciliation above needs to be able to explain
-- a number rather than find nothing.
-- ---------------------------------------------------------------------------
create table public.order_reservations (
  id           bigint  generated always as identity primary key,
  order_id     bigint  not null,
  inventory_id bigint  not null,
  quantity     integer not null,

  state text not null default 'active',

  reserved_at  timestamptz not null default now(),
  expires_at   timestamptz not null,
  released_at  timestamptz,
  converted_at timestamptz,

  -- The stock movement this reservation became, once it was sold. Also the
  -- structural guarantee that it can only ever become one.
  movement_id bigint,

  constraint order_reservations_order_fk foreign key (order_id)
    references public.orders (id)
    on update cascade
    on delete restrict,

  constraint order_reservations_inventory_fk foreign key (inventory_id)
    references public.shop_inventory (id)
    on update cascade
    on delete restrict,

  constraint order_reservations_movement_fk foreign key (movement_id)
    references public.inventory_movements (id)
    on update cascade
    on delete restrict,

  -- One reservation per order and position: reserving twice for the same
  -- order is structurally impossible rather than merely discouraged.
  constraint order_reservations_one_per_position unique (order_id, inventory_id),

  -- One movement can belong to at most one reservation. With the state guard
  -- in convert_order_reservations() this is what makes a double conversion
  -- unable to sell the same stock twice.
  constraint order_reservations_movement_unique unique (movement_id),

  constraint order_reservations_quantity_positive check (quantity > 0),

  -- Three states and no more. `active` holds stock; the other two do not, and
  -- both are terminal.
  constraint order_reservations_state_known
    check (state in ('active', 'released', 'converted')),

  -- A state and its timestamp cannot disagree.
  constraint order_reservations_released_consistent
    check ((state = 'released') = (released_at is not null)),
  constraint order_reservations_converted_consistent
    check ((state = 'converted') = (converted_at is not null)),
  constraint order_reservations_movement_only_when_converted
    check (movement_id is null or state = 'converted')
);

comment on table public.order_reservations is
  'Stock held for one order between checkout and payment. The ledger behind shop_inventory.reserved, which stays the authoritative number and is kept in step in the same transaction. Expired rows are released, never deleted: what was held and when is auditable.';
comment on column public.order_reservations.state is
  'active holds stock. released and converted are terminal and hold none.';

create index order_reservations_order_idx on public.order_reservations (order_id);
create index order_reservations_due_idx
  on public.order_reservations (expires_at)
  where state = 'active';


-- ---------------------------------------------------------------------------
-- 9. Grants — read only, and only for the owner
--
-- No client role receives INSERT, UPDATE or DELETE on any table in this file.
-- Every mutation goes through a function below that checks for itself who is
-- asking. `anon` receives nothing at all: guest order lookup needs a token and
-- arrives, with its own function, in a later phase.
-- ---------------------------------------------------------------------------
alter table public.orders             enable row level security;
alter table public.order_lines        enable row level security;
alter table public.order_addresses    enable row level security;
alter table public.order_events       enable row level security;
alter table public.order_reservations enable row level security;

revoke all on public.orders, public.order_lines, public.order_addresses,
              public.order_events, public.order_reservations
  from anon, authenticated;

grant select on public.orders, public.order_lines, public.order_addresses
  to authenticated;

-- Deliberately not granted to any client role: reservations and the audit
-- trail are internal. The administrator reads them through a function.
-- order_events and order_reservations keep no client privilege at all.

-- --- A customer sees their own orders, and nothing else -------------------
--
-- A guest order has no auth.uid() and therefore cannot be expressed as a
-- policy at all — which is the correct outcome for now: it stays unreadable
-- by any client until the token function exists.

create policy orders_select_own on public.orders
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy order_lines_select_own on public.order_lines
  for select to authenticated
  using (exists (
    select 1 from public.orders o
     where o.id = order_lines.order_id
       and o.user_id = (select auth.uid())
  ));

create policy order_addresses_select_own on public.order_addresses
  for select to authenticated
  using (exists (
    select 1 from public.orders o
     where o.id = order_addresses.order_id
       and o.user_id = (select auth.uid())
  ));

-- No INSERT, UPDATE or DELETE policy exists on any of these tables, so no
-- client role can write to them whatever privileges are granted later.


-- ---------------------------------------------------------------------------
-- 10. Immutability
--
-- What a customer agreed to pay does not change afterwards. Corrections are
-- separate documents in a later phase, never an UPDATE of history.
--
-- The orders trigger is the subtle one: `user_id` has to remain changeable in
-- exactly one direction, because ON DELETE SET NULL performs an UPDATE when
-- an account is deleted. Anything else about the money and the identity is
-- frozen.
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

create trigger orders_immutable
  before update on public.orders
  for each row execute function public.orders_protect_immutable();

create or replace function public.deny_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.deny_write() is
  'Refuses UPDATE and DELETE. Used on the tables that record what happened rather than what is: order lines, addresses and events.';

-- A sold line, the address it went to and the history of the order are facts.
create trigger order_lines_append_only
  before update or delete on public.order_lines
  for each row execute function public.deny_write();

create trigger order_addresses_append_only
  before update or delete on public.order_addresses
  for each row execute function public.deny_write();

create trigger order_events_append_only
  before update or delete on public.order_events
  for each row execute function public.deny_write();

-- Reservations are NOT append-only: their whole purpose is to change state
-- from active to released or converted. Deleting one, however, would destroy
-- the explanation for a `reserved` figure.
create or replace function public.reservations_deny_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a reservation is released, never deleted'
    using errcode = 'restrict_violation';
end;
$$;

create trigger order_reservations_no_delete
  before delete on public.order_reservations
  for each row execute function public.reservations_deny_delete();


-- ---------------------------------------------------------------------------
-- 11. release_expired_reservations() — giving stock back
--
-- Idempotent by construction: only rows still in `active` are touched, and the
-- state change happens in the same statement that lowers `reserved`. A second
-- call finds nothing and lowers nothing.
--
-- `p_inventory_ids` scopes it. NULL means "everything", which is what a
-- scheduled job wants; an array is what the checkout below passes so that it
-- sweeps only the positions it is about to lock, while holding those locks.
--
-- HOW THIS IS MEANT TO RUN
--
-- Two layers, and the important one is the first:
--
--   1. synchronously, inside reserve_for_order(), for the positions being
--      reserved. The customer who wants the article does the cleaning, so
--      contention resolves itself immediately and correctly.
--   2. later, a scheduled job calling this with no argument, purely so that
--      `shop_offers().available` does not show a stale "sold out" to
--      browsers who never attempt a checkout.
--
-- Layer 2 is cosmetic. Nothing that decides anything depends on it having
-- run, which is why a late or missed job cannot produce an inconsistent
-- booking. NO SCHEDULER IS INSTALLED BY THIS MIGRATION — that is an
-- infrastructure decision of its own.
-- ---------------------------------------------------------------------------
create or replace function public.release_expired_reservations(
  p_inventory_ids bigint[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer := 0;
  v_row      record;
begin
  for v_row in
    select r.id, r.inventory_id, r.quantity
      from public.order_reservations r
     where r.state = 'active'
       and r.expires_at <= now()
       and (p_inventory_ids is null or r.inventory_id = any (p_inventory_ids))
     -- Ascending inventory id: the same order every caller takes, so a sweep
     -- and a checkout cannot deadlock against each other.
     order by r.inventory_id, r.id
     for update of r
  loop
    -- The state change is the guard. If a concurrent call already released
    -- this row, no row matches and `reserved` is not touched again.
    update public.order_reservations
       set state = 'released', released_at = now()
     where id = v_row.id
       and state = 'active';

    if found then
      -- Loud, not forgiving. A valid active reservation means `reserved` is at
      -- least its quantity; if it is not, the ledger and the counter have
      -- already diverged, and clamping to zero would hide that forever. The
      -- whole transaction rolls back instead, leaving the reservation active
      -- and the inconsistency visible to verify:commerce.
      update public.shop_inventory
         set reserved = reserved - v_row.quantity
       where id = v_row.inventory_id
         and reserved >= v_row.quantity;

      if not found then
        raise exception
          'reserved on position % is below the reservation being released (%)',
          v_row.inventory_id, v_row.quantity
          using errcode = 'data_corrupted';
      end if;

      v_released := v_released + 1;
    end if;
  end loop;

  return v_released;
end;
$$;

comment on function public.release_expired_reservations(bigint[]) is
  'Releases reservations whose time is up and lowers shop_inventory.reserved by the same amount. Idempotent. Pass NULL for every position (a scheduled sweep) or an array to scope it to the positions a checkout is about to lock. No scheduler is installed by migration 0010.';

revoke all on function public.release_expired_reservations(bigint[]) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 12. release_order_reservations() — the checkout gave up
--
-- For an order that expired, failed or was cancelled. Same guard, same
-- idempotency: a second call releases nothing a second time.
-- ---------------------------------------------------------------------------
create or replace function public.release_order_reservations(p_order_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer := 0;
  v_row      record;
begin
  for v_row in
    select r.id, r.inventory_id, r.quantity
      from public.order_reservations r
     where r.order_id = p_order_id
       and r.state = 'active'
     order by r.inventory_id, r.id
     for update of r
  loop
    update public.order_reservations
       set state = 'released', released_at = now()
     where id = v_row.id
       and state = 'active';

    if found then
      -- Same rule as the sweep: an impossible number is raised, never clamped.
      update public.shop_inventory
         set reserved = reserved - v_row.quantity
       where id = v_row.inventory_id
         and reserved >= v_row.quantity;

      if not found then
        raise exception
          'reserved on position % is below the reservation being released (%)',
          v_row.inventory_id, v_row.quantity
          using errcode = 'data_corrupted';
      end if;

      v_released := v_released + 1;
    end if;
  end loop;

  return v_released;
end;
$$;

comment on function public.release_order_reservations(bigint) is
  'Releases every active reservation of one order. Idempotent: a second call lowers nothing again.';

revoke all on function public.release_order_reservations(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 13. reserve_for_order() — all of it, or none of it
--
-- The heart of the file. For an order that already has its lines, it holds
-- every position or it holds nothing.
--
-- The sequence, and why it is in this order:
--
--   1. collect the positions, ordered by inventory id. The fixed order is the
--      deadlock protection: two checkouts over overlapping carts queue
--      instead of each holding what the other needs.
--   2. lock them all with SELECT ... FOR UPDATE.
--   3. sweep expired reservations on exactly those positions, while holding
--      the locks — so a stale hold cannot cause a false refusal.
--   4. re-check eligibility, listing and price. The cart may be minutes old
--      and the article may have been withdrawn since.
--   5. raise `reserved` with the availability test inside the UPDATE's WHERE
--      clause. No row updated means not enough stock.
--
-- Any failure raises, and PostgREST runs one RPC in one transaction, so the
-- whole thing rolls back. There is no such thing as a half-reserved order:
-- if Bash is available and Spyro is not, Bash is not held either.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_for_order(p_order_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids      bigint[];
  v_expires  timestamptz := now() + public.reservation_ttl();
  v_row      record;
  v_count    integer := 0;
begin
  select array_agg(distinct l.inventory_id order by l.inventory_id)
    into v_ids
    from public.order_lines l
   where l.order_id = p_order_id
     and l.inventory_id is not null;

  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'order % has no reservable lines', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- 2. Lock every position at once, always in the same order.
  perform 1
     from public.shop_inventory i
    where i.id = any (v_ids)
    order by i.id
      for update;

  -- 3. Now that they are held, reclaim anything that has run out of time.
  perform public.release_expired_reservations(v_ids);

  for v_row in
    select l.id, l.inventory_id, l.quantity, l.sky_id, l.condition
      from public.order_lines l
     where l.order_id = p_order_id
       and l.inventory_id is not null
     order by l.inventory_id
  loop
    -- 4. Still sellable at all? Same rules as shop_offers(), asked of the
    --    same functions rather than copied.
    if not exists (
      select 1
        from public.shop_inventory i
        join public.skylanders s on s.sky_id = i.sky_id
        cross join public.shop_settings st
       where i.id = v_row.inventory_id
         and i.is_listed
         and public.is_shop_eligible(i.sky_id)
         and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
    ) then
      raise exception 'article % / % is no longer offered', v_row.sky_id, v_row.condition
        using errcode = 'check_violation';
    end if;

    -- 5. The guard is the WHERE clause, not a preceding SELECT.
    update public.shop_inventory
       set reserved = reserved + v_row.quantity
     where id = v_row.inventory_id
       and quantity - reserved >= v_row.quantity;

    if not found then
      raise exception 'not enough stock for % / %', v_row.sky_id, v_row.condition
        using errcode = 'check_violation';
    end if;

    insert into public.order_reservations
      (order_id, inventory_id, quantity, expires_at)
    values
      (p_order_id, v_row.inventory_id, v_row.quantity, v_expires);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.reserve_for_order(bigint) is
  'Holds stock for every line of an order, or holds none of it. Locks all positions in ascending id order, sweeps expired holds while locked, re-checks eligibility and price, and tests availability inside the UPDATE. Reserves nothing outright: quantity is untouched and no movement is written, because nothing has been sold.';

revoke all on function public.reserve_for_order(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 14. convert_order_reservations() — the sale, when a payment is confirmed
--
-- Built now although no payment provider exists, because it is a pure database
-- primitive: the payment phase should have nothing left to invent, only this
-- function to call.
--
-- WHY THIS IS SAFE TO CALL TWICE
--
-- The reservation's own state is the idempotency token. The UPDATE that moves
-- it from `active` to `converted` carries `and state = 'active'` in its WHERE
-- clause, under the position's lock — so the second caller finds no row,
-- books nothing and writes no movement. `unique (movement_id)` is the second
-- line of defence.
--
-- ORDER MATTERS
--
-- `reserved` is lowered BEFORE the movement is booked. apply_inventory_movement
-- guards itself with `quantity + delta >= reserved`, so booking first would
-- fail on a single item — the order's own reservation would be standing in its
-- own way.
--
-- Both figures fall by the same amount, so `available_quantity` does not move.
-- That is correct: the article was already spoken for.
-- ---------------------------------------------------------------------------
create or replace function public.convert_order_reservations(p_order_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row         record;
  v_movement_id bigint;
  v_converted   integer := 0;
begin
  for v_row in
    select r.id, r.inventory_id, r.quantity, i.sky_id, i.condition
      from public.order_reservations r
      join public.shop_inventory i on i.id = r.inventory_id
     where r.order_id = p_order_id
       and r.state = 'active'
     order by r.inventory_id, r.id
     for update of r
  loop
    -- Claim it first. Whoever wins this UPDATE books the movement; a
    -- concurrent or repeated call gets nothing and does nothing.
    update public.order_reservations
       set state = 'converted', converted_at = now()
     where id = v_row.id
       and state = 'active';

    if not found then
      continue;
    end if;

    -- Release the hold before booking, or the guard below trips on it.
    -- Guarded rather than clamped: if `reserved` cannot cover this
    -- reservation, the transaction rolls back and the reservation stays
    -- `active` with no movement written. A half-converted order — state moved,
    -- nothing sold — is the one outcome that must be impossible.
    update public.shop_inventory
       set reserved = reserved - v_row.quantity
     where id = v_row.inventory_id
       and reserved >= v_row.quantity;

    if not found then
      raise exception
        'reserved on position % is below the reservation being converted (%)',
        v_row.inventory_id, v_row.quantity
        using errcode = 'data_corrupted';
    end if;

    -- The existing internal path: it lowers quantity and writes the
    -- append-only journal entry in one step. No second inventory
    -- architecture, and no actor — this is a system booking.
    v_movement_id := public.apply_inventory_movement(
      v_row.sky_id,
      v_row.condition,
      -v_row.quantity,
      'sale_skyisles',
      null, null,
      'order ' || p_order_id::text,
      null
    );

    update public.order_reservations
       set movement_id = v_movement_id
     where id = v_row.id;

    v_converted := v_converted + 1;
  end loop;

  return v_converted;
end;
$$;

comment on function public.convert_order_reservations(bigint) is
  'Turns an order''s held stock into a sale: lowers reserved, lowers quantity and writes one sale_skyisles movement per position through the existing journal. Idempotent — the reservation state is claimed under lock, so a repeated call books nothing twice. Only an ACTIVE reservation converts: one that already expired and was released stays released, and the returned count is then lower than the order has lines. The payment phase must compare the two and set needs_resolution rather than oversell. Called by the payment phase; nothing calls it yet.';

revoke all on function public.convert_order_reservations(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 15. create_order() — the only way an order comes into being
--
-- The browser sends what it wants, never what it costs. Every price is read
-- here from shop_price(), every article is re-checked against
-- is_shop_eligible(), and the totals are computed from those values. A cart
-- that claims a figure costs 1 cent produces an order at the real price.
--
-- Guest orders are supported: `auth.uid()` may be NULL, and the email is
-- always stored. No placeholder profile row is invented for a guest.
--
-- `p_items` is a JSON array of {sky_id, condition, quantity}. JSON because the
-- list is variable length; every value inside it is validated here rather than
-- trusted.
--
-- Idempotent through `request_id`: a double-submitted checkout returns the
-- order it already created instead of a second one.
-- ---------------------------------------------------------------------------
create or replace function public.create_order(
  p_request_id text,
  p_email      text,
  p_items      jsonb,
  p_address    jsonb
)
returns table (order_id bigint, order_number text)
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
begin
  if p_request_id is null or length(p_request_id) < 8 then
    raise exception 'a checkout needs a request id' using errcode = 'check_violation';
  end if;

  -- Already done. Hand back the same order rather than making a second one.
  select o.id, o.order_number into v_order_id, v_number
    from public.orders o
   where o.request_id = p_request_id;
  if found then
    order_id := v_order_id; order_number := v_number; return next; return;
  end if;

  if p_email is null or p_email not like '%@%' then
    raise exception 'a checkout needs a contact address' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a checkout needs at least one article' using errcode = 'check_violation';
  end if;

  -- Who is asking, as far as this is knowable without storing an address.
  v_client := public.request_client_hash();

  -- Before anything is written or held. Idempotency (the request_id above)
  -- stops a double click; this stops a script — they are different problems
  -- and neither substitutes for the other.
  perform public.enforce_checkout_limits(p_email, v_user_id, v_client);

  insert into public.orders
    (request_id, user_id, customer_email, client_hash, items_subtotal, total_amount)
  values
    (p_request_id, v_user_id, p_email, v_client, 0, 0)
  returning id, orders.order_number into v_order_id, v_number;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_sky_id := v_item ->> 'sky_id';
    v_cond   := v_item ->> 'condition';
    v_qty    := nullif(v_item ->> 'quantity', '')::integer;

    if v_qty is null or v_qty < 1 or v_qty > public.max_cart_quantity() then
      raise exception 'invalid quantity for %', v_sky_id using errcode = 'check_violation';
    end if;

    -- Price, name and stock position, all from the database. Nothing the
    -- caller sent about money is read.
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

  -- The amounts are written once, from what the server just decided. Shipping
  -- stays 0 until the shipping decision exists.
  update public.orders
     set items_subtotal = v_subtotal,
         total_amount   = v_subtotal
   where id = v_order_id;

  insert into public.order_addresses
    (order_id, kind, first_name, last_name, company, street, house_number,
     address_line_2, postal_code, city, country_code, phone)
  values
    (v_order_id, 'shipping',
     p_address ->> 'first_name', p_address ->> 'last_name', p_address ->> 'company',
     p_address ->> 'street', p_address ->> 'house_number', p_address ->> 'address_line_2',
     p_address ->> 'postal_code', p_address ->> 'city',
     upper(coalesce(p_address ->> 'country_code', '')), p_address ->> 'phone');

  -- All of it or none of it. A failure here rolls back the order too.
  perform public.reserve_for_order(v_order_id);

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id)
  values (v_order_id, 'placed', case when v_user_id is null then 'system' else 'customer' end, v_user_id);

  order_id := v_order_id;
  order_number := v_number;
  return next;
end;
$$;

comment on function public.create_order(text, text, jsonb, jsonb) is
  'Creates an order from a cart and holds its stock, in one transaction. Prices, names and availability are read from the database; nothing the caller says about money is used. Works for guests (auth.uid() may be NULL). Idempotent through request_id.';

revoke all on function public.create_order(text, text, jsonb, jsonb) from public;
grant execute on function public.create_order(text, text, jsonb, jsonb) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 16. Reconciliation — the same shape the stock journal already has
--
-- `shop_inventory.reserved` must equal the sum of what is actually held. This
-- view is what a verifier compares, exactly as
-- shop_inventory_reconciliation compares quantity against SUM(delta).
-- ---------------------------------------------------------------------------
create or replace view public.reservation_reconciliation as
  select
    i.id            as inventory_id,
    i.sky_id,
    i.condition,
    i.quantity,
    i.reserved,
    coalesce(h.held, 0)::integer          as held,
    (i.reserved - coalesce(h.held, 0))::integer as drift
  from public.shop_inventory i
  left join (
    select r.inventory_id, sum(r.quantity) as held
      from public.order_reservations r
     where r.state = 'active'
     group by r.inventory_id
  ) h on h.inventory_id = i.id;

comment on view public.reservation_reconciliation is
  'reserved against the sum of active reservations, per position. drift must be 0 everywhere; npm run verify:commerce asserts it.';

revoke all on public.reservation_reconciliation from anon, authenticated;
