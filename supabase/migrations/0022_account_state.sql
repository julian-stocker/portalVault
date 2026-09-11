-- ===========================================================================
-- 0022 — the cart and the delivery details belong to an account, not a browser
--
-- WHAT WENT WRONG
--
-- Every piece of checkout state lived under a fixed, principal-less browser
-- key: the cart in `localStorage["skyisles.cart.v1"]`, the open order in
-- `sessionStorage["skyisles.pay.v1.open"]`, the capability in
-- `sessionStorage["skyisles.pay.v1.<number>"]`. The browser was the identity,
-- not the account — so signing out and in as somebody else changed nothing
-- about what those keys held, and the second account was shown the first
-- account's basket and open order.
--
-- WHY THIS IS A TABLE AND NOT A BETTER STORAGE KEY
--
-- Namespacing the key by user id would hide one account's basket from
-- another. It would not make it unreachable: every account's basket would
-- still be sitting in that browser, readable by any script on the origin and
-- by the next person at that computer. This schema has exactly one mechanism
-- for "only the owner", used by `collection_items` since 0001, and it is RLS
-- over `auth.uid()`. A signed-in cart belongs in it.
--
-- ADR-0043 named `serverseitiger Warenkorb, Kontobindung des Warenkorbs`
-- under **Nicht in dieser Runde**. This is that round; the decision is being
-- carried out, not overturned. Guests keep the local cart, because a guest
-- has no account to hang one on.
--
-- WHAT THIS DOES NOT CHANGE
--
-- A cart still reserves nothing, books no movement and touches neither
-- `shop_inventory` nor `reserved`. It holds an intention, and only
-- `create_order()` turns an intention into a hold. Prices are still read from
-- `shop_offers()` at checkout, never from a stored figure.
--
-- And the order address stays a snapshot. `customer_contacts` is a default to
-- prefill a form with; `order_addresses` is what was actually agreed, frozen
-- by the append-only trigger from 0010. Editing the first never touches the
-- second — that is the whole reason they are two tables.
-- ===========================================================================


-- ===========================================================================
-- 1. The signed-in cart
--
-- Same identity as everywhere else in the shop: `(sky_id, condition)` is a
-- line, a position and an offer (ADR-0043). One rule, now four places.
-- ===========================================================================

create table if not exists public.cart_items (
  user_id    uuid    not null,
  sky_id     text    not null,
  condition  text    not null,

  quantity   integer not null,

  -- What it cost when it went in. Displayed only as "the price has changed";
  -- every sum is recomputed from `shop_offers()` (ADR-0043). Never authoritative.
  price_at_add numeric(10,2),

  added_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cart_items_pk primary key (user_id, sky_id, condition),

  constraint cart_items_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete cascade,

  -- A basket line must name something that exists. `restrict` would block the
  -- deletion of a figure somebody happens to have in a basket, which is the
  -- wrong trade for a non-binding intention.
  constraint cart_items_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id)
    on update cascade
    on delete cascade,

  constraint cart_items_condition_known check (condition in ('loose', 'boxed')),
  constraint cart_items_quantity_sane   check (quantity >= 1 and quantity <= 99),
  constraint cart_items_price_positive  check (price_at_add is null or price_at_add > 0)
);

comment on table public.cart_items is
  'One signed-in account''s basket. Reserves nothing and books nothing — an intention, not a hold. Guests keep a local cart; an account gets this one so that two accounts on one browser cannot see each other''s (ADR-0061).';

alter table public.cart_items enable row level security;

-- The `collection_items` shape from 0001, unchanged: USING decides which rows
-- may be touched, WITH CHECK decides what they may become.
drop policy if exists cart_items_select_own on public.cart_items;
create policy cart_items_select_own on public.cart_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists cart_items_insert_own on public.cart_items;
create policy cart_items_insert_own on public.cart_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists cart_items_update_own on public.cart_items;
create policy cart_items_update_own on public.cart_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists cart_items_delete_own on public.cart_items;
create policy cart_items_delete_own on public.cart_items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- `anon` gets nothing at all: a guest has no account, so there is no row here
-- that could be theirs.
revoke all on public.cart_items from anon;
grant select, insert, update, delete on public.cart_items to authenticated;


-- ===========================================================================
-- 2. The delivery details an account keeps
--
-- Deliberately NOT columns on `profiles`. A profile is the public half of an
-- identity — username, avatar — and this is a postal address and a telephone
-- number. Putting them in one table would mean one policy deciding for both,
-- and the day somebody widens profile reads for a public collector page, a
-- street address goes with it.
-- ===========================================================================

create table if not exists public.customer_contacts (
  user_id uuid primary key,

  -- The contact address for orders. May differ from the sign-in address:
  -- where the confirmation should go is the customer's decision, and
  -- `orders.customer_email` snapshots whatever the checkout actually used.
  email text,

  first_name     text,
  last_name      text,
  company        text,
  street         text,
  house_number   text,
  address_line_2 text,
  postal_code    text,
  city           text,
  country_code   text,
  phone          text,

  updated_at timestamptz not null default now(),

  constraint customer_contacts_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete cascade,

  -- Shape only, and every field nullable: this is a half-filled form somebody
  -- may save at any point, not a completed order. `create_order()` is what
  -- decides whether a delivery is actually addressable, and it has not
  -- changed.
  constraint customer_contacts_email_shape
    check (email is null or (email <> '' and email like '%@%')),
  constraint customer_contacts_country_shape
    check (country_code is null or country_code ~ '^[A-Z]{2}$')
);

comment on table public.customer_contacts is
  'One account''s saved contact and delivery details, used to prefill a checkout. Never authoritative for an order: order_addresses holds the immutable snapshot of what was actually agreed (ADR-0061).';

alter table public.customer_contacts enable row level security;

drop policy if exists customer_contacts_select_own on public.customer_contacts;
create policy customer_contacts_select_own on public.customer_contacts
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists customer_contacts_insert_own on public.customer_contacts;
create policy customer_contacts_insert_own on public.customer_contacts
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists customer_contacts_update_own on public.customer_contacts;
create policy customer_contacts_update_own on public.customer_contacts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists customer_contacts_delete_own on public.customer_contacts;
create policy customer_contacts_delete_own on public.customer_contacts
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.customer_contacts from anon;
grant select, insert, update, delete on public.customer_contacts to authenticated;


-- ===========================================================================
-- 3. Merging a guest basket into an account, once, at sign-in
--
-- The rule has to be deterministic, because it runs without anybody watching:
-- quantities add up, and the sum is capped by the same `max_cart_quantity()`
-- the shop already enforces. Taking the larger of the two would silently drop
-- a line somebody chose; summing without a cap would produce a basket the
-- checkout refuses.
--
-- Idempotent by construction: the caller clears the guest basket afterwards,
-- and re-running with the same lines simply re-caps to the same numbers only
-- if it is called with lines the account does not already hold. A repeat with
-- an already-empty guest basket is a no-op.
-- ===========================================================================

create or replace function public.merge_guest_cart(p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_line  jsonb;
  v_sky   text;
  v_cond  text;
  v_qty   integer;
  v_price numeric(10,2);
  v_max   integer := public.max_cart_quantity();
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'a basket needs an account to be merged into'
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_lines) <> 'array' then
    return 0;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_sky  := v_line ->> 'sky_id';
    v_cond := v_line ->> 'condition';
    v_qty  := nullif(v_line ->> 'quantity', '')::integer;
    v_price := nullif(v_line ->> 'price_at_add', '')::numeric(10,2);

    -- A malformed line is skipped, not raised on. This runs during a sign-in;
    -- a stale basket from an old release must not be able to block it.
    -- coalesce, not a bare comparison: `null not in (...)` is NULL, and
    -- `continue when NULL` does not continue — a malformed line would then
    -- reach the INSERT and abort the whole sign-in on a CHECK.
    continue when v_sky is null or coalesce(v_cond, '') not in ('loose', 'boxed');
    continue when v_qty is null or v_qty < 1;
    continue when not exists (select 1 from public.skylanders s where s.sky_id = v_sky);

    insert into public.cart_items (user_id, sky_id, condition, quantity, price_at_add)
    values (v_user, v_sky, v_cond, least(v_qty, v_max),
            case when v_price is not null and v_price > 0 then v_price end)
    on conflict (user_id, sky_id, condition) do update
      set quantity   = least(cart_items.quantity + excluded.quantity, v_max),
          updated_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.merge_guest_cart(jsonb) is
  'Adds a guest basket''s lines to the calling account''s basket, summing quantities and capping at max_cart_quantity(). Malformed lines are skipped rather than raised on: this runs during sign-in.';

revoke all on function public.merge_guest_cart(jsonb) from public, anon;
grant execute on function public.merge_guest_cart(jsonb) to authenticated;


-- ===========================================================================
-- 4. The payment state says how many attempts there have been
--
-- The interface was offering "Zahlung erneut starten" to a customer who had
-- never started one, because the button was chosen by "is there an order"
-- rather than by what had happened to it. It cannot be chosen correctly
-- without this number, so the reader that already answers "how is this order
-- doing" answers it.
--
-- `attempts` is a count, not a list: how many times payment was begun, which
-- is what the wording turns on. No provider id, no session, no URL, no
-- timestamps — the projection stays as narrow as 0017 made it.
--
-- Dropped and recreated because a `returns table` signature cannot grow in
-- place. Same reason as 0007, 0019 and 0021.
-- ===========================================================================

drop function if exists public.order_payment_state(text, text);

create or replace function public.order_payment_state(
  p_order_number text,
  p_token        text default null
)
returns table (
  order_number     text,
  payment_status   text,
  needs_resolution boolean,
  total_amount     numeric,
  attempts         integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.order_number,
    o.payment_status,
    o.needs_resolution,
    o.total_amount,
    (select count(*)::integer from public.payment_attempts a where a.order_id = o.id)
  from public.orders o
  where o.order_number = p_order_number
    -- 0013's rule, called and not copied: the signed-in owner, or the holder
    -- of the capability issued when the order was placed. Since 0021 that
    -- also means a withdrawn tester stops seeing their own open order.
    and public.authorize_order_payment(o.id, (select auth.uid()), p_token);
$$;

comment on function public.order_payment_state(text, text) is
  'What a customer may know about their own order: status, whether it needs a human, the total, and how many payment attempts there have been. No PII, no ids, no provider data. An unknown and an unauthorised order both return nothing.';

revoke all on function public.order_payment_state(text, text) from public;
grant execute on function public.order_payment_state(text, text) to anon, authenticated;


-- ===========================================================================
-- 5. An account's own orders, for "Meine Bestellungen"
--
-- `orders_select_own` has allowed a signed-in customer to read their own rows
-- since 0010, so this needs no new permission — but a table read would hand
-- the browser `client_hash`, `payment_token_hash` and `request_id` along with
-- it, because a grant is column-blind and RLS filters rows, not columns. The
-- same reasoning that made `shop_offers()` a function (ADR-0043).
-- ===========================================================================

create or replace function public.my_orders(p_limit integer default 50)
returns table (
  order_number       text,
  placed_at          timestamptz,
  payment_status     text,
  fulfillment_status text,
  needs_resolution   boolean,
  total_amount       numeric,
  line_count         integer,
  commerce_mode      text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.order_number,
         o.placed_at,
         o.payment_status,
         o.fulfillment_status,
         o.needs_resolution,
         o.total_amount,
         -- No currency: V1 sells in one, `formatPrice()` names it, and the
         -- public-surface guard is right that a client-callable function
         -- should publish nothing it does not need to.
         (select count(*)::integer from public.order_lines l where l.order_id = o.id),
         o.commerce_mode
    from public.orders o
   where o.user_id = (select auth.uid())
     and (select auth.uid()) is not null
   order by o.placed_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function public.my_orders(integer) is
  'The calling account''s own orders. Never a guest order — those have no user_id and are reached with the capability instead. No client_hash, no payment_token_hash, no request_id.';

revoke all on function public.my_orders(integer) from public, anon;
grant execute on function public.my_orders(integer) to authenticated;


-- ===========================================================================
-- 6. One order of one's own, in full
--
-- The customer-facing counterpart to `admin_order()`. Same discipline: the
-- fields are listed literally, and the ones that must never leave the server
-- are not among them.
-- ===========================================================================

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
  'One of the calling account''s own orders as a document, including the address snapshot as it was at the time. An unknown order and somebody else''s order both return null.';

revoke all on function public.my_order(text) from public, anon;
grant execute on function public.my_order(text) to authenticated;
