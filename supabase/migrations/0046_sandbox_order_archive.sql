-- ===========================================================================
-- 0046 — test orders get their own room, and nothing is ever deleted
--
-- ---------------------------------------------------------------------------
-- THE INVARIANT THIS MIGRATION EXISTS TO PROTECT
--
--   SkyIsles does not delete orders. Either kind.
--
--   LIVE     commercial history. A retention obligation attaches to it.
--   SANDBOX  technical history. It is the record of how the checkout, the
--            payment webhook and the fulfilment path actually behaved.
--
-- Neither is ever physically removed, by any product action: not by
-- cancellation, not by refund, not by fulfilment, not by resolution, and not
-- by the archiving this migration adds.
--
-- The schema already took this seriously and this migration does not weaken
-- it. Every foreign key pointing at `orders` is `ON DELETE RESTRICT`, so an
-- order that has a line, an event or a payment attempt cannot be deleted even
-- by accident; `orders.user_id` is `ON DELETE SET NULL` precisely so that
-- deleting an account releases the order instead of destroying it (`0010`);
-- and client roles hold `select` on `orders` and nothing else. There is no
-- delete-order function anywhere, and this migration adds none.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM, WHICH IS NOT A STORAGE PROBLEM
--
-- Testing a checkout end to end means placing an order. Testing it fifty times
-- means fifty orders, and they pile up in the middle of the list the operator
-- uses to find real work. The answer is not to delete them — they are the
-- evidence. The answer is that they were never supposed to be in that list.
--
-- So: two things, in this order of importance.
--
--   1. The shop's order views become LIVE-ONLY. Not "live first", not "live
--      with a badge on the others" — only live. A test order must not be able
--      to inflate a month count, the active section, the year selector or the
--      work badge.
--
--   2. Test orders get their own view, and within it an ARCHIVE — a visibility
--      state and nothing more, so a finished experiment can be put away
--      without being destroyed and without being lost.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A NEW MIGRATION AND NOT AN EDIT TO 0045
--
-- Because `0045` is applied to Staging, verified against the database rather
-- than read off a table. An applied migration is history. The four read
-- functions are therefore replaced here, with identical signatures and
-- identical return types, which is what makes `create or replace` safe —
-- `0040` learned what happens when it is not.
--
-- It is also the cleaner split on its own terms: `0045` is the archive and the
-- monthly report, `0046` is the live/sandbox separation.
--
-- DEPENDS ON `0045` (the functions it replaces) and `0044` (the order
-- predicate those functions call).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The archive state
--
-- An explicit technical field, not a reused commercial one. `payment_status`,
-- `fulfillment_status` and `needs_resolution` all mean something about the
-- order's commerce, and writing "the operator tidied this away" into any of
-- them would make a state machine answer a question it was not asked.
-- `commerce_mode` is worse still: it is frozen by `orders_protect_immutable()`
-- because it decides which world an order belongs to, and moving an order
-- between worlds to hide it is the retroactive rewriting this product keeps
-- refusing to do (ADR-0083).
--
-- NAMING follows the columns already on this table: `paid_at`, `shipped_at`,
-- `completed_at`, `cancelled_at` — a nullable `*_at` timestamp IS the state,
-- and there is no separate boolean anywhere in this schema saying the same
-- thing twice. So `sandbox_archived_at`, null meaning "not archived", and
-- restoring is setting it back to null.
--
-- `sandbox_archived_by` is worth the column: this is the one operator action
-- in the whole order lifecycle with no commercial trace of its own — no event,
-- no movement, no mail. Without it, "who put this away, and when?" has no
-- answer at all. `ON DELETE SET NULL`, like every other actor reference here.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists sandbox_archived_at timestamptz,
  add column if not exists sandbox_archived_by uuid;

alter table public.orders
  drop constraint if exists orders_sandbox_archived_by_fk;

alter table public.orders
  add constraint orders_sandbox_archived_by_fk
    foreign key (sandbox_archived_by)
    references auth.users (id)
    on update cascade
    on delete set null;

-- THE STRUCTURAL GUARANTEE, and the most important line in this file.
--
-- A live order cannot be marked archived. Not by a function with a bug, not by
-- a future migration that forgets, not by a hand-written UPDATE at three in
-- the morning. The functions below check the same thing and return a civil
-- error; this is what makes the check redundant rather than load-bearing.
alter table public.orders
  drop constraint if exists orders_sandbox_archive_is_sandbox_only;

alter table public.orders
  add constraint orders_sandbox_archive_is_sandbox_only
    check (sandbox_archived_at is null or commerce_mode = 'sandbox');

comment on column public.orders.sandbox_archived_at is
  'When a TEST order was put away, or null. Visibility only: it changes no payment, fulfilment, stock or amount, and no live order may ever carry it (ADR-0084). Reversible — restoring sets it back to null.';

-- Partial, because the interesting question is always "which sandbox orders
-- are still active", and live orders can never be in here at all.
create index if not exists orders_sandbox_active_idx
  on public.orders (placed_at desc)
  where commerce_mode = 'sandbox' and sandbox_archived_at is null;


-- ===========================================================================
-- 2. The shop's order views become live-only
--
-- Four functions from 0045 and 0018/0041, replaced with one clause added to
-- each: `o.commerce_mode = 'live'`. Nothing else about any of them changes —
-- same arguments, same return types, same ordering, same limits, same
-- attention rule, same seller predicate.
--
-- This is what stops a test order inflating a month count, the active section,
-- the year selector or the work badge.
-- ===========================================================================

-- --- 2a. The list behind `?open=1` -----------------------------------------

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
      select o.*,
             public.order_attention(o.needs_resolution, o.payment_status, o.fulfillment_status)
               as attention
        from public.orders o
       where o.commerce_mode = 'live'
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
     -- `<= 2`, unchanged from 0024 (ADR-0063). Bucket 3 stays out.
     where not p_open_only or r.attention <= 2
     order by r.attention, r.placed_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- --- 2b. The active window --------------------------------------------------

create or replace function public.seller_orders_active(
  p_days   integer default 15,
  p_limit  integer default 100,
  p_offset integer default 0
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
declare
  v_days integer := greatest(0, least(coalesce(p_days, 15), 366));
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    with ranked as (
      select o.*,
             public.order_attention(o.needs_resolution, o.payment_status, o.fulfillment_status)
               as attention,
             (o.placed_at at time zone 'Europe/Berlin')::date as berlin_date
        from public.orders o
       where o.commerce_mode = 'live'
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
     -- recent OR still open. Age alone must never hide work (ADR-0082).
     where r.berlin_date >= ((now() at time zone 'Europe/Berlin')::date - v_days)
        or r.attention <= 2
     order by r.attention, r.placed_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- --- 2c. The month calendar -------------------------------------------------

create or replace function public.seller_order_calendar(
  p_days integer default 15
)
returns table (
  period_year    integer,
  period_month   integer,
  order_count    integer,
  archived_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(0, least(coalesce(p_days, 15), 366));
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    with placed as (
      select (o.placed_at at time zone 'Europe/Berlin')::date as berlin_date,
             public.order_attention(o.needs_resolution, o.payment_status, o.fulfillment_status)
               as attention
        from public.orders o
       where o.commerce_mode = 'live'
    )
    select extract(year  from p.berlin_date)::integer,
           extract(month from p.berlin_date)::integer,
           count(*)::integer,
           count(*) filter (
             where p.berlin_date < ((now() at time zone 'Europe/Berlin')::date - v_days)
               and p.attention > 2
           )::integer
      from placed p
     group by 1, 2
     order by 1 desc, 2 desc;
end;
$$;

-- --- 2d. One month ----------------------------------------------------------

create or replace function public.seller_orders_month(
  p_year          integer,
  p_month         integer,
  p_archived_only boolean default false,
  p_days          integer default 15,
  p_limit         integer default 200,
  p_offset        integer default 0
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
declare
  v_days  integer := greatest(0, least(coalesce(p_days, 15), 366));
  v_start timestamptz;
  v_end   timestamptz;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_year is null or p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'a month is a year and a number from 1 to 12'
      using errcode = 'invalid_parameter_value';
  end if;

  v_start := (make_timestamp(p_year, p_month, 1, 0, 0, 0) at time zone 'Europe/Berlin');
  v_end   := ((make_timestamp(p_year, p_month, 1, 0, 0, 0) + interval '1 month')
                at time zone 'Europe/Berlin');

  return query
    with ranked as (
      select o.*,
             public.order_attention(o.needs_resolution, o.payment_status, o.fulfillment_status)
               as attention,
             (o.placed_at at time zone 'Europe/Berlin')::date as berlin_date
        from public.orders o
       where o.commerce_mode = 'live'
         and o.placed_at >= v_start
         and o.placed_at <  v_end
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
     where not p_archived_only
        or (r.berlin_date < ((now() at time zone 'Europe/Berlin')::date - v_days)
            and r.attention > 2)
     order by r.placed_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 500))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- --- 2e. The work badge -----------------------------------------------------

create or replace function public.seller_open_order_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_counts jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
           'needs_resolution', count(*) filter (where a.attention = 0),
           'to_ship',          count(*) filter (where a.attention = 1),
           'in_flight',        count(*) filter (where a.attention = 2)
         )
    into v_counts
    from (
      select public.order_attention(o.needs_resolution, o.payment_status, o.fulfillment_status)
               as attention
        from public.orders o
       where o.commerce_mode = 'live'
    ) a;

  return v_counts;
end;
$$;

comment on function public.seller_open_order_counts() is
  'How much work is waiting, counted rather than listed, and LIVE ONLY (ADR-0084). Same three buckets and same predicate as admin_orders(p_open_only), with no row limit.';


-- ===========================================================================
-- 3. Test orders — their own view, and an archive that only hides
-- ===========================================================================

-- --- 3a. Reading them -------------------------------------------------------
--
-- Sandbox only, and the same row shape as the live list plus the one field
-- that is meaningful here. Sorted by date rather than by attention: a test
-- order is not work, and ordering it by how urgent it looks would be a lie
-- about a rehearsal.

create or replace function public.seller_test_orders(
  p_include_archived boolean default false,
  p_limit            integer default 100,
  p_offset           integer default 0
)
returns table (
  order_number        text,
  placed_at           timestamptz,
  payment_status      text,
  fulfillment_status  text,
  needs_resolution    boolean,
  total_amount        numeric,
  line_count          integer,
  customer_email      text,
  attention           integer,
  commerce_mode       text,
  sandbox_archived_at timestamptz
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
    select o.order_number,
           o.placed_at,
           o.payment_status,
           o.fulfillment_status,
           o.needs_resolution,
           o.total_amount,
           (select count(*)::integer from public.order_lines l where l.order_id = o.id),
           o.customer_email,
           public.order_attention(o.needs_resolution, o.payment_status, o.fulfillment_status),
           o.commerce_mode,
           o.sandbox_archived_at
      from public.orders o
     where o.commerce_mode = 'sandbox'
       and (p_include_archived or o.sandbox_archived_at is null)
     order by o.placed_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;


-- --- 3b. Putting them away, and taking them back ----------------------------
--
-- ONE FUNCTION PER DIRECTION, BOTH TAKING A LIST.
--
-- A single-order call is a list of one. That is deliberate: it means there is
-- no "archive one" function that a bulk feature could later be built on top of
-- in a loop, with the sandbox check done once outside it. The check is done
-- for the whole list, before anything is written.
--
-- ALL OR NOTHING. A list containing one live order archives NOTHING — not the
-- sandbox orders that were also in it. Half-applying a batch because most of
-- it was acceptable is how a live order ends up hidden while the operator
-- reads a success message.
--
-- THERE IS NO GENERIC ORDER-ARCHIVE FUNCTION, and there must never be one.
-- `commerce_mode = 'sandbox'` is not a parameter here; it is written into the
-- WHERE clause and checked again by the CHECK constraint in section 1.

create or replace function public.seller_archive_test_orders(p_order_numbers text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_requested integer;
  v_sandbox   integer;
  v_changed   integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_order_numbers is null or cardinality(p_order_numbers) = 0 then
    return 0;
  end if;

  if cardinality(p_order_numbers) > 500 then
    raise exception 'too many orders in one request'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Distinct, so a list that names the same order twice is not reported as
  -- two orders that could not be found.
  select count(distinct n) into v_requested
    from unnest(p_order_numbers) as n;

  select count(*) into v_sandbox
    from public.orders o
   where o.order_number = any (p_order_numbers)
     and o.commerce_mode = 'sandbox';

  -- Every named order must exist AND be a test order. One live order, or one
  -- order number that does not exist, and the whole request is refused —
  -- before a single row is touched.
  if v_sandbox <> v_requested then
    raise exception 'only test orders can be archived, and every order in the request must exist'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Only the visibility field. Nothing here touches payment, fulfilment,
  -- tracking, needs_resolution, amounts, stock or any related table — and
  -- `orders_protect_immutable()` still guards the identity and the amounts on
  -- the way through.
  update public.orders o
     set sandbox_archived_at = now(),
         sandbox_archived_by = auth.uid()
   where o.order_number = any (p_order_numbers)
     and o.commerce_mode = 'sandbox'
     and o.sandbox_archived_at is null;

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

comment on function public.seller_archive_test_orders(text[]) is
  'Hides finished TEST orders from the test list. Visibility only — no stock, payment, fulfilment or amount is touched, and nothing is deleted (ADR-0084). Refuses the entire request if any named order is live or does not exist. Reversible via seller_restore_test_orders().';


create or replace function public.seller_restore_test_orders(p_order_numbers text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_order_numbers is null or cardinality(p_order_numbers) = 0 then
    return 0;
  end if;

  -- No sandbox check needed on this side and none pretended: the CHECK
  -- constraint means a live order cannot be archived, so a live order cannot
  -- be restored either — there is nothing to clear. The `sandbox` clause stays
  -- anyway, because a predicate that is true by construction today is the one
  -- that quietly stops being true later.
  update public.orders o
     set sandbox_archived_at = null,
         sandbox_archived_by = null
   where o.order_number = any (p_order_numbers)
     and o.commerce_mode = 'sandbox'
     and o.sandbox_archived_at is not null;

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

comment on function public.seller_restore_test_orders(text[]) is
  'Brings archived TEST orders back into the test list (ADR-0084). The reverse of seller_archive_test_orders(); archiving is never one-way.';


revoke all on function public.seller_test_orders(boolean, integer, integer) from public, anon;
revoke all on function public.seller_archive_test_orders(text[])            from public, anon;
revoke all on function public.seller_restore_test_orders(text[])            from public, anon;

grant execute on function public.seller_test_orders(boolean, integer, integer) to authenticated;
grant execute on function public.seller_archive_test_orders(text[])            to authenticated;
grant execute on function public.seller_restore_test_orders(text[])            to authenticated;


-- ---------------------------------------------------------------------------
-- What this migration deliberately does NOT do
--
-- NO DELETE. No `delete from public.orders`, no cleanup function, no cascade,
-- no "clear test data" button. The audit found none in the product and this
-- adds none. Archiving is a timestamp.
--
-- NO GENERIC ARCHIVE. There is no function that takes an order and a flag and
-- hides it. Both functions above name `commerce_mode = 'sandbox'` in their own
-- WHERE clause, and the CHECK constraint refuses the state on a live row
-- regardless of how it was reached.
--
-- NO COMMERCE EFFECT. Archiving writes two columns. It books no stock, moves
-- no reservation, writes no `inventory_movements` row, sends no mail, touches
-- no `order_lines`, `order_events`, `payment_attempts` or `payment_events`
-- row, and changes no status. The sandbox stock-revert path from `0039` is a
-- separate mechanism and is not involved.
--
-- NO EFFECT ON MONEY. `0044` and `0045` both read `commerce_mode = 'live'`, so
-- a test order is outside the year-to-date figures and outside every monthly
-- report whether it is active, archived or restored. This migration does not
-- change either of them.
--
-- NO NEW ROLE AND NO WIDENED ONE. Every function asks
-- `can_operate_active_seller()`. An ADMIN without the shop capability is
-- refused here exactly as everywhere else (ADR-0077); test orders are the
-- seller's, and inspecting them is not a reason to hand the platform the shop.
-- ---------------------------------------------------------------------------
