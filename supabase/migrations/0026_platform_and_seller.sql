-- ===========================================================================
-- 0026 — the platform and the seller are two subjects
--
-- WHY NOW
--
-- `business_settings` answers "who is SkyIsles" (0019, ADR-0059) and at the
-- same time supplies the Reply-To on *seller* mail. Under ADR-0064 those are
-- two legal subjects: SkyIsles is the platform, yulez.collectibles is the
-- first and for now only commercial seller on SkyIsles.
--
-- The data model already knows. `orders.tax_regime` has been freezing
-- `small_business_19` — § 19 UStG — onto every order since 0011. That is the
-- SELLER's tax status, written permanently onto the order, and it points at
-- nobody.
--
-- And ADR-0059 plans "Betreibername, ladungsfähige Anschrift, steuerliche
-- Angaben" into this table next. Not one of those is a platform fact: address
-- and tax details belong on the invoice and in the right-of-withdrawal
-- notice, both of which are the seller's documents. While the table holds two
-- columns and one nearly empty row, separating them is a migration. Once
-- Impressum, terms and withdrawal notice read from it, it is a change to
-- published legal texts.
--
-- WHAT THIS IS NOT
--
-- Not a marketplace, not a step towards one, not "just the data model"
-- (ADR-0021 stands). The running implementation stays single-seller: there is
-- no `seller_id` on any table, no second seller, no seller login, no seller
-- role, no RLS that knows a seller, no onboarding, no Stripe Connect, no
-- commission, no payout, no multi-seller fulfilment. Nothing in
-- `shop_inventory`, `cart_items`, `orders`, `order_lines`, `payment_attempts`
-- or any checkout function is touched — not one character.
--
-- A seller is a RECORD, never a permission. Authorisation stays exactly where
-- ADR-0032 and ADR-0059 put it: `shop_admins.user_id`, asked by
-- `is_shop_admin()`.
--
-- THE ONE SEAM
--
-- `active_seller()`. Every path that needs "the seller" goes through it, so
-- the later multi-seller question has exactly one place to be asked — and
-- until then "which seller?" appears nowhere in the system.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. sellers — who sells the goods
--
-- Deliberately three facts and no more. ADR-0059: "eine leere Spalte ist ein
-- Versprechen, das niemand geprüft hat." Legal name, address and tax details
-- arrive with the legal block, together with a surface that shows them and a
-- writer that sets them.
--
-- `display_name` is the exception, and a named one. It is a publicly used
-- trade name, not a secret and not a credential, and without it the record is
-- a nameless row — exactly the empty promise the rule exists to prevent.
-- ---------------------------------------------------------------------------
create table if not exists public.sellers (
  id bigint generated always as identity primary key,

  -- PUBLIC. What a customer is told they are buying from.
  display_name text,

  -- PUBLIC. The address a customer writes to about an order.
  contact_email text,

  -- INTERNAL. For the case where replies should go somewhere other than the
  -- published contact address. NULL means "use contact_email" — the same rule
  -- `send-order-mail` has always applied, now sourced from the seller.
  transactional_reply_to text,

  -- Not a feature flag and not a soft delete: it is what the constraint below
  -- counts. A seller that stops selling is deactivated, never removed —
  -- orders were placed with them.
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,

  constraint sellers_updated_by_fk foreign key (updated_by)
    references auth.users (id) on delete set null,

  -- Same looseness as business_settings, for the same reason: address syntax
  -- is not a useful gate, delivery is. This catches a fat finger.
  constraint sellers_contact_shape
    check (
      contact_email is null
      or (contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          and length(contact_email) <= 254)
    ),

  constraint sellers_reply_to_shape
    check (
      transactional_reply_to is null
      or (transactional_reply_to ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          and length(transactional_reply_to) <= 254)
    ),

  constraint sellers_display_name_shape
    check (display_name is null or length(btrim(display_name)) between 1 and 120)
);

comment on table public.sellers is
  'The seller''s own facts: who sells the goods, who the customer contracts with, who issues the invoice (ADR-0064). Separate from platform_settings, which says who SkyIsles is. AT MOST ONE ROW MAY BE ACTIVE — enforced by sellers_one_active. This is not a marketplace: no table carries a seller_id, no account is linked to a seller, and nothing here authorises anybody. That is shop_admins alone (ADR-0032).';

comment on column public.sellers.display_name is
  'PUBLIC. The seller''s trade name, as customers know it.';
comment on column public.sellers.contact_email is
  'PUBLIC. The address a customer writes to about an order, and the default Reply-To on order mail.';
comment on column public.sellers.transactional_reply_to is
  'INTERNAL. Overrides the Reply-To when replies should not go to the published contact address. The From address is environment configuration (MAIL_FROM) and is deliberately absent.';
comment on column public.sellers.is_active is
  'Exactly one seller is active while SkyIsles has one seller. Widening to several means DROPPING sellers_one_active — not changing a structure.';


-- ---------------------------------------------------------------------------
-- 2. The single-seller line, drawn by the database
--
-- A partial unique index on a constant: at most one row may have
-- `is_active = true`. It states in the schema what ADR-0064 states in prose,
-- and the step to several sellers is to DROP it.
-- ---------------------------------------------------------------------------
create unique index if not exists sellers_one_active
  on public.sellers ((true))
  where is_active;

comment on index public.sellers_one_active is
  'At most one active seller (ADR-0064). Dropping this index is the whole schema change a second seller would need — which is why it is an index and not a column default or a trigger.';


-- ---------------------------------------------------------------------------
-- 3. The seed: copied, never typed
--
-- The two addresses come from the row that already holds them. A literal here
-- would be the hardcoded business datum ADR-0059 and docs/SECURITY.md forbid.
-- `display_name` is the one named exception, argued above.
-- ---------------------------------------------------------------------------
insert into public.sellers (display_name, contact_email, transactional_reply_to)
select 'yulez.collectibles', b.contact_email, b.transactional_reply_to
  from public.business_settings b
 where not exists (select 1 from public.sellers);


-- ---------------------------------------------------------------------------
-- 4. The interlock before anything is dropped
--
-- Step 6 drops a column. If the copy above did not happen — an empty source
-- table, a re-run against a half-migrated database — the value would be gone
-- with nothing holding it. This refuses to continue instead.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sellers   bigint;
  v_src_reply text;
  v_dst_reply text;
  v_src_mail  text;
  v_dst_mail  text;
begin
  select count(*) into v_sellers from public.sellers;
  if v_sellers <> 1 then
    raise exception
      'expected exactly one seller after the seed, found % — refusing to drop anything', v_sellers;
  end if;

  select b.contact_email, b.transactional_reply_to into v_src_mail, v_src_reply
    from public.business_settings b;
  select s.contact_email, s.transactional_reply_to into v_dst_mail, v_dst_reply
    from public.sellers s where s.is_active;

  if v_dst_mail is distinct from v_src_mail then
    raise exception 'the contact address was not carried over';
  end if;
  if v_dst_reply is distinct from v_src_reply then
    raise exception 'the reply-to was not carried over';
  end if;

  raise notice 'seller seeded and both addresses verified — safe to continue';
end $$;


-- ---------------------------------------------------------------------------
-- 5. active_seller() — the one way to read a seller
--
-- Service role only. When a second seller exists, this function is replaced
-- by a real lookup and a `grep` for its name finds every caller. That is the
-- entire point of it existing at all.
-- ---------------------------------------------------------------------------
create or replace function public.active_seller()
returns public.sellers
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.sellers s where s.is_active limit 1
$$;

comment on function public.active_seller() is
  'The one active seller (ADR-0064). The single read path for seller facts: no other code selects from sellers directly, so a second seller has exactly one place to change. Service role only.';


-- ---------------------------------------------------------------------------
-- 6. business_settings becomes platform_settings
--
-- Both of its columns were seller facts, so leaving the name would mean a
-- table called "business" holding platform data while a table called
-- "sellers" holds the business. `contact_email` stays as the PLATFORM's own
-- address — privacy requests, account matters, complaints about the platform
-- — and today it may legitimately hold the same address, because one person
-- is both.
--
-- `transactional_reply_to` is a purely seller concern and goes. Its value was
-- copied in step 3 and verified in step 4.
-- ---------------------------------------------------------------------------
alter table public.business_settings rename to platform_settings;

alter table public.platform_settings rename constraint business_settings_singleton     to platform_settings_singleton;
alter table public.platform_settings rename constraint business_settings_updated_by_fk to platform_settings_updated_by_fk;
alter table public.platform_settings rename constraint business_settings_contact_shape to platform_settings_contact_shape;

alter table public.platform_settings drop constraint if exists business_settings_reply_to_shape;
alter table public.platform_settings drop column if exists transactional_reply_to;

comment on table public.platform_settings is
  'The PLATFORM''s own facts — who SkyIsles is as operator of the catalogue, the accounts and the checkout (ADR-0064). The seller''s facts live in sellers. Singleton. Not public: the only way out for a visitor is platform_settings_public(), which names its columns literally. Nothing here authorises anybody — that is shop_admins alone (ADR-0059).';

comment on column public.platform_settings.contact_email is
  'PUBLIC. The platform''s published contact address — privacy requests, account matters, anything about SkyIsles itself. Questions about an ORDER go to the seller (sellers.contact_email). Today both may be the same address; they are separate fields because they are separate duties.';


-- ---------------------------------------------------------------------------
-- 7. Row level security — unchanged in shape, extended to the new table
-- ---------------------------------------------------------------------------
alter table public.sellers enable row level security;

-- Closed to every client role: RLS on with no policy, and no grant. The same
-- shape platform_settings and the commerce tables have. A client reaches a
-- seller fact only through a function, never through the table.
revoke all on public.sellers from anon, authenticated;
revoke all on public.platform_settings from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 8. The readers
--
-- mail_contact_settings() KEEPS ITS NAME, ITS SIGNATURE AND ITS RETURN SHAPE.
-- Only its source changes. `send-order-mail` reads `contact_email` and
-- `transactional_reply_to` off this result and applies `reply_to ?? contact`;
-- all of that still holds, now answered by the seller. The deployed Edge
-- Function needs no redeploy, on staging or anywhere else.
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
  -- The SELLER's addresses: an order mail comes from the seller's side of the
  -- transaction, and a reply to it is a question about that order (ADR-0064).
  select s.contact_email, s.transactional_reply_to
    from public.active_seller() s
$$;

comment on function public.mail_contact_settings() is
  'The addresses order mail uses: the SELLER''s contact and optional differing Reply-To (ADR-0064). Signature and return shape are deliberately unchanged from 0019 so send-order-mail needs no redeploy. Service role only.';

-- The public allow-list, renamed with its table. Still granted to NOBODY:
-- no public page renders a company fact yet, and the legal block replaces a
-- revoke with a grant on the day one does (ADR-0059).
drop function if exists public.business_settings_public();

create or replace function public.platform_settings_public()
returns table (
  contact_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- An allow-list, written out. Never `select p.*`, and never a column list
  -- built from the catalogue: both would publish whatever arrives next.
  select p.contact_email
    from public.platform_settings p
$$;

comment on function public.platform_settings_public() is
  'The platform facts a visitor may see. An allow-list that names its columns literally, so a column the legal block adds is invisible until somebody lists it on purpose (ADR-0059). Granted to nobody yet.';


-- ---------------------------------------------------------------------------
-- 9. The admin readers and writers — one narrow writer per group of facts
--
-- ADR-0059: "Ein schmaler Schreiber je Faktengruppe, nicht eine Funktion für
-- alles." Two subjects, so two of each. Changing one cannot touch the other,
-- which is a property the interface can be tested against.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_business_settings();
drop function if exists public.admin_set_business_contact(text, text);

create or replace function public.admin_seller()
returns table (
  display_name           text,
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
    select s.display_name, s.contact_email, s.transactional_reply_to, s.updated_at
      from public.active_seller() s;
end;
$$;

comment on function public.admin_seller() is
  'The active seller, for the admin area (ADR-0064). Names its columns literally, like every projection in 0019.';

create or replace function public.admin_set_seller_contact(
  p_display_name  text,
  p_contact_email text,
  p_reply_to      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text := nullif(btrim(coalesce(p_display_name, '')), '');
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

  -- `where is_active` and not an id: the caller never names a seller, so the
  -- admin area cannot accidentally address a second one into existence.
  update public.sellers
     set display_name           = v_name,
         contact_email          = v_contact,
         transactional_reply_to = v_reply_to,
         updated_at             = now(),
         updated_by             = (select auth.uid())
   where is_active;
end;
$$;

comment on function public.admin_set_seller_contact(text, text, text) is
  'Sets the seller''s trade name, published contact address and optional differing Reply-To (ADR-0064). Addresses the ACTIVE seller and never takes an id, so no caller can create or address a second one. Business configuration only: nothing in the system authorises anybody by e-mail address (ADR-0059).';

create or replace function public.admin_platform_settings()
returns table (
  contact_email text,
  updated_at    timestamptz
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
    select p.contact_email, p.updated_at
      from public.platform_settings p;
end;
$$;

comment on function public.admin_platform_settings() is
  'The platform''s own facts, for the admin area (ADR-0064). Separate from admin_seller(): two subjects, two readers.';

create or replace function public.admin_set_platform_contact(
  p_contact_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact text := nullif(btrim(coalesce(p_contact_email, '')), '');
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if v_contact is not null and v_contact !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'that does not look like an e-mail address'
      using errcode = 'check_violation';
  end if;

  update public.platform_settings
     set contact_email = v_contact,
         updated_at    = now(),
         updated_by    = (select auth.uid())
   where id;
end;
$$;

comment on function public.admin_set_platform_contact(text) is
  'Sets the platform''s published contact address (ADR-0064). Touches no seller fact — the two are set independently and a test proves it.';


-- ---------------------------------------------------------------------------
-- 10. Grants — the same shape 0019 established
-- ---------------------------------------------------------------------------
revoke all on function public.active_seller()                          from public, anon, authenticated;
revoke all on function public.mail_contact_settings()                  from public, anon, authenticated;
revoke all on function public.platform_settings_public()               from public, anon, authenticated;

revoke all on function public.admin_seller()                           from public, anon;
grant  execute on function public.admin_seller()                       to authenticated;

revoke all on function public.admin_set_seller_contact(text, text, text) from public, anon;
grant  execute on function public.admin_set_seller_contact(text, text, text) to authenticated;

revoke all on function public.admin_platform_settings()                from public, anon;
grant  execute on function public.admin_platform_settings()            to authenticated;

revoke all on function public.admin_set_platform_contact(text)         from public, anon;
grant  execute on function public.admin_set_platform_contact(text)     to authenticated;
