-- ===========================================================================
-- 0054 — correcting what a purchase item is
--
-- WHY A NEW FILE. `0053` is applied to Staging. An applied migration is never
-- rewritten, so the correction is additive and takes the next number.
--
--
-- THE GAP THE PILOT FOUND
--
-- The first historical purchase resolved 14 of 14 shorthand names through the
-- workbook's own formula references. It will not always. With 444 names still
-- to come, an operator who spots a wrong mapping could only fix it by deleting
-- the row and adding it again — which destroys the raw Excel text, the source
-- row and the legacy markers, i.e. exactly the provenance the import exists to
-- keep.
--
-- So: one function that changes the catalog identity and nothing else.
--
--
-- CLASSIFICATION IS NOT HISTORY
--
-- `raw_name` is what the workbook said. It never changes, because it is
-- evidence: `Bob` stays `Bob` even once the row points at `Mini Bop`. The same
-- for `source_row`, the legacy C and D markers and the purchase's import
-- fingerprint. What the operator is correcting is our reading of the evidence,
-- not the evidence.
--
--
-- A BOOKED ITEM IS NOT CORRECTABLE HERE
--
-- Once a unit owns an `inventory_movement`, that movement names the figure
-- that actually went on the shelf. Repointing the purchase row would leave the
-- two disagreeing about the same physical object, and silently reversing and
-- rebooking would move stock as a side effect of an edit. Refused, with the
-- reversal offered as the explicit alternative.
--
-- A historical item is safe precisely because it owns no movement: `0053`
-- imports every row as `reconciled_legacy` with `movement_id` NULL, so nothing
-- about stock depends on what it points at.
--
--
-- AND THE STATE DOES NOT MOVE
--
-- Whether we know which figure a row is, and whether the row is historical,
-- are independent questions. `reconciled_legacy` with a `sky_id` and
-- `reconciled_legacy` without one are both valid and both create no movement.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Remembering a resolution
--
-- ITS OWN TABLE, NOT `inventory_import_mappings`. That one is keyed by
-- (sheet, normalised_name) because the stock workbook puts every figure on the
-- sheet of its game — the sheet IS half the identity. `Order 2026!A:I` has no
-- such column, so a purchase mapping can only be keyed by the text, which is
-- strictly weaker evidence. Storing the two in one table would hide that
-- difference behind a shared name.
--
-- Its `ignored` flag differs too: there it means "never import this line", here
-- the equivalent is "this is a portal, not a figure" — an item that still
-- exists and still cost money.
-- ---------------------------------------------------------------------------

create table if not exists public.orderbook_name_mappings (
  id bigint generated always as identity primary key,

  -- The workbook text, normalised. No sheet: A:I does not carry one.
  normalised_name text not null,

  -- The figure, or NULL together with `not_a_figure` for a portal or a game.
  sky_id text,
  not_a_figure boolean not null default false,

  -- What the operator last saw it written as, for the admin list.
  sample_raw_name text,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orderbook_name_mappings_unique unique (normalised_name),
  constraint orderbook_name_mappings_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id) on update cascade on delete cascade,
  constraint orderbook_name_mappings_created_by_fk foreign key (created_by)
    references auth.users (id) on delete set null,
  constraint orderbook_name_mappings_name_shape
    check (length(btrim(normalised_name)) between 1 and 200),
  -- Exactly one of the two answers, like its counterpart in 0048.
  constraint orderbook_name_mappings_resolved
    check (not_a_figure = (sky_id is null))
);

comment on table public.orderbook_name_mappings is
  'Remembered resolutions for legacy purchase names (0054). Keyed by the normalised text alone, because Order 2026!A:I carries no sheet — which is why a saved mapping ranks BELOW a formula-derived identity, never above it.';

alter table public.orderbook_name_mappings enable row level security;
revoke all on table public.orderbook_name_mappings from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. The same normalisation the client uses
--
-- Written here as well so a mapping saved by the function and a mapping looked
-- up by the importer agree on what "the same name" means.
-- ---------------------------------------------------------------------------

create or replace function public.orderbook_normalise(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
           replace(lower(coalesce(p_name, '')), '&', 'and'),
           '[^a-z0-9]+', ' ', 'g'));
$$;

comment on function public.orderbook_normalise(text) is
  'Loose comparison key for a legacy purchase name (0054). Mirrors normalise() in src/lib/orderbook/order-2026.ts.';


-- ---------------------------------------------------------------------------
-- 3. Changing what an item is
--
-- Three directions, one function:
--
--     figure A -> figure B     a mis-resolved shorthand
--     NULL     -> figure       an uncategorised row identified
--     figure   -> NULL         a portal that was wrongly called a Skylander
--
-- `p_sky_id` NULL is the third case and is not a "leave alone" default — it is
-- the instruction. That is why there is no optional-argument pattern here.
--
-- NO SNAPSHOT IS WRITTEN. A historical row carries no frozen price, so after a
-- remap it reads the new figure's live catalog price and the purchase's
-- Marktwert and Faktor move with it. Freezing a price because a mapping
-- changed would invent a booking that never happened.
-- ---------------------------------------------------------------------------

create or replace function public.seller_set_purchase_item_sky(
  p_item_id bigint,
  p_sky_id  text,
  p_remember boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item record;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.purchase_items where id = p_item_id for update;
  if not found then
    raise exception 'no such purchase item' using errcode = 'no_data_found';
  end if;

  /*
   * The movement names the figure that entered stock. Repointing the row would
   * leave them describing different objects, and reversing-and-rebooking would
   * move stock as a side effect of an edit.
   */
  if v_item.movement_id is not null then
    raise exception 'this item is in inventory; reverse the booking before changing which figure it is'
      using errcode = 'restrict_violation';
  end if;

  -- An item with no catalog identity must still be identifiable.
  if p_sky_id is null
     and nullif(btrim(coalesce(v_item.raw_name, '')), '') is null then
    raise exception 'this item has no name of its own and cannot become uncategorised'
      using errcode = 'check_violation';
  end if;

  update public.purchase_items
     set sky_id = p_sky_id,
         -- Deliberately untouched: raw_name, source_row, legacy flags, state,
         -- position, condition. Classification changes; history does not.
         updated_at = now()
   where id = p_item_id;

  if p_remember and v_item.raw_name is not null then
    insert into public.orderbook_name_mappings (
      normalised_name, sky_id, not_a_figure, sample_raw_name, created_by
    ) values (
      public.orderbook_normalise(v_item.raw_name), p_sky_id, p_sky_id is null,
      v_item.raw_name, (select auth.uid())
    )
    on conflict (normalised_name) do update
      set sky_id = excluded.sky_id,
          not_a_figure = excluded.not_a_figure,
          sample_raw_name = excluded.sample_raw_name,
          updated_at = now();
  end if;
end;
$$;

comment on function public.seller_set_purchase_item_sky(bigint, text, boolean) is
  'Corrects which catalog figure a purchase item is, in either direction including to none (0054). Never touches raw_name, source row, legacy markers or state, never moves stock, and refuses an item that already owns an inventory movement.';

revoke all on function public.seller_set_purchase_item_sky(bigint, text, boolean) from public, anon;
grant execute on function public.seller_set_purchase_item_sky(bigint, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Reading and writing the remembered resolutions
-- ---------------------------------------------------------------------------

create or replace function public.seller_orderbook_mappings()
returns table (
  normalised_name text, sky_id text, not_a_figure boolean, sample_raw_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  return query
    select m.normalised_name, m.sky_id, m.not_a_figure, m.sample_raw_name
      from public.orderbook_name_mappings m
     order by m.normalised_name
     limit 2000;
end;
$$;

revoke all on function public.seller_orderbook_mappings() from public, anon;
grant execute on function public.seller_orderbook_mappings() to authenticated;
