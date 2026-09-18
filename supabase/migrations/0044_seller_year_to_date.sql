-- ===========================================================================
-- 0044 — what the shop has taken this year, and the definition of an order
--        that every later report reuses
--
-- Two things, and the second is the more important one.
--
-- ---------------------------------------------------------------------------
-- 1. WHAT COUNTS AS A GENUINE ORDER — DEFINED ONCE, HERE
--
-- Every commercial figure in this product has to answer the same question
-- first: is this row an order, or is it the wreckage of a checkout nobody
-- finished? The answer is a predicate, and it lives in exactly one function so
-- that the year-to-date figure and the monthly report can never drift into two
-- different meanings of "an order" (ADR-0083).
--
-- A cart is not in the database at all — it lives in the browser (ADR-0043).
-- A row in `orders` is written by `create_order()` at the moment the customer
-- submits the checkout with their address, which is the moment an order is
-- placed. So nearly every row is already a real order.
--
-- The exception is 'expired', and it is a narrow one:
--
--     `create_order()` wrote the row and held the stock.
--     Twenty minutes passed. Nobody paid.
--     `expire_stale_checkouts()` released the hold, the goods went back on
--     the shelf, and the order was marked 'expired'.
--
-- Nothing was ever sold. The customer did not cancel a purchase — they never
-- completed one. That row never crossed the product's own boundary from
-- checkout attempt into a commercial order, so it is not an order this
-- function recognises.
--
-- THIS IS NOT A RETROACTIVE EXCLUSION, AND THE DIFFERENCE MATTERS.
--
-- An expired row was never in a month's figures to be removed from: the state
-- is reached about twenty minutes after placement, and a month is reported no
-- earlier than the first of the next one. It is not "an order that stopped
-- counting" — it is a row that was never an order.
--
-- A CANCELLATION IS THE OPPOSITE, AND IS DELIBERATELY NOT EXCLUDED.
--
-- 'cancelled' is written by nothing today. When it is, it will mean a real
-- order — placed, possibly paid — that was afterwards cancelled. That is a
-- LATER EVENT, and a later event never reaches back:
--
--     5 September   order placed        +50 €  belongs to September
--     8 September   order cancelled     -50 €  a September cancellation event
--
--     31 August     order placed        +40 €  belongs to August
--     12 September  refunded            -40 €  a September refund event
--
-- August is not reopened. September carries its own events. If 'cancelled'
-- were in the exclusion list, writing it would silently delete a €50 order
-- from a month that had already reported it — which is exactly the retroactive
-- rewriting this whole model exists to prevent.
--
-- So the predicate excludes 'expired' and nothing else, and it will keep
-- excluding only 'expired' as the other states start being written.
--
-- A WARNING TO WHOEVER IMPLEMENTS CANCELLATION. Do not reuse 'cancelled' to
-- mark an abandoned checkout. That is what 'expired' is for, and the two
-- cannot share a value: one means "never became business", the other means
-- "was business, and then was undone". A cancellation needs its own event with
-- its own date, exactly as a refund does — see the end of `0045`.
--
-- ---------------------------------------------------------------------------
-- 2. THE YEAR-TO-DATE FIGURES
--
-- The shop home needs an order count and an order value. Everything that could
-- produce them returns ROWS: `admin_orders()` hands back every order so the
-- application can list them. Summing two numbers by fetching a year of orders
-- — with their customer addresses — into a page that only wants to print "127"
-- is the wrong trade twice over: it grows with the shop, and it moves personal
-- data to a screen that has no use for it.
--
-- THE FIGURE IS ORDER ACTIVITY, NOT MONEY RECEIVED. An order placed in this
-- year belongs to this year whether the money arrived on the day, a week
-- later, or not yet. Payment timing decides nothing here.
--
-- WHICH IS WHY IT IS CALLED BESTELLWERT. An earlier draft of this migration
-- required `payment_status = 'paid'` and the screen said "Umsatz dieses Jahr".
-- That figure was a hybrid nobody asked for: bounded by placement, gated on
-- payment. An order placed on 30 December and paid on 2 January counted toward
-- NEITHER year's displayed figure, and an order placed in January and paid in
-- March quietly raised January's year after the fact.
--
-- `total_amount` is the decided figure: items + shipping - discount, frozen by
-- `orders_protect_immutable()` and never recomputed from today's catalogue
-- prices (ADR-0033). So the value of a placed order cannot drift either.
--
-- SANDBOX IS EXCLUDED EXACTLY. `commerce_mode` is NOT NULL, frozen on the
-- order, and `0021` backfilled every pre-existing row to 'sandbox'. So
-- `= 'live'` is a fact about the order, never a guess from its number, its
-- customer or its date.
--
-- THE YEAR IS BERLIN'S. `src/lib/format.ts` already fixes Europe/Berlin as the
-- zone this product's dates mean; an order placed at 00:30 on 1 January in
-- Berlin belongs to the new year, and under UTC it would not.
--
-- DEPENDS ON `0041` (the seller predicate). Not on `0042` or `0043`.
-- `0045` DEPENDS ON THIS ONE, for the predicate in section 1.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The definition every commercial figure shares
-- ---------------------------------------------------------------------------

create or replace function public.order_counts_as_placed(p_payment_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- 'expired' and nothing else. See the header for why a cancellation is not
  -- on this list and must never be added to it.
  select p_payment_status is distinct from 'expired';
$$;

comment on function public.order_counts_as_placed(text) is
  'Did this row ever become a real commercial order? False only for ''expired'' — a checkout whose 20-minute hold lapsed with nobody paying, which never crossed into being an order at all. TRUE for ''cancelled'', ''refunded'' and ''partially_refunded'': those are real orders undone by a LATER event, and a later event belongs to its own month rather than reaching back into the month the order was placed in (ADR-0083). Shared by seller_year_to_date() and seller_finalize_monthly_report() so the two cannot drift.';

revoke all on function public.order_counts_as_placed(text) from public, anon;
grant execute on function public.order_counts_as_placed(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. The year so far
-- ---------------------------------------------------------------------------

create or replace function public.seller_year_to_date()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_count', coalesce(count(*), 0),
    -- Text, not a JSON number: `sum()` of `numeric` would otherwise cross
    -- PostgREST as a float and lose cents on the way.
    'order_value', coalesce(sum(o.total_amount), 0)::text
  )
    from public.orders o
   where public.can_operate_active_seller()
     and o.commerce_mode = 'live'
     and public.order_counts_as_placed(o.payment_status)
     and o.placed_at >= date_trunc('year', (now() at time zone 'Europe/Berlin'))
                          at time zone 'Europe/Berlin';
$$;

comment on function public.seller_year_to_date() is
  'The shop''s order count and order value since 1 January, Berlin time (ADR-0083). Counts orders by when they were PLACED; payment timing decides nothing. Seller operators only — the predicate is inside the WHERE, so a caller without the capability aggregates an empty set rather than reading one row. Sandbox orders and abandoned checkouts are excluded; a cancelled or refunded order still counts in the year it was placed, because undoing it is a later event.';

revoke all on function public.seller_year_to_date() from public, anon;
grant execute on function public.seller_year_to_date() to authenticated;

-- No new index. `orders_placed_idx (placed_at desc)` has existed since 0010
-- and is exactly what this ranges by; an earlier draft added a partial index
-- on `(payment_status = 'paid' and commerce_mode = 'live')`, which the
-- predicate above no longer uses and which would have been a second thing to
-- keep for nothing.


-- ---------------------------------------------------------------------------
-- What this migration deliberately does NOT do
--
-- No analytics tables, no daily rollups, no materialised view. Two numbers on
-- one screen do not need a reporting system.
--
-- No refund or cancellation arithmetic. Neither is recorded anywhere — the
-- schema has the status values and no amounts, dates or workflow. When they
-- exist they will be their own events in their own months, subtracted in the
-- period they occur in, and they will not change this figure's definition.
--
-- No payment-receipt figure. "How much money arrived this year" is a different
-- question keyed on a different date, and it is not answered here under a name
-- that would suggest it was.
--
-- No `seller_id`, no marketplace, no change to any earlier migration, no
-- account-type change.
-- ---------------------------------------------------------------------------
