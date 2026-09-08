-- ===========================================================================
-- 0012 — the payment core, without a payment provider
--
-- Phase B2.1. Everything that has to be true when money arrives, built and
-- testable before Stripe is wired up at all. No SDK, no API call, no webhook
-- route, no Edge Function, no secret — those are B2.2 and B2.3.
--
-- WHY THIS COMES FIRST
--
-- The dangerous part of taking payments is not talking to the provider; it is
-- the moment a confirmation arrives and stock has to change hands exactly
-- once. That moment is pure SQL, so it can be finished and held to a contract
-- while the provider is still an open question. B1 was built the same way and
-- it worked.
--
-- THE ONE RULE EVERYTHING ELSE SERVES
--
-- A confirmed payment either completes the whole order — reservations
-- converted, stock booked, one sale movement per line — or it completes none
-- of it and asks for a human. It never half-sells, and it never oversells to
-- make a late payment fit.
--
-- WHO MAY CALL ANY OF THIS: nobody. Every function here is revoked from
-- PUBLIC, anon and authenticated. The privileged path is a Supabase Edge
-- Function (ADR-0051), which runs inside Supabase and therefore never puts a
-- service-role key into Vercel. Section 8 states the contract it must follow.
--
-- ADDITIVE. Two new tables, six functions, no existing table or function is
-- altered — `convert_order_reservations()` and `release_expired_reservations()`
-- from 0010 are called, not changed.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. payment_attempts — one run at paying for an order
--
-- Several attempts per order are required, not merely tolerated: a customer
-- whose card is declined must be able to try again, and an order that could
-- only ever be paid once would be an order they have to abandon.
--
-- At most one may be OPEN at a time, though. Two live provider payments
-- against one order is how a customer gets charged twice, so the database
-- refuses it rather than trusting the application to check.
--
-- The amount is a snapshot taken from the order, never from a request. There
-- is no path by which a browser can name what it is about to pay.
-- ---------------------------------------------------------------------------
create table public.payment_attempts (
  id       bigint generated always as identity primary key,
  order_id bigint not null,

  -- V1 is Stripe. A CHECK rather than an enum, as everywhere else here:
  -- adding a provider later is a constraint swap, while an enum value can
  -- never be removed again.
  provider text not null,

  -- Assigned once the provider has created its own record. NULL until then,
  -- and immutable afterwards — re-pointing an attempt at a different payment
  -- would silently rewrite which money paid for which order.
  provider_payment_id   text,
  -- Where to send the customer. Not a secret, and not a credential.
  provider_checkout_url text,

  status text not null default 'created',

  -- Copied from the order at creation. See start_payment_attempt().
  amount   numeric(10,2) not null,
  currency text          not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at    timestamptz,
  failed_at  timestamptz,

  constraint payment_attempts_order_fk foreign key (order_id)
    references public.orders (id)
    on update cascade
    on delete restrict,

  constraint payment_attempts_provider_known check (provider in ('stripe')),

  constraint payment_attempts_status_known
    check (status in ('created', 'pending', 'succeeded', 'failed', 'expired', 'cancelled')),

  constraint payment_attempts_amount_positive check (amount > 0),
  constraint payment_attempts_currency_iso    check (currency ~ '^[A-Z]{3}$'),

  -- A timestamp is a fact about a state, so the two may not disagree.
  constraint payment_attempts_paid_at_matches
    check ((paid_at is not null) = (status = 'succeeded')),
  constraint payment_attempts_failed_at_matches
    check ((failed_at is not null) = (status in ('failed', 'expired', 'cancelled'))),

  -- A checkout URL without a payment is an attempt that never reached the
  -- provider; a payment id without a URL is possible (some flows have none).
  constraint payment_attempts_url_needs_payment
    check (provider_checkout_url is null or provider_payment_id is not null)
);

comment on table public.payment_attempts is
  'One run at paying for an order. Several are allowed — a declined card must be retryable — but only one may be open at a time. The amount is a snapshot of the order, never a figure from a request.';

-- One provider payment belongs to exactly one attempt. This is what lets a
-- webhook find its attempt from nothing but the provider's own id, and what
-- stops two attempts from claiming the same money.
create unique index payment_attempts_provider_payment_unique
  on public.payment_attempts (provider, provider_payment_id)
  where provider_payment_id is not null;

-- At most one open attempt per order. `created` and `pending` are the two
-- states in which a provider payment may still complete; the other four are
-- terminal and leave the order free for a fresh try.
create unique index payment_attempts_one_open_per_order
  on public.payment_attempts (order_id)
  where status in ('created', 'pending');

create index payment_attempts_order_idx on public.payment_attempts (order_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 2. payment_events — what the provider told us, and what we did about it
--
-- Exists for one reason: a provider delivers the same event more than once,
-- by design. `(provider, provider_event_id)` is unique, and inserting the row
-- is the lock — whoever wins the insert processes the event, everybody else
-- finds it already there and stops.
--
-- WHAT IS DELIBERATELY NOT STORED
--
-- No payload. No card data, no PAN, no token, no customer object, no raw
-- provider JSON. The event id, its type and what it led to are enough to
-- explain any order after the fact, and everything else is either a secret or
-- somebody's personal data that this shop has no reason to keep (ADR-0043,
-- docs/SECURITY.md). If a payload is ever genuinely needed for support, it is
-- one query away in the provider's own dashboard.
-- ---------------------------------------------------------------------------
create table public.payment_events (
  id bigint generated always as identity primary key,

  provider          text not null,
  provider_event_id text not null,
  event_type        text not null,

  -- Both nullable: an event may arrive for something we cannot match, and
  -- that fact is itself worth recording.
  payment_attempt_id bigint,
  order_id           bigint,

  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  outcome      text,

  constraint payment_events_attempt_fk foreign key (payment_attempt_id)
    references public.payment_attempts (id)
    on update cascade
    on delete restrict,

  constraint payment_events_order_fk foreign key (order_id)
    references public.orders (id)
    on update cascade
    on delete restrict,

  constraint payment_events_unique unique (provider, provider_event_id),
  constraint payment_events_provider_known check (provider in ('stripe')),
  constraint payment_events_type_present   check (event_type <> ''),

  constraint payment_events_outcome_known
    check (outcome is null or outcome in (
      'confirmed',               -- the order was paid and the stock booked
      'already_confirmed',       -- a repeat of something already done
      'amount_mismatch',         -- the money did not match the order
      'late_payment_unresolved', -- paid, but the hold was already gone
      'attempt_failed',
      'unknown_payment'          -- nothing here matches this payment
    )),

  -- An outcome without a time, or a time without an outcome, says nothing.
  constraint payment_events_processed_consistent
    check ((processed_at is null) = (outcome is null))
);

comment on table public.payment_events is
  'Provider events, deduplicated on (provider, provider_event_id) — the insert is the lock. Stores the event id, its type and what it led to, and deliberately no payload: no card data, no tokens, no personal data (docs/SECURITY.md).';

create index payment_events_order_idx on public.payment_events (order_id, received_at);


-- ---------------------------------------------------------------------------
-- 3. Grants — nothing, for anybody
--
-- No client role receives any privilege on either table, and no policy is
-- added, so RLS denies everything by default. Payment data is not something a
-- customer reads directly; when order history arrives it will be a projection
-- that shows a status, not this table.
-- ---------------------------------------------------------------------------
alter table public.payment_attempts enable row level security;
alter table public.payment_events   enable row level security;

revoke all on public.payment_attempts, public.payment_events from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. What may change about an attempt, and what may not
--
-- The money and the identity are fixed at creation. The provider's id and its
-- checkout URL may be filled in exactly once — NULL to a value and never
-- again. The status may only move forwards, and never out of a terminal
-- state.
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

  -- The lifecycle. Four states are terminal: money either moved or it did
  -- not, and neither answer is revisited on the same attempt.
  if new.status is distinct from old.status then
    if old.status in ('succeeded', 'failed', 'expired', 'cancelled') then
      raise exception 'attempt % is already %, and that is final', old.id, old.status
        using errcode = 'restrict_violation';
    end if;
    if old.status = 'created'
       and new.status not in ('pending', 'succeeded', 'failed', 'expired', 'cancelled') then
      raise exception 'a created attempt cannot become %', new.status
        using errcode = 'restrict_violation';
    end if;
    if old.status = 'pending'
       and new.status not in ('succeeded', 'failed', 'expired', 'cancelled') then
      raise exception 'a pending attempt cannot become %', new.status
        using errcode = 'restrict_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger payment_attempts_immutable
  before update on public.payment_attempts
  for each row execute function public.payment_attempts_protect();

-- An attempt is a financial record. It is closed, never removed.
create or replace function public.payment_attempts_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a payment attempt is closed, never deleted'
    using errcode = 'restrict_violation';
end;
$$;

create trigger payment_attempts_keep
  before delete on public.payment_attempts
  for each row execute function public.payment_attempts_no_delete();

-- Events may gain their outcome, and nothing else. They are never removed:
-- "we saw this event" is the whole point of the table.
create or replace function public.payment_events_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a payment event is never deleted' using errcode = 'restrict_violation';
  end if;

  if new.provider is distinct from old.provider
     or new.provider_event_id is distinct from old.provider_event_id
     or new.event_type is distinct from old.event_type
     or new.received_at is distinct from old.received_at then
    raise exception 'a payment event is immutable apart from its outcome'
      using errcode = 'restrict_violation';
  end if;

  if old.outcome is not null and new.outcome is distinct from old.outcome then
    raise exception 'an event outcome is recorded once' using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger payment_events_immutable
  before update on public.payment_events
  for each row execute function public.payment_events_protect();

create trigger payment_events_keep
  before delete on public.payment_events
  for each row execute function public.payment_events_protect();


-- ---------------------------------------------------------------------------
-- 5. start_payment_attempt() — opening one, or handing back the open one
--
-- Idempotent by design: an order with a live attempt gets that attempt back
-- rather than a second one. That is what makes a customer who reloads the
-- payment page, or taps twice, harmless.
--
-- WHEN AN ORDER MAY BE PAID
--
--   it exists
--   it is not already paid, refunded, cancelled or expired
--   nothing about it needs a human first (`needs_resolution`)
--   it still holds every line it ordered
--
-- The last one matters: an order whose reservation lapsed has nothing to sell
-- any more, and starting a payment for it would be inviting the late-payment
-- problem on purpose. The caller is expected to re-reserve first (B2.2).
--
-- THE AMOUNT COMES FROM THE ORDER
--
-- Read here, under the order's lock, from `total_amount` and `currency`. There
-- is no parameter for it, so there is nothing for a browser to forge.
-- ---------------------------------------------------------------------------
create or replace function public.start_payment_attempt(
  p_order_id bigint,
  p_provider text default 'stripe'
)
returns table (
  attempt_id bigint,
  amount     numeric,
  currency   text,
  status     text,
  reused     boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   record;
  v_open    record;
  v_lines   integer;
  v_active  integer;
  v_id      bigint;
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

  -- Already paying. Hand back what is there.
  select a.* into v_open
    from public.payment_attempts a
   where a.order_id = p_order_id
     and a.status in ('created', 'pending')
     for update;

  if found then
    attempt_id := v_open.id;
    amount     := v_open.amount;
    currency   := v_open.currency;
    status     := v_open.status;
    reused     := true;
    return next;
    return;
  end if;

  insert into public.payment_attempts (order_id, provider, amount, currency)
  values (p_order_id, p_provider, v_order.total_amount, v_order.currency)
  returning id into v_id;

  insert into public.order_events (order_id, event_type, actor_kind)
  values (p_order_id, 'payment_attempt_started', 'system');

  attempt_id := v_id;
  amount     := v_order.total_amount;
  currency   := v_order.currency;
  status     := 'created';
  reused     := false;
  return next;
end;
$$;

comment on function public.start_payment_attempt(bigint, text) is
  'Opens a payment attempt for an order, or returns the open one. The amount and currency are read from the order — there is no parameter for them. Refuses an order that is already settled, needs a human, or no longer holds its stock.';


-- ---------------------------------------------------------------------------
-- 6. attach_provider_payment() — the provider has a record now
--
-- Separate from opening the attempt because the provider is called between
-- the two, and that call can fail. An attempt without a provider payment is a
-- perfectly ordinary state: it simply never got as far as the provider, and
-- it expires with the reservation.
-- ---------------------------------------------------------------------------
create or replace function public.attach_provider_payment(
  p_attempt_id          bigint,
  p_provider_payment_id text,
  p_checkout_url        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider_payment_id is null or p_provider_payment_id = '' then
    raise exception 'a provider payment needs an id' using errcode = 'check_violation';
  end if;

  update public.payment_attempts
     set provider_payment_id   = p_provider_payment_id,
         provider_checkout_url = p_checkout_url,
         status                = case when status = 'created' then 'pending' else status end
   where id = p_attempt_id
     and status in ('created', 'pending')
     and provider_payment_id is null;

  if not found then
    raise exception 'attempt % cannot take a provider payment', p_attempt_id
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.attach_provider_payment(bigint, text, text) is
  'Records the provider''s own payment id on an open attempt and moves it to pending. Once only: the trigger refuses a second, different id.';


-- ---------------------------------------------------------------------------
-- 7. confirm_order_payment() — the moment money becomes stock
--
-- The heart of B2. Everything below happens in one transaction, under locks,
-- or none of it happens.
--
-- IDEMPOTENT THREE TIMES OVER
--
--   the event      inserting (provider, provider_event_id) is the lock
--   the order      `paid_at is null` decides whether there is work to do
--   the reservation `convert_order_reservations()` claims each one under lock
--
-- A provider that delivers the same event five times books one sale.
--
-- ALL OF IT OR NONE OF IT
--
-- Before anything is converted, the active reservations are counted against
-- the order's lines. If even one has lapsed, **nothing** is converted and the
-- order is flagged for a human. Converting the rest would half-sell an order —
-- some lines shipped, others not, and no way to tell the customer what they
-- bought. That is worse than asking somebody to look at it.
--
-- LATE PAYMENT NEVER OVERSELLS (ADR-0050)
--
-- A released reservation is not revived, and stock is not taken from whatever
-- happens to be on the shelf. The money is recorded as received — because it
-- was — and `needs_resolution` says the order cannot be filled automatically.
-- The operator then restocks or refunds. No inventory movement is written.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_order_payment(
  p_provider            text,
  p_provider_payment_id text,
  p_amount              numeric,
  p_currency            text,
  p_provider_event_id   text default null,
  p_event_type          text default 'payment_succeeded'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt   record;
  v_order     record;
  v_lines     integer;
  v_active    integer;
  v_converted integer;
  v_event_id  bigint;
  v_outcome   text;
begin
  -- 1. The event is the outermost lock — but seeing an event and finishing
  --    it are different things.
  --
  --    A row whose `processed_at` is still NULL was seen and NOT resolved, so
  --    a provider retry must run it again. Only a processed row is a genuine
  --    duplicate. The realistic case is not hypothetical: a webhook can
  --    arrive before `attach_provider_payment()` has committed, so the first
  --    delivery is legitimately unmatched. Treating that as done would drop
  --    every retry and the order would never be paid.
  if p_provider_event_id is not null then
    insert into public.payment_events (provider, provider_event_id, event_type)
    values (p_provider, p_provider_event_id, p_event_type)
    on conflict (provider, provider_event_id) do nothing
    returning id into v_event_id;

    if v_event_id is null then
      select e.id into v_event_id
        from public.payment_events e
       where e.provider = p_provider
         and e.provider_event_id = p_provider_event_id
         and e.processed_at is null
         for update;

      -- Already finished once. Repeats do nothing.
      if not found then
        return 'duplicate_event';
      end if;
      -- Seen but unresolved: fall through and try again.
    end if;
  end if;

  -- 2. Find the attempt this money belongs to.
  select a.* into v_attempt
    from public.payment_attempts a
   where a.provider = p_provider
     and a.provider_payment_id = p_provider_payment_id
     for update;

  if not found then
    -- Recorded as SEEN but deliberately NOT processed: `processed_at` stays
    -- NULL so the next delivery of the same event runs again. The attempt may
    -- simply not have been attached yet. The Edge Function answers non-2xx for
    -- this outcome so the provider keeps retrying (see the contract in the
    -- header); if the payment really is not ours, the row remains as evidence
    -- that something unplaceable arrived.
    return 'unknown_payment';
  end if;

  select o.* into v_order
    from public.orders o
   where o.id = v_attempt.order_id
     for update;

  -- 3. Already done? Then this is a repeat, and repeats do nothing.
  if v_order.paid_at is not null then
    v_outcome := 'already_confirmed';

  -- 4. Does the money match what was asked for?
  elsif p_amount is distinct from v_attempt.amount
        or upper(coalesce(p_currency, '')) <> v_attempt.currency then
    -- The attempt is over: this money does not match this order, and a
    -- second confirmation on the same attempt must not be possible. Leaving
    -- it `pending` would also keep the order's one open-attempt slot filled
    -- for ever.
    update public.payment_attempts
       set status = 'failed', failed_at = now()
     where id = v_attempt.id;

    update public.orders
       set needs_resolution = true
     where id = v_order.id;

    insert into public.order_events (order_id, event_type, actor_kind, payload)
    values (v_order.id, 'payment_amount_mismatch', 'provider',
            jsonb_build_object('expected', v_attempt.amount, 'expected_currency', v_attempt.currency,
                               'received', p_amount, 'received_currency', p_currency));

    v_outcome := 'amount_mismatch';

  else
    -- 5. Is the whole order still held?
    select count(*) into v_lines from public.order_lines l where l.order_id = v_order.id;
    select count(*) into v_active
      from public.order_reservations r
     where r.order_id = v_order.id
       and r.state = 'active';

    if v_active < v_lines then
      -- Late payment. The money is real, the goods are not reserved any more.
      -- Nothing is converted and no movement is written — see the header.
      update public.payment_attempts
         set status = 'succeeded', paid_at = now()
       where id = v_attempt.id;

      update public.orders
         set payment_status  = 'paid',
             paid_at         = now(),
             needs_resolution = true
       where id = v_order.id;

      insert into public.order_events (order_id, event_type, actor_kind, payload)
      values (v_order.id, 'late_payment_unresolved', 'provider',
              jsonb_build_object('held', v_active, 'required', v_lines));

      v_outcome := 'late_payment_unresolved';
    else
      -- 6. The ordinary, happy path.
      v_converted := public.convert_order_reservations(v_order.id);

      if v_converted < v_lines then
        -- Should be unreachable: the count above was taken under the same
        -- lock. Raising rather than continuing means an impossible state
        -- rolls back instead of half-selling.
        raise exception 'converted % of % reservations for order %',
          v_converted, v_lines, v_order.order_number
          using errcode = 'data_corrupted';
      end if;

      update public.payment_attempts
         set status = 'succeeded', paid_at = now()
       where id = v_attempt.id;

      update public.orders
         set payment_status = 'paid', paid_at = now()
       where id = v_order.id;

      insert into public.order_events (order_id, event_type, actor_kind, payload)
      values (v_order.id, 'payment_succeeded', 'provider',
              jsonb_build_object('attempt_id', v_attempt.id, 'lines', v_lines));

      v_outcome := 'confirmed';
    end if;
  end if;

  if v_event_id is not null then
    update public.payment_events
       set processed_at = now(),
           outcome = v_outcome,
           payment_attempt_id = v_attempt.id,
           order_id = v_attempt.order_id
     where id = v_event_id;
  end if;

  return v_outcome;
end;
$$;

comment on function public.confirm_order_payment(text, text, numeric, text, text, text) is
  'Turns a confirmed provider payment into a paid order and a booked sale, atomically and idempotently. Converts every reservation or none: a partly-lapsed hold is flagged for a human rather than half-sold. A late payment is recorded as received and never oversells (ADR-0050). Called only by the privileged Edge Function path (ADR-0051).';


-- ---------------------------------------------------------------------------
-- 8. fail_payment_attempt() — this try did not work
--
-- Closes the attempt and **leaves the order alone**. A declined card is not a
-- cancelled order: the reservation runs on to its normal expiry, and the
-- customer may start a fresh attempt with what is left of the twenty minutes.
-- `orders.payment_status` becomes `failed` only when somebody decides the
-- order itself is over, which no single provider refusal decides.
-- ---------------------------------------------------------------------------
create or replace function public.fail_payment_attempt(
  p_provider            text,
  p_provider_payment_id text,
  p_status              text default 'failed',
  p_provider_event_id   text default null,
  p_event_type          text default 'payment_failed'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt  record;
  v_event_id bigint;
begin
  if p_status not in ('failed', 'cancelled', 'expired') then
    raise exception 'an attempt cannot be closed as %', p_status
      using errcode = 'check_violation';
  end if;

  -- Same rule as confirm_order_payment(): only a processed event is a
  -- duplicate. An unresolved one is retried.
  if p_provider_event_id is not null then
    insert into public.payment_events (provider, provider_event_id, event_type)
    values (p_provider, p_provider_event_id, p_event_type)
    on conflict (provider, provider_event_id) do nothing
    returning id into v_event_id;

    if v_event_id is null then
      select e.id into v_event_id
        from public.payment_events e
       where e.provider = p_provider
         and e.provider_event_id = p_provider_event_id
         and e.processed_at is null
         for update;

      if not found then
        return 'duplicate_event';
      end if;
    end if;
  end if;

  select a.* into v_attempt
    from public.payment_attempts a
   where a.provider = p_provider
     and a.provider_payment_id = p_provider_payment_id
     for update;

  if not found then
    -- Left unprocessed, so a later delivery can still find the attempt.
    return 'unknown_payment';
  end if;

  if v_attempt.status in ('succeeded', 'failed', 'expired', 'cancelled') then
    if v_event_id is not null then
      update public.payment_events
         set processed_at = now(), outcome = 'already_confirmed',
             payment_attempt_id = v_attempt.id, order_id = v_attempt.order_id
       where id = v_event_id;
    end if;
    return 'already_closed';
  end if;

  update public.payment_attempts
     set status = p_status, failed_at = now()
   where id = v_attempt.id;

  -- The order is untouched on purpose. Its reservation is still running.
  insert into public.order_events (order_id, event_type, actor_kind, payload)
  values (v_attempt.order_id, 'payment_attempt_failed', 'provider',
          jsonb_build_object('attempt_id', v_attempt.id, 'status', p_status));

  if v_event_id is not null then
    update public.payment_events
       set processed_at = now(), outcome = 'attempt_failed',
           payment_attempt_id = v_attempt.id, order_id = v_attempt.order_id
     where id = v_event_id;
  end if;

  return 'closed';
end;
$$;

comment on function public.fail_payment_attempt(text, text, text, text, text) is
  'Closes one payment attempt as failed, cancelled or expired. The order stays pending and its reservation keeps running: a declined card is not a cancelled order, and the customer may try again.';


-- ---------------------------------------------------------------------------
-- 9. expire_stale_checkouts() — the sweep, extended to the order
--
-- 0010 released expired reservations. That is still the first thing that
-- happens here; what this adds is the paperwork around them, so an abandoned
-- checkout does not sit as "pending" for ever with an open attempt beside it.
--
-- An order is stale when it is still pending and holds nothing. Since every
-- order reserves at creation, and a converted reservation means it was paid,
-- "no active reservation left" is exactly "the hold lapsed and nobody paid".
--
-- SAFE BESIDE A PAYMENT
--
-- Both this and `confirm_order_payment()` take the order's row lock, so one
-- waits for the other:
--
--   sweep first    order expires, holds released; a confirmation arriving
--                  afterwards finds nothing held and flags needs_resolution —
--                  the late-payment path, which is correct
--   payment first  the order becomes paid, so the `pending` filter here no
--                  longer matches it and the sweep leaves it alone
--
-- Idempotent: a second run finds nothing pending without a hold.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_checkouts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   record;
  v_expired integer := 0;
begin
  -- Give the stock back first. This is 0010's function, unchanged.
  perform public.release_expired_reservations();

  for v_order in
    select o.id
      from public.orders o
     where o.payment_status = 'pending'
       and o.paid_at is null
       -- Never expire an order somebody has to look at. An amount mismatch
       -- leaves the order pending with needs_resolution set, and quietly
       -- expiring it out from under the operator would hide the problem.
       and o.needs_resolution = false
       and exists (select 1 from public.order_reservations r where r.order_id = o.id)
       and not exists (
             select 1 from public.order_reservations r
              where r.order_id = o.id and r.state = 'active'
           )
     order by o.id
     for update of o
  loop
    update public.payment_attempts
       set status = 'expired', failed_at = now()
     where order_id = v_order.id
       and status in ('created', 'pending');

    update public.orders
       set payment_status = 'expired'
     where id = v_order.id
       and payment_status = 'pending';

    if found then
      insert into public.order_events (order_id, event_type, actor_kind)
      values (v_order.id, 'checkout_expired', 'system');
      v_expired := v_expired + 1;
    end if;
  end loop;

  return v_expired;
end;
$$;

comment on function public.expire_stale_checkouts() is
  'Releases expired reservations, then closes the checkouts that lapsed with them: open attempts become expired and the order becomes expired. Idempotent, and safe beside a payment confirmation because both take the order''s row lock. Intended to run every five minutes; no scheduler is installed by this migration.';


-- ---------------------------------------------------------------------------
-- 10. Privileges — none, to anybody
--
-- Every function here is internal. The privileged caller is a Supabase Edge
-- Function running inside Supabase (ADR-0051), which is why no service-role
-- key has to exist in Vercel and no shared secret has to travel with a
-- request.
--
-- Supabase grants EXECUTE on new functions in `public` to anon and
-- authenticated by default, so `from public` alone would not be enough — that
-- is the mistake 0010 made and 0011 documented.
-- ---------------------------------------------------------------------------
revoke all on function public.payment_attempts_protect()   from public, anon, authenticated;
revoke all on function public.payment_attempts_no_delete() from public, anon, authenticated;
revoke all on function public.payment_events_protect()     from public, anon, authenticated;

revoke all on function public.start_payment_attempt(bigint, text)
  from public, anon, authenticated;
revoke all on function public.attach_provider_payment(bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.confirm_order_payment(text, text, numeric, text, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_payment_attempt(text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.expire_stale_checkouts()
  from public, anon, authenticated;
