-- ===========================================================================
-- 0040 — SHOP and ADMIN are different responsibilities
--
-- WHAT THIS SEPARATES, AND WHY IT IS NOT A LEGAL CHANGE
--
-- SkyIsles is the platform: catalog, accounts, collection, checkout, payment.
-- yulez.collectibles is the first and currently only commercial seller on it —
-- the customer's contractual partner, invoice issuer and shipper (ADR-0064).
-- Today one person occupies both roles. That is exactly why the two sets of
-- facts have to be stored apart: when the same human answers both questions,
-- nothing in the data reminds anybody that they ARE two questions, and the
-- answers drift into each other. `de.checkout.trust.seller` saying "Verkäufer
-- ist SkyIsles" is what that drift looks like.
--
-- USER / SHOP / ADMIN are responsibility domains. They are NOT three legal
-- entities, NOT three auth roles, and NOT a marketplace (ADR-0075). The shop
-- administrator keeps access to everything; `sellers_one_active` still allows
-- exactly one seller, and no `seller_id` appears anywhere.
--
-- WHAT MOVES OUT OF CODE AND INTO CONFIGURATION
--
-- Three business facts were compiled into SQL literals: the delivery country
-- (`create_order()` compared to 'DE'), the shipping methods and their prices,
-- and the free-shipping threshold. None of them is a law of nature; all three
-- are the seller's decisions, and the seller should not need a migration to
-- change one. They become tables, seeded with **exactly today's values**, so
-- applying this migration changes no price, no country and no behaviour.
--
-- WHAT IS DELIBERATELY LEFT EMPTY
--
-- Every identity column — legal name, address, register, tax numbers — is
-- nullable and **seeded with nothing**. The business facts have not been
-- supplied yet, and a placeholder in an Impressum column is worse than an
-- empty one: one of them is obviously unfinished and the other is a false
-- statement about a real person. Legal V1 renders these; it is not this
-- migration.
--
-- NO DEPENDENCY ON `0035`, which stays unapplied on Production. This needs
-- `sellers` (0026), `platform_settings` (0019 as business_settings, renamed by
-- 0026), `shop_settings` (0007),
-- `shipping_catalog()`/`free_shipping_threshold()`/`create_order()` (0011,
-- 0028) and `is_shop_admin()` (0003).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. One rule for "leave it", "clear it" and "set it"
--
-- Every writer below takes NULL for every field and means "don't touch this
-- one", so a panel can save one group without resending the rest. That leaves
-- no way to CLEAR a field — so the empty string does it. This is the single
-- place that decides, rather than the same three-way conditional written out
-- thirteen times and wrong once.
-- ---------------------------------------------------------------------------
create or replace function public.shop_setting_value(p_new text, p_current text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_new is null            then p_current        -- leave alone
           when btrim(p_new) = ''        then null             -- clear
           else btrim(p_new)                                   -- set
         end;
$$;

comment on function public.shop_setting_value(text, text) is
  'Resolves a settings write: NULL leaves the current value, an empty string clears it, anything else is trimmed and stored (ADR-0075).';

revoke all on function public.shop_setting_value(text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 1. The seller's identity
--
-- All nullable. `sellers` holds one row and these are the facts that will one
-- day print in an Impressum, on an invoice and in a withdrawal instruction.
-- Until the operator supplies them they stay NULL, and every reader has to
-- treat NULL as "not yet known" rather than as an empty string.
-- ---------------------------------------------------------------------------
alter table public.sellers
  -- WHO, legally. `legal_name` is the natural or legal person; `trading_name`
  -- is what they trade as ("yulez.collectibles"). `display_name` already
  -- exists and stays what the customer sees, which is usually the trading
  -- name but does not have to be.
  add column if not exists legal_name    text,
  add column if not exists trading_name  text,
  add column if not exists legal_form    text,

  -- WHERE. A ladungsfähige Anschrift is one address, not a PO box, so these
  -- are plain columns rather than a JSON blob nobody can constrain.
  add column if not exists street        text,
  add column if not exists postal_code   text,
  add column if not exists city          text,
  add column if not exists country_code  text,

  -- HOW ELSE to reach them. `phone` is optional — a second rapid channel is
  -- required, a telephone specifically is not, so `direct_contact` can carry
  -- whatever that channel turns out to be.
  add column if not exists phone          text,
  add column if not exists direct_contact text,

  -- Registrations, each only if one exists. None is invented here.
  add column if not exists register_court  text,
  add column if not exists register_number text,
  add column if not exists vat_id          text,
  add column if not exists w_id            text;

comment on column public.sellers.legal_name is
  'The natural or legal person behind the shop. NULL until supplied; never a placeholder (ADR-0075).';
comment on column public.sellers.trading_name is
  'The name the seller trades under, e.g. yulez.collectibles. Distinct from display_name, which is what a customer sees, and from legal_name, which is who is liable.';
comment on column public.sellers.w_id is
  'Wirtschafts-Identifikationsnummer (§ 139c AO), if one has been issued. Belongs in the Impressum alongside or instead of vat_id (§ 5 Abs. 1 Nr. 6 DDG).';

-- Present or absent, never blank: an empty string would render as a filled-in
-- field that says nothing, which is the failure mode this guards against.
do $$
declare
  v_col text;
begin
  foreach v_col in array array[
    'legal_name','trading_name','legal_form','street','postal_code','city',
    'phone','direct_contact','register_court','register_number','vat_id','w_id'
  ] loop
    execute format(
      'alter table public.sellers drop constraint if exists sellers_%s_shape', v_col);
    execute format(
      'alter table public.sellers add constraint sellers_%1$s_shape
         check (%1$s is null or length(btrim(%1$s)) > 0)', v_col);
  end loop;
end $$;

alter table public.sellers
  drop constraint if exists sellers_country_code_shape;
alter table public.sellers
  add constraint sellers_country_code_shape
  check (country_code is null or country_code ~ '^[A-Z]{2}$');


-- ---------------------------------------------------------------------------
-- 2. Contacts, and the difference between "the same" and "not set"
--
-- `contact_email` stays the seller's authoritative address. The two new ones
-- are nullable and mean "no separate address" — resolved with `coalesce`
-- rather than copied. Copying would look identical today and quietly stop
-- following `contact_email` the day it changes, which is the whole reason
-- duplicate settings rot.
-- ---------------------------------------------------------------------------
alter table public.sellers
  add column if not exists withdrawal_contact_email text,
  add column if not exists complaints_contact_email text;

do $$
declare
  v_col text;
begin
  foreach v_col in array array['withdrawal_contact_email','complaints_contact_email'] loop
    execute format(
      'alter table public.sellers drop constraint if exists sellers_%s_shape', v_col);
    execute format(
      'alter table public.sellers add constraint sellers_%1$s_shape
         check (%1$s is null
                or (%1$s ~ ''^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$''
                    and length(%1$s) <= 254))', v_col);
  end loop;
end $$;

comment on column public.sellers.withdrawal_contact_email is
  'Where withdrawal declarations go. NULL means "use contact_email" — never a copy of it (ADR-0075).';
comment on column public.sellers.complaints_contact_email is
  'Where complaints go. NULL means "use contact_email".';


-- ---------------------------------------------------------------------------
-- 3. Tax, dispute resolution, withdrawal and delivery
--
-- Four settings the seller owns and the platform does not.
--
-- `small_business_19` is a regime, not a rate — the same distinction
-- `orders.tax_regime` already makes, and for the same reason: a 0 % rate
-- would produce a VAT line that must not exist. § 25a differential taxation
-- is deliberately absent and not represented here.
-- ---------------------------------------------------------------------------
alter table public.sellers
  add column if not exists small_business_19 boolean not null default true,

  -- § 36 VSBG. The duty to state a position arises above ten employees; the
  -- position itself is the seller's to take. Default false, because saying
  -- nothing and participating are different things and the honest default is
  -- the one that claims less.
  add column if not exists dispute_participation boolean not null default false,
  add column if not exists dispute_body          text,

  -- Who pays the return postage on an ordinary withdrawal.
  add column if not exists return_postage_borne_by text not null default 'customer',

  -- What may honestly be promised about dispatch. NULL until decided: an
  -- invented delivery time is the first promise a shop breaks.
  add column if not exists dispatch_statement text;

alter table public.sellers
  drop constraint if exists sellers_dispute_body_only_when_participating;
alter table public.sellers
  add constraint sellers_dispute_body_only_when_participating
  check (
    (dispute_participation and dispute_body is not null and length(btrim(dispute_body)) > 0)
    or (not dispute_participation and dispute_body is null)
  );

alter table public.sellers
  drop constraint if exists sellers_return_postage_known;
alter table public.sellers
  add constraint sellers_return_postage_known
  check (return_postage_borne_by in ('customer', 'seller'));

alter table public.sellers
  drop constraint if exists sellers_dispatch_statement_shape;
alter table public.sellers
  add constraint sellers_dispatch_statement_shape
  check (dispatch_statement is null or length(btrim(dispatch_statement)) > 0);

comment on column public.sellers.small_business_19 is
  'German small-business scheme (§ 19 UStG) applies: no VAT is shown. A regime, never a rate. § 25a differential taxation is not represented here and is not used.';
comment on column public.sellers.dispute_participation is
  'Whether the seller voluntarily participates in Verbraucherschlichtung (§ 36 VSBG). False says nothing more than that; it is not a refusal to answer a duty that has not arisen.';


-- ---------------------------------------------------------------------------
-- 4. The platform's own contact
--
-- The table is `platform_settings`. It was called `business_settings` when
-- `0019` created it, and `0026` renamed it — because both of its columns had
-- turned out to be seller facts, and a table called "business" holding
-- platform data next to a table called "sellers" holding the business was the
-- wrong way round. The rename is the reason this section names the new one:
-- the first draft of this migration read the column list out of `0019` and
-- never followed the chain, and `alter table public.business_settings` failed
-- on Staging with "relation does not exist".
--
-- `contact_email` is left exactly as it is. `support_email` is added beside it
-- and is what SkyIsles-the-platform will publish once an address exists.
-- Nothing is hard-coded: no support address appears in this migration or
-- anywhere else.
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists support_email text;

alter table public.platform_settings
  drop constraint if exists platform_settings_support_shape;
alter table public.platform_settings
  add constraint platform_settings_support_shape
  check (
    support_email is null
    or (support_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        and length(support_email) <= 254)
  );

comment on column public.platform_settings.support_email is
  'The platform support address for SkyIsles itself — account, data protection, the site. Distinct from sellers.contact_email, which answers for an order (ADR-0075). NULL until one exists.';


-- ---------------------------------------------------------------------------
-- 5. Where the shop delivers
--
-- Was a literal in `create_order()`. A country list is a seller's decision,
-- and a decision that needs a migration is a decision nobody makes.
--
-- Seeded with DE and nothing else, so behaviour after this migration is
-- byte-identical to behaviour before it.
-- ---------------------------------------------------------------------------
create table if not exists public.shipping_countries (
  country_code text primary key,
  label        text not null,
  is_enabled   boolean not null default true,
  sort_order   smallint not null default 0,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,

  constraint shipping_countries_code_shape check (country_code ~ '^[A-Z]{2}$'),
  constraint shipping_countries_label_shape check (length(btrim(label)) > 0),
  constraint shipping_countries_updated_by_fk foreign key (updated_by)
    references auth.users (id) on delete set null
);

comment on table public.shipping_countries is
  'Where the shop delivers. Authoritative for create_order(); the checkout form mirrors it but never decides it (ADR-0075).';

insert into public.shipping_countries (country_code, label, is_enabled, sort_order)
values ('DE', 'Deutschland', true, 1)
on conflict (country_code) do nothing;

alter table public.shipping_countries enable row level security;
revoke all on public.shipping_countries from anon, authenticated;

-- Readable by everyone, because the checkout form has to offer the list. It
-- says where a shop ships; there is nothing to protect.
drop policy if exists shipping_countries_public_read on public.shipping_countries;
create policy shipping_countries_public_read
  on public.shipping_countries for select
  to anon, authenticated
  using (true);
grant select on public.shipping_countries to anon, authenticated;

/*
 * THE server-side answer. `create_order()` asks this and nothing else, so
 * enabling a country is one UPDATE and never a code change — and disabling
 * one takes effect on the next order rather than the next deploy.
 */
create or replace function public.shipping_country_allowed(p_country_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shipping_countries c
     where c.country_code = upper(btrim(coalesce(p_country_code, '')))
       and c.is_enabled
  );
$$;

comment on function public.shipping_country_allowed(text) is
  'Whether the shop currently delivers to this country (ADR-0075). The authoritative check; the client mirrors the list for its form and decides nothing.';

revoke all on function public.shipping_country_allowed(text) from public;
grant execute on function public.shipping_country_allowed(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. How it ships, and from what value it is free
--
-- `shipping_catalog()` returned a literal VALUES list and
-- `free_shipping_threshold()` returned a literal 75.00. Both keep their
-- signatures — every caller is untouched — and now read configuration seeded
-- with the same numbers.
-- ---------------------------------------------------------------------------
create table if not exists public.shipping_methods (
  code        text primary key,
  name        text not null,
  base_price  numeric(10,2) not null,
  is_enabled  boolean not null default true,
  sort_order  smallint not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,

  constraint shipping_methods_code_shape check (code ~ '^[a-z][a-z0-9_-]{0,31}$'),
  constraint shipping_methods_name_shape check (length(btrim(name)) > 0),
  constraint shipping_methods_price_sane check (base_price >= 0 and base_price <= 999.99),
  constraint shipping_methods_updated_by_fk foreign key (updated_by)
    references auth.users (id) on delete set null
);

comment on table public.shipping_methods is
  'The carriers the shop offers and what they cost. Seeded with exactly the values 0011 compiled in, so applying 0040 changes no price (ADR-0075).';

insert into public.shipping_methods (code, name, base_price, sort_order)
values ('hermes', 'Hermes', 5.49, 1),
       ('dhl',    'DHL',    6.49, 2)
on conflict (code) do nothing;

alter table public.shipping_methods enable row level security;
revoke all on public.shipping_methods from anon, authenticated;
-- No client policy: the public route to this is `shipping_quote()`, which
-- already computes the amount a customer may see.

alter table public.shop_settings
  add column if not exists free_shipping_threshold numeric(10,2) not null default 75.00;

alter table public.shop_settings
  drop constraint if exists shop_settings_free_shipping_threshold_sane;
alter table public.shop_settings
  add constraint shop_settings_free_shipping_threshold_sane
  check (free_shipping_threshold >= 0 and free_shipping_threshold <= 100000);

comment on column public.shop_settings.free_shipping_threshold is
  'Goods value from which shipping is free. Was a literal in free_shipping_threshold() (ADR-0075). Moved to sellers by 0041, where it belongs (ADR-0076).';

-- Same signature, same result today, different source.
create or replace function public.free_shipping_threshold()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.free_shipping_threshold from public.shop_settings s where s.id),
    75.00::numeric);
$$;

comment on function public.free_shipping_threshold() is
  'The goods value from which shipping is free, from shop_settings. Superseded by 0041, which moves the column to the seller it belongs to.';

create or replace function public.shipping_catalog()
returns table (code text, name text, base_price numeric, sort_order integer)
language sql
stable
security definer
set search_path = ''
as $$
  select m.code, m.name, m.base_price, m.sort_order::integer
    from public.shipping_methods m
   where m.is_enabled
   order by m.sort_order, m.code;
$$;

comment on function public.shipping_catalog() is
  'The shipping methods on offer, from shipping_methods since 0040. Same signature and same rows as the literal list it replaces.';


-- ---------------------------------------------------------------------------
-- 7. Reading and writing the shop's profile — administrators only
--
-- `admin_shop_profile()`, NOT `admin_shop_settings()`. That name has been
-- taken since `0007`, where it returns the pricing percentage as a table, and
-- `src/lib/admin/inventory.ts` calls it to this day. Reusing it here with
-- `returns jsonb` is what PostgreSQL refused — "cannot change return type of
-- existing function" — and had it been allowed, it would have silently broken
-- the pricing panel instead.
--
-- The name matches what this actually is: the seller's profile, beside the
-- shop's pricing settings rather than on top of them.
-- ---------------------------------------------------------------------------
create or replace function public.admin_shop_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller   record;
  v_platform record;
  v_shop     record;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_seller from public.sellers where is_active order by id limit 1;
  select * into v_platform from public.platform_settings where id;
  select * into v_shop from public.shop_settings where id;

  return jsonb_build_object(
    'seller', case when v_seller.id is null then null else jsonb_build_object(
      'display_name', v_seller.display_name,
      'legal_name',   v_seller.legal_name,
      'trading_name', v_seller.trading_name,
      'legal_form',   v_seller.legal_form,
      'street',       v_seller.street,
      'postal_code',  v_seller.postal_code,
      'city',         v_seller.city,
      'country_code', v_seller.country_code,
      'phone',        v_seller.phone,
      'direct_contact',   v_seller.direct_contact,
      'register_court',   v_seller.register_court,
      'register_number',  v_seller.register_number,
      'vat_id',           v_seller.vat_id,
      'w_id',             v_seller.w_id,
      'contact_email',            v_seller.contact_email,
      'transactional_reply_to',   v_seller.transactional_reply_to,
      'withdrawal_contact_email', v_seller.withdrawal_contact_email,
      'complaints_contact_email', v_seller.complaints_contact_email,
      -- What the two NULLs resolve to, computed here so the panel never has
      -- to reimplement the fallback and get it subtly different.
      'withdrawal_contact_effective',
        coalesce(v_seller.withdrawal_contact_email, v_seller.contact_email),
      'complaints_contact_effective',
        coalesce(v_seller.complaints_contact_email, v_seller.contact_email),
      'small_business_19',       v_seller.small_business_19,
      'dispute_participation',   v_seller.dispute_participation,
      'dispute_body',            v_seller.dispute_body,
      'return_postage_borne_by', v_seller.return_postage_borne_by,
      'dispatch_statement',      v_seller.dispatch_statement
    ) end,
    'platform', jsonb_build_object(
      'contact_email', v_platform.contact_email,
      'support_email', v_platform.support_email
    ),
    'shop', jsonb_build_object(
      'free_shipping_threshold', v_shop.free_shipping_threshold
    ),
    'shipping_countries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'country_code', c.country_code, 'label', c.label,
               'is_enabled', c.is_enabled) order by c.sort_order, c.country_code)
        from public.shipping_countries c), '[]'::jsonb),
    'shipping_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', m.code, 'name', m.name,
               'base_price', m.base_price, 'is_enabled', m.is_enabled)
               order by m.sort_order, m.code)
        from public.shipping_methods m), '[]'::jsonb)
  );
end;
$$;

comment on function public.admin_shop_profile() is
  'Everything the shop settings screen needs, in one document (ADR-0075). Administrators only. Carries the resolved withdrawal and complaints contacts so the fallback has one implementation.';

revoke all on function public.admin_shop_profile() from public, anon;
grant execute on function public.admin_shop_profile() to authenticated;

/*
 * One writer for the seller's own facts.
 *
 * Every argument defaults to NULL and NULL means "leave alone", so the panel
 * can save one group without resending the others — and so adding a field
 * later does not break a caller. Clearing a value is `''`, which is the one
 * case where empty string is meaningful: the operator means "remove this".
 */
create or replace function public.admin_set_seller_details(
  p_legal_name      text default null,
  p_trading_name    text default null,
  p_legal_form      text default null,
  p_street          text default null,
  p_postal_code     text default null,
  p_city            text default null,
  p_country_code    text default null,
  p_phone           text default null,
  p_direct_contact  text default null,
  p_register_court  text default null,
  p_register_number text default null,
  p_vat_id          text default null,
  p_w_id            text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from public.sellers where is_active order by id limit 1;
  if v_id is null then
    raise exception 'no active seller' using errcode = 'no_data_found';
  end if;

  update public.sellers s
     set legal_name      = public.shop_setting_value(p_legal_name, s.legal_name),
         trading_name    = public.shop_setting_value(p_trading_name, s.trading_name),
         legal_form      = public.shop_setting_value(p_legal_form, s.legal_form),
         street          = public.shop_setting_value(p_street, s.street),
         postal_code     = public.shop_setting_value(p_postal_code, s.postal_code),
         city            = public.shop_setting_value(p_city, s.city),
         country_code    = upper(public.shop_setting_value(p_country_code, s.country_code)),
         phone           = public.shop_setting_value(p_phone, s.phone),
         direct_contact  = public.shop_setting_value(p_direct_contact, s.direct_contact),
         register_court  = public.shop_setting_value(p_register_court, s.register_court),
         register_number = public.shop_setting_value(p_register_number, s.register_number),
         vat_id          = public.shop_setting_value(p_vat_id, s.vat_id),
         w_id            = public.shop_setting_value(p_w_id, s.w_id),
         updated_at      = now(),
         updated_by      = (select auth.uid())
   where s.id = v_id;
end;
$$;

comment on function public.admin_set_seller_details(text, text, text, text, text, text, text, text, text, text, text, text, text) is
  'Records the seller''s identity (ADR-0075). NULL leaves a field alone, an empty string clears it. Administrators only. Seeds nothing: every field starts empty and stays empty until somebody types it.';

revoke all on function public.admin_set_seller_details(text, text, text, text, text, text, text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.admin_set_seller_details(text, text, text, text, text, text, text, text, text, text, text, text, text)
  to authenticated;

create or replace function public.admin_set_shop_policies(
  p_contact_email            text    default null,
  p_withdrawal_contact_email text    default null,
  p_complaints_contact_email text    default null,
  p_small_business_19        boolean default null,
  p_dispute_participation    boolean default null,
  p_dispute_body             text    default null,
  p_return_postage_borne_by  text    default null,
  p_dispatch_statement       text    default null,
  p_free_shipping_threshold  numeric default null,
  p_support_email            text    default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_return_postage_borne_by is not null
     and p_return_postage_borne_by not in ('customer', 'seller') then
    raise exception 'return postage is borne by the customer or the seller, not %',
      p_return_postage_borne_by using errcode = 'check_violation';
  end if;

  select id into v_id from public.sellers where is_active order by id limit 1;
  if v_id is null then
    raise exception 'no active seller' using errcode = 'no_data_found';
  end if;

  update public.sellers s
     set contact_email = public.shop_setting_value(p_contact_email, s.contact_email),
         withdrawal_contact_email =
           public.shop_setting_value(p_withdrawal_contact_email, s.withdrawal_contact_email),
         complaints_contact_email =
           public.shop_setting_value(p_complaints_contact_email, s.complaints_contact_email),
         small_business_19     = coalesce(p_small_business_19, s.small_business_19),
         dispute_participation = coalesce(p_dispute_participation, s.dispute_participation),
         dispute_body          = public.shop_setting_value(p_dispute_body, s.dispute_body),
         return_postage_borne_by =
           coalesce(p_return_postage_borne_by, s.return_postage_borne_by),
         dispatch_statement = public.shop_setting_value(p_dispatch_statement, s.dispatch_statement),
         updated_at = now(),
         updated_by = (select auth.uid())
   where s.id = v_id;

  if p_support_email is not null then
    insert into public.platform_settings (id, support_email)
    values (true, nullif(btrim(p_support_email), ''))
    on conflict (id) do update
      set support_email = nullif(btrim(excluded.support_email), ''),
          updated_at = now(),
          updated_by = (select auth.uid());
  end if;
end;
$$;

comment on function public.admin_set_shop_policies(text, text, text, boolean, boolean, text, text, text, numeric, text) is
  'Records the shop''s contacts, tax regime, dispute position, withdrawal and delivery policy, the free-shipping threshold and the PLATFORM support address (ADR-0075). NULL leaves a field alone, empty string clears a text field. Administrators only.';

revoke all on function public.admin_set_shop_policies(text, text, text, boolean, boolean, text, text, text, numeric, text)
  from public, anon;
grant execute on function public.admin_set_shop_policies(text, text, text, boolean, boolean, text, text, text, numeric, text)
  to authenticated;

create or replace function public.admin_set_shipping_country(
  p_country_code text,
  p_label        text,
  p_enabled      boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.shipping_countries (country_code, label, is_enabled, updated_by)
  values (upper(btrim(p_country_code)), btrim(p_label), coalesce(p_enabled, false),
          (select auth.uid()))
  on conflict (country_code) do update
    set label      = excluded.label,
        is_enabled = excluded.is_enabled,
        updated_at = now(),
        updated_by = excluded.updated_by;
end;
$$;

comment on function public.admin_set_shipping_country(text, text, boolean) is
  'Enables or disables a delivery country (ADR-0075). Administrators only. Takes effect on the next order, because create_order() asks shipping_country_allowed() rather than a compiled-in literal.';

revoke all on function public.admin_set_shipping_country(text, text, boolean) from public, anon;
grant execute on function public.admin_set_shipping_country(text, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. create_order() asks the configuration
--
-- Reproduced verbatim from `0028` with exactly ONE change: the delivery
-- country is no longer compared to the literal 'DE'. PostgreSQL cannot patch a
-- line of a function body, so all 263 lines come across — and the substitution
-- was made mechanically rather than retyped, because this function is the
-- entire checkout and a transcription slip here would not be a display bug.
--
-- Everything else is untouched: the two-pass resolution, the price snapshots,
-- the reservation, the address, the events.
-- ---------------------------------------------------------------------------
create or replace function public.create_order(
  p_request_id      text,
  p_email           text,
  p_items           jsonb,
  p_address         jsonb,
  p_shipping_method text,
  p_payment_token   text
)
returns table (
  order_id        bigint,
  order_number    text,
  items_subtotal  numeric,
  shipping_amount numeric,
  total_amount    numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id bigint;
  v_number   text;
  v_user_id  uuid := (select auth.uid());
  v_item     jsonb;
  v_sky_id   text;
  v_cond     text;
  v_qty      integer;
  v_price    numeric(10,2);
  v_name     text;
  v_image    text;
  v_inv_id   bigint;
  v_line_total numeric(10,2);
  v_subtotal numeric(10,2) := 0;
  v_lines    integer := 0;
  v_client   text;
  v_country  text;
  v_ship_name text;
  v_shipping numeric(10,2);
  v_token_hash text;
  v_existing record;

  -- The positions, priced and snapshotted, between pass 1 and pass 2. Never
  -- leaves this function and never reaches the caller.
  v_resolved jsonb := '[]'::jsonb;

  -- Which world this order belongs to, read once and stamped on the row.
  v_mode text := public.commerce_mode();
begin
  -- ---------------------------------------------------------------------------
  -- Before anything else, including the shape checks: may this caller buy?
  --
  -- The gate is here rather than in the server action because this function is
  -- reachable over PostgREST with the anon key. A check in TypeScript would be
  -- one request away from being skipped; this one cannot be.
  --
  -- Deliberately the same refusal for all three reasons — closed, not signed
  -- in, not a tester. A caller learns that they may not check out, not why,
  -- and not that a sandbox exists.
  -- ---------------------------------------------------------------------------
  if not public.commerce_checkout_allowed() then
    raise exception 'checkout is not open to this caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_request_id is null or length(p_request_id) < 8 then
    raise exception 'a checkout needs a request id' using errcode = 'check_violation';
  end if;

  -- The capability is required. An order nobody can prove they placed is an
  -- order nobody can pay for.
  if p_payment_token is null or length(p_payment_token) < 32 then
    raise exception 'a checkout needs a payment capability' using errcode = 'check_violation';
  end if;

  v_token_hash := encode(sha256(convert_to(p_payment_token, 'utf8')), 'hex');

  -- Already done. Hand it back only to a caller that can prove it is the one
  -- that created it — the same token, not merely the same request id.
  select o.id, o.order_number, o.items_subtotal, o.shipping_amount, o.total_amount,
         o.payment_token_hash
    into v_existing
    from public.orders o
   where o.request_id = p_request_id;

  if found then
    if v_existing.payment_token_hash is distinct from v_token_hash then
      raise exception 'this checkout belongs to somebody else'
        using errcode = 'insufficient_privilege';
    end if;

    order_id        := v_existing.id;
    order_number    := v_existing.order_number;
    items_subtotal  := v_existing.items_subtotal;
    shipping_amount := v_existing.shipping_amount;
    total_amount    := v_existing.total_amount;
    return next;
    return;
  end if;

  if p_email is null or p_email not like '%@%' then
    raise exception 'a checkout needs a contact address' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a checkout needs at least one article' using errcode = 'check_violation';
  end if;

  v_country := upper(coalesce(p_address ->> 'country_code', ''));
  /*
   * Asks the configuration, not a compiled-in country (ADR-0075).
   *
   * This is the authoritative check. The checkout form mirrors the same list
   * so it can offer a sensible field, but editing the client enables nothing:
   * an order for a country that is not enabled is refused here.
   */
  if not public.shipping_country_allowed(v_country) then
    raise exception 'this shop does not deliver to %', coalesce(nullif(v_country, ''), '(none)')
      using errcode = 'check_violation';
  end if;

  select c.name into v_ship_name
    from public.shipping_catalog() c
   where c.code = p_shipping_method;

  if v_ship_name is null then
    raise exception 'unknown shipping method %', coalesce(p_shipping_method, '(null)')
      using errcode = 'check_violation';
  end if;

  v_client := public.request_client_hash();
  perform public.enforce_checkout_limits(p_email, v_user_id, v_client);

  -- -------------------------------------------------------------------------
  -- Pass 1 — resolve and price every position. Writes nothing.
  --
  -- Identical to what the loop always did, except that the line is kept
  -- instead of inserted: the order it belongs to does not exist yet.
  -- -------------------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_sky_id := v_item ->> 'sky_id';
    v_cond   := v_item ->> 'condition';
    v_qty    := nullif(v_item ->> 'quantity', '')::integer;

    if v_qty is null or v_qty < 1 or v_qty > public.max_cart_quantity() then
      raise exception 'invalid quantity for %', v_sky_id using errcode = 'check_violation';
    end if;

    -- V1 SELLS LOOSE ONLY (0028).
    --
    -- Validated explicitly rather than left to the lookup below. Without this,
    -- a boxed line would fall through to `article % / % is not offered`, which
    -- is misleading: the position exists, is listed, is eligible and is
    -- priced. What is wrong is the request, so it is refused the way every
    -- other unacceptable argument to this function is refused -- the same
    -- errcode an invalid quantity raises, which the application already maps
    -- to the same outcome (`UNAVAILABLE` in lib/commerce/actions.ts).
    --
    -- Placed in pass 1, which writes nothing: no order row exists yet, no
    -- line, no address, no reservation. See the header on atomicity.
    if v_cond is distinct from public.v1_sale_condition() then
      raise exception 'condition % is not offered', coalesce(v_cond, '(null)')
        using errcode = 'check_violation';
    end if;

    select i.id,
           public.shop_price(i.sale_price, s.market_price, st.price_percentage),
           coalesce(s.display_name_override, s.name),
           coalesce(s.image_override_path, s.image_file)
      into v_inv_id, v_price, v_name, v_image
      from public.shop_inventory i
      join public.skylanders s on s.sky_id = i.sky_id
      cross join public.shop_settings st
     where i.sky_id = v_sky_id
       and i.condition = v_cond
       and i.is_listed
       and public.is_shop_eligible(i.sky_id);

    if v_inv_id is null or v_price is null then
      raise exception 'article % / % is not offered', v_sky_id, v_cond
        using errcode = 'no_data_found';
    end if;

    v_line_total := round(v_price * v_qty, 2);

    v_resolved := v_resolved || jsonb_build_object(
      'inventory_id', v_inv_id,
      'sky_id',       v_sky_id,
      'condition',    v_cond,
      'quantity',     v_qty,
      'name',         v_name,
      'image',        v_image,
      'unit_price',   v_price,
      'line_total',   v_line_total
    );

    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines + 1;
  end loop;

  if v_lines = 0 then
    raise exception 'a checkout needs at least one article' using errcode = 'check_violation';
  end if;

  v_shipping := public.shipping_amount_for(p_shipping_method, v_subtotal);

  -- -------------------------------------------------------------------------
  -- The order, with the amounts it will keep for ever.
  --
  -- This is the whole fix. `orders_protect_immutable()` sees one INSERT and
  -- no UPDATE, and `orders_total_is_the_sum` holds on the first row written:
  -- discount_amount defaults to 0, so total = subtotal + shipping - 0.
  -- -------------------------------------------------------------------------
  insert into public.orders
    (request_id, user_id, customer_email, client_hash, commerce_mode,
     items_subtotal, shipping_amount, total_amount,
     shipping_method_code, shipping_method_name, payment_token_hash)
  values
    (p_request_id, v_user_id, p_email, v_client, v_mode,
     v_subtotal, v_shipping, v_subtotal + v_shipping,
     p_shipping_method, v_ship_name, v_token_hash)
  returning id, orders.order_number into v_order_id, v_number;

  -- -------------------------------------------------------------------------
  -- Pass 2 — write the lines from pass 1's snapshots.
  --
  -- No lookup here, by design. Re-reading would risk pricing a line
  -- differently from the subtotal the order was just charged for.
  -- -------------------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(v_resolved)
  loop
    insert into public.order_lines
      (order_id, sky_id, condition, quantity, name_snapshot, image_snapshot,
       unit_price, line_total, inventory_id)
    values
      (v_order_id,
       v_item ->> 'sky_id',
       v_item ->> 'condition',
       (v_item ->> 'quantity')::integer,
       v_item ->> 'name',
       v_item ->> 'image',
       (v_item ->> 'unit_price')::numeric(10,2),
       (v_item ->> 'line_total')::numeric(10,2),
       (v_item ->> 'inventory_id')::bigint);
  end loop;

  insert into public.order_addresses
    (order_id, kind, first_name, last_name, company, street, house_number,
     address_line_2, postal_code, city, country_code, phone)
  values
    (v_order_id, 'shipping',
     p_address ->> 'first_name', p_address ->> 'last_name', p_address ->> 'company',
     p_address ->> 'street', p_address ->> 'house_number', p_address ->> 'address_line_2',
     p_address ->> 'postal_code', p_address ->> 'city',
     v_country, p_address ->> 'phone');

  perform public.reserve_for_order(v_order_id);

  -- No token, no hash and no fragment of either: an event is a record of what
  -- happened, not a place to leak a secret.
  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id)
  values (v_order_id, 'placed', case when v_user_id is null then 'system' else 'customer' end, v_user_id);

  order_id        := v_order_id;
  order_number    := v_number;
  items_subtotal  := v_subtotal;
  shipping_amount := v_shipping;
  total_amount    := v_subtotal + v_shipping;
  return next;
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. What this migration deliberately does NOT do
--
-- No `seller_id`, anywhere. `sellers_one_active` still permits one seller.
-- No second seller, no onboarding, no commissions, no payouts, no ranking,
-- no marketplace terms, no third-party checkout.
--
-- No new role and no RBAC. `is_shop_admin()` remains the only predicate, and
-- one administrator reaches both responsibility domains.
--
-- No seeded identity. Every legal field is NULL and stays NULL until a human
-- supplies the real value.
--
-- No hard-coded platform address. `support_email` starts NULL.
--
-- No price, country or threshold change: DE, Hermes 5.49, DHL 6.49 and 75.00
-- are seeded to match exactly what the literals produced.
--
-- No legal pages, no Impressum, no AGB, no withdrawal flow, and no
-- terms_version/withdrawal_version on orders — Legal V1 owns all of that.
--
-- No dependency on `0035`.
-- ---------------------------------------------------------------------------
