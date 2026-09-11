-- ===========================================================================
-- 0017 — order_payment_state(): letting a customer see their own order
--
-- Phase B2.4. One STABLE, read-only function. No table, no trigger, no grant
-- on anything else, and nothing that writes.
--
-- WHY IT HAS TO EXIST
--
-- After paying, a customer comes back to /checkout/erfolg and the page must
-- say whether the money actually arrived — read from the database, never
-- inferred from the fact that Stripe redirected them. A signed-in visitor
-- could already read their own order through `orders_select_own`. A **guest
-- cannot**, and 0010 said so in as many words:
--
--   "A guest order has no auth.uid() and therefore cannot be expressed as a
--    policy at all — which is the correct outcome for now: it stays unreadable
--    by any client until the token function exists."
--
-- This is that function. Guests are most of the shop, so "signed-in visitors
-- get a confirmation and guests get a shrug" was not an option — and neither
-- were the alternatives: a service-role key in Vercel breaks ADR-0051, and a
-- third Edge Function would be more surface than an RPC for strictly less
-- (ADR-0054).
--
-- IT DUPLICATES NO AUTHORISATION
--
-- The rule for "may this caller act on this order" already exists as
-- `authorize_order_payment()` from 0013, and it is called here rather than
-- re-implemented. One hash comparison, in one place. A second copy would be a
-- second thing to get wrong the day that rule changes.
--
-- WHAT IT DELIBERATELY DOES NOT RETURN
--
-- No email, no address, no order lines, no client fingerprint, no
-- `payment_token_hash`, no `request_id`, no ids of any kind. And no boolean
-- like `is_paid`: it would be a second truth beside `payment_status`, and the
-- two would eventually disagree. The interface derives what it shows from
-- `payment_status` and `needs_resolution`, which are the canonical values.
--
-- No `currency` either. `src/lib/shop/public-surface.test.ts` forbids that
-- column on every publicly callable function — it is an inventory-cost field
-- there — and the interface does not need it: `format.ts` renders EUR, which
-- is the only currency V1 has. A column nobody reads is surface for nothing.
--
-- THE ANSWER DISTINGUISHES NOTHING
--
-- "No such order" and "not yours" both return zero rows, and that is the whole
-- claim: **the response carries no information either way**. Order numbers are
-- a readable counter and anybody may try them; what this function guarantees
-- is that trying them teaches nothing, not that trying is prevented.
--
-- Said precisely, because the weaker version is easy to write and wrong: this
-- removes enumeration *through the answer*. Rate limiting, timing differences
-- and anything else an attacker might measure are separate concerns and are
-- not addressed here.
-- ===========================================================================

create or replace function public.order_payment_state(
  p_order_number text,
  p_token        text default null
)
returns table (
  order_number     text,
  payment_status   text,
  needs_resolution boolean,
  total_amount     numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.order_number,
    o.payment_status,
    o.needs_resolution,
    o.total_amount
  from public.orders o
  where o.order_number = p_order_number
    -- 0013's rule, called and not copied: the signed-in owner, or the holder
    -- of the capability issued when the order was placed.
    and public.authorize_order_payment(o.id, (select auth.uid()), p_token);
$$;

comment on function public.order_payment_state(text, text) is
  'The payment state of one order, for the account that owns it or the holder of its capability. Read-only and deliberately minimal: no email, no address, no lines, no ids, no token hash. An unknown order and an unauthorised one return the identical empty result, so the answer itself distinguishes nothing.';


-- ---------------------------------------------------------------------------
-- Privileges — the browser needs this one, and only this one
--
-- `REVOKE … FROM PUBLIC` alone is not enough in Supabase: default privileges
-- grant EXECUTE on every new function in `public` to `anon` and
-- `authenticated` explicitly, so the implicit PUBLIC grant is not the only
-- one. Both are withdrawn first and then granted deliberately — the same
-- correction 0011 documented and 0012 adopted.
--
-- This is the FIRST function in the payment family a client may call. That is
-- safe because it is `stable`, returns four non-sensitive columns and answers
-- nothing at all without either a session that owns the order or a 256-bit
-- capability. Everything that writes stays revoked.
-- ---------------------------------------------------------------------------
revoke all on function public.order_payment_state(text, text)
  from public, anon, authenticated;

grant execute on function public.order_payment_state(text, text)
  to anon, authenticated;
