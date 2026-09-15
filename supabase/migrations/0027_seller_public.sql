-- ===========================================================================
-- 0027 — the seller's trade name becomes readable
--
-- WHY
--
-- A customer buying on SkyIsles is told what they are buying but not who from.
-- The quick view over the catalogue lists an offer with a condition, a price
-- and a buy button, and the one thing a shop must always say — who the
-- contract is with — is the one thing the browser cannot reach.
--
-- Not because it is secret. `sellers.display_name` is commented "PUBLIC. The
-- seller's trade name, as customers know it." (0026), it is on every order
-- mail and it belongs in the Impressum by law. It is unreachable because 0026
-- built the table, the writer and the admin reader, and left the public
-- projection for the day something needed it. That day is now.
--
-- WHAT THIS IS, PRECISELY
--
-- One allow-list function, and a grant. Nothing else changes: `sellers` keeps
-- its row level security and its revoke, `active_seller()` stays revoked from
-- everybody, `admin_seller()` stays gated on `is_shop_admin()`, and
-- `shop_offers()` is not touched.
--
-- WHAT THIS IS NOT — READ THIS BEFORE BUILDING ON IT
--
-- This is an IDENTITY, not a RELATION. `seller_public()` answers "who sells on
-- SkyIsles", not "who sells this article". No table gained a `seller_id`,
-- `shop_inventory` is unchanged, and an offer is not joined to a seller — it
-- cannot be, because `sellers_one_active` (0026) guarantees there is exactly
-- one to join to.
--
-- So the `id` this returns is the key a future relation would hang off, and
-- today it is a constant. Anybody reading `seller.id` in the quick view and
-- concluding that SkyIsles supports several sellers would be wrong: the
-- marketplace stop of ADR-0021 stands, single-seller is still the running
-- implementation, and the real offer→seller relation arrives with the second
-- seller and not before (ADR-0064).
--
-- ROLLBACK
--
--   drop function if exists public.seller_public();
--
-- Additive, so that is the whole of it: no column, no constraint, no data.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The projection
--
-- `security definer` because `sellers` is revoked from anon and authenticated
-- and carries row level security with no policy for either — the same reason
-- `shop_offers()` is definer over `shop_inventory`.
--
-- The column list is written out. Never `select s.*`: that is exactly what
-- `active_seller()` does, and it is why `active_seller()` is revoked from
-- everybody. A column added to `sellers` tomorrow — a tax number, an address,
-- a payout account — is invisible here until somebody names it on purpose
-- (ADR-0059).
-- ---------------------------------------------------------------------------
create or replace function public.seller_public()
returns table (
  id           bigint,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Only the active seller. A deactivated one is kept because orders were
  -- placed with them (0026), and none of those orders is a reason to keep
  -- naming them on the shop surface.
  select s.id, s.display_name
    from public.sellers s
   where s.is_active
$$;

comment on function public.seller_public() is
  'The identity of the seller who is currently selling on SkyIsles: id and trade name, nothing else. An allow-list that names its columns literally, so a column added to sellers later stays invisible until somebody lists it (ADR-0059). Contact address, Reply-To, updated_by and the timestamps are NOT published here. This is an identity, not a relation: no table carries a seller_id, and an offer is not joined to a seller — sellers_one_active guarantees there is exactly one. Multi-seller is not implemented (ADR-0021, ADR-0064).';


-- ---------------------------------------------------------------------------
-- The grant — the first thing on the seller that a visitor may call
--
-- `anon` as well as `authenticated`: the catalogue is public (ADR-0025), and
-- who sells the goods is not a fact that waits for a login.
-- ---------------------------------------------------------------------------
revoke all on function public.seller_public() from public;
grant  execute on function public.seller_public() to anon, authenticated;
