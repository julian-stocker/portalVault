-- ===========================================================================
-- 0029 - the public offer projection follows the V1 sales contract
--
-- WHY
--
-- 0028 closed the two doors through which a boxed position could be bought:
-- shop_quantity_available() answers false, and create_order() refuses the
-- line before anything is written. It did not touch the third door, which
-- does not sell anything but describes what is for sale.
--
-- So shop_offers() went on publishing boxed positions to anon - sky_id,
-- condition, price and an availability flag - for articles the platform can
-- no longer sell. On staging that is 8 of 25 rows. An offer that cannot be
-- accepted is not an offer, and saying otherwise to a visitor is a false
-- statement about the shop rather than a harmless surplus.
--
-- It is also the defect that started this: the catalogue card said "Angebote
-- ab 21,50 EUR" for SKY-0043 while the quick view refused to open, because
-- the card believed the projection and the quick view believed the V1 rule.
-- The application now filters with v1BuyableOffers() on every surface. This
-- migration moves the same answer to where the question is asked.
--
-- WHAT THIS IS NOT
--
-- Not a data change, and not a claim that boxed does not exist.
-- shop_inventory keeps every boxed row, its condition column and its CHECK
-- constraint; order_lines keeps the condition of every historical line, so a
-- boxed order placed earlier still reads as boxed in my_order(), in
-- admin_order() and in its confirmation mail. The administrator's own reads -
-- admin_shop_inventory(), admin_inventory_movements() - are untouched and go
-- on showing both conditions, because internal stock is a different question
-- from a public offer.
--
-- Not a security fix either. Since 0028 nobody can buy a boxed position by
-- any route. What changes here is what a visitor is told, and defence in
-- depth for any future surface that forgets to filter.
--
-- WHICH DEFINITION THIS REPLACES
--
--   shop_offers()  - 0008, the current one (0006 -> 0007 -> 0008)
--
-- Same signature, same four columns, same types, same ordering, same
-- is_listed / is_shop_eligible / price rules. One predicate is added and
-- nothing else; no argument is introduced, because a condition the client
-- could choose is exactly the choice V1 does not offer.
--
-- ROLLBACK
--
-- Re-apply the definition from 0008. Nothing else is touched.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The storefront projection, narrowed to what V1 sells
--
-- The definition below is the one from 0008, unchanged except for the single
-- added predicate. It asks public.v1_sale_condition() rather than naming a
-- condition, so this file contains no second opinion about what V1 sells -
-- the word lives in 0028 and in V1_CONDITION, and nowhere else.
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
    -- V1 SELLS LOOSE ONLY (0029). The projection stops advertising what
    -- the platform will not sell: create_order() and
    -- shop_quantity_available() have refused a non-V1 condition since
    -- 0028, so a boxed row here was a price and an availability flag for
    -- a purchase that could not happen.
    --
    -- The rule is asked for, not restated: public.v1_sale_condition() is
    -- the same function the two commerce functions call. One word, one
    -- place, three doors.
    and i.condition = public.v1_sale_condition()
    and public.is_shop_eligible(i.sky_id)
    -- Something without a price is not an offer, however released it is.
    and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
  order by i.sky_id, i.condition;
$$;

comment on function public.shop_offers() is
  'The public V1 storefront projection. Every position that is released (is_listed), catalog-eligible (is_shop_eligible) and priced - and, since 0029, in the one condition V1 currently sells (v1_sale_condition()). Four values per offer: sky_id, condition, price, available. No stock level, no cost, no note, no inventory id, no seller. Other conditions are NOT removed from the product - boxed stock, boxed order lines and the admin views keep them; they are simply not offered to the public while V1 sells one condition.';


-- ---------------------------------------------------------------------------
-- Privileges - re-stated, not widened
--
-- `create or replace` keeps the existing ACL, so this pair already holds. It
-- is written out because a privilege nobody can see in the migration is a
-- privilege nobody reviews. Character for character the pair from 0008.
-- ---------------------------------------------------------------------------
revoke all on function public.shop_offers() from public;
grant execute on function public.shop_offers() to anon, authenticated;
