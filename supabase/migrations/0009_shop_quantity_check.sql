-- ===========================================================================
-- 0009 — may this many be added?
--
-- The cart could count as high as it liked. `clampQuantity` in
-- src/lib/cart/cart.ts stops at 99, the number field on /cart accepted a typed
-- 99, and nothing anywhere asked whether SkyIsles actually has 99 of the
-- thing. That is a browser deciding a question only the database can answer.
--
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT
--
-- One function, one boolean. It answers exactly one question:
--
--   "would this article, in this condition, be purchasable in this quantity
--    at this moment?"
--
-- It does NOT return how many there are. `available_quantity` never leaves
-- the database, and no argument of this function can coax it out: the caller
-- names a quantity and gets yes or no. The rule from 0006 is unchanged —
-- "three left" is a stock level, "in stock" is an offer (docs/SECURITY.md).
--
-- Consider and reject: `allowed_quantity integer`. Returning "3" when 5 was
-- asked for is returning the stock level under another name, one round trip
-- instead of several. A boolean on a concrete request is the smallest thing
-- that answers the caller's actual question.
--
-- WHAT IT IS HONEST ABOUT
--
-- A determined caller can binary-search the boundary by asking repeatedly:
-- ask for 4, then 3, and the answer to "is there stock for exactly n" is a
-- comparison anyone can drive. That is inherent to selling things — a shop
-- that lets you put n in a basket tells you whether n is possible, whatever
-- shape the API has. What this avoids is the part that is avoidable: no
-- stock column is published, no field carries a count, and nothing on any
-- page displays one. It is not a secret, it is simply not an API
-- (docs/SECURITY.md). No obscurity is claimed as a control.
--
-- IT RESERVES NOTHING
--
-- `stable`, and it writes nothing. A true answer means "this would be
-- possible now", never "this is being held for you". The cart is still a list
-- in a browser (ADR-0043); `reserved` is read here and written by nothing.
-- Between cart and a future checkout the stock may change, and the checkout
-- will have to ask again, atomically, and reserve for real.
--
-- ONE ELIGIBILITY RULE, NOT A SECOND COPY
--
-- The predicate below is the same one `shop_offers()` uses, asked the same
-- way: `is_shop_eligible()` for the catalog gate (0008) and `shop_price()`
-- for "has a price at all" (0007). A second, slightly different copy of
-- "which articles may be sold" is how a console game ends up purchasable.
--
-- Nothing existing is altered: no table privilege, no policy, no column.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The upper bound the cart already believes in
--
-- Mirrors MAX_LINE_QUANTITY in src/lib/cart/cart.ts. It is a sanity bound and
-- never a stock statement: it says "no basket line runs to four digits", not
-- "we have 99". Named here so the check below reads as a rule rather than a
-- magic number, and so the mirror can be asserted — src/lib/shop/quantity.test.ts
-- reads this file and cart.ts and fails if the two ever disagree, the same
-- coupling `non_collectible_categories()` has with collectible.ts.
-- ---------------------------------------------------------------------------
create or replace function public.max_cart_quantity()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 99;
$$;

comment on function public.max_cart_quantity() is
  'Largest quantity a single cart line may hold. A sanity bound, not a stock level. Mirrors MAX_LINE_QUANTITY in src/lib/cart/cart.ts; src/lib/shop/quantity.test.ts asserts the two agree.';


-- ---------------------------------------------------------------------------
-- 2. shop_quantity_available() — yes or no, and nothing else
--
-- SECURITY DEFINER for the same reason `shop_offers()` is: `shop_inventory`
-- is unreadable to every client role and must stay that way. This function is
-- a projection down to one bit, not a view onto the table.
--
-- Every way of being "no" collapses into the same `false`, which is both the
-- correct answer and the quiet one:
--
--   the quantity is absurd, zero, negative or NULL
--   the condition is not one this shop knows
--   there is no such position, or no such figure
--   the position is not released (`is_listed`)
--   the figure is not eligible at all (inactive, hidden, not a collectible)
--   it has no effective price
--   there are fewer than `p_quantity` available
--
-- The caller cannot tell which — a denied add says "not available", never
-- "withdrawn from sale" or "you asked for more than we have".
-- ---------------------------------------------------------------------------
create or replace function public.shop_quantity_available(
  p_sky_id    text,
  p_condition text,
  p_quantity  integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_quantity is not null
    and p_quantity >= 1
    and p_quantity <= public.max_cart_quantity()
    and exists (
      select 1
        from public.shop_inventory i
        join public.skylanders s on s.sky_id = i.sky_id
        cross join public.shop_settings st
       where i.sky_id    = p_sky_id
         and i.condition = p_condition
         and i.is_listed
         and public.is_shop_eligible(i.sky_id)
         -- Something without a price is not an offer, however released it is.
         and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
         -- The whole point. `available_quantity` is `quantity - reserved`,
         -- generated by the table (0003) — one definition, compared here,
         -- never returned.
         and i.available_quantity >= p_quantity
    );
$$;

comment on function public.shop_quantity_available(text, text, integer) is
  'Whether this article, in this condition, could be bought in this quantity right now: eligible, released, priced and with enough available stock (ADR-0043 addendum). Returns a boolean and never a count; no stock level is published. Reserves nothing and writes nothing — a true answer is a statement about this moment, not a promise.';


-- ---------------------------------------------------------------------------
-- 3. Privileges
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so the REVOKE is
-- what makes the GRANTs below the complete statement of who may call these.
--
-- Both client roles, because the shop is public: someone who is not signed in
-- has to be able to fill a basket, exactly as they can read `shop_offers()`.
--
-- Deliberately unchanged: shop_inventory and inventory_movements keep no
-- privileges for any client role, and no policy is added to either.
-- ---------------------------------------------------------------------------
revoke all on function public.max_cart_quantity()                       from public;
revoke all on function public.shop_quantity_available(text, text, integer) from public;

grant execute on function public.max_cart_quantity()                       to anon, authenticated;
grant execute on function public.shop_quantity_available(text, text, integer) to anon, authenticated;
