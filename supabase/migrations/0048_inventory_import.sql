-- ===========================================================================
-- 0048 — reconciling physical stock from the owner's spreadsheet
--
-- WHAT THIS IS, IN ONE LINE
--
-- The owner keeps his physical inventory in Excel. This lets him point SkyIsles
-- at that workbook and have the shop's stock agree with it — deliberately,
-- visibly, and without ever overwriting what the shop knows.
--
-- ---------------------------------------------------------------------------
-- THE SPREADSHEET IS THE TRUTH ABOUT PHYSICAL STOCK
--
-- `Storage` is an absolute target, not an addition. The owner uploads the file
-- and confirms in order to make SkyIsles agree with the shelf:
--
--     desired = Excel Storage
--     delta   = desired - current
--
-- The delta exists only because stock moves through an append-only ledger
-- (0003). The business meaning is "make it equal"; the arithmetic is how the
-- ledger gets there. If the sheet says 0 and the shop holds 3, the result is 0.
--
-- WHAT THIS DELIBERATELY DOES NOT DO.
--
-- An earlier draft refused an increase when the workbook looked older than the
-- shop's last movement, or when the sheet's value was unchanged since the
-- previous import. Both were wrong in the same way: they had SkyIsles
-- second-guessing an instruction the owner had just given deliberately. He runs
-- the import *because* the two disagree. The workbook's save time and the
-- previous import's target are kept — they are useful on screen and in the
-- history — but neither decides whether a synchronisation may happen.
--
-- THE ONE REAL CONFLICT IS A RESERVATION, because it is the only case where the
-- requested state is impossible rather than merely surprising. Units reserved
-- for a checkout in flight are already promised: `shop_inventory` requires
-- `reserved <= quantity`, and `apply_inventory_movement()` refuses to break it.
-- Such a row is shown, skipped, and everything else is applied.
--
-- ---------------------------------------------------------------------------
-- WHAT IT REFUSES TO TOUCH
--
-- The workbook holds far more than this importer's domain, and none of it is an
-- error — it is simply not ours. Measured against the real file:
--
--     559 complete loose figures      the domain. 250 hold stock, 992 units.
--      39 games and software          valid SKY-IDs, not figures. Left alone
--                                     entirely — not imported, and NOT zeroed.
--      13 Swap Force halves           top and bottom halves the owner tracks
--                                     locally. 13 units, deliberately excluded.
--       2 explicitly boxed rows       this importer is loose-only.
--       1 damaged legacy row          local bookkeeping.
--
-- `IGNORED_GAME` matters most of those: a game row must not be treated as
-- unmatched, and must not be zeroed. Doing nothing to it is the whole point.
--
-- ---------------------------------------------------------------------------
-- WHERE THE STOCK ACTUALLY CHANGES
--
-- Nowhere in this file. `apply_inventory_movement()` has been the only thing
-- that writes `shop_inventory.quantity` since 0003, always by a delta and
-- always with a journal row, and it already refuses a decrement that would
-- strand reserved stock (`quantity + p_delta >= reserved`). This migration
-- calls `record_inventory_movement()` like any other operator action and
-- inherits every one of those guarantees. The reason is `correction`, which
-- 0003 defines as "a recount, either direction" — which is exactly what
-- reconciling against a spreadsheet is.
--
-- DEPENDS ON `0003` (inventory + movements) and `0041` (the seller predicate).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. One upload
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_imports (
  id bigint generated always as identity primary key,

  file_name text not null,
  -- SHA-256 over the CONTENT of the stock-take, not over the file.
  --
  -- Canonicalised in `src/lib/import/fingerprint.ts`: version, sheet, trimmed
  -- name and Storage count, sorted. Deliberately NOT the 450 MB of bytes —
  -- re-saving the workbook or swapping one figure's photograph changes every
  -- byte while changing nothing about the stock, and hashing the file would
  -- undo the selective read the importer exists for. Equally deliberately NOT
  -- computed after resolution: a SKY-ID moves when the catalog or a saved
  -- mapping changes, and that is not a change to the shelf.
  --
  -- Not a lock. The same snapshot may legitimately be imported twice, because
  -- reconciliation against an absolute target is idempotent — the second run
  -- computes deltas of zero. It is here so "did I already do this one?" has an
  -- answer, and for nothing else.
  content_fingerprint text,

  -- `dcterms:modified` from the workbook. The snapshot the numbers describe.
  workbook_modified_at timestamptz,

  sheets_read  text[] not null default '{}',
  rows_seen    integer not null default 0,

  -- The classification, as counts. Denormalised on purpose: this is what the
  -- summary screen shows, and recomputing it from 600 rows to draw a heading
  -- would be six aggregates per page view.
  supported_rows integer not null default 0,
  ignored_rows   integer not null default 0,
  conflict_rows  integer not null default 0,
  increases      integer not null default 0,
  decreases      integer not null default 0,
  unchanged      integer not null default 0,
  new_positions  integer not null default 0,
  units_before   integer not null default 0,
  units_after    integer not null default 0,

  state text not null default 'preview',

  created_by uuid,
  created_at timestamptz not null default now(),
  applied_at timestamptz,

  constraint inventory_imports_state_known
    check (state in ('preview', 'applied', 'discarded')),
  constraint inventory_imports_file_name_shape
    check (length(btrim(file_name)) between 1 and 300),
  constraint inventory_imports_fingerprint_shape
    check (content_fingerprint is null or content_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint inventory_imports_applied_consistent
    check ((state = 'applied') = (applied_at is not null)),
  constraint inventory_imports_created_by_fk foreign key (created_by)
    references auth.users (id) on delete set null
);

comment on table public.inventory_imports is
  'One spreadsheet reconciliation: what was uploaded, what it proposed, and whether it was applied (ADR-0087). A preview that is never confirmed stays ''preview'' and changes nothing.';

create index if not exists inventory_imports_recent_idx
  on public.inventory_imports (created_at desc);

alter table public.inventory_imports enable row level security;
revoke all on table public.inventory_imports from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. One row of that upload
--
-- Every row the parser saw is stored, including the ignored ones. That is what
-- lets the owner ask "why did this figure go from 2 to 5?" and, just as often,
-- "why did this one NOT change?" — the second question is unanswerable if only
-- the applied rows are kept.
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_import_rows (
  id bigint generated always as identity primary key,
  import_id bigint not null,

  -- Where it came from, so a finding can be pointed at in Excel.
  sheet      text    not null,
  source_row integer not null,
  raw_name   text    not null,

  -- What it was understood to be.
  classification text not null,
  sky_id    text,
  condition text,

  -- The numbers. `desired_quantity` is Excel's Storage column; `delta` is what
  -- would be applied. Both null for an ignored row.
  previous_quantity integer,
  desired_quantity  integer,
  delta             integer,

  -- Set when the row was actually applied. The link from a spreadsheet cell to
  -- the ledger entry it produced.
  movement_id bigint,

  status text not null default 'pending',
  note   text,

  constraint inventory_import_rows_import_fk foreign key (import_id)
    references public.inventory_imports (id) on update cascade on delete cascade,
  constraint inventory_import_rows_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id) on update cascade on delete restrict,
  constraint inventory_import_rows_movement_fk foreign key (movement_id)
    references public.inventory_movements (id) on update cascade on delete restrict,

  constraint inventory_import_rows_classification_known
    check (classification in (
      'SUPPORTED_COMPLETE_LOOSE_FIGURE',
      'IGNORED_GAME',
      'IGNORED_SWAP_FORCE_HALF',
      'IGNORED_DAMAGED',
      'IGNORED_OVP',
      'IGNORED_SHEET',
      'UNMATCHED_RELEVANT',
      'AMBIGUOUS_RELEVANT',
      'INVALID_ROW'
    )),
  constraint inventory_import_rows_status_known
    check (status in ('pending', 'applied', 'skipped', 'conflict', 'failed', 'unchanged')),
  constraint inventory_import_rows_condition_known
    check (condition is null or condition in ('loose', 'boxed')),
  constraint inventory_import_rows_quantities_sane
    check (desired_quantity is null or desired_quantity >= 0),
  -- A supported row is the only kind that may carry a figure and a target.
  constraint inventory_import_rows_supported_has_target
    check (classification <> 'SUPPORTED_COMPLETE_LOOSE_FIGURE'
           or (sky_id is not null and condition is not null and desired_quantity is not null)),
  -- An ignored row may never carry a delta. This is the constraint that makes
  -- "a game row is left completely alone" a fact rather than an intention.
  constraint inventory_import_rows_ignored_is_inert
    check (classification not like 'IGNORED%' or (delta is null and movement_id is null))
);

comment on table public.inventory_import_rows is
  'Every row of a reconciliation, ignored ones included (ADR-0087). Answers both "why did this change?" and "why did this not?". An IGNORED row is structurally incapable of carrying a delta.';

create index if not exists inventory_import_rows_import_idx
  on public.inventory_import_rows (import_id, id);
create index if not exists inventory_import_rows_sky_idx
  on public.inventory_import_rows (sky_id, id desc) where sky_id is not null;

alter table public.inventory_import_rows enable row level security;
revoke all on table public.inventory_import_rows from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. A resolution the owner made once
--
-- Keyed on the sheet and the normalised name rather than on a SkyIsles id,
-- because it answers a question about the SPREADSHEET: "this line means that
-- figure." It survives re-saving the workbook, reordering rows and editing
-- other cells. It does not survive renaming the line — which is correct, since
-- a renamed line is a different claim and deserves to be looked at again.
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_import_mappings (
  id bigint generated always as identity primary key,

  sheet           text not null,
  normalised_name text not null,

  -- Either a figure, or an explicit decision to ignore this line forever.
  sky_id    text,
  condition text not null default 'loose',
  ignored   boolean not null default false,

  created_by uuid,
  created_at timestamptz not null default now(),

  constraint inventory_import_mappings_unique unique (sheet, normalised_name),
  constraint inventory_import_mappings_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id) on update cascade on delete cascade,
  constraint inventory_import_mappings_created_by_fk foreign key (created_by)
    references auth.users (id) on delete set null,
  constraint inventory_import_mappings_condition_known
    check (condition in ('loose', 'boxed')),
  -- Exactly one of the two answers.
  constraint inventory_import_mappings_resolved
    check (ignored = (sky_id is null))
);

comment on table public.inventory_import_mappings is
  'A spreadsheet line the owner has already identified, so the importer asks once (ADR-0087). Keyed on sheet + normalised name because it is a statement about the workbook, not about the catalog.';

alter table public.inventory_import_mappings enable row level security;
revoke all on table public.inventory_import_mappings from public, anon, authenticated;


-- ===========================================================================
-- 4. What the shop currently knows about a set of figures
--
-- The preview needs four things per position, and asking for them one figure
-- at a time would be 559 round trips.
--
-- `reserved` is the one that decides anything: a target below it is impossible,
-- and the preview has to be able to say so rather than letting the whole import
-- abort at commit on a constraint nobody was shown.
--
-- `last_movement_at` and `last_import_desired` are INFORMATION — for the screen
-- and the history. Neither gates a synchronisation; the owner decided that when
-- he confirmed. Both are cheap: 0003 already indexes
-- `(inventory_id, created_at desc)`.
--
-- Returns a row for every requested sky_id, including ones with no stock
-- position yet — "there is nothing here" is an answer the preview needs.
-- ===========================================================================

create or replace function public.seller_import_baseline(
  p_sky_ids   text[],
  p_condition text default 'loose'
)
returns table (
  sky_id           text,
  quantity         integer,
  reserved         integer,
  is_listed        boolean,
  sale_price       numeric,
  last_movement_at timestamptz,
  last_import_desired integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select s.sky_id,
           coalesce(i.quantity, 0),
           coalesce(i.reserved, 0),
           coalesce(i.is_listed, false),
           i.sale_price,
           (select max(m.created_at)
              from public.inventory_movements m
             where m.inventory_id = i.id),
           -- What the last applied import saw in the spreadsheet here. Shown
           -- in the history so a change can be traced; it gates nothing.
           (select r.desired_quantity
              from public.inventory_import_rows r
              join public.inventory_imports im on im.id = r.import_id
             where r.sky_id = s.sky_id
               and r.condition = p_condition
               and im.state = 'applied'
             order by im.applied_at desc, r.id desc
             limit 1)
      from unnest(p_sky_ids) as s(sky_id)
      left join public.shop_inventory i
             on i.sky_id = s.sky_id and i.condition = p_condition;
end;
$$;

revoke all on function public.seller_import_baseline(text[], text) from public, anon;
grant execute on function public.seller_import_baseline(text[], text) to authenticated;


-- ===========================================================================
-- 5. Recording a preview
--
-- The rows arrive already classified and already matched — that work is the
-- parser's, and it happens in the browser where the spreadsheet is. What the
-- database does is store what was proposed, so the thing the owner confirms is
-- the thing that was shown to him and not a recomputation that might differ.
-- ===========================================================================

create or replace function public.seller_create_import(
  p_file_name text,
  p_content_fingerprint text,
  p_workbook_modified_at timestamptz,
  p_sheets text[],
  p_rows   jsonb
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
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = 'invalid_parameter_value';
  end if;

  -- A whole workbook is 614 rows. Far above that is a different file.
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'that is more rows than a workbook has'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.inventory_imports (
    file_name, content_fingerprint, workbook_modified_at, sheets_read, rows_seen, created_by
  ) values (
    left(btrim(p_file_name), 300), p_content_fingerprint, p_workbook_modified_at,
    coalesce(p_sheets, '{}'), jsonb_array_length(p_rows), auth.uid()
  ) returning id into v_id;

  insert into public.inventory_import_rows (
    import_id, sheet, source_row, raw_name, classification,
    sky_id, condition, previous_quantity, desired_quantity, delta, status, note
  )
  select v_id,
         r->>'sheet',
         (r->>'source_row')::integer,
         left(r->>'raw_name', 300),
         r->>'classification',
         nullif(r->>'sky_id', ''),
         nullif(r->>'condition', ''),
         (r->>'previous_quantity')::integer,
         (r->>'desired_quantity')::integer,
         (r->>'delta')::integer,
         coalesce(nullif(r->>'status', ''), 'pending'),
         left(r->>'note', 500)
    from jsonb_array_elements(p_rows) as r;

  -- The summary, computed here rather than trusted from the client: these are
  -- the numbers the confirmation screen shows, and they must describe the rows
  -- that were actually stored.
  update public.inventory_imports im set
    supported_rows = c.supported,
    ignored_rows   = c.ignored,
    conflict_rows  = c.conflicts,
    increases      = c.inc,
    decreases      = c.dec,
    unchanged      = c.same,
    new_positions  = c.fresh,
    units_before   = c.before,
    units_after    = c.after
  from (
    select
      count(*) filter (where classification = 'SUPPORTED_COMPLETE_LOOSE_FIGURE')            as supported,
      count(*) filter (where classification like 'IGNORED%')                                 as ignored,
      count(*) filter (where status = 'conflict')                                            as conflicts,
      count(*) filter (where status = 'pending' and delta > 0)                               as inc,
      count(*) filter (where status = 'pending' and delta < 0)                               as dec,
      count(*) filter (where status = 'pending' and delta = 0)                               as same,
      count(*) filter (where status = 'pending' and previous_quantity = 0 and delta > 0)     as fresh,
      coalesce(sum(previous_quantity) filter (where classification = 'SUPPORTED_COMPLETE_LOOSE_FIGURE'), 0) as before,
      coalesce(sum(desired_quantity)  filter (where classification = 'SUPPORTED_COMPLETE_LOOSE_FIGURE'), 0) as after
    from public.inventory_import_rows where import_id = v_id
  ) c
  where im.id = v_id;

  return v_id;
end;
$$;

revoke all on function public.seller_create_import(text, text, timestamptz, text[], jsonb)
  from public, anon;
grant execute on function public.seller_create_import(text, text, timestamptz, text[], jsonb)
  to authenticated;


-- ===========================================================================
-- 6. Applying it
--
-- ONE TRANSACTION. A plpgsql function is a single transaction, so row 3 failing
-- takes rows 1 and 2 with it. There is no half-imported state to explain, and
-- no resume to design — the owner fixes the cause and uploads again.
--
-- RE-READS THE CURRENT QUANTITY. The delta stored at preview time was computed
-- against the stock as it was then; if something sold in between, applying it
-- would miss the target. The TARGET is what the owner confirmed, so the delta
-- is recomputed here, inside the transaction, against the row the movement will
-- actually touch — and the resulting quantity is the spreadsheet's number
-- either way.
--
-- REFUSES RATHER THAN CLAMPS. `apply_inventory_movement()` will not take stock
-- below `reserved`. Rows that would do so were already marked `conflict` in the
-- preview and are not processed here; if a reservation appears in the meantime
-- the exception aborts the whole import, which is the honest outcome. Silently
-- writing a smaller decrement would leave the shop agreeing with neither the
-- spreadsheet nor the preview.
-- ===========================================================================

create or replace function public.seller_apply_import(p_import_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_import  record;
  v_row     record;
  v_current integer;
  v_delta   integer;
  v_mid     bigint;
  v_applied integer := 0;
  v_skipped integer := 0;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_import from public.inventory_imports where id = p_import_id for update;
  if not found then
    raise exception 'no such import' using errcode = 'invalid_parameter_value';
  end if;
  if v_import.state <> 'preview' then
    -- Applying twice is the one thing that could double stock. The state is
    -- the lock, and the row is held for the length of this transaction.
    raise exception 'this import has already been settled'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_row in
    select * from public.inventory_import_rows
     where import_id = p_import_id
       and classification = 'SUPPORTED_COMPLETE_LOOSE_FIGURE'
       and status = 'pending'
     order by id
  loop
    select coalesce(i.quantity, 0) into v_current
      from public.shop_inventory i
     where i.sky_id = v_row.sky_id and i.condition = v_row.condition;
    v_current := coalesce(v_current, 0);

    -- Recomputed against now, not against preview time.
    v_delta := v_row.desired_quantity - v_current;

    if v_delta = 0 then
      update public.inventory_import_rows
         set status = 'unchanged', previous_quantity = v_current, delta = 0
       where id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_mid := public.record_inventory_movement(
      v_row.sky_id, v_row.condition, v_delta, 'correction',
      null, null,
      'Bestandsabgleich aus Tabelle (Import ' || p_import_id || ')'
    );

    update public.inventory_import_rows
       set status = 'applied', previous_quantity = v_current,
           delta = v_delta, movement_id = v_mid
     where id = v_row.id;
    v_applied := v_applied + 1;
  end loop;

  update public.inventory_imports
     set state = 'applied', applied_at = now()
   where id = p_import_id;

  return jsonb_build_object('applied', v_applied, 'unchanged', v_skipped);
end;
$$;

comment on function public.seller_apply_import(bigint) is
  'Applies a reconciliation in ONE transaction (ADR-0087). Recomputes every delta against current stock rather than trusting the preview, and lets apply_inventory_movement() refuse anything that would strand reserved stock.';

create or replace function public.seller_discard_import(p_import_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;
  update public.inventory_imports
     set state = 'discarded'
   where id = p_import_id and state = 'preview';
end;
$$;


-- ===========================================================================
-- 7. Resolutions, and the history
-- ===========================================================================

create or replace function public.seller_import_mappings()
returns table (sheet text, normalised_name text, sky_id text, condition text, ignored boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select m.sheet, m.normalised_name, m.sky_id, m.condition, m.ignored
      from public.inventory_import_mappings m
     order by m.sheet, m.normalised_name;
end;
$$;

create or replace function public.seller_save_import_mapping(
  p_sheet text,
  p_normalised_name text,
  p_sky_id text,
  p_ignored boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.inventory_import_mappings
    (sheet, normalised_name, sky_id, ignored, created_by)
  values
    (btrim(p_sheet), btrim(p_normalised_name),
     case when p_ignored then null else p_sky_id end, p_ignored, auth.uid())
  on conflict (sheet, normalised_name) do update
     set sky_id = excluded.sky_id,
         ignored = excluded.ignored,
         created_by = excluded.created_by,
         created_at = now();
end;
$$;

create or replace function public.seller_imports(p_limit integer default 30)
returns setof public.inventory_imports
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select * from public.inventory_imports
     order by created_at desc
     limit greatest(1, least(coalesce(p_limit, 30), 200));
end;
$$;

create or replace function public.seller_import_rows(p_import_id bigint)
returns setof public.inventory_import_rows
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select * from public.inventory_import_rows
     where import_id = p_import_id
     order by id;
end;
$$;

revoke all on function public.seller_apply_import(bigint)                        from public, anon;
revoke all on function public.seller_discard_import(bigint)                      from public, anon;
revoke all on function public.seller_import_mappings()                           from public, anon;
revoke all on function public.seller_save_import_mapping(text, text, text, boolean) from public, anon;
revoke all on function public.seller_imports(integer)                            from public, anon;
revoke all on function public.seller_import_rows(bigint)                         from public, anon;

grant execute on function public.seller_apply_import(bigint)                        to authenticated;
grant execute on function public.seller_discard_import(bigint)                      to authenticated;
grant execute on function public.seller_import_mappings()                           to authenticated;
grant execute on function public.seller_save_import_mapping(text, text, text, boolean) to authenticated;
grant execute on function public.seller_imports(integer)                            to authenticated;
grant execute on function public.seller_import_rows(bigint)                         to authenticated;


-- ---------------------------------------------------------------------------
-- What this migration deliberately does NOT do
--
-- No storage bucket, no upload, no file. The workbook never leaves the owner's
-- phone: the browser reads roughly 0.75 MB of the 450 MB file and sends the
-- extracted rows. There is therefore nothing to keep private, nothing to expire
-- and no decompression bomb to defend against on the server.
--
-- No writes to `shop_inventory` and no new movement reason. `correction` has
-- meant "a recount, either direction" since 0003, and this is a recount.
--
-- No listing, no price. A figure that gains stock stays unlisted with no price
-- until the owner decides otherwise — `shop_inventory_listed_needs_price`
-- would refuse anything else, and it is right to.
--
-- No touching of games, halves, damaged rows or boxed rows: an IGNORED row is
-- structurally unable to carry a delta.
-- ---------------------------------------------------------------------------
