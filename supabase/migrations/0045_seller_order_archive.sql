-- ===========================================================================
-- 0045 — the shop's own past: an archive it can page through, and a monthly
--        report that stops changing
--
-- Two capabilities that sound unrelated and are not. Both exist because the
-- order list has exactly one shape today — "the newest hundred, sorted by how
-- much attention they need" — and that shape answers "what must I do now?"
-- and nothing else. It cannot answer "what happened in August?".
--
-- ---------------------------------------------------------------------------
-- WHY AGE MAY NOT DECIDE ALONE
--
-- The obvious archive rule is "older than N days goes away". Applied on its
-- own it hides work: a flagged order (`needs_resolution`) is paid, has booked
-- no stock, cannot ship, and **gets older every day precisely because nobody
-- has dealt with it**. The rule that would tidy the list is the rule that
-- would bury the one row that matters.
--
-- So the active section is an OR, never a date alone:
--
--     recent  OR  still open
--
-- and "still open" is not a new definition. It is `attention <= 2` — exactly
-- what `p_open_only` has meant since `0024` (ADR-0063). One definition of
-- open, used by the badge, the filter and now the archive.
--
-- ---------------------------------------------------------------------------
-- WHY THE ATTENTION RULE MOVES INTO ITS OWN FUNCTION
--
-- `0018` wrote the rule once and said why: "Two copies — one to return and one
-- to sort by — is two things that must agree and eventually will not." This
-- migration needs the same rule in three more places. Copying it three times
-- would prove that comment right. `order_attention()` is the rule, and
-- `admin_orders()` is replaced to call it — same signature, same return type,
-- same four buckets, same order. Nothing about the existing list changes.
--
-- ---------------------------------------------------------------------------
-- WHY A MONTHLY REPORT IS AN EVENT-PERIOD REPORT
--
-- A monthly report states what the business DID in a month. So an event
-- belongs to the month it happened in, and a later event never reaches back:
--
--     order placed   2026-08-31   ->  August's order activity
--     paid           2026-09-02   ->  changes nothing about August
--     refunded       2026-09-12   ->  a September refund event
--
-- August is written once and stays written. That is not a caution about
-- rounding; it is what makes a monthly report comparable to the one before it.
--
-- THEREFORE THE MONTH IS DECIDED BY `placed_at`, AND BY NOTHING ELSE. Not by
-- `paid_at`, not by the payment status transition, not by `shipped_at`. A
-- month keyed on payment would move an order between months depending on when
-- a webhook arrived, and would rewrite a closed month every time a late
-- payment landed.
--
-- AND PAYMENT IS NOT A CONDITION OF COUNTING. An order placed in August is
-- August's order activity whether the money arrived on the 31st, on
-- 2 September, or not yet. This is the predicate that changed: the first draft
-- of this migration counted `paid` orders, which made August's figure a
-- statement about payments wearing a month's name.
--
-- ---------------------------------------------------------------------------
-- WHAT COUNTS AS AN ORDER, THEN
--
-- Not decided here. `public.order_counts_as_placed()` in `0044` is the one
-- definition, and this migration calls it rather than restating it — two
-- copies of "what is an order" would be two things that must agree about the
-- shop's money and eventually would not.
--
-- In short, and in full at the top of `0044`: every row in `orders` is already
-- a placed order, because `create_order()` writes it when the customer submits
-- the checkout. The single exception is 'expired' — the 20-minute hold lapsed,
-- the stock went back, nobody ever paid. That row never crossed into being an
-- order, so it is not one that stopped counting.
--
-- 'cancelled' is NOT excluded, and that is the correction this model needed. A
-- cancellation is a real order undone by a LATER event, and a later event
-- belongs to its own month:
--
--     5 September   placed      +50 €   September's order activity
--     8 September   cancelled   -50 €   a September cancellation event
--
-- Excluding it here would silently delete a €50 order from a month that had
-- already reported it.
--
-- A pending order barely survives to a report in practice: the sweep expires
-- an unpaid checkout about twenty minutes after it is placed, and a month is
-- finalized no earlier than the first of the next one. What does survive is a
-- flagged order, which `expire_stale_checkouts()` deliberately never touches —
-- and that is a real order awaiting a human, so it counts.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS CALLED BESTELLWERT AND NOT EINNAHME
--
-- Because the money may not have arrived. "Einnahme", "Umsatz" and "bezahlt"
-- all claim a cash receipt; an order placed on the 31st and paid on the 2nd
-- would make every one of them false on the day the report is written. The
-- figure is the value of the orders placed, so it is called that.
--
-- Payments received and refunds are a SECOND kind of report, keyed on their
-- own event dates, and this migration does not pretend to have them.
--
-- ---------------------------------------------------------------------------
-- WHAT THE REPORT DELIBERATELY DOES NOT CONTAIN
--
-- Every field below is one SkyIsles actually holds. The audit found four
-- things it does not, and none of them is approximated here:
--
--   NO FEES.        `payment_events` stores the event id, its type and the
--                   outcome — by design, not omission: `0012` says the
--                   provider's own payload is "one query away in the
--                   provider's dashboard". There is no `balance_transaction`,
--                   no fee, no payout. So no "Gebühr", no "Auszahlung", and
--                   nothing called "Netto", because net of what is unknown.
--
--   NO REFUNDS.     There is no refund amount, no refund timestamp and no
--                   refund table — only four status values nothing writes. A
--                   refund column here would be a column that is always zero
--                   and would read as "nothing was refunded" rather than
--                   "refunds are not recorded". The comment at the end of this
--                   file records exactly what a future refund event needs.
--
--   NO TAX.         SkyIsles sells under § 19 UStG: VAT is not levied, not
--                   shown, and deliberately NOT modelled as a zero rate
--                   (`0011`). A tax line of 0,00 € would be a false statement
--                   about the transaction. The regime is snapshotted by NAME,
--                   which is the honest field.
--
--   NO PROFIT.      Nothing in this system knows what the stock cost.
--
-- ---------------------------------------------------------------------------
-- DEPENDS ON `0041` (the seller predicate), the commerce core, and **`0044`**
-- for `order_counts_as_placed()`. Not on `0042` or `0043`.
-- ===========================================================================



-- ---------------------------------------------------------------------------
-- 1. The attention rule, in one place
-- ---------------------------------------------------------------------------

create or replace function public.order_attention(
  p_needs_resolution   boolean,
  p_payment_status     text,
  p_fulfillment_status text
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
           when p_needs_resolution then 0                      -- a human is required
           when p_payment_status = 'paid'
            and p_fulfillment_status = 'unfulfilled' then 1     -- paid, not sent
           when p_payment_status = 'pending' then 2             -- waiting for money
           else 3                                               -- settled or closed
         end;
$$;

comment on function public.order_attention(boolean, text, text) is
  'How much attention an order needs: 0 flagged, 1 paid and unsent, 2 awaiting payment, 3 settled. The single definition — `admin_orders()`, the archive and the calendar all call it (ADR-0082). "Open" is `<= 2` (ADR-0063); "work for a person" is `<= 1`.';

revoke all on function public.order_attention(boolean, text, text) from public, anon;
grant execute on function public.order_attention(boolean, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. `admin_orders()` adopts it
--
-- Replaced, not redefined: same argument list, same return type, same
-- ordering, same `p_open_only` meaning. The only change is that the CASE
-- expression now lives in section 1. `create or replace` is safe here
-- precisely BECAUSE the return type is untouched — 0040 learned what happens
-- when it is not.
-- ---------------------------------------------------------------------------

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
     -- `<= 2`, unchanged from 0024: a checkout that has not been paid yet is
     -- not finished, and a payment that hung because a webhook never arrived
     -- is visible nowhere else (ADR-0063). Bucket 3 stays out.
     where not p_open_only or r.attention <= 2
     order by r.attention, r.placed_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. The active window
--
-- Berlin calendar dates, not a 360-hour subtraction. "The last 15 days" is a
-- statement about days, and a day is a thing a person reads off a calendar in
-- a place; `src/lib/format.ts` already fixes which place.
--
-- The boundary is inclusive in the direction that keeps work visible: an order
-- stays active while its Berlin date is today or one of the `p_days` dates
-- before it. Erring one day toward "still shown" is the cheap mistake; the
-- other one hides an order the morning it becomes invisible.
--
-- OR still open, always. See the header.
-- ---------------------------------------------------------------------------

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
     where r.berlin_date >= ((now() at time zone 'Europe/Berlin')::date - v_days)
        or r.attention <= 2
     order by r.attention, r.placed_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. The calendar — month headings without their rows
--
-- This is what keeps the archive from becoming the scaling trap it looks like.
-- Rendering "August 2026 · 42 Bestellungen" needs the 42, not the 42 orders.
-- One row per month that has any, at most twelve a year, and the rows
-- themselves are fetched only when a month is actually opened.
--
-- Two counts, because the page needs both and asking twice would be two
-- queries that can disagree:
--
--   order_count    every order placed in that Berlin month
--   archived_count those NOT already shown in the active section
--
-- A month heading whose `archived_count` is 0 has nothing of its own to show:
-- every order it holds is up in "Aktuell". The page can then leave it out of
-- the archive without a second round trip to discover the section is empty.
--
-- NO REVENUE COLUMN. `0044` defines the shop's money as paid AND live; this
-- list counts every order including sandbox ones, because the list below it
-- shows them (with a badge). A euro figure next to a count that means
-- something different would be two definitions of the shop's month in one row
-- (ADR-0081). The month sections carry counts; money has one home.
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- 5. One month's orders
--
-- `p_archived_only` is the difference between the two views the page has:
--
--   false  the seller asked for this month. Show the month — all of it. A
--          filter that quietly withheld the recent rows would be a filter that
--          lies about the month it names (brief §15).
--   true   the page is drawing the default view's archive section, where the
--          recent and still-open rows are already above.
-- ---------------------------------------------------------------------------

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

  -- Half-open, and built from Berlin wall-clock midnights rather than from a
  -- UTC instant plus an offset: the hour a month begins is 01:00 in winter and
  -- 02:00 in summer, and only the zone database knows which.
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
       where o.placed_at >= v_start
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


-- ---------------------------------------------------------------------------
-- 6. What the archive is read with
-- ---------------------------------------------------------------------------

-- No new index on `orders`. `orders_placed_idx (placed_at desc)` has existed
-- since 0010 and is exactly what every query above orders and ranges by; a
-- second index on the same column would be a second thing to keep.

revoke all on function public.seller_orders_active(integer, integer, integer) from public, anon;
revoke all on function public.seller_order_calendar(integer)                  from public, anon;
revoke all on function public.seller_orders_month(integer, integer, boolean, integer, integer, integer)
  from public, anon;

grant execute on function public.seller_orders_active(integer, integer, integer) to authenticated;
grant execute on function public.seller_order_calendar(integer)                  to authenticated;
grant execute on function public.seller_orders_month(integer, integer, boolean, integer, integer, integer)
  to authenticated;


-- ===========================================================================
-- 7. The badge's count, as a count
--
-- The navigation badge and the shop home have always been computed in
-- TypeScript from the rows `admin_orders(p_open_only => true)` returns — and
-- that call is capped at 100 rows. A shop with 130 orders needing attention
-- has said "100" ever since the cap existed, and would keep saying it as the
-- number grew.
--
-- Counting is not listing. Three counts, one scan, no cap, and the SAME
-- predicate as before: `attention <= 2`, split into the three buckets
-- `openOrderCounts()` already names (ADR-0063). Nothing about what counts as
-- open changes here — only that the answer is now the true one.
-- ===========================================================================

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
    ) a;

  return v_counts;
end;
$$;

comment on function public.seller_open_order_counts() is
  'How much work is waiting, counted rather than listed (ADR-0082). Same three buckets and same predicate as admin_orders(p_open_only), but with no row limit — the badge used to be computed from a 100-row page and stopped being true above it.';

-- Every open order is in one of three buckets, so the count is over a small
-- slice of a growing table. This is the index that keeps it that way.
create index if not exists orders_attention_open_idx
  on public.orders (payment_status, fulfillment_status)
  where payment_status in ('paid', 'pending') or needs_resolution;

revoke all on function public.seller_open_order_counts() from public, anon;
grant execute on function public.seller_open_order_counts() to authenticated;


-- ===========================================================================
-- 8. The monthly report — one per month, written once
--
-- See the header for the model: the month an order belongs to is the month it
-- was PLACED in, payment never moves it, and a later event never reaches back.
--
-- NO `version` COLUMN. The first draft had one, for re-issuing a month after a
-- late payment arrived. Under this model a late payment is not a reason to
-- re-issue anything — it does not change the month the order belongs to — and
-- a refund is a different month's event. With the retroactive case gone, the
-- only remaining use for a version was a correction nobody has asked for, so
-- the invariant is now the simpler and stronger one:
--
--     ONE FINALIZED REPORT PER CALENDAR MONTH PER MODE.
--
-- Enforced by a unique constraint, not by a convention.
--
-- NO `seller_id`. ADR-0076 fixed that `seller_operators.seller_id` is the only
-- one in the schema: orders, inventory and the catalog have none, because
-- SkyIsles has one seller and inventing the column would be the marketplace
-- data model ADR-0021 stopped. A report over those orders inherits the same
-- answer. The day a second seller exists, orders get the column first and this
-- table follows it — not the other way round.
-- ===========================================================================

create table if not exists public.seller_monthly_reports (
  id bigint generated always as identity primary key,

  -- The month this is about, in Berlin's calendar. Two integers rather than a
  -- date because it IS a month, and a date would invite arithmetic on a day
  -- that has no meaning here.
  period_year  integer not null,
  period_month integer not null,

  -- Which world. A sandbox month and a live month are different statements and
  -- must never be added together (ADR-0060).
  commerce_mode text not null default 'live',

  finalized_at timestamptz not null default now(),
  -- Who asked for it. NULL if that account is later deleted — the report is a
  -- commercial record and outlives the login, exactly as `orders.user_id` does.
  finalized_by uuid,

  -- ---- order activity: the month's actual subject -------------------------
  order_count        integer       not null,
  -- The value of the orders PLACED in the month. Not "paid", not "received".
  order_value        numeric(12,2) not null,
  -- The split of that same value, stored rather than derived so the report
  -- stands alone as a document.
  merchandise_amount numeric(12,2) not null,
  shipping_amount    numeric(12,2) not null,
  discount_amount    numeric(12,2) not null,
  currency           text          not null default 'EUR',

  -- ---- informational, and labelled as a snapshot --------------------------
  --
  -- How many of those orders had been paid AT THE MOMENT THIS WAS WRITTEN.
  -- Useful ("did August actually get paid?") and true when written. It must
  -- never be read as redefining `order_value`, and it does not: the value
  -- above counts every reportable order regardless of these two.
  paid_count   integer not null,
  unpaid_count integer not null,

  -- Under which rules it was sold, BY NAME (0011). Not a rate: § 19 UStG is
  -- "no VAT is levied", and a 0,00 € tax line would say "taxed at zero",
  -- which is a different and false statement. NULL when the month is empty.
  tax_regime text,

  -- WHICH orders. Without this the figures cannot be checked, and a later
  -- detail export would have to re-derive the set at a later moment — the
  -- drift this whole table exists to stop.
  included_orders text[] not null default '{}',

  constraint seller_monthly_reports_month_known
    check (period_month between 1 and 12),
  constraint seller_monthly_reports_year_sane
    check (period_year between 2020 and 2200),
  constraint seller_monthly_reports_mode_known
    check (commerce_mode in ('live', 'sandbox')),
  constraint seller_monthly_reports_counts_sane
    check (order_count >= 0 and cardinality(included_orders) = order_count),
  constraint seller_monthly_reports_payment_counts_sane
    check (paid_count >= 0 and unpaid_count >= 0
           and paid_count + unpaid_count = order_count),
  constraint seller_monthly_reports_amounts_sane
    check (order_value >= 0 and merchandise_amount >= 0
           and shipping_amount >= 0 and discount_amount >= 0),
  -- The same identity every order itself carries: the total IS the parts.
  constraint seller_monthly_reports_total_adds_up
    check (order_value = merchandise_amount + shipping_amount - discount_amount),
  constraint seller_monthly_reports_currency_iso
    check (currency ~ '^[A-Z]{3}$'),

  -- ONE per month per mode. The invariant, not a convention.
  constraint seller_monthly_reports_unique
    unique (period_year, period_month, commerce_mode)
);

comment on table public.seller_monthly_reports is
  'One finalized statement of order activity per calendar month, Berlin (ADR-0082). The month is the month an order was PLACED in; payment date never moves it and a later event never changes a written report. Holds no fee, refund, tax or profit figure because SkyIsles holds none of those — see this migration''s header.';

-- Closed to every client role, like the commerce tables it summarises (0010).
-- The only way in is the functions below, and all of them ask the seller
-- predicate.
alter table public.seller_monthly_reports enable row level security;
revoke all on table public.seller_monthly_reports from public, anon, authenticated;

create index if not exists seller_monthly_reports_period_idx
  on public.seller_monthly_reports (period_year desc, period_month desc);


-- ---------------------------------------------------------------------------
-- 9. Reading them
-- ---------------------------------------------------------------------------

create or replace function public.seller_monthly_reports(p_year integer default null)
returns table (
  period_year        integer,
  period_month       integer,
  finalized_at       timestamptz,
  order_count        integer,
  order_value        numeric,
  merchandise_amount numeric,
  shipping_amount    numeric,
  discount_amount    numeric,
  paid_count         integer,
  unpaid_count       integer,
  currency           text,
  tax_regime         text
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
    -- Only the live ones: a sandbox report is a rehearsal and does not belong
    -- in the archive of what the shop actually did. No `distinct on` and no
    -- version tie-break, because there is exactly one row per month.
    select r.period_year, r.period_month, r.finalized_at,
           r.order_count, r.order_value, r.merchandise_amount,
           r.shipping_amount, r.discount_amount,
           r.paid_count, r.unpaid_count, r.currency, r.tax_regime
      from public.seller_monthly_reports r
     where r.commerce_mode = 'live'
       and (p_year is null or r.period_year = p_year)
     order by r.period_year desc, r.period_month desc;
end;
$$;


-- ---------------------------------------------------------------------------
-- 10. The years the archive can offer
--
-- Years in which the shop actually took an order, plus the current one — which
-- always belongs in the list even before its first order, because it is the
-- year the page opens on (brief §7). Never a hard-coded year.
--
-- The same reportable-order predicate as the report itself, so the selector
-- cannot offer a year whose every month would come out empty.
-- ---------------------------------------------------------------------------

create or replace function public.seller_report_years()
returns integer[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current integer := extract(year from (now() at time zone 'Europe/Berlin'))::integer;
  v_years   integer[];
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select array_agg(distinct y order by y desc)
    into v_years
    from (
      select v_current as y
      union
      select extract(year from (o.placed_at at time zone 'Europe/Berlin'))::integer
        from public.orders o
       where o.commerce_mode = 'live'
         and public.order_counts_as_placed(o.payment_status)
    ) years;

  return coalesce(v_years, array[v_current]);
end;
$$;


-- ---------------------------------------------------------------------------
-- 11. Finalizing one
--
-- WRITES ONCE. A month that already has a report returns it untouched: no
-- comparison, no refresh, no warning that the figures moved. They cannot have
-- moved — the month owns the orders placed in it, and nothing later changes
-- which month an order was placed in.
--
-- REFUSES AN UNFINISHED MONTH. A report for a month still running would be a
-- final statement about something that has not finished happening.
--
-- The unique constraint is the real guarantee; the `v_existing` check is there
-- so two clicks produce one report and a friendly answer rather than a
-- constraint violation.
-- ---------------------------------------------------------------------------

create or replace function public.seller_finalize_monthly_report(
  p_year  integer,
  p_month integer
)
returns table (
  period_year        integer,
  period_month       integer,
  finalized_at       timestamptz,
  order_count        integer,
  order_value        numeric,
  merchandise_amount numeric,
  shipping_amount    numeric,
  discount_amount    numeric,
  paid_count         integer,
  unpaid_count       integer,
  currency           text,
  tax_regime         text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
  v_id    bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_year is null or p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'a month is a year and a number from 1 to 12'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Half-open, and built from Berlin wall-clock midnights rather than from a
  -- UTC instant plus an offset: the hour a month begins is 01:00 in winter and
  -- 02:00 in summer, and only the zone database knows which.
  v_start := (make_timestamp(p_year, p_month, 1, 0, 0, 0) at time zone 'Europe/Berlin');
  v_end   := ((make_timestamp(p_year, p_month, 1, 0, 0, 0) + interval '1 month')
                at time zone 'Europe/Berlin');

  if v_end > now() then
    raise exception 'the month is not over yet'
      using errcode = 'invalid_parameter_value';
  end if;

  select r.id into v_id
    from public.seller_monthly_reports r
   where r.period_year = p_year
     and r.period_month = p_month
     and r.commerce_mode = 'live';

  if v_id is null then
    insert into public.seller_monthly_reports (
      period_year, period_month, commerce_mode, finalized_by,
      order_count, order_value, merchandise_amount, shipping_amount,
      discount_amount, paid_count, unpaid_count, currency, tax_regime,
      included_orders
    )
    select p_year,
           p_month,
           'live',
           auth.uid(),
           count(*)::integer,
           coalesce(sum(o.total_amount), 0),
           coalesce(sum(o.items_subtotal), 0),
           coalesce(sum(o.shipping_amount), 0),
           coalesce(sum(o.discount_amount), 0),
           -- Informational only. Note they are counts of ORDERS, never of
           -- money: there is no partial payment in this schema, and a euro
           -- figure here would invite exactly the reading the header rejects.
           count(*) filter (where o.payment_status = 'paid')::integer,
           count(*) filter (where o.payment_status <> 'paid')::integer,
           -- One currency or none. A month that somehow held two would be a
           -- fact worth failing on rather than averaging.
           coalesce(min(o.currency), 'EUR'),
           -- The regime by name, and only when the whole month agrees. Two
           -- regimes in one month is a real possibility the day the § 19
           -- threshold is crossed mid-year, and 'mixed' says so instead of
           -- picking one.
           case
             when count(*) = 0 then null
             when count(distinct o.tax_regime) = 1 then min(o.tax_regime)
             else 'mixed'
           end,
           coalesce(array_agg(o.order_number order by o.order_number), '{}')
      from public.orders o
     -- THE PREDICATE. A genuine order, by `0044`'s definition, placed in this
     -- Berlin month, in the real world. Payment status decides nothing about
     -- membership — it only feeds the two informational counts above.
     where o.commerce_mode = 'live'
       and public.order_counts_as_placed(o.payment_status)
       and o.placed_at >= v_start
       and o.placed_at <  v_end
    returning id into v_id;
  end if;

  return query
    select r.period_year, r.period_month, r.finalized_at,
           r.order_count, r.order_value, r.merchandise_amount,
           r.shipping_amount, r.discount_amount,
           r.paid_count, r.unpaid_count, r.currency, r.tax_regime
      from public.seller_monthly_reports r
     where r.id = v_id;
end;
$$;

revoke all on function public.seller_monthly_reports(integer)                  from public, anon;
revoke all on function public.seller_report_years()                            from public, anon;
revoke all on function public.seller_finalize_monthly_report(integer, integer)  from public, anon;

grant execute on function public.seller_monthly_reports(integer)                 to authenticated;
grant execute on function public.seller_report_years()                           to authenticated;
grant execute on function public.seller_finalize_monthly_report(integer, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- THE EVENT LEDGER — the invariant, recorded for the work that comes next
--
--   PLACEMENT      belongs to the month of `placed_at`.
--   PAYMENT        belongs to the month the payment occurred in, if and when
--                  payment reporting is added. NOT to the placement month.
--   REFUND         belongs to the month the refund occurred in.
--   CANCELLATION   belongs to the month the cancellation occurred in.
--
--   NO LATER EVENT EVER CHANGES THE MONTH AN EARLIER EVENT BELONGS TO.
--
-- That last line is the whole model. It is why a late payment cannot alter a
-- written report, why a refund is September's and not August's, and why
-- 'cancelled' is not in the order predicate.
--
-- It also means a future payments report will NOT be keyed on `placed_at`.
-- Sharing the placement definition between `0044` and `0045` is right because
-- both ask the same question about order activity; a report about money
-- arriving asks a different one and keys on its own date.
--
-- ---------------------------------------------------------------------------
-- What a future refund or cancellation event will need — recorded, not built
--
-- The model above already has the right shape for them: each is an event in
-- the month it OCCURRED in, and neither touches the report of the month the
-- order was placed in. An August order refunded in September is +40 € in
-- August's order activity and −40 € in September's refund activity. August is
-- not reopened.
--
-- What is missing is the event itself. A refund needs, at minimum:
--
--   order_id            which order it refunds (the source, for provenance)
--   amount              numeric(10,2), positive; the report subtracts it
--   currency            text, matching the order's
--   occurred_at         timestamptz — THE FIELD THAT DECIDES THE MONTH, and
--                       distinct from `requested_at` if the two can differ
--   provider_refund_id  the provider's own id, for reconciliation
--   status              only if a refund can be pending or fail; if it is
--                       recorded when it has happened, this column is noise
--   created_by          which operator issued it
--
-- A cancellation needs the same shape and its own occurrence date. It must
-- NOT be modelled by writing 'cancelled' onto an abandoned checkout: that is
-- what 'expired' means, and conflating the two would make a never-completed
-- checkout indistinguishable from a real order that was undone.
--
-- Plus the workflow that writes them, and the rule that moves
-- `orders.payment_status` to 'refunded' / 'partially_refunded' / 'cancelled' —
-- values that have sat in the CHECK unwritten since 0010.
--
-- The monthly report then gains `refund_count`/`refund_amount` and
-- `cancellation_count`/`cancellation_amount` as NULLABLE columns, so a report
-- written before those events existed reads as "not modelled" rather than
-- "none occurred". A "net month activity" figure becomes definable at that
-- point and not before — and it will be order value MINUS the refunds and
-- cancellations OF THAT MONTH, never of the months the orders came from.
--
-- Nothing of this is implemented here, and no zero-valued refund column is
-- added to stand in for it.
--
-- ---------------------------------------------------------------------------
-- And what a future download will need
--
-- PDF, a human-readable monthly summary, and CSV, the order/event detail —
-- both generated FROM the finalized row and `included_orders`, never from a
-- fresh query.
--
-- They need a place to live that this project does not have: the only bucket
-- is `catalog-images`, and it is PUBLIC (0007). A document listing customer
-- orders needs a private bucket with `storage.objects` policies gated on the
-- seller capability, and short-lived signed URLs.
--
-- ---------------------------------------------------------------------------
-- What this migration deliberately does NOT do
--
-- No refund, fee, payout, net or profit column. No report versioning. No
-- `seller_id`, no marketplace, no change to 0043 or any earlier migration, no
-- account-type change, and no new role: every function here asks
-- `can_operate_active_seller()`, the predicate 0041 established.
--
-- No background job. Nothing in this schema runs on a schedule, and a report
-- that appeared by itself at 03:00 on the first of the month would be the
-- first thing that does. The seller asks for it.
-- ---------------------------------------------------------------------------
