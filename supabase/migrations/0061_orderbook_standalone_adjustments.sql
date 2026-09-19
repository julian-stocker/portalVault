-- ---------------------------------------------------------------------------
-- 0061 — Standalone historical settlement adjustments (ADR-0089)
--
-- WHAT THIS IS FOR
--
-- `Order 2026` holds 293 source groups. 292 of them are sales and are imported
-- by `seller_import_sale_group` (0059). The 293rd is not a sale at all: the
-- row marked `Korrektur >` carries a 5,19 € channel-settled shipping label,
-- no `Summe`, no `Versand`, and a payout effect of −5,19 €. It belongs in
-- `settlement_adjustments` with `sale_id = NULL`, which is exactly what that
-- column was made nullable for.
--
-- WHY 0059 COULD NOT WRITE IT
--
-- `seller_add_settlement_adjustment` is the operational function. Two things
-- make it wrong for history, and neither is a matter of taste:
--
--   1. It cannot set `source`, so the row lands as `manual` and becomes
--      indistinguishable from a correction the owner entered by hand. The 292
--      sales all carry `source = 'excel_order_2026'`; this row must too, or
--      "which rows came from the workbook" stops having an answer.
--
--   2. Nothing gives it a stable identity, so running the import twice would
--      insert it twice. The sales side does not have this problem because
--      `sales_import_fingerprint_uniq` makes the DATABASE refuse a repeat —
--      not the importer, the database. A standalone adjustment had no
--      equivalent.
--
-- WHAT THIS MIGRATION ADDS
--
-- The same mechanism the sales side already uses, and nothing else: one
-- column, one unique index, one import function that forces the historical
-- source, and one read function so a reconciliation can see what it wrote
-- without anyone being granted the table.
--
-- Additive only. No existing row is touched, no existing function is changed,
-- no grant is widened.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Import identity
--
-- The same 64-character fingerprint the sales importer computes, over the same
-- 293-group universe — so a historical identity means one thing whether it
-- ended up as a sale or as an adjustment. NULL for every operational row,
-- which is why the index is partial.
-- ---------------------------------------------------------------------------

alter table public.settlement_adjustments
  add column if not exists import_fingerprint text;

comment on column public.settlement_adjustments.import_fingerprint is
  'SHA-256 of the workbook source group this adjustment reconstructs (0061). NULL for anything entered operationally.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'settlement_adjustments_fingerprint_shape'
  ) then
    alter table public.settlement_adjustments
      add constraint settlement_adjustments_fingerprint_shape
      check (import_fingerprint is null or import_fingerprint ~ '^[0-9a-f]{64}$');
  end if;
end $$;

-- A historical identity is imported at most once. This is the whole
-- idempotency guarantee, and it lives in the database rather than in the
-- importer, so a retry, a second operator or a concurrent run all hit it.
create unique index if not exists settlement_adjustments_import_fingerprint_uniq
  on public.settlement_adjustments (import_fingerprint)
  where import_fingerprint is not null;

-- A row carrying a workbook fingerprint IS a workbook row. Stated as a
-- constraint so the two facts cannot drift apart.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'settlement_adjustments_fingerprint_is_historical'
  ) then
    alter table public.settlement_adjustments
      add constraint settlement_adjustments_fingerprint_is_historical
      check (import_fingerprint is null or source = 'excel_order_2026');
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. The import function
--
-- Idempotent by construction: it looks the fingerprint up first and returns
-- what it finds. A caller that retries after a timeout gets `inserted: false`
-- rather than an error, because the retry is not a mistake.
--
-- A fingerprint that already exists with DIFFERENT content is a different
-- matter and is refused. That would mean the workbook changed under a
-- fingerprint that is supposed to pin it, and silently accepting it would
-- report an import as complete while the books disagree.
--
-- `source` and `sale_id` are not parameters. The caller cannot ask for an
-- operational source, and cannot attach this to a sale: a standalone
-- correction that acquired a `sale_id` would start reducing that sale's
-- expected payout, which is precisely the mistake of attaching `Korrektur >`
-- to whichever sale happened to be next to it.
-- ---------------------------------------------------------------------------

create or replace function public.seller_import_settlement_adjustment(
  p_fingerprint  text,
  p_channel      text,
  p_amount       numeric,
  p_reason       text default null,
  p_note         text default null,
  p_occurred_at  date default null,
  p_external_ref text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing public.settlement_adjustments;
  v_id bigint;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ref text := nullif(btrim(coalesce(p_external_ref, '')), '');
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'a historical adjustment needs its source fingerprint'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The table already refuses a standalone row with no note, because nothing
  -- else would say what it is. Failing here says so in words.
  if v_note is null then
    raise exception 'a standalone adjustment must say what it is'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_existing from public.settlement_adjustments
   where import_fingerprint = p_fingerprint;

  if found then
    if v_existing.channel is distinct from p_channel
       or v_existing.amount is distinct from p_amount
       or v_existing.reason is distinct from v_reason
       or v_existing.occurred_at is distinct from p_occurred_at
       or v_existing.sale_id is not null then
      raise exception
        'fingerprint % is already imported with different content'
        , p_fingerprint using errcode = 'unique_violation';
    end if;
    return jsonb_build_object('id', v_existing.id, 'inserted', false);
  end if;

  insert into public.settlement_adjustments
    (sale_id, channel, amount, reason, external_ref, note, occurred_at,
     source, import_fingerprint, created_by)
  values
    (null, p_channel, p_amount, v_reason, v_ref, v_note, p_occurred_at,
     'excel_order_2026', p_fingerprint, (select auth.uid()))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'inserted', true);
end;
$$;

comment on function public.seller_import_settlement_adjustment(text, text, numeric, text, text, date, text) is
  'Records one historical channel-level settlement adjustment from Order 2026 (0061). Always sale_id NULL and source excel_order_2026; idempotent on the source fingerprint, and refuses a fingerprint whose content changed. Creates no sale and touches no inventory.';


-- ---------------------------------------------------------------------------
-- 3. The read path
--
-- Reconciliation has to be able to see what it imported, and the tables stay
-- unreadable to every client role — so this returns the few columns a
-- reconciliation needs and nothing else. Historical rows only: an operational
-- correction is none of the importer's business.
-- ---------------------------------------------------------------------------

create or replace function public.seller_historical_adjustments()
returns table (
  id bigint,
  sale_id bigint,
  channel text,
  amount numeric,
  reason text,
  occurred_at date,
  source text,
  import_fingerprint text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  return query
    select a.id, a.sale_id, a.channel, a.amount, a.reason, a.occurred_at,
           a.source, a.import_fingerprint
      from public.settlement_adjustments a
     where a.source = 'excel_order_2026'
     order by a.id;
end;
$$;

comment on function public.seller_historical_adjustments() is
  'Every settlement adjustment reconstructed from Order 2026 (0061), for import reconciliation. Read-only, seller-gated, and the only way to see them without a table grant.';


-- ---------------------------------------------------------------------------
-- 4. Privileges
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so each REVOKE is
-- load-bearing. The table itself gains no privilege for any client role and no
-- policy: these functions remain the whole surface.
-- ---------------------------------------------------------------------------

revoke all on function public.seller_import_settlement_adjustment(text, text, numeric, text, text, date, text)
  from public, anon;
grant execute on function public.seller_import_settlement_adjustment(text, text, numeric, text, text, date, text)
  to authenticated;

revoke all on function public.seller_historical_adjustments() from public, anon;
grant execute on function public.seller_historical_adjustments() to authenticated;
