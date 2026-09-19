-- ===========================================================================
-- 0057 — searching the Orderbuch by game
--
-- `Drobot` exists in Spyro's Adventure and in Giants, and the ledger now shows
-- which — so the obvious next thing an operator types is `Giants`, and until
-- now that found nothing.
--
-- The item subquery already joins `skylanders`; this adds the one join that
-- turns a series CODE into the name a person would type. `SA` is not what the
-- owner calls that game, and `public.series` is where the label already lives
-- for every other screen in the product.
--
-- WHY `create or replace` AND NOT AN EDIT TO 0056
--
-- `0056` is applied to Staging. Applied migrations are not rewritten, so the
-- function is replaced from a new file — the same rule 0054 and 0055 followed.
--
-- NOTHING ELSE MOVES. Same signature, same return shape, same ordering, same
-- summary arithmetic (SUM(cost)/SUM(value), never an average of factors). One
-- more `or` in the item match, and one more join to reach it.
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
              -- The game, by the name a person would type. `SA` is a code.
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
  'One filtered, searched page of the Orderbuch plus its summary (0056, series search added in 0057). Search covers the purchase date, cost, market value, factor, note and source, and the raw name, canonical name and GAME of the items inside — matching items come back with the row so the screen can open it in the right place. The summary factor is SUM(cost)/SUM(value), never an average of per-purchase factors.';

revoke all on function public.seller_orderbook_ledger(integer, integer, text) from public, anon;
grant execute on function public.seller_orderbook_ledger(integer, integer, text) to authenticated;
