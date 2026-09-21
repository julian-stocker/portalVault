-- ===========================================================================
-- 0079 — the reconstructed Legacy stock history (ADR-0102)
--
-- WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
--
-- `inventory_movements` is the operative ledger: what SkyIsles actually
-- booked, append-only, every row the consequence of a real operation. It
-- starts when SkyIsles starts. Nothing may ever be back-dated into it.
--
-- This table is the other thing entirely — a RECONSTRUCTION of the 2026
-- business year from the owner's workbook, so the Lager screens can show
-- where a figure's stock came from instead of beginning at a bare number.
-- It is written once by an importer, it moves no stock, and it is not the
-- source of any quantity. Keeping the two in one table would mean a reader
-- could no longer tell a booked fact from a reconstructed one.
--
-- THE FOUR-AND-A-HALF EVENT KINDS
--
--   purchase           a documented 2026 business purchase, +1 per unit
--   sale               a documented 2026 business sale, -1 per unit
--   correction         the workbook's own `Korrektur >` rows. The workbook
--                      counts them as outgoing itself: for `I!74` its sold
--                      counter reads 5 = 3 sales + 2 corrections.
--   opening_balance    a TECHNICAL starting value at 2026-01-01, chosen so
--                      that the documented events add up to the workbook's
--                      final stock. It is not a purchase and not a claim
--                      about what was physically on a shelf that morning.
--   legacy_adjustment  the remainder where even zero is too high a start.
--                      Same date, same technical nature, and NEGATIVE — see
--                      the constraint below and read the comment there before
--                      being surprised by it.
--
-- WHY A NEGATIVE ADJUSTMENT IS ALLOWED AND MEANS NOTHING PHYSICAL
--
-- For fifteen figures the workbook records more 2026 purchases than its own
-- final stock and sales can account for. Reconstructing backwards therefore
-- lands below zero. The owner's decision (and it IS a decision, not a defect
-- we hid): the opening balance is clamped to zero and the remainder is
-- carried as `legacy_adjustment`, dated 2026-01-01 like every other technical
-- reconstruction value.
--
-- It does NOT assert that minus one figure sat on a shelf. It asserts only
-- "the legacy data does not reconstruct completely here". Consequently the
-- Lager timeline must never compute a running historical balance from these
-- rows and present it as fact; it lists the events, and the current stock
-- comes from `shop_inventory` as it always did.
--
-- WHY `import_fingerprint` IS THE IDENTITY
--
-- The importer must be safe to run twice — a half-finished run, a corrected
-- workbook, an operator who is not sure whether it went through. A readable
-- deterministic key per event (not a hash: these are audited by eye) plus a
-- UNIQUE index turns a second run into zero inserts instead of a doubled
-- history.
-- ===========================================================================

create table if not exists public.legacy_stock_events (
  id                    bigint      generated always as identity primary key,

  sky_id                text        not null,
  condition             text        not null,

  event_type            text        not null,

  -- Signed, like the operative ledger: positive is into stock, negative out.
  -- One row may carry several units (an opening balance usually does); a
  -- purchase or sale row is always exactly one physical object.
  quantity              integer     not null,

  -- A DATE, not a timestamp. The workbook knows the day and never the hour,
  -- and a fabricated time would read as precision we do not have.
  occurred_at           date        not null,

  -- The canonical market price at the migration cut, frozen onto every legacy
  -- event of that figure (ADR-0102). NULL is legitimate and must stay
  -- legitimate: two supported figures have no canonical price, and inventing
  -- one would be worse than admitting none.
  market_price_snapshot numeric(10,2),

  -- Where it came from, for audit. NULL on the two technical kinds, which
  -- have no source row by construction.
  source_sheet          text,
  source_row            integer,

  -- The idempotency key. See the header.
  import_fingerprint    text        not null,

  note                  text,
  created_at            timestamptz not null default now(),

  constraint legacy_stock_events_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id) on update cascade on delete restrict,

  constraint legacy_stock_events_condition_known
    check (condition in ('loose', 'boxed')),

  constraint legacy_stock_events_type_known
    check (event_type in
      ('opening_balance', 'purchase', 'sale', 'correction', 'legacy_adjustment')),

  -- An event of zero is not an event.
  constraint legacy_stock_events_quantity_not_zero check (quantity <> 0),

  -- Direction is fixed where the workbook fixes it. `correction` is the one
  -- kind left open: the workbook's own corrections all point outwards, but
  -- the concept does not, and a constraint that forbade the other direction
  -- would only push a future entry under a wrong kind.
  constraint legacy_stock_events_direction
    check (
      case event_type
        when 'purchase'        then quantity > 0
        when 'sale'            then quantity < 0
        when 'opening_balance' then quantity > 0
        else true
      end
    ),

  -- The two technical kinds belong to the business start and nowhere else.
  constraint legacy_stock_events_technical_dated_at_cut
    check (
      event_type not in ('opening_balance', 'legacy_adjustment')
      or occurred_at = date '2026-01-01'
    ),

  -- Nothing before the business cut may enter at all. Everything earlier is
  -- the owner's private activity and is excluded by decision, not by filter.
  constraint legacy_stock_events_never_before_the_cut
    check (occurred_at >= date '2026-01-01'),

  -- A workbook event names its row; a technical one cannot and must not.
  constraint legacy_stock_events_source_matches_kind
    check (
      case
        when event_type in ('opening_balance', 'legacy_adjustment')
          then source_sheet is null and source_row is null
        else source_sheet is not null and source_row is not null
      end
    )
);

comment on table public.legacy_stock_events is
  'Reconstructed 2026 business stock history from the owner''s workbook (ADR-0102). Additive and separate from inventory_movements, which stays the operative append-only ledger: nothing here books stock, nothing here is back-dated into the ledger, and no quantity is derived from this table. opening_balance and legacy_adjustment are technical reconstruction values dated at the business start, not claims about physical stock.';
comment on column public.legacy_stock_events.quantity is
  'Signed units: positive into stock, negative out. legacy_adjustment is normally negative and asserts nothing physical — see the table comment.';
comment on column public.legacy_stock_events.market_price_snapshot is
  'Canonical skylanders.market_price at the migration cut, identical across all legacy events of one figure. NULL where the catalog has no price; never invented.';
comment on column public.legacy_stock_events.import_fingerprint is
  'Deterministic readable identity of one reconstructed event, so a repeated import inserts nothing.';

-- Idempotency. The importer relies on this, not on counting rows first.
create unique index if not exists legacy_stock_events_fingerprint_key
  on public.legacy_stock_events (import_fingerprint);

-- At most one technical value of each kind per position. Two opening balances
-- for one figure is not a bigger history, it is a broken one.
create unique index if not exists legacy_stock_events_one_opening_per_position
  on public.legacy_stock_events (sky_id, condition)
  where event_type = 'opening_balance';
create unique index if not exists legacy_stock_events_one_adjustment_per_position
  on public.legacy_stock_events (sky_id, condition)
  where event_type = 'legacy_adjustment';

-- The read pattern is always "one position's history, in order".
create index if not exists legacy_stock_events_position_idx
  on public.legacy_stock_events (sky_id, condition, occurred_at, id);

-- ---------------------------------------------------------------------------
-- Append-only, exactly like the operative ledger.
--
-- A reconstruction that can be quietly edited afterwards is not a
-- reconstruction, it is a scratchpad. Corrections happen by importing again
-- under a new fingerprint, which leaves both rows visible.
--
-- THE ROLLBACK PATH IS `truncate`, DELIBERATELY.
--
-- A row trigger does not fire on TRUNCATE, so `truncate table
-- public.legacy_stock_events;` in the SQL editor still empties it. That is
-- the intended escape hatch and the only one: discarding the whole
-- reconstruction is a decision somebody makes at a console, while removing
-- single rows to make the numbers look better is exactly what must stay
-- impossible. Nothing is lost by it — the workbook rebuilds the table.
-- ---------------------------------------------------------------------------
create or replace function public.legacy_stock_events_are_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'legacy_stock_events is append-only'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists legacy_stock_events_no_update on public.legacy_stock_events;
create trigger legacy_stock_events_no_update
  before update or delete on public.legacy_stock_events
  for each row execute function public.legacy_stock_events_are_append_only();

-- ---------------------------------------------------------------------------
-- RLS: closed. No policy, so no anon and no authenticated reader reaches the
-- table directly — this is internal stock data (docs/SECURITY.md). The screens
-- read it through the seller-gated function below.
-- ---------------------------------------------------------------------------
alter table public.legacy_stock_events enable row level security;
revoke all on table public.legacy_stock_events from public, anon, authenticated;

create or replace function public.seller_legacy_stock_events(
  p_sky_id text,
  p_condition text default 'loose'
)
returns table (
  occurred_at           date,
  event_type            text,
  quantity              integer,
  market_price_snapshot numeric,
  source_sheet          text,
  source_row            integer,
  note                  text
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
    select e.occurred_at, e.event_type, e.quantity, e.market_price_snapshot,
           e.source_sheet, e.source_row, e.note
      from public.legacy_stock_events e
     where e.sky_id = p_sky_id
       and e.condition = p_condition
     order by e.occurred_at, e.id;
end;
$$;

comment on function public.seller_legacy_stock_events(text, text) is
  'The reconstructed legacy history of one stock position, oldest first (0079). Seller operators only. Returns events, never a running balance: opening_balance and legacy_adjustment are technical values and a balance computed from them would be presented as a fact it is not.';

revoke all on function public.seller_legacy_stock_events(text, text) from public, anon;
grant execute on function public.seller_legacy_stock_events(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The counters Lager V2 shows. Purchased and sold count DOCUMENTED TRADE
-- ONLY — the two technical kinds and corrections are excluded here, in one
-- place, so no screen has to remember the rule.
-- ---------------------------------------------------------------------------
create or replace function public.seller_legacy_stock_summary()
returns table (
  sky_id             text,
  condition          text,
  purchased_units    integer,
  sold_units         integer,
  opening_units      integer,
  adjustment_units   integer,
  correction_units   integer
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
    select e.sky_id,
           e.condition,
           coalesce(sum(e.quantity) filter (where e.event_type = 'purchase'), 0)::integer,
           coalesce(-sum(e.quantity) filter (where e.event_type = 'sale'), 0)::integer,
           coalesce(sum(e.quantity) filter (where e.event_type = 'opening_balance'), 0)::integer,
           coalesce(sum(e.quantity) filter (where e.event_type = 'legacy_adjustment'), 0)::integer,
           coalesce(sum(e.quantity) filter (where e.event_type = 'correction'), 0)::integer
      from public.legacy_stock_events e
     group by e.sky_id, e.condition;
end;
$$;

comment on function public.seller_legacy_stock_summary() is
  'Per position: documented legacy purchases and sales as positive unit counts, plus the technical values kept apart (0079). opening_balance, legacy_adjustment, corrections and returns are never counted as purchased or sold.';

revoke all on function public.seller_legacy_stock_summary() from public, anon;
grant execute on function public.seller_legacy_stock_summary() to authenticated;
