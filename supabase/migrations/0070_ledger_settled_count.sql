-- ===========================================================================
-- 0070 — THE LEDGER ROW COUNTS WHAT WAS SETTLED, TOO
-- ===========================================================================
--
-- 0069 gave a non-catalog position an ending. The Einkauf ledger's stock
-- column could not see it: the row reports `booked_count` and `item_count`,
-- and a purchase of ten figures and two portals would read `10 von 12` for
-- ever — outstanding in the column while `is_open` correctly said there was
-- nothing left to do. One screen, two answers.
--
-- So the row carries a third number.
--
--   booked_count    positions with a real inventory movement
--   settled_count   positions closed without one, because they are not
--                   catalog figures and never could have had one
--   open_count      item_count - booked_count - settled_count
--
-- `settled_count` IS NOT ADDED TO `booked_count`, here or anywhere. A
-- settled portal owns no movement, `Eingebucht` means a movement exists, and
-- keeping those two apart is the whole point of 0067-0069. The row can now
-- say "nothing outstanding" without saying "everything was booked", which
-- are different sentences and were being collapsed into one.
--
-- Counted with a scalar subquery rather than by widening
-- `purchase_market_value`: that function returns a typed row, so another
-- column would mean dropping and recreating it and everything that reads it,
-- for a number exactly one caller needs.
--
-- A historical purchase still reads `Historisch` whatever these numbers say
-- — the five parcels 0067 reopened included. Their outstanding work is on
-- the `Offen` axis, where it belongs, and a workbook purchase is history
-- however much of it is still in the post.
--
-- READ-ONLY. One `stable` function. No movement, no stock, no row written.
-- ===========================================================================

create or replace function public.seller_orderbook_ledger(
  p_year    integer default null,
  p_month   integer default null,
  p_search  text    default null,
  p_undated boolean default false,
  p_status  text    default 'normal'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text;
  v_num    text;
  v_status text;
  v_rows   jsonb;
  v_sum    jsonb;
  v_class  jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  v_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'normal');
  if v_status not in ('normal', 'incomplete', 'open', 'test', 'any') then
    raise exception 'unknown orderbook status filter' using errcode = 'check_violation';
  end if;

  v_q := nullif(btrim(coalesce(p_search, '')), '');
  /*
   * German decimals. The owner types `67,02`; the column holds `67.02`. Only
   * the separator is translated — no rounding, no tolerance, no nearest-match.
   */
  v_num := replace(coalesce(v_q, ''), ',', '.');

  with filtered as (
    select p.*, v.known_value, v.known_items, v.total_items, v.booked_items,
           /*
            * SETTLED, counted here and not in `purchase_market_value` (0070).
            *
            * That function returns a typed row, and widening it would mean
            * dropping and recreating it plus everything that reads it. This
            * is one scalar subquery over the same rows, needed by one caller.
            *
            * It is NOT added to `booked_items`. A settled portal owns no
            * movement, and `Eingebucht` means a movement exists — that is the
            * whole rule this release was written to restore.
            */
           (select count(*) from public.purchase_items s
             where s.purchase_id = p.id and s.state = 'settled')::integer as settled_items,
           case when v.known_value > 0 then round(p.total_cost / v.known_value, 4) end as factor,
           /*
            * UNVOLLSTÄNDIG, derived here and stored nowhere.
            *
            * A missing date, for every source — that is the thirteen `#REF!`
            * groups and anything the owner enters without an invoice to hand.
            * And a hand-made purchase with nothing in it: money recorded,
            * contents not, which is unfinished work rather than a parcel.
            *
            * The item rule is `manual` only. An imported group's contents are
            * the workbook's; nothing here can add to them, so listing one as
            * work outstanding would be listing something nobody can finish.
            */
           (p.purchased_at is null
            or (p.source = 'manual' and v.total_items = 0)) as is_incomplete,
           /*
            * OFFEN — an action is outstanding, not a fact. Derived too.
            *
            * A `reconciled_legacy` row is NOT outstanding: the historical
            * stock figure already contains those units, and the booking
            * function refuses that state outright. That is why a workbook
            * line the owner never ticked is absent here — and why 0067 moved
            * the five undelivered parcels to `ordered` rather than widening
            * this test to reach them.
            *
            * WHAT CHANGED IN 0068: `sky_id is not null` is gone.
            *
            * It was here because this expression mirrored
            * `seller_book_purchase_item` exactly, and that function needs a
            * catalog figure. But "can this be booked into figure inventory"
            * and "is there anything left to do with this" are two questions,
            * and a trophy and two portals in an undelivered parcel are where
            * they come apart: nobody can book them, and they are plainly not
            * dealt with either.
            *
            * Hiding them let a parcel report itself finished while three of
            * its items were still in the post — the false "nothing to do"
            * this axis exists to prevent.
            *
            * The BUTTON is a separate decision and is unchanged: `canCheckIn`
            * still requires a `sky_id`, so nothing offers an `Einbuchen` the
            * database would refuse.
            *
            * Independent of `Unvollständig`: a purchase can be fully recorded
            * and still have a parcel on the desk, and an incomplete one can
            * have nothing left to book.
            */
           exists (select 1
                     from public.purchase_items i
                    where i.purchase_id = p.id
                      and i.movement_id is null
                      and i.state in ('ordered', 'arrived')) as is_open
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
  searched as (
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
  ),
  /*
   * The classification filter, and the LAST one applied — which is what makes
   * the counts below meaningful. They are taken from `searched`, i.e. after
   * the year, month and search filters and before this one, so `Test 1` means
   * "one test purchase in the view you are looking at" rather than "one in the
   * database".
   */
  matched as (
    select r.* from searched r
     where case v_status
             when 'normal'     then not r.is_test
             when 'incomplete' then not r.is_test and r.is_incomplete
             when 'open'       then not r.is_test and r.is_open
             when 'test'       then r.is_test
             else true
           end
  ),
  /*
   * ONE STATEMENT, because a `with` clause belongs to the statement it is
   * attached to. The page and the counts are two aggregates over two
   * different CTEs of the same query, joined because each yields exactly one
   * row — not two queries, which would be two chances to disagree about the
   * filter.
   */
  page as (
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'purchased_at', m.purchased_at, 'total_cost', m.total_cost,
      'currency', m.currency, 'source', m.source, 'note', m.note,
      'item_count', m.total_items, 'booked_count', m.booked_items,
      'settled_count', m.settled_items,
      'open_count', m.total_items - m.booked_items - m.settled_items,
      'known_value', m.known_value, 'known_items', m.known_items,
      'factor', m.factor, 'match_items', m.match_items,
      'is_test', m.is_test, 'is_incomplete', m.is_incomplete, 'is_open', m.is_open)
      order by m.purchased_at desc nulls last, m.id desc), '[]'::jsonb) as page_rows,
    jsonb_build_object(
      'purchase_count', count(*),
      'item_count',     coalesce(sum(m.total_items), 0),
      'total_cost',     coalesce(sum(m.total_cost), 0),
      'known_value',    coalesce(sum(m.known_value), 0),
      'known_items',    coalesce(sum(m.known_items), 0),
      -- SUM over SUM. Never avg(factor).
      'factor', case when coalesce(sum(m.known_value), 0) > 0
                     then round(sum(m.total_cost) / sum(m.known_value), 4) end,
      'incomplete', coalesce(sum(m.known_items), 0) < coalesce(sum(m.total_items), 0)) as page_summary
  from matched m
  ),
  counts as (
    select jsonb_build_object(
             'normal',     count(*) filter (where not r.is_test),
             'incomplete', count(*) filter (where not r.is_test and r.is_incomplete),
             'open',       count(*) filter (where not r.is_test and r.is_open),
             'test',       count(*) filter (where r.is_test)) as classification
      from searched r
  )
  select page.page_rows, page.page_summary, counts.classification
    into v_rows, v_sum, v_class
    from page cross join counts;

  return jsonb_build_object('purchases', v_rows, 'summary', v_sum,
                            'classification', v_class);
end;
$$;

comment on function public.seller_orderbook_ledger(integer, integer, text, boolean, text) is
  'One filtered, searched page of the Einkauf ledger plus its summary and its classification counts (0056, 0057, 0058, 0063, `Offen` 0066, non-catalog items 0068, `settled_count` 0070). `p_status` selects normal (the default, test excluded), incomplete, open, test, or any. `is_open` lists every item with something outstanding — `ordered` or `arrived` and no movement — whether or not it is a catalog figure; a historical line is never one, because the booking function refuses that state. Outstanding is not the same as bookable: `canCheckIn` still requires a sky_id. `settled_count` is how many positions were closed WITHOUT a movement because they are not catalog figures; it is never added to `booked_count`, and `open_count` subtracts both. The summary aggregates exactly the rows returned.';
