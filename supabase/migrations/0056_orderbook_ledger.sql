-- ===========================================================================
-- 0056 — the Orderbuch as a ledger you can search
--
-- WHY A FUNCTION AND NOT A CLIENT-SIDE FILTER
--
-- The screen now has to do three things at once: filter by year and month,
-- search across purchases AND the items inside them, and show a summary of
-- exactly what survived both. Any two of those are easy in the browser. All
-- three are not, because searching item names means having every item in the
-- browser — 561 rows today, 2 193 once 2026 lands — purely so that a summary
-- line can count what matched.
--
-- So the database answers the question it is already holding the data for, and
-- the browser receives one purchase per row plus the handful of items that
-- actually matched a search. Item lists are fetched when a row is expanded and
-- not before.
--
--
-- THE SUMMARY FACTOR IS NOT AN AVERAGE OF FACTORS
--
--     factor = SUM(total_cost) / SUM(known_value)
--
-- and specifically NOT `avg(per-purchase factor)`. The two disagree, and the
-- averaged one is wrong: it weights a three-item parcel the same as a
-- sixty-five-item one. On the real December 2025 data the difference is
-- visible in the second decimal, which is exactly the size of error nobody
-- notices.
--
--
-- AND IT DOES NOT SILENTLY TREAT UNKNOWN AS ZERO
--
-- `known_items` travels with `known_value` so the screen can say the valuation
-- is partial instead of quietly reporting a smaller number as if it were
-- complete — the same reason `purchase_market_value()` returns both.
-- ===========================================================================

create or replace function public.seller_orderbook_ledger(
  p_year   integer default null,
  p_month  integer default null,
  p_search text    default null
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
   * A financial search that returns approximately the right money is worse
   * than one that returns nothing.
   */
  v_num := replace(coalesce(v_q, ''), ',', '.');

  with filtered as (
    select p.*, v.known_value, v.known_items, v.total_items, v.booked_items,
           case when v.known_value > 0 then round(p.total_cost / v.known_value, 4) end as factor
      from public.purchases p
      cross join lateral public.purchase_market_value(p.id) v
     where (p_year  is null or extract(year  from p.purchased_at) = p_year)
       and (p_month is null or extract(month from p.purchased_at) = p_month)
  ),
  hits as (
    select f.*,
           -- The items that matched, so the screen can open the row on the
           -- right place instead of making the operator hunt for the reason.
           (select jsonb_agg(jsonb_build_object(
                     'id', i.id, 'position', i.position,
                     'name', coalesce(s.name, i.raw_name, i.sky_id))
                   order by i.position)
              from public.purchase_items i
              left join public.skylanders s on s.sky_id = i.sky_id
             where i.purchase_id = f.id
               and v_q is not null
               and (i.raw_name ilike '%' || v_q || '%'
                 or s.name     ilike '%' || v_q || '%'
                 or i.sky_id   ilike '%' || v_q || '%')) as match_items
      from filtered f
  ),
  matched as (
    select h.*
      from hits h
     where v_q is null
        or h.match_items is not null
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
      -- Newest first, and for one day the later import first. Never the
      -- database's own idea of order.
      order by m.purchased_at desc, m.id desc), '[]'::jsonb),
    jsonb_build_object(
      'purchase_count', count(*),
      'item_count',     coalesce(sum(m.total_items), 0),
      'total_cost',     coalesce(sum(m.total_cost), 0),
      'known_value',    coalesce(sum(m.known_value), 0),
      'known_items',    coalesce(sum(m.known_items), 0),
      -- SUM over SUM. Never avg(factor): that weights a 3-item parcel like a
      -- 65-item one.
      'factor', case when coalesce(sum(m.known_value), 0) > 0
                     then round(sum(m.total_cost) / sum(m.known_value), 4) end,
      'incomplete', coalesce(sum(m.known_items), 0) < coalesce(sum(m.total_items), 0))
  into v_rows, v_sum
  from matched m;

  return jsonb_build_object('purchases', v_rows, 'summary', v_sum);
end;
$$;

comment on function public.seller_orderbook_ledger(integer, integer, text) is
  'One filtered, searched page of the Orderbuch plus its summary (0056). Search covers the purchase date, cost, market value, factor, note and source, and the raw and canonical names of the items inside — matching items come back with the row so the screen can open it in the right place. The summary factor is SUM(cost)/SUM(value), never an average of per-purchase factors.';

revoke all on function public.seller_orderbook_ledger(integer, integer, text) from public, anon;
grant execute on function public.seller_orderbook_ledger(integer, integer, text) to authenticated;
