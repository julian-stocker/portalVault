-- ===========================================================================
-- 0015 — payment bootstrap, and the one status transition a provider may force
--
-- Phase B2.2b groundwork. Still no Stripe: no SDK, no API call, no Edge
-- Function, no webhook, no secret, no scheduler. This migration only makes the
-- database able to answer the three questions the payment bootstrap will ask.
--
-- WHAT IS IN HERE, AND WHY
--
--   1. payment_attempts_protect()   a defect fix. See below — this is the
--                                   only part that is not optional.
--   2. amount_to_cents()            one place where money changes units.
--   3. start_payment_attempt()      returns what a bootstrap needs, so the
--                                   caller never re-derives anything.
--   4. pending_payment_expiries()   a reader for the later expiry sweep.
--                                   Returns candidates and changes nothing.
--
-- THE DEFECT (1)
--
-- `expire_stale_checkouts()` may close a payment attempt as `expired` purely
-- on the strength of our own local state: the reservation lapsed, so nobody
-- paid in time. But the provider's checkout session can still be payable at
-- that moment — Stripe's session lifetime has a thirty-minute floor and our
-- reservation is twenty minutes, and the two cannot be aligned.
--
-- If the customer then pays, `confirm_order_payment()` reaches its
-- late-payment branch and runs
--
--     update public.payment_attempts set status = 'succeeded', paid_at = now()
--
-- against an attempt that is already `expired`. Until now the trigger below
-- refused every transition out of a terminal state, so that UPDATE raised
-- `restrict_violation` and rolled back the whole transaction — including the
-- `payment_events` row that would have recorded the payment arriving. The
-- provider then retried for three days into the same failure.
--
-- The money was taken and the database never learned about it. That is the
-- exact outcome the late-payment design (ADR-0050) exists to prevent, and it
-- was unreachable through the one path that needed it.
--
-- THE FIX, AND ITS LIMIT
--
-- `expired` is a local guess. `succeeded` is what the server saw at the
-- provider. ADR-0051 settles which of those wins: paid is what the server
-- observed at the provider, so a later authoritative confirmation must be
-- able to correct the guess.
--
-- Exactly one transition is added: `expired` -> `succeeded`. Nothing else
-- about terminal states is relaxed. `failed` -> `succeeded`,
-- `cancelled` -> `succeeded`, anything out of `succeeded`, and any move back
-- to `created` or `pending` all stay refused, because none of them describes
-- a local guess being corrected by the provider:
--
--   failed      the provider told us this payment did not work
--   cancelled   somebody deliberately ended it
--   succeeded   already the authoritative answer; there is nothing to correct
--
-- ADDITIVE, WITH ONE EXCEPTION. Three functions are created or replaced and
-- no table is touched. `start_payment_attempt()` is dropped and recreated
-- because its return type widens, and PostgreSQL cannot change a return type
-- in place. That is safe here and only here: nothing in `src/`, nothing in
-- `tools/`, and no scheduled job calls it — B2.2b, its only future caller,
-- does not exist yet. It is verified by `payment-bootstrap.test.ts`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. payment_attempts_protect() — the corrected lifecycle
--
-- Replaces the version from 0012 in place. Everything except the status
-- lifecycle is carried over unchanged: the order, provider, amount, currency
-- and creation time stay frozen, and the provider's payment id and checkout
-- URL are still write-once.
--
-- WHY `failed_at` IS CLEARED HERE AND NOT IN THE CALLER
--
-- `payment_attempts_failed_at_matches` reads
--
--     (failed_at is not null) = (status in ('failed', 'expired', 'cancelled'))
--
-- An expired attempt therefore carries a `failed_at`. Permitting the status
-- change alone would simply trade the trigger's `restrict_violation` for a
-- CHECK violation on that constraint and fix nothing.
--
-- Clearing it in the trigger rather than in `confirm_order_payment()` keeps
-- the rule in one place: whoever performs the sanctioned transition ends up
-- with a consistent row, and a second caller added later cannot forget. The
-- moment the attempt was locally expired is not lost — it is in `order_events`
-- as `checkout_expired`, which is where the sweep records it anyway.
--
-- `paid_at` is deliberately NOT filled in here. The caller sets it in the
-- same UPDATE, and an attempt that reached `succeeded` without one should
-- fail `payment_attempts_paid_at_matches` loudly rather than be quietly
-- repaired.
-- ---------------------------------------------------------------------------
create or replace function public.payment_attempts_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_id is distinct from old.order_id
     or new.provider is distinct from old.provider
     or new.amount   is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.created_at is distinct from old.created_at then
    raise exception 'a payment attempt''s order, provider and amount are immutable'
      using errcode = 'restrict_violation';
  end if;

  -- Set once, then frozen. Re-pointing an attempt at a different provider
  -- payment would rewrite which money paid for which order.
  if old.provider_payment_id is not null
     and new.provider_payment_id is distinct from old.provider_payment_id then
    raise exception 'the provider payment id is set once and cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  if old.provider_checkout_url is not null
     and new.provider_checkout_url is distinct from old.provider_checkout_url then
    raise exception 'the checkout url is set once and cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  -- The lifecycle. Terminal still means terminal, with one exception named
  -- in the header: a local expiry guess corrected by the provider.
  if new.status is distinct from old.status then

    if old.status = 'expired' and new.status = 'succeeded' then
      -- Sanctioned. `expired` was our own timeout, not the provider's answer,
      -- and ADR-0051 gives the provider the last word. See the header for why
      -- `failed_at` has to go with it.
      new.failed_at := null;

    elsif old.status in ('succeeded', 'failed', 'expired', 'cancelled') then
      raise exception 'attempt % is already %, and that is final', old.id, old.status
        using errcode = 'restrict_violation';

    elsif old.status = 'created'
       and new.status not in ('pending', 'succeeded', 'failed', 'expired', 'cancelled') then
      raise exception 'a created attempt cannot become %', new.status
        using errcode = 'restrict_violation';

    elsif old.status = 'pending'
       and new.status not in ('succeeded', 'failed', 'expired', 'cancelled') then
      raise exception 'a pending attempt cannot become %', new.status
        using errcode = 'restrict_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function public.payment_attempts_protect() is
  'Keeps a payment attempt''s order, amount and provider identity immutable and its status moving forwards. One transition out of a terminal state is allowed: expired to succeeded, because expired is our local timeout and the provider has the last word (ADR-0051). failed, cancelled and succeeded stay final.';


-- ---------------------------------------------------------------------------
-- 2. amount_to_cents() — the only place money changes units
--
-- Providers price in minor units; this shop stores `numeric(10,2)`. The
-- conversion happens here, in PostgreSQL, on the authoritative value, and
-- never in TypeScript — PostgREST serialises `numeric` as a JSON number, so
-- by the time any application code sees an amount it is already an IEEE-754
-- double and the exact decimal is gone.
--
-- EXACT, NOT ROUNDED
--
-- `numeric` arithmetic in PostgreSQL is exact, so `p_amount * 100` on a
-- two-decimal value is a whole number and the cast is lossless. There is no
-- `round()` here on purpose: rounding would be the thing that silently
-- absorbs a value this function should be refusing.
--
-- The guard exists for the day somebody widens the column or passes a
-- computed value with more scale. Loud, not forgiving — the house rule for
-- commerce invariants.
-- ---------------------------------------------------------------------------
create or replace function public.amount_to_cents(p_amount numeric)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null then
    raise exception 'an amount is required to convert to cents'
      using errcode = 'check_violation';
  end if;

  if p_amount * 100 <> trunc(p_amount * 100) then
    raise exception 'amount % is not a whole number of cents', p_amount
      using errcode = 'data_corrupted';
  end if;

  return (p_amount * 100)::integer;
end;
$$;

comment on function public.amount_to_cents(numeric) is
  'Converts an exact numeric amount to integer minor units. Exact by construction and never rounds: an amount with sub-cent precision raises rather than being absorbed. The single conversion point, so no application language ever does arithmetic on money.';


-- ---------------------------------------------------------------------------
-- 3. start_payment_attempt() — same rules, more answers
--
-- The guards are carried over from 0012 without change: the order must be
-- pending, must not need a human, and must still hold every line it ordered.
-- An order that lost its hold is not offered for payment.
--
-- WHAT IS NEW IS ONLY WHAT IT RETURNS
--
--   amount_cents           so the caller never converts, and never sees a
--                          float where money was meant
--   created_at             the bootstrap derives the provider session's own
--                          expiry from this. It has to be stable across
--                          retries: a value computed from `now()` would
--                          differ on the second call and break the provider's
--                          idempotency check, which compares parameters
--   provider_payment_id    together these let a retry that finds a reused
--   provider_checkout_url  attempt return the existing session immediately,
--                          without calling the provider a second time. That
--                          removes the commonest way a duplicate payable
--                          session gets created
--
-- DROP AND RECREATE
--
-- PostgreSQL cannot widen a function's return type in place. Dropping is safe
-- here because the function has no callers at all yet — see the header.
-- ---------------------------------------------------------------------------
drop function if exists public.start_payment_attempt(bigint, text);

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
  'Opens a payment attempt for an order, or returns the open one with whatever the provider already knows about it. The amount is read from the order — there is no parameter for it — and is returned in cents as well, converted in SQL. Refuses an order that is already settled, needs a human, or no longer holds its stock.';


-- ---------------------------------------------------------------------------
-- 4. pending_payment_expiries() — candidates, and nothing else
--
-- The later scheduled sweep (Option C) has to expire the provider's checkout
-- session slightly BEFORE our own reservation lapses, so that by the time the
-- stock is released there is no payable session left. To do that it needs a
-- list of attempts that are about to lose their hold.
--
-- STRICTLY A READER. It releases no reservation, expires no order, closes no
-- attempt and contains nothing provider-specific. `stable`, and the only
-- statement is a SELECT. Everything that changes state stays where it already
-- is: `fail_payment_attempt()` and `expire_stale_checkouts()`.
--
-- This split is deliberate. The sweep's correctness depends on its ordering —
-- provider first, then the attempt, then the stock — and that ordering can
-- only be enforced by the caller that can do all three. A reader that also
-- released stock would make the wrong order the easy one to write.
--
-- WHY AN ORDER WITH NO ACTIVE RESERVATION IS STILL A CANDIDATE
--
-- `coalesce(h.holds_until, now())` includes orders whose hold has already
-- gone. Those are exactly the dangerous ones: the stock is back on the shelf
-- and the provider's session may still be payable. They are the reason this
-- function exists rather than a simple "expires within the next minute" query.
--
-- `p_lead` is the head start. `p_limit` bounds one tick's work, so a backlog
-- drains over several ticks instead of one very long run.
-- ---------------------------------------------------------------------------
create or replace function public.pending_payment_expiries(
  p_lead  interval default interval '60 seconds',
  p_limit integer  default 100
)
returns table (
  attempt_id          bigint,
  order_id            bigint,
  order_number        text,
  provider            text,
  provider_payment_id text,
  holds_until         timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         o.id,
         o.order_number,
         a.provider,
         a.provider_payment_id,
         h.holds_until
    from public.payment_attempts a
    join public.orders o
      on o.id = a.order_id
    left join lateral (
      select min(r.expires_at) as holds_until
        from public.order_reservations r
       where r.order_id = o.id
         and r.state = 'active'
    ) h on true
   -- Only an attempt the provider actually knows about can be expired there.
   where a.status in ('created', 'pending')
     and a.provider_payment_id is not null
     -- An order that is paid, settled or flagged is not the sweep's business.
     and o.payment_status = 'pending'
     and o.paid_at is null
     and o.needs_resolution = false
     and coalesce(h.holds_until, now()) <= now() + p_lead
   order by h.holds_until nulls first, a.id
   limit p_limit;
$$;

comment on function public.pending_payment_expiries(interval, integer) is
  'Lists payment attempts whose hold has lapsed or is about to, so a scheduled caller can expire the provider session before the stock is released. Read-only and provider-neutral: it changes nothing and knows nothing about any particular provider.';


-- ---------------------------------------------------------------------------
-- 5. Privileges — none, to anybody, again
--
-- `start_payment_attempt()` was dropped and recreated, so it is a NEW
-- function as far as privileges are concerned and Supabase's default grants
-- apply to it again. Supabase grants EXECUTE on new functions in `public` to
-- anon and authenticated, so `from public` alone would not be enough — the
-- mistake 0010 made, documented in 0011, and the reason this block exists in
-- every commerce migration.
--
-- The two genuinely new functions are revoked for the same reason.
-- `payment_attempts_protect()` was replaced in place and keeps 0012's
-- privileges, but is re-revoked so this block reads as the complete list.
-- ---------------------------------------------------------------------------
revoke all on function public.payment_attempts_protect()
  from public, anon, authenticated;
revoke all on function public.amount_to_cents(numeric)
  from public, anon, authenticated;
revoke all on function public.start_payment_attempt(bigint, text)
  from public, anon, authenticated;
revoke all on function public.pending_payment_expiries(interval, integer)
  from public, anon, authenticated;
