-- ===========================================================================
-- 0006 — the public offer
--
-- The first thing about the shop that anyone other than the operator can see.
--
-- THE PROBLEM THIS SOLVES, AND THE ONE IT MUST NOT CREATE
--
-- `shop_inventory` holds stock levels, reservations, internal notes and — via
-- its journal — purchase prices and who booked what. None of that is public,
-- and no client role holds any privilege on the table (0003, 0005). That must
-- stay exactly as it is. A table grant is column-blind: granting SELECT on
-- shop_inventory to `anon` so that a price could be read would publish the
-- stock level in the same breath, and RLS would not help, because RLS filters
-- rows and not columns.
--
-- So the public projection is a function, and it returns four values:
--
--   sky_id      which figure          already public
--   condition   loose or boxed        already public in the sense that it
--                                     describes the article being offered
--   sale_price  the asking price      the point of the offer
--   available   true / false          whether it can be bought right now
--
-- `available` is deliberately a boolean derived from `available_quantity > 0`.
-- "Three left" is a stock level; "in stock" is an offer. Publishing the count
-- would be publishing the inventory one row at a time.
--
-- Never returned, by construction rather than by discipline: quantity,
-- reserved, available_quantity, note, unit_cost, currency, created_by,
-- inventory_id and every movement.
--
-- WHAT COUNTS AS AN OFFER
--
-- `is_listed` alone. A position that exists is not an offer — stock is
-- something the operator has, an offer is something they decided to sell
-- (ADR-0037, section 7). The database already guarantees that a listed
-- position has a price (`shop_inventory_listed_needs_price`), so "listed but
-- priceless" cannot occur and is not a case the caller has to handle.
--
-- A listed position with nothing available still returns a row, with
-- `available = false`. That is the "Nicht auf Lager" case: the shop carries
-- the article, it is out of stock, and saying so is more use than silence.
--
-- WHAT IS NOT OFFERED, EVER
--
-- The catalog gate below. An offer only exists for a figure the public
-- catalog actually shows:
--
--   is_active         the legacy source still knows the row
--   catalog_visible   an administrator has not taken it out (ADR-0039)
--   collectible       console software is not a collector's article
--                     (ADR-0029)
--
-- SWAP halves need no rule: they have no row in `skylanders` at all, and the
-- join drops them. The retained audit fixtures need none either: they are
-- inactive, so the same gate excludes them.
--
-- Nothing existing is altered: no table privilege is granted, no policy is
-- added or changed, and no column is added to any table.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The categories that hold no collector's article
--
-- One list, mirrored from src/lib/catalog/collectible.ts, which is where the
-- rule is explained and where the evidence for it is recorded. Both sides
-- name the category, never an individual figure — this is the category
-- structure the owner defined, not a blacklist (docs/SKYLANDERS_DATA.md).
--
-- The coupling is deliberate and checked: src/lib/shop/offer.test.ts reads
-- both this file and collectible.ts and asserts they name the same
-- categories, so the two cannot drift apart unnoticed.
-- ---------------------------------------------------------------------------
create or replace function public.non_collectible_categories()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['Spiele']::text[];
$$;

comment on function public.non_collectible_categories() is
  'Category names that hold no collector''s article (ADR-0029). Mirrors src/lib/catalog/collectible.ts; verify:shop asserts the two agree.';


-- ---------------------------------------------------------------------------
-- 2. shop_offers() — the whole public shop, in one call
--
-- No arguments and no pagination. The whole offer list is at most a few
-- hundred rows and every caller needs all of it: the catalog grid decorates
-- 561 cards from it, and the cart page revalidates a handful of lines against
-- it. One call, one round trip, no N+1 — a per-figure lookup would be 561
-- requests to answer a question that has one answer.
--
-- SECURITY DEFINER because the table is unreadable to every client role and
-- must remain so. The function is the entire public read surface of the shop,
-- and it is a projection, not a view onto the table.
--
-- `stable`, so PostgREST may call it with GET and Postgres may cache it
-- within a statement. Not `immutable`: stock changes.
-- ---------------------------------------------------------------------------
create or replace function public.shop_offers()
returns table (
  sky_id     text,
  condition  text,
  sale_price numeric,
  available  boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.sky_id,
    i.condition,
    i.sale_price,
    -- A boolean, never the count. See the header.
    (i.available_quantity > 0) as available
  from public.shop_inventory i
  join public.skylanders s on s.sky_id = i.sky_id
  join public.categories  c on c.id    = s.category_id
  where i.is_listed
    and s.is_active
    and s.catalog_visible
    and not (c.name = any (public.non_collectible_categories()))
  order by i.sky_id, i.condition;
$$;

comment on function public.shop_offers() is
  'The public shop: sky_id, condition, sale_price and an availability boolean for every listed offer on a publicly visible collectible. The only public read path into shop_inventory; quantity, reserved, notes, costs and movements are never returned.';


-- ---------------------------------------------------------------------------
-- 3. Privileges
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so the REVOKE is
-- required rather than decorative — it is what makes the following GRANTs the
-- complete statement of who may call these.
--
-- Both client roles, because the shop is public: someone who is not signed in
-- has to be able to see a price and put something in a basket.
--
-- Deliberately unchanged: shop_inventory and inventory_movements keep no
-- privileges for any client role, and no policy is added to either.
-- ---------------------------------------------------------------------------
revoke all on function public.non_collectible_categories() from public;
revoke all on function public.shop_offers()                from public;

grant execute on function public.non_collectible_categories() to anon, authenticated;
grant execute on function public.shop_offers()                to anon, authenticated;
