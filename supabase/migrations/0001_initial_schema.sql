-- ===========================================================================
-- PortalVault — 0001_initial_schema
--
-- Foundation for V1: catalog, profiles and personal collections.
--
-- Design decisions this file implements (see docs/DECISIONS.md):
--   ADR-0001  SKY-IDs are the canonical, permanent identity
--   ADR-0002  skylanders.sky_id is the primary key, no UUID surrogate
--   ADR-0005  collection_items: surrogate PK + unique (user_id, sky_id)
--   ADR-0008  no `available`, no purchase rate, no eBay data
--   ADR-0010  market_price numeric(10,2), nullable, never 0 for "unknown"
--   ADR-0011  slug is navigation only; no foreign key references the slug
--   ADR-0016  profiles and collections are private; catalog is world-readable
--             and never writable by normal users
--   ADR-0019  all technical names are English
--   ADR-0020  case-insensitive usernames via unique index on lower(username)
--
-- Not part of V1 and deliberately absent: listings, orders, trades, messages,
-- price_history, inventory, availability.
--
-- This migration creates structure only. It contains no data, no secrets and
-- no hardcoded user IDs, and it does not depend on any existing rows.
-- Catalog rows are loaded later by the import tool (V1.3).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. series
--
-- Six Skylanders series. The code is stable across the legacy system (Excel
-- sheet name, price mapping key, public export), so it is a natural key.
-- ---------------------------------------------------------------------------
create table public.series (
  code          text        primary key,
  label         text        not null,
  release_year  smallint    not null,
  position      smallint    not null unique,
  created_at    timestamptz not null default now(),

  constraint series_code_format check (code ~ '^[A-Z]{1,4}$'),
  constraint series_label_not_blank check (length(btrim(label)) > 0),
  constraint series_release_year_range check (release_year between 1990 and 2100),
  constraint series_position_non_negative check (position >= 0)
);

comment on table  public.series is
  'Skylanders series. Codes and labels come from the legacy system and are never renamed automatically.';
comment on column public.series.code is
  'Legacy series code: SA, G, SF, T, SC, I.';
comment on column public.series.label is
  'Display label, stored exactly as maintained by the owner. Never normalised.';
comment on column public.series.position is
  'Deterministic display order. "position" is a non-reserved keyword in PostgreSQL and is safe as a column name.';


-- ---------------------------------------------------------------------------
-- 2. categories
--
-- The legacy Excel separates categories by blank rows and does not name them;
-- the names and their order come from etl/categories.py and are a deliberate
-- decision by the owner. Storing them as rows keeps the order explicit and
-- editable without a code change.
-- ---------------------------------------------------------------------------
create table public.categories (
  id           bigint      generated always as identity primary key,
  series_code  text        not null,
  position     smallint    not null,
  name         text        not null,
  created_at   timestamptz not null default now(),

  constraint categories_series_fk foreign key (series_code)
    references public.series (code)
    on update cascade
    on delete restrict,

  constraint categories_name_not_blank check (length(btrim(name)) > 0),
  constraint categories_position_non_negative check (position >= 0),

  -- One name and one slot per series. Order is deterministic per series.
  constraint categories_series_position_uniq unique (series_code, position),
  constraint categories_series_name_uniq     unique (series_code, name),

  -- Needed as the target of the composite foreign key on skylanders below.
  -- Redundant for uniqueness (id is already the primary key), but a foreign
  -- key can only reference a declared unique constraint.
  constraint categories_id_series_uniq unique (id, series_code)
);

comment on table  public.categories is
  'Catalog categories per series, including their display order. Names are taken verbatim from the legacy system.';
comment on column public.categories.position is
  'Matches categoryIndex in the legacy public export. Defines the order shown in the catalog.';


-- ---------------------------------------------------------------------------
-- 3. skylanders — the canonical figure
--
-- One row per figure, referenced by every user collection. Contains only
-- publishable data: no stock counts, no availability, no purchase rate,
-- no eBay data (ADR-0008).
-- ---------------------------------------------------------------------------
create table public.skylanders (
  sky_id            text        primary key,
  name              text        not null,
  slug              text        not null,
  series_code       text        not null,
  category_id       bigint      not null,
  market_price      numeric(10,2),
  price_updated_at  timestamptz,
  image_file        text,
  is_active         boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Identity format, identical to the legacy validation
  -- (etl/articles.py: ID_PATTERN = ^SKY-\d{4}$). All 820 existing IDs match.
  -- Going beyond SKY-9999 would require a change in the legacy project first
  -- and then a migration here — deliberately not pre-empted.
  constraint skylanders_sky_id_format check (sky_id ~ '^SKY-[0-9]{4}$'),

  constraint skylanders_name_not_blank check (length(btrim(name)) > 0),

  -- Slug is navigation only (ADR-0011). Lowercase, digits, hyphens.
  constraint skylanders_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint skylanders_slug_uniq unique (slug),

  -- ADR-0010: NULL means "no known market price". 0 must never stand in for
  -- unknown, so 0 is rejected outright — which also rules out negatives.
  -- The legacy export already maps a 0 price to null, so this never fires on
  -- valid import data; if it does, the data is wrong and the import must stop.
  constraint skylanders_market_price_positive
    check (market_price is null or market_price > 0),

  -- A price timestamp without a price would be meaningless.
  constraint skylanders_price_timestamp_consistent
    check (price_updated_at is null or market_price is not null),

  -- Content-addressed WebP file name from the legacy image pipeline,
  -- e.g. 'c4b74b87bef30222.webp'. Only the file name, never a URL (ADR-0009).
  constraint skylanders_image_file_format
    check (image_file is null or image_file ~ '^[0-9a-f]{16}\.webp$'),

  -- Composite foreign key: guarantees the category exists AND belongs to the
  -- series stated on this row. Prevents a figure in series 'SA' from pointing
  -- at a category of series 'G'. series_code is kept on the row because most
  -- catalog queries filter by series.
  constraint skylanders_category_fk foreign key (category_id, series_code)
    references public.categories (id, series_code)
    on update cascade
    on delete restrict
);

create index skylanders_series_category_idx
  on public.skylanders (series_code, category_id);

create index skylanders_is_active_idx
  on public.skylanders (is_active);

comment on table  public.skylanders is
  'Canonical catalog of Skylanders figures. Public data only. Written exclusively by the import tool via the service role.';
comment on column public.skylanders.sky_id is
  'Permanent identity (ADR-0001). Never derived from name, slug, image or row number, never reused, never changed.';
comment on column public.skylanders.name is
  'Name taken verbatim from the legacy source. No trimming, no normalisation, no translation.';
comment on column public.skylanders.slug is
  'Navigation and display only (ADR-0011). No foreign key references the slug. Generated once on import and then stable.';
comment on column public.skylanders.market_price is
  'Reference market price in EUR. NULL means no known market price; 0 is rejected and must never stand in for unknown (ADR-0010).';
comment on column public.skylanders.image_file is
  'Content-addressed WebP file name, e.g. c4b74b87bef30222.webp. Several figures may share one file. Never a URL.';
comment on column public.skylanders.is_active is
  'Soft state instead of deletion: user collections reference these rows, so catalog rows are never deleted.';


-- ---------------------------------------------------------------------------
-- 4. profiles — 1:1 with auth.users
--
-- Private in V1 (ADR-0016). No email address here: it lives in auth.users.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid        primary key references auth.users (id) on delete cascade,
  username      text,
  display_name  text,
  avatar_url    text,
  country       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Username is NULL until onboarding, so profile creation can never fail on
  -- a name collision (see docs/AUTH.md).
  constraint profiles_username_format
    check (username is null or username ~ '^[a-zA-Z0-9_]{3,20}$'),

  -- Reserved system names (ADR-0016). Compared case-insensitively, matching
  -- the uniqueness rule below. Extending this list requires a new migration —
  -- that is intended: adding a reserved name is a deliberate decision.
  constraint profiles_username_not_reserved
    check (
      username is null
      or lower(username) <> all (array[
        'admin', 'administrator', 'root', 'system', 'superuser', 'moderator', 'mod',
        'api', 'auth', 'login', 'logout', 'signin', 'signup', 'register', 'callback',
        'support', 'help', 'contact', 'info', 'mail', 'email', 'noreply', 'no-reply',
        'portalvault', 'portal', 'vault', 'skylanders', 'skylander', 'catalog',
        'collection', 'profile', 'profiles', 'user', 'users', 'account', 'settings',
        'dashboard', 'search', 'static', 'assets', 'images', 'public', 'www', 'ftp',
        'about', 'legal', 'impressum', 'datenschutz', 'privacy', 'terms', 'agb',
        'null', 'undefined', 'me', 'new', 'edit', 'delete', 'test'
      ])
    ),

  constraint profiles_country_format
    check (country is null or country ~ '^[A-Z]{2}$')
);

-- ADR-0020: case-insensitive uniqueness without the citext extension.
-- The typed spelling is preserved for display; 'Julian' and 'julian' collide.
-- Every lookup must use lower(username) = lower($1) to hit this index.
create unique index profiles_username_lower_uniq
  on public.profiles (lower(username))
  where username is not null;

comment on table  public.profiles is
  'User profile, 1:1 with auth.users. Private in V1: a user can read and modify only their own profile (ADR-0016).';
comment on column public.profiles.username is
  'Unique, case-insensitive display identity. NULL until onboarding. Uniqueness is enforced by profiles_username_lower_uniq.';
comment on column public.profiles.country is
  'Optional ISO 3166-1 alpha-2 country code.';


-- ---------------------------------------------------------------------------
-- 5. collection_items — a user's personal collection
--
-- V1 stores one aggregated row per user and figure (ADR-0005). Dropping the
-- unique constraint and adding a state column later turns rows into
-- individual lots (keep / sell / trade) without touching any key.
-- ---------------------------------------------------------------------------
create table public.collection_items (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,
  sky_id      text        not null,
  quantity    integer     not null default 1,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Deleting an account removes that user's collection with it (GDPR).
  constraint collection_items_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete cascade,

  -- Catalog rows must not disappear underneath a collection. RESTRICT makes an
  -- accidental catalog delete fail loudly instead of silently dropping user
  -- data; the import uses is_active instead of deleting.
  constraint collection_items_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id)
    on update restrict
    on delete restrict,

  -- "Does not own" means: no row. A zero quantity is never stored.
  constraint collection_items_quantity_positive check (quantity > 0),

  -- Guards against a runaway client; far above any plausible collection.
  constraint collection_items_quantity_sane check (quantity <= 10000),

  constraint collection_items_note_length check (note is null or length(note) <= 500),

  -- V1: exactly one row per user and figure (ADR-0005).
  constraint collection_items_user_sky_uniq unique (user_id, sky_id)
);

-- Supports "who owns this figure" and the foreign key check.
-- No separate index on user_id: the unique constraint above already indexes
-- (user_id, sky_id) with user_id as the leading column.
create index collection_items_sky_id_idx
  on public.collection_items (sky_id);

comment on table  public.collection_items is
  'A user''s personal collection. Private in V1 (ADR-0016). One aggregated row per user and figure (ADR-0005).';
comment on column public.collection_items.quantity is
  'Number of copies the user owns. Unrelated to any legacy stock level and not capped by it.';
comment on column public.collection_items.sky_id is
  'References the canonical figure. Collection value is always computed from skylanders.market_price, never copied here (ADR-0010).';


-- ===========================================================================
-- 6. Triggers
-- ===========================================================================

-- 6.1 Keep updated_at honest. Runs as the invoker; it only rewrites NEW.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Sets updated_at on every UPDATE. Not SECURITY DEFINER: it needs no elevated rights.';

create trigger skylanders_set_updated_at
  before update on public.skylanders
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger collection_items_set_updated_at
  before update on public.collection_items
  for each row execute function public.set_updated_at();


-- 6.2 The SKY-ID is immutable (ADR-0001).
--
-- RLS already prevents clients from writing to the catalog, but the service
-- role bypasses RLS — and the import tool runs as the service role. Triggers
-- and constraints are NOT bypassed, so this is the layer that protects the
-- project's most important invariant against a buggy import.
create or replace function public.prevent_sky_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sky_id is distinct from old.sky_id then
    raise exception
      'SKY-ID is immutable (ADR-0001): % cannot be changed to %',
      old.sky_id, new.sky_id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

comment on function public.prevent_sky_id_change() is
  'Rejects any UPDATE that would change a SKY-ID. Applies to the service role as well.';

create trigger skylanders_sky_id_immutable
  before update of sky_id on public.skylanders
  for each row execute function public.prevent_sky_id_change();


-- 6.3 Create a profile row for every new auth user.
--
-- SECURITY DEFINER is required: the INSERT into auth.users runs as
-- supabase_auth_admin, which has no rights on public.profiles.
--
-- Hardening:
--   * search_path is set to the empty string and every object is fully
--     qualified, so no schema on a caller's search_path can be substituted.
--   * Only new.id is used — a UUID generated by Supabase Auth. No
--     user-controlled value (email, raw_user_meta_data) is read here.
--     The username is set later by the user through an RLS-checked UPDATE.
--   * ON CONFLICT DO NOTHING keeps signup working if the row already exists.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the 1:1 profile row for a new auth user. SECURITY DEFINER because supabase_auth_admin has no rights on public.profiles. Reads no user-controlled input.';

-- A SECURITY DEFINER function should not be callable by clients.
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ===========================================================================
-- 7. Privileges
--
-- Two independent layers must both allow an operation: the table privilege
-- and an RLS policy.
--
-- IMPORTANT: Supabase sets ALTER DEFAULT PRIVILEGES on schema public so that
-- anon, authenticated and service_role receive ALL privileges on every table
-- the moment it is created. GRANT is additive and removes nothing, so stating
-- the intended privileges is not enough — everything unwanted must be revoked
-- explicitly. That is what the REVOKE statements below are for.
-- ===========================================================================

-- Catalog: readable by everyone, never writable through the API.
-- Writes happen exclusively through the service role, which bypasses RLS.
grant select on public.series, public.categories, public.skylanders
  to anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.series, public.categories, public.skylanders
  from anon, authenticated;

-- User data: no anonymous access at all.
revoke all on public.profiles, public.collection_items from anon;

-- A user may maintain their own profile, but not delete the row; account
-- deletion cascades from auth.users instead.
--
-- TRUNCATE is the one that matters most: row level security does NOT apply to
-- it, so the privilege itself is the only thing between a client and an empty
-- table. REFERENCES and TRIGGER have no legitimate use for an end user.
grant select, insert, update on public.profiles to authenticated;
revoke delete, truncate, references, trigger
  on public.profiles from authenticated;

grant select, insert, update, delete on public.collection_items to authenticated;
revoke truncate, references, trigger
  on public.collection_items from authenticated;


-- ===========================================================================
-- 8. Row Level Security
--
-- RLS is enabled on every table. A table with RLS and no matching policy
-- denies access — that is the safe default we rely on.
--
-- auth.uid() is wrapped in a scalar subquery so PostgreSQL evaluates it once
-- per statement instead of once per row.
-- ===========================================================================

alter table public.series           enable row level security;
alter table public.categories       enable row level security;
alter table public.skylanders       enable row level security;
alter table public.profiles         enable row level security;
alter table public.collection_items enable row level security;

-- --- Catalog: read-only for everyone -------------------------------------
-- No INSERT, UPDATE or DELETE policy exists anywhere for these tables, so no
-- client role can ever write to them, whatever privileges are granted later.

create policy series_select_public on public.series
  for select to anon, authenticated
  using (true);

create policy categories_select_public on public.categories
  for select to anon, authenticated
  using (true);

create policy skylanders_select_public on public.skylanders
  for select to anon, authenticated
  using (true);

-- --- Profiles: private, owner only ---------------------------------------

create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

-- Fallback for onboarding if the signup trigger did not run. A user can only
-- ever create their own row.
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No DELETE policy: profiles disappear with the auth user, not on their own.

-- --- Collection: private, owner only -------------------------------------

create policy collection_items_select_own on public.collection_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy collection_items_insert_own on public.collection_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- USING decides which rows may be updated, WITH CHECK decides what they may
-- become. Both are required: without WITH CHECK a user could move their own
-- row to another user_id.
create policy collection_items_update_own on public.collection_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy collection_items_delete_own on public.collection_items
  for delete to authenticated
  using ((select auth.uid()) = user_id);
