-- ===========================================================================
-- 0025 — a sale is called `sale`
--
-- WHAT IS WRONG WITH THE OLD NAME
--
-- `inventory_movements.reason` has carried `sale_skyisles` since 0003 — a
-- brand name used as a domain term. Under ADR-0064 it is simply untrue: when
-- a second merchant sells through SkyIsles one day, SkyIsles is not the
-- seller. And `sale_platform`, `seller_sale` and `marketplace_sale` would all
-- repeat the same mistake one level up: a reason names the EVENT, never the
-- ACTOR (ADR-0065).
--
-- The axis that separates the existing values is the CHANNEL, not the seller —
-- 0003 says so itself: `sale_skyisles` is "sold through the shop",
-- `sale_external` is "sold elsewhere, eBay included". Today the seller is the
-- same person in both. `sale` asserts exactly one thing, and it stays true
-- forever: this was a sale. The channel is recoverable from the data anyway —
-- a `sale` has an order behind it, a `sale_external` has none.
--
-- THE VOCABULARY GROWS. IT DOES NOT REPLACE.
--
-- `reason` sits inside the `is not distinct from` tuple of
-- `prevent_inventory_movement_change()`, so no UPDATE can reach it — not from
-- an administrator, not from the service role. History can never be renamed.
--
-- That is not a limitation here, it is the rule: `sale_skyisles` STAYS a
-- permitted value, permanently. Removing it would fail on the very first
-- `add constraint` against the existing rows, and those rows can never be
-- changed. History says what was true then, and then it was called that.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- No backfill. No UPDATE on any movement. No row is read, written or deleted.
-- `sale_external` is untouched. `apply_inventory_movement()` is untouched. No
-- seller, no seller_id, no seller-scoped structure of any kind — the running
-- implementation stays single-seller (ADR-0064).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The permitted values. `sale` is added; nothing is taken away.
-- ---------------------------------------------------------------------------
alter table public.inventory_movements
  drop constraint if exists inventory_movements_reason_known;

alter table public.inventory_movements
  add constraint inventory_movements_reason_known
    check (reason in (
      'purchase',        -- goods receipt with a known cost
      'sale',            -- sold through this system, by whoever sells here
      'sale_skyisles',   -- HISTORY. The same event, under the name it had
                         -- until 2026-09. Never renameable, never removed
                         -- from this list (ADR-0065).
      'sale_external',   -- sold elsewhere, eBay included — recorded by hand
      'return',          -- either direction, see below
      'correction',      -- a recount, either direction
      'writeoff',        -- damaged, lost
      'initial_import'   -- the start of the SkyIsles ledger, once per position
    ));


-- ---------------------------------------------------------------------------
-- 2. Direction. `sale` behaves exactly as `sale_skyisles` does.
--
-- Rewritten in full rather than patched: a CHECK is one expression, and the
-- `case` has to be replaced as a whole. Every other branch is carried over
-- from 0003 unchanged, `return` and `correction` included — both deliberately
-- allow either direction there, and still do.
-- ---------------------------------------------------------------------------
alter table public.inventory_movements
  drop constraint if exists inventory_movements_delta_direction;

alter table public.inventory_movements
  add constraint inventory_movements_delta_direction
    check (
      case reason
        when 'purchase'       then delta > 0
        when 'initial_import' then delta > 0
        when 'sale'           then delta < 0
        when 'sale_skyisles'  then delta < 0
        when 'sale_external'  then delta < 0
        when 'writeoff'       then delta < 0
        else true
      end
    );

-- `inventory_movements_cost_only_on_purchase` is deliberately NOT touched:
-- `sale` is not `purchase`, so the rule already covers it. A cost on a sale
-- stays impossible.


-- ---------------------------------------------------------------------------
-- 3. The one writer in the whole system.
--
-- The body below is the definition in force from 0010, taken verbatim — not
-- retyped, not reconstructed. Exactly one line differs: the reason handed to
-- `apply_inventory_movement()`. 0012 only CALLS this function (line 635); it
-- never redefined it.
--
-- `create or replace` keeps the existing grants, so the ACL is not restated
-- here and cannot drift.
-- ---------------------------------------------------------------------------
create or replace function public.convert_order_reservations(p_order_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row         record;
  v_movement_id bigint;
  v_converted   integer := 0;
begin
  for v_row in
    select r.id, r.inventory_id, r.quantity, i.sky_id, i.condition
      from public.order_reservations r
      join public.shop_inventory i on i.id = r.inventory_id
     where r.order_id = p_order_id
       and r.state = 'active'
     order by r.inventory_id, r.id
     for update of r
  loop
    -- Claim it first. Whoever wins this UPDATE books the movement; a
    -- concurrent or repeated call gets nothing and does nothing.
    update public.order_reservations
       set state = 'converted', converted_at = now()
     where id = v_row.id
       and state = 'active';

    if not found then
      continue;
    end if;

    -- Release the hold before booking, or the guard below trips on it.
    -- Guarded rather than clamped: if `reserved` cannot cover this
    -- reservation, the transaction rolls back and the reservation stays
    -- `active` with no movement written. A half-converted order — state moved,
    -- nothing sold — is the one outcome that must be impossible.
    update public.shop_inventory
       set reserved = reserved - v_row.quantity
     where id = v_row.inventory_id
       and reserved >= v_row.quantity;

    if not found then
      raise exception
        'reserved on position % is below the reservation being converted (%)',
        v_row.inventory_id, v_row.quantity
        using errcode = 'data_corrupted';
    end if;

    -- The existing internal path: it lowers quantity and writes the
    -- append-only journal entry in one step. No second inventory
    -- architecture, and no actor — this is a system booking.
    v_movement_id := public.apply_inventory_movement(
      v_row.sky_id,
      v_row.condition,
      -v_row.quantity,
      'sale',
      null, null,
      'order ' || p_order_id::text,
      null
    );

    update public.order_reservations
       set movement_id = v_movement_id
     where id = v_row.id;

    v_converted := v_converted + 1;
  end loop;

  return v_converted;
end;
$$;

comment on function public.convert_order_reservations(bigint) is
  'Turns an order''s held stock into a sale: lowers reserved, lowers quantity and writes one `sale` movement per position through the existing journal. Movements booked before 0025 carry the old name `sale_skyisles` and are never rewritten (ADR-0065). Idempotent — the reservation state is claimed under lock, so a repeated call books nothing twice. Only an ACTIVE reservation converts: one that already expired and was released stays released, and the returned count is then lower than the order has lines. The payment phase must compare the two and set needs_resolution rather than oversell.';
