-- ===========================================================================
-- STAGING — EIN LAUF FUER 0169–0174 (Verkaufsabgleich, ADR-0174)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0169`, diese Datei,
-- `npm run db:migrate:staging -- 0169 --resume` (Laufzettel:
-- `supabase/checks/0169-0170-0171-0172-0173-0174_staging_run.md`).
--
-- SECHS MIGRATIONEN, IN DIESER REIHENFOLGE, ZEICHENGLEICH EINGEBETTET:
-- 0169 Tabellen · 0170 Storno · 0171 Bestellnummer je Kanal · 0172 Lesen und
-- Entscheiden · 0173 Anwenden · 0174 Sicherungen. Bricht eine ab, ist KEINE
-- angewendet.
--
-- SIE AENDERT KEINE DATEN. A2 misst Verkaeufe, Positionen, Erstattungen,
-- Audit, aktive Holds, Lagerbewegungen und Legacy-Ereignisse vorher; Z1
-- misst sie nachher und bricht ab, wenn sich auch nur eine Zahl bewegt hat.
--
-- NUR STAGING. Production ist eine eigene, spaetere Entscheidung (ADR-0174).
--
-- ERWARTET: die NOTICE-Zeilen A3 und `0169-0174 ok`, dann `commit`.
-- ===========================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $lauf_a$
begin
  /* A1 — der Umgebungsstempel (Datenbankkommentar, wie beim Pruefzugang). */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     <> 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
end
$lauf_a$;

/* A2 — was sich nicht bewegen darf, vorher gemessen (Temporaertabelle, faellt mit commit). */
create temporary table recon_lauf_vorher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(s)::text, chr(10) order by s.id)), '-') from public.sales s) as verkaeufe,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(i)::text, chr(10) order by i.id)), '-') from public.sale_items i) as positionen,
  (select count(*)::text || '|' || coalesce(sum(amount), 0)::text from public.sale_refunds) as erstattungen,
  (select count(*)::text from public.orderbook_audit) as audit,
  (select count(*)::text || '|' || coalesce(sum(quantity), 0)::text from public.order_reservations where state = 'active') as holds,
  (select count(*)::text from public.inventory_movements) as bewegungen,
  (select count(*)::text from public.legacy_stock_events) as legacy;

do $lauf_a3$
declare v record;
begin
  select * into v from pg_temp.recon_lauf_vorher;
  raise notice 'A3: Verkaeufe %, Positionen %, Erstattungen %, Audit %, Holds %, Bewegungen %, Legacy %. '
    'Nach diesem Lauf muss jede dieser Zahlen gleich sein.',
    split_part(v.verkaeufe, '|', 1), split_part(v.positionen, '|', 1), v.erstattungen, v.audit, v.holds, v.bewegungen, v.legacy;
end
$lauf_a3$;

-- >>> EINGEBETTET: supabase/migrations/0169_sales_reconciliation_schema.sql
-- ===========================================================================
-- 0169 — SALES RECONCILIATION: THE RECORD (ADR-0174)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- WHAT FOR. The operator uploads platform reports (first: eBay "Orders
-- Report"); SkyIsles compares them with the external sales it holds and shows
-- every difference field by field. For each difference the operator decides:
-- take the report's value, keep SkyIsles' value, correct by hand, or decide
-- later. Only after a separate final confirmation are the decisions applied.
--
-- THIS MIGRATION HOLDS THE RECORD OF THAT PROCESS, nothing else:
--
--   sales_recon_sessions      one upload and analysis
--   sales_recon_files         the files of a session (name, SHA-256, counts)
--   sales_recon_orders        the normalised external orders — NO buyer data
--   sales_recon_matches       order <-> sale, with certainty
--   sales_recon_findings      one difference of one field
--   sales_recon_decisions     every decision ever taken (append-only)
--   sales_recon_applications  every change ever applied (append-only)
--
-- NO BUYER DATA HAS A COLUMN. A platform report carries names, addresses,
-- phone numbers and tracking numbers. The browser drops them while reading
-- (`src/lib/reconciliation/ebay/columns.ts`); `0172` refuses any payload
-- field it does not know; and this schema has nowhere to put them. Three
-- locks, each independent of the others.
--
-- WHAT IT DOES NOT TOUCH. No existing table, column, function, policy or
-- right. It writes no row. `sales`, `sale_items`, `inventory_movements` and
-- `legacy_stock_events` stay exactly as they are.
--
-- ACCESS. RLS on, no policy, every client right revoked. The only way in is
-- the seller-gated functions of `0172` and `0173` (ADR-0077, ADR-0089).
--
-- RETENTION. A session is never deleted — it is the evidence of what was
-- decided and applied. The one part that may be thinned out is the order
-- snapshot's position list (`sales_recon_orders.lines`, titles and
-- variations): `0172` offers a purge for closed or discarded sessions. What
-- an audit needs survives it — the order header, every finding with both
-- values, every decision and every application.
--
-- Rollback: `supabase/rollback/R0169_0173_drop_sales_reconciliation.sql`
-- (0174, the backup areas, has its own: `R0174_…`, and goes back first).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
do $pre$
begin
  if to_regclass('public.sales') is null or to_regclass('public.sale_items') is null then
    raise exception '0169 needs the sales book of 0059';
  end if;
  if to_regprocedure('public.can_operate_active_seller()') is null then
    raise exception '0169 needs can_operate_active_seller() from 0041';
  end if;
  if to_regclass('public.sales_recon_sessions') is not null then
    raise exception '0169 is already applied: sales_recon_sessions exists';
  end if;
end
$pre$;


-- ---------------------------------------------------------------------------
-- 1. The session
-- ---------------------------------------------------------------------------
create table public.sales_recon_sessions (
  id bigint generated always as identity primary key,
  channel text not null,
  parser text not null,
  parser_version integer not null,
  /*
   * open       decisions may be taken and applied, in as many rounds as needed
   *            ("decide later" is a real option);
   * closed     finished — readable, nothing more happens;
   * discarded  abandoned — readable, nothing was or will be applied from here.
   */
  state text not null default 'open',
  -- The sorted file fingerprints, joined: the same upload twice is the same session.
  files_key text not null,
  covered_from date,
  covered_to date,
  record_first integer,
  record_last integer,
  chain_complete boolean not null,
  -- Counts only (orders per category, per month, money totals). Never a name.
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  discarded_at timestamptz,
  discarded_by uuid,
  snapshots_purged_at timestamptz,

  constraint sales_recon_sessions_channel_known check (channel in ('ebay')),
  constraint sales_recon_sessions_parser_shape check (parser ~ '^[a-z0-9-]{1,64}$'),
  constraint sales_recon_sessions_parser_version check (parser_version between 1 and 1000),
  constraint sales_recon_sessions_state_known check (state in ('open', 'closed', 'discarded')),
  constraint sales_recon_sessions_files_key_shape check (files_key ~ '^[0-9a-f]{64}(,[0-9a-f]{64}){0,99}$'),
  constraint sales_recon_sessions_period check (covered_from is null or covered_to is null or covered_from <= covered_to),
  constraint sales_recon_sessions_summary_object check (jsonb_typeof(summary) = 'object'),
  constraint sales_recon_sessions_closed_pair check ((state = 'closed') = (closed_at is not null)),
  constraint sales_recon_sessions_discarded_pair check ((state = 'discarded') = (discarded_at is not null)),
  -- Only a finished session may lose its position lists.
  constraint sales_recon_sessions_purge_after_end check (snapshots_purged_at is null or state <> 'open'),
  constraint sales_recon_sessions_created_by_fk foreign key (created_by) references auth.users (id) on delete set null,
  constraint sales_recon_sessions_closed_by_fk foreign key (closed_by) references auth.users (id) on delete set null,
  constraint sales_recon_sessions_discarded_by_fk foreign key (discarded_by) references auth.users (id) on delete set null
);

-- The idempotency of an upload: one OPEN session per set of files.
create unique index sales_recon_sessions_open_files_uniq
  on public.sales_recon_sessions (channel, files_key) where state = 'open';

comment on table public.sales_recon_sessions is
  'One reconciliation of platform reports against the sales book (0169, ADR-0174). Never deleted: it is the evidence of what was decided and applied.';


-- ---------------------------------------------------------------------------
-- 2. The files
-- ---------------------------------------------------------------------------
create table public.sales_recon_files (
  id bigint generated always as identity primary key,
  session_id bigint not null,
  -- A file NAME, never a path: a path names a folder on somebody's disk.
  file_name text not null,
  fingerprint text not null,
  footer_count integer,
  orders integer not null,
  first_sold_on date,
  last_sold_on date,
  record_first integer,
  record_last integer,

  constraint sales_recon_files_session_fk foreign key (session_id)
    references public.sales_recon_sessions (id) on delete restrict,
  constraint sales_recon_files_name_shape check (
    length(file_name) between 1 and 200 and file_name !~ '[/\\]'),
  constraint sales_recon_files_fingerprint_shape check (fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sales_recon_files_counts check (orders >= 0 and (footer_count is null or footer_count >= 0)),
  constraint sales_recon_files_once unique (session_id, fingerprint)
);


-- ---------------------------------------------------------------------------
-- 3. The external orders, normalised
--
-- The header is columns; the positions are one JSON array whose element
-- shape `0172` enforces key by key. `lines` becomes NULL when a finished
-- session's snapshots are purged — the header stays, because findings and
-- decisions are read against it.
-- ---------------------------------------------------------------------------
create table public.sales_recon_orders (
  id bigint generated always as identity primary key,
  session_id bigint not null,
  channel text not null,
  order_ref text not null,
  record_no integer,
  sold_on date not null,
  -- Kept HERE and only here (ADR-0174, decision 1): `sales` has no payment date.
  paid_on date,
  shipped_on date,
  items_value numeric(10,2) not null,
  shipping numeric(10,2) not null,
  total numeric(10,2) not null,
  pieces integer not null,
  combined boolean not null,
  destination_country text,
  shipping_service text,
  source_file text not null,
  lines jsonb,

  constraint sales_recon_orders_session_fk foreign key (session_id)
    references public.sales_recon_sessions (id) on delete restrict,
  constraint sales_recon_orders_channel_known check (channel in ('ebay')),
  constraint sales_recon_orders_ref_shape check (order_ref ~ '^[A-Za-z0-9-]{1,64}$'),
  constraint sales_recon_orders_amounts check (
    items_value between 0 and 1000000 and shipping between 0 and 1000000 and total between 0 and 1000000),
  constraint sales_recon_orders_pieces check (pieces between 0 and 10000),
  constraint sales_recon_orders_country_shape check (destination_country is null or destination_country ~ '^[A-Z]{2}$'),
  constraint sales_recon_orders_service_shape check (shipping_service is null or length(shipping_service) <= 100),
  constraint sales_recon_orders_source_shape check (length(source_file) between 1 and 200 and source_file !~ '[/\\]'),
  constraint sales_recon_orders_lines_array check (lines is null or jsonb_typeof(lines) = 'array'),
  constraint sales_recon_orders_once unique (session_id, channel, order_ref)
);


-- ---------------------------------------------------------------------------
-- 4. Who belongs to whom
--
-- One row per external order AND one per sale the session judged. A pair has
-- both ids; `external_only` only the order; `ledger_only` and
-- `not_comparable` only the sale. Each order and each sale at most once per
-- session — the one-to-one rule as an index, not only as code.
-- ---------------------------------------------------------------------------
create table public.sales_recon_matches (
  id bigint generated always as identity primary key,
  session_id bigint not null,
  order_id bigint,
  sale_id bigint,
  category text not null,
  certainty text,
  score numeric(8,3),
  date_delta integer,
  -- Other candidates within the margin: [{"orderRef": …, "saleId": …, "score": …}].
  competitors jsonb not null default '[]'::jsonb,
  -- Why a sale could not be compared (`before_coverage`, `edge_day`, …).
  reason text,
  /*
   * THE SALE AS IT WAS WHEN THE SESSION LOOKED AT IT. Every decision and the
   * final application compare `sales.updated_at` against this; any change in
   * between (`PT409`) aborts. Refreshed only by the application itself, in
   * the same transaction as its own writes.
   */
  sale_updated_at timestamptz,

  constraint sales_recon_matches_session_fk foreign key (session_id)
    references public.sales_recon_sessions (id) on delete restrict,
  constraint sales_recon_matches_order_fk foreign key (order_id)
    references public.sales_recon_orders (id) on delete restrict,
  constraint sales_recon_matches_sale_fk foreign key (sale_id)
    references public.sales (id) on delete restrict,
  constraint sales_recon_matches_category_known check (category in
    ('exact', 'deviating', 'probable', 'ambiguous', 'external_only', 'ledger_only', 'not_comparable')),
  constraint sales_recon_matches_certainty_known check (certainty is null or certainty in
    ('deterministic', 'unique', 'probable', 'ambiguous')),
  constraint sales_recon_matches_shape check (case
    when category in ('exact', 'deviating', 'probable', 'ambiguous')
      then order_id is not null and sale_id is not null and certainty is not null
    when category = 'external_only'
      then order_id is not null and sale_id is null and certainty is null
    else order_id is null and sale_id is not null and certainty is null end),
  constraint sales_recon_matches_reason_only_when_not_comparable check (
    (category = 'not_comparable') = (reason is not null)),
  constraint sales_recon_matches_reason_known check (reason is null or reason in
    ('test', 'no_date', 'before_coverage', 'after_coverage', 'inside_gap', 'no_coverage', 'edge_day')),
  constraint sales_recon_matches_snapshot check ((sale_id is null) = (sale_updated_at is null)),
  constraint sales_recon_matches_competitors_array check (jsonb_typeof(competitors) = 'array')
);

create unique index sales_recon_matches_order_once
  on public.sales_recon_matches (session_id, order_id) where order_id is not null;
create unique index sales_recon_matches_sale_once
  on public.sales_recon_matches (session_id, sale_id) where sale_id is not null;
create index sales_recon_matches_sale_idx on public.sales_recon_matches (sale_id) where sale_id is not null;


-- ---------------------------------------------------------------------------
-- 5. One difference of one field
--
-- Built for a field-by-field merge screen: a stable key within its match,
-- the left (SkyIsles) and right (report) value, the difference, the possible
-- causes and the decisions that make sense for exactly this field. The
-- decisions are computed by the DATABASE (`0172`), never taken from the
-- payload.
-- ---------------------------------------------------------------------------
create table public.sales_recon_findings (
  id bigint generated always as identity primary key,
  match_id bigint not null,
  finding_key text not null,
  field text not null,
  kind text not null,
  ledger_value jsonb not null,
  external_value jsonb not null,
  delta numeric(12,2),
  causes jsonb not null default '[]'::jsonb,
  allowed_decisions text[] not null,

  constraint sales_recon_findings_match_fk foreign key (match_id)
    references public.sales_recon_matches (id) on delete restrict,
  constraint sales_recon_findings_key_shape check (
    finding_key ~ '^(sold_on|items_net|shipping|pieces|total|external_order_ref|figure:[0-9]{1,4})$'),
  constraint sales_recon_findings_field_known check (field in
    ('sold_on', 'items_net', 'shipping', 'pieces', 'figure', 'total', 'external_order_ref')),
  constraint sales_recon_findings_key_matches_field check (split_part(finding_key, ':', 1) = field),
  constraint sales_recon_findings_kind_known check (kind in ('deviation', 'addition')),
  -- A value is one scalar or nothing: a finding never carries a structure.
  constraint sales_recon_findings_values_scalar check (
    jsonb_typeof(ledger_value) in ('string', 'number', 'null')
    and jsonb_typeof(external_value) in ('string', 'number', 'null')),
  constraint sales_recon_findings_causes_array check (jsonb_typeof(causes) = 'array'),
  constraint sales_recon_findings_decisions_known check (
    allowed_decisions <@ array['take_external', 'keep_ledger', 'manual', 'defer']::text[]
    and cardinality(allowed_decisions) > 0),
  constraint sales_recon_findings_once unique (match_id, finding_key)
);


-- ---------------------------------------------------------------------------
-- 6. Decisions — every one ever taken, never changed
--
-- The CURRENT decision of a finding is its latest row. A changed mind is a
-- new row, so the record of who decided what, when, against which shown
-- values, is complete.
-- ---------------------------------------------------------------------------
create table public.sales_recon_decisions (
  id bigint generated always as identity primary key,
  finding_id bigint not null,
  decision text not null,
  /*
   * `manual` only, and its shape depends on the field (checked in 0172):
   *   sold_on              {"value": "2026-02-18"}
   *   items_net, shipping  {"value": 54.30}
   *   total                {"action": "refund", "amount": 6.99, "reason": "versandkorrektur", "occurred_on": "2026-09-27"}
   *                        {"action": "cancel", "cancelled_on": "2026-09-29"}
   *                        {"action": "none"}
   *   pieces, figure       {"action": "clarify"}   -- documented, never applied (V1)
   */
  manual_value jsonb,
  reason text,
  -- What the screen showed when the decision was taken.
  shown_ledger jsonb not null,
  shown_external jsonb not null,
  decided_at timestamptz not null default now(),
  decided_by uuid,

  constraint sales_recon_decisions_finding_fk foreign key (finding_id)
    references public.sales_recon_findings (id) on delete restrict,
  constraint sales_recon_decisions_known check (decision in ('take_external', 'keep_ledger', 'manual', 'defer')),
  constraint sales_recon_decisions_manual_value check ((decision = 'manual') = (manual_value is not null)),
  constraint sales_recon_decisions_manual_object check (manual_value is null or jsonb_typeof(manual_value) = 'object'),
  constraint sales_recon_decisions_reason_shape check (reason is null or length(btrim(reason)) between 1 and 500),
  constraint sales_recon_decisions_decided_by_fk foreign key (decided_by) references auth.users (id) on delete set null
);

create index sales_recon_decisions_latest on public.sales_recon_decisions (finding_id, id desc);


-- ---------------------------------------------------------------------------
-- 7. Applications — every change ever made from a decision, never changed
--
-- `applied`     the sales book was changed: the field, the value before and
--               after (the same change also stands in `orderbook_audit`,
--               written by the function that made it);
-- `documented`  nothing was changed on purpose — a clarification of pieces or
--               figures (V1 never changes `sale_items`) or "no action".
-- One application per decision: applying twice is a no-op, by index.
-- ---------------------------------------------------------------------------
create table public.sales_recon_applications (
  id bigint generated always as identity primary key,
  decision_id bigint not null,
  session_id bigint not null,
  sale_id bigint not null,
  field text not null,
  outcome text not null,
  old_value text,
  new_value text,
  applied_at timestamptz not null default now(),
  applied_by uuid,

  constraint sales_recon_applications_decision_fk foreign key (decision_id)
    references public.sales_recon_decisions (id) on delete restrict,
  constraint sales_recon_applications_session_fk foreign key (session_id)
    references public.sales_recon_sessions (id) on delete restrict,
  constraint sales_recon_applications_sale_fk foreign key (sale_id)
    references public.sales (id) on delete restrict,
  constraint sales_recon_applications_outcome_known check (outcome in ('applied', 'documented')),
  constraint sales_recon_applications_field_known check (field in
    ('sold_on', 'items_net', 'shipping', 'pieces', 'figure', 'total', 'external_order_ref')),
  constraint sales_recon_applications_once unique (decision_id),
  constraint sales_recon_applications_applied_by_fk foreign key (applied_by) references auth.users (id) on delete set null
);

create index sales_recon_applications_sale_idx on public.sales_recon_applications (sale_id);


-- ---------------------------------------------------------------------------
-- 8. Append-only, for the two tables that ARE the evidence
--
-- A row trigger does not fire on TRUNCATE; that console-only escape hatch is
-- the same as for `legacy_stock_events` (0079) and is not a client path.
-- ---------------------------------------------------------------------------
create or replace function public.sales_recon_evidence_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.sales_recon_evidence_is_append_only() from public, anon, authenticated;

create trigger sales_recon_decisions_append_only
  before update or delete on public.sales_recon_decisions
  for each row execute function public.sales_recon_evidence_is_append_only();
create trigger sales_recon_applications_append_only
  before update or delete on public.sales_recon_applications
  for each row execute function public.sales_recon_evidence_is_append_only();


-- ---------------------------------------------------------------------------
-- 9. Closed to every client
-- ---------------------------------------------------------------------------
alter table public.sales_recon_sessions     enable row level security;
alter table public.sales_recon_files        enable row level security;
alter table public.sales_recon_orders       enable row level security;
alter table public.sales_recon_matches      enable row level security;
alter table public.sales_recon_findings     enable row level security;
alter table public.sales_recon_decisions    enable row level security;
alter table public.sales_recon_applications enable row level security;

revoke all on table public.sales_recon_sessions     from public, anon, authenticated;
revoke all on table public.sales_recon_files        from public, anon, authenticated;
revoke all on table public.sales_recon_orders       from public, anon, authenticated;
revoke all on table public.sales_recon_matches      from public, anon, authenticated;
revoke all on table public.sales_recon_findings     from public, anon, authenticated;
revoke all on table public.sales_recon_decisions    from public, anon, authenticated;
revoke all on table public.sales_recon_applications from public, anon, authenticated;
-- <<< ENDE: supabase/migrations/0169_sales_reconciliation_schema.sql

-- >>> EINGEBETTET: supabase/migrations/0170_external_sale_cancel.sql
-- ===========================================================================
-- 0170 — CANCELLING AN EXTERNAL SALE, AND TAKING IT BACK (ADR-0174)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- THE GAP. `sales.cancelled_at` exists since `0071`, and every stock function
-- honours it — but nothing could set it except that migration's one-off data
-- block. An external order the buyer called off had no way into the books.
-- The reconciliation finds such orders (an eBay total of 0,00 €, nothing
-- shipped); this gives the operator the safe way to record them.
--
-- TWO FUNCTIONS, BOTH SELLER-GATED, BOTH AUDITED, BOTH WITH THE CONFLICT TOKEN:
--
--   seller_cancel_external_sale(id, reason, cancelled_on, expected_updated_at)
--   seller_uncancel_external_sale(id, reason, expected_updated_at)
--
-- WHAT A CANCELLATION REFUSES
--
--   * an internal sale (commerce owns its order and its cancellation);
--   * a sale already cancelled;
--   * a historical sale RELEASED for stock work (`stock_released_at`):
--     `sales_cancelled_is_not_released` (0071) forbids the pair, and saying so
--     is better than a constraint error;
--   * any position that has ENDED: booked out (`movement_id`), returned,
--     return announced, restocked or settled. Something left the shelf or was
--     closed — that is a return or a correction, not a cancellation.
--
-- WHAT IT DOES
--
--   * releases every active external hold of the sale's positions through
--     `release_sale_item_hold` (0110): `shop_inventory.reserved` goes down,
--     and NO inventory movement is written — the goods never left;
--   * sets `cancelled_at`;
--   * writes the reason and the date into `orderbook_audit`. The reason has no
--     column of its own: the audit is where corrections are explained, and
--     it is in every backup already.
--
-- TAKING IT BACK reverses exactly that: `cancelled_at` becomes NULL, and every
-- position without an ending tries to get its hold back through
-- `hold_sale_item` (0110) — the same attempt a new sale makes. Like a new
-- sale, missing stock does not block it (a sale is a fact even when the shelf
-- is empty); the function returns, per position, what the attempt said, and
-- the caller shows it.
--
-- WHAT NEITHER DOES. No `inventory_movements` row, no change to `sale_items`
-- (a hold lives in `order_reservations`), no `legacy_stock_events`, no refund.
-- A cancelled order that WAS paid and refunded gets its refund recorded
-- separately — the two are different facts (ADR-0118).
--
-- Rollback: `supabase/rollback/R0169_0173_drop_sales_reconciliation.sql`.
-- ===========================================================================


do $pre$
begin
  if to_regprocedure('public.release_sale_item_hold(bigint)') is null
     or to_regprocedure('public.hold_sale_item(bigint)') is null then
    raise exception '0170 needs the external holds of 0110';
  end if;
  if to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)') is null
     or to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)') is null then
    raise exception '0170 needs the audit and the conflict token of 0062';
  end if;
  if to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)') is not null then
    raise exception '0170 is already applied: seller_cancel_external_sale exists';
  end if;
end
$pre$;


create or replace function public.seller_cancel_external_sale(
  p_id bigint,
  p_reason text,
  p_cancelled_on date default null,
  p_expected_updated_at timestamptz default null
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_sale public.sales;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_on date := coalesce(p_cancelled_on, current_date);
  v_item record;
  v_released integer := 0;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'a cancellation needs a reason (at most 500 characters)' using errcode = 'check_violation';
  end if;
  if v_on < date '2000-01-01' or v_on > current_date + 1 then
    raise exception 'that cancellation date is outside the plausible range' using errcode = 'check_violation';
  end if;

  select * into v_sale from public.sales where id = p_id for update;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;
  if v_sale.order_id is not null then
    raise exception 'an order is cancelled in commerce, not in the Orderbuch' using errcode = 'restrict_violation';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'this sale is already cancelled' using errcode = 'restrict_violation';
  end if;
  if v_sale.stock_released_at is not null then
    raise exception 'a sale released for stock work cannot be cancelled' using errcode = 'restrict_violation';
  end if;
  if exists (select 1 from public.sale_items i
              where i.sale_id = p_id
                and (i.movement_id is not null or i.return_movement_id is not null
                     or i.returned_at is not null or i.return_announced_at is not null
                     or i.settled_at is not null)) then
    raise exception 'a position of this sale has already ended (booked out, returned or settled)'
      using errcode = 'restrict_violation';
  end if;

  perform public.orderbook_guard_stale(p_id, p_expected_updated_at);

  for v_item in select i.id from public.sale_items i where i.sale_id = p_id order by i.id loop
    if public.release_sale_item_hold(v_item.id) = 'released' then
      v_released := v_released + 1;
    end if;
  end loop;

  update public.sales
     set cancelled_at = v_on::timestamptz, updated_at = now(), updated_by = (select auth.uid())
   where id = p_id;

  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'cancelled_at', null, v_on::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'cancel_reason', null, v_reason);
  return v_released;
end;
$$;

comment on function public.seller_cancel_external_sale(bigint, text, date, timestamptz) is
  'Cancels an external sale (0170, ADR-0174): releases its holds without any inventory movement, sets cancelled_at, audits date and reason. Refuses internal, already cancelled, released-historical sales and any sale with an ended position. Returns the number of holds released.';

revoke all on function public.seller_cancel_external_sale(bigint, text, date, timestamptz) from public, anon;
grant execute on function public.seller_cancel_external_sale(bigint, text, date, timestamptz) to authenticated;


create or replace function public.seller_uncancel_external_sale(
  p_id bigint,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_sale public.sales;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_item record;
  v_outcomes jsonb := '[]'::jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'taking back a cancellation needs a reason (at most 500 characters)' using errcode = 'check_violation';
  end if;

  select * into v_sale from public.sales where id = p_id for update;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;
  if v_sale.order_id is not null then
    raise exception 'an order is cancelled in commerce, not in the Orderbuch' using errcode = 'restrict_violation';
  end if;
  if v_sale.cancelled_at is null then
    raise exception 'this sale is not cancelled' using errcode = 'restrict_violation';
  end if;

  perform public.orderbook_guard_stale(p_id, p_expected_updated_at);

  update public.sales
     set cancelled_at = null, updated_at = now(), updated_by = (select auth.uid())
   where id = p_id;

  -- The same attempt a new sale makes; it never throws for missing stock.
  for v_item in select i.id from public.sale_items i where i.sale_id = p_id order by i.id loop
    v_outcomes := v_outcomes || jsonb_build_object('item_id', v_item.id, 'hold', public.hold_sale_item(v_item.id));
  end loop;

  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'cancelled_at', v_sale.cancelled_at::date::text, null);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'cancel_reason', 'cancellation taken back', v_reason);
  return v_outcomes;
end;
$$;

comment on function public.seller_uncancel_external_sale(bigint, text, timestamptz) is
  'Takes back the cancellation of an external sale (0170, ADR-0174): clears cancelled_at, tries to re-hold every position like a new sale does (missing stock does not block), audits the reason. Returns the hold outcome per position.';

revoke all on function public.seller_uncancel_external_sale(bigint, text, timestamptz) from public, anon;
grant execute on function public.seller_uncancel_external_sale(bigint, text, timestamptz) to authenticated;
-- <<< ENDE: supabase/migrations/0170_external_sale_cancel.sql

-- >>> EINGEBETTET: supabase/migrations/0171_external_order_ref_per_channel.sql
-- ===========================================================================
-- 0171 — ONE EXTERNAL ORDER, ONE SALE, PER PLATFORM (ADR-0174)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- `sales.external_order_ref` (0059) has had no rule at all: free text, no
-- index, no uniqueness. As long as nobody stored eBay order numbers that did
-- not matter. The reconciliation now offers to store them — one explicit
-- decision at a time, never in bulk — and from then on the reference IS the
-- identity: stage A of the matching (`src/lib/reconciliation/match.ts`)
-- pairs a sale with the order whose number it carries, and with no other.
-- Two sales carrying the same order number would make that ambiguous.
--
-- THE RULE. Within one channel (`ebay`, `manual`, …) an order number belongs
-- to at most one sale. Two platforms may use the same string; that is not a
-- clash. Test sales are exempt — fixtures may reuse a number on purpose.
-- Unset references (NULL, the normal historical case) are not affected.
--
-- WHAT IT DOES NOT DO. It sets, changes or clears no reference. If any two
-- sales already share one, it refuses and names the count — the operator
-- resolves it by hand, nothing is guessed.
--
-- Rollback: `supabase/rollback/R0169_0173_drop_sales_reconciliation.sql`.
-- ===========================================================================


do $pre$
declare
  v_clashes integer;
begin
  if to_regclass('public.sales_external_order_ref_per_channel') is not null then
    raise exception '0171 is already applied: sales_external_order_ref_per_channel exists';
  end if;
  select count(*) into v_clashes from (
    select channel, external_order_ref
      from public.sales
     where external_order_ref is not null and not is_test
     group by channel, external_order_ref
    having count(*) > 1) d;
  if v_clashes > 0 then
    raise exception '0171 stops: % order number(s) are already carried by more than one sale of the same channel', v_clashes;
  end if;
end
$pre$;

create unique index sales_external_order_ref_per_channel
  on public.sales (channel, external_order_ref)
  where external_order_ref is not null and not is_test;

comment on index public.sales_external_order_ref_per_channel is
  'Within one channel an external order number belongs to at most one non-test sale (0171, ADR-0174). Stage A of the sales reconciliation relies on it.';
-- <<< ENDE: supabase/migrations/0171_external_order_ref_per_channel.sql

-- >>> EINGEBETTET: supabase/migrations/0172_sales_reconciliation_rpcs.sql
-- ===========================================================================
-- 0172 — SALES RECONCILIATION: READING, RECORDING, DECIDING (ADR-0174)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- The functions around the record of `0169`. Applying a decision is `0173`.
--
--   seller_recon_candidates(channel, from, to)   the sales to compare against
--   seller_recon_aliases(channel)                names each SKY-ID was sold under
--   seller_recon_create(payload)                 store one analysed session
--   seller_recon_sessions()                      list
--   seller_recon_session(id, category, offset, limit)   read, page by page
--   seller_recon_decide(finding, decision, …)    record one decision
--   seller_recon_close(id) / seller_recon_discard(id)
--   seller_recon_thin_snapshots(id)             thin out a finished session
--
-- EVERY FUNCTION: `security definer`, empty `search_path`, gated by
-- `can_operate_active_seller()` (ADR-0077), EXECUTE for `authenticated` only.
-- The internal helpers hold no client right at all.
--
-- THE PAYLOAD IS NOT TRUSTED. The analysis runs in TypeScript (the server
-- action), but anybody with a session could call `seller_recon_create`
-- directly. So the database checks everything it stores itself:
--
--   * EVERY object, at every level, may only carry its listed keys. An
--     unknown key — `buyerName`, `address`, anything — aborts the whole call.
--     This is the third lock against buyer data, after the browser parser
--     and the schema.
--   * Every text has a length limit, every amount a range, every date a shape.
--   * The session summary may hold numbers only (and short keys).
--   * Every sale named must exist, be external and belong to the channel, and
--     its `updated_at` must still be what the analysis read — otherwise PT409.
--   * The decisions a finding allows are computed HERE from its field, not
--     taken from the payload.
--
-- DECIDING follows the pattern of `0156`: the caller sends the values the
-- screen SHOWED; they must equal the stored finding, and the sale must be
-- unchanged since the analysis. Otherwise PT409, and nothing is recorded.
--
-- Rollback: `supabase/rollback/R0169_0173_drop_sales_reconciliation.sql`.
-- ===========================================================================


do $pre$
begin
  if to_regclass('public.sales_recon_sessions') is null then
    raise exception '0172 needs 0169: sales_recon_sessions is missing';
  end if;
  if to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)') is null then
    raise exception '0172 needs 0170: seller_cancel_external_sale is missing';
  end if;
  if to_regprocedure('public.seller_recon_create(jsonb)') is not null then
    raise exception '0172 is already applied: seller_recon_create exists';
  end if;
end
$pre$;


-- ---------------------------------------------------------------------------
-- 1. Internal helpers — no client right
-- ---------------------------------------------------------------------------

create or replace function public.sales_recon_gate()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

/* An object with only the listed keys. Names the unknown keys, never a value. */
create or replace function public.sales_recon_only_keys(p_obj jsonb, p_allowed text[], p_what text)
returns void
language plpgsql immutable set search_path = ''
as $$
declare v_unknown text;
begin
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' then
    raise exception '% must be an object', p_what using errcode = 'check_violation';
  end if;
  select string_agg(k, ', ' order by k) into v_unknown
    from jsonb_object_keys(p_obj) k
   where not (k = any (p_allowed));
  if v_unknown is not null then
    raise exception '% carries unknown field(s): %', p_what, v_unknown using errcode = 'check_violation';
  end if;
end;
$$;

/*
 * NO CONTACT DATA IN FREE TEXT. The key whitelist keeps buyer FIELDS out;
 * this keeps buyer DATA out of the fields that remain free text — a title,
 * a variation, a reason. It refuses what is unambiguously contact data: an
 * e-mail address, and a phone number in international form (`+49 …`). A
 * plain digit run is NOT refused — portal model numbers (`84148790`) and
 * order numbers are digit runs too. Names the field, never the value.
 */
create or replace function public.sales_recon_no_contact(p_text text, p_what text)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_text is null then return; end if;
  if p_text ~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}' then
    raise exception '% looks like it contains an e-mail address', p_what using errcode = 'check_violation';
  end if;
  if p_text ~ '\+[0-9]{2}[0-9 /().-]{6,}[0-9]' then
    raise exception '% looks like it contains a phone number', p_what using errcode = 'check_violation';
  end if;
end;
$$;

/* A string field, trimmed, NULL when absent or JSON null; refused when too long. */
create or replace function public.sales_recon_text(p_obj jsonb, p_key text, p_max integer, p_required boolean, p_what text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare v jsonb := p_obj -> p_key; t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_required then raise exception '%.% is required', p_what, p_key using errcode = 'check_violation'; end if;
    return null;
  end if;
  if jsonb_typeof(v) <> 'string' then
    raise exception '%.% must be text', p_what, p_key using errcode = 'check_violation';
  end if;
  t := btrim(v #>> '{}');
  if length(t) > p_max then
    raise exception '%.% is longer than % characters', p_what, p_key, p_max using errcode = 'check_violation';
  end if;
  if t = '' then
    if p_required then raise exception '%.% is required', p_what, p_key using errcode = 'check_violation'; end if;
    return null;
  end if;
  perform public.sales_recon_no_contact(t, p_what || '.' || p_key);
  return t;
end;
$$;

create or replace function public.sales_recon_number(p_obj jsonb, p_key text, p_min numeric, p_max numeric, p_required boolean, p_what text)
returns numeric
language plpgsql immutable set search_path = ''
as $$
declare v jsonb := p_obj -> p_key; n numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_required then raise exception '%.% is required', p_what, p_key using errcode = 'check_violation'; end if;
    return null;
  end if;
  if jsonb_typeof(v) <> 'number' then
    raise exception '%.% must be a number', p_what, p_key using errcode = 'check_violation';
  end if;
  n := (v #>> '{}')::numeric;
  if n < p_min or n > p_max then
    raise exception '%.% is outside % … %', p_what, p_key, p_min, p_max using errcode = 'check_violation';
  end if;
  return n;
end;
$$;

create or replace function public.sales_recon_day(p_obj jsonb, p_key text, p_required boolean, p_what text)
returns date
language plpgsql immutable set search_path = ''
as $$
declare t text := public.sales_recon_text(p_obj, p_key, 10, p_required, p_what);
begin
  if t is null then return null; end if;
  if t !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception '%.% is not a day (YYYY-MM-DD)', p_what, p_key using errcode = 'check_violation';
  end if;
  return t::date;
exception when datetime_field_overflow or invalid_datetime_format then
  raise exception '%.% is not a valid day', p_what, p_key using errcode = 'check_violation';
end;
$$;

create or replace function public.sales_recon_array(p_obj jsonb, p_key text, p_max integer, p_what text)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare v jsonb := coalesce(p_obj -> p_key, '[]'::jsonb);
begin
  if jsonb_typeof(v) <> 'array' then
    raise exception '%.% must be a list', p_what, p_key using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v) > p_max then
    raise exception '%.% has more than % entries', p_what, p_key, p_max using errcode = 'check_violation';
  end if;
  return v;
end;
$$;

/* Numbers only, under short plain keys — a summary can carry no name. */
create or replace function public.sales_recon_numbers_only(p jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select case jsonb_typeof(p)
    when 'number' then true
    when 'object' then coalesce((select bool_and(e.key ~ '^[A-Za-z0-9_-]{1,40}$'
                                                 and public.sales_recon_numbers_only(e.value))
                                   from jsonb_each(p) e), true)
    else false end
$$;

/*
 * THE DECISIONS A FIELD ALLOWS — the one place this is decided.
 *
 *   sold_on, items_net, shipping   a value: take, keep, correct, later
 *   external_order_ref             an ADDITION: take or not, never "correct"
 *   total                          an EVENT (refund, cancellation): never a
 *                                  value to copy — only by hand, with reason
 *   pieces, figure                 V1 never changes `sale_items`: only a
 *                                  documented clarification (ADR-0174)
 */
create or replace function public.sales_recon_allowed(p_field text)
returns text[]
language sql immutable set search_path = ''
as $$
  select case p_field
    when 'sold_on'            then array['take_external', 'keep_ledger', 'manual', 'defer']
    when 'items_net'          then array['take_external', 'keep_ledger', 'manual', 'defer']
    when 'shipping'           then array['take_external', 'keep_ledger', 'manual', 'defer']
    when 'external_order_ref' then array['take_external', 'keep_ledger', 'defer']
    when 'total'              then array['manual', 'keep_ledger', 'defer']
    when 'pieces'             then array['manual', 'keep_ledger', 'defer']
    when 'figure'             then array['manual', 'keep_ledger', 'defer']
  end::text[]
$$;

revoke all on function public.sales_recon_gate() from public, anon, authenticated;
revoke all on function public.sales_recon_only_keys(jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.sales_recon_no_contact(text, text) from public, anon, authenticated;
revoke all on function public.sales_recon_text(jsonb, text, integer, boolean, text) from public, anon, authenticated;
revoke all on function public.sales_recon_number(jsonb, text, numeric, numeric, boolean, text) from public, anon, authenticated;
revoke all on function public.sales_recon_day(jsonb, text, boolean, text) from public, anon, authenticated;
revoke all on function public.sales_recon_array(jsonb, text, integer, text) from public, anon, authenticated;
revoke all on function public.sales_recon_numbers_only(jsonb) from public, anon, authenticated;
revoke all on function public.sales_recon_allowed(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. What the analysis compares against
-- ---------------------------------------------------------------------------

/*
 * Every external sale of the channel whose day lies within the period ±3
 * days, test sales included (the analysis must be able to say "not
 * comparable: test"), with its pieces. Amounts are those of the SALE.
 */
create or replace function public.seller_recon_candidates(p_channel text, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.sales_recon_gate();
  if p_channel is null or p_channel not in ('ebay') then
    raise exception 'unknown channel' using errcode = 'check_violation';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then
    raise exception 'a period of at most 400 days is required' using errcode = 'check_violation';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'saleId', s.id,
             'source', s.source,
             'isTest', s.is_test,
             'soldOn', s.sold_at,
             'itemsSubtotal', coalesce(s.items_subtotal, 0),
             'discount', coalesce(s.discount_amount, 0),
             'shipping', coalesce(s.shipping_charged, 0),
             'refundsTotal', coalesce((select sum(r.amount) from public.sale_refunds r where r.sale_id = s.id), 0),
             'cancelledOn', s.cancelled_at::date,
             'externalOrderRef', s.external_order_ref,
             'updatedAt', s.updated_at,
             'pieces', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'itemId', i.id, 'skyId', i.sky_id, 'name', k.name, 'rawName', i.raw_name,
                        'seriesCode', k.series_code, 'baseSkyId', k.base_sky_id)
                      order by i.position, i.id)
                 from public.sale_items i
                 left join public.skylanders k on k.sky_id = i.sky_id
                where i.sale_id = s.id), '[]'::jsonb))
           order by s.sold_at, s.id)
      from public.sales s
     where s.channel = p_channel
       and s.order_id is null
       and s.sold_at between p_from - 3 and p_to + 3), '[]'::jsonb);
end;
$$;

/* The ledger as alias table: every name a SKY-ID was sold under on this channel. */
create or replace function public.seller_recon_aliases(p_channel text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.sales_recon_gate();
  if p_channel is null or p_channel not in ('ebay') then
    raise exception 'unknown channel' using errcode = 'check_violation';
  end if;
  return coalesce((
    select jsonb_object_agg(x.sky_id, x.names)
      from (select n.sky_id, jsonb_agg(distinct n.name) as names
              from (select i.sky_id, i.raw_name as name
                      from public.sale_items i join public.sales s on s.id = i.sale_id
                     where s.channel = p_channel and s.order_id is null
                       and i.sky_id is not null and i.raw_name is not null
                    union
                    select k.sky_id, k.name
                      from public.skylanders k
                     where exists (select 1 from public.sale_items i join public.sales s on s.id = i.sale_id
                                    where i.sky_id = k.sky_id and s.channel = p_channel)) n
             group by n.sky_id) x), '{}'::jsonb);
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Recording one analysed session — one transaction, or nothing
-- ---------------------------------------------------------------------------

create or replace function public.seller_recon_create(p_payload jsonb)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_channel text;
  v_session bigint;
  v_files jsonb; v_orders jsonb; v_matches jsonb; v_coverage jsonb; v_summary jsonb;
  v_file jsonb; v_order jsonb; v_line jsonb; v_match jsonb; v_finding jsonb; v_item jsonb;
  v_files_key text;
  v_order_id bigint; v_match_id bigint; v_sale public.sales; v_seen timestamptz;
  v_field text; v_key text;
begin
  perform public.sales_recon_gate();
  perform public.sales_recon_only_keys(p_payload,
    array['channel', 'parser', 'parserVersion', 'coverage', 'summary', 'files', 'orders', 'matches'], 'payload');

  v_channel := public.sales_recon_text(p_payload, 'channel', 16, true, 'payload');
  if v_channel not in ('ebay') then
    raise exception 'unknown channel' using errcode = 'check_violation';
  end if;
  v_files := public.sales_recon_array(p_payload, 'files', 100, 'payload');
  v_orders := public.sales_recon_array(p_payload, 'orders', 5000, 'payload');
  v_matches := public.sales_recon_array(p_payload, 'matches', 10000, 'payload');
  if jsonb_array_length(v_files) = 0 then
    raise exception 'a session needs at least one file' using errcode = 'check_violation';
  end if;

  v_coverage := coalesce(p_payload -> 'coverage', '{}'::jsonb);
  perform public.sales_recon_only_keys(v_coverage,
    array['coveredFrom', 'coveredTo', 'recordFirst', 'recordLast', 'chainComplete'], 'coverage');
  if jsonb_typeof(v_coverage -> 'chainComplete') is distinct from 'boolean' then
    raise exception 'coverage.chainComplete must be true or false' using errcode = 'check_violation';
  end if;

  v_summary := coalesce(p_payload -> 'summary', '{}'::jsonb);
  if jsonb_typeof(v_summary) <> 'object' or not public.sales_recon_numbers_only(v_summary) then
    raise exception 'summary may hold numbers only' using errcode = 'check_violation';
  end if;

  -- The same set of files as an OPEN session: that session, not a second one.
  for v_file in select * from jsonb_array_elements(v_files) loop
    perform public.sales_recon_only_keys(v_file,
      array['fileName', 'fingerprint', 'footerCount', 'orders', 'firstSoldOn', 'lastSoldOn', 'recordFirst', 'recordLast'], 'file');
  end loop;
  select string_agg(distinct f ->> 'fingerprint', ',' order by f ->> 'fingerprint')
    into v_files_key from jsonb_array_elements(v_files) f;
  select id into v_session from public.sales_recon_sessions
   where channel = v_channel and files_key = v_files_key and state = 'open';
  if v_session is not null then
    return v_session;
  end if;

  insert into public.sales_recon_sessions
    (channel, parser, parser_version, files_key, covered_from, covered_to, record_first, record_last,
     chain_complete, summary, created_by)
  values (v_channel,
          public.sales_recon_text(p_payload, 'parser', 64, true, 'payload'),
          public.sales_recon_number(p_payload, 'parserVersion', 1, 1000, true, 'payload')::integer,
          v_files_key,
          public.sales_recon_day(v_coverage, 'coveredFrom', false, 'coverage'),
          public.sales_recon_day(v_coverage, 'coveredTo', false, 'coverage'),
          public.sales_recon_number(v_coverage, 'recordFirst', 0, 100000000, false, 'coverage')::integer,
          public.sales_recon_number(v_coverage, 'recordLast', 0, 100000000, false, 'coverage')::integer,
          (v_coverage ->> 'chainComplete')::boolean,
          v_summary,
          (select auth.uid()))
  /*
   * TWO TABS, ONE UPLOAD. The check above is not enough under concurrency:
   * two calls can both find no open session. The partial unique index
   * decides, and the loser receives the winner's session instead of an
   * error — the same answer as the sequential case.
   */
  on conflict (channel, files_key) where state = 'open' do nothing
  returning id into v_session;
  if v_session is null then
    select id into v_session from public.sales_recon_sessions
     where channel = v_channel and files_key = v_files_key and state = 'open';
    return v_session;
  end if;

  for v_file in select * from jsonb_array_elements(v_files) loop
    insert into public.sales_recon_files
      (session_id, file_name, fingerprint, footer_count, orders, first_sold_on, last_sold_on, record_first, record_last)
    values (v_session,
            public.sales_recon_text(v_file, 'fileName', 200, true, 'file'),
            public.sales_recon_text(v_file, 'fingerprint', 64, true, 'file'),
            public.sales_recon_number(v_file, 'footerCount', 0, 1000000, false, 'file')::integer,
            public.sales_recon_number(v_file, 'orders', 0, 1000000, true, 'file')::integer,
            public.sales_recon_day(v_file, 'firstSoldOn', false, 'file'),
            public.sales_recon_day(v_file, 'lastSoldOn', false, 'file'),
            public.sales_recon_number(v_file, 'recordFirst', 0, 100000000, false, 'file')::integer,
            public.sales_recon_number(v_file, 'recordLast', 0, 100000000, false, 'file')::integer);
  end loop;

  for v_order in select * from jsonb_array_elements(v_orders) loop
    perform public.sales_recon_only_keys(v_order,
      array['channel', 'orderRef', 'recordNo', 'soldOn', 'paidOn', 'shippedOn', 'itemsValue', 'shipping', 'total',
            'pieces', 'combined', 'destinationCountry', 'shippingService', 'sourceFile', 'lines'], 'order');
    if coalesce(v_order ->> 'channel', v_channel) <> v_channel then
      raise exception 'an order of another channel' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_order -> 'combined') is distinct from 'boolean' then
      raise exception 'order.combined must be true or false' using errcode = 'check_violation';
    end if;
    for v_line in select * from jsonb_array_elements(public.sales_recon_array(v_order, 'lines', 500, 'order')) loop
      perform public.sales_recon_only_keys(v_line,
        array['lineRef', 'listingId', 'title', 'variant', 'name', 'quantity', 'unitPrice', 'value'], 'line');
      perform public.sales_recon_text(v_line, 'lineRef', 64, false, 'line');
      perform public.sales_recon_text(v_line, 'listingId', 32, true, 'line');
      perform public.sales_recon_text(v_line, 'title', 300, true, 'line');
      perform public.sales_recon_text(v_line, 'variant', 300, false, 'line');
      perform public.sales_recon_text(v_line, 'name', 200, true, 'line');
      perform public.sales_recon_number(v_line, 'quantity', 1, 10000, true, 'line');
      perform public.sales_recon_number(v_line, 'unitPrice', 0, 1000000, true, 'line');
      perform public.sales_recon_number(v_line, 'value', 0, 1000000, true, 'line');
    end loop;
    insert into public.sales_recon_orders
      (session_id, channel, order_ref, record_no, sold_on, paid_on, shipped_on, items_value, shipping, total,
       pieces, combined, destination_country, shipping_service, source_file, lines)
    values (v_session, v_channel,
            public.sales_recon_text(v_order, 'orderRef', 64, true, 'order'),
            public.sales_recon_number(v_order, 'recordNo', 0, 100000000, false, 'order')::integer,
            public.sales_recon_day(v_order, 'soldOn', true, 'order'),
            public.sales_recon_day(v_order, 'paidOn', false, 'order'),
            public.sales_recon_day(v_order, 'shippedOn', false, 'order'),
            public.sales_recon_number(v_order, 'itemsValue', 0, 1000000, true, 'order'),
            public.sales_recon_number(v_order, 'shipping', 0, 1000000, true, 'order'),
            public.sales_recon_number(v_order, 'total', 0, 1000000, true, 'order'),
            public.sales_recon_number(v_order, 'pieces', 0, 10000, true, 'order')::integer,
            (v_order ->> 'combined')::boolean,
            public.sales_recon_text(v_order, 'destinationCountry', 2, false, 'order'),
            public.sales_recon_text(v_order, 'shippingService', 100, false, 'order'),
            public.sales_recon_text(v_order, 'sourceFile', 200, true, 'order'),
            v_order -> 'lines');
  end loop;

  for v_match in select * from jsonb_array_elements(v_matches) loop
    perform public.sales_recon_only_keys(v_match,
      array['orderRef', 'saleId', 'saleUpdatedAt', 'category', 'certainty', 'score', 'dateDelta',
            'competitors', 'reason', 'findings'], 'match');

    v_order_id := null;
    if public.sales_recon_text(v_match, 'orderRef', 64, false, 'match') is not null then
      select o.id into v_order_id from public.sales_recon_orders o
       where o.session_id = v_session and o.order_ref = v_match ->> 'orderRef';
      if v_order_id is null then
        raise exception 'a match names an order that is not in this session' using errcode = 'check_violation';
      end if;
    end if;

    v_sale := null;
    v_seen := null;
    if public.sales_recon_number(v_match, 'saleId', 1, 9223372036854775807, false, 'match') is not null then
      select * into v_sale from public.sales where id = (v_match ->> 'saleId')::bigint;
      if not found then
        raise exception 'a match names a sale that does not exist' using errcode = 'no_data_found';
      end if;
      if v_sale.channel <> v_channel or v_sale.order_id is not null then
        raise exception 'a match names a sale of another channel or an internal sale' using errcode = 'check_violation';
      end if;
      v_seen := (public.sales_recon_text(v_match, 'saleUpdatedAt', 40, true, 'match'))::timestamptz;
      if v_sale.updated_at is distinct from v_seen then
        raise exception 'sale % changed while it was being analysed — analyse again', v_sale.id
          using errcode = 'PT409';
      end if;
    end if;

    for v_item in select * from jsonb_array_elements(public.sales_recon_array(v_match, 'competitors', 50, 'match')) loop
      perform public.sales_recon_only_keys(v_item, array['orderRef', 'saleId', 'score'], 'competitor');
      perform public.sales_recon_text(v_item, 'orderRef', 64, true, 'competitor');
      perform public.sales_recon_number(v_item, 'saleId', 1, 9223372036854775807, true, 'competitor');
      perform public.sales_recon_number(v_item, 'score', -1000, 1000, true, 'competitor');
    end loop;

    insert into public.sales_recon_matches
      (session_id, order_id, sale_id, category, certainty, score, date_delta, competitors, reason, sale_updated_at)
    values (v_session, v_order_id, v_sale.id,
            public.sales_recon_text(v_match, 'category', 32, true, 'match'),
            public.sales_recon_text(v_match, 'certainty', 32, false, 'match'),
            public.sales_recon_number(v_match, 'score', -1000, 1000, false, 'match'),
            public.sales_recon_number(v_match, 'dateDelta', -100000, 100000, false, 'match')::integer,
            coalesce(v_match -> 'competitors', '[]'::jsonb),
            public.sales_recon_text(v_match, 'reason', 32, false, 'match'),
            v_seen)
    returning id into v_match_id;

    for v_finding in select * from jsonb_array_elements(public.sales_recon_array(v_match, 'findings', 200, 'match')) loop
      perform public.sales_recon_only_keys(v_finding,
        array['key', 'field', 'kind', 'ledger', 'external', 'delta', 'causes'], 'finding');
      if v_order_id is null or v_sale.id is null then
        raise exception 'only a pair of order and sale has findings' using errcode = 'check_violation';
      end if;
      v_key := public.sales_recon_text(v_finding, 'key', 32, true, 'finding');
      v_field := public.sales_recon_text(v_finding, 'field', 32, true, 'finding');
      if jsonb_typeof(coalesce(v_finding -> 'ledger', 'null'::jsonb)) not in ('string', 'number', 'null')
         or jsonb_typeof(coalesce(v_finding -> 'external', 'null'::jsonb)) not in ('string', 'number', 'null')
         or length(coalesce(v_finding ->> 'ledger', '')) > 300
         or length(coalesce(v_finding ->> 'external', '')) > 300 then
        raise exception 'a finding value is one short scalar' using errcode = 'check_violation';
      end if;
      if jsonb_typeof(v_finding -> 'ledger') = 'string' then
        perform public.sales_recon_no_contact(v_finding ->> 'ledger', 'finding.ledger');
      end if;
      if jsonb_typeof(v_finding -> 'external') = 'string' then
        perform public.sales_recon_no_contact(v_finding ->> 'external', 'finding.external');
      end if;
      for v_item in select * from jsonb_array_elements(public.sales_recon_array(v_finding, 'causes', 20, 'finding')) loop
        perform public.sales_recon_only_keys(v_item, array['code', 'amount'], 'cause');
        if public.sales_recon_text(v_item, 'code', 64, true, 'cause') !~ '^[a-z_]+$' then
          raise exception 'a cause code is a plain word' using errcode = 'check_violation';
        end if;
        perform public.sales_recon_number(v_item, 'amount', -1000000, 1000000, false, 'cause');
      end loop;
      insert into public.sales_recon_findings
        (match_id, finding_key, field, kind, ledger_value, external_value, delta, causes, allowed_decisions)
      values (v_match_id, v_key, v_field,
              public.sales_recon_text(v_finding, 'kind', 16, true, 'finding'),
              coalesce(v_finding -> 'ledger', 'null'::jsonb),
              coalesce(v_finding -> 'external', 'null'::jsonb),
              public.sales_recon_number(v_finding, 'delta', -100000000, 100000000, false, 'finding'),
              coalesce(v_finding -> 'causes', '[]'::jsonb),
              coalesce(public.sales_recon_allowed(v_field), array[]::text[]));
    end loop;
  end loop;

  return v_session;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Reading
-- ---------------------------------------------------------------------------

create or replace function public.seller_recon_sessions()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.sales_recon_gate();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'channel', s.channel, 'state', s.state,
             'coveredFrom', s.covered_from, 'coveredTo', s.covered_to, 'chainComplete', s.chain_complete,
             'createdAt', s.created_at, 'closedAt', s.closed_at, 'discardedAt', s.discarded_at,
             'snapshotsPurgedAt', s.snapshots_purged_at, 'summary', s.summary,
             'files', (select count(*) from public.sales_recon_files f where f.session_id = s.id),
             'decided', (select count(distinct d.finding_id) from public.sales_recon_decisions d
                           join public.sales_recon_findings fi on fi.id = d.finding_id
                           join public.sales_recon_matches m on m.id = fi.match_id
                          where m.session_id = s.id),
             'applied', (select count(*) from public.sales_recon_applications a where a.session_id = s.id))
           order by s.id desc)
      from public.sales_recon_sessions s), '[]'::jsonb);
end;
$$;

/*
 * One session, one page of matches. Each match carries its order (header and,
 * unless purged, the positions), the sale AS IT IS NOW with a `stale` flag,
 * and its findings with the current decision and whether it was applied.
 */
create or replace function public.seller_recon_session(
  p_id bigint, p_category text default null, p_offset integer default 0, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_session public.sales_recon_sessions;
begin
  perform public.sales_recon_gate();
  select * into v_session from public.sales_recon_sessions where id = p_id;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0 then
    raise exception 'a page is 1 to 200 rows from offset 0' using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'session', to_jsonb(v_session) - array['created_by', 'closed_by', 'discarded_by'],
    'files', coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.sales_recon_files f
                        where f.session_id = p_id), '[]'::jsonb),
    'total', (select count(*) from public.sales_recon_matches m
               where m.session_id = p_id and (p_category is null or m.category = p_category)),
    'matches', coalesce((
      select jsonb_agg(page.entry order by page.row_order)
        from (select m.id as row_order,
                     jsonb_build_object(
                       'id', m.id, 'category', m.category, 'certainty', m.certainty, 'score', m.score,
                       'dateDelta', m.date_delta, 'competitors', m.competitors, 'reason', m.reason,
                       'order', (select to_jsonb(o) - 'session_id' from public.sales_recon_orders o where o.id = m.order_id),
                       'sale', (select jsonb_build_object(
                                  'id', s.id, 'soldOn', s.sold_at, 'itemsSubtotal', s.items_subtotal,
                                  'discount', s.discount_amount, 'shipping', s.shipping_charged,
                                  'cancelledOn', s.cancelled_at::date, 'externalOrderRef', s.external_order_ref,
                                  'source', s.source, 'stale', s.updated_at is distinct from m.sale_updated_at)
                                  from public.sales s where s.id = m.sale_id),
                       'findings', coalesce((
                         select jsonb_agg(jsonb_build_object(
                                  'id', fi.id, 'key', fi.finding_key, 'field', fi.field, 'kind', fi.kind,
                                  'ledger', fi.ledger_value, 'external', fi.external_value, 'delta', fi.delta,
                                  'causes', fi.causes, 'allowedDecisions', to_jsonb(fi.allowed_decisions),
                                  'decision', (select jsonb_build_object(
                                                 'id', d.id, 'decision', d.decision, 'manualValue', d.manual_value,
                                                 'reason', d.reason, 'decidedAt', d.decided_at)
                                                 from public.sales_recon_decisions d
                                                where d.finding_id = fi.id order by d.id desc limit 1),
                                  'applied', exists (select 1 from public.sales_recon_applications a
                                                       join public.sales_recon_decisions d on d.id = a.decision_id
                                                      where d.finding_id = fi.id))
                                order by fi.id)
                           from public.sales_recon_findings fi where fi.match_id = m.id), '[]'::jsonb)) as entry
                from public.sales_recon_matches m
               where m.session_id = p_id and (p_category is null or m.category = p_category)
               order by m.id
              offset p_offset limit p_limit) page), '[]'::jsonb));
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Deciding — one finding, one row, never an overwrite
-- ---------------------------------------------------------------------------

create or replace function public.seller_recon_decide(
  p_finding_id bigint, p_decision text, p_manual_value jsonb, p_reason text,
  p_shown_ledger jsonb, p_shown_external jsonb)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_finding public.sales_recon_findings;
  v_match public.sales_recon_matches;
  v_state text;
  v_now_updated timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action text;
  v_id bigint;
begin
  perform public.sales_recon_gate();
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'an explanation has at most 500 characters' using errcode = 'check_violation';
  end if;
  perform public.sales_recon_no_contact(v_reason, 'reason');

  select * into v_finding from public.sales_recon_findings where id = p_finding_id;
  if not found then raise exception 'no such finding' using errcode = 'no_data_found'; end if;
  select * into v_match from public.sales_recon_matches where id = v_finding.match_id;
  select state into v_state from public.sales_recon_sessions where id = v_match.session_id for update;
  if v_state <> 'open' then
    raise exception 'this session is % — nothing more can be decided', v_state using errcode = 'restrict_violation';
  end if;
  if p_decision is null or not (p_decision = any (v_finding.allowed_decisions)) then
    raise exception 'this decision is not possible for the field %', v_finding.field using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.sales_recon_applications a
               join public.sales_recon_decisions d on d.id = a.decision_id
              where d.finding_id = p_finding_id) then
    raise exception 'this finding has already been applied' using errcode = 'restrict_violation';
  end if;

  -- The 0156 pattern: what the screen showed is what is stored, and the sale did not move.
  if coalesce(p_shown_ledger, 'null'::jsonb) is distinct from v_finding.ledger_value
     or coalesce(p_shown_external, 'null'::jsonb) is distinct from v_finding.external_value then
    raise exception 'the values shown are not the values of this finding — reload' using errcode = 'PT409';
  end if;
  select updated_at into v_now_updated from public.sales where id = v_match.sale_id;
  if v_now_updated is distinct from v_match.sale_updated_at then
    raise exception 'sale % changed since the analysis — analyse again', v_match.sale_id using errcode = 'PT409';
  end if;

  if p_decision = 'manual' then
    case v_finding.field
      when 'sold_on' then
        perform public.sales_recon_only_keys(p_manual_value, array['value'], 'manual value');
        if public.sales_recon_day(p_manual_value, 'value', true, 'manual value') not between date '2000-01-01' and current_date + 1 then
          raise exception 'that sale date is outside the plausible range' using errcode = 'check_violation';
        end if;
      when 'items_net', 'shipping' then
        perform public.sales_recon_only_keys(p_manual_value, array['value'], 'manual value');
        if public.sales_recon_number(p_manual_value, 'value', 0, 1000000, true, 'manual value')
           <> round(public.sales_recon_number(p_manual_value, 'value', 0, 1000000, true, 'manual value'), 2) then
          raise exception 'an amount has at most two decimals' using errcode = 'check_violation';
        end if;
      when 'total' then
        v_action := public.sales_recon_text(p_manual_value, 'action', 16, true, 'manual value');
        if v_action = 'refund' then
          perform public.sales_recon_only_keys(p_manual_value, array['action', 'amount', 'reason', 'occurred_on'], 'manual value');
          perform public.sales_recon_number(p_manual_value, 'amount', 0.01, 1000000, true, 'manual value');
          if public.sales_recon_text(p_manual_value, 'reason', 32, true, 'manual value') not in
             ('artikel_fehlt', 'artikel_beschaedigt', 'nicht_geliefert', 'versandkorrektur', 'retoure', 'kulanz', 'sonstiges') then
            raise exception 'a refund needs one of the known refund reasons' using errcode = 'check_violation';
          end if;
          perform public.sales_recon_day(p_manual_value, 'occurred_on', false, 'manual value');
          if v_reason is null then
            raise exception 'a refund needs an explanation' using errcode = 'check_violation';
          end if;
        elsif v_action = 'cancel' then
          perform public.sales_recon_only_keys(p_manual_value, array['action', 'cancelled_on'], 'manual value');
          perform public.sales_recon_day(p_manual_value, 'cancelled_on', false, 'manual value');
          if v_reason is null then
            raise exception 'a cancellation needs an explanation' using errcode = 'check_violation';
          end if;
        elsif v_action = 'none' then
          perform public.sales_recon_only_keys(p_manual_value, array['action'], 'manual value');
        else
          raise exception 'a total is settled by refund, cancel or none' using errcode = 'check_violation';
        end if;
      when 'pieces', 'figure' then
        perform public.sales_recon_only_keys(p_manual_value, array['action'], 'manual value');
        if public.sales_recon_text(p_manual_value, 'action', 16, true, 'manual value') <> 'clarify' then
          raise exception 'pieces and figures are only clarified by hand (V1 never changes sale_items)'
            using errcode = 'check_violation';
        end if;
        if v_reason is null then
          raise exception 'a clarification needs a note' using errcode = 'check_violation';
        end if;
      else
        raise exception 'the field % has no manual correction', v_finding.field using errcode = 'check_violation';
    end case;
  elsif p_manual_value is not null then
    raise exception 'only a manual decision carries a value' using errcode = 'check_violation';
  end if;

  insert into public.sales_recon_decisions
    (finding_id, decision, manual_value, reason, shown_ledger, shown_external, decided_by)
  values (p_finding_id, p_decision, p_manual_value, v_reason,
          coalesce(p_shown_ledger, 'null'::jsonb), coalesce(p_shown_external, 'null'::jsonb),
          (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Ending a session, and thinning out a finished one
-- ---------------------------------------------------------------------------

create or replace function public.seller_recon_close(p_id bigint)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform public.sales_recon_gate();
  update public.sales_recon_sessions
     set state = 'closed', closed_at = now(), closed_by = (select auth.uid())
   where id = p_id and state = 'open';
  if not found then
    raise exception 'no open session %', p_id using errcode = 'restrict_violation';
  end if;
end;
$$;

/* Discarding means "nothing from here": refused once anything was applied — close it instead. */
create or replace function public.seller_recon_discard(p_id bigint)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform public.sales_recon_gate();
  if exists (select 1 from public.sales_recon_applications where session_id = p_id) then
    raise exception 'decisions of this session were applied — close it instead' using errcode = 'restrict_violation';
  end if;
  update public.sales_recon_sessions
     set state = 'discarded', discarded_at = now(), discarded_by = (select auth.uid())
   where id = p_id and state = 'open';
  if not found then
    raise exception 'no open session %', p_id using errcode = 'restrict_violation';
  end if;
end;
$$;

/*
 * THE RETENTION RULE. A finished session keeps everything an audit needs —
 * order headers, matches, findings with both values, decisions, applications
 * — and may drop the position lists (titles, variations). Idempotent.
 */
create or replace function public.seller_recon_thin_snapshots(p_id bigint)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare v_state text; v_count integer;
begin
  perform public.sales_recon_gate();
  select state into v_state from public.sales_recon_sessions where id = p_id for update;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if v_state = 'open' then
    raise exception 'an open session keeps its snapshots' using errcode = 'restrict_violation';
  end if;
  update public.sales_recon_orders set lines = null where session_id = p_id and lines is not null;
  get diagnostics v_count = row_count;
  update public.sales_recon_sessions set snapshots_purged_at = coalesce(snapshots_purged_at, now()) where id = p_id;
  return v_count;
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. Rights: the seller functions for `authenticated`, nothing for anyone else
-- ---------------------------------------------------------------------------
revoke all on function public.seller_recon_candidates(text, date, date) from public, anon;
revoke all on function public.seller_recon_aliases(text) from public, anon;
revoke all on function public.seller_recon_create(jsonb) from public, anon;
revoke all on function public.seller_recon_sessions() from public, anon;
revoke all on function public.seller_recon_session(bigint, text, integer, integer) from public, anon;
revoke all on function public.seller_recon_decide(bigint, text, jsonb, text, jsonb, jsonb) from public, anon;
revoke all on function public.seller_recon_close(bigint) from public, anon;
revoke all on function public.seller_recon_discard(bigint) from public, anon;
revoke all on function public.seller_recon_thin_snapshots(bigint) from public, anon;

grant execute on function public.seller_recon_candidates(text, date, date) to authenticated;
grant execute on function public.seller_recon_aliases(text) to authenticated;
grant execute on function public.seller_recon_create(jsonb) to authenticated;
grant execute on function public.seller_recon_sessions() to authenticated;
grant execute on function public.seller_recon_session(bigint, text, integer, integer) to authenticated;
grant execute on function public.seller_recon_decide(bigint, text, jsonb, text, jsonb, jsonb) to authenticated;
grant execute on function public.seller_recon_close(bigint) to authenticated;
grant execute on function public.seller_recon_discard(bigint) to authenticated;
grant execute on function public.seller_recon_thin_snapshots(bigint) to authenticated;
-- <<< ENDE: supabase/migrations/0172_sales_reconciliation_rpcs.sql

-- >>> EINGEBETTET: supabase/migrations/0173_sales_reconciliation_apply.sql
-- ===========================================================================
-- 0173 — SALES RECONCILIATION: APPLYING THE DECISIONS (ADR-0174)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
--   seller_recon_apply(session_id, expected_count) → jsonb
--
-- THE SEPARATE FINAL CONFIRMATION. The screen shows every pending decision
-- that would change something or document a clarification, and its count.
-- The caller passes that count; if the database counts differently — another
-- tab decided something in between — nothing happens.
--
-- ALL OR NOTHING (ADR-0174, decision 3). Before the first write, every sale
-- the pending decisions touch is locked and compared with the state the
-- analysis saw (`sales_recon_matches.sale_updated_at`). If even ONE changed,
-- the whole call aborts with PT409 and names the sales. There are no partial
-- applications — and any error later in the transaction takes everything
-- written before it back with it.
--
-- WHAT A DECISION DOES — and only through the functions that already own it,
-- so the sales book's own audit (`orderbook_audit`) records every change:
--
--   sold_on             take / manual   seller_update_sale → sold_at
--   items_net           take / manual   seller_update_sale → items_subtotal
--                                       = target + the EXISTING discount
--                                       (decision 4: the discount is never
--                                       changed automatically)
--   shipping            take / manual   seller_update_sale → shipping_charged
--   external_order_ref  take            seller_update_sale → external_order_ref
--                                       (one explicit decision per sale; 0171
--                                       keeps it unique per channel)
--   total               manual refund   seller_add_sale_refund (amount, reason)
--                       manual cancel   seller_cancel_external_sale (0170)
--                       manual none     documented, nothing changed
--   pieces, figure      manual clarify  documented, nothing changed — V1 never
--                                       touches `sale_items` (decision: only a
--                                       documented manual clarification)
--
-- `keep_ledger` and `defer` change nothing and are not applied: deferring
-- leaves the finding open for a later round. A session can be applied in as
-- many rounds as the operator needs; a decision is applied at most once
-- (`sales_recon_applications_once`).
--
-- WHAT IT NEVER DOES. No inventory movement, no change to `sale_items`, no
-- `legacy_stock_events`, no change to a sale outside the session.
--
-- Rollback: `supabase/rollback/R0169_0173_drop_sales_reconciliation.sql`.
-- ===========================================================================


do $pre$
begin
  if to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)') is null then
    raise exception '0173 needs 0172: seller_recon_decide is missing';
  end if;
  if to_regprocedure('public.seller_update_sale(bigint,date,boolean,text,numeric,numeric,numeric,text,text,text,timestamptz)') is null
     or to_regprocedure('public.seller_add_sale_refund(bigint,numeric,timestamptz,text,text,text)') is null then
    raise exception '0173 needs seller_update_sale (0091) and seller_add_sale_refund (0062)';
  end if;
  if to_regprocedure('public.seller_recon_apply(bigint,integer)') is not null then
    raise exception '0173 is already applied: seller_recon_apply exists';
  end if;
end
$pre$;


create or replace function public.seller_recon_apply(p_session_id bigint, p_expected integer)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_state text;
  v_count integer;
  v_stale text;
  v_sale_id bigint;
  v_sale public.sales;
  v_pending record;
  v_order_ref text;
  v_sold_at date; v_subtotal numeric; v_shipping numeric; v_ref text;
  v_target numeric;
  v_applied integer := 0;
  v_documented integer := 0;
  v_sales integer := 0;
begin
  perform public.sales_recon_gate();

  select state into v_state from public.sales_recon_sessions where id = p_session_id for update;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if v_state <> 'open' then
    raise exception 'this session is % — nothing can be applied', v_state using errcode = 'restrict_violation';
  end if;

  /*
   * THE PENDING SET: the CURRENT decision of every finding of this session
   * that would change or document something and has not been applied.
   */
  -- A second call in the same transaction must not trip over the first one's table.
  drop table if exists recon_pending;
  create temporary table recon_pending on commit drop as
  select d.id as decision_id, d.decision, d.manual_value, d.reason,
         f.field, f.external_value, m.sale_id, m.sale_updated_at, m.order_id
    from public.sales_recon_findings f
    join public.sales_recon_matches m on m.id = f.match_id
    join lateral (select * from public.sales_recon_decisions d2
                   where d2.finding_id = f.id order by d2.id desc limit 1) d on true
   where m.session_id = p_session_id
     and d.decision in ('take_external', 'manual')
     and not exists (select 1 from public.sales_recon_applications a
                       join public.sales_recon_decisions dx on dx.id = a.decision_id
                      where dx.finding_id = f.id);

  select count(*) into v_count from pg_temp.recon_pending;
  if p_expected is null or p_expected <> v_count then
    raise exception 'the confirmation counted % decision(s), there are % — reload', coalesce(p_expected, 0), v_count
      using errcode = 'PT409';
  end if;
  if v_count = 0 then
    return jsonb_build_object('applied', 0, 'documented', 0, 'sales', 0);
  end if;

  -- ALL OR NOTHING: lock every affected sale, in id order, and compare first.
  perform 1 from public.sales s
   where s.id in (select sale_id from pg_temp.recon_pending)
   order by s.id
   for update;
  select string_agg(distinct p.sale_id::text, ', ' order by p.sale_id::text) into v_stale
    from pg_temp.recon_pending p join public.sales s on s.id = p.sale_id
   where s.updated_at is distinct from p.sale_updated_at;
  if v_stale is not null then
    raise exception 'sale(s) % changed since the analysis — nothing was applied; analyse again', v_stale
      using errcode = 'PT409';
  end if;

  for v_sale_id in select distinct sale_id from pg_temp.recon_pending order by sale_id loop
    v_sales := v_sales + 1;
    select * into v_sale from public.sales where id = v_sale_id;
    select o.order_ref into v_order_ref
      from public.sales_recon_orders o
     where o.id = (select order_id from pg_temp.recon_pending where sale_id = v_sale_id limit 1);
    v_sold_at := null; v_subtotal := null; v_shipping := null; v_ref := null;

    -- 1. The values, gathered into ONE update of the sale.
    for v_pending in select * from pg_temp.recon_pending
                      where sale_id = v_sale_id and field in ('sold_on', 'items_net', 'shipping', 'external_order_ref')
                      order by decision_id loop
      case v_pending.field
        when 'sold_on' then
          v_sold_at := case when v_pending.decision = 'manual' then (v_pending.manual_value ->> 'value')::date
                            else (v_pending.external_value #>> '{}')::date end;
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values (v_pending.decision_id, p_session_id, v_sale_id, 'sold_on', 'applied',
                  v_sale.sold_at::text, v_sold_at::text, (select auth.uid()));
        when 'items_net' then
          v_target := case when v_pending.decision = 'manual' then (v_pending.manual_value ->> 'value')::numeric
                           else (v_pending.external_value #>> '{}')::numeric end;
          v_subtotal := round(v_target + coalesce(v_sale.discount_amount, 0), 2);
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values (v_pending.decision_id, p_session_id, v_sale_id, 'items_net', 'applied',
                  format('items_subtotal %s (net %s)', v_sale.items_subtotal,
                         v_sale.items_subtotal - coalesce(v_sale.discount_amount, 0)),
                  format('items_subtotal %s (net %s)', v_subtotal, v_target), (select auth.uid()));
        when 'shipping' then
          v_shipping := case when v_pending.decision = 'manual' then (v_pending.manual_value ->> 'value')::numeric
                             else (v_pending.external_value #>> '{}')::numeric end;
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values (v_pending.decision_id, p_session_id, v_sale_id, 'shipping', 'applied',
                  v_sale.shipping_charged::text, v_shipping::text, (select auth.uid()));
        when 'external_order_ref' then
          v_ref := v_pending.external_value #>> '{}';
          if v_sale.external_order_ref is not null and v_sale.external_order_ref <> v_ref then
            raise exception 'sale % already carries another order reference', v_sale_id using errcode = 'restrict_violation';
          end if;
          if exists (select 1 from public.sales s2
                      where s2.channel = v_sale.channel and s2.external_order_ref = v_ref
                        and s2.id <> v_sale_id and not s2.is_test) then
            raise exception 'the order reference of sale % is already carried by another sale', v_sale_id
              using errcode = 'unique_violation';
          end if;
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values (v_pending.decision_id, p_session_id, v_sale_id, 'external_order_ref', 'applied',
                  v_sale.external_order_ref, v_ref, (select auth.uid()));
      end case;
      v_applied := v_applied + 1;
    end loop;

    if v_sold_at is not null or v_subtotal is not null or v_shipping is not null or v_ref is not null then
      -- The sale is locked and was compared above; the token is therefore not needed here.
      perform public.seller_update_sale(
        p_id => v_sale_id, p_sold_at => v_sold_at, p_clear_date => false, p_country => null,
        p_items_subtotal => v_subtotal, p_shipping_charged => v_shipping, p_discount_amount => null,
        p_external_ref => v_ref, p_buyer_ref => null, p_note => null, p_expected_updated_at => null);
    end if;

    -- 2. Events and documentation.
    for v_pending in select * from pg_temp.recon_pending
                      where sale_id = v_sale_id and field in ('total', 'pieces', 'figure')
                      order by decision_id loop
      if v_pending.field = 'total' and v_pending.manual_value ->> 'action' = 'refund' then
        perform public.seller_add_sale_refund(
          v_sale_id,
          (v_pending.manual_value ->> 'amount')::numeric,
          coalesce((v_pending.manual_value ->> 'occurred_on')::date, current_date)::timestamptz,
          v_pending.manual_value ->> 'reason',
          v_order_ref,
          format('Verkaufsabgleich %s: %s', p_session_id, v_pending.reason));
        insert into public.sales_recon_applications
          (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
        values (v_pending.decision_id, p_session_id, v_sale_id, 'total', 'applied',
                null, format('refund %s (%s)', v_pending.manual_value ->> 'amount', v_pending.manual_value ->> 'reason'),
                (select auth.uid()));
        v_applied := v_applied + 1;
      elsif v_pending.field = 'total' and v_pending.manual_value ->> 'action' = 'cancel' then
        perform public.seller_cancel_external_sale(
          v_sale_id, v_pending.reason, (v_pending.manual_value ->> 'cancelled_on')::date, null);
        insert into public.sales_recon_applications
          (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
        values (v_pending.decision_id, p_session_id, v_sale_id, 'total', 'applied',
                null, 'cancelled', (select auth.uid()));
        v_applied := v_applied + 1;
      else
        -- `none` for a total, `clarify` for pieces and figures: recorded, nothing changed.
        insert into public.sales_recon_applications
          (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
        values (v_pending.decision_id, p_session_id, v_sale_id, v_pending.field, 'documented',
                null, v_pending.manual_value ->> 'action', (select auth.uid()));
        v_documented := v_documented + 1;
      end if;
    end loop;

    -- 3. The session's view of this sale is the state it just wrote.
    update public.sales_recon_matches m
       set sale_updated_at = s.updated_at
      from public.sales s
     where m.session_id = p_session_id and m.sale_id = v_sale_id and s.id = v_sale_id;
  end loop;

  return jsonb_build_object('applied', v_applied, 'documented', v_documented, 'sales', v_sales);
end;
$$;

comment on function public.seller_recon_apply(bigint, integer) is
  'Applies the pending decisions of one reconciliation session (0173, ADR-0174): all or nothing, after comparing every affected sale with the analysed state (PT409 otherwise). Writes only through seller_update_sale, seller_add_sale_refund and seller_cancel_external_sale; never sale_items, inventory_movements or legacy_stock_events.';

revoke all on function public.seller_recon_apply(bigint, integer) from public, anon;
grant execute on function public.seller_recon_apply(bigint, integer) to authenticated;
-- <<< ENDE: supabase/migrations/0173_sales_reconciliation_apply.sql

-- >>> EINGEBETTET: supabase/migrations/0174_backup_sales_reconciliation.sql
-- ===========================================================================
-- 0174 — SALES RECONCILIATION IN BOTH BACKUPS (ADR-0134, ADR-0135, ADR-0174)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator, and only    ##
-- ##  AFTER `0169` (the bodies read the seven tables it creates).          ##
-- ###########################################################################
--
-- WHAT FOR. `0169` creates seven tables that hold the record of every sales
-- reconciliation. ADR-0134 demands that every table be decided in BOTH
-- backups. The operator decided (binding): all seven go into the business
-- backup AND into the platform backup, and after a restore the evidence must
-- stay fully interpretable. A decision means nothing without its finding,
-- the finding nothing without its match, the match nothing without its
-- order and sale — so it is all seven or none:
--
--   sales_recon_sessions      16 of 19 columns (three account identities out)
--   sales_recon_files         all 10 columns
--   sales_recon_orders        16 of 17 columns (`lines` out, see below)
--   sales_recon_matches       all 11 columns
--   sales_recon_findings      all 10 columns
--   sales_recon_decisions      8 of 9 columns (`decided_by` out)
--   sales_recon_applications   9 of 10 columns (`applied_by` out)
--
-- EXACTLY TWO COLUMN CLASSES STAY OUT, and both by existing rule:
--
--   * `sales_recon_orders.lines` — the purgeable position snapshot (titles,
--     variations). `0169` lets a finished session thin it out; every value
--     an audit needs (both sides of every difference) is in
--     `sales_recon_findings`, and the order header stays. The only exclusion
--     the operator allowed.
--   * `created_by`, `closed_by`, `discarded_by`, `decided_by`, `applied_by`
--     — account identities. Both manifests leave every `*_by` column out as
--     "Kontoidentität"; nothing new is invented here.
--
-- No buyer data: the tables have no column for it (`0169`, three locks).
--
-- WHAT IT DOES — TWO FUNCTION BODIES, NOTHING ELSE:
--
--   1. `seller_business_backup()`: the body from `0140`, character for
--      character, plus ONE contiguous block — a comment and the seven areas —
--      inserted between `name_mappings` and `orders`. 28 areas become 35,
--      356 field lines become 436. `format_version` stays **1**: ADR-0114
--      says a new area does not raise it, and the business backup has no
--      area-count certification that would need it.
--   2. `system_platform_export()`: the body from `0164`, character for
--      character, plus three changes:
--        a. `'format_version', 2` becomes `'format_version', 3`;
--        b. the group header "Lager und Orderbuch" says 20 areas / 40
--           arguments instead of 13 / 26. That makes it the largest group
--           (before: "Bestellungen", 36) and still far below the 100-argument
--           limit and the 80 that `platform-sql.test.ts` enforces;
--        c. one contiguous block — a comment and the seven areas — between
--           `orderbook_audit` and `seller_monthly_reports`.
--      54 areas become 61. THE VERSION RISES, exactly as in `0144`
--      (ADR-0135): `counts` names only the areas an archive has, and the
--      archive reader certifies completeness by `SECTIONS_BY_FORMAT_VERSION`
--      (`1: 53, 2: 54, 3: 61`). Without the new version a version-2 archive
--      from before this migration (54 areas) and a new one could not both be
--      certified. Older archives stay readable: version 1 with 53, version 2
--      with 54.
--
-- Numerics (`items_value`, `shipping`, `total`, `score`, `delta`) go out as
-- text, the money rule of `0104`/`0105`. `jsonb` and `text[]` go out as JSON.
--
-- WHAT IT DOES NOT DO. No table, column, index, policy, trigger or right. No
-- row is read or written while it runs. It does not touch `0169`'s tables,
-- the sales book or any other function. Both functions stay `stable`,
-- `security definer`, empty `search_path`, behind their gates
-- (`can_operate_active_seller()`, `is_platform_admin()`); `create or
-- replace` keeps both ACLs, and section 4 checks them.
--
-- THREE LATCHES PER FUNCTION, the pattern of `0153`/`0160`/`0164`:
--
--   1. `0169` must be applied — all seven tables and `sales_recon_orders.
--      lines` exist. Without them the bodies would not even be created.
--   2. The existing body MUST be the previous one:
--        seller_business_backup()  md5 **a32b148cebe00ee0d0d469f96fd2028e** (0140, 21622 chars)
--        system_platform_export()  md5 **7e9e58e2d84a9f8a7c660262aa21926b** (0164, 31248 chars)
--      A foreign version is not overwritten blindly.
--   3. A second run bounces off latch 2, because afterwards the bodies are
--        seller_business_backup()  md5 **3a798f506f5f43e5b1b69dc242a1b16f** (26388 chars)
--        system_platform_export()  md5 **23be72d581589b063d6938a863757b31** (35715 chars)
--      and section 1 says so by name.
--
-- Both are checked BEFORE either function is replaced, and section 4 checks
-- the result. Run the file as ONE unit (the SQL editor sends it as one
-- implicit transaction): any failure leaves both functions as they were.
-- `src/lib/backup/backup-sales-reconciliation.test.ts` recomputes all four
-- fingerprints on every test run and proves new = old + exactly the block.
--
-- Rollback: `supabase/rollback/R0174_backups_without_sales_reconciliation.sql`
-- (both previous bodies, character for character). It must run BEFORE any
-- rollback that drops the tables of `0169`: a SQL function body records no
-- dependency, so the drop would succeed and every export would fail.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Preconditions — both functions, before either is replaced
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_business text;
  v_platform text;
  v_table    text;
begin
  foreach v_table in array array['sales_recon_sessions', 'sales_recon_files',
                                 'sales_recon_orders', 'sales_recon_matches',
                                 'sales_recon_findings', 'sales_recon_decisions',
                                 'sales_recon_applications'] loop
    if to_regclass('public.' || v_table) is null then
      raise exception '0174 needs 0169: public.% is missing', v_table;
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sales_recon_orders'
                    and column_name = 'lines') then
    raise exception '0174 needs 0169: sales_recon_orders.lines is missing';
  end if;
  if to_regprocedure('public.seller_business_backup()') is null then
    raise exception '0174 needs 0104/0140: seller_business_backup() is missing';
  end if;
  if to_regprocedure('public.system_platform_export()') is null then
    raise exception '0174 needs 0105/0164: system_platform_export() is missing';
  end if;

  select md5(p.prosrc) into v_business from pg_proc p
   where p.oid = to_regprocedure('public.seller_business_backup()');
  select md5(p.prosrc) into v_platform from pg_proc p
   where p.oid = to_regprocedure('public.system_platform_export()');

  -- Latch 3: already applied (either half).
  if v_business = '3a798f506f5f43e5b1b69dc242a1b16f' or v_platform = '23be72d581589b063d6938a863757b31' then
    raise exception '0174 abort: a body already carries the fingerprint of this '
      'migration (business %, platform %). It is applied here already.',
      v_business, v_platform;
  end if;

  -- Latch 2: exactly the previous bodies, with a reason where one is known.
  if v_business is distinct from 'a32b148cebe00ee0d0d469f96fd2028e' then
    raise exception '0174 abort: seller_business_backup() is % and not the body '
      'from 0140 (a32b148cebe00ee0d0d469f96fd2028e). A foreign version is not overwritten blindly.',
      coalesce(v_business, '(none)');
  end if;
  if v_platform in ('2e2da90e976a1e73ca00aba7cd830fae', '4c4d2e7c81e4efa8e18cdffa06bba40a',
                    '92c48444f99b9e294f9703d0c0ddeaa8', 'ff4f38e61cbd4e5857ea914d6be68d44') then
    raise exception '0174 abort: system_platform_export() is an older body (%) — '
      '0105, 0144, 0153 or 0160. Apply the missing ones up to 0164 first, then this.',
      v_platform;
  end if;
  if v_platform is distinct from '7e9e58e2d84a9f8a7c660262aa21926b' then
    raise exception '0174 abort: system_platform_export() is % and not the body '
      'from 0164 (7e9e58e2d84a9f8a7c660262aa21926b). A foreign version is not overwritten blindly.',
      coalesce(v_platform, '(none)');
  end if;

  /*
   * THE RIGHTS AS THEY STAND — recorded, so the postcondition can prove that
   * this migration did not move them. `create or replace` keeps the ACL of a
   * function; 0174 grants nothing and revokes nothing.
   *
   * WHAT THE RIGHTS ARE, MEASURED ON STAGING (2026-11-03, read-only):
   *   seller_business_backup()  {postgres=X, authenticated=X, service_role=X}
   *   system_platform_export()  {postgres=X, authenticated=X}
   * The `service_role` grant on the business backup is the Supabase default
   * privilege; no migration ever revoked it (0106 did, for the platform
   * export only). Changing that is NOT the business of this migration — the
   * central backup (ADR-0175 onward) decides it. The first version of this
   * postcondition forbade it and would have aborted the whole Staging run.
   *
   * What stays forbidden, before AND after: EXECUTE for PUBLIC or anon. A
   * NULL ACL means the PostgreSQL default, which grants PUBLIC — so it is read
   * through `acldefault`, never as "no rights".
   *
   * Session-level `set_config`: 0174 is several statements, and the
   * postcondition is a separate block. Inside the transaction of the Staging run
   * a rollback takes the settings back with everything else.
   */
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in (to_regprocedure('public.seller_business_backup()'),
                              to_regprocedure('public.system_platform_export()'))
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception '0174 abort: PUBLIC or anon may already execute a backup function. '
      'That is a finding of its own and is not carried into a new body.';
  end if;
  perform set_config('skyisles.acl_0174_business',
    coalesce((select p.proacl::text from pg_proc p
               where p.oid = to_regprocedure('public.seller_business_backup()')), '(default)'), false);
  perform set_config('skyisles.acl_0174_platform',
    coalesce((select p.proacl::text from pg_proc p
               where p.oid = to_regprocedure('public.system_platform_export()')), '(default)'), false);
end
$pre$;


-- ---------------------------------------------------------------------------
-- 2. The business backup: the body from `0140`, plus the seven areas
-- ---------------------------------------------------------------------------
create or replace function public.seller_business_backup()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with used_figures as (
    /*
     * Die SKY-IDs, die im Backup überhaupt vorkommen. Der
     * Stammdatenschnappschuss beschränkt sich darauf — 605 Katalogzeilen
     * mitzuschicken, von denen die Hälfte nie gehandelt wurde, machte die
     * Datei größer und nicht verständlicher.
     */
    select sky_id from public.shop_inventory
    union select sky_id from public.purchase_items
    union select sky_id from public.sale_items
    union select sky_id from public.order_lines
  )
  select case when not public.can_operate_active_seller() then null else jsonb_build_object(

    /* ---- Metadaten -------------------------------------------------- */
    'format',          'skyisles-business-backup',
    'format_version',  1,
    'created_at',      now(),
    'commerce_mode',   (select s.mode from public.commerce_settings s limit 1),
    'seller_legal_name', (select s.legal_name from public.sellers s limit 1),
    'snapshot_txid',   pg_current_snapshot()::text,
    'inventory_units', (select coalesce(sum(i.quantity), 0) from public.shop_inventory i),
    'buy_in_factor',   public.orderbook_global_factor()::text,
    'contains_personal_data', true,
    'restore_supported',      false,

    /* ---- Die Bereiche ----------------------------------------------- */
    'data', jsonb_build_object(
      'shop_inventory', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sky_id', t.sky_id,
          'condition', t.condition,
          'quantity', t.quantity,
          'reserved', t.reserved,
          'available_quantity', t.available_quantity,
          'sale_price', t.sale_price::text,
          'is_listed', t.is_listed,
          'sale_released', t.sale_released,
          'delivery_scope', t.delivery_scope,
          'note', t.note,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.shop_inventory t
      ), '[]'::jsonb),
  
      'inventory_movements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'inventory_id', t.inventory_id,
          'delta', t.delta,
          'reason', t.reason,
          'unit_cost', t.unit_cost::text,
          'currency', t.currency,
          'note', t.note,
          'created_at', t.created_at,
          'sky_id', inv.sky_id,
          'condition', inv.condition
        ) order by t.id)
          from public.inventory_movements t
          left join public.shop_inventory inv on inv.id = t.inventory_id
      ), '[]'::jsonb),
  
      'purchases', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'purchased_at', t.purchased_at,
          'total_cost', t.total_cost::text,
          'items_cost', t.items_cost::text,
          'shipping_cost', t.shipping_cost::text,
          'buyer_protection_cost', t.buyer_protection_cost::text,
          'currency', t.currency,
          'payment_method', t.payment_method,
          'platform', t.platform,
          'seller_name', t.seller_name,
          'source', t.source,
          'external_ref', t.external_ref,
          'note', t.note,
          'is_test', t.is_test,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.purchases t
      ), '[]'::jsonb),
  
      'purchase_items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'purchase_id', t.purchase_id,
          'position', t.position,
          'sky_id', t.sky_id,
          'condition', t.condition,
          'raw_name', t.raw_name,
          'state', t.state,
          'market_price_snapshot', t.market_price_snapshot::text,
          'market_price_snapshot_at', t.market_price_snapshot_at,
          'market_price_source', t.market_price_source,
          'movement_id', t.movement_id,
          'note', t.note,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.purchase_items t
      ), '[]'::jsonb),
  
      /* ---------------------------------------------- Eigenbelege (0129) */
      /*
       * DIE DREI BELEGTABELLEN. Sie fehlten bis `0129` ganz — eine
       * Wiederherstellung aus dieser Datei haette jeden Eigenbeleg verloren,
       * samt Nummernkreis und Abrufnachweis.
       *
       * `lines` kommt als ganzes `jsonb` mit: es IST der eingefrorene
       * Snapshot und wird nicht neu aus `purchase_items` gebildet. Genau
       * darin liegt sein Zweck.
       */
      'purchase_receipts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'purchase_id', t.purchase_id,
          'receipt_number', t.receipt_number,
          'issued_at', t.issued_at,
          'revision', t.revision,
          'supersedes_id', t.supersedes_id,
          'supersedes_number', t.supersedes_number,
          'supersedes_issued_at', t.supersedes_issued_at,
          'format_version', t.format_version,
          'content_fingerprint', t.content_fingerprint,
          'buyer_legal_name', t.buyer_legal_name,
          'buyer_trade_name', t.buyer_trade_name,
          'buyer_street', t.buyer_street,
          'buyer_postal_code', t.buyer_postal_code,
          'buyer_city', t.buyer_city,
          'buyer_country', t.buyer_country,
          'buyer_email', t.buyer_email,
          'buyer_vat_id', t.buyer_vat_id,
          'seller_platform', t.seller_platform,
          'seller_handle', t.seller_handle,
          'sender_name', t.sender_name,
          'sender_street', t.sender_street,
          'sender_postal_code', t.sender_postal_code,
          'sender_city', t.sender_city,
          'sender_country', t.sender_country,
          'listing_ref', t.listing_ref,
          'listing_title', t.listing_title,
          'listing_url', t.listing_url,
          'listing_details', t.listing_details,
          'purchased_at', t.purchased_at,
          'items_cost', t.items_cost::text,
          'shipping_cost', t.shipping_cost::text,
          'buyer_protection_cost', t.buyer_protection_cost::text,
          'total_cost', t.total_cost::text,
          'currency', t.currency,
          'payment_method', t.payment_method,
          'agreement_note', t.agreement_note,
          'lines', t.lines
        ) order by t.id)
          from public.purchase_receipts t
      ), '[]'::jsonb),
  
      /*
       * DER ABRUFNACHWEIS. Ohne ihn waere nach einer Wiederherstellung nicht
       * mehr belegbar, dass ein Beleg je vollstaendig ausgeliefert wurde —
       * und der gruene Haken in der Oberflaeche haengt daran.
       */
      'purchase_receipt_downloads', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'receipt_id', t.receipt_id,
          'delivered_at', t.delivered_at,
          'byte_count', t.byte_count
        ) order by t.id)
          from public.purchase_receipt_downloads t
      ), '[]'::jsonb),
  
      /*
       * DER NUMMERNZAEHLER. Er ist der Grund, warum der Nummernkreis
       * lueckenlos bleibt. Ohne ihn vergaebe eine wiederhergestellte Datenbank
       * Nummern, die es schon gibt — und `receipts_number_unique` schluege
       * beim naechsten Ausstellen zu.
       */
      'purchase_receipt_counters', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', t.year,
          'next_number', t.next_number
        ) order by t.year)
          from public.purchase_receipt_counters t
      ), '[]'::jsonb),
  
      'sales', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'channel', t.channel,
          'order_id', t.order_id,
          'sold_at', t.sold_at,
          'shipped_at', t.shipped_at,
          'destination_country_code', t.destination_country_code,
          'currency', t.currency,
          'items_subtotal', t.items_subtotal::text,
          'shipping_charged', t.shipping_charged::text,
          'discount_amount', t.discount_amount::text,
          'reported_payout_amount', t.reported_payout_amount::text,
          'reported_payout_ref', t.reported_payout_ref,
          'reported_payout_at', t.reported_payout_at,
          'buy_in_factor_snapshot', t.buy_in_factor_snapshot::text,
          'external_order_ref', t.external_order_ref,
          'buyer_ref', t.buyer_ref,
          'note', t.note,
          'source', t.source,
          'is_test', t.is_test,
          'cancelled_at', t.cancelled_at,
          'stock_released_at', t.stock_released_at,
          'sale_day', t.sale_day,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.sales t
      ), '[]'::jsonb),
  
      'sale_items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'position', t.position,
          'sky_id', t.sky_id,
          'raw_name', t.raw_name,
          'condition', t.condition,
          'market_price_snapshot', t.market_price_snapshot::text,
          'market_price_snapshot_at', t.market_price_snapshot_at,
          'movement_id', t.movement_id,
          'returned_at', t.returned_at,
          'return_movement_id', t.return_movement_id,
          'settled_at', t.settled_at,
          'not_shipped_at', t.not_shipped_at,
          'return_announced_at', t.return_announced_at,
          'note', t.note,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.sale_items t
      ), '[]'::jsonb),
  
      'sale_fees', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'kind', t.kind,
          'label', t.label,
          'amount', t.amount::text,
          'settled_by', t.settled_by,
          'note', t.note,
          'created_at', t.created_at
        ) order by t.id)
          from public.sale_fees t
      ), '[]'::jsonb),
  
      'sale_refunds', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'amount', t.amount::text,
          'occurred_at', t.occurred_at,
          'reason', t.reason,
          'external_ref', t.external_ref,
          'note', t.note,
          'created_at', t.created_at
        ) order by t.id)
          from public.sale_refunds t
      ), '[]'::jsonb),
  
      'settlement_adjustments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'channel', t.channel,
          'amount', t.amount::text,
          'reason', t.reason,
          'external_ref', t.external_ref,
          'note', t.note,
          'occurred_at', t.occurred_at,
          'source', t.source,
          'created_at', t.created_at
        ) order by t.id)
          from public.settlement_adjustments t
      ), '[]'::jsonb),
  
      'name_mappings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'normalised_name', t.normalised_name,
          'sky_id', t.sky_id,
          'not_a_figure', t.not_a_figure,
          'sample_raw_name', t.sample_raw_name,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.orderbook_name_mappings t
      ), '[]'::jsonb),
  
      /* ------------------------------ Sales reconciliation (0169, 0174) */
      /*
       * The record of every reconciliation of a platform report against
       * the sales book: sessions, files, orders, matches, findings,
       * decisions and applications. A decision is only readable together
       * with its finding, match, order and sale, so all seven come along.
       * sales_recon_orders leaves out ONE column, lines (the purgeable
       * position snapshot) - every value an audit needs is in
       * sales_recon_findings. No account identity, no buyer data.
       */
      'sales_recon_sessions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'channel', t.channel,
          'parser', t.parser,
          'parser_version', t.parser_version,
          'state', t.state,
          'files_key', t.files_key,
          'covered_from', t.covered_from,
          'covered_to', t.covered_to,
          'record_first', t.record_first,
          'record_last', t.record_last,
          'chain_complete', t.chain_complete,
          'summary', t.summary,
          'created_at', t.created_at,
          'closed_at', t.closed_at,
          'discarded_at', t.discarded_at,
          'snapshots_purged_at', t.snapshots_purged_at
        ) order by t.id)
          from public.sales_recon_sessions t
      ), '[]'::jsonb),
  
      'sales_recon_files', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'session_id', t.session_id,
          'file_name', t.file_name,
          'fingerprint', t.fingerprint,
          'footer_count', t.footer_count,
          'orders', t.orders,
          'first_sold_on', t.first_sold_on,
          'last_sold_on', t.last_sold_on,
          'record_first', t.record_first,
          'record_last', t.record_last
        ) order by t.id)
          from public.sales_recon_files t
      ), '[]'::jsonb),
  
      'sales_recon_orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'session_id', t.session_id,
          'channel', t.channel,
          'order_ref', t.order_ref,
          'record_no', t.record_no,
          'sold_on', t.sold_on,
          'paid_on', t.paid_on,
          'shipped_on', t.shipped_on,
          'items_value', t.items_value::text,
          'shipping', t.shipping::text,
          'total', t.total::text,
          'pieces', t.pieces,
          'combined', t.combined,
          'destination_country', t.destination_country,
          'shipping_service', t.shipping_service,
          'source_file', t.source_file
        ) order by t.id)
          from public.sales_recon_orders t
      ), '[]'::jsonb),
  
      'sales_recon_matches', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'session_id', t.session_id,
          'order_id', t.order_id,
          'sale_id', t.sale_id,
          'category', t.category,
          'certainty', t.certainty,
          'score', t.score::text,
          'date_delta', t.date_delta,
          'competitors', t.competitors,
          'reason', t.reason,
          'sale_updated_at', t.sale_updated_at
        ) order by t.id)
          from public.sales_recon_matches t
      ), '[]'::jsonb),
  
      'sales_recon_findings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'match_id', t.match_id,
          'finding_key', t.finding_key,
          'field', t.field,
          'kind', t.kind,
          'ledger_value', t.ledger_value,
          'external_value', t.external_value,
          'delta', t.delta::text,
          'causes', t.causes,
          'allowed_decisions', t.allowed_decisions
        ) order by t.id)
          from public.sales_recon_findings t
      ), '[]'::jsonb),
  
      'sales_recon_decisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'finding_id', t.finding_id,
          'decision', t.decision,
          'manual_value', t.manual_value,
          'reason', t.reason,
          'shown_ledger', t.shown_ledger,
          'shown_external', t.shown_external,
          'decided_at', t.decided_at
        ) order by t.id)
          from public.sales_recon_decisions t
      ), '[]'::jsonb),
  
      'sales_recon_applications', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'decision_id', t.decision_id,
          'session_id', t.session_id,
          'sale_id', t.sale_id,
          'field', t.field,
          'outcome', t.outcome,
          'old_value', t.old_value,
          'new_value', t.new_value,
          'applied_at', t.applied_at
        ) order by t.id)
          from public.sales_recon_applications t
      ), '[]'::jsonb),
  
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_number', t.order_number,
          'currency', t.currency,
          'items_subtotal', t.items_subtotal::text,
          'shipping_amount', t.shipping_amount::text,
          'discount_amount', t.discount_amount::text,
          'total_amount', t.total_amount::text,
          'payment_status', t.payment_status,
          'fulfillment_status', t.fulfillment_status,
          'needs_resolution', t.needs_resolution,
          'placed_at', t.placed_at,
          'paid_at', t.paid_at,
          'shipped_at', t.shipped_at,
          'completed_at', t.completed_at,
          'cancelled_at', t.cancelled_at,
          'updated_at', t.updated_at,
          'tax_regime', t.tax_regime,
          'shipping_method_code', t.shipping_method_code,
          'shipping_method_name', t.shipping_method_name,
          'tracking_number', t.tracking_number,
          'commerce_mode', t.commerce_mode
        ) order by t.id)
          from public.orders t
      ), '[]'::jsonb),
  
      'order_lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'sky_id', t.sky_id,
          'condition', t.condition,
          'quantity', t.quantity,
          'name_snapshot', t.name_snapshot,
          'series_snapshot', t.series_snapshot,
          'unit_price', t.unit_price::text,
          'discount_amount', t.discount_amount::text,
          'line_total', t.line_total::text,
          'inventory_id', t.inventory_id,
          'created_at', t.created_at
        ) order by t.id)
          from public.order_lines t
      ), '[]'::jsonb),
  
      'order_line_events', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'order_line_id', t.order_line_id,
          'kind', t.kind,
          'quantity', t.quantity,
          'stock_outcome', t.stock_outcome,
          'movement_id', t.movement_id,
          'correction_movement_id', t.correction_movement_id,
          'occurred_at', t.occurred_at,
          'reason', t.reason,
          'reason_code', t.reason_code,
          'created_at', t.created_at
        ) order by t.id)
          from public.order_line_events t
      ), '[]'::jsonb),
  
      'order_reservations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'inventory_id', t.inventory_id,
          'quantity', t.quantity,
          'state', t.state,
          'reserved_at', t.reserved_at,
          'expires_at', t.expires_at,
          'released_at', t.released_at,
          'converted_at', t.converted_at,
          'movement_id', t.movement_id,
          'reverted_movement_id', t.reverted_movement_id,
          'sale_item_id', t.sale_item_id,
          'sky_id', inv.sky_id,
          'condition', inv.condition
        ) order by t.id)
          from public.order_reservations t
          left join public.shop_inventory inv on inv.id = t.inventory_id
      ), '[]'::jsonb),
  
      'order_refunds', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'amount', t.amount::text,
          'currency', t.currency,
          'occurred_at', t.occurred_at,
          'reason', t.reason,
          'withdrawal_request_id', t.withdrawal_request_id,
          'requested_at', t.requested_at,
          'settled_at', t.settled_at,
          'provider_status', t.provider_status,
          'failure_code', t.failure_code,
          'created_at', t.created_at
        ) order by t.id)
          from public.order_refunds t
      ), '[]'::jsonb),
  
      'order_refund_allocations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'refund_id', t.refund_id,
          'order_line_id', t.order_line_id,
          'quantity', t.quantity,
          'amount', t.amount::text,
          'allocation_type', t.allocation_type
        ) order by t.id)
          from public.order_refund_allocations t
      ), '[]'::jsonb),
  
      'order_legal_snapshots', coalesce((
        select jsonb_agg(jsonb_build_object(
          'order_id', t.order_id,
          'agb_version', t.agb_version,
          'widerruf_version', t.widerruf_version,
          'seller_name', t.seller_name,
          'seller_legal_name', t.seller_legal_name,
          'seller_street', t.seller_street,
          'seller_postal_code', t.seller_postal_code,
          'seller_city', t.seller_city,
          'seller_country_code', t.seller_country_code,
          'seller_email', t.seller_email,
          'seller_vat_id', t.seller_vat_id,
          'created_at', t.created_at
        ) order by t.order_id)
          from public.order_legal_snapshots t
      ), '[]'::jsonb),
  
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'invoice_number', t.invoice_number,
          'issued_at', t.issued_at,
          'seller_legal_name', t.seller_legal_name,
          'seller_trade_name', t.seller_trade_name,
          'seller_street', t.seller_street,
          'seller_postal_code', t.seller_postal_code,
          'seller_city', t.seller_city,
          'seller_country', t.seller_country,
          'seller_email', t.seller_email,
          'seller_vat_id', t.seller_vat_id,
          'customer_name', t.customer_name,
          'customer_company', t.customer_company,
          'customer_street', t.customer_street,
          'customer_postal_code', t.customer_postal_code,
          'customer_city', t.customer_city,
          'customer_country', t.customer_country,
          'customer_email', t.customer_email,
          'items_subtotal', t.items_subtotal::text,
          'shipping_amount', t.shipping_amount::text,
          'discount_amount', t.discount_amount::text,
          'total_amount', t.total_amount::text,
          'currency', t.currency,
          'tax_regime', t.tax_regime,
          'lines', t.lines
        ) order by t.id)
          from public.invoices t
      ), '[]'::jsonb),
  
      'monthly_reports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'period_year', t.period_year,
          'period_month', t.period_month,
          'commerce_mode', t.commerce_mode,
          'finalized_at', t.finalized_at,
          'order_count', t.order_count,
          'order_value', t.order_value::text,
          'merchandise_amount', t.merchandise_amount::text,
          'shipping_amount', t.shipping_amount::text,
          'discount_amount', t.discount_amount::text,
          'currency', t.currency,
          'paid_count', t.paid_count,
          'unpaid_count', t.unpaid_count,
          'tax_regime', t.tax_regime,
          'included_orders', t.included_orders
        ) order by t.id)
          from public.seller_monthly_reports t
      ), '[]'::jsonb),
  
      'figures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'sky_id', t.sky_id,
          'name', t.name,
          'slug', t.slug,
          'series_code', t.series_code,
          'card_type', t.card_type,
          'item_type', t.item_type,
          'usk_rating', t.usk_rating,
          'market_price', t.market_price::text,
          'category_id', t.category_id,
          'is_active', t.is_active,
          'source', t.source
        ) order by t.sky_id)
          from public.skylanders t
         where t.sky_id in (select sky_id from used_figures)
      ), '[]'::jsonb),
  
      'series', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', t.code,
          'label', t.label,
          'release_year', t.release_year,
          'position', t.position
        ) order by t.code)
          from public.series t
      ), '[]'::jsonb),
  
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'series_code', t.series_code,
          'name', t.name,
          'catalog_group', t.catalog_group,
          'position', t.position
        ) order by t.id)
          from public.categories t
      ), '[]'::jsonb),
  
      'seller', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'display_name', t.display_name,
          'legal_name', t.legal_name,
          'trading_name', t.trading_name,
          'legal_form', t.legal_form,
          'street', t.street,
          'postal_code', t.postal_code,
          'city', t.city,
          'country_code', t.country_code,
          'phone', t.phone,
          'direct_contact', t.direct_contact,
          'register_court', t.register_court,
          'register_number', t.register_number,
          'vat_id', t.vat_id,
          'w_id', t.w_id,
          'small_business_19', t.small_business_19,
          'contact_email', t.contact_email,
          'transactional_reply_to', t.transactional_reply_to,
          'withdrawal_contact_email', t.withdrawal_contact_email,
          'complaints_contact_email', t.complaints_contact_email,
          'dispute_participation', t.dispute_participation,
          'dispute_body', t.dispute_body,
          'dispatch_statement', t.dispatch_statement,
          'return_postage_borne_by', t.return_postage_borne_by,
          'is_active', t.is_active,
          'free_shipping_threshold', t.free_shipping_threshold::text
        ) order by t.id)
          from public.sellers t
      ), '[]'::jsonb),
  
      'shop_settings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'price_percentage', t.price_percentage::text,
          'free_shipping_threshold', t.free_shipping_threshold::text,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.shop_settings t
      ), '[]'::jsonb),
  
      'shipping_methods', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', t.code,
          'name', t.name,
          'base_price', t.base_price::text,
          'is_enabled', t.is_enabled,
          'sort_order', t.sort_order
        ) order by t.code)
          from public.shipping_methods t
      ), '[]'::jsonb)
    )
  ) end;
$$;

comment on function public.seller_business_backup() is
  'A snapshot of the business data as JSON (0104; receipts in 0129, cost parts and catalogue order in 0130, seller master data in 0131, item type in 0136, sale release and age rating in 0140, sales reconciliation in 0174) - 35 areas in ONE statement and therefore from ONE MVCC snapshot. Reads only. Since 0174 the seven sales_recon_* tables of 0169 are areas: sessions, files, orders, matches, findings, decisions and applications, so that every decision stays readable after a restore together with its finding, match, order and sale. sales_recon_orders leaves out lines, the purgeable position snapshot - every value an audit needs is in sales_recon_findings. Account identities (created_by, closed_by, discarded_by, decided_by, applied_by) stay out, as everywhere in this export; the tables hold no buyer data. Sender, listing and purchase agreement of a purchase stay EXPLICITLY out (personal, open retention question); account identities, master-data timestamps and payment-provider internals as well. format_version stays 1: a new area does not raise it (ADR-0114). No restore: restore_supported is false.';


-- ---------------------------------------------------------------------------
-- 3. The platform export: the body from `0164`, version 3, the seven areas
-- ---------------------------------------------------------------------------
create or replace function public.system_platform_export()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_platform_admin() then null else jsonb_build_object(

    /* ---- Was nur die Datenbank weiß --------------------------------- */
    'format',         'skyisles-platform-backup',
    'format_version', 3,
    'created_at',     now(),
    'commerce_mode',  (select s.mode from public.commerce_settings s limit 1),
    'snapshot_txid',  pg_current_snapshot()::text,

    /* ---- Die Bereiche, in sechs Gruppen wegen FUNC_MAX_ARGS ---------- */
    'data', (
      /* ---- Katalog — 6 Bereiche, 12 Argumente ---- */
      jsonb_build_object(
        'skylanders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sky_id', t.sky_id,
            'name', t.name,
            'slug', t.slug,
            'series_code', t.series_code,
            'category_id', t.category_id,
            'market_price', t.market_price::text,
            'price_updated_at', t.price_updated_at,
            'image_file', t.image_file,
            'image_override_path', t.image_override_path,
            'is_active', t.is_active,
            'catalog_visible', t.catalog_visible,
            'catalog_status', t.catalog_status,
            'display_name_override', t.display_name_override,
            'card_type', t.card_type,
            'source', t.source,
            'character_id', t.character_id,
            'base_sky_id', t.base_sky_id,
            'types', t.types,
            'visible_type', t.visible_type,
            'visible_type_decided', t.visible_type_decided,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.sky_id)
            from public.skylanders t
        ), '[]'::jsonb),

        'series', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', t.code,
            'label', t.label,
            'release_year', t.release_year,
            'position', t.position,
            'created_at', t.created_at
          ) order by t.code)
            from public.series t
        ), '[]'::jsonb),

        'categories', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'series_code', t.series_code,
            'position', t.position,
            'name', t.name,
            'catalog_group', t.catalog_group,
            'created_at', t.created_at
          ) order by t.id)
            from public.categories t
        ), '[]'::jsonb),

        'characters', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'canonical_name', t.canonical_name,
            'element', t.element,
            'species', t.species,
            'role_type', t.role_type,
            'short_description', t.short_description,
            'source_url', t.source_url,
            'source_label', t.source_label,
            'verified_at', t.verified_at,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.characters t
        ), '[]'::jsonb),

        'catalog_editorial', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sky_id', t.sky_id,
            'admin_note', t.admin_note,
            'updated_at', t.updated_at
          ) order by t.sky_id)
            from public.catalog_editorial t
        ), '[]'::jsonb),

        'catalog_admin_changes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'entity', t.entity,
            'entity_id', t.entity_id,
            'field', t.field,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.catalog_admin_changes t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Nutzer und Sammlung — 2 Bereiche, 4 Argumente ---- */
      jsonb_build_object(
        'profiles', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'username', t.username,
            'display_name', t.display_name,
            'country', t.country,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.profiles t
        ), '[]'::jsonb),

        'collection_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'sky_id', t.sky_id,
            'quantity', t.quantity,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.collection_items t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Seller und Shop — 10 Bereiche, 20 Argumente ---- */
      jsonb_build_object(
        'sellers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'display_name', t.display_name,
            'legal_name', t.legal_name,
            'trading_name', t.trading_name,
            'legal_form', t.legal_form,
            'street', t.street,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'direct_contact', t.direct_contact,
            'register_court', t.register_court,
            'register_number', t.register_number,
            'vat_id', t.vat_id,
            'w_id', t.w_id,
            'contact_email', t.contact_email,
            'transactional_reply_to', t.transactional_reply_to,
            'withdrawal_contact_email', t.withdrawal_contact_email,
            'complaints_contact_email', t.complaints_contact_email,
            'small_business_19', t.small_business_19,
            'dispute_participation', t.dispute_participation,
            'dispute_body', t.dispute_body,
            'return_postage_borne_by', t.return_postage_borne_by,
            'dispatch_statement', t.dispatch_statement,
            'free_shipping_threshold', t.free_shipping_threshold::text,
            'is_active', t.is_active,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sellers t
        ), '[]'::jsonb),

        'seller_operators', coalesce((
          select jsonb_agg(jsonb_build_object(
            'seller_id', t.seller_id,
            'user_id', t.user_id,
            'is_enabled', t.is_enabled,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.user_id)
            from public.seller_operators t
        ), '[]'::jsonb),

        'shop_admins', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'granted_at', t.granted_at,
            'note', t.note
          ) order by t.user_id)
            from public.shop_admins t
        ), '[]'::jsonb),

        'platform_admins', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'created_at', t.created_at,
            'note', t.note
          ) order by t.user_id)
            from public.platform_admins t
        ), '[]'::jsonb),

        'shop_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'price_percentage', t.price_percentage::text,
            'free_shipping_threshold', t.free_shipping_threshold::text,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.shop_settings t
        ), '[]'::jsonb),

        'platform_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'contact_email', t.contact_email,
            'support_email', t.support_email,
            'catalog_market_boost_percent', t.catalog_market_boost_percent::text,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.platform_settings t
        ), '[]'::jsonb),

        'commerce_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'mode', t.mode,
            'max_open_checkouts', t.max_open_checkouts,
            'max_reserved_units', t.max_reserved_units,
            'max_orders_per_hour', t.max_orders_per_hour,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.commerce_settings t
        ), '[]'::jsonb),

        'shipping_methods', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', t.code,
            'name', t.name,
            'base_price', t.base_price::text,
            'is_enabled', t.is_enabled,
            'sort_order', t.sort_order,
            'updated_at', t.updated_at
          ) order by t.code)
            from public.shipping_methods t
        ), '[]'::jsonb),

        'shipping_countries', coalesce((
          select jsonb_agg(jsonb_build_object(
            'country_code', t.country_code,
            'label', t.label,
            'is_enabled', t.is_enabled,
            'sort_order', t.sort_order,
            'updated_at', t.updated_at
          ) order by t.country_code)
            from public.shipping_countries t
        ), '[]'::jsonb),

        'legal_document_versions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'slug', t.slug,
            'version', t.version,
            'effective_from', t.effective_from,
            'updated_at', t.updated_at
          ) order by t.slug)
            from public.legal_document_versions t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Lager und Orderbuch — 20 Bereiche, 40 Argumente ---- */
      jsonb_build_object(
        'shop_inventory', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'quantity', t.quantity,
            'reserved', t.reserved,
            'available_quantity', t.available_quantity,
            'sale_price', t.sale_price::text,
            'is_listed', t.is_listed,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.shop_inventory t
        ), '[]'::jsonb),

        'inventory_movements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'inventory_id', t.inventory_id,
            'delta', t.delta,
            'reason', t.reason,
            'unit_cost', t.unit_cost::text,
            'currency', t.currency,
            'note', t.note,
            'created_at', t.created_at,
            'sky_id', inv.sky_id,
            'condition', inv.condition
          ) order by t.id)
            from public.inventory_movements t
          left join public.shop_inventory inv on inv.id = t.inventory_id
        ), '[]'::jsonb),

        'purchases', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'purchased_at', t.purchased_at,
            'total_cost', t.total_cost::text,
            'currency', t.currency,
            'source', t.source,
            'external_ref', t.external_ref,
            'note', t.note,
            'is_test', t.is_test,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchases t
        ), '[]'::jsonb),

        'purchase_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'purchase_id', t.purchase_id,
            'position', t.position,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'raw_name', t.raw_name,
            'state', t.state,
            'market_price_snapshot', t.market_price_snapshot::text,
            'market_price_snapshot_at', t.market_price_snapshot_at,
            'market_price_source', t.market_price_source,
            'movement_id', t.movement_id,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchase_items t
        ), '[]'::jsonb),

        'sales', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'channel', t.channel,
            'order_id', t.order_id,
            'sold_at', t.sold_at,
            'shipped_at', t.shipped_at,
            'destination_country_code', t.destination_country_code,
            'currency', t.currency,
            'items_subtotal', t.items_subtotal::text,
            'shipping_charged', t.shipping_charged::text,
            'discount_amount', t.discount_amount::text,
            'reported_payout_amount', t.reported_payout_amount::text,
            'reported_payout_ref', t.reported_payout_ref,
            'reported_payout_at', t.reported_payout_at,
            'buy_in_factor_snapshot', t.buy_in_factor_snapshot::text,
            'external_order_ref', t.external_order_ref,
            'buyer_ref', t.buyer_ref,
            'note', t.note,
            'source', t.source,
            'is_test', t.is_test,
            'cancelled_at', t.cancelled_at,
            'stock_released_at', t.stock_released_at,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sales t
        ), '[]'::jsonb),

        'sale_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'position', t.position,
            'sky_id', t.sky_id,
            'raw_name', t.raw_name,
            'condition', t.condition,
            'market_price_snapshot', t.market_price_snapshot::text,
            'market_price_snapshot_at', t.market_price_snapshot_at,
            'movement_id', t.movement_id,
            'returned_at', t.returned_at,
            'return_movement_id', t.return_movement_id,
            'settled_at', t.settled_at,
            'not_shipped_at', t.not_shipped_at,
            'return_announced_at', t.return_announced_at,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sale_items t
        ), '[]'::jsonb),

        'sale_fees', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'kind', t.kind,
            'label', t.label,
            'amount', t.amount::text,
            'settled_by', t.settled_by,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.id)
            from public.sale_fees t
        ), '[]'::jsonb),

        'sale_refunds', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'amount', t.amount::text,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'external_ref', t.external_ref,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.id)
            from public.sale_refunds t
        ), '[]'::jsonb),

        'settlement_adjustments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'channel', t.channel,
            'amount', t.amount::text,
            'reason', t.reason,
            'external_ref', t.external_ref,
            'note', t.note,
            'occurred_at', t.occurred_at,
            'source', t.source,
            'created_at', t.created_at
          ) order by t.id)
            from public.settlement_adjustments t
        ), '[]'::jsonb),

        'orderbook_name_mappings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'normalised_name', t.normalised_name,
            'sky_id', t.sky_id,
            'not_a_figure', t.not_a_figure,
            'sample_raw_name', t.sample_raw_name,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.orderbook_name_mappings t
        ), '[]'::jsonb),

        'orderbook_audit', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'entity_type', t.entity_type,
            'entity_id', t.entity_id,
            'action', t.action,
            'field', t.field,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.orderbook_audit t
        ), '[]'::jsonb),

        /* Sales reconciliation (0169, added by 0174): seven sections. */
        'sales_recon_sessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'channel', t.channel,
            'parser', t.parser,
            'parser_version', t.parser_version,
            'state', t.state,
            'files_key', t.files_key,
            'covered_from', t.covered_from,
            'covered_to', t.covered_to,
            'record_first', t.record_first,
            'record_last', t.record_last,
            'chain_complete', t.chain_complete,
            'summary', t.summary,
            'created_at', t.created_at,
            'closed_at', t.closed_at,
            'discarded_at', t.discarded_at,
            'snapshots_purged_at', t.snapshots_purged_at
          ) order by t.id)
            from public.sales_recon_sessions t
        ), '[]'::jsonb),

        'sales_recon_files', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'session_id', t.session_id,
            'file_name', t.file_name,
            'fingerprint', t.fingerprint,
            'footer_count', t.footer_count,
            'orders', t.orders,
            'first_sold_on', t.first_sold_on,
            'last_sold_on', t.last_sold_on,
            'record_first', t.record_first,
            'record_last', t.record_last
          ) order by t.id)
            from public.sales_recon_files t
        ), '[]'::jsonb),

        'sales_recon_orders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'session_id', t.session_id,
            'channel', t.channel,
            'order_ref', t.order_ref,
            'record_no', t.record_no,
            'sold_on', t.sold_on,
            'paid_on', t.paid_on,
            'shipped_on', t.shipped_on,
            'items_value', t.items_value::text,
            'shipping', t.shipping::text,
            'total', t.total::text,
            'pieces', t.pieces,
            'combined', t.combined,
            'destination_country', t.destination_country,
            'shipping_service', t.shipping_service,
            'source_file', t.source_file
          ) order by t.id)
            from public.sales_recon_orders t
        ), '[]'::jsonb),

        'sales_recon_matches', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'session_id', t.session_id,
            'order_id', t.order_id,
            'sale_id', t.sale_id,
            'category', t.category,
            'certainty', t.certainty,
            'score', t.score::text,
            'date_delta', t.date_delta,
            'competitors', t.competitors,
            'reason', t.reason,
            'sale_updated_at', t.sale_updated_at
          ) order by t.id)
            from public.sales_recon_matches t
        ), '[]'::jsonb),

        'sales_recon_findings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'match_id', t.match_id,
            'finding_key', t.finding_key,
            'field', t.field,
            'kind', t.kind,
            'ledger_value', t.ledger_value,
            'external_value', t.external_value,
            'delta', t.delta::text,
            'causes', t.causes,
            'allowed_decisions', t.allowed_decisions
          ) order by t.id)
            from public.sales_recon_findings t
        ), '[]'::jsonb),

        'sales_recon_decisions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'finding_id', t.finding_id,
            'decision', t.decision,
            'manual_value', t.manual_value,
            'reason', t.reason,
            'shown_ledger', t.shown_ledger,
            'shown_external', t.shown_external,
            'decided_at', t.decided_at
          ) order by t.id)
            from public.sales_recon_decisions t
        ), '[]'::jsonb),

        'sales_recon_applications', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'decision_id', t.decision_id,
            'session_id', t.session_id,
            'sale_id', t.sale_id,
            'field', t.field,
            'outcome', t.outcome,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'applied_at', t.applied_at
          ) order by t.id)
            from public.sales_recon_applications t
        ), '[]'::jsonb),

        'seller_monthly_reports', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'period_year', t.period_year,
            'period_month', t.period_month,
            'commerce_mode', t.commerce_mode,
            'finalized_at', t.finalized_at,
            'order_count', t.order_count,
            'order_value', t.order_value::text,
            'merchandise_amount', t.merchandise_amount::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'currency', t.currency,
            'paid_count', t.paid_count,
            'unpaid_count', t.unpaid_count,
            'tax_regime', t.tax_regime,
            'included_orders', t.included_orders
          ) order by t.id)
            from public.seller_monthly_reports t
        ), '[]'::jsonb),

        'purchase_calculations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'name', t.name,
            'status', t.status,
            'lines', t.lines,
            'factor_percent', t.factor_percent,
            'total_cents', t.total_cents,
            'positions', t.positions,
            'units', t.units,
            'purchase_id', t.purchase_id,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchase_calculations t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Bestellungen — 18 Bereiche, 36 Argumente ---- */
      jsonb_build_object(
        'orders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_number', t.order_number,
            'user_id', t.user_id,
            'customer_email', t.customer_email,
            'currency', t.currency,
            'items_subtotal', t.items_subtotal::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'total_amount', t.total_amount::text,
            'payment_status', t.payment_status,
            'fulfillment_status', t.fulfillment_status,
            'needs_resolution', t.needs_resolution,
            'placed_at', t.placed_at,
            'paid_at', t.paid_at,
            'shipped_at', t.shipped_at,
            'completed_at', t.completed_at,
            'cancelled_at', t.cancelled_at,
            'updated_at', t.updated_at,
            'tax_regime', t.tax_regime,
            'shipping_method_code', t.shipping_method_code,
            'shipping_method_name', t.shipping_method_name,
            'tracking_number', t.tracking_number,
            'commerce_mode', t.commerce_mode
          ) order by t.id)
            from public.orders t
        ), '[]'::jsonb),

        'order_lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'quantity', t.quantity,
            'name_snapshot', t.name_snapshot,
            'image_snapshot', t.image_snapshot,
            'series_snapshot', t.series_snapshot,
            'unit_price', t.unit_price::text,
            'discount_amount', t.discount_amount::text,
            'line_total', t.line_total::text,
            'inventory_id', t.inventory_id,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_lines t
        ), '[]'::jsonb),

        'order_addresses', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'kind', t.kind,
            'first_name', t.first_name,
            'last_name', t.last_name,
            'company', t.company,
            'street', t.street,
            'house_number', t.house_number,
            'address_line_2', t.address_line_2,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_addresses t
        ), '[]'::jsonb),

        'order_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'event_type', t.event_type,
            'actor_kind', t.actor_kind,
            'payload', t.payload,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_events t
        ), '[]'::jsonb),

        'order_line_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'order_line_id', t.order_line_id,
            'kind', t.kind,
            'quantity', t.quantity,
            'stock_outcome', t.stock_outcome,
            'movement_id', t.movement_id,
            'correction_movement_id', t.correction_movement_id,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'reason_code', t.reason_code,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_line_events t
        ), '[]'::jsonb),

        'order_reservations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'inventory_id', t.inventory_id,
            'quantity', t.quantity,
            'state', t.state,
            'reserved_at', t.reserved_at,
            'expires_at', t.expires_at,
            'released_at', t.released_at,
            'converted_at', t.converted_at,
            'movement_id', t.movement_id,
            'reverted_movement_id', t.reverted_movement_id,
            'sky_id', inv.sky_id,
            'condition', inv.condition
          ) order by t.id)
            from public.order_reservations t
          left join public.shop_inventory inv on inv.id = t.inventory_id
        ), '[]'::jsonb),

        'order_refunds', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'amount', t.amount::text,
            'currency', t.currency,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'withdrawal_request_id', t.withdrawal_request_id,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_refunds t
        ), '[]'::jsonb),

        'order_refund_allocations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'refund_id', t.refund_id,
            'order_line_id', t.order_line_id,
            'quantity', t.quantity,
            'amount', t.amount::text,
            'allocation_type', t.allocation_type
          ) order by t.id)
            from public.order_refund_allocations t
        ), '[]'::jsonb),

        'order_legal_snapshots', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'agb_version', t.agb_version,
            'widerruf_version', t.widerruf_version,
            'seller_name', t.seller_name,
            'seller_legal_name', t.seller_legal_name,
            'seller_street', t.seller_street,
            'seller_postal_code', t.seller_postal_code,
            'seller_city', t.seller_city,
            'seller_country_code', t.seller_country_code,
            'seller_email', t.seller_email,
            'seller_vat_id', t.seller_vat_id,
            'created_at', t.created_at
          ) order by t.order_id)
            from public.order_legal_snapshots t
        ), '[]'::jsonb),

        'order_messages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'author_kind', t.author_kind,
            'body', t.body,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_messages t
        ), '[]'::jsonb),

        'order_conversation_reads', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'reader', t.reader,
            'last_read_at', t.last_read_at
          ) order by t.order_id, t.reader)
            from public.order_conversation_reads t
        ), '[]'::jsonb),

        'order_attention_reads', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'reader', t.reader,
            'last_read_at', t.last_read_at
          ) order by t.order_id, t.reader)
            from public.order_attention_reads t
        ), '[]'::jsonb),

        'order_mail', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'kind', t.kind,
            'ref', t.ref,
            'state', t.state,
            'claimed_at', t.claimed_at,
            'sent_at', t.sent_at,
            'attempts', t.attempts,
            'last_error', t.last_error,
            'updated_at', t.updated_at
          ) order by t.order_id, t.kind, coalesce(t.ref, ''))
            from public.order_mail t
        ), '[]'::jsonb),

        'invoices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'invoice_number', t.invoice_number,
            'issued_at', t.issued_at,
            'seller_legal_name', t.seller_legal_name,
            'seller_trade_name', t.seller_trade_name,
            'seller_street', t.seller_street,
            'seller_postal_code', t.seller_postal_code,
            'seller_city', t.seller_city,
            'seller_country', t.seller_country,
            'seller_email', t.seller_email,
            'seller_vat_id', t.seller_vat_id,
            'customer_name', t.customer_name,
            'customer_company', t.customer_company,
            'customer_street', t.customer_street,
            'customer_postal_code', t.customer_postal_code,
            'customer_city', t.customer_city,
            'customer_country', t.customer_country,
            'customer_email', t.customer_email,
            'items_subtotal', t.items_subtotal::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'total_amount', t.total_amount::text,
            'currency', t.currency,
            'tax_regime', t.tax_regime,
            'lines', t.lines
          ) order by t.id)
            from public.invoices t
        ), '[]'::jsonb),

        'customer_contacts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'email', t.email,
            'first_name', t.first_name,
            'last_name', t.last_name,
            'company', t.company,
            'street', t.street,
            'house_number', t.house_number,
            'address_line_2', t.address_line_2,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'updated_at', t.updated_at
          ) order by t.user_id)
            from public.customer_contacts t
        ), '[]'::jsonb),

        'payment_attempts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'provider', t.provider,
            'status', t.status,
            'amount', t.amount::text,
            'currency', t.currency,
            'created_at', t.created_at,
            'updated_at', t.updated_at,
            'paid_at', t.paid_at,
            'failed_at', t.failed_at
          ) order by t.id)
            from public.payment_attempts t
        ), '[]'::jsonb),

        'payment_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'provider', t.provider,
            'event_type', t.event_type,
            'payment_attempt_id', t.payment_attempt_id,
            'order_id', t.order_id,
            'received_at', t.received_at,
            'processed_at', t.processed_at,
            'outcome', t.outcome
          ) order by t.id)
            from public.payment_events t
        ), '[]'::jsonb),

        'withdrawal_requests', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'consumer_name', t.consumer_name,
            'contact_email', t.contact_email,
            'declaration', t.declaration,
            'received_at', t.received_at,
            'receipt_state', t.receipt_state,
            'receipt_sent_at', t.receipt_sent_at,
            'handled_at', t.handled_at,
            'receipt_attempt_at', t.receipt_attempt_at
          ) order by t.id)
            from public.withdrawal_requests t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Tester — 5 Bereiche, 10 Argumente ---- */
      jsonb_build_object(
        'testers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.user_id)
            from public.testers t
        ), '[]'::jsonb),

        'tester_permissions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'permission', t.permission,
            'granted_at', t.granted_at
          ) order by t.user_id, t.permission)
            from public.tester_permissions t
        ), '[]'::jsonb),

        'tester_features', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', t.key,
            'label', t.label,
            'description', t.description,
            'position', t.position
          ) order by t.key)
            from public.tester_features t
        ), '[]'::jsonb),

        'tester_permission_changes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'permission', t.permission,
            'action', t.action,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.tester_permission_changes t
        ), '[]'::jsonb),

        'commerce_testers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'note', t.note,
            'granted_at', t.granted_at
          ) order by t.user_id)
            from public.commerce_testers t
        ), '[]'::jsonb)
      )
    )
  ) end;
$$;

comment on function public.system_platform_export() is
  'The database half of one complete platform backup as a single JSON document (0105, extended by 0144, 0153, 0160, 0164 and 0174) - the archive file database.json. 61 sections in one statement, so every one of them comes from the same MVCC snapshot; money is rendered as text so no reader turns 7.85 into a float. The data object is assembled from six jsonb_build_object calls joined with ||, because PostgreSQL takes at most 100 arguments per call. The selection lives in src/lib/backup/platform-manifest.ts and is enforced from both sides by platform-sql.test.ts. Export, never synchronisation: it writes nothing, reads no auth table, and carries none of the legacy Excel import tables. 0144 added purchase_calculations (0142) and raised format_version to 2; archives of version 1 stay valid and carry 53 sections. 0153, 0160 and 0164 added FIELDS (catalog_status, base_sky_id, the CAT-10 type system), which left the version alone. 0174 adds the seven sales reconciliation tables of 0169 as SECTIONS and therefore raises format_version to 3, exactly as 0144 did: archives of version 2 stay valid and carry 54 sections. sales_recon_orders leaves out lines, the purgeable position snapshot; every value an audit needs is in sales_recon_findings. There is still no restore - format_version is the contract that keeps one possible, the general limits are written down in supabase/checks/0144_restore_limits.md, and what the variant relation demands of a restore order is in supabase/checks/0160_restore_order.md.';


-- ---------------------------------------------------------------------------
-- 4. Postconditions — both bodies, both shapes, both ACLs
-- ---------------------------------------------------------------------------
do $post$
declare
  v_fn      text;
  v_src     text;
  v_block   text;
  v_key     text;
  v_open    integer;
  v_acl     text;
  v_before  text;
begin
  select p.prosrc into v_src from pg_proc p
   where p.oid = to_regprocedure('public.seller_business_backup()');
  if md5(v_src) is distinct from '3a798f506f5f43e5b1b69dc242a1b16f' or length(v_src) <> 26388 then
    raise exception '0174 postcondition: seller_business_backup() is % (% chars), '
      'expected 3a798f506f5f43e5b1b69dc242a1b16f (26388)', md5(v_src), length(v_src);
  end if;
  if (length(v_src) - length(replace(v_src, 'coalesce((', ''))) / length('coalesce((') <> 35 then
    raise exception '0174 postcondition: the business backup does not carry 35 areas';
  end if;
  if strpos(v_src, '''format_version'',  1,') = 0 then
    raise exception '0174 postcondition: the business format_version is not 1 any more';
  end if;

  select p.prosrc into v_src from pg_proc p
   where p.oid = to_regprocedure('public.system_platform_export()');
  if md5(v_src) is distinct from '23be72d581589b063d6938a863757b31' or length(v_src) <> 35715 then
    raise exception '0174 postcondition: system_platform_export() is % (% chars), '
      'expected 23be72d581589b063d6938a863757b31 (35715)', md5(v_src), length(v_src);
  end if;
  if (length(v_src) - length(replace(v_src, 'coalesce((', ''))) / length('coalesce((') <> 61 then
    raise exception '0174 postcondition: the platform export does not carry 61 sections';
  end if;
  if strpos(v_src, '''format_version'', 3,') = 0 then
    raise exception '0174 postcondition: the platform format_version is not 3';
  end if;

  -- In BOTH bodies: the orders area carries no `lines`, and no area carries
  -- one of the five account identities of 0169.
  foreach v_fn in array array['public.seller_business_backup()',
                              'public.system_platform_export()'] loop
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(v_fn);
    v_block := substr(v_src, strpos(v_src, '''sales_recon_orders'', coalesce(('));
    v_block := left(v_block, strpos(v_block, 'from public.sales_recon_orders t'));
    if v_block = '' or strpos(v_block, '''lines''') > 0 then
      raise exception '0174 postcondition: % exports sales_recon_orders.lines '
        '(or has no orders area)', v_fn;
    end if;
    foreach v_key in array array['created_by', 'closed_by', 'discarded_by',
                                 'decided_by', 'applied_by'] loop
      if strpos(v_src, '''' || v_key || ''',') > 0 then
        raise exception '0174 postcondition: % exports the account identity %',
          v_fn, v_key;
      end if;
    end loop;

    -- Shape and rights, unchanged.
    if not exists (select 1 from pg_proc p
                    where p.oid = to_regprocedure(v_fn)
                      and p.prosecdef and p.provolatile = 's'
                      and (select count(*) = 1
                             from unnest(coalesce(p.proconfig, '{}')) c
                            where c like 'search\_path=%')) then
      raise exception '0174 postcondition: % lost security definer, stable or '
        'its search_path', v_fn;
    end if;
    -- Never PUBLIC or anon. A NULL ACL is the default, which grants PUBLIC.
    select count(*) into v_open
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = to_regprocedure(v_fn)
       and a.privilege_type = 'EXECUTE'
       and (a.grantee = 0 or a.grantee::regrole::text = 'anon');
    if v_open <> 0 then
      raise exception '0174 postcondition: % open EXECUTE rights on %', v_open, v_fn;
    end if;
    -- And exactly the rights recorded before the bodies were replaced.
    select coalesce(p.proacl::text, '(default)') into v_acl from pg_proc p
     where p.oid = to_regprocedure(v_fn);
    v_before := current_setting(case v_fn when 'public.seller_business_backup()'
                                  then 'skyisles.acl_0174_business'
                                  else 'skyisles.acl_0174_platform' end, true);
    if v_before is null or v_before = '' then
      raise exception '0174 postcondition: the rights of % were not recorded before', v_fn;
    end if;
    if v_acl is distinct from v_before then
      raise exception '0174 postcondition: the rights on % changed (% -> %)', v_fn, v_before, v_acl;
    end if;
  end loop;
  perform set_config('skyisles.acl_0174_business', '', false);
  perform set_config('skyisles.acl_0174_platform', '', false);

  raise notice '0174: business backup 3a798f506f5f43e5b1b69dc242a1b16f, 35 areas, format_version 1; '
    'platform export 23be72d581589b063d6938a863757b31, 61 sections, format_version 3. No row touched.';
end
$post$;
-- <<< ENDE: supabase/migrations/0174_backup_sales_reconciliation.sql

-- ---------------------------------------------------------------------------
-- Z — Nachbedingungen
-- ---------------------------------------------------------------------------
do $lauf_z$
declare v record; n record;
begin
  select * into v from pg_temp.recon_lauf_vorher;
  select
    (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(s)::text, chr(10) order by s.id)), '-') from public.sales s) as verkaeufe,
    (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(i)::text, chr(10) order by i.id)), '-') from public.sale_items i) as positionen,
    (select count(*)::text || '|' || coalesce(sum(amount), 0)::text from public.sale_refunds) as erstattungen,
    (select count(*)::text from public.orderbook_audit) as audit,
    (select count(*)::text || '|' || coalesce(sum(quantity), 0)::text from public.order_reservations where state = 'active') as holds,
    (select count(*)::text from public.inventory_movements) as bewegungen,
    (select count(*)::text from public.legacy_stock_events) as legacy
    into n;
  /* Z1 — keine Datenbewegung, an keiner der sieben Stellen. */
  if (v.verkaeufe, v.positionen, v.erstattungen, v.audit, v.holds, v.bewegungen, v.legacy)
     is distinct from (n.verkaeufe, n.positionen, n.erstattungen, n.audit, n.holds, n.bewegungen, n.legacy) then
    raise exception 'ABBRUCH Z1: der Lauf hat Verkaufs- oder Lagerdaten bewegt — nichts wird angewendet';
  end if;
  /* Z2 — alles steht. */
  if (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
       where s.nspname = 'public' and c.relkind = 'r' and c.relname like 'sales\_recon\_%') <> 7 then
    raise exception 'ABBRUCH Z2: es stehen nicht genau sieben Abgleichstabellen';
  end if;
  if to_regprocedure('public.seller_recon_apply(bigint,integer)') is null
     or to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)') is null
     or to_regclass('public.sales_external_order_ref_per_channel') is null then
    raise exception 'ABBRUCH Z2: eine Funktion oder der Index fehlt';
  end if;
  if md5((select prosrc from pg_proc where oid = to_regprocedure('public.seller_business_backup()'))) <> '3a798f506f5f43e5b1b69dc242a1b16f'
     or md5((select prosrc from pg_proc where oid = to_regprocedure('public.system_platform_export()'))) <> '23be72d581589b063d6938a863757b31' then
    raise exception 'ABBRUCH Z2: eine Sicherungsfunktion ist nicht die Fassung aus 0174';
  end if;
  raise notice '0169-0174 ok: sieben Tabellen, Storno, Bestellnummer je Kanal, Lesen, Entscheiden, Anwenden und '
    'beide Sicherungen stehen; keine Verkaufs-, Positions-, Erstattungs-, Audit-, Hold- oder Lagerzeile hat sich bewegt.';
end
$lauf_z$;

commit;
