-- ===========================================================================
-- 0059 — Verkauf: one sales ledger, two origins
--
-- WHAT THIS IS FOR
--
-- The owner sells in two places and keeps one spreadsheet. SkyIsles already
-- owns everything about a shop order — amounts, lines, address, payment,
-- refunds, and the inventory movement — and knows nothing at all about an eBay
-- sale. The Orderbuch has to show both as one ledger without inventing a
-- second commerce system and without copying the one that exists.
--
--
-- THE RULE THAT SHAPES EVERY TABLE BELOW
--
--     If commerce owns the fact, Orderbuch reads it and never writes it.
--
-- So an internal sale is a THIN ROW that points at `orders` and stores only
-- what commerce does not have: fees, the reported payout, the analytical
-- snapshots, a note. Its amounts, its items, its country and its refunds are
-- read through the link and therefore cannot drift. An external sale has no
-- order to point at, so it owns those facts itself.
--
-- One constraint states it:
--
--     (channel = 'skyisles') = (order_id is not null)
--
--
-- THREE DIMENSIONS, NOT ONE STATUS
--
--   money      sale · fees · refunds · adjustments · expected vs reported payout
--   stock      available · ausgebucht · retourniert · wieder eingelagert
--   shipping   nicht versendet · versendet
--
-- They move independently — a sale can be shipped, refunded, not returned and
-- payout-open at the same instant — so none of them is an enum column that
-- tries to encode the other two.
--
--
-- AND HISTORY IS NOT OPERATION
--
-- The 293 imported Excel sales are reconciliation. Current stock was
-- synchronised separately and must not move for them, even where the workbook
-- says an item left the shelf. A trigger enforces that rather than a comment.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The sale
-- ---------------------------------------------------------------------------

create table if not exists public.sales (
  id bigint generated always as identity primary key,

  -- Where the sale happened. `skyisles` is reserved for the linked internal
  -- case; everything else is a channel the owner operates by hand. Text, not
  -- an enum: a new marketplace should not need a migration.
  channel text not null,

  -- The canonical order, for internal sales only. NOT a copy of it.
  order_id bigint,

  -- NULL means the date is not known yet — the same meaning 0058 gave a
  -- purchase, and for the same reason: five historical sale groups carry a
  -- typo where their date should be, and a guess would outlive the guesser.
  sold_at date,
  shipped_at timestamptz,

  destination_country_code text,
  currency text not null default 'EUR',

  -- EXTERNAL ONLY. For an internal sale these live on `orders` and reading
  -- them from anywhere else is how two numbers start disagreeing.
  items_subtotal   numeric(10,2),
  shipping_charged numeric(10,2),
  discount_amount  numeric(10,2),

  -- What the channel actually paid. Never derived, never seeded from our own
  -- arithmetic: a reconciliation value computed from the thing it reconciles
  -- against reconciles nothing.
  reported_payout_amount numeric(10,2),
  reported_payout_ref    text,
  reported_payout_at     timestamptz,

  -- Frozen when the sale is confirmed. Analytical only — see
  -- `sale_buy_in()`. It is market value times a ratio and has never been the
  -- acquisition cost of any particular figure.
  buy_in_factor_snapshot numeric(12,6),

  external_order_ref text,
  buyer_ref text,
  note text,

  source text not null,            -- 'commerce' | 'manual' | 'excel_order_2026'
  import_fingerprint text,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,

  constraint sales_channel_known check (channel in ('skyisles', 'ebay', 'manual')),
  constraint sales_source_known  check (source in ('commerce', 'manual', 'excel_order_2026')),
  -- The rule, as a constraint.
  constraint sales_internal_has_order check ((channel = 'skyisles') = (order_id is not null)),
  -- …and its consequence: an internal sale stores no amounts of its own.
  constraint sales_internal_owns_no_amounts check (
    order_id is null
    or (items_subtotal is null and shipping_charged is null and discount_amount is null)),
  constraint sales_external_has_subtotal check (order_id is not null or items_subtotal is not null),
  constraint sales_amounts_positive check (
    coalesce(items_subtotal, 0)   >= 0 and coalesce(items_subtotal, 0)   <= 1000000
    and coalesce(shipping_charged, 0) >= 0
    and coalesce(discount_amount, 0)  >= 0),
  constraint sales_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint sales_country_iso  check (destination_country_code is null
                                       or destination_country_code ~ '^[A-Z]{2}$'),
  constraint sales_note_shape   check (note is null or length(btrim(note)) > 0),
  constraint sales_fingerprint_shape
    check (import_fingerprint is null or import_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sales_reported_payout_pair
    check ((reported_payout_amount is null) = (reported_payout_at is null)),
  constraint sales_order_fk foreign key (order_id)
    references public.orders (id) on delete restrict,
  constraint sales_created_by_fk foreign key (created_by) references auth.users (id) on delete set null,
  constraint sales_updated_by_fk foreign key (updated_by) references auth.users (id) on delete set null
);

-- One sale per order. This index IS the idempotency of internal registration:
-- two concurrent webhooks race into it and one loses, rather than both winning.
create unique index if not exists sales_order_uniq
  on public.sales (order_id) where order_id is not null;

create unique index if not exists sales_import_fingerprint_uniq
  on public.sales (import_fingerprint) where import_fingerprint is not null;

create index if not exists sales_sold_at_idx on public.sales (sold_at desc nulls last, id desc);
create index if not exists sales_channel_idx on public.sales (channel);

comment on table public.sales is
  'One sale, internal or external (ADR-0089). An internal sale is a thin row pointing at `orders` and owning only what commerce lacks — fees, reported payout, snapshots, note. An external sale owns its own amounts and items. `sold_at` NULL means the date is not known yet.';

alter table public.sales enable row level security;
revoke all on table public.sales from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. One physical object, one row
--
-- EXTERNAL AND HISTORICAL ONLY. An internal sale's items are `order_lines`,
-- and copying them here to save a join would create the drift this whole
-- design exists to avoid.
--
-- WHY THE CONSTRAINTS ARE NOT AN ENUM
--
-- An item can be sold, then returned, then restocked — three independent facts
-- with three independent timestamps, and a `state` column would have to encode
-- their product. So each fact is its own column and each constraint guards one
-- real invariant:
--
--   a movement means a figure was identified          (movement -> sky_id)
--   you cannot restock what never came back           (return_movement -> returned_at)
--   you cannot restock what was never booked out      (return_movement -> movement)
--   a historical row owns no movement at all          (trigger, below)
-- ---------------------------------------------------------------------------

create table if not exists public.sale_items (
  id bigint generated always as identity primary key,
  sale_id bigint not null,
  position integer not null,

  sky_id text,
  raw_name text,
  condition text not null default 'loose',

  -- Frozen at Ausbuchen. NULL on a historical row, deliberately: the
  -- workbook's `Markt Ez` is a LIVE reference, so no sale-time value exists to
  -- import and inventing one from today's price would be a lie with a date on
  -- it.
  market_price_snapshot numeric(10,2),
  market_price_snapshot_at timestamptz,

  movement_id bigint,
  returned_at timestamptz,
  return_movement_id bigint,

  -- The workbook's own two markers. Provenance, never an instruction.
  legacy_stock_flag text,
  legacy_shipped_flag text,
  source_row integer,

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sale_items_sale_fk foreign key (sale_id)
    references public.sales (id) on delete cascade,
  constraint sale_items_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id) on update cascade,
  constraint sale_items_movement_fk foreign key (movement_id)
    references public.inventory_movements (id) on delete restrict,
  constraint sale_items_return_movement_fk foreign key (return_movement_id)
    references public.inventory_movements (id) on delete restrict,
  constraint sale_items_condition_known check (condition in ('loose', 'boxed')),
  constraint sale_items_identifiable
    check (sky_id is not null or (raw_name is not null and length(btrim(raw_name)) > 0)),
  constraint sale_items_movement_needs_figure
    check (movement_id is null or sky_id is not null),
  constraint sale_items_restock_needs_return
    check (return_movement_id is null or returned_at is not null),
  constraint sale_items_restock_needs_movement
    check (return_movement_id is null or movement_id is not null),
  constraint sale_items_position_positive check (position >= 1),
  constraint sale_items_flag_shape check (
    (legacy_stock_flag is null or length(legacy_stock_flag) <= 4)
    and (legacy_shipped_flag is null or length(legacy_shipped_flag) <= 4))
);

create unique index if not exists sale_items_movement_uniq
  on public.sale_items (movement_id) where movement_id is not null;
create unique index if not exists sale_items_return_movement_uniq
  on public.sale_items (return_movement_id) where return_movement_id is not null;
create index if not exists sale_items_sale_idx on public.sale_items (sale_id, position);

comment on table public.sale_items is
  'One physical object sold outside SkyIsles, or one row of imported history (ADR-0089). Internal sales use `order_lines` instead. A historical row never owns an inventory movement, whatever the workbook said.';

alter table public.sale_items enable row level security;
revoke all on table public.sale_items from public, anon, authenticated;


/*
 * History cannot move stock. Ever.
 *
 * The importer simply never passes a movement, which is true and unenforced —
 * and an unenforced invariant is a comment. This is the enforcement: an
 * imported row that somehow acquired a movement is refused at the boundary,
 * not discovered later in a reconciliation.
 */
create or replace function public.sale_items_no_historical_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_source text;
begin
  if new.movement_id is null and new.return_movement_id is null then
    return new;
  end if;
  select s.source into v_source from public.sales s where s.id = new.sale_id;
  if v_source = 'excel_order_2026' then
    raise exception 'a historical sale item cannot own an inventory movement'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists sale_items_no_historical_movement_trg on public.sale_items;
create trigger sale_items_no_historical_movement_trg
  before insert or update on public.sale_items
  for each row execute function public.sale_items_no_historical_movement();


-- ---------------------------------------------------------------------------
-- 3. Fees — rows, not columns
--
-- The workbook had `Fee Trans`, `Fee eBay`, `lbl eBay`, `lbl ext` and `Fee S.`
-- as five fixed columns, and a sixth kind of cost would have needed a sixth.
--
-- `settled_by` is the important field and it applies to EVERY fee, not just
-- labels: a fee the channel deducts reduces the payout, a fee paid elsewhere
-- does not. That single attribute is what made `lbl eBay` and `lbl ext` two
-- columns, and it collapses them into one kind with two settlements.
--
-- Amounts are positive magnitudes. Nobody should have to know whether a fee is
-- typed as 5.00 or -5.00 — see `settlement_adjustments` for the signed case.
-- ---------------------------------------------------------------------------

create table if not exists public.sale_fees (
  id bigint generated always as identity primary key,
  sale_id bigint not null,
  kind text not null,              -- payment | marketplace | shipping_label | other
  label text,                      -- required for `other`, so it means something
  amount numeric(10,2) not null,
  settled_by text not null,        -- channel | external
  note text,
  created_at timestamptz not null default now(),
  created_by uuid,

  constraint sale_fees_sale_fk foreign key (sale_id) references public.sales (id) on delete cascade,
  constraint sale_fees_kind_known check (kind in ('payment', 'marketplace', 'shipping_label', 'other')),
  constraint sale_fees_settled_known check (settled_by in ('channel', 'external')),
  constraint sale_fees_amount_positive check (amount >= 0 and amount <= 1000000),
  constraint sale_fees_other_has_label
    check (kind <> 'other' or (label is not null and length(btrim(label)) > 0)),
  constraint sale_fees_created_by_fk foreign key (created_by) references auth.users (id) on delete set null
);

create index if not exists sale_fees_sale_idx on public.sale_fees (sale_id);

comment on table public.sale_fees is
  'A cost belonging to one sale (ADR-0089). `settled_by` decides whether it reduces the channel payout — the distinction the workbook kept as two separate label columns. Always a positive magnitude.';

alter table public.sale_fees enable row level security;
revoke all on table public.sale_fees from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Refunds — financial events, and only financial
--
-- The workbook proves the separation it never stated: 41 orders carry a refund
-- and 6 contain returned goods. Money coming back says nothing about whether
-- anything did.
--
-- Internal sales are NOT represented here. Their refunds are `order_refunds`,
-- which commerce owns; duplicating them would mean two answers to one question.
-- ---------------------------------------------------------------------------

create table if not exists public.sale_refunds (
  id bigint generated always as identity primary key,
  sale_id bigint not null,
  amount numeric(10,2) not null,
  occurred_at timestamptz not null default now(),
  reason text,
  external_ref text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid,

  constraint sale_refunds_sale_fk foreign key (sale_id) references public.sales (id) on delete cascade,
  constraint sale_refunds_amount_positive check (amount >= 0 and amount <= 1000000),
  constraint sale_refunds_reason_known check (reason is null or reason in
    ('artikel_fehlt', 'artikel_beschaedigt', 'nicht_geliefert',
     'versandkorrektur', 'retoure', 'kulanz', 'sonstiges')),
  constraint sale_refunds_created_by_fk foreign key (created_by) references auth.users (id) on delete set null
);

create index if not exists sale_refunds_sale_idx on public.sale_refunds (sale_id);

comment on table public.sale_refunds is
  'Money returned to a buyer of an EXTERNAL sale (ADR-0089). A financial event with no physical meaning: a refund never implies a return and never restores stock. Internal refunds live in `order_refunds`.';

alter table public.sale_refunds enable row level security;
revoke all on table public.sale_refunds from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Settlement adjustments — the signed exception
--
-- WHY THIS IS NOT A FEE
--
-- Three historical orders carry `Fee S.`, and the workbook ADDS it to the
-- payout. One of the three is decisive: a total refund where `Fee S.` equals
-- the transaction fee exactly — eBay handing the fee back. That is a credit,
-- and forcing a credit into a positive-only fee table would mean negative
-- fees, which is precisely the thing users should never have to reason about.
--
-- WHY `sale_id` IS NULLABLE
--
-- The workbook's `Korrektur >` group is not a sale: `Summe` 0,00, and its
-- −5,19 € is entirely a shipping label with nothing sold behind it. Its buyer
-- has three real orders and the file links it to none of them. The honest
-- options were a fake zero-item sale or an adjustment that belongs to the
-- channel rather than to a sale; this is the second.
--
-- A standalone adjustment is deliberately NOT part of any sale's expected
-- payout — it has no sale to be part of. It belongs to channel-level
-- reconciliation.
-- ---------------------------------------------------------------------------

create table if not exists public.settlement_adjustments (
  id bigint generated always as identity primary key,
  sale_id bigint,
  channel text not null,
  amount numeric(10,2) not null,   -- SIGNED: + credit, − debit
  reason text,
  external_ref text,
  note text,
  occurred_at date,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  created_by uuid,

  constraint settlement_adjustments_sale_fk foreign key (sale_id)
    references public.sales (id) on delete cascade,
  constraint settlement_adjustments_channel_known check (channel in ('skyisles', 'ebay', 'manual')),
  constraint settlement_adjustments_source_known check (source in ('manual', 'excel_order_2026')),
  constraint settlement_adjustments_amount_sane check (amount >= -1000000 and amount <= 1000000),
  constraint settlement_adjustments_amount_not_zero check (amount <> 0),
  -- A standalone adjustment has to say what it is, since no sale explains it.
  constraint settlement_adjustments_standalone_identified
    check (sale_id is not null
           or (note is not null and length(btrim(note)) > 0)),
  constraint settlement_adjustments_created_by_fk foreign key (created_by)
    references auth.users (id) on delete set null
);

create index if not exists settlement_adjustments_sale_idx on public.settlement_adjustments (sale_id);
create index if not exists settlement_adjustments_channel_idx on public.settlement_adjustments (channel, occurred_at);

comment on table public.settlement_adjustments is
  'A signed credit or debit against a channel settlement (ADR-0089). Positive raises the payout, negative lowers it. `sale_id` NULL is a channel-level correction that belongs to no sale — it is excluded from every sale''s expected payout by construction.';

alter table public.settlement_adjustments enable row level security;
revoke all on table public.settlement_adjustments from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. What the channel should pay
--
--     + items_subtotal          what the buyer paid for goods
--     + shipping_charged        what the buyer paid to receive them
--     − discount_amount         what we took off
--     − refunds                 what we gave back
--     − fees settled BY THE CHANNEL
--     + settlement adjustments  signed, sale-linked only
--
-- Fees settled externally are deliberately absent: a label bought at the post
-- office never passed through eBay and cannot change what eBay owes. It still
-- costs money, and it still belongs in a profit view — a different question.
--
-- DERIVED, NEVER STORED. Every component is a row; a stored copy would be a
-- second answer that goes stale the first time a fee is corrected.
--
-- Internal and external read from different places for the customer-facing
-- amounts, which is the whole point of the link.
-- ---------------------------------------------------------------------------

create or replace function public.sale_expected_payout(p_sale_id bigint)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(
      case
        when s.order_id is not null then
          coalesce(o.items_subtotal, 0) + coalesce(o.shipping_amount, 0)
            - coalesce(o.discount_amount, 0)
            - coalesce((select sum(r.amount) from public.order_refunds r
                         where r.order_id = s.order_id), 0)
        else
          coalesce(s.items_subtotal, 0) + coalesce(s.shipping_charged, 0)
            - coalesce(s.discount_amount, 0)
            - coalesce((select sum(r.amount) from public.sale_refunds r
                         where r.sale_id = s.id), 0)
      end
      - coalesce((select sum(f.amount) from public.sale_fees f
                   where f.sale_id = s.id and f.settled_by = 'channel'), 0)
      + coalesce((select sum(a.amount) from public.settlement_adjustments a
                   where a.sale_id = s.id), 0)
    , 2)
    from public.sales s
    left join public.orders o on o.id = s.order_id
   where s.id = p_sale_id;
$$;

comment on function public.sale_expected_payout(bigint) is
  'What the channel should settle for one sale (0059). Customer-paid amounts minus refunds, minus only the fees the channel itself deducts, plus signed sale-linked adjustments. Derived on every read; never stored.';

revoke all on function public.sale_expected_payout(bigint) from public, anon, authenticated;


/*
 * Buy In. Analytical, and it says so.
 *
 * Market value times the Einkauf factor that was frozen when the sale was
 * confirmed. It is NOT what any physical figure cost — the Einkauf side
 * deliberately never allocated a purchase total across its items, and this
 * must not become a back door to the same guess.
 */
create or replace function public.sale_buy_in(p_sale_id bigint)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.buy_in_factor_snapshot is null then null
              else round(coalesce((
                select sum(coalesce(i.market_price_snapshot, k.market_price))
                  from public.sale_items i
                  left join public.skylanders k on k.sky_id = i.sky_id
                 where i.sale_id = s.id), 0) * s.buy_in_factor_snapshot, 2) end
    from public.sales s where s.id = p_sale_id;
$$;

revoke all on function public.sale_buy_in(bigint) from public, anon, authenticated;


/*
 * The current all-time Einkauf factor, for the snapshot.
 *
 * SUM(Ausgaben) / SUM(bekannter Marktwert) across every purchase — the same
 * ratio-of-sums the Orderbuch summary shows, and deliberately not the
 * same-year factor: the owner chose the global one.
 */
create or replace function public.orderbook_global_factor()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when sum(v.known_value) > 0
              then round(sum(p.total_cost) / sum(v.known_value), 6) end
    from public.purchases p
    cross join lateral public.purchase_market_value(p.id) v;
$$;

revoke all on function public.orderbook_global_factor() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. Reading the sales ledger
--
-- One call: filter, search, rows and summary, exactly like the Einkauf ledger.
-- `p_scope` is the Intern/Extern tab; `p_undated` is 0058's third date state.
-- ---------------------------------------------------------------------------

create or replace function public.seller_sales(
  p_year    integer default null,
  p_month   integer default null,
  p_search  text    default null,
  p_undated boolean default false,
  p_scope   text    default 'all',      -- 'all' | 'internal' | 'external'
  p_open_payout boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text; v_num text; v_rows jsonb; v_sum jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
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
           public.sale_expected_payout(s.id) as expected_payout
      from public.sales s
      left join public.orders o on o.id = s.order_id
      left join public.order_addresses a on a.order_id = s.order_id and a.kind = 'shipping'
  ),
  filtered as (
    select b.* from base b
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
  matched as (
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
  )
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
      'source', m.source, 'note', m.note, 'match_items', m.match_items)
      order by m.effective_date desc nulls last, m.id desc), '[]'::jsonb),
    jsonb_build_object(
      'sale_count', count(*),
      'item_count', coalesce(sum(m.item_count), 0),
      'gross',      coalesce(sum(coalesce(m.c_subtotal,0) + coalesce(m.c_shipping,0) - coalesce(m.c_discount,0)), 0),
      'refunded',   coalesce(sum(m.refunded), 0),
      'expected_payout', coalesce(sum(m.expected_payout), 0),
      'reported_payout', coalesce(sum(m.reported_payout_amount), 0),
      'open_payouts', count(*) filter (where m.reported_payout_amount is null),
      'mismatched',   count(*) filter (where m.reported_payout_amount is not null
                                         and round(m.reported_payout_amount - m.expected_payout, 2) <> 0))
  into v_rows, v_sum
  from matched m;

  return jsonb_build_object('sales', v_rows, 'summary', v_sum);
end;
$$;

revoke all on function public.seller_sales(integer, integer, text, boolean, text, boolean) from public, anon;
grant execute on function public.seller_sales(integer, integer, text, boolean, text, boolean) to authenticated;


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
    'expected_payout', public.sale_expected_payout(p_id),
    'buy_in', public.sale_buy_in(p_id),
    'order', case when v_sale.order_id is null then null else (
      select jsonb_build_object('id', o.id, 'order_number', o.order_number,
        'paid_at', o.paid_at, 'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_status, 'shipped_at', o.shipped_at,
        'items_subtotal', o.items_subtotal, 'shipping_amount', o.shipping_amount,
        'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
        'currency', o.currency,
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

revoke all on function public.seller_sale(bigint) from public, anon;
grant execute on function public.seller_sale(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Writing an external sale
-- ---------------------------------------------------------------------------

create or replace function public.seller_create_sale(
  p_channel text,
  p_sold_at date default null,
  p_country text default null,
  p_external_ref text default null,
  p_buyer_ref text default null,
  p_note text default null
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
                            external_order_ref, buyer_ref, note, source,
                            items_subtotal, shipping_charged, discount_amount,
                            created_by, updated_by)
  values (p_channel, p_sold_at, upper(nullif(btrim(coalesce(p_country,'')),'')),
          nullif(btrim(coalesce(p_external_ref,'')),''), nullif(btrim(coalesce(p_buyer_ref,'')),''),
          nullif(btrim(coalesce(p_note,'')),''), 'manual',
          0, 0, 0, (select auth.uid()), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.seller_update_sale(
  p_id bigint,
  p_sold_at date default null, p_clear_date boolean default false,
  p_country text default null,
  p_items_subtotal numeric default null,
  p_shipping_charged numeric default null,
  p_discount_amount numeric default null,
  p_external_ref text default null, p_buyer_ref text default null, p_note text default null
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_order bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select order_id into v_order from public.sales where id = p_id;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;
  /*
   * COMMERCE OWNS THE MONEY OF AN INTERNAL SALE. Refusing here rather than
   * silently ignoring the arguments: a caller that tried to change an order's
   * subtotal through the Orderbuch has a bug, and should be told.
   */
  if v_order is not null and (p_items_subtotal is not null or p_shipping_charged is not null
                              or p_discount_amount is not null or p_clear_date or p_sold_at is not null
                              or p_country is not null) then
    raise exception 'these belong to the order, not to the Orderbuch'
      using errcode = 'restrict_violation';
  end if;

  update public.sales s set
    sold_at = case when p_clear_date then null
                   when p_sold_at is not null then p_sold_at else s.sold_at end,
    destination_country_code = coalesce(upper(nullif(btrim(coalesce(p_country,'')),'')), s.destination_country_code),
    items_subtotal   = coalesce(p_items_subtotal, s.items_subtotal),
    shipping_charged = coalesce(p_shipping_charged, s.shipping_charged),
    discount_amount  = coalesce(p_discount_amount, s.discount_amount),
    external_order_ref = coalesce(nullif(btrim(coalesce(p_external_ref,'')),''), s.external_order_ref),
    buyer_ref = coalesce(nullif(btrim(coalesce(p_buyer_ref,'')),''), s.buyer_ref),
    note = case when p_note is null then s.note else nullif(btrim(p_note),'') end,
    updated_at = now(), updated_by = (select auth.uid())
  where s.id = p_id;
end;
$$;

create or replace function public.seller_set_sale_shipped(p_id bigint, p_shipped boolean)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  -- Shipping is a fulfillment fact; for an internal sale commerce owns it.
  if exists (select 1 from public.sales where id = p_id and order_id is not null) then
    raise exception 'the order owns its shipping state' using errcode = 'restrict_violation';
  end if;
  update public.sales set shipped_at = case when p_shipped then now() else null end,
         updated_at = now(), updated_by = (select auth.uid())
   where id = p_id;
end;
$$;

create or replace function public.seller_add_sale_item(
  p_sale_id bigint, p_sky_id text default null,
  p_raw_name text default null, p_condition text default 'loose'
)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id bigint; v_pos integer; v_order bigint; v_source text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select order_id, source into v_order, v_source from public.sales where id = p_sale_id;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;
  if v_order is not null then
    raise exception 'an internal sale takes its items from the order' using errcode = 'restrict_violation';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.sale_items where sale_id = p_sale_id;
  insert into public.sale_items (sale_id, position, sky_id, raw_name, condition)
  values (p_sale_id, v_pos, nullif(btrim(coalesce(p_sky_id,'')),''),
          nullif(btrim(coalesce(p_raw_name,'')),''), coalesce(nullif(btrim(p_condition),''),'loose'))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.seller_remove_sale_item(p_item_id bigint)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_movement bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select movement_id into v_movement from public.sale_items where id = p_item_id;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;
  if v_movement is not null then
    raise exception 'this item is booked out; reverse the stock movement before removing it'
      using errcode = 'restrict_violation';
  end if;
  delete from public.sale_items where id = p_item_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. Ausbuchen — the only place an external sale touches stock
--
-- RESERVATION-AWARENESS IS NOT IMPLEMENTED HERE, AND THAT IS THE POINT.
-- `apply_inventory_movement()` already locks the row and refuses any delta
-- that would take `quantity` below `reserved`, with the guard in the WHERE
-- clause so there is no window between reading and writing. Re-checking here
-- would be a second, weaker copy of a rule that already holds.
--
-- IDEMPOTENT by the movement link: a second call finds `movement_id` set and
-- returns it rather than moving more stock.
-- ---------------------------------------------------------------------------

create or replace function public.seller_book_sale_item(p_item_id bigint)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_item record; v_sale record; v_mid bigint; v_price numeric;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;
  if v_item.movement_id is not null then return v_item.movement_id; end if;  -- already booked

  select * into v_sale from public.sales where id = v_item.sale_id;
  if v_sale.source = 'excel_order_2026' then
    raise exception 'historical sales never move stock' using errcode = 'restrict_violation';
  end if;
  if v_sale.order_id is not null then
    raise exception 'the order already moved this stock' using errcode = 'restrict_violation';
  end if;
  if v_item.sky_id is null then
    raise exception 'this item is not a catalog figure and has no stock position'
      using errcode = 'check_violation';
  end if;

  -- Raises if the shelf cannot cover it without eating a reservation.
  v_mid := public.record_inventory_movement(
    v_item.sky_id, v_item.condition, -1, 'sale_external',
    null, null, 'Orderbuch: externer Verkauf #' || v_sale.id);

  select market_price into v_price from public.skylanders where sky_id = v_item.sky_id;

  update public.sale_items
     set movement_id = v_mid,
         -- Frozen here, because this is the moment the object left.
         market_price_snapshot = v_price,
         market_price_snapshot_at = now(),
         updated_at = now()
   where id = p_item_id;

  /*
   * ONE FACTOR PER SALE, frozen at the first Ausbuchen.
   *
   * Booking item by item must not give two figures of one parcel two different
   * economics, so the snapshot is taken once and left alone.
   */
  update public.sales
     set buy_in_factor_snapshot = coalesce(buy_in_factor_snapshot, public.orderbook_global_factor()),
         updated_at = now(), updated_by = (select auth.uid())
   where id = v_sale.id;

  return v_mid;
end;
$$;

/*
 * Reversing a booking that should not have happened.
 *
 * A compensating +1, never a deletion: the original movement is what actually
 * happened and the ledger is append-only. `correction` rather than `return` —
 * nothing came back, we were wrong.
 */
create or replace function public.seller_unbook_sale_item(p_item_id bigint)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_item record; v_mid bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;
  if v_item.movement_id is null then return null; end if;           -- nothing to reverse
  if v_item.return_movement_id is not null then
    raise exception 'this item was already restocked as a return' using errcode = 'restrict_violation';
  end if;

  v_mid := public.record_inventory_movement(
    v_item.sky_id, v_item.condition, 1, 'correction',
    null, null, 'Orderbuch: Ausbuchen zurückgenommen, Position ' || p_item_id);

  update public.sale_items
     set movement_id = null, market_price_snapshot = null,
         market_price_snapshot_at = null, updated_at = now()
   where id = p_item_id;
  return v_mid;
end;
$$;


-- ---------------------------------------------------------------------------
-- 10. Retoure, and the separate decision to restock
--
-- The workbook settles this: 41 orders were refunded and 6 had goods come
-- back. Money and objects are different events, and a returned figure is not
-- automatically sellable — nothing records its condition on arrival except the
-- person holding it.
-- ---------------------------------------------------------------------------

create or replace function public.seller_return_sale_item(p_item_id bigint, p_returned boolean default true)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_item record;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;
  if not p_returned and v_item.return_movement_id is not null then
    raise exception 'this return was already restocked' using errcode = 'restrict_violation';
  end if;
  -- Marks the physical fact. No money, no stock.
  update public.sale_items set returned_at = case when p_returned then now() else null end,
         updated_at = now() where id = p_item_id;
end;
$$;

create or replace function public.seller_restock_sale_item(p_item_id bigint)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_item record; v_sale record; v_mid bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;
  if v_item.return_movement_id is not null then return v_item.return_movement_id; end if;  -- idempotent
  if v_item.returned_at is null then
    raise exception 'mark the item as returned before putting it back on the shelf'
      using errcode = 'check_violation';
  end if;
  if v_item.movement_id is null then
    raise exception 'this item never left stock' using errcode = 'check_violation';
  end if;
  select * into v_sale from public.sales where id = v_item.sale_id;
  if v_sale.source = 'excel_order_2026' then
    raise exception 'historical sales never move stock' using errcode = 'restrict_violation';
  end if;

  v_mid := public.record_inventory_movement(
    v_item.sky_id, v_item.condition, 1, 'return',
    null, null, 'Orderbuch: Retoure wieder eingelagert, Position ' || p_item_id);

  update public.sale_items set return_movement_id = v_mid, updated_at = now() where id = p_item_id;
  return v_mid;
end;
$$;


-- ---------------------------------------------------------------------------
-- 11. Money that is not the sale itself
-- ---------------------------------------------------------------------------

create or replace function public.seller_add_sale_fee(
  p_sale_id bigint, p_kind text, p_amount numeric,
  p_settled_by text, p_label text default null, p_note text default null)
returns bigint language plpgsql volatile security definer set search_path = ''
as $$
declare v_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if p_amount < 0 then
    raise exception 'a fee is a positive amount; use a settlement adjustment for a credit'
      using errcode = 'check_violation';
  end if;
  insert into public.sale_fees (sale_id, kind, amount, settled_by, label, note, created_by)
  values (p_sale_id, p_kind, p_amount, p_settled_by,
          nullif(btrim(coalesce(p_label,'')),''), nullif(btrim(coalesce(p_note,'')),''),
          (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.seller_remove_sale_fee(p_fee_id bigint)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  delete from public.sale_fees where id = p_fee_id;
end;
$$;

create or replace function public.seller_add_sale_refund(
  p_sale_id bigint, p_amount numeric, p_occurred_at timestamptz default null,
  p_reason text default null, p_external_ref text default null, p_note text default null)
returns bigint language plpgsql volatile security definer set search_path = ''
as $$
declare v_id bigint; v_order bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select order_id into v_order from public.sales where id = p_sale_id;
  if v_order is not null then
    raise exception 'an order''s refunds belong to commerce, not to the Orderbuch'
      using errcode = 'restrict_violation';
  end if;
  insert into public.sale_refunds (sale_id, amount, occurred_at, reason, external_ref, note, created_by)
  values (p_sale_id, p_amount, coalesce(p_occurred_at, now()),
          nullif(btrim(coalesce(p_reason,'')),''), nullif(btrim(coalesce(p_external_ref,'')),''),
          nullif(btrim(coalesce(p_note,'')),''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.seller_remove_sale_refund(p_refund_id bigint)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  delete from public.sale_refunds where id = p_refund_id;
end;
$$;

create or replace function public.seller_add_settlement_adjustment(
  p_sale_id bigint, p_channel text, p_amount numeric,
  p_reason text default null, p_external_ref text default null,
  p_note text default null, p_occurred_at date default null)
returns bigint language plpgsql volatile security definer set search_path = ''
as $$
declare v_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  insert into public.settlement_adjustments
    (sale_id, channel, amount, reason, external_ref, note, occurred_at, created_by)
  values (p_sale_id, p_channel, p_amount,
          nullif(btrim(coalesce(p_reason,'')),''), nullif(btrim(coalesce(p_external_ref,'')),''),
          nullif(btrim(coalesce(p_note,'')),''), p_occurred_at, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.seller_set_sale_payout(
  p_id bigint, p_amount numeric default null, p_ref text default null)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  update public.sales set
    reported_payout_amount = p_amount,
    reported_payout_at = case when p_amount is null then null else now() end,
    reported_payout_ref = nullif(btrim(coalesce(p_ref,'')),''),
    updated_at = now(), updated_by = (select auth.uid())
  where id = p_id;
end;
$$;

create or replace function public.seller_set_sale_date(p_id bigint, p_sold_at date)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.sales where id = p_id and order_id is not null) then
    raise exception 'an internal sale takes its date from the order' using errcode = 'restrict_violation';
  end if;
  if p_sold_at is not null and (p_sold_at < date '2000-01-01' or p_sold_at > current_date + 1) then
    raise exception 'that sale date is outside the plausible range' using errcode = 'check_violation';
  end if;
  update public.sales set sold_at = p_sold_at, updated_at = now(), updated_by = (select auth.uid())
   where id = p_id;
end;
$$;

create or replace function public.seller_delete_sale(p_id bigint)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_booked integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.sales where id = p_id and order_id is not null) then
    raise exception 'an internal sale exists because an order was paid' using errcode = 'restrict_violation';
  end if;
  select count(*) into v_booked from public.sale_items
   where sale_id = p_id and (movement_id is not null or return_movement_id is not null);
  if v_booked > 0 then
    raise exception 'this sale has % item(s) with stock movements; reverse them first', v_booked
      using errcode = 'restrict_violation';
  end if;
  delete from public.sales where id = p_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 12. Internal sales register themselves
--
-- WHERE THE HOOK LIVES, AND WHY
--
-- A trigger on `orders`, not a webhook branch and not a page load. The webhook
-- is one of several paths that set `payment_status` — the late-payment
-- recovery in `0043` is another — and a UI-driven registration would mean a
-- sale exists only once somebody looked at a screen.
--
-- EXACTLY ONCE, under concurrency: `sales_order_uniq` is the guarantee, and
-- `on conflict do nothing` is how the loser of a race behaves. Not a SELECT
-- followed by an INSERT, which is the same bug one layer up.
--
-- IT MOVES NO STOCK. The order's own reservation already converted into an
-- inventory movement; this row only points at the order that owns it.
-- ---------------------------------------------------------------------------

create or replace function public.orders_register_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_status <> 'paid' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.payment_status = 'paid' then
    return new;      -- already paid before this statement; nothing new happened
  end if;

  insert into public.sales (channel, order_id, source, currency,
                            buy_in_factor_snapshot, created_by, updated_by)
  values ('skyisles', new.id, 'commerce', new.currency,
          public.orderbook_global_factor(), new.id * 0 + null, null)
  on conflict (order_id) where order_id is not null do nothing;

  return new;
end;
$$;

comment on function public.orders_register_sale() is
  'Registers one Orderbuch sale when an order becomes paid (0059). Idempotent through `sales_order_uniq`; creates no inventory movement, because the order''s reservation already did.';

drop trigger if exists orders_register_sale_trg on public.orders;
create trigger orders_register_sale_trg
  after insert or update of payment_status on public.orders
  for each row execute function public.orders_register_sale();


-- ---------------------------------------------------------------------------
-- 13. Importing the historical sales
--
-- The same shape as `seller_import_purchase_group`, and the same guarantee:
-- it writes rows and never moves stock. The workbook's `T` and `S` markers
-- ride along as text, which is all they ever were.
-- ---------------------------------------------------------------------------

create or replace function public.seller_import_sale_group(
  p_channel     text,
  p_sold_at     date,
  p_country     text,
  p_buyer_ref   text,
  p_external_ref text,
  p_fingerprint text,
  p_note        text,
  p_subtotal    numeric,
  p_shipping    numeric,
  p_discount    numeric,
  p_factor      numeric,
  p_items       jsonb,
  p_fees        jsonb,
  p_refunds     jsonb,
  p_adjustments jsonb
)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'that is more items than a sale has' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.sales (channel, sold_at, destination_country_code, buyer_ref,
                            external_order_ref, import_fingerprint, note,
                            items_subtotal, shipping_charged, discount_amount,
                            buy_in_factor_snapshot, source, created_by, updated_by)
  values (p_channel, p_sold_at, upper(nullif(btrim(coalesce(p_country,'')),'')),
          nullif(btrim(coalesce(p_buyer_ref,'')),''), nullif(btrim(coalesce(p_external_ref,'')),''),
          p_fingerprint, nullif(btrim(coalesce(p_note,'')),''),
          coalesce(p_subtotal,0), coalesce(p_shipping,0), coalesce(p_discount,0),
          p_factor, 'excel_order_2026', (select auth.uid()), (select auth.uid()))
  returning id into v_id;

  -- No movement_id, no return_movement_id, no market snapshot. The trigger
  -- would refuse them anyway.
  insert into public.sale_items (sale_id, position, sky_id, raw_name, condition,
                                 legacy_stock_flag, legacy_shipped_flag, source_row)
  select v_id, (r->>'position')::integer, nullif(r->>'sky_id',''),
         nullif(r->>'raw_name',''), coalesce(nullif(r->>'condition',''),'loose'),
         nullif(r->>'legacy_stock_flag',''), nullif(r->>'legacy_shipped_flag',''),
         (r->>'source_row')::integer
    from jsonb_array_elements(p_items) as r;

  if p_fees is not null and jsonb_typeof(p_fees) = 'array' then
    insert into public.sale_fees (sale_id, kind, amount, settled_by, label, created_by)
    select v_id, r->>'kind', (r->>'amount')::numeric, r->>'settled_by',
           nullif(r->>'label',''), (select auth.uid())
      from jsonb_array_elements(p_fees) as r;
  end if;

  if p_refunds is not null and jsonb_typeof(p_refunds) = 'array' then
    insert into public.sale_refunds (sale_id, amount, occurred_at, note, created_by)
    select v_id, (r->>'amount')::numeric,
           coalesce((r->>'occurred_at')::timestamptz, now()), nullif(r->>'note',''),
           (select auth.uid())
      from jsonb_array_elements(p_refunds) as r;
  end if;

  if p_adjustments is not null and jsonb_typeof(p_adjustments) = 'array' then
    insert into public.settlement_adjustments (sale_id, channel, amount, reason, note, occurred_at, source, created_by)
    select v_id, p_channel, (r->>'amount')::numeric, nullif(r->>'reason',''),
           nullif(r->>'note',''), p_sold_at, 'excel_order_2026', (select auth.uid())
      from jsonb_array_elements(p_adjustments) as r;
  end if;

  return v_id;
end;
$$;

comment on function public.seller_import_sale_group(text, date, text, text, text, text, text, numeric, numeric, numeric, numeric, jsonb, jsonb, jsonb, jsonb) is
  'Records one historical Order 2026 sale group (0059). Writes sale, items, fees, refunds and adjustments; creates no inventory movement and no market-price snapshot, because the workbook holds neither.';

create or replace function public.seller_sale_fingerprints()
returns table (import_fingerprint text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  return query select s.import_fingerprint from public.sales s
    where s.import_fingerprint is not null and s.source = 'excel_order_2026';
end;
$$;


-- ---------------------------------------------------------------------------
-- 14. Privileges
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so each REVOKE is
-- load-bearing. The tables themselves keep no privileges for any client role
-- and no policy: these functions are the whole surface.
-- ---------------------------------------------------------------------------

do $$
declare fn text;
begin
  foreach fn in array array[
    'seller_create_sale(text, date, text, text, text, text)',
    'seller_update_sale(bigint, date, boolean, text, numeric, numeric, numeric, text, text, text)',
    'seller_set_sale_shipped(bigint, boolean)',
    'seller_add_sale_item(bigint, text, text, text)',
    'seller_remove_sale_item(bigint)',
    'seller_book_sale_item(bigint)',
    'seller_unbook_sale_item(bigint)',
    'seller_return_sale_item(bigint, boolean)',
    'seller_restock_sale_item(bigint)',
    'seller_add_sale_fee(bigint, text, numeric, text, text, text)',
    'seller_remove_sale_fee(bigint)',
    'seller_add_sale_refund(bigint, numeric, timestamptz, text, text, text)',
    'seller_remove_sale_refund(bigint)',
    'seller_add_settlement_adjustment(bigint, text, numeric, text, text, text, date)',
    'seller_set_sale_payout(bigint, numeric, text)',
    'seller_set_sale_date(bigint, date)',
    'seller_delete_sale(bigint)',
    'seller_sale_fingerprints()',
    'seller_import_sale_group(text, date, text, text, text, text, text, numeric, numeric, numeric, numeric, jsonb, jsonb, jsonb, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

revoke all on function public.orderbook_global_factor() from public, anon;
grant execute on function public.orderbook_global_factor() to authenticated;
