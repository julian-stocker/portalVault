-- ===========================================================================
-- 0049 — one declaration, one statutory receipt
--
-- WHY THIS MIGRATION EXISTS, AND WHY IT IS NOT AN EDIT TO 0047.
--
-- `0047` is applied to Staging. An applied migration is never rewritten, so
-- the correction is additive and carries the next free number — which is why
-- Staging's real order is `0047 → 0049 → 0048`. The numbering records when
-- each file was WRITTEN; the database records when each was APPLIED, and the
-- two are allowed to differ. Pretending otherwise would mean editing history
-- that other environments have already consumed.
--
-- THE DEFECT. `withdrawal-actions.ts` promised, in its own comment, that "the
-- function refuses a withdrawal whose receipt is no longer `pending`, so one
-- declaration produces exactly one confirmation however often this is called".
-- Nothing refused anything. Invoking the receipt twice on Staging sent twice
-- and moved `receipt_sent_at` from 08:34:31 to 08:34:45 — the second call
-- overwrote the record of when the § 356a Abs. 4 confirmation actually went
-- out. The only thing standing between a consumer and a duplicate statutory
-- receipt was Resend's `idempotencyKey`, which is a provider convenience with
-- a finite window, not an invariant of this system.
--
-- WHAT REPLACES IT: A CLAIM, NOT A CHECK-THEN-ACT.
--
-- "Read the state, decide, then send" is a race with itself: two requests
-- arriving together both read `pending` and both send. So the state change IS
-- the decision —
--
--     update … set receipt_state = 'sending'
--      where id = $1 and receipt_state in ('pending', 'failed', <stale>)
--
-- — and the caller may send only if that statement changed a row. Two
-- concurrent callers serialise on the row lock; the loser re-evaluates its
-- WHERE against the winner's committed row, matches nothing, and is told to
-- stand down. No advisory lock, no retry loop, no window.
--
-- THE STATE MODEL, now four states:
--
--     pending  → sending    a caller has claimed the send
--     sending  → sent       the provider accepted it. TERMINAL.
--     sending  → failed     the provider refused. Claimable again.
--     failed   → sending    a legitimate retry
--
-- `sent` is terminal and `receipt_sent_at` is write-once, both enforced by a
-- trigger rather than by the convention of the functions above them — the
-- point of this migration is that the database, not a caller, holds the line.
--
-- A STALE CLAIM IS NOT A DEAD END. If a sender dies between claiming and
-- reporting, the row would sit in `sending` forever and the consumer would
-- never get their receipt. A claim older than 15 minutes may therefore be
-- taken over: far longer than any mail call, far shorter than a consumer
-- should wait.
--
-- PRIVACY IS UNCHANGED. Nothing here touches `receive_withdrawal()`, the
-- uniform non-match answer, or `withdrawal_attempts`. These functions are
-- reachable only with a withdrawal id that already required the order number
-- and the e-mail address on that order, and they are revoked from every client
-- role regardless.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The fourth state, and the invariant
-- ---------------------------------------------------------------------------

alter table public.withdrawal_requests
  add column if not exists receipt_attempt_at timestamptz;

comment on column public.withdrawal_requests.receipt_attempt_at is
  'When the current send was claimed. Only meaningful while receipt_state = ''sending''; it is what makes a stale claim recognisable (0049).';

-- Normalise before constraining, so the invariant cannot fail on history.
-- A row that carries a send time IS sent, whatever its state column says.
update public.withdrawal_requests
   set receipt_state = 'sent'
 where receipt_sent_at is not null
   and receipt_state <> 'sent';

-- And the reverse: 'sent' without a time is a record of something that has no
-- evidence. `received_at` is the closest defensible value — it is at worst
-- earlier than the send, never later, so no deadline is ever overstated.
update public.withdrawal_requests
   set receipt_sent_at = received_at
 where receipt_state = 'sent'
   and receipt_sent_at is null;

alter table public.withdrawal_requests
  drop constraint if exists withdrawal_requests_receipt_state_known;
alter table public.withdrawal_requests
  add constraint withdrawal_requests_receipt_state_known
  check (receipt_state in ('pending', 'sending', 'sent', 'failed'));

-- The invariant this migration exists to protect, stated once, structurally:
-- a receipt is sent exactly when it has a send time.
alter table public.withdrawal_requests
  drop constraint if exists withdrawal_requests_sent_has_a_time;
alter table public.withdrawal_requests
  add constraint withdrawal_requests_sent_has_a_time
  check ((receipt_state = 'sent') = (receipt_sent_at is not null));


-- ---------------------------------------------------------------------------
-- 2. `sent` is terminal, and the send time is written once
--
-- A CHECK cannot express either: both are statements about the transition,
-- not about the row. `invoices` and `order_legal_snapshots` refuse every
-- change; this one refuses the changes that would rewrite what happened, and
-- permits the rest.
-- ---------------------------------------------------------------------------

create or replace function public.withdrawal_receipt_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.receipt_state = 'sent' and new.receipt_state <> 'sent' then
    raise exception 'a receipt that has been sent cannot become unsent'
      using errcode = 'restrict_violation';
  end if;

  if old.receipt_sent_at is not null
     and new.receipt_sent_at is distinct from old.receipt_sent_at then
    raise exception 'the time a statutory receipt was sent cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

comment on function public.withdrawal_receipt_protect() is
  'Keeps the § 356a Abs. 4 receipt record truthful: once sent it stays sent, and the moment it was sent is never rewritten (0049).';

drop trigger if exists withdrawal_receipt_protect_trg on public.withdrawal_requests;
create trigger withdrawal_receipt_protect_trg
  before update on public.withdrawal_requests
  for each row execute function public.withdrawal_receipt_protect();


-- ---------------------------------------------------------------------------
-- 3. Claiming the send
--
-- Returns true to exactly one caller. Everything about idempotency hangs on
-- this being a single statement: the read, the decision and the write are the
-- same operation, so there is no instant at which two callers can both believe
-- they may send.
-- ---------------------------------------------------------------------------

create or replace function public.claim_withdrawal_receipt(p_withdrawal_id bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claimed boolean := false;
begin
  update public.withdrawal_requests w
     set receipt_state = 'sending',
         receipt_attempt_at = now()
   where w.id = p_withdrawal_id
     and (
       -- Never been tried.
       w.receipt_state = 'pending'
       -- Tried and the provider refused: a retry is the whole point.
       or w.receipt_state = 'failed'
       -- Claimed by a sender that never came back. 15 minutes is far longer
       -- than a mail API call and far shorter than a consumer should wait for
       -- the confirmation the statute promises them.
       or (w.receipt_state = 'sending'
           and w.receipt_attempt_at < now() - interval '15 minutes')
     );

  -- FOUND is about this statement only, and the statement is the claim.
  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

comment on function public.claim_withdrawal_receipt(bigint) is
  'Claims the right to send a withdrawal receipt, atomically. True for exactly one caller; false means somebody else is sending it or it has already gone out (0049).';

revoke all on function public.claim_withdrawal_receipt(bigint)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Reporting the outcome
--
-- Same signature as `0047`, so nothing that already calls it breaks — but it
-- no longer overwrites anything.
--
-- `coalesce(w.receipt_sent_at, now())` is the fix stated in one expression:
-- the first success sets the time, every later one keeps it. The trigger above
-- makes that true even if this function were bypassed.
-- ---------------------------------------------------------------------------

create or replace function public.mark_withdrawal_receipt(
  p_withdrawal_id bigint,
  p_state         text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.withdrawal_requests w
     set receipt_state   = p_state,
         receipt_sent_at = case
                             when p_state = 'sent'
                               then coalesce(w.receipt_sent_at, now())
                             else w.receipt_sent_at
                           end
   where w.id = p_withdrawal_id
     and p_state in ('sent', 'failed')
     -- Only a claim can be resolved, and an already-sent receipt is finished.
     -- Reporting failure for a receipt that went out would be a lie about a
     -- statutory record.
     and w.receipt_state <> 'sent';
$$;

comment on function public.mark_withdrawal_receipt(bigint, text) is
  'Resolves a claimed receipt send. Since 0049 the send time is write-once and an already-sent receipt is never reopened.';

revoke all on function public.mark_withdrawal_receipt(bigint, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. What the operator sees
--
-- `sending` is a state a person can now encounter, so the seller's list has to
-- be able to name it. Reading only; no behaviour depends on this.
-- ---------------------------------------------------------------------------

create or replace function public.withdrawal_receipt_state(p_withdrawal_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'receipt_state',   w.receipt_state,
           'receipt_sent_at', w.receipt_sent_at,
           'attempted_at',    w.receipt_attempt_at
         )
    from public.withdrawal_requests w
   where w.id = p_withdrawal_id
     and public.can_operate_active_seller();
$$;

comment on function public.withdrawal_receipt_state(bigint) is
  'The receipt delivery state of one withdrawal, for the seller''s own view. Seller-gated like every other seller_* read (0049).';

revoke all on function public.withdrawal_receipt_state(bigint)
  from public, anon, authenticated;
grant execute on function public.withdrawal_receipt_state(bigint) to authenticated;
