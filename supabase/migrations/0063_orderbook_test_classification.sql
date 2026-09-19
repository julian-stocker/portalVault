-- ===========================================================================
-- 0063 — a test transaction is a classification, not a channel
--
-- ---------------------------------------------------------------------------
-- WHAT THIS ADDS, AND WHAT IT REFUSES TO ADD
--
-- Two questions the Orderbuch could not answer:
--
--   "Is this record a test?"          -> a classification, new here.
--   "Does this record still need      -> `Unvollständig`, DERIVED from the
--    work before it is finished?"        row's own state, stored nowhere.
--
-- They are independent of each other and independent of `Intern`/`Extern`.
-- A test sale is still an external sale; an incomplete sale is still a real
-- one. Nothing below collapses any of the three into an enum.
--
-- ---------------------------------------------------------------------------
-- WHY TEST IS A COLUMN ON ONE SIDE AND A DERIVATION ON THE OTHER
--
-- An internal sale ALREADY carries the answer, one join away and frozen for
-- ever: `orders.commerce_mode` is stamped when the order is placed and
-- `orders_protect_immutable()` refuses to change it afterwards (0021). It is
-- the same signal the order screens have used since 0046 to keep test orders
-- out of the live list. Copying it onto `sales` would create a second truth
-- about one order that nothing keeps in step — so this does not copy it. It
-- reads it.
--
-- A hand-made purchase or external sale has no such signal. There is no
-- payment provider to ask, no environment stamped on it, nothing but what the
-- operator typed. So those get one explicit boolean each, defaulting to false.
--
-- NOT the note text. `TESTKAUF 0063-smoke` identifies two known rows ONCE, in
-- the backfill at the end of this file, with every other field of the row
-- checked at the same time. Nothing at runtime ever reads a note to decide
-- what a record is: a note is prose, the operator may rewrite it, and a
-- classification that changes when somebody fixes a typo is not one.
--
-- ---------------------------------------------------------------------------
-- WHY `Unvollständig` IS NOT A COLUMN
--
-- Because it would be wrong within a day. A purchase that gets its date, a
-- sale that gets its first item — each of those has to LEAVE the class, and a
-- stored boolean only leaves it if somebody remembers to clear it. Every rule
-- below reads the row as it is now, so the classification corrects itself the
-- moment the underlying fact does.
--
-- THE RULES, stated once here and implemented once each below.
--
--   Einkauf              purchased_at is null
--                        OR (source = 'manual' and it has no items at all)
--
--   Verkauf Extern       sold_at is null
--                        OR (source = 'manual' and it has no items)
--                        OR (source = 'manual' and subtotal and shipping are
--                            both 0 — the placeholder `seller_create_sale`
--                            writes, i.e. the money was never entered)
--
--   Verkauf Intern       the order is not paid
--                        OR the order has no paid_at
--                        OR the order has no lines
--
-- WHAT IS DELIBERATELY *NOT* INCOMPLETE, because it is ordinary open business
-- rather than a gap in the record:
--
--   * a missing reported payout. The marketplace pays when it pays; `Offen`
--     is its own filter and has been since 0059.
--   * a purchase item not yet `Einbuchen`. The parcel has not arrived. That is
--     a state, not an omission.
--   * a sale item not yet `Ausbuchen`. Same.
--   * an empty note, buyer reference, external reference or country.
--   * a suspicious YEAR. The workbook contains one sale dated 2028-06-28 and
--     this migration does not touch it. `2028` is not a rule; `seller_set_
--     sale_date` already refuses implausible dates on the way IN, and reading
--     a stored date as wrong because it looks odd would be a guess.
--   * anything at all about a HISTORICAL row other than its missing date. An
--     imported row's items are the workbook's, not the operator's: nobody can
--     add one here, so an imported group that arrived without items would sit
--     in a work list for ever with nothing anybody could do about it. The one
--     thing a `#REF!` group genuinely still needs is its date, and that is the
--     one thing the rule asks of it. (On Staging today every imported group
--     does carry items, so this scoping changes no current row — it is there
--     so that a future import cannot flood the list.)
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT TOUCH
--
-- No inventory. No movement. No amount. No `source`, no `import_fingerprint`,
-- no channel, no date. Nothing is deleted and nothing historical is rewritten
-- — the backfill at the end marks exactly two rows, each identified by four
-- fields at once, and marking is the only thing it does.
--
-- DEPENDS ON 0053 (purchases), 0059 (sales), 0062 (the audit trail and the
-- concurrency token), 0021 (`orders.commerce_mode`).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The two columns
--
-- `not null default false` on both: a record is a normal business record
-- unless somebody says otherwise, including every record that already exists
-- and every one an importer writes without mentioning the column.
-- ---------------------------------------------------------------------------

alter table public.purchases
  add column if not exists is_test boolean not null default false;

comment on column public.purchases.is_test is
  'True when this purchase is a deliberate test, not real expenditure (0063). Set at creation or corrected afterwards by a seller operator; never inferred from the note, never set by an importer. It changes no amount, no item, no stock and no provenance — only which list the row appears in.';

alter table public.sales
  add column if not exists is_test boolean not null default false;

comment on column public.sales.is_test is
  'True when this EXTERNAL sale is a deliberate test (0063). Meaningless for an internal sale, which takes its answer from `orders.commerce_mode` instead — see `sale_is_test()` — and is held at false by a constraint so no second truth can exist.';

/*
 * An internal sale may not carry its own answer.
 *
 * Not tidiness: `orders.commerce_mode` is frozen and this column is editable,
 * so allowing both would allow them to disagree, and nothing downstream could
 * say which one was right. The constraint makes the disagreement unstatable.
 */
alter table public.sales drop constraint if exists sales_internal_test_is_derived;
alter table public.sales
  add constraint sales_internal_test_is_derived
    check (order_id is null or is_test = false);

-- Small partial indexes: the Test view is a rare selection out of a mostly
-- normal table, which is exactly what a partial index is for.
create index if not exists purchases_test_idx on public.purchases (id) where is_test;
create index if not exists sales_test_idx     on public.sales (id)     where is_test;


-- ---------------------------------------------------------------------------
-- 2. One definition of "this sale is a test"
--
-- Every reader below calls this rather than repeating the CASE. The list, the
-- detail document and the counts therefore cannot drift apart, which is the
-- failure this project has already paid for once elsewhere.
--
-- `stable`, reads two tables, writes nothing. Internal: the screens reach it
-- through the seller-gated functions that call it, never directly.
-- ---------------------------------------------------------------------------

create or replace function public.sale_is_test(p_sale_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
           -- External: what the operator said.
           when s.order_id is null then s.is_test
           -- Internal: what commerce recorded, frozen when the order was
           -- placed. `sandbox` is the test world; `live` and `closed` are not.
           else o.commerce_mode = 'sandbox'
         end
    from public.sales s
    left join public.orders o on o.id = s.order_id
   where s.id = p_sale_id;
$$;

comment on function public.sale_is_test(bigint) is
  'Is this sale a test transaction (0063)? External sales answer from their own `is_test`; internal sales answer from the immutable `orders.commerce_mode`, so a sandbox checkout classifies itself and a live one never can. The single definition — every reader calls this one.';

revoke all on function public.sale_is_test(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Creating a record that is a test from the start
--
-- Both signatures gain one trailing argument with a default, and both old
-- signatures are DROPPED rather than left beside the new ones. An overload
-- that differs only by a defaulted trailing argument makes every existing
-- call ambiguous, which Postgres reports at call time rather than here.
-- ---------------------------------------------------------------------------

drop function if exists public.seller_create_purchase(date, numeric, text);

create or replace function public.seller_create_purchase(
  p_purchased_at date,
  p_total_cost   numeric,
  p_note         text    default null,
  p_is_test      boolean default false
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
  insert into public.purchases (purchased_at, total_cost, note, is_test, created_by, updated_by)
  values (p_purchased_at, p_total_cost, nullif(btrim(coalesce(p_note, '')), ''),
          coalesce(p_is_test, false), (select auth.uid()), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.seller_create_purchase(date, numeric, text, boolean) is
  'Creates one purchase (0053, test classification 0063). Stocks nothing — `seller_book_purchase_item` is the only path to inventory. `p_is_test` defaults to false, so a normal purchase needs no thought about it.';


drop function if exists public.seller_create_sale(text, date, text, text, text, text);

create or replace function public.seller_create_sale(
  p_channel text,
  p_sold_at date default null,
  p_country text default null,
  p_external_ref text default null,
  p_buyer_ref text default null,
  p_note text default null,
  p_is_test boolean default false
)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  -- `skyisles` is reserved: an internal sale exists because an order was paid,
  -- never because somebody typed it.
  if p_channel = 'skyisles' then
    raise exception 'internal sales are created from a paid order, not by hand'
      using errcode = 'check_violation';
  end if;
  insert into public.sales (channel, sold_at, destination_country_code,
                            external_order_ref, buyer_ref, note, source, is_test,
                            items_subtotal, shipping_charged, discount_amount,
                            created_by, updated_by)
  values (p_channel, p_sold_at, upper(nullif(btrim(coalesce(p_country,'')),'')),
          nullif(btrim(coalesce(p_external_ref,'')),''), nullif(btrim(coalesce(p_buyer_ref,'')),''),
          nullif(btrim(coalesce(p_note,'')),''), 'manual', coalesce(p_is_test, false),
          0, 0, 0, (select auth.uid()), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.seller_create_sale(text, date, text, text, text, text, boolean) is
  'Creates one external sale (0059, test classification 0063). Refuses the `skyisles` channel, moves no stock, and starts the money at zero — the amounts are a separate, audited edit.';


-- ---------------------------------------------------------------------------
-- 4. Correcting the classification afterwards
--
-- A record created as normal turns out to have been a test, or the reverse.
-- Both are one-column corrections: no amount, no channel, no date, no
-- provenance, no fingerprint, no inventory. Neither function so much as names
-- those columns.
-- ---------------------------------------------------------------------------

create or replace function public.seller_set_purchase_test(
  p_id bigint, p_is_test boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  update public.purchases p
     set is_test    = coalesce(p_is_test, false),
         updated_at = now(),
         updated_by = (select auth.uid())
   where p.id = p_id;
  if not found then
    raise exception 'no such purchase' using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.seller_set_purchase_test(bigint, boolean) is
  'Marks a purchase as a test, or takes the mark away (0063). Touches one column and the audit stamps beside it; never the cost, the items, the provenance or stock.';


/*
 * The sale side additionally joins 0062's machinery, because sales have it:
 * one concurrency token per sale, and an append-only record of what was
 * corrected. `orderbook_audit` already accepts entity type `sale`, so the
 * change lands in the same history the detail screen already reads.
 *
 * `purchases` has no such trail and this migration does not invent one for it
 * — a second audit architecture for one boolean would cost more than it tells.
 */
create or replace function public.seller_set_sale_test(
  p_id bigint, p_is_test boolean, p_expected_updated_at timestamptz default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_old boolean; v_internal boolean;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select s.is_test, s.order_id is not null into v_old, v_internal
    from public.sales s where s.id = p_id;
  if not found then
    raise exception 'no such sale' using errcode = 'no_data_found';
  end if;

  /*
   * An internal sale's answer belongs to the order it projects. Changing it
   * here would mean an order placed in sandbox that claims to be real, or a
   * real order filed under Test — and `orders.commerce_mode` is immutable
   * precisely so that cannot happen.
   */
  if v_internal then
    raise exception 'an internal sale takes its test status from the order'
      using errcode = 'restrict_violation';
  end if;

  perform public.orderbook_guard_stale(p_id, p_expected_updated_at);

  update public.sales s
     set is_test    = coalesce(p_is_test, false),
         updated_at = now(),
         updated_by = (select auth.uid())
   where s.id = p_id;

  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'is_test',
                               v_old::text, coalesce(p_is_test, false)::text);
end;
$$;

comment on function public.seller_set_sale_test(bigint, boolean, timestamptz) is
  'Marks an external sale as a test, or takes the mark away (0063). Refuses an internal sale, refuses a stale edit, records the change in orderbook_audit, and touches no money, no channel, no date, no provenance and no stock.';


-- ---------------------------------------------------------------------------
-- 5. The Einkauf ledger learns the two classifications
--
-- The signature gains `p_status`, so the four-argument version is dropped.
--
--   'normal'      everything that is NOT a test      <- the default
--   'incomplete'  normal AND still needs work
--   'test'        exactly the tests, finished or not
--   'any'         no classification filter at all
--
-- 'normal' is the default because the owner asked for a business ledger that
-- test data does not sit in the middle of. Nothing is hidden silently: the
-- same call returns the counts for all three classes, so the screen can say
-- how many test rows exist and where they went.
--
-- 'any' exists for one caller — the year filter, which must offer 2026 even
-- while the view showing 2026 is the Test one.
-- ---------------------------------------------------------------------------

drop function if exists public.seller_orderbook_ledger(integer, integer, text, boolean);

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
  if v_status not in ('normal', 'incomplete', 'test', 'any') then
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
            or (p.source = 'manual' and v.total_items = 0)) as is_incomplete
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
      'is_test', m.is_test, 'is_incomplete', m.is_incomplete)
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
  'One filtered, searched page of the Einkauf ledger plus its summary and its classification counts (0056, series search 0057, undated 0058, Test/Unvollständig 0063). `p_status` selects normal (the default, test excluded), incomplete, test, or any. The summary aggregates exactly the rows returned, so normal business totals never contain test expenditure. The factor is SUM(cost)/SUM(value), never an average of per-purchase factors.';


-- ---------------------------------------------------------------------------
-- 6. The Verkauf ledger learns the same two, with its own incompleteness rule
--
-- The signature gains `p_status`, so the six-argument version is dropped.
--
-- `Intern` and `Extern` stay exactly what they were — a scope over `order_id`
-- — and the classification is a second, independent axis on top. A test sale
-- is still internal or external; nothing below moves a row between scopes.
-- ---------------------------------------------------------------------------

drop function if exists public.seller_sales(integer, integer, text, boolean, text, boolean);

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
  if v_status not in ('normal', 'incomplete', 'test', 'any') then
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
            end) as is_incomplete
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
  'One filtered, searched page of the Verkauf ledger plus its summary and its classification counts (0059, aggregates 0062, Test/Unvollständig 0063). `p_scope` is the channel axis and `p_status` the classification axis; they are independent. The summary aggregates exactly the rows returned, so normal business totals never contain test revenue.';


-- ---------------------------------------------------------------------------
-- 7. The sale document says which classification it carries
--
-- Same signature, same return type, one added key and one added field on the
-- order — so `create or replace` is safe and every existing caller keeps
-- working. The screen needs `commerce_mode` to explain WHY an internal sale is
-- a test, and `is_test` so it never has to work that out itself.
-- ---------------------------------------------------------------------------

create or replace function public.seller_sale(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_sale record; v_out jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_sale from public.sales where id = p_id;
  if not found then return null; end if;

  select jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'is_test', public.sale_is_test(p_id),
    'expected_payout', public.sale_expected_payout(p_id),
    'buy_in', public.sale_buy_in(p_id),
    'order', case when v_sale.order_id is null then null else (
      select jsonb_build_object('id', o.id, 'order_number', o.order_number,
        'paid_at', o.paid_at, 'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_status, 'shipped_at', o.shipped_at,
        'items_subtotal', o.items_subtotal, 'shipping_amount', o.shipping_amount,
        'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
        'currency', o.currency,
        -- Which world the order was placed in, frozen when it was placed.
        'commerce_mode', o.commerce_mode,
        'country', (select a.country_code from public.order_addresses a
                     where a.order_id = o.id and a.kind = 'shipping' limit 1),
        'refunded', coalesce((select sum(r.amount) from public.order_refunds r where r.order_id = o.id), 0),
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', l.id, 'sky_id', l.sky_id, 'name', coalesce(k.name, l.name_snapshot),
                    'series_code', k.series_code, 'condition', l.condition,
                    'quantity', l.quantity, 'unit_price', l.unit_price,
                    'line_total', l.line_total,
                    'market_price', k.market_price) order by l.id)
                  from public.order_lines l
                  left join public.skylanders k on k.sky_id = l.sky_id
                  where l.order_id = o.id), '[]'::jsonb))
      from public.orders o where o.id = v_sale.order_id) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', i.id, 'position', i.position, 'sky_id', i.sky_id,
                'name', coalesce(k.name, i.raw_name, i.sky_id), 'raw_name', i.raw_name,
                'series_code', k.series_code, 'condition', i.condition,
                'market_price', coalesce(i.market_price_snapshot, k.market_price),
                'price_is_frozen', i.market_price_snapshot is not null,
                'movement_id', i.movement_id, 'returned_at', i.returned_at,
                'return_movement_id', i.return_movement_id,
                'legacy_stock_flag', i.legacy_stock_flag,
                'legacy_shipped_flag', i.legacy_shipped_flag,
                'source_row', i.source_row) order by i.position)
              from public.sale_items i
              left join public.skylanders k on k.sky_id = i.sky_id
              where i.sale_id = p_id), '[]'::jsonb),
    'fees', coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.sale_fees f where f.sale_id = p_id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.sale_refunds r where r.sale_id = p_id), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.settlement_adjustments a where a.sale_id = p_id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

comment on function public.seller_sale(bigint) is
  'One sale as a document: the row, its order when internal, its items, fees, refunds and adjustments, plus the test classification and the commerce mode behind it (0059, 0063).';


-- ---------------------------------------------------------------------------
-- 8. Privileges
--
-- Each dropped-and-recreated function lost its grants with the drop. The two
-- internal helpers — `sale_is_test` and the readers' own dependencies — are
-- granted to nobody; the tables gain nothing for any client role.
-- ---------------------------------------------------------------------------

do $$
declare fn text;
begin
  foreach fn in array array[
    'seller_create_purchase(date, numeric, text, boolean)',
    'seller_create_sale(text, date, text, text, text, text, boolean)',
    'seller_set_purchase_test(bigint, boolean)',
    'seller_set_sale_test(bigint, boolean, timestamptz)',
    'seller_orderbook_ledger(integer, integer, text, boolean, text)',
    'seller_sales(integer, integer, text, boolean, text, boolean, text)',
    'seller_sale(bigint)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 9. The two retained Staging smoke records, marked once
--
-- IDENTIFIED BY FOUR FIELDS AT ONCE, not by a note and not by an id.
--
-- An id alone would mark whatever happens to be row 94 in whatever database
-- this runs against. A note alone is prose the operator may rewrite. Together
-- with the source and the absence of an import fingerprint they identify these
-- two rows and nothing else: on Production — where the Orderbuch does not
-- exist at all — both statements match zero rows and change nothing.
--
-- This is the ONLY place in the system where note text decides anything, it
-- runs once, and it writes one boolean.
--
-- Deliberately NOT marked: the imported history, in either table. Not one
-- `excel_order_2026` row is touched, and both statements say so as a
-- condition rather than as a hope.
-- ---------------------------------------------------------------------------

update public.purchases p
   set is_test = true
 where p.id = 94
   and p.source = 'manual'
   and p.import_fingerprint is null
   and p.note = 'TESTKAUF 0063-smoke';

update public.sales s
   set is_test = true
 where s.id = 312
   and s.source = 'manual'
   and s.order_id is null
   and s.import_fingerprint is null
   and s.external_order_ref = 'TESTVERKAUF-0063';
