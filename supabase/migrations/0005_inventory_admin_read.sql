-- ===========================================================================
-- 0005 — reading the stock as an administrator
--
-- The shop foundation (0003) gave administrators a complete WRITE surface and
-- deliberately no table privileges at all:
--
--   record_inventory_movement()  books a movement, creates the position
--   set_shop_listing()           price, listing flag, internal note
--   system_record_…()            service role only
--
-- and `revoke all on shop_inventory, inventory_movements from anon,
-- authenticated`. That is right — a table grant would open every column and
-- every row to anyone signed in, and purchase prices, suppliers and stock
-- levels are exactly what docs/SECURITY.md keeps internal.
--
-- The consequence, found when the stock UI was built: an administrator cannot
-- READ their own stock either. The reconciliation view does not help — it is
-- `security_invoker`, so it inherits the caller's (absent) privileges by
-- design.
--
-- This migration adds the missing half, in the same shape as the write half:
-- two security-definer functions that ask public.is_shop_admin() themselves.
-- No table privilege is granted, no policy is added, and nothing existing is
-- altered.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The stock, as an administrator sees it
--
-- Inventory columns only. The figure behind a position — name, image, series,
-- market price — comes from the catalog the application already loads, so
-- this function neither joins nor duplicates the catalog's rules about which
-- figures are collectible and which are visible.
--
-- `available` is the stored generated column, not a second definition.
-- ---------------------------------------------------------------------------
create or replace function public.admin_shop_inventory()
returns table (
  inventory_id bigint,
  sky_id       text,
  condition    text,
  quantity     integer,
  reserved     integer,
  available    integer,
  sale_price   numeric,
  is_listed    boolean,
  note         text,
  updated_at   timestamptz
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
           i.available_quantity, i.sale_price, i.is_listed, i.note, i.updated_at
      from public.shop_inventory i
     order by i.sky_id, i.condition;
end;
$$;

comment on function public.admin_shop_inventory() is
  'Every stock position, for a shop administrator. The only read path: clients hold no privilege on shop_inventory (ADR-0037).';


-- ---------------------------------------------------------------------------
-- 2. The journal of one position
--
-- Newest first, capped. Append-only in the database and read-only here:
-- there is no function that edits or deletes a movement, and none will be —
-- a wrong booking is answered with a `correction`, not with an eraser.
-- ---------------------------------------------------------------------------
create or replace function public.admin_inventory_movements(
  p_inventory_id bigint,
  p_limit        integer default 20
)
returns table (
  id         bigint,
  delta      integer,
  reason     text,
  unit_cost  numeric,
  currency   text,
  note       text,
  created_at timestamptz
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
    select m.id, m.delta, m.reason, m.unit_cost, m.currency, m.note, m.created_at
      from public.inventory_movements m
     where m.inventory_id = p_inventory_id
     order by m.created_at desc, m.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 200);
end;
$$;

comment on function public.admin_inventory_movements(bigint, integer) is
  'The recent movements of one stock position, for a shop administrator. Read-only: movements are append-only (ADR-0037) and no function edits or deletes one.';


-- ---------------------------------------------------------------------------
-- 3. Privileges
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so the REVOKE is
-- required rather than decorative. `authenticated` gets EXECUTE and meets the
-- is_shop_admin() check inside; anon gets nothing at all.
--
-- Deliberately unchanged: shop_inventory and inventory_movements keep no
-- privileges for any client role, and no policy is added to either.
-- ---------------------------------------------------------------------------
revoke all on function public.admin_shop_inventory()                     from public, anon;
revoke all on function public.admin_inventory_movements(bigint, integer) from public, anon;

grant execute on function public.admin_shop_inventory()                     to authenticated;
grant execute on function public.admin_inventory_movements(bigint, integer) to authenticated;
