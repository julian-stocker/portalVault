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
