-- ===========================================================================
-- 0053 — Orderbuch: the purchase side
--
-- WHAT THIS IS. A record of what the shop BOUGHT: one row per purchase, one
-- row per physical thing in it. It is business provenance, not a second stock
-- ledger — `inventory_movements` stays the only authority on how much is on
-- the shelf, and the only way a purchase reaches it is `record_inventory_
-- movement()`, the same function every other write already uses.
--
-- NO `seller_id`, ANYWHERE. `shop_inventory` has none and neither does this.
-- SkyIsles is single-seller by decision (ADR-0021), ownership follows from the
-- one active seller, and two guard tests fail any migration that introduces
-- the column outside the membership tables. Authorization is
-- `can_operate_active_seller()`, exactly as for stock.
--
--
-- ONE ROW PER PHYSICAL UNIT, NOT A QUANTITY COLUMN
--
-- Three copies of the same figure arrive in one parcel: one is fine, one is
-- scratched, one never turned up. They are inspected separately, accepted
-- separately, and each accepted one becomes its own `+1` movement. A quantity
-- column would need a per-unit state table beside it to say any of that, which
-- is this table with an extra join. It also gives every unit its own
-- `movement_id`, and that is what makes double-booking impossible rather than
-- merely unlikely.
--
--
-- THE MARKET PRICE FLOATS UNTIL IT IS ACCEPTED, THEN IT STOPS
--
-- Weeks pass between paying for a parcel and opening it. Until an item is
-- booked, what it is worth is a live question and the Orderbuch answers it
-- from `skylanders.market_price`, so a figure that appreciated between order
-- and arrival shows the new number. The moment the operator accepts it, the
-- answer becomes a fact about that acceptance and is frozen onto the row —
-- inside the same transaction that creates the movement, so the price and the
-- stock always agree about when it happened.
--
-- The workbook this replaces got that backwards: its `G` column is a live
-- formula into the price sheets, so every historical purchase silently
-- rewrites its own factor whenever a price moves.
--
--
-- NO ACQUISITION COST PER UNIT — YET
--
-- What is observed is one total. Splitting it across units in proportion to
-- market value is arithmetic, not evidence, and writing it into
-- `unit_cost` would dress a guess as a fact. `record_inventory_movement()`
-- accepts NULL cost on a `purchase` row (21 such rows already exist), so the
-- movement records that a unit was bought without claiming what that unit
-- cost. Verkauf will need an answer; it can decide with its own requirements
-- in front of it.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The purchase
-- ---------------------------------------------------------------------------

create table if not exists public.purchases (
  id bigint generated always as identity primary key,

  -- The day money left. Date, not timestamp: a parcel is bought on a day.
  purchased_at date not null,

  -- What was actually paid, in total. The one observed cost fact.
  total_cost numeric(10,2) not null,
  currency   text not null default 'EUR',

  -- Where the row came from, which decides how much of it may be edited and
  -- whether its items were ever expected to produce movements.
  source text not null default 'manual',

  external_ref text,
  note         text,

  -- Set by the historical importer so the same workbook group cannot land
  -- twice. NULL for anything created by hand.
  import_fingerprint text,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,

  constraint purchases_source_known check (source in ('manual', 'excel_order_2026')),
  constraint purchases_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint purchases_cost_sane    check (total_cost >= 0 and total_cost <= 1000000),
  constraint purchases_note_shape   check (note is null or length(btrim(note)) > 0),
  constraint purchases_ref_shape    check (external_ref is null or length(btrim(external_ref)) between 1 and 120),
  constraint purchases_fingerprint_shape
    check (import_fingerprint is null or import_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint purchases_created_by_fk foreign key (created_by) references auth.users (id) on delete set null,
  constraint purchases_updated_by_fk foreign key (updated_by) references auth.users (id) on delete set null
);

-- One workbook group, one purchase. Partial, so hand-made rows are unaffected.
create unique index if not exists purchases_import_fingerprint_uniq
  on public.purchases (import_fingerprint) where import_fingerprint is not null;

create index if not exists purchases_purchased_at_idx
  on public.purchases (purchased_at desc);

comment on table public.purchases is
  'One purchase: what was paid, when, and where the record came from (ADR-0088). Business provenance — stock lives in inventory_movements.';


-- ---------------------------------------------------------------------------
-- 2. One physical thing
--
-- `sky_id` is NULLABLE ON PURPOSE. A parcel contains portals, games and
-- accessories that the figure catalog does not model, and the money spent on
-- them is still part of the purchase. Forcing every row to resolve would mean
-- either inventing catalog entries or throwing the cost away; the row keeps
-- its `raw_name` and simply cannot be booked into figure inventory.
-- ---------------------------------------------------------------------------

create table if not exists public.purchase_items (
  id bigint generated always as identity primary key,
  purchase_id bigint not null,

  -- Display order, and the workbook's own item number on import.
  position integer not null default 1,

  -- The catalog identity, or NULL for something the catalog does not model.
  sky_id    text,
  condition text not null default 'loose',

  -- What the source called it. Provenance for an import, the label for an
  -- uncategorised row, and the only name a NULL sky_id has.
  raw_name text,

  state text not null default 'ordered',

  -- Frozen at acceptance, never before. NULL while the item is still live —
  -- the reader substitutes the catalog price for those.
  market_price_snapshot    numeric(10,2),
  market_price_snapshot_at timestamptz,
  market_price_source      text,

  -- The proof that this unit entered stock, and the reason it can only do so
  -- once. RESTRICT because deleting the row would orphan the movement.
  movement_id bigint,

  -- The legacy workbook's own two markers, kept as context. They describe what
  -- the old spreadsheet believed; they never drive behaviour here.
  legacy_condition_flag text,
  legacy_booked_flag    text,
  source_row integer,

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint purchase_items_purchase_fk foreign key (purchase_id)
    references public.purchases (id) on delete cascade,
  constraint purchase_items_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id) on update cascade on delete restrict,
  constraint purchase_items_movement_fk foreign key (movement_id)
    references public.inventory_movements (id) on delete restrict,

  constraint purchase_items_state_known
    check (state in ('ordered', 'arrived', 'damaged', 'missing', 'booked', 'reconciled_legacy')),
  constraint purchase_items_condition_known
    check (condition in ('loose', 'boxed')),

  /*
   * BOOKED MEANS A MOVEMENT EXISTS, AND A MOVEMENT MEANS BOOKED.
   *
   * Stated as an equivalence so neither half can drift: no row can claim to be
   * in stock without pointing at the movement that put it there, and no
   * movement can be owned by a row that calls itself something else.
   */
  constraint purchase_items_booked_has_movement
    check ((state = 'booked') = (movement_id is not null)),

  -- Only something the catalog knows can enter the catalog's inventory.
  constraint purchase_items_movement_needs_sky
    check (movement_id is null or sky_id is not null),

  -- A price without a time is not a snapshot.
  constraint purchase_items_snapshot_pairs
    check ((market_price_snapshot is null) = (market_price_snapshot_at is null)),
  constraint purchase_items_snapshot_source_known
    check (market_price_source is null or market_price_source in ('booking', 'manual')),

  -- An uncategorised row is identified by its text, so it must have some.
  constraint purchase_items_named
    check (sky_id is not null or (raw_name is not null and length(btrim(raw_name)) > 0)),
  constraint purchase_items_raw_shape
    check (raw_name is null or length(btrim(raw_name)) between 1 and 200),
  constraint purchase_items_legacy_shape
    check ((legacy_condition_flag is null or length(legacy_condition_flag) <= 4)
       and (legacy_booked_flag    is null or length(legacy_booked_flag)    <= 4))
);

-- The movement belongs to exactly one purchase item.
create unique index if not exists purchase_items_movement_uniq
  on public.purchase_items (movement_id) where movement_id is not null;

create index if not exists purchase_items_purchase_idx on public.purchase_items (purchase_id, position);
create index if not exists purchase_items_sky_idx on public.purchase_items (sky_id) where sky_id is not null;

comment on table public.purchase_items is
  'One physical thing in a purchase (ADR-0088). sky_id is NULL for portals, games and accessories the figure catalog does not model — their cost still belongs to the purchase. state = ''booked'' if and only if movement_id names the inventory movement that put it on the shelf.';

comment on column public.purchase_items.market_price_snapshot is
  'The catalog market price at the moment this unit was accepted into inventory. NULL while the item is still open, where the reader substitutes the live catalog price instead (ADR-0088).';

comment on column public.purchase_items.legacy_booked_flag is
  'Column D of the legacy workbook: whether the old spreadsheet had entered this figure into its own inventory. Context only — it never creates a movement here, because current stock was reconciled separately.';


-- ---------------------------------------------------------------------------
-- 3. Locked down
-- ---------------------------------------------------------------------------

alter table public.purchases        enable row level security;
alter table public.purchase_items   enable row level security;
revoke all on table public.purchases      from public, anon, authenticated;
revoke all on table public.purchase_items from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. What a purchase is worth, right now
--
-- Mixed by design: a booked unit reports the price it was accepted at, an open
-- one reports what the catalog says today. `known_items` is what makes the
-- difference visible — a factor computed over 12 of 14 items is not the same
-- statement as one computed over all of them, and the screen has to be able to
-- say so rather than quietly averaging a smaller number.
-- ---------------------------------------------------------------------------

create or replace function public.purchase_market_value(p_purchase_id bigint)
returns table (
  known_value  numeric,
  known_items  integer,
  total_items  integer,
  booked_items integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(coalesce(i.market_price_snapshot, s.market_price)), 0)::numeric,
    count(*) filter (where coalesce(i.market_price_snapshot, s.market_price) is not null)::integer,
    count(*)::integer,
    count(*) filter (where i.state = 'booked')::integer
  from public.purchase_items i
  left join public.skylanders s on s.sky_id = i.sky_id
 where i.purchase_id = p_purchase_id
   -- A unit that never arrived is not part of what the parcel is worth.
   and i.state <> 'missing';
$$;

comment on function public.purchase_market_value(bigint) is
  'Market value of one purchase: frozen for booked units, live catalog price for open ones, and the count of units whose value is known at all (ADR-0088).';

revoke all on function public.purchase_market_value(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Reading the ledger
-- ---------------------------------------------------------------------------

create or replace function public.seller_purchases(
  p_year  integer default null,
  p_month integer default null
)
returns table (
  id bigint, purchased_at date, total_cost numeric, currency text,
  source text, external_ref text, note text,
  item_count integer, booked_count integer, open_count integer,
  known_value numeric, known_items integer, factor numeric
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
    select p.id, p.purchased_at, p.total_cost, p.currency,
           p.source, p.external_ref, p.note,
           v.total_items, v.booked_items, (v.total_items - v.booked_items),
           v.known_value, v.known_items,
           -- NULL rather than a division by zero: "no market value known" is
           -- not the same claim as "worth nothing".
           case when v.known_value > 0 then round(p.total_cost / v.known_value, 4) end
      from public.purchases p
      cross join lateral public.purchase_market_value(p.id) v
     where (p_year  is null or extract(year  from p.purchased_at) = p_year)
       and (p_month is null or extract(month from p.purchased_at) = p_month)
     order by p.purchased_at desc, p.id desc
     limit 500;
end;
$$;

create or replace function public.seller_purchase(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'purchase', to_jsonb(p) - 'created_by' - 'updated_by',
    'value', to_jsonb(val),
    'factor', case when val.known_value > 0 then round(p.total_cost / val.known_value, 4) end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'position', i.position, 'sky_id', i.sky_id,
        'name', coalesce(s.name, i.raw_name), 'raw_name', i.raw_name,
        'series_code', s.series_code, 'condition', i.condition, 'state', i.state,
        -- One field for the screen: frozen when frozen, live when live.
        'market_price', coalesce(i.market_price_snapshot, s.market_price),
        'price_is_frozen', i.market_price_snapshot is not null,
        'market_price_snapshot_at', i.market_price_snapshot_at,
        'movement_id', i.movement_id,
        'legacy_condition_flag', i.legacy_condition_flag,
        'legacy_booked_flag', i.legacy_booked_flag,
        'note', i.note
      ) order by i.position, i.id)
      from public.purchase_items i
      left join public.skylanders s on s.sky_id = i.sky_id
     where i.purchase_id = p.id), '[]'::jsonb)
  ) into v
  from public.purchases p
  cross join lateral public.purchase_market_value(p.id) val
  where p.id = p_id;

  return v;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Writing it
-- ---------------------------------------------------------------------------

create or replace function public.seller_create_purchase(
  p_purchased_at date,
  p_total_cost   numeric,
  p_note         text default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  insert into public.purchases (purchased_at, total_cost, note, created_by, updated_by)
  values (p_purchased_at, p_total_cost, nullif(btrim(coalesce(p_note, '')), ''),
          (select auth.uid()), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.seller_update_purchase(
  p_id           bigint,
  p_purchased_at date    default null,
  p_total_cost   numeric default null,
  p_note         text    default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  update public.purchases p set
    purchased_at = coalesce(p_purchased_at, p.purchased_at),
    total_cost   = coalesce(p_total_cost, p.total_cost),
    note         = case when p_note is null then p.note
                        else nullif(btrim(p_note), '') end,
    updated_at   = now(),
    updated_by   = (select auth.uid())
  where p.id = p_id;
end;
$$;

/*
 * Adding a thing.
 *
 * `p_sky_id` NULL is the uncategorised case and needs a name instead. No price
 * is written: an open item reads the catalog live, and freezing here is exactly
 * the mistake the workbook made.
 */
create or replace function public.seller_add_purchase_item(
  p_purchase_id bigint,
  p_sky_id      text default null,
  p_raw_name    text default null,
  p_condition   text default 'loose'
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_id bigint; v_pos integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if p_sky_id is null and nullif(btrim(coalesce(p_raw_name, '')), '') is null then
    raise exception 'an item needs either a catalog figure or a name'
      using errcode = 'check_violation';
  end if;

  select coalesce(max(position), 0) + 1 into v_pos
    from public.purchase_items where purchase_id = p_purchase_id;

  insert into public.purchase_items (purchase_id, position, sky_id, raw_name, condition)
  values (p_purchase_id, v_pos, p_sky_id,
          nullif(btrim(coalesce(p_raw_name, '')), ''), coalesce(p_condition, 'loose'))
  returning id into v_id;
  return v_id;
end;
$$;

/*
 * Removing one.
 *
 * Refused once it owns a movement. The foreign key would refuse it anyway;
 * this says why in a sentence a person can act on.
 */
create or replace function public.seller_remove_purchase_item(p_item_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_movement bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select movement_id into v_movement from public.purchase_items where id = p_item_id;
  if v_movement is not null then
    raise exception 'this item is already in inventory; reverse the booking before removing it'
      using errcode = 'restrict_violation';
  end if;
  delete from public.purchase_items where id = p_item_id;
end;
$$;

/*
 * The Quickbox.
 *
 * Every state except `booked` is a statement about a physical object, and the
 * operator may correct any of them freely. `booked` is not one of those: it
 * asserts that a movement exists, so it is reached only by booking and left
 * only by reversing.
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
declare v_current text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if p_state not in ('ordered', 'arrived', 'damaged', 'missing') then
    raise exception 'this state is not one the Quickbox may set'
      using errcode = 'check_violation';
  end if;

  select state into v_current from public.purchase_items where id = p_item_id for update;
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

  update public.purchase_items
     set state = p_state, updated_at = now()
   where id = p_item_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. Einbuchen — accepting one physical unit into stock
--
-- The whole feature turns on this function, so it is worth saying exactly what
-- each step is defending against.
--
-- ONE TRANSACTION. A plpgsql function body is one transaction: the movement
-- and the state change and the frozen price either all land or none do. There
-- is no window in which stock has moved but the Orderbuch does not know it.
--
-- `FOR UPDATE` IS THE CONCURRENCY ANSWER. Two taps on a phone, or a tap and a
-- retry, arrive as two transactions. The first locks the row; the second waits,
-- then re-reads it and finds `booked`. It does not queue a second movement —
-- it returns the first one's id.
--
-- AN ALREADY-BOOKED ITEM IS NOT AN ERROR. A retry that finds the work done is
-- the system behaving correctly, so it returns the existing `movement_id`
-- rather than raising. The caller cannot tell a slow success from a replay,
-- which is what makes the button safe to press twice.
--
-- THE PRICE IS READ HERE, NOT EARLIER. Reading it inside the same transaction
-- is what makes `market_price_snapshot_at` true: the price and the movement
-- describe the same instant.
--
-- `unit_cost` IS NULL. Deliberately — see the header. The constraint
-- `inventory_movements_cost_only_on_purchase` permits it, and 21 rows on
-- Production already look exactly like this.
-- ---------------------------------------------------------------------------

create or replace function public.seller_book_purchase_item(p_item_id bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item  record;
  v_price numeric;
  v_mid   bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.purchase_items where id = p_item_id for update;
  if not found then
    raise exception 'no such purchase item' using errcode = 'no_data_found';
  end if;

  -- Already done. Hand back the movement that did it.
  if v_item.state = 'booked' then
    return v_item.movement_id;
  end if;

  if v_item.state = 'reconciled_legacy' then
    raise exception 'a historical purchase item is already reflected in stock and is never booked again'
      using errcode = 'restrict_violation';
  end if;
  if v_item.sky_id is null then
    raise exception 'this item is not a catalog figure and cannot enter figure inventory'
      using errcode = 'check_violation';
  end if;
  if v_item.state = 'damaged' then
    raise exception 'a damaged item does not enter sellable stock; set it to arrived first if it is in fact fine'
      using errcode = 'check_violation';
  end if;
  if v_item.state = 'missing' then
    raise exception 'an item that never arrived cannot be booked'
      using errcode = 'check_violation';
  end if;

  -- The freeze, read in the same breath as the movement below.
  select s.market_price into v_price from public.skylanders s where s.sky_id = v_item.sky_id;

  v_mid := public.record_inventory_movement(
    v_item.sky_id, v_item.condition, 1, 'purchase',
    null, null,                                  -- no invented per-unit cost
    'Orderbuch Einkauf #' || v_item.purchase_id || ' Pos. ' || v_item.position
  );

  update public.purchase_items
     set state = 'booked',
         movement_id = v_mid,
         market_price_snapshot = v_price,
         market_price_snapshot_at = case when v_price is null then null else now() end,
         market_price_source = case when v_price is null then null else 'booking' end,
         updated_at = now()
   where id = p_item_id;

  return v_mid;
end;
$$;

/*
 * Undoing one.
 *
 * A compensating `-1 correction`, never a delete: the purchase movement stays
 * in the ledger because it happened, and a second movement says it was undone.
 * The same shape `admin_revert_sandbox_stock()` already uses.
 *
 * The frozen price is cleared with it — the item is open again, so its value
 * is a live question again.
 */
create or replace function public.seller_unbook_purchase_item(p_item_id bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_mid  bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.purchase_items where id = p_item_id for update;
  if not found then
    raise exception 'no such purchase item' using errcode = 'no_data_found';
  end if;
  if v_item.state <> 'booked' then
    raise exception 'this item is not in inventory' using errcode = 'restrict_violation';
  end if;

  v_mid := public.record_inventory_movement(
    v_item.sky_id, v_item.condition, -1, 'correction', null, null,
    'Orderbuch Einkauf #' || v_item.purchase_id || ' Pos. ' || v_item.position || ' zurückgenommen'
  );

  update public.purchase_items
     set state = 'arrived',
         movement_id = null,
         market_price_snapshot = null,
         market_price_snapshot_at = null,
         market_price_source = null,
         updated_at = now()
   where id = p_item_id;

  return v_mid;
end;
$$;

create or replace function public.seller_delete_purchase(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_booked integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into v_booked from public.purchase_items
   where purchase_id = p_id and movement_id is not null;
  if v_booked > 0 then
    raise exception 'this purchase has % item(s) in inventory; reverse those bookings first', v_booked
      using errcode = 'restrict_violation';
  end if;
  delete from public.purchases where id = p_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. Grants
--
-- Every function checks `can_operate_active_seller()` in its own body, so the
-- grant is not the authorization — it is only what lets PostgREST see them.
-- ---------------------------------------------------------------------------

revoke all on function public.seller_purchases(integer, integer) from public, anon;
revoke all on function public.seller_purchase(bigint) from public, anon;
revoke all on function public.seller_create_purchase(date, numeric, text) from public, anon;
revoke all on function public.seller_update_purchase(bigint, date, numeric, text) from public, anon;
revoke all on function public.seller_add_purchase_item(bigint, text, text, text) from public, anon;
revoke all on function public.seller_remove_purchase_item(bigint) from public, anon;
revoke all on function public.seller_set_purchase_item_state(bigint, text) from public, anon;
revoke all on function public.seller_book_purchase_item(bigint) from public, anon;
revoke all on function public.seller_unbook_purchase_item(bigint) from public, anon;
revoke all on function public.seller_delete_purchase(bigint) from public, anon;

grant execute on function public.seller_purchases(integer, integer) to authenticated;
grant execute on function public.seller_purchase(bigint) to authenticated;
grant execute on function public.seller_create_purchase(date, numeric, text) to authenticated;
grant execute on function public.seller_update_purchase(bigint, date, numeric, text) to authenticated;
grant execute on function public.seller_add_purchase_item(bigint, text, text, text) to authenticated;
grant execute on function public.seller_remove_purchase_item(bigint) to authenticated;
grant execute on function public.seller_set_purchase_item_state(bigint, text) to authenticated;
grant execute on function public.seller_book_purchase_item(bigint) to authenticated;
grant execute on function public.seller_unbook_purchase_item(bigint) to authenticated;
grant execute on function public.seller_delete_purchase(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 9. The historical import
--
-- A PURCHASE IMPORT IS NOT A STOCK IMPORT. Current stock was reconciled from
-- the stock sheets by `0048`'s importer. `Order 2026` is the money trail for
-- the same goods. Replaying it as movements would double every figure on the
-- shelf.
--
-- So every imported unit lands as `reconciled_legacy`: purchased, historically
-- accounted for, owning no movement and creating none. The workbook's own two
-- markers ride along as context — `legacy_booked_flag` records that column D
-- said the old spreadsheet had entered the figure, which is a fact about the
-- spreadsheet and never an instruction to this database.
--
-- `p_fingerprint` makes a re-run harmless: the unique index refuses the second
-- attempt rather than creating a twin.
-- ---------------------------------------------------------------------------

create or replace function public.seller_import_purchase_group(
  p_purchased_at date,
  p_total_cost   numeric,
  p_fingerprint  text,
  p_note         text,
  p_items        jsonb
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'that is more items than a purchase group has'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.purchases (
    purchased_at, total_cost, source, import_fingerprint, note, created_by, updated_by
  ) values (
    p_purchased_at, p_total_cost, 'excel_order_2026', p_fingerprint,
    nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()), (select auth.uid())
  ) returning id into v_id;

  insert into public.purchase_items (
    purchase_id, position, sky_id, raw_name, condition, state,
    legacy_condition_flag, legacy_booked_flag, source_row
  )
  select v_id,
         (r->>'position')::integer,
         nullif(r->>'sky_id', ''),
         nullif(r->>'raw_name', ''),
         coalesce(nullif(r->>'condition', ''), 'loose'),
         -- Never 'booked': that state promises a movement, and a historical
         -- item owns none.
         'reconciled_legacy',
         nullif(r->>'legacy_condition_flag', ''),
         nullif(r->>'legacy_booked_flag', ''),
         (r->>'source_row')::integer
    from jsonb_array_elements(p_items) as r;

  return v_id;
end;
$$;

comment on function public.seller_import_purchase_group(date, numeric, text, text, jsonb) is
  'Records one historical Order 2026 purchase group. Every item lands as reconciled_legacy: no inventory movement is created and current stock is untouched, because it was already reconciled by the stock importer (ADR-0088).';

revoke all on function public.seller_import_purchase_group(date, numeric, text, text, jsonb) from public, anon;
grant execute on function public.seller_import_purchase_group(date, numeric, text, text, jsonb) to authenticated;
