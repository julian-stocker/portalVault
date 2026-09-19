-- ===========================================================================
-- 0058 — a purchase whose date nobody knows yet
--
-- WHAT THE WORKBOOK ACTUALLY CONTAINS
--
-- Thirteen groups of `Order 2026` have the literal text `#REF!` where their
-- date formula used to be: the cell it referenced was deleted, and the date is
-- unrecoverable from the file. 323 item rows, 943,80 € of real expenditure.
--
-- Until now the importer called them `blocked` and refused them, which was the
-- right call while "a purchase" meant "a purchase with a date". The owner has
-- changed that definition: the money was spent, the goods arrived, and the
-- only thing missing is a number he can supply later.
--
-- WHY NULL AND NOT A PLACEHOLDER
--
-- Every alternative is a lie that survives: 2026-01-01 is a date somebody will
-- later read as fact, the neighbouring group's date invents a chronology the
-- workbook does not claim, and the import date records when SkyIsles ran a
-- script rather than when anything was bought. NULL is the only value that
-- says what is true — and it is the only one the owner can correct without
-- first having to discover that it was wrong.
--
-- WHAT THIS DOES NOT CHANGE
--
-- `#REF!` stays the provenance, in the purchase note. The fingerprint scheme
-- is untouched — it already keys on the sheet and the group's header row, so
-- thirteen dateless groups get thirteen distinct identities without a date
-- being involved at all.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The column
--
-- Dropping NOT NULL is additive in the only sense that matters: every existing
-- row keeps its date, every existing query keeps working, and nothing is
-- rewritten. What changes is which future rows are permitted.
-- ---------------------------------------------------------------------------

alter table public.purchases alter column purchased_at drop not null;

comment on column public.purchases.purchased_at is
  'When the parcel was bought. NULL means the date is not known YET — a valid purchase whose date the owner will assign later (0058). It never means invalid, cancelled or undated-forever, and it is never a placeholder for a date somebody guessed.';


-- ---------------------------------------------------------------------------
-- 2. Assigning, correcting and clearing the date
--
-- ITS OWN FUNCTION, BECAUSE NULL HAD TO STOP MEANING "LEAVE ALONE".
--
-- `seller_update_purchase` writes `coalesce(p_purchased_at, p.purchased_at)`,
-- so NULL there means "do not touch this field" — the only sensible reading
-- for a partial update, and one that makes clearing a date impossible to
-- express. Rather than bolt a `p_clear_date` boolean onto it and leave two
-- readings of the same argument in one function, the date gets a function
-- where NULL IS the instruction.
--
-- The same shape as `seller_set_purchase_item_sky`, for the same reason.
-- ---------------------------------------------------------------------------

create or replace function public.seller_set_purchase_date(
  p_id           bigint,
  p_purchased_at date
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

  -- A date nobody could have bought anything on is a typo, not a correction.
  if p_purchased_at is not null
     and (p_purchased_at < date '2000-01-01' or p_purchased_at > current_date + 1) then
    raise exception 'that purchase date is outside the plausible range'
      using errcode = 'check_violation';
  end if;

  update public.purchases p
     set purchased_at = p_purchased_at,   -- NULL clears it, deliberately
         updated_at   = now(),
         updated_by   = (select auth.uid())
   where p.id = p_id;

  if not found then
    raise exception 'no such purchase' using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.seller_set_purchase_date(bigint, date) is
  'Assigns, corrects or clears a purchase date (0058). NULL is the instruction to clear, not an omitted argument. Touches nothing else: not the identity, not the fingerprint, not the items, and never stock.';

revoke all on function public.seller_set_purchase_date(bigint, date) from public, anon;
grant execute on function public.seller_set_purchase_date(bigint, date) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Finding them
--
-- WHY THE SIGNATURE CHANGES AND THE OLD ONE IS DROPPED
--
-- "Ohne Datum" is a third state that `p_year` cannot express: NULL there
-- already means "every year", and every sentinel value I could pass instead
-- would be a number pretending to be a filter. So the function takes a fourth
-- argument, and the three-argument version is dropped rather than left beside
-- it — an overload that silently wins for every existing caller is worse than
-- a signature change that a caller must notice.
--
-- THE FILTERS, AND WHY THEY ALREADY ALMOST WORKED
--
--   Alle Jahre   p_year NULL, p_undated false  -> everything, dated or not
--   2025 / 2026  p_year set                    -> dated only. `extract(year
--                                                 from null)` is NULL and
--                                                 NULL = 2025 is not true, so
--                                                 undated rows fall out by
--                                                 themselves.
--   Ohne Datum   p_undated true                -> exactly purchased_at IS NULL
--
-- ORDERING: `nulls last`, ADDED DELIBERATELY. Postgres sorts NULLs FIRST under
-- `desc`, which would put thirteen dateless purchases above the newest real
-- one and make them look like this week's parcels. Last, they read as what
-- they are: a block at the end, waiting for dates.
-- ---------------------------------------------------------------------------

drop function if exists public.seller_orderbook_ledger(integer, integer, text);

create or replace function public.seller_orderbook_ledger(
  p_year    integer default null,
  p_month   integer default null,
  p_search  text    default null,
  p_undated boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q    text;
  v_num  text;
  v_rows jsonb;
  v_sum  jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  v_q := nullif(btrim(coalesce(p_search, '')), '');
  /*
   * German decimals. The owner types `67,02`; the column holds `67.02`. Only
   * the separator is translated — no rounding, no tolerance, no nearest-match.
   */
  v_num := replace(coalesce(v_q, ''), ',', '.');

  with filtered as (
    select p.*, v.known_value, v.known_items, v.total_items, v.booked_items,
           case when v.known_value > 0 then round(p.total_cost / v.known_value, 4) end as factor
      from public.purchases p
      cross join lateral public.purchase_market_value(p.id) v
     where (case when coalesce(p_undated, false)
                 then p.purchased_at is null
                 else (p_year  is null or extract(year  from p.purchased_at) = p_year)
                  and (p_month is null or extract(month from p.purchased_at) = p_month)
            end)
  ),
  hits as (
    select f.*,
           (select jsonb_agg(jsonb_build_object(
                     'id', i.id, 'position', i.position,
                     'name', coalesce(s.name, i.raw_name, i.sky_id))
                   order by i.position)
              from public.purchase_items i
              left join public.skylanders s on s.sky_id = i.sky_id
              left join public.series se on se.code = s.series_code
             where i.purchase_id = f.id
               and v_q is not null
               and (i.raw_name ilike '%' || v_q || '%'
                 or s.name     ilike '%' || v_q || '%'
                 or i.sky_id   ilike '%' || v_q || '%'
                 or se.label   ilike '%' || v_q || '%')) as match_items
      from filtered f
  ),
  matched as (
    select h.*
      from hits h
     where v_q is null
        or h.match_items is not null
        -- Every date comparison yields NULL for an undated purchase, which is
        -- not true, so it simply does not match on date — and still matches on
        -- cost, note, source or any item inside it.
        or to_char(h.purchased_at, 'DD.MM.YYYY') ilike '%' || v_q  || '%'
        or h.purchased_at::text                  ilike '%' || v_q  || '%'
        or h.total_cost::text                    ilike '%' || v_num || '%'
        or round(h.known_value, 2)::text         ilike '%' || v_num || '%'
        or coalesce(round(h.factor, 2)::text, '') ilike '%' || v_num || '%'
        or coalesce(h.note, '')                  ilike '%' || v_q  || '%'
        or h.source                              ilike '%' || v_q  || '%'
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'purchased_at', m.purchased_at, 'total_cost', m.total_cost,
      'currency', m.currency, 'source', m.source, 'note', m.note,
      'item_count', m.total_items, 'booked_count', m.booked_items,
      'open_count', m.total_items - m.booked_items,
      'known_value', m.known_value, 'known_items', m.known_items,
      'factor', m.factor, 'match_items', m.match_items)
      order by m.purchased_at desc nulls last, m.id desc), '[]'::jsonb),
    jsonb_build_object(
      'purchase_count', count(*),
      'item_count',     coalesce(sum(m.total_items), 0),
      'total_cost',     coalesce(sum(m.total_cost), 0),
      'known_value',    coalesce(sum(m.known_value), 0),
      'known_items',    coalesce(sum(m.known_items), 0),
      -- SUM over SUM. Never avg(factor).
      'factor', case when coalesce(sum(m.known_value), 0) > 0
                     then round(sum(m.total_cost) / sum(m.known_value), 4) end,
      'incomplete', coalesce(sum(m.known_items), 0) < coalesce(sum(m.total_items), 0))
  into v_rows, v_sum
  from matched m;

  return jsonb_build_object('purchases', v_rows, 'summary', v_sum);
end;
$$;

comment on function public.seller_orderbook_ledger(integer, integer, text, boolean) is
  'One filtered, searched page of the Orderbuch plus its summary (0056, series search 0057, undated purchases 0058). `p_undated` selects exactly the purchases whose date is not known yet; a year filter excludes them on its own, and no filter at all includes them, sorted last. The summary factor is SUM(cost)/SUM(value), never an average of per-purchase factors.';

revoke all on function public.seller_orderbook_ledger(integer, integer, text, boolean) from public, anon;
grant execute on function public.seller_orderbook_ledger(integer, integer, text, boolean) to authenticated;
