-- ===========================================================================
-- 0182 — THE HAND CORRECTIONS OF 0181 IN BOTH BACKUPS (ADR-0134, ADR-0135, ADR-0179)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator, and only    ##
-- ##  AFTER `0181` (the bodies read the table it creates).                 ##
-- ###########################################################################
--
-- WHAT FOR. `0181` creates `sale_item_corrections`, the append-only record
-- of every hand correction of a position of an imported workbook sale: the
-- figure the workbook said, the figure it became, the line a correction
-- added and its removal. ADR-0134 demands that every table be decided in
-- BOTH backups, and the record has to stay interpretable after a restore:
--
--   * it is the only place that still names the workbook's ORIGINAL figure
--     of a corrected line once `sale_items.sky_id` was changed;
--   * it is what the workbook sync of `0181` checks before it writes —
--     restored without it, a later sync would put the old figures back.
--
-- So it goes into the business backup AND the platform backup, the way
-- `0174` took the reconciliation record into both. 10 of 12 columns:
--
--   sale_item_corrections   id, sale_id, sale_item_id, action, position,
--                           old_sky_id, old_raw_name, new_sky_id,
--                           new_raw_name, corrected_at
--
-- EXACTLY TWO COLUMNS STAY OUT, and both by existing rule of both manifests:
--
--   * `corrected_by` — an account identity ("Kontoidentität");
--   * `source_row` — the row number in the old workbook. Both backups keep
--     the legacy machinery out entirely (`FORBIDDEN_FIELDS`), and
--     `sale_items.source_row` is not exported either. The record stays
--     readable without it: `sale_item_id` and `position` name the line,
--     `old_sky_id` and `old_raw_name` what the workbook said.
--
-- Nothing new is invented here. The raw names go out raw (rule 4). No buyer
-- data: the table has no column for it.
--
-- WHAT IT DOES — TWO FUNCTION BODIES, NOTHING ELSE:
--
--   1. `seller_business_backup()`: the body from `0174`, character for
--      character, plus ONE contiguous block — a comment and the area —
--      between `sales_recon_applications` and `orders`. 35 areas become 36.
--      `format_version` stays **1** (ADR-0114: a new area does not raise it).
--   2. `system_platform_export()`: the body from `0174`, character for
--      character, plus three changes:
--        a. `'format_version', 3` becomes `'format_version', 4`;
--        b. the group header "Lager und Orderbuch" says 21 areas / 42
--           arguments instead of 20 / 40 — far below the 100-argument
--           limit and the 80 that `platform-sql.test.ts` enforces;
--        c. one contiguous block — a comment and the area — between
--           `sales_recon_applications` and `seller_monthly_reports`.
--      61 sections become 62. THE VERSION RISES, as in `0144` and `0174`
--      (ADR-0135): the archive reader certifies completeness by
--      `SECTIONS_BY_FORMAT_VERSION` (`1: 53, 2: 54, 3: 61, 4: 62`). Older
--      archives stay readable: version 3 with 61, 2 with 54, 1 with 53.
--
-- WHAT IT DOES NOT DO. No table, column, index, policy, trigger or right. No
-- row is read or written while it runs. It does not touch `0181`'s table or
-- functions, the sales book or any other function. Both functions stay
-- `stable`, `security definer`, empty `search_path`, behind their gates
-- (`can_operate_active_seller()`, `is_platform_admin()`); `create or
-- replace` keeps both ACLs, and section 4 checks them.
--
-- THREE LATCHES PER FUNCTION, the pattern of `0153`/`0160`/`0164`/`0174`:
--
--   1. `0181` must be applied — `sale_item_corrections` exists with all
--      ten exported columns.
--   2. The existing body MUST be the previous one:
--        seller_business_backup()  md5 **3a798f506f5f43e5b1b69dc242a1b16f** (0174, 26388 chars)
--        system_platform_export()  md5 **23be72d581589b063d6938a863757b31** (0174, 35715 chars)
--      A foreign version is not overwritten blindly.
--   3. A second run bounces off latch 2, because afterwards the bodies are
--        seller_business_backup()  md5 **b42609b64d8771f1792a09b344ba80de** (27009 chars)
--        system_platform_export()  md5 **307e1c10a99afdaa683292e2a495e8ad** (36366 chars)
--      and section 1 says so by name.
--
-- Both are checked BEFORE either function is replaced, and section 4 checks
-- the result. Run the file as ONE unit: any failure leaves both functions as
-- they were. `src/lib/backup/backup-sale-item-corrections.test.ts` recomputes
-- the fingerprints' sources on every test run and proves new = old + exactly
-- the block; `npm run verify:check-sql` (P82) creates both bodies in real
-- PostgreSQL, exports a correction through both and restores it from the
-- archive.
--
-- Rollback: `supabase/rollback/R0182_backups_without_sale_item_corrections.sql`
-- (both bodies of `0174`, character for character). It must run BEFORE
-- `R0181`, which drops the table: a SQL function body records no dependency,
-- so the drop would succeed and every export would then fail.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Preconditions — both functions, before either is replaced
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_business text;
  v_platform text;
begin
  if to_regclass('public.sale_item_corrections') is null then
    raise exception '0182 needs 0181: public.sale_item_corrections is missing';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.sale_item_corrections') and a.attnum > 0
         and not a.attisdropped
         and a.attname in ('id', 'sale_id', 'sale_item_id', 'action', 'position', 'old_sky_id', 'old_raw_name', 'new_sky_id', 'new_raw_name', 'corrected_at')) <> 10 then
    raise exception '0182 needs 0181: sale_item_corrections lacks an exported column';
  end if;
  if to_regprocedure('public.seller_business_backup()') is null then
    raise exception '0182 needs 0104/0174: seller_business_backup() is missing';
  end if;
  if to_regprocedure('public.system_platform_export()') is null then
    raise exception '0182 needs 0105/0174: system_platform_export() is missing';
  end if;

  select md5(p.prosrc) into v_business from pg_proc p
   where p.oid = to_regprocedure('public.seller_business_backup()');
  select md5(p.prosrc) into v_platform from pg_proc p
   where p.oid = to_regprocedure('public.system_platform_export()');

  -- Latch 3: already applied (either half).
  if v_business = 'b42609b64d8771f1792a09b344ba80de' or v_platform = '307e1c10a99afdaa683292e2a495e8ad' then
    raise exception '0182 abort: a body already carries the fingerprint of this '
      'migration (business %, platform %). It is applied here already.',
      v_business, v_platform;
  end if;

  -- Latch 2: exactly the previous bodies.
  if v_business is distinct from '3a798f506f5f43e5b1b69dc242a1b16f' then
    raise exception '0182 abort: seller_business_backup() is % and not the body '
      'from 0174 (3a798f506f5f43e5b1b69dc242a1b16f). A foreign version is not overwritten blindly.',
      coalesce(v_business, '(none)');
  end if;
  if v_platform is distinct from '23be72d581589b063d6938a863757b31' then
    raise exception '0182 abort: system_platform_export() is % and not the body '
      'from 0174 (23be72d581589b063d6938a863757b31). A foreign version is not overwritten blindly.',
      coalesce(v_platform, '(none)');
  end if;

  /*
   * THE RIGHTS AS THEY STAND — recorded, so the postcondition can prove that
   * this migration did not move them (the contract of 0174, see there for
   * why the service_role grant on the business backup is left alone). What
   * stays forbidden, before AND after: EXECUTE for PUBLIC or anon; a NULL
   * ACL is the PostgreSQL default, which grants PUBLIC.
   */
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in (to_regprocedure('public.seller_business_backup()'),
                              to_regprocedure('public.system_platform_export()'))
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception '0182 abort: PUBLIC or anon may already execute a backup function. '
      'That is a finding of its own and is not carried into a new body.';
  end if;
  perform set_config('skyisles.acl_0182_business',
    coalesce((select p.proacl::text from pg_proc p
               where p.oid = to_regprocedure('public.seller_business_backup()')), '(default)'), false);
  perform set_config('skyisles.acl_0182_platform',
    coalesce((select p.proacl::text from pg_proc p
               where p.oid = to_regprocedure('public.system_platform_export()')), '(default)'), false);
end
$pre$;


-- ---------------------------------------------------------------------------
-- 2. The business backup: the body from `0174`, plus the one area
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
  
      /* ----------- Hand corrections of workbook positions (0181, 0182) */
      'sale_item_corrections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'sale_item_id', t.sale_item_id,
          'action', t.action,
          'position', t.position,
          'old_sky_id', t.old_sky_id,
          'old_raw_name', t.old_raw_name,
          'new_sky_id', t.new_sky_id,
          'new_raw_name', t.new_raw_name,
          'corrected_at', t.corrected_at
        ) order by t.id)
          from public.sale_item_corrections t
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
  'A snapshot of the business data as JSON (0104; receipts in 0129, cost parts and catalogue order in 0130, seller master data in 0131, item type in 0136, sale release and age rating in 0140, sales reconciliation in 0174, hand corrections of workbook positions in 0182) - 36 areas in ONE statement and therefore from ONE MVCC snapshot. Reads only. Since 0174 the seven sales_recon_* tables of 0169 are areas: sessions, files, orders, matches, findings, decisions and applications, so that every decision stays readable after a restore together with its finding, match, order and sale. sales_recon_orders leaves out lines, the purgeable position snapshot - every value an audit needs is in sales_recon_findings. Since 0182 sale_item_corrections (0181) is an area: every hand correction of a workbook position with its old and new figure and raw name, so that after a restore the workbook original of every corrected line stays provable and the sync guard of 0181 still has its record. Account identities (created_by, closed_by, discarded_by, decided_by, applied_by, corrected_by) stay out, as everywhere in this export; the tables hold no buyer data. Sender, listing and purchase agreement of a purchase stay EXPLICITLY out (personal, open retention question); account identities, master-data timestamps and payment-provider internals as well. format_version stays 1: a new area does not raise it (ADR-0114). No restore: restore_supported is false.';


-- ---------------------------------------------------------------------------
-- 3. The platform export: the body from `0174`, version 4, the one section
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
    'format_version', 4,
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
      /* ---- Lager und Orderbuch — 21 Bereiche, 42 Argumente ---- */
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

        /* ----------- Hand corrections of workbook positions (0181, 0182) */
        'sale_item_corrections', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'sale_item_id', t.sale_item_id,
            'action', t.action,
            'position', t.position,
            'old_sky_id', t.old_sky_id,
            'old_raw_name', t.old_raw_name,
            'new_sky_id', t.new_sky_id,
            'new_raw_name', t.new_raw_name,
            'corrected_at', t.corrected_at
          ) order by t.id)
            from public.sale_item_corrections t
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
  'The database half of one complete platform backup as a single JSON document (0105, extended by 0144, 0153, 0160, 0164, 0174 and 0182) - the archive file database.json. 62 sections in one statement, so every one of them comes from the same MVCC snapshot; money is rendered as text so no reader turns 7.85 into a float. The data object is assembled from six jsonb_build_object calls joined with ||, because PostgreSQL takes at most 100 arguments per call. The selection lives in src/lib/backup/platform-manifest.ts and is enforced from both sides by platform-sql.test.ts. Export, never synchronisation: it writes nothing, reads no auth table, and carries none of the legacy Excel import tables. 0144 added purchase_calculations (0142) and raised format_version to 2; archives of version 1 stay valid and carry 53 sections. 0153, 0160 and 0164 added FIELDS (catalog_status, base_sky_id, the CAT-10 type system), which left the version alone. 0174 adds the seven sales reconciliation tables of 0169 as SECTIONS and therefore raises format_version to 3, exactly as 0144 did: archives of version 2 stay valid and carry 54 sections. sales_recon_orders leaves out lines, the purgeable position snapshot; every value an audit needs is in sales_recon_findings. 0182 adds sale_item_corrections (0181), the append-only record of every hand correction of a workbook position, as a SECTION and raises format_version to 4: archives of version 3 stay valid and carry 61 sections; corrected_by stays out as an account identity. There is still no restore - format_version is the contract that keeps one possible, the general limits are written down in supabase/checks/0144_restore_limits.md, and what the variant relation demands of a restore order is in supabase/checks/0160_restore_order.md.';


-- ---------------------------------------------------------------------------
-- 4. Postconditions — both bodies, both shapes, both ACLs
-- ---------------------------------------------------------------------------
do $post$
declare
  v_fn      text;
  v_src     text;
  v_block   text;
  v_open    integer;
  v_acl     text;
  v_before  text;
begin
  select p.prosrc into v_src from pg_proc p
   where p.oid = to_regprocedure('public.seller_business_backup()');
  if md5(v_src) is distinct from 'b42609b64d8771f1792a09b344ba80de' or length(v_src) <> 27009 then
    raise exception '0182 postcondition: seller_business_backup() is % (% chars), '
      'expected b42609b64d8771f1792a09b344ba80de (27009)', md5(v_src), length(v_src);
  end if;
  if (length(v_src) - length(replace(v_src, 'coalesce((', ''))) / length('coalesce((') <> 36 then
    raise exception '0182 postcondition: the business backup does not carry 36 areas';
  end if;
  if strpos(v_src, '''format_version'',  1,') = 0 then
    raise exception '0182 postcondition: the business format_version is not 1 any more';
  end if;

  select p.prosrc into v_src from pg_proc p
   where p.oid = to_regprocedure('public.system_platform_export()');
  if md5(v_src) is distinct from '307e1c10a99afdaa683292e2a495e8ad' or length(v_src) <> 36366 then
    raise exception '0182 postcondition: system_platform_export() is % (% chars), '
      'expected 307e1c10a99afdaa683292e2a495e8ad (36366)', md5(v_src), length(v_src);
  end if;
  if (length(v_src) - length(replace(v_src, 'coalesce((', ''))) / length('coalesce((') <> 62 then
    raise exception '0182 postcondition: the platform export does not carry 62 sections';
  end if;
  if strpos(v_src, '''format_version'', 4,') = 0 then
    raise exception '0182 postcondition: the platform format_version is not 4';
  end if;

  foreach v_fn in array array['public.seller_business_backup()',
                              'public.system_platform_export()'] loop
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(v_fn);
    -- The area is there, and it carries no account identity.
    v_block := substr(v_src, strpos(v_src, '''sale_item_corrections'', coalesce(('));
    v_block := left(v_block, strpos(v_block, 'from public.sale_item_corrections t'));
    if v_block = '' or strpos(v_block, '''old_sky_id''') = 0 or strpos(v_block, '''old_raw_name''') = 0 then
      raise exception '0182 postcondition: % has no sale_item_corrections area with the originals', v_fn;
    end if;
    if strpos(v_block, '''corrected_by''') > 0 or strpos(v_block, '''source_row''') > 0 then
      raise exception '0182 postcondition: % exports corrected_by or source_row', v_fn;
    end if;

    -- Shape and rights, unchanged.
    if not exists (select 1 from pg_proc p
                    where p.oid = to_regprocedure(v_fn)
                      and p.prosecdef and p.provolatile = 's'
                      and (select count(*) = 1
                             from unnest(coalesce(p.proconfig, '{}')) c
                            where c like 'search\_path=%')) then
      raise exception '0182 postcondition: % lost security definer, stable or '
        'its search_path', v_fn;
    end if;
    select count(*) into v_open
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = to_regprocedure(v_fn)
       and a.privilege_type = 'EXECUTE'
       and (a.grantee = 0 or a.grantee::regrole::text = 'anon');
    if v_open <> 0 then
      raise exception '0182 postcondition: % open EXECUTE rights on %', v_open, v_fn;
    end if;
    select coalesce(p.proacl::text, '(default)') into v_acl from pg_proc p
     where p.oid = to_regprocedure(v_fn);
    v_before := current_setting(case v_fn when 'public.seller_business_backup()'
                                  then 'skyisles.acl_0182_business'
                                  else 'skyisles.acl_0182_platform' end, true);
    if v_before is null or v_before = '' then
      raise exception '0182 postcondition: the rights of % were not recorded before', v_fn;
    end if;
    if v_acl is distinct from v_before then
      raise exception '0182 postcondition: the rights on % changed (% -> %)', v_fn, v_before, v_acl;
    end if;
  end loop;
  perform set_config('skyisles.acl_0182_business', '', false);
  perform set_config('skyisles.acl_0182_platform', '', false);

  raise notice '0182: business backup b42609b64d8771f1792a09b344ba80de, 36 areas, format_version 1; '
    'platform export 307e1c10a99afdaa683292e2a495e8ad, 62 sections, format_version 4. No row touched.';
end
$post$;
