-- ---------------------------------------------------------------------------
-- 0062 — Maintaining an external sale after it happened (ADR-0089)
--
-- WHAT CHANGES, AND WHAT DOES NOT
--
-- The 2026 workbook is imported. From here the Orderbuch is the book of
-- record, not a read-only photograph of a spreadsheet — a refund arrives three
-- weeks late, a payout is reported in the next settlement, a date was typed
-- wrong. All of that has to be correctable without touching Excel again.
--
-- `source = 'excel_order_2026'` says where a row CAME FROM. It has never meant
-- "frozen", and nothing here starts treating it that way: not one function
-- below looks at `source`, and none of them writes it. `import_fingerprint`
-- likewise stays exactly as imported — it identifies the source GROUP so the
-- importer can recognise it, and it is not an instruction to restore the
-- original field values. Correcting a date must not make the next preview
-- offer to re-import the sale, and it does not: the importer matches on the
-- fingerprint, which no edit touches.
--
-- WHAT WAS MISSING BEFORE THIS
--
--   1. No audit anywhere. Corrections to bookkeeping have to leave a trace,
--      or "we fixed that" becomes unprovable a year later.
--   2. No way to CORRECT a fee or a refund — only add and delete, and a
--      delete lost the numbers with it.
--   3. No concurrency control. Two tabs, two edits, the second silently wins.
--   4. `seller_remove_sale_fee`/`_refund` deleted by id without checking which
--      sale the row belonged to.
--   5. `seller_sales()` returned no fee aggregates, so the ledger could not
--      show `Fees` and `Label` (additive read-model only — see section 7).
--
-- CORRECTION SEMANTICS: MUTATE AND RECORD, NOT REVERSE
--
-- `sale_fees.amount` is constrained `>= 0` and the model deliberately has no
-- negative fee — a credit is a settlement adjustment. So a reversing entry
-- cannot express "this fee was 2,34 € and should have been 2,43 €" without
-- inventing a second representation of the same money. The chosen rule is
-- therefore: the row is corrected in place, and the audit trail keeps what it
-- said before. Deletions are audited the same way, so no financial history
-- disappears silently.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. The audit trail
--
-- One narrow table, not an event-sourcing framework: what changed, on which
-- row, from what to what, when and by whom. Append-only by intent — nothing
-- below ever updates or deletes a row here.
-- ---------------------------------------------------------------------------

create table if not exists public.orderbook_audit (
  id bigint generated always as identity primary key,
  -- The sale the change belongs to, so one sale's history reads as one list.
  -- NULL only if a future entity has no sale.
  sale_id bigint,
  entity_type text not null,
  entity_id bigint not null,
  action text not null,
  -- NULL for insert and delete: the row itself is the change.
  field text,
  old_value text,
  new_value text,
  changed_at timestamptz not null default now(),
  changed_by uuid,

  constraint orderbook_audit_sale_fk foreign key (sale_id)
    references public.sales (id) on delete cascade,
  constraint orderbook_audit_entity_known check (entity_type in
    ('sale', 'sale_fee', 'sale_refund', 'sale_item', 'settlement_adjustment')),
  constraint orderbook_audit_action_known check (action in ('insert', 'update', 'delete')),
  constraint orderbook_audit_update_names_field
    check (action <> 'update' or (field is not null and length(btrim(field)) > 0)),
  constraint orderbook_audit_changed_by_fk foreign key (changed_by)
    references auth.users (id) on delete set null
);

create index if not exists orderbook_audit_sale_idx
  on public.orderbook_audit (sale_id, changed_at desc);

comment on table public.orderbook_audit is
  'What was corrected on a sale after it was created or imported (0062). Append-only; the only way an imported figure may differ from the workbook without the difference being explainable.';

alter table public.orderbook_audit enable row level security;
revoke all on table public.orderbook_audit from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. The recorder
--
-- Internal. Every writer below calls it; no client ever does, which is why it
-- is revoked from every client role and never granted back.
-- ---------------------------------------------------------------------------

create or replace function public.orderbook_log(
  p_sale_id bigint, p_entity_type text, p_entity_id bigint,
  p_action text, p_field text, p_old text, p_new text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  -- An "update" that changed nothing is not a correction and is not recorded.
  if p_action = 'update' and p_old is not distinct from p_new then
    return;
  end if;
  insert into public.orderbook_audit
    (sale_id, entity_type, entity_id, action, field, old_value, new_value, changed_by)
  values (p_sale_id, p_entity_type, p_entity_id, p_action, p_field, p_old, p_new,
          (select auth.uid()));
end;
$$;

revoke all on function public.orderbook_log(bigint, text, bigint, text, text, text, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. One concurrency token per sale
--
-- `sales.updated_at` already existed and already moved on a sale-level edit.
-- It now also moves when a fee or refund of that sale changes, so the whole
-- sale — money included — has ONE token. A caller that read the sale, went to
-- make coffee, and saved over someone else's correction is told, instead of
-- winning silently.
--
-- Passing NULL skips the check, because a script that never read the row has
-- nothing stale to protect.
-- ---------------------------------------------------------------------------

create or replace function public.orderbook_guard_stale(
  p_sale_id bigint, p_expected timestamptz)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_actual timestamptz;
begin
  if p_expected is null then return; end if;
  select updated_at into v_actual from public.sales where id = p_sale_id;
  if not found then
    raise exception 'no such sale' using errcode = 'no_data_found';
  end if;
  if v_actual is distinct from p_expected then
    /*
     * `PT409`, not `serialization_failure`.
     *
     * 40001 means "retry me", and the gateway does: the caller waited out a
     * retry loop and got `upstream request timeout` instead of a sentence.
     * A stale edit is not transient — retrying byte-for-byte would fail the
     * same way — so it is reported as the conflict it is. PostgREST reads the
     * `PT` class as an HTTP status, which makes this a clean 409.
     */
    raise exception 'this sale changed while you were editing it'
      using errcode = 'PT409';
  end if;
end;
$$;

revoke all on function public.orderbook_guard_stale(bigint, timestamptz)
  from public, anon, authenticated;

create or replace function public.orderbook_touch_sale(p_sale_id bigint)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  update public.sales set updated_at = now(), updated_by = (select auth.uid())
   where id = p_sale_id;
end;
$$;

revoke all on function public.orderbook_touch_sale(bigint)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Sale-level edits, audited and concurrency-checked
--
-- The signatures gain a concurrency token, so the old ones are dropped rather
-- than overloaded — two functions of the same name differing by one trailing
-- default would make every call ambiguous.
--
-- Neither function reads or writes `source` or `import_fingerprint`. An edited
-- historical sale stays a historical sale that has since been corrected.
-- ---------------------------------------------------------------------------

drop function if exists public.seller_set_sale_date(bigint, date);

create or replace function public.seller_set_sale_date(
  p_id bigint, p_sold_at date, p_expected_updated_at timestamptz default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_old date;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.sales where id = p_id and order_id is not null) then
    raise exception 'an internal sale takes its date from the order' using errcode = 'restrict_violation';
  end if;
  /*
   * The plausible range, not "not 2028". A completed external sale cannot have
   * happened tomorrow, and the workbook starts long after 2000 — but the rule
   * is about what a sale date can BE, not about one wrong year. The 2028 row
   * the workbook actually contains was written by the importer, which does no
   * such validation; this is the path that lets the owner correct it.
   */
  if p_sold_at is not null and (p_sold_at < date '2000-01-01' or p_sold_at > current_date + 1) then
    raise exception 'that sale date is outside the plausible range' using errcode = 'check_violation';
  end if;

  perform public.orderbook_guard_stale(p_id, p_expected_updated_at);
  select sold_at into v_old from public.sales where id = p_id;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;

  update public.sales set sold_at = p_sold_at, updated_at = now(), updated_by = (select auth.uid())
   where id = p_id;
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'sold_at',
                               v_old::text, p_sold_at::text);
end;
$$;

comment on function public.seller_set_sale_date(bigint, date, timestamptz) is
  'Sets, corrects or clears an external sale date (0059, audited in 0062). NULL means the date is not known. Refuses an internal sale, an implausible date, and a stale edit.';


drop function if exists public.seller_update_sale(bigint, date, boolean, text, numeric, numeric, numeric, text, text, text);

create or replace function public.seller_update_sale(
  p_id bigint,
  p_sold_at date default null, p_clear_date boolean default false,
  p_country text default null,
  p_items_subtotal numeric default null,
  p_shipping_charged numeric default null,
  p_discount_amount numeric default null,
  p_external_ref text default null, p_buyer_ref text default null, p_note text default null,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_order bigint; v_before public.sales; v_country text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_before from public.sales where id = p_id;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;
  v_order := v_before.order_id;
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

  -- A country is two letters or it is not a country.
  v_country := upper(nullif(btrim(coalesce(p_country, '')), ''));
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'a destination country is a two-letter code' using errcode = 'check_violation';
  end if;

  perform public.orderbook_guard_stale(p_id, p_expected_updated_at);

  update public.sales s set
    sold_at = case when p_clear_date then null
                   when p_sold_at is not null then p_sold_at else s.sold_at end,
    destination_country_code = coalesce(v_country, s.destination_country_code),
    items_subtotal   = coalesce(p_items_subtotal, s.items_subtotal),
    shipping_charged = coalesce(p_shipping_charged, s.shipping_charged),
    discount_amount  = coalesce(p_discount_amount, s.discount_amount),
    external_order_ref = coalesce(nullif(btrim(coalesce(p_external_ref,'')),''), s.external_order_ref),
    buyer_ref = coalesce(nullif(btrim(coalesce(p_buyer_ref,'')),''), s.buyer_ref),
    note = case when p_note is null then s.note else nullif(btrim(p_note),'') end,
    updated_at = now(), updated_by = (select auth.uid())
  where s.id = p_id;

  -- One audit line per field that actually moved.
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'sold_at',
    v_before.sold_at::text,
    (case when p_clear_date then null when p_sold_at is not null then p_sold_at
          else v_before.sold_at end)::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'destination_country_code',
    v_before.destination_country_code, coalesce(v_country, v_before.destination_country_code));
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'items_subtotal',
    v_before.items_subtotal::text, coalesce(p_items_subtotal, v_before.items_subtotal)::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'shipping_charged',
    v_before.shipping_charged::text, coalesce(p_shipping_charged, v_before.shipping_charged)::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'discount_amount',
    v_before.discount_amount::text, coalesce(p_discount_amount, v_before.discount_amount)::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'external_order_ref',
    v_before.external_order_ref,
    coalesce(nullif(btrim(coalesce(p_external_ref,'')),''), v_before.external_order_ref));
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'buyer_ref',
    v_before.buyer_ref, coalesce(nullif(btrim(coalesce(p_buyer_ref,'')),''), v_before.buyer_ref));
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'note',
    v_before.note, case when p_note is null then v_before.note else nullif(btrim(p_note),'') end);
end;
$$;


drop function if exists public.seller_set_sale_payout(bigint, numeric, text);

create or replace function public.seller_set_sale_payout(
  p_id bigint, p_amount numeric default null, p_ref text default null,
  p_paid_at date default null, p_expected_updated_at timestamptz default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_before public.sales;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_before from public.sales where id = p_id;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;

  perform public.orderbook_guard_stale(p_id, p_expected_updated_at);

  update public.sales set
    reported_payout_amount = p_amount,
    /*
     * The date the channel paid, when it is known; otherwise the moment it was
     * recorded. Clearing the amount clears the date with it — a payout date
     * with no payout would be a claim about money that has not arrived.
     */
    reported_payout_at = case when p_amount is null then null
                              else coalesce(p_paid_at::timestamptz, now()) end,
    reported_payout_ref = nullif(btrim(coalesce(p_ref,'')),''),
    updated_at = now(), updated_by = (select auth.uid())
  where id = p_id;

  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'reported_payout_amount',
    v_before.reported_payout_amount::text, p_amount::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'reported_payout_ref',
    v_before.reported_payout_ref, nullif(btrim(coalesce(p_ref,'')),''));
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Fees and refunds — add, correct, remove; all audited
--
-- Same signatures as 0059 where the signature still fits, so existing callers
-- keep working. What is new is that every one of them records what it did and
-- moves the sale's concurrency token, and that the removers now check which
-- sale the row belongs to before deleting it.
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
  if not exists (select 1 from public.sales where id = p_sale_id) then
    raise exception 'no such sale' using errcode = 'no_data_found';
  end if;
  insert into public.sale_fees (sale_id, kind, amount, settled_by, label, note, created_by)
  values (p_sale_id, p_kind, p_amount, p_settled_by,
          nullif(btrim(coalesce(p_label,'')),''), nullif(btrim(coalesce(p_note,'')),''),
          (select auth.uid()))
  returning id into v_id;
  perform public.orderbook_log(p_sale_id, 'sale_fee', v_id, 'insert', null, null,
    format('%s %s %s', p_kind, p_amount, p_settled_by));
  perform public.orderbook_touch_sale(p_sale_id);
  return v_id;
end;
$$;

/**
 * Correcting a fee in place.
 *
 * NULL means "leave this alone", so a caller can fix only the amount. The
 * previous value of every field that moves is written to the audit trail, so
 * mutating rather than reversing loses nothing.
 */
create or replace function public.seller_update_sale_fee(
  p_fee_id bigint, p_kind text default null, p_amount numeric default null,
  p_settled_by text default null, p_label text default null, p_note text default null,
  p_expected_updated_at timestamptz default null)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_before public.sale_fees; v_label text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_before from public.sale_fees where id = p_fee_id;
  if not found then raise exception 'no such fee' using errcode = 'no_data_found'; end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'a fee is a positive amount; use a settlement adjustment for a credit'
      using errcode = 'check_violation';
  end if;

  perform public.orderbook_guard_stale(v_before.sale_id, p_expected_updated_at);
  v_label := case when p_label is null then v_before.label
                  else nullif(btrim(p_label), '') end;

  update public.sale_fees set
    kind = coalesce(p_kind, kind),
    amount = coalesce(p_amount, amount),
    settled_by = coalesce(p_settled_by, settled_by),
    label = v_label,
    note = case when p_note is null then note else nullif(btrim(p_note), '') end
  where id = p_fee_id;

  perform public.orderbook_log(v_before.sale_id, 'sale_fee', p_fee_id, 'update', 'kind',
    v_before.kind, coalesce(p_kind, v_before.kind));
  perform public.orderbook_log(v_before.sale_id, 'sale_fee', p_fee_id, 'update', 'amount',
    v_before.amount::text, coalesce(p_amount, v_before.amount)::text);
  perform public.orderbook_log(v_before.sale_id, 'sale_fee', p_fee_id, 'update', 'settled_by',
    v_before.settled_by, coalesce(p_settled_by, v_before.settled_by));
  perform public.orderbook_log(v_before.sale_id, 'sale_fee', p_fee_id, 'update', 'label',
    v_before.label, v_label);
  perform public.orderbook_touch_sale(v_before.sale_id);
end;
$$;

comment on function public.seller_update_sale_fee(bigint, text, numeric, text, text, text, timestamptz) is
  'Corrects one fee in place (0062). NULL leaves a field alone. Every changed field is written to orderbook_audit, which is why a correction may mutate rather than reverse.';


create or replace function public.seller_remove_sale_fee(p_fee_id bigint)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_before public.sale_fees;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  -- Read it first: a delete that recorded nothing would lose the figures.
  select * into v_before from public.sale_fees where id = p_fee_id;
  if not found then raise exception 'no such fee' using errcode = 'no_data_found'; end if;
  delete from public.sale_fees where id = p_fee_id;
  perform public.orderbook_log(v_before.sale_id, 'sale_fee', p_fee_id, 'delete', null,
    format('%s %s %s', v_before.kind, v_before.amount, v_before.settled_by), null);
  perform public.orderbook_touch_sale(v_before.sale_id);
end;
$$;


create or replace function public.seller_add_sale_refund(
  p_sale_id bigint, p_amount numeric, p_occurred_at timestamptz default null,
  p_reason text default null, p_external_ref text default null, p_note text default null)
returns bigint language plpgsql volatile security definer set search_path = ''
as $$
declare v_id bigint; v_order bigint; v_found boolean;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select order_id, true into v_order, v_found from public.sales where id = p_sale_id;
  if not coalesce(v_found, false) then
    raise exception 'no such sale' using errcode = 'no_data_found';
  end if;
  if v_order is not null then
    raise exception 'an order''s refunds belong to commerce, not to the Orderbuch'
      using errcode = 'restrict_violation';
  end if;
  insert into public.sale_refunds (sale_id, amount, occurred_at, reason, external_ref, note, created_by)
  values (p_sale_id, p_amount, coalesce(p_occurred_at, now()),
          nullif(btrim(coalesce(p_reason,'')),''), nullif(btrim(coalesce(p_external_ref,'')),''),
          nullif(btrim(coalesce(p_note,'')),''), (select auth.uid()))
  returning id into v_id;
  /*
   * A refund is MONEY. It says nothing about whether anything came back — the
   * item's own return state is the only thing that does, and nothing here
   * touches it or the stock ledger.
   */
  perform public.orderbook_log(p_sale_id, 'sale_refund', v_id, 'insert', null, null,
    format('%s %s', p_amount, coalesce(p_reason, '')));
  perform public.orderbook_touch_sale(p_sale_id);
  return v_id;
end;
$$;


create or replace function public.seller_update_sale_refund(
  p_refund_id bigint, p_amount numeric default null, p_occurred_at timestamptz default null,
  p_reason text default null, p_external_ref text default null, p_note text default null,
  p_expected_updated_at timestamptz default null)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_before public.sale_refunds;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_before from public.sale_refunds where id = p_refund_id;
  if not found then raise exception 'no such refund' using errcode = 'no_data_found'; end if;

  perform public.orderbook_guard_stale(v_before.sale_id, p_expected_updated_at);

  update public.sale_refunds set
    amount = coalesce(p_amount, amount),
    occurred_at = coalesce(p_occurred_at, occurred_at),
    reason = case when p_reason is null then reason else nullif(btrim(p_reason), '') end,
    external_ref = case when p_external_ref is null then external_ref
                        else nullif(btrim(p_external_ref), '') end,
    note = case when p_note is null then note else nullif(btrim(p_note), '') end
  where id = p_refund_id;

  perform public.orderbook_log(v_before.sale_id, 'sale_refund', p_refund_id, 'update', 'amount',
    v_before.amount::text, coalesce(p_amount, v_before.amount)::text);
  perform public.orderbook_log(v_before.sale_id, 'sale_refund', p_refund_id, 'update', 'occurred_at',
    v_before.occurred_at::text, coalesce(p_occurred_at, v_before.occurred_at)::text);
  perform public.orderbook_log(v_before.sale_id, 'sale_refund', p_refund_id, 'update', 'reason',
    v_before.reason, case when p_reason is null then v_before.reason else nullif(btrim(p_reason),'') end);
  perform public.orderbook_touch_sale(v_before.sale_id);
end;
$$;


create or replace function public.seller_remove_sale_refund(p_refund_id bigint)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_before public.sale_refunds;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_before from public.sale_refunds where id = p_refund_id;
  if not found then raise exception 'no such refund' using errcode = 'no_data_found'; end if;
  delete from public.sale_refunds where id = p_refund_id;
  perform public.orderbook_log(v_before.sale_id, 'sale_refund', p_refund_id, 'delete', null,
    format('%s %s', v_before.amount, coalesce(v_before.reason, '')), null);
  perform public.orderbook_touch_sale(v_before.sale_id);
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Reading the audit trail
-- ---------------------------------------------------------------------------

create or replace function public.seller_sale_audit(p_sale_id bigint)
returns table (
  id bigint, entity_type text, entity_id bigint, action text,
  field text, old_value text, new_value text, changed_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  return query
    select a.id, a.entity_type, a.entity_id, a.action, a.field,
           a.old_value, a.new_value, a.changed_at
      from public.orderbook_audit a
     where a.sale_id = p_sale_id
     order by a.changed_at desc, a.id desc;
end;
$$;

comment on function public.seller_sale_audit(bigint) is
  'Every recorded correction to one sale (0062), newest first. `changed_by` is deliberately not returned: one operator runs this book, and the id would be noise.';


-- ---------------------------------------------------------------------------
-- 7. The ledger read model gains two aggregates
--
-- Additive and read-only: it changes what the list can SHOW, never what
-- anything costs. The split is the workbook's own — `Fee Trans` and `Fee eBay`
-- are fees, `lbl eBay` and `lbl ext` are labels — so:
--
--   fees_total   every fee that is NOT a shipping label, either settlement
--   label_total  every shipping label, either settlement
--
-- Disjoint by construction, so no amount is in both, and the sum of the two is
-- the sale's whole fee cost. Settlement decides whether a label reduces the
-- PAYOUT, which `sale_expected_payout()` already handles and this does not
-- touch.
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
           -- NEW in 0062. Disjoint halves of the same fee table: a shipping
           -- label is in exactly one of them, so no amount is counted twice.
           coalesce((select sum(f.amount) from public.sale_fees f
                      where f.sale_id = s.id and f.kind <> 'shipping_label'), 0) as fees_total,
           coalesce((select sum(f.amount) from public.sale_fees f
                      where f.sale_id = s.id and f.kind = 'shipping_label'), 0) as label_total,
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
      'fees_total', m.fees_total, 'label_total', m.label_total,
      'source', m.source, 'note', m.note,
      -- The concurrency token an editor reads and sends back (0062).
      'updated_at', m.updated_at,
      'match_items', m.match_items)
      order by m.effective_date desc nulls last, m.id desc), '[]'::jsonb),
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
                                         and round(m.reported_payout_amount - m.expected_payout, 2) <> 0))
  into v_rows, v_sum
  from matched m;

  return jsonb_build_object('sales', v_rows, 'summary', v_sum);
end;
$$;



-- ---------------------------------------------------------------------------
-- 8. Privileges
--
-- The dropped-and-recreated functions lost their grants with the drop, so each
-- is granted again here. The table gains nothing for any client role, and the
-- three internal helpers are granted to nobody at all.
-- ---------------------------------------------------------------------------

do $$
declare fn text;
begin
  foreach fn in array array[
    'seller_set_sale_date(bigint, date, timestamptz)',
    'seller_update_sale(bigint, date, boolean, text, numeric, numeric, numeric, text, text, text, timestamptz)',
    'seller_set_sale_payout(bigint, numeric, text, date, timestamptz)',
    'seller_update_sale_fee(bigint, text, numeric, text, text, text, timestamptz)',
    'seller_update_sale_refund(bigint, numeric, timestamptz, text, text, text, timestamptz)',
    'seller_sale_audit(bigint)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
