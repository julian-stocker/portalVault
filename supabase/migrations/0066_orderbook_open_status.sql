-- ===========================================================================
-- 0066 — `Offen` is a fourth axis: an action is outstanding, not a fact
--
-- ADR-0093. Staging only.
--
-- ---------------------------------------------------------------------------
-- WHAT IT MEANS, AND WHAT IT DELIBERATELY DOES NOT
--
-- `Unvollständig` says something is MISSING from the record. `Offen` says the
-- record is fine and a PHYSICAL action is still owed: a parcel to book in, a
-- figure to book out. A sale can be complete to the cent — date, figures,
-- fees, payout — and still be open because nothing has left the shelf.
--
-- Four axes now, all independent, none folded into an enum:
--
--   Kanal            Intern / Extern      `sales.order_id`         0059
--   Einordnung       Test                 `is_test` / commerce_mode 0063
--   Vollständigkeit  Unvollständig        derived                   0063
--   Aktion           Offen                derived                   HERE
--
-- ---------------------------------------------------------------------------
-- THE RULE IS THE BOOKING FUNCTION'S OWN, AND THAT IS THE WHOLE POINT
--
-- `is_open` asks exactly what `seller_book_purchase_item` and
-- `seller_book_sale_item` would accept. Nothing wider — and the difference is
-- not academic:
--
--   * `seller_book_purchase_item` refuses `state = 'reconciled_legacy'`:
--     "a historical purchase item is already reflected in stock and is never
--     booked again".
--   * `seller_book_sale_item` refuses `source = 'excel_order_2026'`:
--     "historical sales never move stock".
--
-- The workbook marks 111 purchase lines and 240 sale lines as not yet booked
-- in its own column D / column L. Every one of them sits on an imported
-- record, so every one of them would be refused. Listing them as work would
-- invite the operator to create stock that the next `/admin/imports`
-- reconciliation — which owns the physical truth — would immediately take
-- back out. A filter that promises an impossible action is worse than one
-- that shows nothing, so this shows nothing for them.
--
-- The same reasoning already excludes a non-figure: `sky_id is null` can
-- never be booked, so a portal is never outstanding work.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES
--
-- Two read models gain one derived boolean, one count and one `p_status`
-- value. No column, no table, no backfill, no RLS change, no grant change,
-- no inventory. Both functions keep their signatures exactly, so every
-- existing caller is untouched and `create or replace` is safe.
--
-- The bodies below are `0063`'s, with only those insertions.
--
-- DEPENDS ON 0053/0059 (the booking functions this mirrors), 0063.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The Einkauf ledger
-- ---------------------------------------------------------------------------

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
            * The test is `seller_book_purchase_item`'s own: exactly the items
            * that function would accept. A `reconciled_legacy` row is NOT one
            * of them — it refuses that state outright, because the historical
            * stock figure already contains those units — so a workbook line
            * whose `legacy_booked_flag` is blank is deliberately absent here.
            * Advertising work the database declines to do would be worse than
            * showing nothing: it invites the operator to create stock that the
            * next `/admin/imports` reconciliation would take straight back out.
            *
            * Independent of `Unvollständig`: a purchase can be fully recorded
            * and still have a parcel on the desk, and an incomplete one can
            * have nothing left to book.
            */
           exists (select 1
                     from public.purchase_items i
                    where i.purchase_id = p.id
                      and i.movement_id is null
                      and i.sky_id is not null
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
      'open_count', m.total_items - m.booked_items,
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
  'One filtered, searched page of the Einkauf ledger plus its summary and its classification counts (0056, 0057, 0058, 0063, `Offen` 0066). `p_status` selects normal (the default, test excluded), incomplete, open, test, or any. `is_open` asks exactly what seller_book_purchase_item would accept, so a historical line — which that function refuses — is never listed as outstanding work. The summary aggregates exactly the rows returned.';


-- ---------------------------------------------------------------------------
-- 2. The Verkauf ledger
-- ---------------------------------------------------------------------------

create or replace function public.seller_sales(
  p_year    integer default null,
  p_month   integer default null,
  p_search  text    default null,
  p_undated boolean default false,
  p_scope   text    default 'all',      -- 'all' | 'internal' | 'external'
  p_open_payout boolean default false,
  p_status  text    default 'normal'    -- 'normal' | 'incomplete' | 'test' | 'any'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text; v_num text; v_status text; v_rows jsonb; v_sum jsonb; v_class jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  v_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'normal');
  if v_status not in ('normal', 'incomplete', 'open', 'test', 'any') then
    raise exception 'unknown orderbook status filter' using errcode = 'check_violation';
  end if;

  v_q := nullif(btrim(coalesce(p_search, '')), '');
  v_num := replace(coalesce(v_q, ''), ',', '.');   -- German decimals, nothing else

  with base as (
    select s.*,
           -- The customer-facing side, from whichever system owns it.
           case when s.order_id is not null then o.items_subtotal   else s.items_subtotal   end as c_subtotal,
           case when s.order_id is not null then o.shipping_amount  else s.shipping_charged end as c_shipping,
           case when s.order_id is not null then o.discount_amount  else s.discount_amount  end as c_discount,
           case when s.order_id is not null then o.paid_at::date    else s.sold_at          end as effective_date,
           o.order_number, o.payment_status, o.fulfillment_status,
           coalesce(a.country_code, s.destination_country_code) as country,
           case when s.order_id is not null
                then (select count(*) from public.order_lines l where l.order_id = s.order_id)
                else (select count(*) from public.sale_items i where i.sale_id = s.id) end as item_count,
           case when s.order_id is not null
                then coalesce((select sum(r.amount) from public.order_refunds r where r.order_id = s.order_id), 0)
                else coalesce((select sum(r.amount) from public.sale_refunds r where r.sale_id = s.id), 0) end as refunded,
           -- 0062. Disjoint halves of the same fee table: a shipping
           -- label is in exactly one of them, so no amount is counted twice.
           coalesce((select sum(f.amount) from public.sale_fees f
                      where f.sale_id = s.id and f.kind <> 'shipping_label'), 0) as fees_total,
           coalesce((select sum(f.amount) from public.sale_fees f
                      where f.sale_id = s.id and f.kind = 'shipping_label'), 0) as label_total,
           public.sale_expected_payout(s.id) as expected_payout,
           -- 0063. The one definition, called rather than repeated.
           public.sale_is_test(s.id) as classified_test
      from public.sales s
      left join public.orders o on o.id = s.order_id
      left join public.order_addresses a on a.order_id = s.order_id and a.kind = 'shipping'
  ),
  marked as (
    select b.*,
           /*
            * UNVOLLSTÄNDIG, and the two halves of the ledger answer it
            * differently because different systems own their facts.
            *
            * INTERNAL. Commerce owns everything that matters, so the only
            * thing this can report is a projection that disagrees with it: a
            * sale registered for an order that is not paid, one whose order
            * has no payment time to date it by, or one whose order has no
            * lines. An ordinary paid sandbox or live order is COMPLETE — the
            * Orderbuch's own optional extras being absent says nothing.
            *
            * EXTERNAL. A missing date, always. Plus, for a hand-made sale
            * only, two states that mean "this was started and not finished":
            * no items, and money still sitting at the 0/0 that
            * `seller_create_sale` writes as a placeholder. An imported sale is
            * held to neither, for the same reason as a purchase: its contents
            * and its amounts came from the workbook and cannot be completed
            * from this screen.
            *
            * A missing REPORTED PAYOUT is not here and must not be: the
            * marketplace pays late by design, and `Auszahlung offen` is its
            * own filter.
            */
           (case when b.order_id is not null
                 then b.payment_status is distinct from 'paid'
                   or b.effective_date is null
                   or b.item_count = 0
                 else b.effective_date is null
                   or (b.source = 'manual'
                       and (b.item_count = 0
                            or (coalesce(b.items_subtotal, 0) = 0
                                and coalesce(b.shipping_charged, 0) = 0)))
            end) as is_incomplete,
           /*
            * OFFEN — `seller_book_sale_item`'s own conditions, nothing wider.
            *
            * That function refuses an internal sale (commerce moved the stock
            * when the order was paid), refuses `excel_order_2026` outright
            * ("historical sales never move stock"), and needs a catalog
            * figure. So only a hand-made external line that has not left the
            * shelf is outstanding work — which is the only kind anybody can
            * actually act on from the detail screen.
            */
           (b.order_id is null
            and b.source <> 'excel_order_2026'
            and exists (select 1
                          from public.sale_items i
                         where i.sale_id = b.id
                           and i.movement_id is null
                           and i.sky_id is not null)) as is_open
      from base b
  ),
  filtered as (
    select b.* from marked b
     where (case when coalesce(p_undated, false)
                 then b.effective_date is null
                 else (p_year  is null or extract(year  from b.effective_date) = p_year)
                  and (p_month is null or extract(month from b.effective_date) = p_month)
            end)
       and (p_scope = 'all'
            or (p_scope = 'internal' and b.order_id is not null)
            or (p_scope = 'external' and b.order_id is null))
       and (not coalesce(p_open_payout, false) or b.reported_payout_amount is null)
  ),
  hits as (
    select f.*,
           (select jsonb_agg(jsonb_build_object('id', i.id, 'position', i.position,
                     'name', coalesce(k.name, i.raw_name, i.sky_id)) order by i.position)
              from public.sale_items i
              left join public.skylanders k on k.sky_id = i.sky_id
              left join public.series se on se.code = k.series_code
             where i.sale_id = f.id and v_q is not null
               and (i.raw_name ilike '%'||v_q||'%' or k.name ilike '%'||v_q||'%'
                 or i.sky_id ilike '%'||v_q||'%' or se.label ilike '%'||v_q||'%')) as match_items
      from filtered f
  ),
  searched as (
    select h.* from hits h
     where v_q is null
        or h.match_items is not null
        -- An internal sale matches on its own order lines, too.
        or (h.order_id is not null and exists (
              select 1 from public.order_lines l
               left join public.skylanders k on k.sky_id = l.sky_id
               left join public.series se on se.code = k.series_code
              where l.order_id = h.order_id
                and (l.name_snapshot ilike '%'||v_q||'%' or k.name ilike '%'||v_q||'%'
                  or l.sky_id ilike '%'||v_q||'%' or se.label ilike '%'||v_q||'%')))
        or to_char(h.effective_date, 'DD.MM.YYYY') ilike '%'||v_q||'%'
        or h.effective_date::text        ilike '%'||v_q||'%'
        or coalesce(h.c_subtotal, 0)::text ilike '%'||v_num||'%'
        or coalesce(h.expected_payout, 0)::text ilike '%'||v_num||'%'
        or coalesce(h.order_number, '')  ilike '%'||v_q||'%'
        or coalesce(h.external_order_ref, '') ilike '%'||v_q||'%'
        or coalesce(h.buyer_ref, '')     ilike '%'||v_q||'%'
        or coalesce(h.note, '')          ilike '%'||v_q||'%'
        or h.channel                     ilike '%'||v_q||'%'
  ),
  matched as (
    select r.* from searched r
     where case v_status
             when 'normal'     then not r.classified_test
             when 'incomplete' then not r.classified_test and r.is_incomplete
             when 'open'       then not r.classified_test and r.is_open
             when 'test'       then r.classified_test
             else true
           end
  ),
  -- One statement, for the same reason the Einkauf ledger is one: the page and
  -- the counts are two aggregates over two CTEs of the same query.
  page as (
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'channel', m.channel, 'order_id', m.order_id, 'order_number', m.order_number,
      'sold_at', m.effective_date, 'shipped_at', m.shipped_at,
      'payment_status', m.payment_status, 'fulfillment_status', m.fulfillment_status,
      'country', m.country, 'item_count', m.item_count,
      'items_subtotal', m.c_subtotal, 'shipping_charged', m.c_shipping,
      'discount_amount', m.c_discount, 'refunded', m.refunded,
      'expected_payout', m.expected_payout,
      'reported_payout', m.reported_payout_amount,
      'payout_difference', case when m.reported_payout_amount is null then null
                                else round(m.reported_payout_amount - m.expected_payout, 2) end,
      'buyer_ref', m.buyer_ref, 'external_order_ref', m.external_order_ref,
      'fees_total', m.fees_total, 'label_total', m.label_total,
      'source', m.source, 'note', m.note,
      -- The concurrency token an editor reads and sends back (0062).
      'updated_at', m.updated_at,
      'is_test', m.classified_test, 'is_incomplete', m.is_incomplete,
      'is_open', m.is_open,
      'match_items', m.match_items)
      order by m.effective_date desc nulls last, m.id desc), '[]'::jsonb) as page_rows,
    jsonb_build_object(
      'sale_count', count(*),
      'item_count', coalesce(sum(m.item_count), 0),
      'gross',      coalesce(sum(coalesce(m.c_subtotal,0) + coalesce(m.c_shipping,0) - coalesce(m.c_discount,0)), 0),
      'refunded',   coalesce(sum(m.refunded), 0),
      'fees_total',   coalesce(sum(m.fees_total), 0),
      'label_total',  coalesce(sum(m.label_total), 0),
      'expected_payout', coalesce(sum(m.expected_payout), 0),
      'reported_payout', coalesce(sum(m.reported_payout_amount), 0),
      'open_payouts', count(*) filter (where m.reported_payout_amount is null),
      'mismatched',   count(*) filter (where m.reported_payout_amount is not null
                                         and round(m.reported_payout_amount - m.expected_payout, 2) <> 0)) as page_summary
  from matched m
  ),
  counts as (
    select jsonb_build_object(
             'normal',     count(*) filter (where not r.classified_test),
             'incomplete', count(*) filter (where not r.classified_test and r.is_incomplete),
             'open',       count(*) filter (where not r.classified_test and r.is_open),
             'test',       count(*) filter (where r.classified_test)) as classification
      from searched r
  )
  select page.page_rows, page.page_summary, counts.classification
    into v_rows, v_sum, v_class
    from page cross join counts;

  return jsonb_build_object('sales', v_rows, 'summary', v_sum,
                            'classification', v_class);
end;
$$;

comment on function public.seller_sales(integer, integer, text, boolean, text, boolean, text) is
  'One filtered, searched page of the Verkauf ledger plus its summary and its classification counts (0059, 0062, 0063, `Offen` 0066). `p_scope` is the channel axis and `p_status` the classification axis; they are independent. `is_open` asks exactly what seller_book_sale_item would accept — internal and imported sales are therefore never open.';
