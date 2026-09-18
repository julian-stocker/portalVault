-- ===========================================================================
-- 0041 — three accounts: USER, BUSINESS, ADMIN
--
-- WHAT WAS WRONG
--
-- `is_shop_admin()` answered two different questions with one predicate: "may
-- this account correct the catalog?" and "may this account run the shop?" One
-- person holds both today, so the conflation was invisible — and it made the
-- three-device model the operator actually wants impossible to express. A
-- Business account could not sell without also being able to rewrite the
-- catalog every collector reads.
--
-- WHAT THIS ESTABLISHES
--
--   USER      the default authenticated state. No row anywhere.
--   BUSINESS  an explicit row in `seller_operators`: this account may operate
--             that seller.
--   ADMIN     an explicit row in `platform_admins`: this account runs SkyIsles.
--
-- ORTHOGONAL, AND THAT IS THE POINT. Admin does not imply Business; Business
-- does not imply Admin. There is no inheritance and no hierarchy — an account
-- holds both only if somebody granted both, deliberately, twice. The catalog
-- belongs to SkyIsles and the offers belong to the seller (ADR-0076); the
-- accounts that may touch each are now separate too.
--
-- NOT A MARKETPLACE. Still exactly one active seller (`sellers_one_active`),
-- still no `seller_id` on orders, inventory or the catalog. `seller_operators`
-- answers "which account may operate this seller?", never "which seller owns
-- this order?" — a membership, not a partition of commerce.
--
-- NOBODY IS LOCKED OUT. `platform_admins` is seeded from `shop_admins`, so
-- whoever administers SkyIsles today still does after this runs. Nothing here
-- names a person: no e-mail address, no UUID, no display name. The seed reads
-- the table that already holds the answer.
--
-- HOW THE 41 REWRITTEN FUNCTIONS WERE PRODUCED
--
-- Not by hand. A script took each function's LATEST definition from the
-- migration that owns it, replaced the guard, and asserted that exactly two
-- lines changed — the predicate and its message. Everything else in every body
-- is byte-identical to what is running now. Reproducing 41 security-definer
-- functions by retyping them is how an authorization layer acquires a hole.
--
-- DEPENDS ON `0040`, which is applied on Staging. Not on `0035`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. ADMIN — running SkyIsles
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id    uuid primary key,
  created_at timestamptz not null default now(),
  created_by uuid,
  note       text,

  constraint platform_admins_user_fk foreign key (user_id)
    references auth.users (id) on delete cascade,
  constraint platform_admins_created_by_fk foreign key (created_by)
    references auth.users (id) on delete set null,
  constraint platform_admins_note_shape check (note is null or length(btrim(note)) > 0)
);

comment on table public.platform_admins is
  'Accounts that operate the SkyIsles platform: catalog, categories, testers, platform settings, Business access (ADR-0077). Holding this grants NOTHING commercial — running the shop is seller_operators, and neither implies the other.';

alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

/*
 * The bootstrap, and the reason nobody loses access.
 *
 * `shop_admins` is what authorises everything today. Every one of its members
 * becomes a platform administrator, because that is what they have been in
 * practice. It reads a table rather than naming anybody: this migration
 * contains no account identifier of any kind.
 *
 * It deliberately does NOT also make them seller operators. That grant is the
 * operator's to make, in the UI, once — and making it automatically here would
 * be the inheritance this migration exists to remove.
 */
insert into public.platform_admins (user_id, note)
  select a.user_id, 'bootstrapped from shop_admins by 0041'
    from public.shop_admins a
on conflict (user_id) do nothing;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins p
     where p.user_id = (select auth.uid())
  );
$$;

comment on function public.is_platform_admin() is
  'True when the current request runs SkyIsles itself (ADR-0077). Says nothing about selling.';

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;


-- ---------------------------------------------------------------------------
-- 2. BUSINESS — operating a seller
--
-- A membership table, not a partition of commerce. It carries a `seller_id`
-- because it names WHICH seller an account may operate; no order, no inventory
-- row and no catalog row gains one. That distinction is the whole reason this
-- can exist without becoming a marketplace.
-- ---------------------------------------------------------------------------
create table if not exists public.seller_operators (
  seller_id  bigint  not null,
  user_id    uuid    not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  note       text,

  constraint seller_operators_pk primary key (seller_id, user_id),
  constraint seller_operators_seller_fk foreign key (seller_id)
    references public.sellers (id) on delete cascade,
  constraint seller_operators_user_fk foreign key (user_id)
    references auth.users (id) on delete cascade,
  constraint seller_operators_created_by_fk foreign key (created_by)
    references auth.users (id) on delete set null,
  constraint seller_operators_updated_by_fk foreign key (updated_by)
    references auth.users (id) on delete set null,
  constraint seller_operators_note_shape check (note is null or length(btrim(note)) > 0)
);

comment on table public.seller_operators is
  'Which accounts may operate which seller (ADR-0077). A membership: it answers "who runs this shop", never "who owns this order". Holding it grants NOTHING on the catalog.';
comment on column public.seller_operators.is_enabled is
  'Access can be withdrawn without erasing that it existed. A disabled row is a fact about the past; deleting it would lose one.';

alter table public.seller_operators enable row level security;
revoke all on public.seller_operators from anon, authenticated;

create index if not exists seller_operators_user_idx
  on public.seller_operators (user_id) where is_enabled;

create or replace function public.can_operate_seller(p_seller_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seller_operators o
     where o.seller_id = p_seller_id
       and o.user_id = (select auth.uid())
       and o.is_enabled
  );
$$;

/*
 * The predicate every commercial function now asks.
 *
 * "The active seller" rather than a parameter, because there is exactly one
 * and commerce is not seller-scoped (ADR-0076). When a second seller exists
 * this becomes the caller's business to name, and `can_operate_seller(id)` is
 * already the function that answers it.
 */
create or replace function public.can_operate_active_seller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.sellers s
      join public.seller_operators o on o.seller_id = s.id
     where s.is_active
       and o.user_id = (select auth.uid())
       and o.is_enabled
  );
$$;

comment on function public.can_operate_active_seller() is
  'True when the current request may run the shop (ADR-0077). Says nothing about the platform: a seller operator cannot touch the catalog, the testers or the platform settings.';

revoke all on function public.can_operate_seller(bigint) from public, anon;
revoke all on function public.can_operate_active_seller() from public, anon;
grant execute on function public.can_operate_seller(bigint) to authenticated;
grant execute on function public.can_operate_active_seller() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. `is_shop_admin()` stops being ambiguous
--
-- It now means PLATFORM ADMIN and nothing else. Two reasons for keeping it at
-- all rather than dropping it: `shop_admins` is still the table an operator
-- knows, and anything this migration failed to reclassify keeps working for
-- the administrator while refusing a Business account. That is the safe
-- direction to fail — a missed function locks a seller out of a screen, it
-- does not hand a seller the catalog.
--
-- It is NOT `is_platform_admin() or can_operate_active_seller()`. That would
-- be the inheritance this migration exists to remove.
-- ---------------------------------------------------------------------------
create or replace function public.is_shop_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin();
$$;

comment on function public.is_shop_admin() is
  'DEPRECATED since 0041 (ADR-0077): an alias for is_platform_admin(). It once meant "may do privileged things", which conflated running SkyIsles with running the shop. New code asks is_platform_admin() or can_operate_active_seller() by name.';


-- ---------------------------------------------------------------------------
-- 4. The free-shipping threshold moves to the seller it belongs to
--
-- `0040` put it on `shop_settings`, a singleton by constraint, and was applied
-- to Staging that way. It is a seller's decision (ADR-0076), so it moves here
-- rather than by rewriting a migration that has already run. The value is
-- copied, not defaulted: a shop that had changed it keeps what it chose.
-- ---------------------------------------------------------------------------
alter table public.sellers
  add column if not exists free_shipping_threshold numeric(10,2) not null default 75.00;

alter table public.sellers
  drop constraint if exists sellers_free_shipping_threshold_sane;
alter table public.sellers
  add constraint sellers_free_shipping_threshold_sane
  check (free_shipping_threshold >= 0 and free_shipping_threshold <= 100000);

update public.sellers s
   set free_shipping_threshold = t.free_shipping_threshold
  from public.shop_settings t
 where t.id
   and s.free_shipping_threshold is distinct from t.free_shipping_threshold;

comment on column public.sellers.free_shipping_threshold is
  'Goods value from which this seller ships free (ADR-0076). Moved off the platform singleton by 0041.';

create or replace function public.free_shipping_threshold()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.free_shipping_threshold
       from public.sellers s
      where s.is_active
      order by s.id
      limit 1),
    75.00::numeric);
$$;

comment on function public.free_shipping_threshold() is
  'The goods value from which shipping is free, from the active seller since 0041. Signature unchanged, so every caller is untouched.';

-- `shop_settings.free_shipping_threshold` is deliberately NOT dropped. A
-- column that something might still read is not worth a destructive change in
-- the same migration that moves the reader; 0042 can remove it once this has
-- run everywhere.
comment on column public.shop_settings.free_shipping_threshold is
  'SUPERSEDED by sellers.free_shipping_threshold (0041, ADR-0076). Read by nothing; kept one migration longer so the move is reversible.';


-- ---------------------------------------------------------------------------
-- 5. Managing Business access — a platform administrator's job
--
-- Granting somebody the shop is a platform act, not a commercial one, so these
-- ask `is_platform_admin()`. A seller operator cannot add a second operator;
-- that would be a shop quietly widening its own access.
--
-- The account is named by `user_id` and never by address. `admin_find_accounts()`
-- already exists for looking one up by username or e-mail, and it stays what
-- the UI searches with — but what is stored, and what authorises, is the id.
-- ---------------------------------------------------------------------------
create or replace function public.admin_seller_operators()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller record;
  v_rows   jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_seller from public.sellers where is_active order by id limit 1;
  if v_seller.id is null then
    return jsonb_build_object('seller', null, 'operators', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id',    o.user_id,
           'username',   p.username,
           'is_enabled', o.is_enabled,
           'created_at', o.created_at,
           'updated_at', o.updated_at,
           -- Whether this operator also runs the platform. Shown so an
           -- administrator can see a dual-capability account for what it is,
           -- rather than inferring it from two screens.
           'is_platform_admin', exists (
             select 1 from public.platform_admins a where a.user_id = o.user_id)
         ) order by o.created_at), '[]'::jsonb)
    into v_rows
    from public.seller_operators o
    left join public.profiles p on p.id = o.user_id
   where o.seller_id = v_seller.id;

  return jsonb_build_object(
    'seller', jsonb_build_object('id', v_seller.id, 'display_name', v_seller.display_name),
    'operators', v_rows);
end;
$$;

comment on function public.admin_seller_operators() is
  'Who may operate the active seller (ADR-0077). Platform administrators only. Returns the account id and username — never an e-mail address, which is what admin_find_accounts() is for.';

revoke all on function public.admin_seller_operators() from public, anon;
grant execute on function public.admin_seller_operators() to authenticated;

create or replace function public.admin_set_seller_operator(
  p_user_id uuid,
  p_enabled boolean,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_user_id is null then
    raise exception 'an operator is an account' using errcode = 'check_violation';
  end if;

  select id into v_seller_id from public.sellers where is_active order by id limit 1;
  if v_seller_id is null then
    raise exception 'no active seller' using errcode = 'no_data_found';
  end if;

  /*
   * Disabling keeps the row. Access that was granted and withdrawn is a fact
   * about the past, and deleting it would lose one — the same reason
   * `tester_permission_changes` exists rather than a silent revoke.
   */
  insert into public.seller_operators (seller_id, user_id, is_enabled, created_by, updated_by, note)
  values (v_seller_id, p_user_id, coalesce(p_enabled, false),
          (select auth.uid()), (select auth.uid()),
          nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (seller_id, user_id) do update
    set is_enabled = excluded.is_enabled,
        updated_at = now(),
        updated_by = excluded.updated_by,
        note       = coalesce(excluded.note, public.seller_operators.note);
end;
$$;

comment on function public.admin_set_seller_operator(uuid, boolean, text) is
  'Grants or withdraws permission to operate the active seller (ADR-0077). Platform administrators only; a seller operator cannot widen its own shop''s access. Takes an account id, never an address.';

revoke all on function public.admin_set_seller_operator(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_seller_operator(uuid, boolean, text) to authenticated;

/*
 * The PLATFORM's support address — an administrator's setting (ADR-0077).
 *
 * Its own function rather than a second parameter on
 * `admin_set_platform_contact()`: adding one would change that signature and
 * leave 0026's version callable beside it. A new name costs nothing and
 * collides with nothing.
 *
 * No address is hard-coded here or anywhere else; it starts NULL and stays
 * NULL until somebody types one.
 */
create or replace function public.admin_set_platform_support(p_support_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_support text := nullif(btrim(coalesce(p_support_email, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.platform_settings (id, support_email, updated_at, updated_by)
  values (true, v_support, now(), (select auth.uid()))
  on conflict (id) do update
    set support_email = excluded.support_email,
        updated_at    = now(),
        updated_by    = excluded.updated_by;
end;
$$;

comment on function public.admin_set_platform_support(text) is
  'Sets the SkyIsles support address (ADR-0077). Platform administrators only: a seller operator cannot edit a platform setting, whatever screen it appears on.';

revoke all on function public.admin_set_platform_support(text) from public, anon;
grant execute on function public.admin_set_platform_support(text) to authenticated;


/*
 * What the application asks once per request to decide what to render and
 * which area to let somebody into. Two booleans, no inheritance between them.
 */
create or replace function public.my_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_platform_admin', public.is_platform_admin(),
    'can_operate_seller', public.can_operate_active_seller()
  );
$$;

comment on function public.my_capabilities() is
  'The current account''s two capabilities (ADR-0077). Both false is an ordinary collector. Neither implies the other.';

revoke all on function public.my_capabilities() from public, anon;
grant execute on function public.my_capabilities() to authenticated;


-- ===========================================================================
-- 6. The reclassified functions
--
-- Each one below is its latest definition with the guard replaced and nothing
-- else touched. BUSINESS asks `can_operate_active_seller()`; ADMIN asks
-- `is_platform_admin()`. Signatures are unchanged, so every existing grant and
-- every caller still applies.
-- ===========================================================================


-- ------------------------------------------------------------------ BUSINESS

-- admin_inventory_movements — from 0005_inventory_admin_read.sql
create or replace function public.admin_inventory_movements(
  p_inventory_id bigint,
  p_limit        integer default 20
)
returns table (
  id         bigint,
  delta      integer,
  reason     text,
  unit_cost  numeric,
  currency   text,
  note       text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select m.id, m.delta, m.reason, m.unit_cost, m.currency, m.note, m.created_at
      from public.inventory_movements m
     where m.inventory_id = p_inventory_id
     order by m.created_at desc, m.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 200);
end;
$$;

-- admin_shop_inventory — from 0007_shop_pricing_and_images.sql
create or replace function public.admin_shop_inventory()
returns table (
  inventory_id     bigint,
  sky_id           text,
  condition        text,
  quantity         integer,
  reserved         integer,
  available        integer,
  sale_price       numeric,
  effective_price  numeric,
  price_source     text,
  is_listed        boolean,
  note             text,
  updated_at       timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.sky_id, i.condition, i.quantity, i.reserved,
           i.available_quantity,
           i.sale_price,
           public.shop_price(i.sale_price, s.market_price, st.price_percentage),
           case when i.sale_price is not null then 'manual' else 'automatic' end,
           i.is_listed, i.note, i.updated_at
      from public.shop_inventory i
      left join public.skylanders s on s.sky_id = i.sky_id
     cross join public.shop_settings st
     order by i.sky_id, i.condition;
end;
$$;

-- admin_set_shop_percentage — from 0007_shop_pricing_and_images.sql
create or replace function public.admin_set_shop_percentage(p_percentage numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  -- Stated here as well as in the CHECK, so the caller gets a sentence about
  -- the percentage rather than a constraint name.
  if p_percentage is null or p_percentage <= 0 or p_percentage > 500 then
    raise exception 'percentage must be greater than 0 and at most 500'
      using errcode = 'check_violation';
  end if;

  update public.shop_settings
     set price_percentage = round(p_percentage, 2),
         updated_at       = now(),
         updated_by       = (select auth.uid())
   where id;
end;
$$;

-- admin_shop_settings — from 0007_shop_pricing_and_images.sql
create or replace function public.admin_shop_settings()
returns table (
  price_percentage numeric,
  updated_at       timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query select s.price_percentage, s.updated_at from public.shop_settings s;
end;
$$;

-- admin_shop_listing_audit — from 0008_shop_listing_opt_out.sql
create or replace function public.admin_shop_listing_audit()
returns table (
  sky_id     text,
  condition  text,
  is_listed  boolean,
  eligible   boolean,
  reason     text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      i.sky_id,
      i.condition,
      i.is_listed,
      public.is_shop_eligible(i.sky_id),
      case
        when s.sky_id is null            then 'no catalog row'
        when not s.is_active             then 'inactive figure'
        when not s.catalog_visible       then 'editorially hidden'
        when c.name = any (public.non_collectible_categories())
                                         then 'not a collectible'
        else null
      end
      from public.shop_inventory i
      left join public.skylanders s on s.sky_id = i.sky_id
      left join public.categories c on c.id = s.category_id
     order by i.sky_id, i.condition;
end;
$$;

-- set_shop_listing — from 0008_shop_listing_opt_out.sql
create or replace function public.set_shop_listing(
  p_sky_id     text,
  p_condition  text,
  p_sale_price numeric,
  p_is_listed  boolean,
  p_note       text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inventory_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- The figure still has to exist. Everything else about it — active,
  -- visible, collectible, priced, in stock — is the projection's question.
  if not exists (select 1 from public.skylanders where sky_id = p_sky_id) then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;

  insert into public.shop_inventory (sky_id, condition, sale_price, is_listed, note)
  values (p_sky_id, p_condition, p_sale_price, coalesce(p_is_listed, true), p_note)
  on conflict (sky_id, condition) do update
     set sale_price = excluded.sale_price,
         is_listed  = excluded.is_listed,
         note       = excluded.note
  returning id into v_inventory_id;

  return v_inventory_id;
end;
$$;

-- admin_commerce_state — from 0021_commerce_mode.sql
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
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
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

-- admin_set_commerce_mode — from 0021_commerce_mode.sql
create or replace function public.admin_set_commerce_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
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

-- admin_revert_sandbox_stock — from 0021_commerce_mode.sql
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
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
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

-- admin_orders — from 0024_open_orders_include_pending.sql
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
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
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
               when o.payment_status = 'pending' then 2                       -- waiting for money
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
     -- `<= 2`, not `<= 1`. The third bucket is a checkout that has not been
     -- paid yet, and it belongs in "open" for the reason the name says: it is
     -- not finished. Until 0024 it was excluded, so an order the interface
     -- itself labelled as open did not appear under "only open" — and a
     -- payment that hung because a webhook never arrived was visible nowhere
     -- at all (ADR-0063). Bucket 3 stays out: settled is settled.
     where not p_open_only or r.attention <= 2
     order by r.attention, r.placed_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- admin_order — from 0039_shipping_is_reversible.sql
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
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
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

-- admin_mark_order_shipped — from 0023_tracking_number_is_editable.sql
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
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
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

-- admin_unmark_order_shipped — from 0039_shipping_is_reversible.sql
create or replace function public.admin_unmark_order_shipped(p_order_number text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
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

-- admin_set_tracking_number — from 0023_tracking_number_is_editable.sql
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
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
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

-- admin_seller — from 0026_platform_and_seller.sql
create or replace function public.admin_seller()
returns table (
  display_name           text,
  contact_email          text,
  transactional_reply_to text,
  updated_at             timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select s.display_name, s.contact_email, s.transactional_reply_to, s.updated_at
      from public.active_seller() s;
end;
$$;

-- admin_set_seller_contact — from 0026_platform_and_seller.sql
create or replace function public.admin_set_seller_contact(
  p_display_name  text,
  p_contact_email text,
  p_reply_to      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_contact  text := nullif(btrim(coalesce(p_contact_email, '')), '');
  v_reply_to text := nullif(btrim(coalesce(p_reply_to, '')), '');
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- The CHECK constraints decide the shape; this turns their violation into a
  -- sentence the interface can translate rather than a constraint name.
  if v_contact is not null and v_contact !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'that does not look like an e-mail address'
      using errcode = 'check_violation';
  end if;
  if v_reply_to is not null and v_reply_to !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'that does not look like an e-mail address'
      using errcode = 'check_violation';
  end if;

  -- `where is_active` and not an id: the caller never names a seller, so the
  -- admin area cannot accidentally address a second one into existence.
  update public.sellers
     set display_name           = v_name,
         contact_email          = v_contact,
         transactional_reply_to = v_reply_to,
         updated_at             = now(),
         updated_by             = (select auth.uid())
   where is_active;
end;
$$;

-- admin_shop_profile — from 0040_shop_platform_responsibilities.sql
create or replace function public.admin_shop_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller   record;
  v_shop     record;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_seller from public.sellers where is_active order by id limit 1;
  select * into v_shop from public.shop_settings where id;

  return jsonb_build_object(
    'seller', case when v_seller.id is null then null else jsonb_build_object(
      'display_name', v_seller.display_name,
      'legal_name',   v_seller.legal_name,
      'trading_name', v_seller.trading_name,
      'legal_form',   v_seller.legal_form,
      'street',       v_seller.street,
      'postal_code',  v_seller.postal_code,
      'city',         v_seller.city,
      'country_code', v_seller.country_code,
      'phone',        v_seller.phone,
      'direct_contact',   v_seller.direct_contact,
      'register_court',   v_seller.register_court,
      'register_number',  v_seller.register_number,
      'vat_id',           v_seller.vat_id,
      'w_id',             v_seller.w_id,
      'contact_email',            v_seller.contact_email,
      'transactional_reply_to',   v_seller.transactional_reply_to,
      'withdrawal_contact_email', v_seller.withdrawal_contact_email,
      'complaints_contact_email', v_seller.complaints_contact_email,
      -- What the two NULLs resolve to, computed here so the panel never has
      -- to reimplement the fallback and get it subtly different.
      'withdrawal_contact_effective',
        coalesce(v_seller.withdrawal_contact_email, v_seller.contact_email),
      'complaints_contact_effective',
        coalesce(v_seller.complaints_contact_email, v_seller.contact_email),
      'small_business_19',       v_seller.small_business_19,
      'dispute_participation',   v_seller.dispute_participation,
      'dispute_body',            v_seller.dispute_body,
      'return_postage_borne_by', v_seller.return_postage_borne_by,
      'dispatch_statement',      v_seller.dispatch_statement
    ) end,
    /*
     * No platform block. The seller's settings screen showed the platform's
     * support address until 0041; it does not any more, and a reader that
     * keeps returning what nothing renders is how a boundary erodes
     * (ADR-0077).
     */
    'shop', jsonb_build_object(
      'free_shipping_threshold', v_shop.free_shipping_threshold
    ),
    'shipping_countries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'country_code', c.country_code, 'label', c.label,
               'is_enabled', c.is_enabled) order by c.sort_order, c.country_code)
        from public.shipping_countries c), '[]'::jsonb),
    'shipping_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', m.code, 'name', m.name,
               'base_price', m.base_price, 'is_enabled', m.is_enabled)
               order by m.sort_order, m.code)
        from public.shipping_methods m), '[]'::jsonb)
  );
end;
$$;

-- admin_set_seller_details — from 0040_shop_platform_responsibilities.sql
create or replace function public.admin_set_seller_details(
  p_legal_name      text default null,
  p_trading_name    text default null,
  p_legal_form      text default null,
  p_street          text default null,
  p_postal_code     text default null,
  p_city            text default null,
  p_country_code    text default null,
  p_phone           text default null,
  p_direct_contact  text default null,
  p_register_court  text default null,
  p_register_number text default null,
  p_vat_id          text default null,
  p_w_id            text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from public.sellers where is_active order by id limit 1;
  if v_id is null then
    raise exception 'no active seller' using errcode = 'no_data_found';
  end if;

  update public.sellers s
     set legal_name      = public.shop_setting_value(p_legal_name, s.legal_name),
         trading_name    = public.shop_setting_value(p_trading_name, s.trading_name),
         legal_form      = public.shop_setting_value(p_legal_form, s.legal_form),
         street          = public.shop_setting_value(p_street, s.street),
         postal_code     = public.shop_setting_value(p_postal_code, s.postal_code),
         city            = public.shop_setting_value(p_city, s.city),
         country_code    = upper(public.shop_setting_value(p_country_code, s.country_code)),
         phone           = public.shop_setting_value(p_phone, s.phone),
         direct_contact  = public.shop_setting_value(p_direct_contact, s.direct_contact),
         register_court  = public.shop_setting_value(p_register_court, s.register_court),
         register_number = public.shop_setting_value(p_register_number, s.register_number),
         vat_id          = public.shop_setting_value(p_vat_id, s.vat_id),
         w_id            = public.shop_setting_value(p_w_id, s.w_id),
         updated_at      = now(),
         updated_by      = (select auth.uid())
   where s.id = v_id;
end;
$$;

-- admin_set_shop_policies — from 0040_shop_platform_responsibilities.sql
/*
 * DROPPED FIRST, AND THAT IS THE POINT (ADR-0077).
 *
 * `0040` gave this function a `p_support_email` parameter and let it write
 * `platform_settings` — the PLATFORM's support address. Once 0041 re-guards
 * it with `can_operate_active_seller()`, that becomes a seller editing a
 * platform setting, which no route visibility would have prevented.
 *
 * Removing a parameter changes the signature, and `create or replace` would
 * then leave 0040's ten-argument version standing beside the new one, still
 * callable and now seller-guarded. So the old signature is dropped by name.
 * The support address moves to `admin_set_platform_support()` below.
 */
drop function if exists public.admin_set_shop_policies(
  text, text, text, boolean, boolean, text, text, text, numeric, text);

create or replace function public.admin_set_shop_policies(
  p_contact_email            text    default null,
  p_withdrawal_contact_email text    default null,
  p_complaints_contact_email text    default null,
  p_small_business_19        boolean default null,
  p_dispute_participation    boolean default null,
  p_dispute_body             text    default null,
  p_return_postage_borne_by  text    default null,
  p_dispatch_statement       text    default null,
  p_free_shipping_threshold  numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_return_postage_borne_by is not null
     and p_return_postage_borne_by not in ('customer', 'seller') then
    raise exception 'return postage is borne by the customer or the seller, not %',
      p_return_postage_borne_by using errcode = 'check_violation';
  end if;

  select id into v_id from public.sellers where is_active order by id limit 1;
  if v_id is null then
    raise exception 'no active seller' using errcode = 'no_data_found';
  end if;

  update public.sellers s
     set contact_email = public.shop_setting_value(p_contact_email, s.contact_email),
         withdrawal_contact_email =
           public.shop_setting_value(p_withdrawal_contact_email, s.withdrawal_contact_email),
         complaints_contact_email =
           public.shop_setting_value(p_complaints_contact_email, s.complaints_contact_email),
         small_business_19     = coalesce(p_small_business_19, s.small_business_19),
         dispute_participation = coalesce(p_dispute_participation, s.dispute_participation),
         dispute_body          = public.shop_setting_value(p_dispute_body, s.dispute_body),
         return_postage_borne_by =
           coalesce(p_return_postage_borne_by, s.return_postage_borne_by),
         dispatch_statement = public.shop_setting_value(p_dispatch_statement, s.dispatch_statement),
         updated_at = now(),
         updated_by = (select auth.uid())
   where s.id = v_id;

end;
$$;

-- admin_set_shipping_country — from 0040_shop_platform_responsibilities.sql
create or replace function public.admin_set_shipping_country(
  p_country_code text,
  p_label        text,
  p_enabled      boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.shipping_countries (country_code, label, is_enabled, updated_by)
  values (upper(btrim(p_country_code)), btrim(p_label), coalesce(p_enabled, false),
          (select auth.uid()))
  on conflict (country_code) do update
    set label      = excluded.label,
        is_enabled = excluded.is_enabled,
        updated_at = now(),
        updated_by = excluded.updated_by;
end;
$$;

-- record_inventory_movement — from 0003_shop_foundation.sql
create or replace function public.record_inventory_movement(
  p_sky_id    text,
  p_condition text,
  p_delta     integer,
  p_reason    text,
  p_unit_cost numeric default null,
  p_currency  text    default null,
  p_note      text    default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Before anything else. EXECUTE is granted to `authenticated` as a whole,
  -- so this check — not the grant — is the authorization.
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- The actor is read from the request, never accepted as an argument.
  return public.apply_inventory_movement(
    p_sky_id, p_condition, p_delta, p_reason,
    p_unit_cost, p_currency, p_note, (select auth.uid())
  );
end;
$$;


-- ------------------------------------------------------------------ ADMIN

-- admin_catalog_changes — from 0004_catalog_editorial.sql
create or replace function public.admin_catalog_changes(
  p_entity    text,
  p_entity_id text,
  p_limit     integer default 20
)
returns table (
  field      text,
  old_value  text,
  new_value  text,
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  return query
    select c.field, c.old_value, c.new_value, c.changed_at
      from public.catalog_admin_changes c
     where c.entity = p_entity
       and c.entity_id = p_entity_id
     order by c.changed_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 200);
end;
$$;

-- admin_set_admin_note — from 0004_catalog_editorial.sql
create or replace function public.admin_set_admin_note(
  p_sky_id text,
  p_value  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.skylanders where sky_id = p_sky_id) then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;

  if v_clean is null then
    -- An emptied note leaves no row behind. The journal keeps the history.
    delete from public.catalog_editorial where sky_id = p_sky_id;
  else
    insert into public.catalog_editorial (sky_id, admin_note, updated_at)
    values (p_sky_id, v_clean, now())
    on conflict (sky_id)
      do update set admin_note = excluded.admin_note, updated_at = now();
  end if;
end;
$$;

-- admin_set_catalog_group — from 0004_catalog_editorial.sql
create or replace function public.admin_set_catalog_group(
  p_category_id bigint,
  p_group       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_group, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  -- The CHECK constraint is the vocabulary. Repeating the ten values here
  -- would be a second list to keep in step.
  update public.categories set catalog_group = v_clean where id = p_category_id;

  if not found then
    raise exception 'unknown category %', p_category_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- admin_set_catalog_visible — from 0004_catalog_editorial.sql
create or replace function public.admin_set_catalog_visible(
  p_sky_id  text,
  p_visible boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  update public.skylanders set catalog_visible = p_visible where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- admin_set_display_name_override — from 0004_catalog_editorial.sql
create or replace function public.admin_set_display_name_override(
  p_sky_id text,
  p_value  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  -- An empty string is how a form says "reset": it becomes NULL, and NULL
  -- means the derived name applies again. The CHECK would reject '' anyway;
  -- turning it into a reset is friendlier than an error.
  update public.skylanders set display_name_override = v_clean where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- admin_set_image_override — from 0007_shop_pricing_and_images.sql
create or replace function public.admin_set_image_override(
  p_sky_id text,
  p_path   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  -- The directory must be this figure's own SKY-ID. Without this the CHECK
  -- would still pass for a well-formed path belonging to another figure.
  if v_clean is not null and split_part(v_clean, '/', 1) <> p_sky_id then
    raise exception 'image path % does not belong to %', v_clean, p_sky_id
      using errcode = 'check_violation';
  end if;

  update public.skylanders set image_override_path = v_clean where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- admin_set_card_type — from 0030_card_types.sql
create or replace function public.admin_set_card_type(
  p_sky_id    text,
  p_card_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Trimmed, not vetted. Whitespace is an accident of a form field; which
  -- words are card types is the constraint's business. An empty string
  -- reaches it and is refused there, with the value named.
  v_clean text := btrim(coalesce(p_card_type, ''));
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  update public.skylanders set card_type = v_clean where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown figure %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- admin_create_figure — from 0034_create_figure_from_template.sql
create or replace function public.admin_create_figure(
  p_name                  text,
  p_series_code           text,
  p_category_id           bigint,
  p_card_type             text    default 'standard',
  p_catalog_visible       boolean default false,
  p_display_name_override text    default null,
  p_admin_note            text    default null,
  p_template_sky_id       text    default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name      text   := btrim(coalesce(p_name, ''));
  v_next      bigint;
  v_sky_id    text;
  v_slug      text;
  v_override  text   := nullif(btrim(coalesce(p_display_name_override, '')), '');
  v_note      text   := nullif(btrim(coalesce(p_admin_note, '')), '');
  v_template  text   := nullif(btrim(coalesce(p_template_sky_id, '')), '');
  v_character bigint := null;
  v_found     boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  if v_name = '' then
    raise exception 'a figure needs a name' using errcode = 'check_violation';
  end if;

  /*
   * The template, read from the catalogue rather than believed.
   *
   * A SKY-ID that does not exist is refused instead of silently ignored: the
   * operator picked something, and a create that quietly dropped the
   * relationship would produce a figure that looks derived and is not.
   *
   * `v_character` may still be NULL afterwards - that is a template without a
   * curated character, and it is a normal answer.
   */
  if v_template is not null then
    select s.character_id, true
      into v_character, v_found
      from public.skylanders s
     where s.sky_id = v_template;

    if not coalesce(v_found, false) then
      raise exception 'unknown template figure %', v_template
        using errcode = 'no_data_found';
    end if;
  end if;

  v_next := nextval('public.sky_id_seq');

  if v_next > 8999 then
    raise exception
      'SKY-ID allocation range exhausted: % is beyond SKY-8999, and SKY-9000-9999 is the reserved system/test range (ADR-0070)',
      v_next
      using errcode = 'check_violation';
  end if;

  v_sky_id := 'SKY-' || lpad(v_next::text, 4, '0');
  v_slug   := public.next_figure_slug(v_name, p_series_code, v_sky_id);

  insert into public.skylanders
    (sky_id, name, slug, series_code, category_id,
     card_type, catalog_visible, display_name_override, character_id, source, is_active)
  values
    (v_sky_id, v_name, v_slug, p_series_code, p_category_id,
     coalesce(nullif(btrim(coalesce(p_card_type, '')), ''), 'standard'),
     coalesce(p_catalog_visible, false), v_override, v_character, 'admin', true);

  if v_note is not null then
    insert into public.catalog_editorial (sky_id, admin_note)
    values (v_sky_id, v_note);
  end if;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', v_sky_id, 'created', null, v_name, (select auth.uid()));

  return v_sky_id;
end;
$$;

-- admin_platform_settings — from 0026_platform_and_seller.sql
/*
 * Dropped first: it gains a column, and PostgreSQL cannot change a return type
 * in place. The support address is a platform fact, so the platform's own
 * reader is where it belongs — the seller's reader stops returning it below.
 */
drop function if exists public.admin_platform_settings();

create or replace function public.admin_platform_settings()
returns table (
  contact_email text,
  support_email text,
  updated_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select p.contact_email, p.support_email, p.updated_at
      from public.platform_settings p;
end;
$$;

-- admin_set_platform_contact — from 0026_platform_and_seller.sql
create or replace function public.admin_set_platform_contact(
  p_contact_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact text := nullif(btrim(coalesce(p_contact_email, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if v_contact is not null and v_contact !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'that does not look like an e-mail address'
      using errcode = 'check_violation';
  end if;

  update public.platform_settings
     set contact_email = v_contact,
         updated_at    = now(),
         updated_by    = (select auth.uid())
   where id;
end;
$$;

-- admin_find_accounts — from 0021_commerce_mode.sql
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
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
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

-- admin_set_commerce_tester — from 0036_tester_feature_permissions.sql
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
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(p_enabled, false) then
    -- Membership first: the permission has nowhere to hang otherwise.
    perform public.admin_set_tester(p_user_id, true, p_note);
    perform public.admin_set_tester_permission(p_user_id, 'commerce', true);
  else
    /*
     * Withdrawing COMMERCE, not tester membership. An account that also tests
     * something else keeps testing it — which is the difference this migration
     * exists to make. A tester left with no permissions stays on the list,
     * visible and harmless, until somebody removes them deliberately.
     */
    if exists (select 1 from public.testers t where t.user_id = p_user_id) then
      perform public.admin_set_tester_permission(p_user_id, 'commerce', false);
    end if;
  end if;
end;
$$;

-- admin_set_tester — from 0036_tester_feature_permissions.sql
create or replace function public.admin_set_tester(
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
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
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
    insert into public.testers (user_id, created_by, note)
    values (p_user_id, (select auth.uid()), nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (user_id) do update set note = excluded.note;

    insert into public.tester_permission_changes (user_id, permission, action, changed_by)
    values (p_user_id, null, 'added', (select auth.uid()));
  else
    -- One delete. `tester_permissions` follows by cascade, and nothing else in
    -- the account is touched: not the auth row, not the collection, not the
    -- orders, not shop_admins.
    delete from public.testers where user_id = p_user_id;

    insert into public.tester_permission_changes (user_id, permission, action, changed_by)
    values (p_user_id, null, 'removed', (select auth.uid()));
  end if;

  perform public.sync_legacy_commerce_tester(p_user_id);
end;
$$;

-- admin_set_tester_permission — from 0036_tester_feature_permissions.sql
create or replace function public.admin_set_tester_permission(
  p_user_id    uuid,
  p_permission text,
  p_enabled    boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.testers t where t.user_id = p_user_id) then
    raise exception 'not a tester account' using errcode = 'no_data_found';
  end if;

  -- Said here as well as by the foreign key, so the message names the value
  -- rather than a constraint.
  if not exists (select 1 from public.tester_features f where f.key = p_permission) then
    raise exception 'unknown tester permission %', p_permission
      using errcode = 'check_violation';
  end if;

  if coalesce(p_enabled, false) then
    insert into public.tester_permissions (user_id, permission, granted_by)
    values (p_user_id, p_permission, (select auth.uid()))
    on conflict (user_id, permission) do nothing;

    insert into public.tester_permission_changes (user_id, permission, action, changed_by)
    values (p_user_id, p_permission, 'granted', (select auth.uid()));
  else
    delete from public.tester_permissions
     where user_id = p_user_id and permission = p_permission;

    insert into public.tester_permission_changes (user_id, permission, action, changed_by)
    values (p_user_id, p_permission, 'revoked', (select auth.uid()));
  end if;

  if p_permission = 'commerce' then
    perform public.sync_legacy_commerce_tester(p_user_id);
  end if;
end;
$$;

-- admin_tester_state — from 0036_tester_feature_permissions.sql
create or replace function public.admin_tester_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_features jsonb;
  v_testers  jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- The registry, so the admin area never carries its own copy of the list.
  select coalesce(jsonb_agg(f order by f ->> 'position'), '[]'::jsonb)
    into v_features
    from (
      select jsonb_build_object(
               'key', tf.key, 'label', tf.label,
               'description', tf.description, 'position', tf.position
             ) as f
        from public.tester_features tf
    ) rows;

  select coalesce(jsonb_agg(t order by t ->> 'created_at'), '[]'::jsonb)
    into v_testers
    from (
      select jsonb_build_object(
               'user_id',     te.user_id,
               'username',    p.username,
               'email',       u.email,
               'created_at',  te.created_at,
               'note',        te.note,
               'is_admin',    public.is_shop_admin_for(te.user_id),
               'permissions', coalesce(
                 (select jsonb_agg(tp.permission order by tp.permission)
                    from public.tester_permissions tp
                   where tp.user_id = te.user_id),
                 '[]'::jsonb)
             ) as t
        from public.testers te
        left join public.profiles p on p.id = te.user_id
        left join auth.users     u on u.id = te.user_id
    ) rows;

  return jsonb_build_object('features', v_features, 'testers', v_testers);
end;
$$;

-- admin_perf_runs — from 0037_performance_telemetry.sql
create or replace function public.admin_perf_runs(p_limit integer default 20)
returns table (
  run_id      uuid,
  label       text,
  build_id    text,
  user_id     uuid,
  started_at  timestamptz,
  ended_at    timestamptz,
  navigations bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select n.run_id,
           max(n.label)      as label,
           max(n.build_id)   as build_id,
           -- A run belongs to one account; max() is just a way to carry it
           -- through the grouping.
           max(n.user_id)    as user_id,
           min(n.occurred_at) as started_at,
           max(n.occurred_at) as ended_at,
           count(*)          as navigations
      from public.perf_navigations n
     group by n.run_id
     order by min(n.occurred_at) desc
     limit greatest(1, least(coalesce(p_limit, 20), 200));
end;
$$;

-- admin_perf_report — from 0037_performance_telemetry.sql
create or replace function public.admin_perf_report(
  p_run_id uuid default null,
  p_label  text default null
)
returns table (
  from_route text,
  to_route   text,
  warm       boolean,
  samples    bigint,
  visible_p50 integer,
  visible_p75 integer,
  visible_p95 integer,
  visible_min integer,
  visible_max integer,
  commit_p50  integer,
  paint_p50   integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select n.from_route,
           n.to_route,
           n.warm,
           count(*) as samples,
           percentile_cont(0.50) within group (order by n.interaction_to_visible_ms)::integer,
           percentile_cont(0.75) within group (order by n.interaction_to_visible_ms)::integer,
           percentile_cont(0.95) within group (order by n.interaction_to_visible_ms)::integer,
           min(n.interaction_to_visible_ms),
           max(n.interaction_to_visible_ms),
           percentile_cont(0.50) within group (order by n.interaction_to_commit_ms)::integer,
           percentile_cont(0.50) within group (order by n.commit_to_visible_ms)::integer
      from public.perf_navigations n
     where (p_run_id is null or n.run_id = p_run_id)
       and (p_label  is null or n.label  = p_label)
     group by n.from_route, n.to_route, n.warm
     order by percentile_cont(0.75) within group (order by n.interaction_to_visible_ms) desc;
end;
$$;

-- admin_prune_perf_navigations — from 0037_performance_telemetry.sql
create or replace function public.admin_prune_perf_navigations(p_days integer default 90)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.perf_navigations
   where occurred_at < now() - (greatest(1, coalesce(p_days, 90)) || ' days')::interval;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- admin_perf_interactions — from 0038_performance_interactions.sql
create or replace function public.admin_perf_interactions(
  p_run_id uuid default null,
  p_label  text default null
)
returns table (
  interaction text,
  route       text,
  warm        boolean,
  samples     bigint,
  visible_p50 integer,
  visible_p75 integer,
  visible_p95 integer,
  visible_min integer,
  visible_max integer,
  commit_p50  integer,
  paint_p50   integer,
  content_samples bigint,
  content_p50 integer,
  content_p75 integer,
  content_p95 integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select n.interaction,
           n.route,
           n.warm,
           count(*) as samples,
           percentile_cont(0.50) within group (order by n.interaction_to_visible_ms)::integer,
           percentile_cont(0.75) within group (order by n.interaction_to_visible_ms)::integer,
           percentile_cont(0.95) within group (order by n.interaction_to_visible_ms)::integer,
           min(n.interaction_to_visible_ms),
           max(n.interaction_to_visible_ms),
           percentile_cont(0.50) within group (order by n.interaction_to_commit_ms)::integer,
           percentile_cont(0.50) within group (order by n.commit_to_visible_ms)::integer,
           -- `percentile_cont` ignores nulls; the count says over how many.
           count(n.content_visible_ms) as content_samples,
           percentile_cont(0.50) within group (order by n.content_visible_ms)::integer,
           percentile_cont(0.75) within group (order by n.content_visible_ms)::integer,
           percentile_cont(0.95) within group (order by n.content_visible_ms)::integer
      from public.perf_interactions n
     where (p_run_id is null or n.run_id = p_run_id)
       and (p_label  is null or n.label  = p_label)
     group by n.interaction, n.route, n.warm
     order by percentile_cont(0.75) within group (order by n.interaction_to_visible_ms) desc;
end;
$$;

-- admin_prune_perf_interactions — from 0038_performance_interactions.sql
create or replace function public.admin_prune_perf_interactions(p_days integer default 90)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.perf_interactions
   where occurred_at < now() - (greatest(1, coalesce(p_days, 90)) || ' days')::interval;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. What this migration deliberately does NOT do
--
-- No `seller_id` on `orders`, `order_lines`, `shop_inventory` or any catalog
-- table. `seller_operators.seller_id` names which shop an ACCOUNT may run; it
-- does not partition commerce.
--
-- No second seller. `sellers_one_active` is untouched.
--
-- No marketplace: no onboarding, commissions, payouts, ranking, third-party
-- checkout or marketplace terms.
--
-- No inheritance. `is_platform_admin()` and `can_operate_active_seller()` never
-- call each other, and `is_shop_admin()` is an alias for the first alone.
--
-- No account named anywhere. The admin bootstrap reads `shop_admins`; the
-- Business grant is made by a human in the UI afterwards.
--
-- No catalog duplication, and no new write path to `skylanders`, `categories`,
-- `series` or `catalog_editorial` — their guards became platform-admin-only.
--
-- No change to `0039`'s fulfilment behaviour: `admin_mark_order_shipped()`,
-- `admin_unmark_order_shipped()`, `admin_set_tracking_number()` and
-- `admin_order()` carry their bodies across unchanged apart from the guard.
--
-- No drop of `shop_settings.free_shipping_threshold`; see section 4.
--
-- No dependency on `0035`.
-- ---------------------------------------------------------------------------
