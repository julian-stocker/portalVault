-- ===========================================================================
-- 0007 — automatic shop prices, and images an administrator can replace
--
-- Three things that only look unrelated. All three exist because running the
-- shop day to day currently means editing rows one at a time: a price per
-- position, an image per deploy.
--
--   1. shop_settings   one typed row: the percentage of the market price
--                      that becomes a shop price when nobody says otherwise
--   2. pricing         shop_inventory.sale_price stops being "the price" and
--                      becomes "the manual override"; the price that is
--                      charged is derived
--   3. images          skylanders.image_override_path, plus a storage bucket
--                      an administrator may write and everyone may read
--
-- WHAT THIS MIGRATION RELAXES, AND WHY THAT IS DELIBERATE
--
-- `shop_inventory_listed_needs_price` is dropped. It said "a listed position
-- has a sale_price", which was right while sale_price WAS the price. It is
-- wrong now: a position may be listed with no override at all and still have
-- a perfectly good price, derived from the market price and the percentage.
--
-- A CHECK cannot replace it, because the answer now depends on two other
-- tables (skylanders.market_price and shop_settings). So the rule moves to
-- the two places that can actually evaluate it:
--
--   set_shop_listing()  refuses to list a position with no effective price
--   shop_offers()       never returns a row without one
--
-- That is one guard on the way in and one on the way out, which is stronger
-- than the constraint was: the constraint could not have noticed a market
-- price being cleared afterwards, and the projection does.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. shop_settings — one row, typed
--
-- Deliberately NOT a key/value table. A `settings(key text, value jsonb)` is
-- the tempting shape and the wrong one here: every reader would have to cast
-- and re-validate, a typo in a key would read as "unset", and the CHECK below
-- could not exist at all. One row with named, typed, constrained columns says
-- what the shop can be configured to be, and the database enforces it.
--
-- The singleton is a primary key that can only hold one value. No trigger, no
-- "delete the others" job: a second row is not possible.
-- ---------------------------------------------------------------------------
create table public.shop_settings (
  id boolean primary key default true,

  -- Percent of skylanders.market_price. 90.00 means "ask nine tenths".
  --
  -- numeric, never a float: this is money arithmetic, and 0.1 + 0.2 must not
  -- enter it. Two decimals so 92.5 % is expressible.
  price_percentage numeric(6,2) not null default 90.00,

  updated_at timestamptz not null default now(),
  updated_by uuid,

  constraint shop_settings_singleton check (id),

  -- The bounds are a guard against a typo, not a business rule.
  --
  -- Above 100 is allowed on purpose: asking more than the reference market
  -- value is a legitimate thing to do for something rare, and a limit at 100
  -- would be a product decision smuggled in as a constraint. 0 is excluded
  -- for the same reason a market price of 0 is (ADR-0010): free is not a
  -- price, and it would silently give away stock. The ceiling catches the
  -- fat-finger case — 9000 instead of 90.
  constraint shop_settings_percentage_sane
    check (price_percentage > 0 and price_percentage <= 500),

  constraint shop_settings_updated_by_fk foreign key (updated_by)
    references auth.users (id) on delete set null
);

comment on table public.shop_settings is
  'Shop-wide configuration, exactly one row (ADR-0045). Typed rather than key/value so the constraints can exist. No client privileges; read through the functions below.';
comment on column public.shop_settings.price_percentage is
  'Percent of skylanders.market_price used when a position has no manual sale_price. 90.00 = 90 %.';

insert into public.shop_settings (id) values (true) on conflict (id) do nothing;

alter table public.shop_settings enable row level security;
revoke all on public.shop_settings from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. The price rule, in one place
--
-- Every caller — the public projection, the administrator's list, the listing
-- guard — asks this function. There is no second implementation, in SQL or in
-- TypeScript: money is computed here and displayed elsewhere.
--
-- `numeric` throughout, so the arithmetic is exact decimal arithmetic and not
-- binary floating point. `round(x, 2)` is half-away-from-zero in Postgres for
-- numeric, which is the ordinary commercial rounding: 4.99 × 90 % = 4.4910 →
-- 4.49, and 4.95 × 90 % = 4.4550 → 4.46.
--
-- immutable: the same three inputs always give the same answer. It reads
-- nothing.
-- ---------------------------------------------------------------------------
create or replace function public.shop_price(
  p_override     numeric,
  p_market_price numeric,
  p_percentage   numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    -- A manual price wins, always, and is never recomputed. That is the
    -- whole point of an override.
    when p_override is not null then p_override
    -- No market price and no override means no price. NULL, never 0 — the
    -- same rule the catalog follows (ADR-0010).
    when p_market_price is null or p_percentage is null then null
    else round(p_market_price * p_percentage / 100, 2)
  end;
$$;

comment on function public.shop_price(numeric, numeric, numeric) is
  'The effective shop price: the manual override if there is one, otherwise market_price x percentage rounded to cents, otherwise NULL (ADR-0045).';


-- ---------------------------------------------------------------------------
-- 3. Reading and writing the settings
-- ---------------------------------------------------------------------------
create or replace function public.admin_shop_settings()
returns table (
  price_percentage numeric,
  updated_at       timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query select s.price_percentage, s.updated_at from public.shop_settings s;
end;
$$;

comment on function public.admin_shop_settings() is
  'The shop configuration, for an administrator. The only read path: no client role holds a privilege on shop_settings.';

create or replace function public.admin_set_shop_percentage(p_percentage numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  -- Stated here as well as in the CHECK, so the caller gets a sentence about
  -- the percentage rather than a constraint name.
  if p_percentage is null or p_percentage <= 0 or p_percentage > 500 then
    raise exception 'percentage must be greater than 0 and at most 500'
      using errcode = 'check_violation';
  end if;

  update public.shop_settings
     set price_percentage = round(p_percentage, 2),
         updated_at       = now(),
         updated_by       = (select auth.uid())
   where id;
end;
$$;

comment on function public.admin_set_shop_percentage(numeric) is
  'Sets the shop-wide percentage of the market price. Changing it moves every automatic price at once; manual overrides are untouched (ADR-0045).';


-- ---------------------------------------------------------------------------
-- 4. sale_price becomes the override
--
-- No column is added and no data is migrated: `sale_price` already holds
-- exactly what an override is — a price somebody typed. What changes is what
-- NULL means. It used to mean "not priced yet"; it now means "no override,
-- follow the rule". Both readings agree on every row that exists today,
-- because the legacy import deliberately left it NULL everywhere.
--
-- Adding a second price column would have been the worse answer: two columns
-- holding 18.00 with no way to tell which one the shop is charging.
-- ---------------------------------------------------------------------------
comment on column public.shop_inventory.sale_price is
  'MANUAL price override in EUR (ADR-0045). NULL means the automatic price applies: market_price x shop_settings.price_percentage. Never derived, never recomputed.';

-- See the header. The rule this dropped now lives in set_shop_listing() and
-- in shop_offers(), which can see the market price and the percentage.
alter table public.shop_inventory
  drop constraint if exists shop_inventory_listed_needs_price;


-- ---------------------------------------------------------------------------
-- 5. Listing requires an effective price, not an override
-- ---------------------------------------------------------------------------
create or replace function public.set_shop_listing(
  p_sky_id     text,
  p_condition  text,
  p_sale_price numeric,
  p_is_listed  boolean,
  p_note       text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inventory_id bigint;
  v_effective    numeric;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- What this position would actually be offered for, with the price that is
  -- about to be written. Computed before the write, so a listing that cannot
  -- be priced is refused rather than stored and then hidden.
  select public.shop_price(p_sale_price, s.market_price, st.price_percentage)
    into v_effective
    from public.skylanders s
   cross join public.shop_settings st
   where s.sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;

  if coalesce(p_is_listed, false) and v_effective is null then
    raise exception
      'cannot list % / %: no manual price and no market price to derive one from',
      p_sky_id, p_condition
      using errcode = 'check_violation';
  end if;

  insert into public.shop_inventory (sky_id, condition, sale_price, is_listed, note)
  values (p_sky_id, p_condition, p_sale_price, coalesce(p_is_listed, false), p_note)
  on conflict (sky_id, condition) do update
     set sale_price = excluded.sale_price,
         is_listed  = excluded.is_listed,
         note       = excluded.note
  returning id into v_inventory_id;

  return v_inventory_id;
end;
$$;

comment on function public.set_shop_listing(text, text, numeric, boolean, text) is
  'Sets the manual price override, listing flag and internal note. Refuses to list a position that would have no effective price. Never changes quantity or reserved.';


-- ---------------------------------------------------------------------------
-- 6. The public projection, now derived
--
-- Same four values and the same guarantees. `sale_price` is renamed to
-- `price` because it no longer is the stored sale_price: it is what the shop
-- charges, whichever way that came about. Keeping the old name would have
-- meant one identifier standing for two different things.
--
-- The return type changes, so the function is dropped rather than replaced —
-- Postgres will not change a return type in place.
-- ---------------------------------------------------------------------------
drop function if exists public.shop_offers();

create or replace function public.shop_offers()
returns table (
  sky_id    text,
  condition text,
  price     numeric,
  available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.sky_id,
    i.condition,
    public.shop_price(i.sale_price, s.market_price, st.price_percentage) as price,
    (i.available_quantity > 0) as available
  from public.shop_inventory i
  join public.skylanders s on s.sky_id = i.sky_id
  join public.categories  c on c.id    = s.category_id
  cross join public.shop_settings st
  where i.is_listed
    and s.is_active
    and s.catalog_visible
    and not (c.name = any (public.non_collectible_categories()))
    -- The second half of the rule the dropped constraint used to carry: a
    -- position whose market price was cleared after it was listed has no
    -- price, and something without a price is not an offer.
    and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
  order by i.sky_id, i.condition;
$$;

comment on function public.shop_offers() is
  'The public shop: sky_id, condition, the effective price and an availability boolean for every listed offer on a publicly visible collectible. The only public read path into shop_inventory; quantity, reserved, notes, costs, movements, the override flag and the global percentage are never returned.';

revoke all on function public.shop_offers() from public;
grant execute on function public.shop_offers() to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. The administrator's list gains the derived price
--
-- Two extra values, and the second one is the important one: `price_source`
-- says whether the number beside it was typed or computed. Without it the
-- interface would have to guess from `sale_price is null`, which is the same
-- information but re-derived in a second place.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_shop_inventory();

create or replace function public.admin_shop_inventory()
returns table (
  inventory_id     bigint,
  sky_id           text,
  condition        text,
  quantity         integer,
  reserved         integer,
  available        integer,
  sale_price       numeric,
  effective_price  numeric,
  price_source     text,
  is_listed        boolean,
  note             text,
  updated_at       timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.sky_id, i.condition, i.quantity, i.reserved,
           i.available_quantity,
           i.sale_price,
           public.shop_price(i.sale_price, s.market_price, st.price_percentage),
           case when i.sale_price is not null then 'manual' else 'automatic' end,
           i.is_listed, i.note, i.updated_at
      from public.shop_inventory i
      left join public.skylanders s on s.sky_id = i.sky_id
     cross join public.shop_settings st
     order by i.sky_id, i.condition;
end;
$$;

comment on function public.admin_shop_inventory() is
  'Every stock position with its effective price and where that price came from. The only read path: clients hold no privilege on shop_inventory (ADR-0037).';


-- ---------------------------------------------------------------------------
-- 8. The editorial image override
--
-- A second column rather than a second meaning for `image_file`. The imported
-- path belongs to the catalog import and is overwritten by it on every run;
-- the override belongs to the administrator and must survive that (ADR-0034,
-- ADR-0039). Keeping them apart is what makes "remove my image" a real
-- operation: the imported one is still there underneath.
--
-- The format is constrained so the column cannot become a way to point at
-- something else in the bucket: SKY-ID directory, 16 hex characters, one of
-- three known extensions.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column if not exists image_override_path text;

alter table public.skylanders
  drop constraint if exists skylanders_image_override_format;

alter table public.skylanders
  add constraint skylanders_image_override_format
    check (
      image_override_path is null
      or image_override_path ~ '^SKY-[0-9]{4}/[0-9a-f]{16}\.(webp|png|jpg)$'
    );

comment on column public.skylanders.image_override_path is
  'Path inside the public "catalog" storage bucket of an image an administrator uploaded (ADR-0046). NULL means the imported image_file applies. The catalog import never writes this column.';

-- The editorial journal learns the new field.
alter table public.catalog_admin_changes
  drop constraint if exists catalog_admin_changes_field_known;

alter table public.catalog_admin_changes
  add constraint catalog_admin_changes_field_known
    check (field in (
      'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
      'image_override_path'
    ));

create or replace function public.log_skylander_editorial_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.catalog_visible is distinct from old.catalog_visible then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'catalog_visible',
            old.catalog_visible::text, new.catalog_visible::text,
            (select auth.uid()));
  end if;

  if new.display_name_override is distinct from old.display_name_override then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'display_name_override',
            old.display_name_override, new.display_name_override,
            (select auth.uid()));
  end if;

  if new.image_override_path is distinct from old.image_override_path then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'image_override_path',
            old.image_override_path, new.image_override_path,
            (select auth.uid()));
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. Setting and clearing the override
--
-- The path is validated here as well as by the CHECK, and against the SKY-ID
-- being written: an administrator may replace the picture of a figure, not
-- point one figure at another figure's file.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_image_override(
  p_sky_id text,
  p_path   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if not public.is_shop_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  -- The directory must be this figure's own SKY-ID. Without this the CHECK
  -- would still pass for a well-formed path belonging to another figure.
  if v_clean is not null and split_part(v_clean, '/', 1) <> p_sky_id then
    raise exception 'image path % does not belong to %', v_clean, p_sky_id
      using errcode = 'check_violation';
  end if;

  update public.skylanders set image_override_path = v_clean where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.admin_set_image_override(text, text) is
  'Points a figure at an uploaded image, or clears the override with an empty value. Never touches image_file (ADR-0046).';


-- ---------------------------------------------------------------------------
-- 10. Privileges
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so every REVOKE
-- here is load-bearing.
-- ---------------------------------------------------------------------------
revoke all on function public.shop_price(numeric, numeric, numeric) from public;
revoke all on function public.admin_shop_settings()                 from public, anon;
revoke all on function public.admin_set_shop_percentage(numeric)    from public, anon;
revoke all on function public.admin_shop_inventory()                from public, anon;
revoke all on function public.admin_set_image_override(text, text)  from public, anon;

-- shop_price is a pure calculator over values the caller already has; the
-- public projection needs it, and it reveals nothing on its own.
grant execute on function public.shop_price(numeric, numeric, numeric) to anon, authenticated;

grant execute on function public.admin_shop_settings()                to authenticated;
grant execute on function public.admin_set_shop_percentage(numeric)   to authenticated;
grant execute on function public.admin_shop_inventory()               to authenticated;
grant execute on function public.admin_set_image_override(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 11. The image bucket
--
-- Public read, administrator write. Catalog pictures are exactly as public as
-- the catalog they belong to, so a public bucket is the honest setting — and
-- it means the browser fetches them straight from the CDN with no signing.
--
-- Writing is a different question, and it is answered by the same predicate
-- as everything else in the shop: public.is_shop_admin(). No service-role key
-- goes near a browser, and there is no upload path for anon.
--
-- If the bucket already exists this does nothing. If your Supabase project
-- does not allow inserting into storage.buckets from SQL, create a public
-- bucket named "catalog" in the dashboard instead and run the rest.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog', 'catalog', true, 2097152,
  array['image/webp', 'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = 2097152,
      allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg'];

drop policy if exists catalog_images_read      on storage.objects;
drop policy if exists catalog_images_insert    on storage.objects;
drop policy if exists catalog_images_update    on storage.objects;
drop policy if exists catalog_images_delete    on storage.objects;

-- Anyone may look at a catalog picture, signed in or not.
create policy catalog_images_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'catalog');

-- Only an administrator may put one there, replace it or remove it. The
-- predicate is the same function that guards every other shop write.
create policy catalog_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'catalog' and public.is_shop_admin());

create policy catalog_images_update on storage.objects
  for update to authenticated
  using (bucket_id = 'catalog' and public.is_shop_admin())
  with check (bucket_id = 'catalog' and public.is_shop_admin());

create policy catalog_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'catalog' and public.is_shop_admin());
