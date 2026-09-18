-- ===========================================================================
-- 0052 — the importer gets the catalog it was always documented to get
--
-- WHAT WENT WRONG, IN PRODUCTION, WITH REAL STOCK
--
-- On 2026-09-18 the first real inventory import ran against Production and
-- silently skipped 28 rows as `UNMATCHED_RELEVANT`. Every one of them exists
-- in `skylanders` and every one of them would have matched. They were invisible
-- to the person running the import.
--
-- `fetchImportCatalog()` reads `skylanders` as the SIGNED-IN USER, and the row
-- policy is:
--
--     (is_active and catalog_visible)
--     or public.is_shop_admin()
--     or <the caller owns it in collection_items>
--
-- The exception is `is_shop_admin()`, which since `0041` means
-- `is_platform_admin()`. A Seller Operator is not a platform administrator —
-- `0042` makes the two mutually exclusive on purpose — so the account that
-- actually runs the shop falls through to `catalog_visible`, and 28 hidden
-- `Elite …` rows were not there to match against.
--
-- `src/lib/admin/import-queries.ts` states the intended behaviour directly:
-- "**Every** row, not just the publicly visible ones. A figure hidden from the
-- catalog still has stock, and an importer that could not see it would report
-- the owner's own inventory as unmatched." The comment was right about the
-- consequence and wrong about the code.
--
--
-- WHY NOT SIMPLY ADD `can_operate_active_seller()` TO THE POLICY
--
-- Because the policy governs far more than the importer. `figureBySlug()`
-- carries no `catalog_visible` filter of its own and leans entirely on the
-- policy, and `listFigures()` only adds the filter when the caller does not
-- ask for hidden rows. Widening the policy would let a Seller Operator open
-- any hidden figure while browsing the ordinary catalog — a change to what the
-- shop's own account sees on the public site, made to fix one screen.
--
-- Hidden is an editorial decision about the public catalog (ADR-0039). The
-- importer's need is narrower than that decision and should not overturn it.
--
--
-- WHAT THIS DOES INSTEAD
--
-- One function, for one screen, returning four columns. It can see hidden rows
-- because matching stock requires it; it can see nothing else, and no other
-- query changes. `skylanders_select_authenticated` is untouched, so a Seller
-- Operator browsing the catalog sees exactly what it saw before this
-- migration.
--
-- NO `is_active` FILTER, DELIBERATELY. Two Production figures are retired and
-- two hidden figures hold stock right now. A retired figure with stock on the
-- shelf is precisely the case the importer must be able to reconcile — leaving
-- it out would reproduce the same defect in a smaller shape.
-- ===========================================================================

create or replace function public.seller_import_catalog()
returns table (
  sky_id      text,
  name        text,
  series_code text,
  category    text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- The same predicate every other seller_* function asks, and the same one
  -- the /business route guard asks before rendering the page. A platform
  -- administrator is deliberately NOT admitted: `0042` keeps the two account
  -- types apart, the Business area answers `notFound()` to an administrator,
  -- and a function nobody can reach through the product should not be
  -- callable around it either.
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * Exactly what `classifyRow()` consumes and nothing more: the identity, the
   * name it matches on, the sheet that scopes the match, and the category —
   * which exists only so a row whose category is `Spiele` can be recognised as
   * a game and left alone.
   *
   * No price, no image, no slug, no editorial column. `catalog_editorial`
   * holds the internal notes and is not touched here (ADR-0043).
   */
  return query
    select s.sky_id,
           s.name,
           s.series_code,
           coalesce(c.name, '')
      from public.skylanders s
      left join public.categories c on c.id = s.category_id;
end;
$$;

comment on function public.seller_import_catalog() is
  'The catalog the inventory importer matches against, including rows hidden from the public catalog (0052). Seller operators only. Four columns: identity, name, series and category — nothing a match does not need.';

revoke all on function public.seller_import_catalog() from public, anon;
grant execute on function public.seller_import_catalog() to authenticated;


-- ---------------------------------------------------------------------------
-- What is NOT changed
--
-- `skylanders_select_authenticated` keeps the shape it has had since `0043`.
-- This migration adds a door for one screen; it does not widen the building.
-- A test asserts the policy text is untouched, because the whole argument for
-- this design is that ordinary catalog visibility stays where it was.
-- ---------------------------------------------------------------------------
