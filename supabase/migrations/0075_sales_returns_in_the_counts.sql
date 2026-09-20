-- ===========================================================================
-- 0075 — A RETURNED POSITION IS NOT AN OUTBOOKED ONE
-- ===========================================================================
--
-- 0072 counted `outbooked_count` as "has a movement". That is wrong the
-- moment the goods come back: the piece left the shelf and returned to it,
-- and a sale whose every position did that is finished — but it is not
-- `Ausgebucht`, because nothing is out.
--
-- Staging has the case in front of it. Sale 15 is a leftover smoke run whose
-- one position was booked out at 20:35:20 and restocked at 20:35:23. It
-- reported `Ausgebucht ✓` while the figure sat on the shelf.
--
-- So `outbooked_count` now means "left the shelf AND is still gone", and the
-- other three endings get their own counts:
--
--   outbooked_count     movement, no return announced, arrived or restocked
--   restocked_count     a real `return` movement exists
--   settled_count       closed without a movement (0071/0073)
--   not_shipped_count   never sent, so never booked (0074)
--   closed_count        any of the four
--   open_count          item_count - closed_count
--
-- NONE OF THEM IS EVER ADDED TO ANOTHER. Four endings, four numbers, and
-- the tick in the ledger belongs to exactly one of them.
--
-- WHAT COUNTS AS FINISHED, IN ONE PLACE
--
-- `sale_item_is_closed()` is the predicate, written once and used by
-- `is_open` and by `closed_count` — the two places that used to answer the
-- same question with two expressions. A position with a movement and an
-- announced return is NOT finished: the goods are on their way back and
-- somebody still has to put them away.
--
-- READ-ONLY. One immutable helper and one `stable` function. No movement,
-- no stock, no row written.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. What "finished" means, written once
-- ---------------------------------------------------------------------------

create or replace function public.sale_item_is_closed(p_item public.sale_items)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    /* Came back and was put away. */
    p_item.return_movement_id is not null
    /* Left the shelf and stayed gone. */
    or (p_item.movement_id is not null
        and p_item.return_announced_at is null
        and p_item.returned_at is null)
    /* Closed without a movement, because there was no stock to move. */
    or p_item.settled_at is not null
    /* Never sent, so the stock never moved and never has to. */
    or p_item.not_shipped_at is not null;
$$;

comment on function public.sale_item_is_closed(public.sale_items) is
  'Is there anything left to do with this sold position (0075)? Four endings count as finished: restocked, booked out and still gone, closed without a movement, or never sent. A position whose return has been announced or has arrived is NOT finished — somebody still has to put it away. One predicate, used by `is_open` and by `closed_count`, so the two cannot drift.';


-- ---------------------------------------------------------------------------
-- 2. The ledger
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
            * OFFEN — what is still to be DONE, which is not the same as what
            * can be BOOKED (0072).
            *
            * An internal sale is never open: commerce moved the stock when
            * the order was paid. A cancelled order is never open: nothing
            * left the shelf and nothing has to. A workbook sale is open only
            * if 0071 released it — the other 271 stay frozen, which is the
            * same refusal `seller_book_sale_item` makes.
            *
            * The item test asks for neither a movement NOR a `settled_at`,
            * and no longer asks for a `sky_id`. A portal in a shipped parcel
            * cannot be booked and is plainly not dealt with either; it
            * becomes dealt with by being settled. Same reasoning as 0068 on
            * the Einkauf side.
            */
           (b.cancelled_at is null
            and b.order_id is null
            and (b.source <> 'excel_order_2026' or b.stock_released_at is not null)
            and exists (select 1
                          from public.sale_items i
                         where i.sale_id = b.id
                           and not public.sale_item_is_closed(i))) as is_open,
           /*
            * THREE COUNTS, AND THEY ARE THREE (0072).
            *
            *   outbooked  a real `sale_external` movement exists. This and
            *              only this is `Ausgebucht`.
            *   settled    finished WITHOUT a movement: a non-catalog article,
            *              or a line the workbook marked `L = "-"` — shipped,
            *              deliberately not taken from the shelf.
            *   open       item_count minus both.
            *
            * `settled` is never added to `outbooked`. A settled position did
            * not leave figure inventory, and the tick in the ledger means
            * exactly that it did.
            */
           (select count(*) from public.sale_items i
             where i.sale_id = b.id
               and i.movement_id is not null and i.return_movement_id is null
               and i.return_announced_at is null and i.returned_at is null)::integer
             as outbooked_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and i.return_movement_id is not null)::integer
             as restocked_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and i.settled_at is not null)::integer as settled_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and i.not_shipped_at is not null)::integer
             as not_shipped_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and public.sale_item_is_closed(i))::integer as closed_count
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
      'cancelled_at', m.cancelled_at,
      'stock_released_at', m.stock_released_at,
      'outbooked_count', m.outbooked_count,
      'restocked_count', m.restocked_count,
      'settled_count', m.settled_count,
      'not_shipped_count', m.not_shipped_count,
      'closed_count', m.closed_count,
      'open_count', m.item_count - m.closed_count,
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
  'One filtered, searched page of the Verkauf ledger plus its summary and its classification counts (0059, 0062, 0063, `Offen` 0066, released historical sales and the three endings 0072). `p_scope` is the channel axis and `p_status` the classification axis; they are independent. A sale is open when it is not cancelled, not an order, either hand-made or released by 0071, and still holds a position with neither a movement nor a `settled_at`. `outbooked_count` counts positions that left the shelf AND are still gone — a return in progress or a restocking takes them out of it again, which is why a fully returned order never reports itself as outbooked (0075). `restocked_count`, `settled_count` and `not_shipped_count` are the other three endings, each counted on its own and never added to the first. `closed_count` is how many positions are finished by any route, and `open_count` is the rest.';
