-- ===========================================================================
-- 0019 — Transactional mail: delivery state and the business contact
--
-- Three mails exist after this migration, and not one of them is sent by the
-- database:
--
--   payment_confirmation   to the customer, when money has actually arrived
--   shipping_confirmation  to the customer, when the parcel is on its way
--   resolution_alert       to the operator, when an order needs a human
--
-- Sending belongs to `send-order-mail`, an Edge Function holding the Resend
-- key. What belongs here is the one thing an external provider cannot answer:
-- **have we already handed this mail over, and may we hand it over again?**
--
-- WHY THERE IS STATE AT ALL
--
-- Duplicate protection alone would need nothing: `confirm_order_payment()`
-- already returns `confirmed` exactly once per order, and the fulfilment
-- trigger allows `unfulfilled -> shipped` exactly once. A webhook replay
-- therefore never reaches a second send.
--
-- Loss protection is the reason. Without a record, a confirmation that Resend
-- refused is gone silently — for the one mail that matters commercially most.
-- So each mail keeps a row, and the row is what the administrator sees.
--
-- FOUR STATES, AND THE AMBIGUOUS ONE IS THE POINT
--
--   sending     claimed, request in flight. Transient.
--   sent        the provider accepted it and returned a message id. TERMINAL.
--   failed      the provider clearly refused. Retryable.
--   unresolved  nobody can say. A 409 idempotency conflict, a timeout, or a
--               `sending` row whose process never came back. Visible to the
--               administrator, never resent without an explicit acknowledgement.
--
-- The distinction between `failed` and `unresolved` is the whole design.
-- Resend's idempotency keys expire after 24 hours, so a later retry cannot
-- assume the provider still remembers. `sent` is therefore terminal for good,
-- and anything we could not read an answer for stays a question for a person
-- rather than a guess by a machine.
--
-- NO QUEUE, NO DAEMON, NO SWEEP. Nothing polls this table, nothing retries on
-- a timer. A retry is an administrator pressing a button.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- No invoice, no template, no provider call, no address of any kind in the
-- schema as a literal. The business contact is a value an administrator sets;
-- the technical From address stays environment configuration and never enters
-- the database at all.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. business_settings — the operator's own facts, in one place
--
-- NOT a column on `shop_settings`. That table answers one question — what
-- SkyIsles charges relative to the market price — and it belongs to the shop.
-- What arrives here is a different kind of thing with a different lifetime and
-- a different audience: who the operator *is*. The legal pages, the invoice
-- block and transactional mail will all read the same facts, and a fact that
-- three surfaces quote must have exactly one home (ADR-0059).
--
-- ONLY WHAT THE MAIL BLOCK NEEDS TODAY
--
-- Two columns, because two are needed now. The fields the legal block will add
-- — legal name, trading name, service address, phone, tax details — are named
-- in ADR-0059 and deliberately absent from the schema until something renders
-- them. An empty column is a promise nobody checked.
--
-- THREE SENSITIVITIES, AND THE DEFAULT IS THE STRICT ONE
--
--   public    meant to be seen: the contact address, later the legal name and
--             the service address. Reachable ONLY through
--             `business_settings_public()`, which names its columns literally.
--   internal  operational: the Reply-To override. Administrator only.
--   never     tax identifiers and anything like them. Administrator only, and
--             never added to the public projection.
--
-- The projection is an allow-list of named columns, so a column added later is
-- invisible until somebody edits that function on purpose. `business.test.ts`
-- pins the list, which is what turns the convention into a guarantee.
--
-- AUTHORISATION IS UNCHANGED AND UNRELATED
--
-- Nothing here authorises anybody. `is_shop_admin()` decides who may act, over
-- `shop_admins.user_id`, exactly as before. An address in this table is data
-- the operator publishes, never a credential (ADR-0059).
-- ---------------------------------------------------------------------------
create table if not exists public.business_settings (
  id boolean primary key default true,

  -- PUBLIC. The address a customer writes to, and the Reply-To transactional
  -- mail carries unless the override below says otherwise.
  contact_email text,

  -- INTERNAL. For the case where replies should go somewhere other than the
  -- published contact address. NULL means "use contact_email".
  transactional_reply_to text,

  updated_at timestamptz not null default now(),
  updated_by uuid,

  constraint business_settings_singleton check (id),

  constraint business_settings_updated_by_fk foreign key (updated_by)
    references auth.users (id) on delete set null,

  -- Deliberately loose, for the same reason `validateDraft()` is: address
  -- syntax is not a useful gate, delivery is. This catches a fat finger.
  constraint business_settings_contact_shape
    check (
      contact_email is null
      or (contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          and length(contact_email) <= 254)
    ),

  constraint business_settings_reply_to_shape
    check (
      transactional_reply_to is null
      or (transactional_reply_to ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          and length(transactional_reply_to) <= 254)
    )
);

comment on table public.business_settings is
  'The operator''s own facts, shared by transactional mail, the legal pages and later the invoice block (ADR-0059). Singleton. Not public: the only way out for a visitor is business_settings_public(), which names its columns literally. Nothing here authorises anybody — that is shop_admins alone.';

comment on column public.business_settings.contact_email is
  'PUBLIC. The published business contact address, and the default Reply-To for transactional mail.';

comment on column public.business_settings.transactional_reply_to is
  'INTERNAL. Overrides the Reply-To when replies should not go to the published contact address. The From address is environment configuration and is deliberately absent from this table.';

-- The singleton, created empty. No address is seeded: the operator sets it in
-- the admin area, and a value in a migration would be exactly the hardcoded
-- business datum this project keeps out of its source.
insert into public.business_settings (id) values (true)
on conflict (id) do nothing;

alter table public.business_settings enable row level security;

-- Closed to every client role. RLS is on with no policy, and the grants are
-- gone — the same shape the commerce tables have (0010).
revoke all on public.business_settings from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. order_mail — one row per (order, mail), and nothing more
--
-- No recipient address: the customer's is already on `orders.customer_email`
-- and the operator's is in `business_settings`. Storing either again would be PII
-- duplicated for no gain.
--
-- No message body, no subject, no template name, no payload. This is a
-- delivery record, not an archive — Resend keeps what was sent.
-- ---------------------------------------------------------------------------
create table if not exists public.order_mail (
  order_id bigint not null,

  -- Which of the three mails. Adding a fourth means editing this CHECK, which
  -- is the intended amount of friction: a mail nobody named is a mail nobody
  -- reviewed.
  kind text not null,

  state text not null default 'sending',

  -- When the current attempt took the claim. Also how a crashed process is
  -- recognised: a `sending` row older than the grace period is `unresolved`.
  claimed_at timestamptz not null default now(),

  -- Set once, when the provider has accepted. Never cleared.
  sent_at timestamptz,

  -- Resend's id, for a support case. Not a secret and not an identifier
  -- anybody can act on.
  provider_message_id text,

  -- How many times a send was started. A counter for a human to read; nothing
  -- loops on it and nothing decides by it.
  attempts integer not null default 0,

  -- The provider's error name, e.g. `rate_limit_exceeded`. Never a whole error
  -- object, never a stack, never a header.
  last_error text,

  updated_at timestamptz not null default now(),

  constraint order_mail_pk primary key (order_id, kind),

  constraint order_mail_order_fk foreign key (order_id)
    references public.orders (id)
    on update cascade
    on delete restrict,

  constraint order_mail_kind_known
    check (kind in ('payment_confirmation', 'shipping_confirmation', 'resolution_alert')),

  constraint order_mail_state_known
    check (state in ('sending', 'sent', 'failed', 'unresolved')),

  -- A sent mail has both facts; anything else has neither promised.
  constraint order_mail_sent_is_complete
    check ((state = 'sent') = (sent_at is not null)),

  constraint order_mail_attempts_sane
    check (attempts >= 0),

  constraint order_mail_error_length
    check (last_error is null or length(last_error) <= 200)
);

comment on table public.order_mail is
  'Delivery state for transactional mail, one row per (order, kind). Exists so a mail the provider refused is visible rather than silently lost, and so a replayed webhook cannot produce a second confirmation. No queue and no sweep reads it.';

-- The administrator's list view asks "what still needs attention", which is
-- every row that is neither sent nor freshly in flight.
create index if not exists order_mail_unfinished_idx
  on public.order_mail (state)
  where state <> 'sent';

alter table public.order_mail enable row level security;

-- Closed to every client role, like the rest of commerce (0010). Access is
-- through the functions below and nowhere else.
revoke all on public.order_mail from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. The state rule, in one place
--
-- `sending` is only honest for as long as a request can plausibly still be in
-- flight. Past that it means the process never came back, and the answer is
-- "nobody knows" — not "failed", which would invite a blind retry against a
-- provider that may well have sent the mail.
-- ---------------------------------------------------------------------------
create or replace function public.order_mail_grace()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '10 minutes' $$;

comment on function public.order_mail_grace() is
  'How long a claim may stay in `sending` before it is read as unresolved. Generous: an Edge Function invocation is bounded in seconds, so anything past this is a crash, not slowness.';

create or replace function public.order_mail_effective_state(
  p_state      text,
  p_claimed_at timestamptz
)
returns text
language sql
-- STABLE, not IMMUTABLE: it reads `now()`. An immutable function that depends
-- on the clock is one the planner is entitled to fold to a constant, which
-- would freeze "is this claim stale" at whatever it was when a plan was made.
stable
set search_path = ''
as $$
  select case
           when p_state = 'sending' and p_claimed_at < now() - public.order_mail_grace()
             then 'unresolved'
           else p_state
         end
$$;

comment on function public.order_mail_effective_state(text, timestamptz) is
  'The state as a human should read it: a stale claim is unresolved. One rule, used by claim_order_mail() and by admin_order() so the interface and the guard can never disagree.';


-- ---------------------------------------------------------------------------
-- 4. The guard trigger — defence in depth
--
-- The rules live in the functions below. This makes the two that would cost
-- money or trust impossible regardless of caller: a sent mail never becomes
-- unsent, and a delivery record is never deleted.
-- ---------------------------------------------------------------------------
create or replace function public.order_mail_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.state = 'sent' and new.state is distinct from 'sent' then
    raise exception 'a sent mail cannot be unsent'
      using errcode = 'restrict_violation';
  end if;

  if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
    raise exception 'sent_at is written once'
      using errcode = 'restrict_violation';
  end if;

  if old.provider_message_id is not null
     and new.provider_message_id is distinct from old.provider_message_id then
    raise exception 'the provider message id is written once'
      using errcode = 'restrict_violation';
  end if;

  if new.order_id is distinct from old.order_id or new.kind is distinct from old.kind then
    raise exception 'a delivery record cannot be moved to another order or kind'
      using errcode = 'restrict_violation';
  end if;

  -- An attempt is never un-counted.
  if new.attempts < old.attempts then
    raise exception 'attempts only ever goes up'
      using errcode = 'restrict_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists order_mail_guard on public.order_mail;
create trigger order_mail_guard
  before update on public.order_mail
  for each row execute function public.order_mail_protect();

create or replace function public.order_mail_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'delivery records are not deleted'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists order_mail_no_delete on public.order_mail;
create trigger order_mail_no_delete
  before delete on public.order_mail
  for each row execute function public.order_mail_no_delete();


-- ---------------------------------------------------------------------------
-- 5. claim_order_mail() — the only way a send begins
--
-- Returns what the caller may do, never a boolean:
--
--   claimed       go ahead and send
--   already_sent  do nothing, ever again
--   in_flight     somebody else is sending right now
--   unresolved    a person has to look; pass p_force only on their say-so
--
-- The INSERT is the lock. Two concurrent triggers race on the primary key and
-- exactly one wins; the loser reads the row and is told `in_flight`.
--
-- `p_force` exists for one case: an administrator who has looked at an
-- unresolved record and decided to send anyway. The Edge Function only passes
-- it after verifying a real administrator JWT — it is never set by a webhook.
-- ---------------------------------------------------------------------------
create or replace function public.claim_order_mail(
  p_order_number text,
  p_kind         text,
  p_force        boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id  bigint;
  v_row       public.order_mail;
  v_effective text;
begin
  -- Every mail function speaks in order numbers, so no internal id ever
  -- leaves the database — not to an Edge Function, not into a log line.
  select o.id into v_order_id from public.orders o where o.order_number = p_order_number;
  if not found then
    return 'unknown_order';
  end if;

  insert into public.order_mail (order_id, kind, state, claimed_at, attempts)
  values (v_order_id, p_kind, 'sending', now(), 1)
  on conflict (order_id, kind) do nothing;

  if found then
    return 'claimed';
  end if;

  select * into v_row
    from public.order_mail m
   where m.order_id = v_order_id
     and m.kind = p_kind
     for update;

  if not found then
    -- The conflicting row was inserted and is not visible to this snapshot.
    -- Treating that as in flight is correct: somebody is sending.
    return 'in_flight';
  end if;

  -- Terminal, and it outranks p_force. Resend's idempotency window is 24
  -- hours; past that a second send would be a second mail in the customer's
  -- inbox, and no flag makes that acceptable.
  if v_row.state = 'sent' then
    return 'already_sent';
  end if;

  v_effective := public.order_mail_effective_state(v_row.state, v_row.claimed_at);

  if v_effective = 'sending' then
    return 'in_flight';
  end if;

  if v_effective = 'unresolved' and not coalesce(p_force, false) then
    -- Record the reading, so the administrator sees `unresolved` rather than a
    -- claim that has silently been stale for days.
    update public.order_mail
       set state = 'unresolved'
     where order_id = v_order_id and kind = p_kind;
    return 'unresolved';
  end if;

  update public.order_mail
     set state      = 'sending',
         claimed_at = now(),
         attempts   = attempts + 1,
         last_error = null
   where order_id = v_order_id and kind = p_kind;

  return 'claimed';
end;
$$;

comment on function public.claim_order_mail(text, text, boolean) is
  'Claims the right to send one mail, or explains why not. The primary key insert is the lock. A sent mail is terminal and p_force does not override it; an unresolved one needs an administrator behind the force flag.';


-- ---------------------------------------------------------------------------
-- 6. The three ways a claim ends
-- ---------------------------------------------------------------------------
create or replace function public.mark_order_mail_sent(
  p_order_number text,
  p_kind         text,
  p_message_id   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.order_mail
     set state               = 'sent',
         sent_at             = now(),
         provider_message_id = nullif(btrim(coalesce(p_message_id, '')), ''),
         last_error          = null
   where order_id = (select o.id from public.orders o where o.order_number = p_order_number)
     and kind = p_kind
     and state <> 'sent';
end;
$$;

comment on function public.mark_order_mail_sent(text, text, text) is
  'The provider accepted the mail. Deliberately `state <> sent` rather than `state = sending`: a slow request whose claim went stale and was read as unresolved by somebody else must still be able to record that it succeeded. Overwriting `unresolved` with `sent` is the one direction that is always true.';

create or replace function public.mark_order_mail_failed(
  p_order_number text,
  p_kind         text,
  p_error        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.order_mail
     set state      = 'failed',
         last_error = left(nullif(btrim(coalesce(p_error, '')), ''), 200)
   where order_id = (select o.id from public.orders o where o.order_number = p_order_number)
     and kind = p_kind
     and state = 'sending';
end;
$$;

comment on function public.mark_order_mail_failed(text, text, text) is
  'The provider clearly refused: a validation error, a rate limit, a 5xx. Retryable, because nothing was accepted.';

create or replace function public.mark_order_mail_unresolved(
  p_order_number text,
  p_kind         text,
  p_error        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.order_mail
     set state      = 'unresolved',
         last_error = left(nullif(btrim(coalesce(p_error, '')), ''), 200)
   where order_id = (select o.id from public.orders o where o.order_number = p_order_number)
     and kind = p_kind
     and state = 'sending';
end;
$$;

comment on function public.mark_order_mail_unresolved(text, text, text) is
  'Nobody can say whether the mail went out: a 409 on the idempotency key, a network timeout, an aborted request. Deliberately not `failed` — a blind retry here is how a customer gets the same confirmation twice.';


-- ---------------------------------------------------------------------------
-- 7. order_mail_payload() — everything the mail needs, and nothing else
--
-- Compare with `admin_order()`: no events, no payment history, no tracking of
-- who did what. And compared with the order row itself, deliberately absent:
-- `id`, `user_id`, `request_id`, `client_hash`, `payment_token_hash`, every
-- provider identifier, and the SKY-IDs — none of which a customer's
-- confirmation needs, and the first four of which must never leave the
-- database at all.
-- ---------------------------------------------------------------------------
create or replace function public.order_mail_payload(p_order_number text)
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
  select o.* into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'order_number',    v_order.order_number,
    'placed_at',       v_order.placed_at,
    'customer_email',  v_order.customer_email,
    'currency',        v_order.currency,
    'items_subtotal',  v_order.items_subtotal,
    'shipping_amount', v_order.shipping_amount,
    'discount_amount', v_order.discount_amount,
    'total_amount',    v_order.total_amount,
    'shipping_method', v_order.shipping_method_name,
    'tracking_number', v_order.tracking_number,
    'shipped_at',      v_order.shipped_at,
    'payment_status',  v_order.payment_status,
    'needs_resolution', v_order.needs_resolution,
    'address', (
      select jsonb_build_object(
               'first_name', a.first_name, 'last_name', a.last_name,
               'company', a.company, 'street', a.street,
               'house_number', a.house_number, 'address_line_2', a.address_line_2,
               'postal_code', a.postal_code, 'city', a.city,
               'country_code', a.country_code)
        from public.order_addresses a
       where a.order_id = v_order.id
       limit 1
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'condition', l.condition,
               'name', l.name_snapshot,
               'quantity', l.quantity,
               'unit_price', l.unit_price,
               'line_total', l.line_total)
               order by l.id)
        from public.order_lines l
       where l.order_id = v_order.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.order_mail_payload(text) is
  'What a transactional mail may say about an order: number, amounts, shipping, delivery address and line items. Carries no internal id, no capability, no provider reference and no SKY-ID.';


-- ---------------------------------------------------------------------------
-- 7b. order_number_for_payment() — the webhook's one missing fact
--
-- `confirm_order_payment()` returns an outcome, not an order. The webhook
-- therefore knows that a payment was confirmed and not which order it belongs
-- to — and the mail needs to know.
--
-- Read-only, service-role only, one column out. Deliberately NOT folded into
-- `confirm_order_payment()`: that function decides whether money arrived, and
-- widening its return type to serve a mail would put a mail concern inside the
-- one transaction that must never grow.
-- ---------------------------------------------------------------------------
create or replace function public.order_number_for_payment(
  p_provider            text,
  p_provider_payment_id text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.order_number
    from public.payment_attempts a
    join public.orders o on o.id = a.order_id
   where a.provider = p_provider
     and a.provider_payment_id = p_provider_payment_id
   limit 1
$$;

comment on function public.order_number_for_payment(text, text) is
  'Which order a provider payment belongs to. Read-only, service role only. Exists so the webhook can name an order for its mail without confirm_order_payment() having to return one.';


-- ---------------------------------------------------------------------------
-- 7c. is_shop_admin_for() — the same question, asked about somebody else
--
-- `is_shop_admin()` reads `auth.uid()`, which is NULL inside an Edge Function
-- running with service credentials. The Edge Function verifies the browser's
-- JWT against Supabase Auth and hands over the id it proved; this answers for
-- that id and nothing else.
--
-- The same boundary `authorize_order_payment()` uses (ADR-0051): the id is an
-- argument because the caller has already established it, and the database
-- trusts that one hop and no claim beyond it.
--
-- Reads `shop_admins`, exactly as the original does. There is still only one
-- source of truth about who is an administrator, and it is still not an e-mail
-- address (ADR-0059).
-- ---------------------------------------------------------------------------
create or replace function public.is_shop_admin_for(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and exists (
       select 1 from public.shop_admins a where a.user_id = p_user_id
     )
$$;

comment on function public.is_shop_admin_for(uuid) is
  'Whether a given account is a shop administrator. For an Edge Function, which has no auth.uid() of its own and must name the id it verified. Service role only; is_shop_admin() remains the in-session question.';


-- ---------------------------------------------------------------------------
-- 8. The two readers, and the difference between them
--
-- `mail_contact_settings()` is for the Edge Function: service role only. The
-- From address is not here and never will be — it belongs to the verified
-- sending domain and is environment configuration, so an interface that could
-- change it would be an interface that can break deliverability.
--
-- `business_settings_public()` is the allow-list. It is the ONLY way a fact
-- from this table can reach a visitor, and it names its columns literally, so
-- a column added by the legal block is invisible here until somebody adds it
-- on purpose. A tax identifier cannot leak by being new.
--
-- IT IS GRANTED TO NOBODY YET, ON PURPose. Nothing public renders a business
-- fact today — the footer has no contact link and there is no Impressum. The
-- legal block turns it on with one `grant`, at the moment there is a page that
-- needs it. Defining it now fixes the shape; granting it now would publish a
-- personal address ahead of the page that is supposed to carry it.
-- ---------------------------------------------------------------------------
create or replace function public.mail_contact_settings()
returns table (
  contact_email          text,
  transactional_reply_to text
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.contact_email, b.transactional_reply_to
    from public.business_settings b
$$;

create or replace function public.business_settings_public()
returns table (
  contact_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- An allow-list, written out. Never `select b.*`, and never a column list
  -- built from the catalogue: both would publish whatever arrives next.
  select b.contact_email
    from public.business_settings b
$$;

comment on function public.business_settings_public() is
  'The only projection of business_settings a visitor may ever see. Columns are named literally so anything added later — a tax identifier above all — is absent until it is deliberately listed here. Granted to no role yet; the legal block grants it when a public page needs it.';


-- ---------------------------------------------------------------------------
-- 9. The administrator's touchpoints
--
-- One narrow writer per group of facts, rather than one function that sets
-- everything. The legal block adds `admin_set_business_identity(...)` beside
-- this one; a god-function would mean every caller passing every field and
-- every validation living in one branch.
--
-- `shop_settings` and `admin_shop_settings()` are deliberately untouched by
-- this migration: pricing is a different question from identity.
-- ---------------------------------------------------------------------------
create or replace function public.admin_business_settings()
returns table (
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
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select b.contact_email, b.transactional_reply_to, b.updated_at
      from public.business_settings b;
end;
$$;

create or replace function public.admin_set_business_contact(
  p_contact_email text,
  p_reply_to      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact  text := nullif(btrim(coalesce(p_contact_email, '')), '');
  v_reply_to text := nullif(btrim(coalesce(p_reply_to, '')), '');
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
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

  update public.business_settings
     set contact_email          = v_contact,
         transactional_reply_to = v_reply_to,
         updated_at             = now(),
         updated_by             = (select auth.uid())
   where id;
end;
$$;

comment on function public.admin_set_business_contact(text, text) is
  'Sets the published business contact address and an optional differing Reply-To (ADR-0059). Business configuration only: nothing in the system authorises anybody by e-mail address.';


-- ---------------------------------------------------------------------------
-- 10. admin_order() learns about mail
--
-- Same projection as 0018 with one field added. The state is the EFFECTIVE
-- one, so a claim that has been stale for three days reads as `unresolved` in
-- the interface exactly as it does to `claim_order_mail()`.
-- ---------------------------------------------------------------------------
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
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
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
      'tracking_number',    v_order.tracking_number,
      'is_guest',           v_order.user_id is null
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
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sky_id', l.sky_id, 'condition', l.condition,
               'name', l.name_snapshot, 'quantity', l.quantity,
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

comment on function public.admin_order(text) is
  'One order as a document for the administration area: order, address, lines, events and mail delivery state. Carries no abuse fingerprint, no capability hash, no internal id and no provider message content.';


-- ---------------------------------------------------------------------------
-- 11. Privileges
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so each REVOKE
-- below is load-bearing.
--
-- The delivery functions get NO grant at all: only the service role — that is,
-- only an Edge Function inside Supabase — may claim or settle a mail. The two
-- administrator functions are granted to `authenticated`, where
-- `is_shop_admin()` decides.
-- ---------------------------------------------------------------------------
revoke all on function public.order_mail_grace()                              from public, anon, authenticated;
revoke all on function public.order_mail_effective_state(text, timestamptz)   from public, anon, authenticated;
revoke all on function public.order_mail_protect()                            from public, anon, authenticated;
revoke all on function public.order_mail_no_delete()                          from public, anon, authenticated;
revoke all on function public.claim_order_mail(text, text, boolean)         from public, anon, authenticated;
revoke all on function public.mark_order_mail_sent(text, text, text)        from public, anon, authenticated;
revoke all on function public.mark_order_mail_failed(text, text, text)      from public, anon, authenticated;
revoke all on function public.mark_order_mail_unresolved(text, text, text)  from public, anon, authenticated;
revoke all on function public.order_mail_payload(text)                      from public, anon, authenticated;
revoke all on function public.mail_contact_settings()                         from public, anon, authenticated;
revoke all on function public.order_number_for_payment(text, text)            from public, anon, authenticated;
revoke all on function public.is_shop_admin_for(uuid)                         from public, anon, authenticated;

-- Defined, granted to nobody. The legal block replaces this line with a grant
-- to `anon, authenticated` when a public page actually renders a business
-- fact. Until then the projection exists so its shape can be reviewed and
-- tested, without publishing anything.
revoke all on function public.business_settings_public() from public, anon, authenticated;

revoke all on function public.admin_business_settings() from public, anon;
grant execute on function public.admin_business_settings() to authenticated;

revoke all on function public.admin_set_business_contact(text, text) from public, anon;
grant execute on function public.admin_set_business_contact(text, text) to authenticated;

revoke all on function public.admin_order(text) from public, anon;
grant execute on function public.admin_order(text) to authenticated;
