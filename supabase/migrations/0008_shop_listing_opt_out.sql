-- ===========================================================================
-- 0008 — the shop is opt-out
--
-- One sentence changes: **stock that exists is offered, unless somebody said
-- otherwise.** Until now `is_listed` defaulted to false, so every one of the
-- 218 imported positions would have had to be switched on by hand, and every
-- future one again after its first movement. That is a synchronisation job
-- disguised as a product decision.
--
-- WHAT DOES *NOT* CHANGE, AND THIS IS THE POINT
--
-- There is still exactly one stock. No snapshot, no copy of "what the shop
-- has", no job that reconciles the two, and no "Shop synchronisieren" button
-- to press after a sale. `shop_offers()` reads `shop_inventory` live, as it
-- always has, so a position that sells out disappears from the shop by
-- arithmetic and comes back the moment stock is booked again.
--
-- THE TWO QUESTIONS, KEPT APART
--
--   is_listed              may this position be offered at all?   editorial
--   buyable right now      price + stock + catalog rules          derived
--
-- They were tangled: since 0007 `set_shop_listing()` refused to set
-- `is_listed = true` without an effective price. That made "release for the
-- shop" depend on a price, which is why a brand-new position could not be
-- released at creation time — the market price may be unknown, and the
-- decision "sell this when possible" is still perfectly meaningful. The guard
-- moves entirely to `shop_offers()`, where it already was.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. One rule for "may this figure be sold at all"
--
-- Three conditions that already existed, inline, in `shop_offers()`. They are
-- named here because the one-time activation below has to use exactly the
-- same rule — a second, slightly different copy of "which figures count" is
-- how a fixture or a console game ends up in a public shop.
--
-- Note what is NOT in here: stock, price, reservations. This answers whether
-- an article belongs in the shop's world at all, not whether it can be bought
-- this minute.
-- ---------------------------------------------------------------------------
create or replace function public.is_shop_eligible(p_sky_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.skylanders s
      join public.categories c on c.id = s.category_id
     where s.sky_id = p_sky_id
       and s.is_active
       and s.catalog_visible
       and not (c.name = any (public.non_collectible_categories()))
  );
$$;

comment on function public.is_shop_eligible(text) is
  'Whether a figure may be offered in the shop at all: active, editorially visible, and a collectible rather than software (ADR-0048). Says nothing about stock or price.';

revoke all on function public.is_shop_eligible(text) from public;
grant execute on function public.is_shop_eligible(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. New positions are released by default
--
-- A position comes into existence from its first movement
-- (`apply_inventory_movement` inserts it and lets the column defaults stand),
-- so this one default covers every creation path there is: quick stock, the
-- detailed booking, the system path used by the legacy import, and anything
-- server-side added later. Nothing has to remember to pass a flag.
--
-- Safe because the default is not the gate. A movement may be booked against
-- software or an inactive figure — the import's excluded rows would have been
-- exactly that — and `shop_offers()` still refuses to offer it, because
-- `is_shop_eligible()` is asked there and not here.
-- ---------------------------------------------------------------------------
alter table public.shop_inventory
  alter column is_listed set default true;

comment on column public.shop_inventory.is_listed is
  'Editorial release for the shop, default TRUE (ADR-0048). FALSE is a deliberate opt-out: keep the stock, do not sell it here. It does NOT mean "in stock" — whether something can be bought is derived from price and available_quantity in shop_offers().';


-- ---------------------------------------------------------------------------
-- 3. Releasing no longer requires a price
--
-- The 0007 guard is removed, not moved: `shop_offers()` has filtered
-- priceless positions out since the same migration, so the rule is enforced
-- exactly once, at the only place that can see whether it is still true.
--
-- The difference in practice: a figure whose market price is unknown can be
-- released now and starts selling by itself the day a price exists. Under the
-- old guard, releasing it was an error, and somebody would have had to come
-- back to it.
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
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- The figure still has to exist. Everything else about it — active,
  -- visible, collectible, priced, in stock — is the projection's question.
  if not exists (select 1 from public.skylanders where sky_id = p_sky_id) then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;

  insert into public.shop_inventory (sky_id, condition, sale_price, is_listed, note)
  values (p_sky_id, p_condition, p_sale_price, coalesce(p_is_listed, true), p_note)
  on conflict (sky_id, condition) do update
     set sale_price = excluded.sale_price,
         is_listed  = excluded.is_listed,
         note       = excluded.note
  returning id into v_inventory_id;

  return v_inventory_id;
end;
$$;

comment on function public.set_shop_listing(text, text, numeric, boolean, text) is
  'Sets the manual price override, the shop release and the internal note. Releasing does not require a price: shop_offers() decides what is buyable. Never changes quantity or reserved.';


-- ---------------------------------------------------------------------------
-- 4. The public projection, asking the named rule
--
-- Behaviour is unchanged — the three inline conditions become one function
-- call. What that buys is that the activation below and the projection can no
-- longer disagree about which figures belong in the shop.
-- ---------------------------------------------------------------------------
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
  cross join public.shop_settings st
  where i.is_listed
    and public.is_shop_eligible(i.sky_id)
    -- Something without a price is not an offer, however released it is.
    and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
  order by i.sky_id, i.condition;
$$;

comment on function public.shop_offers() is
  'The public shop: sky_id, condition, the effective price and an availability boolean for every released offer on a publicly visible collectible. The only public read path into shop_inventory; quantity, reserved, notes, costs, movements, the override flag and the global percentage are never returned.';

revoke all on function public.shop_offers() from public;
grant execute on function public.shop_offers() to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. What the change would do, before it does it
--
-- A read-only audit of the same predicate, so the activation can be inspected
-- rather than trusted — and re-inspected afterwards. `npm run verify:shop`
-- prints it.
-- ---------------------------------------------------------------------------
create or replace function public.admin_shop_listing_audit()
returns table (
  sky_id     text,
  condition  text,
  is_listed  boolean,
  eligible   boolean,
  reason     text
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
    select
      i.sky_id,
      i.condition,
      i.is_listed,
      public.is_shop_eligible(i.sky_id),
      case
        when s.sky_id is null            then 'no catalog row'
        when not s.is_active             then 'inactive figure'
        when not s.catalog_visible       then 'editorially hidden'
        when c.name = any (public.non_collectible_categories())
                                         then 'not a collectible'
        else null
      end
      from public.shop_inventory i
      left join public.skylanders s on s.sky_id = i.sky_id
      left join public.categories c on c.id = s.category_id
     order by i.sky_id, i.condition;
end;
$$;

comment on function public.admin_shop_listing_audit() is
  'Every stock position with its shop release and whether the figure is eligible at all, with the reason when it is not (ADR-0048). Read-only.';

revoke all on function public.admin_shop_listing_audit() from public, anon;
grant execute on function public.admin_shop_listing_audit() to authenticated;


-- ---------------------------------------------------------------------------
-- 6. The one-time activation
--
-- Everything that already exists and is eligible gets released. Deliberately
-- narrow:
--
--   * it only ever sets TRUE. A position somebody switched off stays off —
--     an opt-out is a decision, and this migration does not overrule
--     decisions. (There are none today; the guarantee is for the re-run.)
--   * it uses `is_shop_eligible()`, the same predicate the projection uses,
--     rather than a second copy of the category rule.
--   * `where not is_listed` so an already-released position is not written
--     at all, which keeps its `updated_at` honest.
--
-- It touches no quantity, no reserved, no price and no movement. Listing is
-- not a stock change and must never be journalled as one: the reconciliation
-- `SUM(delta) = quantity` has to hold exactly as it did before.
--
-- Idempotent: running it again selects nothing.
-- ---------------------------------------------------------------------------
update public.shop_inventory i
   set is_listed = true
 where not i.is_listed
   and public.is_shop_eligible(i.sky_id);
