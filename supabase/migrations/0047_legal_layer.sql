-- ===========================================================================
-- 0047 — the legal layer: which terms applied, who withdrew, what was repaid,
--        and what was invoiced
--
-- Four concerns that look separate and are one: they are the records that make
-- a sale accountable after the fact. Each is an EVENT with its own date, and
-- none of them reaches back and rewrites an earlier one (ADR-0083).
--
-- ---------------------------------------------------------------------------
-- 1. WHICH TERMS APPLIED TO THIS ORDER
--
-- The texts themselves live in `src/lib/legal/` as code: versioned, diffable,
-- reviewable in a pull request. What the database needs is not the text but
-- the ANSWER to "which version did this customer actually see?" — and it needs
-- it written at the moment the order is placed, atomically, with no second
-- round trip that could fail and leave an order with no answer at all.
--
-- So `legal_document_versions` holds the version identifiers and a trigger
-- copies them onto every new order. The code holds the text; the database
-- holds which text. A source test asserts the two agree, so a text edited
-- without bumping its version fails the build rather than silently changing
-- what a historical order appears to have agreed to.
--
-- ---------------------------------------------------------------------------
-- 2. WITHDRAWAL (§ 356a BGB, in force since 19 June 2026)
--
-- The statute requires a two-step function, a receipt confirmation on a
-- durable medium, and the date AND TIME of receipt. That last requirement is
-- why `received_at` is a `timestamptz` and why it is set by the database
-- rather than by a browser clock.
--
-- A GUEST MUST BE ABLE TO USE IT. Requiring a login would take the statutory
-- function away from exactly the customer least able to work around it. So
-- identification is order number PLUS the e-mail on the order, and the
-- function is deliberately incapable of telling a caller whether a given order
-- number exists — see `seller_receive_withdrawal()`.
--
-- WITHDRAWAL IS NOT A REFUND. It is the consumer's declaration. The repayment
-- is a separate, later event with its own date and its own row, because they
-- genuinely are two different things that can be days apart and can fail
-- independently.
--
-- ---------------------------------------------------------------------------
-- 3. REFUNDS
--
-- Recorded as append-only events, exactly as 0045's closing note specified:
-- an amount, a currency, an `occurred_at` that decides which month owns it,
-- the order it belongs to, and the provider's own id when there is one. A
-- refund NEVER removes an order from the month it was placed in (ADR-0083).
--
-- The order's `payment_status` is mirrored to 'refunded' or
-- 'partially_refunded' as a convenience for the operator's list — but the
-- MONEY is the sum of the rows, never the status.
--
-- ---------------------------------------------------------------------------
-- 4. INVOICES
--
-- Issued once, at confirmed payment, from data that is already frozen
-- (`orders_protect_immutable()` freezes the amounts; `order_addresses` is a
-- snapshot taken at checkout). The seller's own details are snapshotted INTO
-- the invoice as well, so that a later change of address does not rewrite a
-- document somebody has already filed.
--
-- § 34a UStDV governs what a Kleinunternehmer invoice must contain. Notably it
-- does NOT require a sequential number — the number here is a deliberate
-- extra, because a document without a stable reference cannot be discussed.
--
-- No PDF is stored. The document is rendered on demand from these immutable
-- rows, so there is no file that can be left in a public bucket by accident —
-- and the only bucket this project has is public (0007).
--
-- DEPENDS ON `0010`/`0019` (orders, mail) and `0041` (the seller predicate).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Legal document versions
-- ---------------------------------------------------------------------------

create table if not exists public.legal_document_versions (
  slug    text primary key,
  version text not null,
  -- Documentation, not logic: nothing selects by it. It answers "since when"
  -- for a human reading the table.
  effective_from date not null,
  updated_at timestamptz not null default now(),

  constraint legal_document_versions_slug_known
    check (slug in ('agb', 'widerruf', 'datenschutz', 'impressum')),
  constraint legal_document_versions_version_shape
    check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?$')
);

comment on table public.legal_document_versions is
  'Which version of each legal text is current. The TEXT lives in src/lib/legal/; this holds only the identifier, so a trigger can snapshot it onto an order without a second round trip (ADR-0086).';

insert into public.legal_document_versions (slug, version, effective_from) values
  ('agb',         '2026-09-17', date '2026-09-17'),
  ('widerruf',    '2026-09-17', date '2026-09-17'),
  ('datenschutz', '2026-09-17', date '2026-09-17'),
  ('impressum',   '2026-09-17', date '2026-09-17')
on conflict (slug) do nothing;

alter table public.legal_document_versions enable row level security;
revoke all on table public.legal_document_versions from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. What applied to one order
--
-- Written by a trigger, never by the application: an order without this row
-- would be an order nobody can say the terms of.
-- ---------------------------------------------------------------------------

create table if not exists public.order_legal_snapshots (
  order_id bigint primary key,

  agb_version      text not null,
  widerruf_version text not null,

  -- Who the seller was, as at this order. A later change of trade name or
  -- address must not rewrite what this customer contracted with.
  seller_name    text,
  seller_legal_name text,
  seller_street  text,
  seller_postal_code text,
  seller_city    text,
  seller_country_code text,
  seller_email   text,
  seller_vat_id  text,

  created_at timestamptz not null default now(),

  constraint order_legal_snapshots_order_fk foreign key (order_id)
    references public.orders (id)
    on update cascade
    on delete restrict
);

comment on table public.order_legal_snapshots is
  'Which legal text versions and which seller details applied to one order, frozen at checkout (ADR-0086). A historical order never points at a later text.';

alter table public.order_legal_snapshots enable row level security;
revoke all on table public.order_legal_snapshots from public, anon, authenticated;

create or replace function public.orders_snapshot_legal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller record;
begin
  -- ONE ROW, ONE TABLE. The seller's identity lives on `public.sellers`
  -- (columns added by `0040`), not on `shop_settings` — which holds platform
  -- configuration and has none of these columns. There is also no
  -- `house_number`: `street` carries the whole street line, which is what
  -- "Lechhalde 1 1/2" is.
  select s.display_name, s.legal_name, s.street, s.postal_code, s.city,
         s.country_code, s.contact_email, s.vat_id
    into v_seller
    from public.sellers s where s.is_active limit 1;

  insert into public.order_legal_snapshots (
    order_id, agb_version, widerruf_version,
    seller_name, seller_legal_name, seller_street, seller_postal_code,
    seller_city, seller_country_code, seller_email, seller_vat_id
  )
  select new.id,
         coalesce((select v.version from public.legal_document_versions v where v.slug = 'agb'), 'unversioned'),
         coalesce((select v.version from public.legal_document_versions v where v.slug = 'widerruf'), 'unversioned'),
         v_seller.display_name,
         v_seller.legal_name,
         nullif(btrim(coalesce(v_seller.street, '')), ''),
         v_seller.postal_code,
         v_seller.city,
         v_seller.country_code,
         v_seller.contact_email,
         v_seller.vat_id
  on conflict (order_id) do nothing;

  return new;
end;
$$;

-- An order's terms are settled when the order is placed. The row may be
-- written once and never rewritten — the same guarantee `invoices` has, for
-- the same reason: a record of what somebody agreed to is worthless if it can
-- be edited afterwards (ADR-0086).
create or replace function public.order_legal_snapshots_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'the legal terms recorded for an order cannot be changed or deleted'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists order_legal_snapshots_protect_trg on public.order_legal_snapshots;
create trigger order_legal_snapshots_protect_trg
  before update or delete on public.order_legal_snapshots
  for each row execute function public.order_legal_snapshots_protect();

drop trigger if exists orders_snapshot_legal_trg on public.orders;
create trigger orders_snapshot_legal_trg
  after insert on public.orders
  for each row execute function public.orders_snapshot_legal();


-- ---------------------------------------------------------------------------
-- 3. Withdrawal requests (§ 356a BGB), and the attempts that reach them
-- ---------------------------------------------------------------------------

/*
 * Every call to the public withdrawal function, matched or not.
 *
 * It exists because the alternative does not work: a rate limit built on
 * successful withdrawals cannot see the requests that fail, and those are
 * precisely the ones a person guessing order numbers makes.
 *
 * It holds a SALTED HASH and a timestamp. No address, no order number, no
 * e-mail, no user agent — nothing that identifies a person or reveals what was
 * tried. Rows older than the window are deleted by the function itself, so it
 * never becomes a history of who visited.
 */
create table if not exists public.withdrawal_attempts (
  id bigint generated always as identity primary key,
  client_hash text not null,
  attempted_at timestamptz not null default now(),

  constraint withdrawal_attempts_hash_shape check (client_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.withdrawal_attempts is
  'A sliding one-hour rate-limit window for the public § 356a function (ADR-0086). Salted request fingerprints and timestamps only — never an address, an order number or an e-mail. Pruned on use; not a log.';

create index if not exists withdrawal_attempts_window_idx
  on public.withdrawal_attempts (client_hash, attempted_at desc);

alter table public.withdrawal_attempts enable row level security;
revoke all on table public.withdrawal_attempts from public, anon, authenticated;

create table if not exists public.withdrawal_requests (
  id bigint generated always as identity primary key,
  order_id bigint not null,

  -- What the consumer supplied, as required by § 356a Abs. 2: their name, the
  -- contract identification, and an electronic address for the confirmation.
  consumer_name  text not null,
  contact_email  text not null,

  -- § 356a Abs. 4: the confirmation must carry the CONTENT of the declaration
  -- and the date and time of receipt. This is that content, stored as it was
  -- sent, so the confirmation and the record cannot drift apart.
  declaration    text not null,

  -- The database's clock, not the browser's. This is the timestamp that
  -- decides whether the 14-day period was met.
  received_at timestamptz not null default now(),

  -- The receipt confirmation on a durable medium. `pending` until the mail
  -- provider has accepted it.
  receipt_state text not null default 'pending',
  receipt_sent_at timestamptz,

  -- Set when the operator has dealt with it. Never automatic: a withdrawal is
  -- not a refund and does not settle itself.
  handled_at timestamptz,
  handled_by uuid,

  constraint withdrawal_requests_order_fk foreign key (order_id)
    references public.orders (id) on update cascade on delete restrict,
  constraint withdrawal_requests_handled_by_fk foreign key (handled_by)
    references auth.users (id) on delete set null,
  constraint withdrawal_requests_name_shape
    check (length(btrim(consumer_name)) between 1 and 200),
  constraint withdrawal_requests_email_shape
    check (contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
           and length(contact_email) <= 254),
  constraint withdrawal_requests_declaration_shape
    check (length(declaration) between 1 and 4000),
  constraint withdrawal_requests_receipt_state_known
    check (receipt_state in ('pending', 'sent', 'failed'))
);

comment on table public.withdrawal_requests is
  'One consumer withdrawal declared through the electronic function required by § 356a BGB (ADR-0086). `received_at` is the statutory moment of receipt. A withdrawal is a declaration, never a repayment — that is order_refunds.';

create index if not exists withdrawal_requests_order_idx
  on public.withdrawal_requests (order_id, received_at desc);
create index if not exists withdrawal_requests_open_idx
  on public.withdrawal_requests (received_at desc) where handled_at is null;

alter table public.withdrawal_requests enable row level security;
revoke all on table public.withdrawal_requests from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Refunds — events, never a status
-- ---------------------------------------------------------------------------

create table if not exists public.order_refunds (
  id bigint generated always as identity primary key,
  order_id bigint not null,

  amount   numeric(10,2) not null,
  currency text not null default 'EUR',

  -- THE FIELD THAT DECIDES THE MONTH. A refund belongs to the period it
  -- happened in; the order stays in the month it was placed (ADR-0083).
  occurred_at timestamptz not null default now(),

  reason text,
  -- Which withdrawal this repays, when it repays one. Null for a goodwill or
  -- correction refund.
  withdrawal_request_id bigint,
  -- Stripe's own refund id, when the money moved through Stripe.
  provider_refund_id text,

  created_by uuid,
  created_at timestamptz not null default now(),

  constraint order_refunds_order_fk foreign key (order_id)
    references public.orders (id) on update cascade on delete restrict,
  constraint order_refunds_withdrawal_fk foreign key (withdrawal_request_id)
    references public.withdrawal_requests (id) on update cascade on delete set null,
  constraint order_refunds_created_by_fk foreign key (created_by)
    references auth.users (id) on delete set null,
  constraint order_refunds_amount_positive check (amount > 0),
  constraint order_refunds_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint order_refunds_reason_shape check (reason is null or length(reason) <= 500)
);

comment on table public.order_refunds is
  'Append-only repayment events (ADR-0086). The refunded sum for an order is the SUM of these rows; orders.payment_status is a mirror for the operator list and never the source of truth.';

create index if not exists order_refunds_order_idx on public.order_refunds (order_id, occurred_at desc);
create index if not exists order_refunds_period_idx on public.order_refunds (occurred_at desc);

alter table public.order_refunds enable row level security;
revoke all on table public.order_refunds from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Invoices
--
-- The seller and customer details are COPIED here rather than joined, and that
-- is the whole point: a document that is re-rendered from live data is not a
-- document, it is a query wearing one's clothes.
-- ---------------------------------------------------------------------------

create sequence if not exists public.invoice_number_seq as bigint start with 1;

create table if not exists public.invoices (
  id bigint generated always as identity primary key,
  order_id bigint not null,

  -- SI-R-<year>-<six digits>. Unique, stable, never reissued.
  invoice_number text not null,
  issued_at timestamptz not null default now(),

  -- ---- the seller, as at issue -------------------------------------------
  seller_legal_name text not null,
  seller_trade_name text,
  seller_street     text not null,
  seller_postal_code text not null,
  seller_city       text not null,
  seller_country    text not null default 'Deutschland',
  seller_email      text not null,
  seller_vat_id     text,

  -- ---- the customer, as at order -----------------------------------------
  customer_name    text not null,
  customer_company text,
  customer_street  text not null,
  customer_postal_code text not null,
  customer_city    text not null,
  customer_country text not null,
  customer_email   text not null,

  -- ---- the money ----------------------------------------------------------
  items_subtotal  numeric(10,2) not null,
  shipping_amount numeric(10,2) not null,
  discount_amount numeric(10,2) not null,
  total_amount    numeric(10,2) not null,
  currency        text not null default 'EUR',

  -- The regime by name, copied from the order. § 19 UStG supplies are
  -- steuerfrei; no VAT line exists and none may be added.
  tax_regime text not null,

  -- The lines, frozen. Joining `order_lines` would be joining a table that is
  -- itself immutable — but the invoice is a document, and a document carries
  -- its own contents.
  lines jsonb not null,

  constraint invoices_order_fk foreign key (order_id)
    references public.orders (id) on update cascade on delete restrict,
  constraint invoices_number_unique unique (invoice_number),
  -- One invoice per order in this round. A future correction document is a new
  -- row referring to this one, never an overwrite.
  constraint invoices_one_per_order unique (order_id),
  constraint invoices_number_shape check (invoice_number ~ '^SI-R-[0-9]{4}-[0-9]{6}$'),
  constraint invoices_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint invoices_amounts_sane
    check (items_subtotal >= 0 and shipping_amount >= 0 and discount_amount >= 0
           and total_amount >= 0),
  constraint invoices_total_adds_up
    check (total_amount = items_subtotal + shipping_amount - discount_amount),
  constraint invoices_lines_present check (jsonb_array_length(lines) > 0)
);

comment on table public.invoices is
  'One issued invoice per paid order (ADR-0086). Seller, customer, amounts and lines are COPIED at issue so a later change to any of them cannot rewrite an issued document. § 34a UStDV governs the contents; no VAT is shown because § 19 UStG supplies are steuerfrei.';

create index if not exists invoices_issued_idx on public.invoices (issued_at desc);

alter table public.invoices enable row level security;
revoke all on table public.invoices from public, anon, authenticated;

-- An issued invoice is final. The trigger says so rather than trusting that
-- nobody will write the UPDATE.
create or replace function public.invoices_protect_issued()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'an issued invoice cannot be changed or deleted'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists invoices_protect_issued_trg on public.invoices;
create trigger invoices_protect_issued_trg
  before update or delete on public.invoices
  for each row execute function public.invoices_protect_issued();


-- ---------------------------------------------------------------------------
-- 6. New mail kinds
--
-- `order_received`   § 312i Abs. 1 Nr. 3 BGB — receipt of the order,
--                    explicitly NOT an acceptance.
-- `order_confirmation` the acceptance. `payment_confirmation` stays permitted
--                    for rows already sent under the old name; nothing new
--                    uses it (ADR-0086).
-- `withdrawal_receipt` § 356a Abs. 4 BGB — the durable receipt.
-- `refund_confirmation` the repayment notice.
-- ---------------------------------------------------------------------------

alter table public.order_mail drop constraint if exists order_mail_kind_known;
alter table public.order_mail
  add constraint order_mail_kind_known
    check (kind in (
      'order_received',
      'order_confirmation',
      'shipping_confirmation',
      'withdrawal_receipt',
      'refund_confirmation',
      'resolution_alert',
      -- Historical: sent before 0047 renamed the acceptance mail.
      'payment_confirmation'
    ));


-- ===========================================================================
-- 7. Issuing an invoice
--
-- Internal. Called by the payment webhook once `confirm_order_payment()` has
-- succeeded, because that is the moment the contract is accepted and the
-- moment there is something to invoice.
--
-- IDEMPOTENT. A webhook is delivered more than once by design (0012). A second
-- call returns the invoice that exists; it does not issue a second one, and
-- the unique constraint on `order_id` would refuse it anyway.
-- ===========================================================================

create or replace function public.issue_invoice(p_order_number text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order   record;
  v_addr    record;
  v_seller  record;
  v_snap    record;
  v_lines   jsonb;
  v_number  text;
  v_id      bigint;
  v_result  jsonb;
begin
  select o.* into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    return null;
  end if;

  -- Only a paid order has an invoice. A pending one has nothing to bill.
  if v_order.payment_status <> 'paid' then
    return null;
  end if;

  select i.id into v_id from public.invoices i where i.order_id = v_order.id;
  if v_id is not null then
    -- Already issued. Hand back what exists rather than making a second one.
    return public.invoice_document(p_order_number, null, true);
  end if;

  select a.* into v_addr from public.order_addresses a where a.order_id = v_order.id;
  if not found then
    return null;
  end if;

  -- Seller identity: `public.sellers`, the same row the snapshot read.
  select s.* into v_seller from public.sellers s where s.is_active limit 1;
  select ls.* into v_snap from public.order_legal_snapshots ls where ls.order_id = v_order.id;

  select jsonb_agg(
           jsonb_build_object(
             'sky_id',      l.sky_id,
             'name',        l.name_snapshot,
             'condition',   l.condition,
             'quantity',    l.quantity,
             'unit_price',  l.unit_price::text,
             'line_total',  l.line_total::text
           ) order by l.id
         )
    into v_lines
    from public.order_lines l
   where l.order_id = v_order.id;

  if v_lines is null then
    return null;
  end if;

  v_number := 'SI-R-'
    || to_char((v_order.paid_at at time zone 'Europe/Berlin'), 'YYYY')
    || '-'
    || lpad(nextval('public.invoice_number_seq')::text, 6, '0');

  insert into public.invoices (
    order_id, invoice_number,
    seller_legal_name, seller_trade_name, seller_street, seller_postal_code,
    seller_city, seller_country, seller_email, seller_vat_id,
    customer_name, customer_company, customer_street, customer_postal_code,
    customer_city, customer_country, customer_email,
    items_subtotal, shipping_amount, discount_amount, total_amount, currency,
    tax_regime, lines
  ) values (
    v_order.id, v_number,
    -- The seller as at issue. `coalesce` onto the order's own snapshot so an
    -- invoice is still complete if the settings row was edited in between.
    coalesce(v_seller.legal_name, v_snap.seller_legal_name, 'unbekannt'),
    coalesce(v_seller.display_name, v_snap.seller_name),
    coalesce(nullif(btrim(coalesce(v_seller.street, '')), ''),
             v_snap.seller_street, 'unbekannt'),
    coalesce(v_seller.postal_code, v_snap.seller_postal_code, 'unbekannt'),
    coalesce(v_seller.city, v_snap.seller_city, 'unbekannt'),
    case coalesce(v_seller.country_code, v_snap.seller_country_code, 'DE')
      when 'DE' then 'Deutschland' else coalesce(v_seller.country_code, 'Deutschland') end,
    coalesce(v_seller.contact_email, v_snap.seller_email, 'unbekannt'),
    coalesce(v_seller.vat_id, v_snap.seller_vat_id),
    btrim(coalesce(v_addr.first_name, '') || ' ' || coalesce(v_addr.last_name, '')),
    v_addr.company,
    btrim(coalesce(v_addr.street, '') || ' ' || coalesce(v_addr.house_number, '')
          || coalesce(', ' || nullif(v_addr.address_line_2, ''), '')),
    v_addr.postal_code,
    v_addr.city,
    case v_addr.country_code when 'DE' then 'Deutschland' else v_addr.country_code end,
    v_order.customer_email,
    v_order.items_subtotal, v_order.shipping_amount, v_order.discount_amount,
    v_order.total_amount, v_order.currency,
    v_order.tax_regime, v_lines
  )
  on conflict (order_id) do nothing;

  -- Record it in the order's own journal, like every other thing that happens
  -- to an order (0010).
  insert into public.order_events (order_id, event_type, actor_kind, payload)
  values (v_order.id, 'invoice_issued', 'system', jsonb_build_object('invoice_number', v_number));

  return public.invoice_document(p_order_number, null, true);
end;
$$;

revoke all on function public.issue_invoice(text) from public, anon, authenticated;


-- ===========================================================================
-- 8. Reading an invoice
--
-- `p_internal` exists so `issue_invoice()` can read back what it just wrote
-- without pretending to be a customer. Every other caller passes false and is
-- checked by `authorize_order_payment()` — the signed-in owner, or the holder
-- of the capability issued when the order was placed (0013). A guest keeps
-- access to their own invoice; nobody gets anybody else's.
-- ===========================================================================

create or replace function public.invoice_document(
  p_order_number text,
  p_token        text default null,
  p_internal     boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order   record;
  v_invoice record;
begin
  select o.id, o.order_number, o.placed_at, o.paid_at, o.shipping_method_name
    into v_order
    from public.orders o
   where o.order_number = p_order_number;
  if not found then
    return null;
  end if;

  if not p_internal
     and not public.authorize_order_payment(v_order.id, (select auth.uid()), p_token) then
    -- An unknown order and an unauthorised one answer identically.
    return null;
  end if;

  select i.* into v_invoice from public.invoices i where i.order_id = v_order.id;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'invoice_number', v_invoice.invoice_number,
    'issued_at',      v_invoice.issued_at,
    'order_number',   v_order.order_number,
    'placed_at',      v_order.placed_at,
    'paid_at',        v_order.paid_at,
    'shipping_method', v_order.shipping_method_name,
    'seller', jsonb_build_object(
      'legal_name',  v_invoice.seller_legal_name,
      'trade_name',  v_invoice.seller_trade_name,
      'street',      v_invoice.seller_street,
      'postal_code', v_invoice.seller_postal_code,
      'city',        v_invoice.seller_city,
      'country',     v_invoice.seller_country,
      'email',       v_invoice.seller_email,
      'vat_id',      v_invoice.seller_vat_id
    ),
    'customer', jsonb_build_object(
      'name',        v_invoice.customer_name,
      'company',     v_invoice.customer_company,
      'street',      v_invoice.customer_street,
      'postal_code', v_invoice.customer_postal_code,
      'city',        v_invoice.customer_city,
      'country',     v_invoice.customer_country,
      'email',       v_invoice.customer_email
    ),
    'items_subtotal',  v_invoice.items_subtotal::text,
    'shipping_amount', v_invoice.shipping_amount::text,
    'discount_amount', v_invoice.discount_amount::text,
    'total_amount',    v_invoice.total_amount::text,
    'currency',        v_invoice.currency,
    'tax_regime',      v_invoice.tax_regime,
    'lines',           v_invoice.lines
  );
end;
$$;

revoke all on function public.invoice_document(text, text, boolean) from public, anon;
grant execute on function public.invoice_document(text, text, boolean) to anon, authenticated;


-- ===========================================================================
-- 9. Receiving a withdrawal (§ 356a BGB)
--
-- WHAT THIS FUNCTION REFUSES TO TELL YOU. It answers the same way whether the
-- order exists, whether the e-mail matches, and whether a withdrawal was
-- already declared. Anything else would turn the statutory function into an
-- oracle for "did this address order anything" — which is exactly the question
-- an attacker would bring to it.
--
-- The caller therefore never learns what happened. The consumer learns it the
-- way the statute intends: by the receipt confirmation arriving at the address
-- they gave.
--
-- THROTTLED, because it is reachable by anyone. Five declarations per salted
-- client hash per hour is far above any real use and far below useful
-- guessing. A caller with no resolvable address is not throttled — and also
-- cannot be identified, which is why the limit is not the security boundary;
-- the e-mail match is.
-- ===========================================================================

create or replace function public.receive_withdrawal(
  p_order_number text,
  p_name         text,
  p_email        text,
  p_declaration  text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_hash   text;
  v_recent integer;
  v_id     bigint;
begin
  -- Shape first, so a malformed request never reaches the table.
  if p_order_number is null or p_name is null or p_email is null
     or length(btrim(p_name)) = 0 or length(btrim(p_name)) > 200
     or length(coalesce(p_declaration, '')) > 4000
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('accepted', false);
  end if;

  /*
   * THROTTLE EVERY ATTEMPT, NOT EVERY SUCCESS.
   *
   * The first version counted `withdrawal_requests` rows belonging to orders
   * that carried the caller's fingerprint — which counted nothing at all for
   * the case that matters. A probe against a fabricated order number creates
   * no row, so someone guessing was never counted and never slowed down.
   *
   * So the attempt itself is recorded, before anything is known about whether
   * it matched. `request_client_hash()` is a salted SHA-256 of the caller's
   * address computed per request (0010) — the address itself is never stored
   * here or anywhere else, and the salt is not readable by any client role.
   *
   * WHAT THIS IS NOT. It is not the security boundary; the order number
   * together with the e-mail address on that order is. It makes guessing slow
   * rather than impossible, which is all a rate limit can do.
   *
   * A CALLER WITH NO RESOLVABLE ADDRESS IS NOT THROTTLED — and also cannot be
   * identified. That is why the e-mail match carries the weight.
   */
  v_hash := public.request_client_hash();
  if v_hash is not null then
    -- Opportunistic pruning: this table is a rate-limit window, not a log, and
    -- nothing outside that window may be kept.
    delete from public.withdrawal_attempts
     where attempted_at < now() - interval '2 hours';

    select count(*)::integer into v_recent
      from public.withdrawal_attempts a
     where a.client_hash = v_hash
       and a.attempted_at > now() - interval '1 hour';

    insert into public.withdrawal_attempts (client_hash) values (v_hash);

    /*
     * Ten an hour, sliding. A consumer withdrawing from one order needs one;
     * a mistyped order number and two retries need four. Somebody working
     * through order numbers needs thousands. The window slides, so nobody is
     * locked out for longer than an hour.
     *
     * A throttled caller gets THE SAME ANSWER as a non-match — see below. A
     * distinguishable "you are being rate limited" would itself be a signal.
     */
    if v_recent >= 10 then
      return jsonb_build_object('accepted', true, 'delivered', false);
    end if;
  end if;

  select o.id, o.order_number, o.customer_email, o.placed_at
    into v_order
    from public.orders o
   where o.order_number = btrim(p_order_number)
     and lower(o.customer_email) = lower(btrim(p_email))
     -- THE ORDER MUST BELONG TO THE WORLD THIS INSTALLATION IS CURRENTLY IN.
     --
     -- Not the literal 'live'. `create_order()` stamps every order with
     -- `commerce_mode()` at the moment it is placed (0021), and this asks the
     -- same function — so an installation running live accepts withdrawals for
     -- live orders, and one running sandbox accepts them for sandbox orders.
     --
     -- WHY THIS CANNOT WIDEN PRODUCTION. Production runs in live mode, so
     -- `commerce_mode()` returns 'live' and a historical sandbox test order is
     -- refused exactly as before. The only way a sandbox order could become
     -- eligible there is if Production were switched to sandbox — at which
     -- point it has stopped taking real orders at all, and the switch is an
     -- explicit platform-admin act (`admin_set_commerce_mode`).
     --
     -- WHY IT IS NEEDED. Staging holds only sandbox orders. Under a hard-coded
     -- 'live' the successful § 356a path could never be exercised there: every
     -- smoke test would take the uniform no-match branch and look identical to
     -- success. A statutory function that has never once been run end to end
     -- is not one to put in front of consumers.
     and o.commerce_mode = public.commerce_mode();

  if not found then
    -- The uniform answer. Nothing here says the order was not found.
    return jsonb_build_object('accepted', true, 'delivered', false);
  end if;

  insert into public.withdrawal_requests (
    order_id, consumer_name, contact_email, declaration
  ) values (
    v_order.id, btrim(p_name), lower(btrim(p_email)),
    coalesce(nullif(btrim(p_declaration), ''),
             'Hiermit widerrufe ich den Vertrag über den Kauf der folgenden Waren: Bestellung '
               || v_order.order_number || '.')
  )
  returning id into v_id;

  insert into public.order_events (order_id, event_type, actor_kind, payload)
  values (v_order.id, 'withdrawal_declared', 'customer',
          jsonb_build_object('withdrawal_request_id', v_id));

  return jsonb_build_object(
    'accepted', true,
    'delivered', true,
    'withdrawal_id', v_id,
    'order_number', v_order.order_number,
    'received_at', (select w.received_at from public.withdrawal_requests w where w.id = v_id)
  );
end;
$$;

comment on function public.receive_withdrawal(text, text, text, text) is
  'Records a consumer withdrawal declared through the electronic function required by § 356a BGB (ADR-0086). Answers identically whether or not the order matched, so it cannot be used to discover which orders or addresses exist. The consumer learns the outcome from the receipt confirmation sent to the address they gave.';

revoke all on function public.receive_withdrawal(text, text, text, text) from public;
grant execute on function public.receive_withdrawal(text, text, text, text) to anon, authenticated;


-- ===========================================================================
-- 10. The seller's side of a withdrawal, and the repayment
-- ===========================================================================

create or replace function public.seller_withdrawals(p_open_only boolean default false)
returns table (
  id            bigint,
  order_number  text,
  consumer_name text,
  contact_email text,
  declaration   text,
  received_at   timestamptz,
  receipt_state text,
  handled_at    timestamptz,
  refunded_total numeric
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
    select w.id, o.order_number, w.consumer_name, w.contact_email, w.declaration,
           w.received_at, w.receipt_state, w.handled_at,
           coalesce((select sum(r.amount) from public.order_refunds r
                      where r.order_id = w.order_id), 0)
      from public.withdrawal_requests w
      join public.orders o on o.id = w.order_id
     where not p_open_only or w.handled_at is null
     order by w.received_at desc
     limit 200;
end;
$$;

create or replace function public.seller_record_refund(
  p_order_number text,
  p_amount       numeric,
  p_reason       text default null,
  p_withdrawal_id bigint default null,
  p_provider_refund_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_paid   numeric;
  v_so_far numeric;
  v_id     bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select o.* into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    raise exception 'no such order' using errcode = 'invalid_parameter_value';
  end if;

  if v_order.payment_status not in ('paid', 'partially_refunded') then
    raise exception 'only a paid order can be refunded'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'a refund needs a positive amount'
      using errcode = 'invalid_parameter_value';
  end if;

  v_paid := v_order.total_amount;
  select coalesce(sum(r.amount), 0) into v_so_far
    from public.order_refunds r where r.order_id = v_order.id;

  -- More than was paid is not a refund, it is a mistake.
  if v_so_far + p_amount > v_paid then
    raise exception 'that is more than was paid for this order'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.order_refunds (
    order_id, amount, currency, reason, withdrawal_request_id,
    provider_refund_id, created_by
  ) values (
    v_order.id, p_amount, v_order.currency, p_reason, p_withdrawal_id,
    p_provider_refund_id, auth.uid()
  ) returning id into v_id;

  -- The status is a MIRROR for the operator's list. The money is the sum of
  -- the rows above, and every report reads those (ADR-0083).
  update public.orders o
     set payment_status = case when v_so_far + p_amount >= v_paid
                               then 'refunded' else 'partially_refunded' end
   where o.id = v_order.id;

  insert into public.order_events (order_id, event_type, actor_kind, payload)
  values (v_order.id, 'refund_recorded', 'admin',
          jsonb_build_object('refund_id', v_id, 'amount', p_amount::text));

  if p_withdrawal_id is not null then
    update public.withdrawal_requests w
       set handled_at = coalesce(w.handled_at, now()), handled_by = auth.uid()
     where w.id = p_withdrawal_id;
  end if;

  return jsonb_build_object('refund_id', v_id, 'refunded_total', v_so_far + p_amount);
end;
$$;

revoke all on function public.seller_withdrawals(boolean) from public, anon;
revoke all on function public.seller_record_refund(text, numeric, text, bigint, text) from public, anon;
grant execute on function public.seller_withdrawals(boolean) to authenticated;
grant execute on function public.seller_record_refund(text, numeric, text, bigint, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 11. What a customer may know about their own withdrawal
-- ---------------------------------------------------------------------------

create or replace function public.order_withdrawal_state(
  p_order_number text,
  p_token        text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_w     record;
begin
  select o.id into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    return null;
  end if;
  if not public.authorize_order_payment(v_order.id, (select auth.uid()), p_token) then
    return null;
  end if;

  select w.received_at, w.consumer_name into v_w
    from public.withdrawal_requests w
   where w.order_id = v_order.id
   order by w.received_at asc
   limit 1;

  if not found then
    return jsonb_build_object('declared', false);
  end if;

  return jsonb_build_object(
    'declared', true,
    'received_at', v_w.received_at,
    'refunded_total', coalesce(
      (select sum(r.amount)::text from public.order_refunds r where r.order_id = v_order.id), '0')
  );
end;
$$;

revoke all on function public.order_withdrawal_state(text, text) from public;
grant execute on function public.order_withdrawal_state(text, text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 12. The mail payload for a withdrawal receipt
--
-- § 356a Abs. 4 wants the CONTENT of the declaration plus the date and time of
-- receipt. Both come from the stored row, so the confirmation and the record
-- can never disagree.
-- ---------------------------------------------------------------------------

create or replace function public.withdrawal_mail_payload(p_withdrawal_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'withdrawal_id', w.id,
    'order_number',  o.order_number,
    'consumer_name', w.consumer_name,
    'contact_email', w.contact_email,
    'declaration',   w.declaration,
    'received_at',   w.received_at
  )
    from public.withdrawal_requests w
    join public.orders o on o.id = w.order_id
   where w.id = p_withdrawal_id;
$$;

revoke all on function public.withdrawal_mail_payload(bigint) from public, anon, authenticated;

create or replace function public.mark_withdrawal_receipt(
  p_withdrawal_id bigint,
  p_state         text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.withdrawal_requests w
     set receipt_state = p_state,
         receipt_sent_at = case when p_state = 'sent' then now() else w.receipt_sent_at end
   where w.id = p_withdrawal_id
     and p_state in ('sent', 'failed');
$$;

revoke all on function public.mark_withdrawal_receipt(bigint, text) from public, anon, authenticated;


-- ===========================================================================
-- 12a. The abuse fingerprint is cleared when it stops being needed
--
-- `0010` created `orders.client_hash` with this in its own column comment:
-- "cleared once the order is paid: a paid order has nothing left to throttle."
-- **Nothing ever cleared it.** The comment described an intention, the
-- Datenschutzerklärung repeated it to customers as a fact, and the hash was
-- kept indefinitely.
--
-- WHY CLEARING IS SAFE HERE, CHECKED RATHER THAN ASSUMED.
--
-- `enforce_checkout_limits()` reads the hash in two places (0010):
--
--   open checkouts   joined to `order_reservations` with `state = 'active'`.
--                    Paying converts every reservation, so a paid order is
--                    already invisible to this arm.
--   orders per hour  counts orders placed in the last hour. A paid order does
--                    count here, and clearing its hash removes it from the
--                    fingerprint arm of that count.
--
-- The second is a real, small loss and it is the trade `0010` chose: the limit
-- still catches the same person by `user_id` and by e-mail, the fingerprint arm
-- only catches somebody varying their e-mail from one address, and doing that
-- through a **completed payment** is not the abuse the limit was built for —
-- it exists to stop unpaid checkouts sitting on stock, and those keep their
-- hash until they expire.
--
-- A TRIGGER RATHER THAN A CHANGE TO `confirm_order_payment()`. That function is
-- applied, large, and about money. This is four lines beside it and cannot
-- alter what it does. `orders_protect_immutable()` permits the hash to be
-- cleared and nothing else, so the two agree by construction.
--
-- TRIGGER ORDER DOES NOT MATTER, which is worth stating because it usually
-- does. PostgreSQL fires BEFORE triggers in name order, so this one runs ahead
-- of `orders_immutable`. Both orders are correct: running first, it hands the
-- guard a NULL, which the guard explicitly allows; running second, the guard
-- has already seen an unchanged hash and passed. Nothing here depends on the
-- names staying in their current alphabetical relationship.
-- ===========================================================================

create or replace function public.orders_clear_client_hash_when_paid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_status = 'paid' and new.client_hash is not null then
    new.client_hash := null;
  end if;
  return new;
end;
$$;

comment on function public.orders_clear_client_hash_when_paid() is
  'Drops the salted request fingerprint once an order is paid, which is what orders.client_hash has claimed since 0010 and what the Datenschutzerklärung tells customers (ADR-0086).';

drop trigger if exists orders_clear_client_hash_trg on public.orders;
create trigger orders_clear_client_hash_trg
  before insert or update on public.orders
  for each row execute function public.orders_clear_client_hash_when_paid();

-- The orders that are ALREADY paid.
--
-- The trigger fixes every order from here on. Without this statement the
-- promise stays false for every order that exists on the day the migration is
-- applied — and on Production those are real customers, told in the
-- Datenschutzerklärung that their fingerprint was dropped at payment. One
-- statement makes the sentence true for all of them.
--
-- KNOWN SIDE EFFECT, not a surprise: `orders_protect_immutable()` sets
-- `updated_at := now()` on every update, so the affected rows get a fresh
-- `updated_at`. That is honest — the row genuinely changed — but it does mean
-- "last changed" for those orders becomes the migration date. Nothing else
-- moves: no amount, no status, no event, no reservation, no stock. The guard
-- permits exactly this one column to be cleared, so the statement cannot do
-- more than it says even if it were wrong.
update public.orders
   set client_hash = null
 where payment_status = 'paid'
   and client_hash is not null;


-- ===========================================================================
-- 13. The seller's identity, seeded
--
-- These are not configuration. They are the facts a customer must be able to
-- read before buying, and the facts an invoice must carry — so they are
-- written here rather than left to be typed into a form that might be left
-- empty. `src/lib/legal/seller-identity.ts` holds the same values for the
-- legal pages, and a test asserts the two agree: an Impressum that renders
-- "unbekannt" because a settings row was never filled would be worse than no
-- Impressum at all.
--
-- ONE SOLE PROPRIETORSHIP, TWO NAMES. Julian Stocker trades as
-- yulez.collectibles. `legal_name` is the person who is liable;
-- `sellers.display_name` is the shop name a customer sees. They are two names
-- for one legal person, and nothing here should be read as creating a second.
--
-- Nothing is invented: no register entry, no telephone number, no tax number
-- beyond the VAT identification number.
-- ===========================================================================

-- `public.sellers`, not `shop_settings`. Every column below was added to
-- `sellers` by `0040`; `shop_settings` holds platform configuration and has
-- none of them. And there is no `house_number` column — "Lechhalde 1 1/2" is
-- one street line, which is how the address is actually written.
update public.sellers set
  legal_name   = coalesce(nullif(btrim(legal_name),   ''), 'Julian Stocker'),
  trading_name = coalesce(nullif(btrim(trading_name), ''), 'yulez.collectibles'),
  legal_form   = coalesce(nullif(btrim(legal_form),   ''), 'Einzelunternehmen'),
  street       = coalesce(nullif(btrim(street),       ''), 'Lechhalde 1 1/2'),
  postal_code  = coalesce(nullif(btrim(postal_code),  ''), '87629'),
  city         = coalesce(nullif(btrim(city),         ''), 'Füssen'),
  country_code = coalesce(nullif(btrim(country_code), ''), 'DE'),
  contact_email = coalesce(nullif(btrim(contact_email), ''), 'info@skyisles.app'),
  vat_id       = coalesce(nullif(btrim(vat_id),       ''), 'DE321022065'),
  small_business_19 = true,
  -- The entrepreneur is neither obliged nor willing to take part in consumer
  -- dispute resolution. § 36 Abs. 3 VSBG exempts a business with ten or fewer
  -- employees from the duty to say so; it is said anyway, because it is true
  -- and useful. No body is named, because none is competent by law here.
  dispute_participation = false,
  withdrawal_contact_email =
    coalesce(nullif(btrim(withdrawal_contact_email), ''), 'info@skyisles.app'),
  complaints_contact_email =
    coalesce(nullif(btrim(complaints_contact_email), ''), 'info@skyisles.app'),
  return_postage_borne_by = 'customer',
  -- What the customer sees, and where transactional mail replies land. Same
  -- row, same statement — there is only one seller and one row to fill.
  display_name = coalesce(nullif(btrim(display_name), ''), 'yulez.collectibles'),
  transactional_reply_to =
    coalesce(nullif(btrim(transactional_reply_to), ''), 'info@skyisles.app')
where is_active;


-- ===========================================================================
-- 14. The free-shipping threshold, publicly
--
-- The shipping information page has to name the value from which delivery is
-- free, and that value lives on `sellers` — a table no client role may read,
-- correctly, because it also holds the seller's contact and tax details.
--
-- So one number is exposed, through a function, the way `shop_offers()` exposes
-- a price without exposing the inventory row behind it (ADR-0043). A shopper
-- is told this number at the checkout anyway; what must not leak is the rest
-- of the row.
-- ===========================================================================

create or replace function public.shipping_free_from()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  -- `sellers`, not `shop_settings`: `0041` moved this to the seller because it
  -- is a seller's decision (ADR-0076), copying the value across rather than
  -- defaulting it. The column still exists on `shop_settings` as the old home,
  -- which is exactly why reading the wrong one would have silently returned a
  -- stale number instead of failing.
  select s.free_shipping_threshold from public.sellers s where s.is_active limit 1;
$$;

comment on function public.shipping_free_from() is
  'The goods value from which shipping is free. One number from a table clients may not read (ADR-0086); the customer is told it at checkout regardless.';

revoke all on function public.shipping_free_from() from public;
grant execute on function public.shipping_free_from() to anon, authenticated;


-- ===========================================================================
-- 15. The mail payload carries the contract now
--
-- § 312f Abs. 2 BGB wants the contract confirmation on a durable medium, with
-- the Art. 246a particulars — not a link to a page that can change. So the
-- projection gains the seller as at this order, the legal versions that
-- applied, and the invoice number once one exists.
--
-- `create or replace` with the same signature and the same return type: this
-- is `jsonb`, so adding keys breaks nothing that reads the old ones.
-- ===========================================================================

create or replace function public.order_mail_payload(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_snap   record;
  v_result jsonb;
begin
  select o.* into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    return null;
  end if;

  select ls.* into v_snap
    from public.order_legal_snapshots ls where ls.order_id = v_order.id;

  select jsonb_build_object(
    'order_number',    v_order.order_number,
    'placed_at',       v_order.placed_at,
    'customer_email',  v_order.customer_email,
    'currency',        v_order.currency,
    'items_subtotal',  v_order.items_subtotal,
    'shipping_amount', v_order.shipping_amount,
    'discount_amount', v_order.discount_amount,
    'total_amount',    v_order.total_amount,
    'shipping_method', v_order.shipping_method_name,
    'tracking_number', v_order.tracking_number,
    'shipped_at',      v_order.shipped_at,
    'payment_status',  v_order.payment_status,
    'needs_resolution', v_order.needs_resolution,
    'address', (
      select jsonb_build_object(
        'first_name', a.first_name, 'last_name', a.last_name, 'company', a.company,
        'street', a.street, 'house_number', a.house_number,
        'address_line_2', a.address_line_2, 'postal_code', a.postal_code,
        'city', a.city, 'country_code', a.country_code
      ) from public.order_addresses a where a.order_id = v_order.id
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', l.name_snapshot, 'condition', l.condition,
        'quantity', l.quantity, 'unit_price', l.unit_price, 'line_total', l.line_total
      ) order by l.id) from public.order_lines l where l.order_id = v_order.id
    ), '[]'::jsonb),

    -- ---- new in 0047 -----------------------------------------------------
    'seller', jsonb_build_object(
      'name',       v_snap.seller_name,
      'legal_name', v_snap.seller_legal_name,
      'street',     v_snap.seller_street,
      'postal_code', v_snap.seller_postal_code,
      'city',       v_snap.seller_city,
      'email',      v_snap.seller_email,
      'vat_id',     v_snap.seller_vat_id
    ),
    'legal', jsonb_build_object(
      'agb_version',      v_snap.agb_version,
      'widerruf_version', v_snap.widerruf_version
    ),
    'invoice_number', (
      select i.invoice_number from public.invoices i where i.order_id = v_order.id
    ),
    'refunded_total', coalesce(
      (select sum(r.amount)::text from public.order_refunds r where r.order_id = v_order.id), '0')
  ) into v_result;

  return v_result;
end;
$$;
