-- ===========================================================================
-- 0069 — `settled`: how something that is not a figure stops being outstanding
-- ===========================================================================
--
-- 0068 made a trophy and two portals count as outstanding work, which they
-- are. It left them with no way to stop: `booked` is the only terminal state
-- and it needs a catalog figure, so a non-catalog item could go
-- `ordered -> arrived` and stay there for good.
--
-- `settled` is that ending. It says "this arrived and is accounted for, and
-- it has no place in figure inventory" — which is the whole truth about a
-- portal.
--
--   figure        Bestellt -> Angekommen -> Einbuchen -> Eingebucht
--   non-figure    Bestellt -> Angekommen -> Erledigt
--
-- THE LOCK IS THE POINT OF THIS MIGRATION
--
-- `settled` creates no movement. If a catalog figure could reach it, it
-- would be a door straight past the inventory ledger: a figure marked
-- `Erledigt`, off the open list, never booked, and the stock silently short
-- by one. So the function refuses it whenever `sky_id is not null`, by
-- looking the row up rather than trusting the caller, and the refusal is
-- tested against a direct RPC call and not only through the screen.
--
-- The check constraint cannot express this on its own — it would have to be
-- `state <> 'settled' or sky_id is null`, which is a second place the rule
-- could drift from the function. It is written once, in the function, and
-- the constraint only widens the vocabulary.
--
-- TERMINAL MEANS "NOT OUTSTANDING", NOT "IRREVERSIBLE"
--
-- `is_open` asks for `ordered` or `arrived`, so `settled` is already outside
-- it and 0068 needs no further change. But nothing irreversible happened —
-- no movement, no stock — so the Quickbox can move the row back out again,
-- exactly as it can with `damaged` and `missing`. `booked` is the only state
-- that has to be reversed rather than overwritten, because it owns a
-- movement, and that bar is unchanged.
--
-- NO INVENTORY, NO STOCK, NO DATA. One constraint, one function. Nothing
-- here writes a row: the three positions this was built for are still
-- `reconciled_legacy` until 0067 runs.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The vocabulary
-- ---------------------------------------------------------------------------

alter table public.purchase_items
  drop constraint if exists purchase_items_state_known;

alter table public.purchase_items
  add constraint purchase_items_state_known
  check (state in ('ordered', 'arrived', 'damaged', 'missing', 'booked',
                   'reconciled_legacy', 'settled'));

comment on column public.purchase_items.state is
  'Where this physical unit stands. `ordered` / `arrived` are outstanding; `booked` owns an inventory movement and is the only state that does; `damaged` and `missing` are endings for a figure that never made it; `settled` (0069) is the ending for something that is not a catalog figure at all — a portal, a trophy — and is refused for any row with a sky_id; `reconciled_legacy` is a workbook line whose stock was reconciled separately and is frozen.';


-- ---------------------------------------------------------------------------
-- 2. The Quickbox, with one more word and one more refusal
-- ---------------------------------------------------------------------------

/*
 * The Quickbox.
 *
 * Every state except `booked` is a statement about a physical object, and the
 * operator may correct any of them freely. `booked` is not one of those: it
 * asserts that a movement exists, so it is reached only by booking and left
 * only by reversing.
 *
 * `settled` (0069) is a statement about a physical object too, and the same
 * freedom applies — but only for an object that has no place in figure
 * inventory. See the guard below.
 */
create or replace function public.seller_set_purchase_item_state(
  p_item_id bigint,
  p_state   text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_sky     text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if p_state not in ('ordered', 'arrived', 'damaged', 'missing', 'settled') then
    raise exception 'this state is not one the Quickbox may set'
      using errcode = 'check_violation';
  end if;

  select state, sky_id into v_current, v_sky
    from public.purchase_items where id = p_item_id for update;
  if v_current is null then
    raise exception 'no such purchase item' using errcode = 'no_data_found';
  end if;
  if v_current = 'booked' then
    raise exception 'this item is in inventory; reverse the booking first'
      using errcode = 'restrict_violation';
  end if;
  if v_current = 'reconciled_legacy' then
    raise exception 'a historical item is a record of what happened and does not change state'
      using errcode = 'restrict_violation';
  end if;

  /*
   * THE LOCK. A catalog figure is never `settled`.
   *
   * `settled` closes a position without a movement. For a portal that is the
   * truth; for a figure it would be a way past the inventory ledger — off
   * the open list, never booked, stock short by one and nothing to show for
   * it. `Einbuchen` is the only ending a figure has.
   *
   * Read from the row, not from the caller: an RPC client chooses the item
   * and the state, never whether the item is a figure.
   */
  if p_state = 'settled' and v_sky is not null then
    raise exception 'a catalog figure is booked into inventory, never settled'
      using errcode = 'check_violation';
  end if;

  update public.purchase_items
     set state = p_state, updated_at = now()
   where id = p_item_id;
end;
$$;

comment on function public.seller_set_purchase_item_state(bigint, text) is
  'Move one purchase item between the states a person may set: ordered, arrived, damaged, missing, and settled (0069). `booked` is not among them — it owns an inventory movement and is reached only by seller_book_purchase_item — and neither is `reconciled_legacy`. `settled` is refused for any row that has a sky_id: a catalog figure leaves the open list by being booked, never by being filed away.';

/*
 * `create or replace` keeps the grants this function already had; these two
 * restate them so the file says who may call it without anyone having to
 * open 0053 to find out. Same form as there: nothing for `public` or `anon`,
 * execute for `authenticated` — and the function itself asks
 * `can_operate_active_seller()` before it does anything.
 */
revoke all on function public.seller_set_purchase_item_state(bigint, text) from public, anon;
grant execute on function public.seller_set_purchase_item_state(bigint, text) to authenticated;
