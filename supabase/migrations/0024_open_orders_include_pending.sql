-- ===========================================================================
-- 0024 — "only open orders" means what the word says
--
-- WHAT WENT WRONG
--
-- `admin_orders()` has sorted orders into four attention buckets since 0018:
--
--   0  needs_resolution                      "Prüfen"
--   1  paid and unfulfilled                  "Zu versenden"
--   2  payment_status = 'pending'            "Offen"
--   3  everything else                       "Erledigt"
--
-- and `p_open_only` filtered to `attention <= 1`. So bucket 2 — the one the
-- interface itself labelled **"Offen"** — was excluded from the filter called
-- **"Nur offene"**. One word, two meanings, in two places a person reads side
-- by side.
--
-- It surfaced on production on 2026-09-12: SI-2026-001004 sat at
-- `pending`/`unfulfilled` because a webhook was pointed at the wrong URL, and
-- the order was findable only under "Alle Bestellungen". A payment that hangs
-- is precisely the case an operator needs to see, and it was the one case
-- nothing showed.
--
-- THE RULE, RESTATED
--
-- "Open" is **not settled**: buckets 0, 1 and 2. An order leaves it when
-- nothing further can happen to it — paid and shipped, expired, cancelled,
-- refunded.
--
-- One predicate, one definition. The counters on /admin still name the two
-- buckets that are *work* — a checkout in flight needs nobody — but they are
-- counted from this same set, so the filter and the counter cannot drift.
--
-- WHY NOT "pending FOR LONGER THAN 20 MINUTES"
--
-- Tempting, and wrong here. `expire_stale_checkouts()` already moves a lapsed
-- checkout to `expired` every five minutes, so a `pending` order that is
-- older than that IS the anomaly. Filtering by age would hide it behind a
-- second rule that must agree with the sweep's schedule. One state, one
-- meaning.
--
-- WHAT DOES NOT CHANGE
--
-- The bucket definitions, the ordering, the returned columns, the
-- `is_shop_admin()` check, and every other function. This migration replaces
-- one comparison.
-- ===========================================================================

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

comment on function public.admin_orders(boolean, integer, integer) is
  'The order list, sorted by what needs attention first, with the commerce mode each order was placed in. p_open_only returns everything that is not settled: flagged, awaiting shipment, and awaiting payment.';

revoke all on function public.admin_orders(boolean, integer, integer) from public, anon;
grant execute on function public.admin_orders(boolean, integer, integer) to authenticated;
