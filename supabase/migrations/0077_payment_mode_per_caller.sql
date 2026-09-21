-- ===========================================================================
-- 0077 — LIVE AND SANDBOX SIDE BY SIDE, DECIDED PER CALLER
-- ===========================================================================
--
-- Until now the payment world was a property of the SHOP: one
-- `commerce_settings.mode` for everybody, one Stripe key per deployment. That
-- makes the two things we actually need impossible at the same time:
--
--   * a tester must be able to run a full sandbox checkout WHILE the shop is
--     switched off for customers, and
--   * a tester must NEVER be charged real money once the shop is switched on.
--
-- Both follow from one change: the payment world becomes a property of the
-- CALLER, derived from two facts the caller cannot influence.
--
--     tester                      -> sandbox, always, no exception
--     not a tester, shop live     -> live
--     not a tester, shop not live -> no payment at all
--
-- THE SHOP SWITCH NOW ONLY STEERS NORMAL ACCOUNTS. `commerce_settings.mode`
-- keeps its three values and its meaning for customers — `live` is the only
-- one that lets a normal account pay — but it no longer has any say over
-- testers. A tester is in the sandbox under all three.
--
-- WHAT THIS DOES NOT DO
--
-- It does not reinterpret one existing row. `orders.commerce_mode` keeps the
-- value it was stamped with, and the new rules make an order payable only
-- while its stamped world still matches what its owner is entitled to. An
-- old sandbox order therefore does not become live when the shop opens — it
-- becomes unpayable, which is the safe half of that choice.
--
-- NO INVENTORY. No movement, no quantity, no reservation. Four functions, one
-- trigger, one new read for the payment function.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The rule, in one place
--
-- Everything else in this migration asks this function. It takes the user id
-- rather than reading the session, because the two callers that matter are
-- not sessions: the INSERT trigger sees a row, and the payment function runs
-- as the service role on behalf of an order placed minutes ago.
--
-- NULL means "no payment is possible", never "fall back to something". Every
-- caller treats NULL as a refusal.
-- ---------------------------------------------------------------------------

create or replace function public.payment_mode_for_user(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           /*
            * THE INVARIANT. A tester is in the sandbox no matter what the
            * shop switch says — including `live`. There is deliberately no
            * branch, flag or parameter that can move a tester to `live`.
            */
           when p_user_id is not null and public.is_commerce_tester_for(p_user_id)
             then 'sandbox'
           /* A normal account — and a guest, who has no user id at all —
              pays only while the shop is open, and then only for real. */
           when public.commerce_mode() = 'live'
             then 'live'
           else null
         end;
$$;

comment on function public.payment_mode_for_user(uuid) is
  'Which Stripe world this account pays in (0077): `sandbox` for a commerce tester, always and regardless of the shop switch; `live` for anyone else while the shop mode is live; NULL when no payment is possible. NULL is a refusal and never a fallback.';

revoke all on function public.payment_mode_for_user(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. The same rule for the caller in front of us
-- ---------------------------------------------------------------------------

create or replace function public.effective_payment_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.payment_mode_for_user((select auth.uid()));
$$;

comment on function public.effective_payment_mode() is
  'Which Stripe world the CALLING identity pays in (0077). A signed-out visitor has no user id and is therefore never a tester. NULL means no payment is possible.';

revoke all on function public.effective_payment_mode() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. The checkout gate, rewritten around it
--
-- Same signature, same callers, one sentence of meaning changed: a tester may
-- now check out while the shop is closed, and a tester in a live shop is in
-- the sandbox rather than in the live world.
-- ---------------------------------------------------------------------------

create or replace function public.commerce_checkout_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.effective_payment_mode() is not null;
$$;

comment on function public.commerce_checkout_allowed() is
  'May the calling identity start a checkout right now (0077)? True exactly when a payment world exists for it: a commerce tester always (in the sandbox), anyone else only while the shop mode is live. Guests are never testers, so sandbox checkout stays closed to them.';

revoke all on function public.commerce_checkout_allowed() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. What the interface is told
--
-- `reason` keeps its three values so every existing reader still works.
-- `is_sandbox` is new and says one thing to the caller about the caller: that
-- their own checkout will not charge real money. A tester already knows they
-- are a tester, so this reveals nothing — and a checkout that takes a card
-- number must be able to say out loud that it is a test.
-- ---------------------------------------------------------------------------

/*
 * DROPPED FIRST, BECAUSE THE RETURN TYPE CHANGES.
 *
 * `is_sandbox` is a third output column, and PostgreSQL refuses to
 * `create or replace` a function into a different return type — it answers
 * "cannot change return type of existing function" and the whole migration
 * fails. The grants are re-issued below, because a dropped function takes
 * them with it.
 */
drop function if exists public.commerce_access();

create or replace function public.commerce_access()
returns table (may_checkout boolean, reason text, is_sandbox boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select public.effective_payment_mode() is not null,
         case
           when public.effective_payment_mode() is not null then 'open'
           -- Unchanged for customers: `sandbox` is the mode that says
           -- "somebody is testing", and it is the only refusal that hints so.
           when public.commerce_mode() = 'sandbox' then 'testers_only'
           else 'closed'
         end,
         /*
          * COALESCE, BECAUSE `NULL = 'sandbox'` IS NULL, NOT FALSE.
          *
          * The column is declared `boolean` and callers read it as a flag.
          * Without this, every row where no payment world exists answers
          * NULL — harmless for the one reader we have, which demands a
          * literal `true`, and a trap for the next one.
          */
         coalesce(public.effective_payment_mode() = 'sandbox', false);
$$;

comment on function public.commerce_access() is
  'What the current caller may do, for the interface (0077). Never the shop mode itself, never the tester list. `is_sandbox` is about the caller''s own checkout, so the page can say that no real money will move.';

revoke all on function public.commerce_access() from public;
grant execute on function public.commerce_access() to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. The floor: an order is stamped by the database, never by its caller
--
-- `create_order()` already refuses when there is no payment world, and it is
-- left untouched — 271 lines whose every other rule is verified elsewhere.
-- What this trigger adds is that the stamp itself is not the caller's to
-- choose. Whatever value reaches the INSERT is overwritten by the rule, and
-- an insert with no payment world raises instead of inventing one.
--
-- This is the same shape as `orders_clear_client_hash_trg` from 0047: a
-- BEFORE INSERT trigger that owns one column outright.
-- ---------------------------------------------------------------------------

create or replace function public.orders_stamp_payment_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := public.payment_mode_for_user(new.user_id);
begin
  if v_mode is null then
    raise exception 'no payment world exists for this account; checkout is not available'
      using errcode = 'check_violation';
  end if;
  new.commerce_mode := v_mode;
  return new;
end;
$$;

comment on function public.orders_stamp_payment_mode() is
  'Stamps `orders.commerce_mode` from the rule in `payment_mode_for_user()` (0077), overwriting whatever the INSERT carried. Raises when no payment world exists, so an order can never come into being without one.';

drop trigger if exists orders_stamp_payment_mode_trg on public.orders;
create trigger orders_stamp_payment_mode_trg
  before insert on public.orders
  for each row
  execute function public.orders_stamp_payment_mode();


-- ---------------------------------------------------------------------------
-- 6. May this caller pay for this order?
--
-- 0021's function with one condition rebased. It asked whether the SHOP was
-- in sandbox; it now asks what the ORDER is, which is the durable fact. A
-- sandbox order still requires its owner to be a current tester, so a
-- withdrawn tester cannot finish one — unchanged in spirit, and now correct
-- while the shop is live as well.
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
       -- And the world the order was placed in must still be the world its
       -- owner belongs to. This is the whole live/sandbox separation, stated
       -- once: a sandbox order needs a tester behind it, forever.
       and o.commerce_mode is not distinct from public.payment_mode_for_user(o.user_id)
  );
$$;

comment on function public.authorize_order_payment(bigint, uuid, text) is
  'May this caller pay for this order (0077): the account that placed it, or the capability issued when it was placed — and only while the order''s stamped world still matches what its owner is entitled to. A sandbox order therefore stays with testers, and an old sandbox order does not become payable when the shop goes live.';

revoke all on function public.authorize_order_payment(bigint, uuid, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. Which world does this order belong to?
--
-- The one read `create-payment` needs in order to pick a Stripe key. It
-- answers with the order's own stamped world, and only while that world is
-- still the right one for its owner — so the function that picks the secret
-- can never be handed a stale or contradictory answer.
--
-- NULL for every unclear case: no such order, or an order whose stamp and
-- entitlement disagree. The caller refuses on NULL.
-- ---------------------------------------------------------------------------

create or replace function public.order_payment_mode(p_order_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.commerce_mode
    from public.orders o
   where o.id = p_order_id
     and o.commerce_mode is not distinct from public.payment_mode_for_user(o.user_id)
     and o.commerce_mode in ('live', 'sandbox');
$$;

comment on function public.order_payment_mode(bigint) is
  'Which Stripe world one order belongs to (0077), for the payment function that has to choose a secret key. NULL when the order does not exist, when its stamp no longer matches its owner''s entitlement, or when it carries a mode that is not payable at all. NULL always means refuse.';

revoke all on function public.order_payment_mode(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 8. Opening an attempt, with the mode check rebased
--
-- Byte for byte 0021's function apart from the one comparison below — the
-- body was extracted from that migration and patched programmatically rather
-- than retyped, and `payment-mode-matrix.test.ts` re-does that extraction and
-- fails if any other line has drifted.
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

  -- The world it was placed in must still be the world its owner belongs to.
  --
  -- A sandbox order was priced and reserved against a test-mode Stripe key;
  -- opening an attempt for it with a live key would ask a customer for real
  -- money on a test purchase, and the reverse would settle a real order with
  -- test money. Neither is recoverable by an apology, so neither is
  -- reachable.
  --
  -- Since 0077 this compares against the OWNER's entitlement rather than the
  -- shop switch. That is what lets a tester finish a sandbox order while the
  -- shop is live — and what keeps an old sandbox order from becoming payable
  -- with real money when the shop opens: for a non-tester the rule now says
  -- `live`, the stamp still says `sandbox`, and the two do not match.
  if v_order.commerce_mode is distinct from public.payment_mode_for_user(v_order.user_id) then
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
  'Open or reuse the one open payment attempt for an order (0015), refusing an order that is not pending, needs a human, has lost its hold, or whose stamped payment world no longer matches its owner''s entitlement (0077).';


-- ---------------------------------------------------------------------------
-- 9. Which world does this provider payment belong to?
--
-- The webhook's half of the separation. It learns from the signature which
-- world an event came from, and this says which world the attempt it names
-- lives in. If the two disagree the delivery is refused before
-- `confirm_order_payment()` or `fail_payment_attempt()` is reached, so a
-- sandbox event cannot touch a live order and a live event cannot touch a
-- sandbox one.
--
-- Session ids from the two worlds are drawn from different Stripe accounts
-- and would not be expected to collide. "Would not be expected to" is not a
-- guarantee, and this is the guarantee.
--
-- NULL means no attempt carries this payment id — which is a legitimate,
-- already-handled case (`unknown_payment`), so the caller must treat NULL as
-- "no opinion" rather than as a refusal.
-- ---------------------------------------------------------------------------

create or replace function public.payment_attempt_mode(
  p_provider            text,
  p_provider_payment_id text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.commerce_mode
    from public.payment_attempts a
    join public.orders o on o.id = a.order_id
   where a.provider = p_provider
     and a.provider_payment_id = p_provider_payment_id
   order by a.id desc
   limit 1;
$$;

comment on function public.payment_attempt_mode(text, text) is
  'The commerce world of the order behind one provider payment id (0077), so the webhook can refuse an event from the other world before it acts. NULL means no attempt matches — not a refusal, just no opinion.';

revoke all on function public.payment_attempt_mode(text, text) from public, anon, authenticated;
