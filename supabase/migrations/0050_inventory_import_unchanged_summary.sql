-- ===========================================================================
-- 0050 — the import summary counts the state the rows are actually in
--
-- WHY THIS IS A NEW FILE. `0048` is applied to Staging. An applied migration
-- is never rewritten, so the correction is additive and takes the next number.
-- Staging's applied order is therefore `0047 → 0049 → 0048 → 0050`: the
-- numbering says when a file was written, the database says when it ran, and
-- the two are allowed to disagree.
--
-- THE DEFECT, in one line of `seller_create_import()`:
--
--     count(*) filter (where status = 'pending' and delta = 0)   as same
--
-- `reconcile()` (src/lib/import/classify.ts) returns `unchanged` when the
-- delta is zero and `pending` only when it is not. `pending AND delta = 0` is
-- therefore unreachable by construction, and the counter was structurally
-- always 0 — not occasionally wrong, never right.
--
-- WHAT IT LOOKED LIKE. The real workbook stored 307 rows with
-- `status = ''unchanged''` and the summary reported:
--
--     559 supported · 245 increases · 7 decreases · 0 unchanged · 0 conflicts
--
-- 245 + 7 + 0 + 0 ≠ 559. The rows were right and nothing was mis-applied —
-- `seller_apply_import()` iterates `status = ''pending''` and never reads these
-- counters. But this is the arithmetic on the screen where the owner decides
-- whether to change real stock, and a summary that visibly fails to add up
-- discredits the screen it appears on.
--
-- THE FIX is the filter, and nothing else. The function below is `0048`''s
-- verbatim, with that single line replaced by `status = ''unchanged''`.
-- Reconciliation, desired quantities, delta arithmetic, the apply path,
-- inventory movements, reservations, classification, the content fingerprint,
-- the parser and the import scope are all untouched.
-- ===========================================================================


create or replace function public.seller_create_import(
  p_file_name text,
  p_content_fingerprint text,
  p_workbook_modified_at timestamptz,
  p_sheets text[],
  p_rows   jsonb
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = 'invalid_parameter_value';
  end if;

  -- A whole workbook is 614 rows. Far above that is a different file.
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'that is more rows than a workbook has'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.inventory_imports (
    file_name, content_fingerprint, workbook_modified_at, sheets_read, rows_seen, created_by
  ) values (
    left(btrim(p_file_name), 300), p_content_fingerprint, p_workbook_modified_at,
    coalesce(p_sheets, '{}'), jsonb_array_length(p_rows), auth.uid()
  ) returning id into v_id;

  insert into public.inventory_import_rows (
    import_id, sheet, source_row, raw_name, classification,
    sky_id, condition, previous_quantity, desired_quantity, delta, status, note
  )
  select v_id,
         r->>'sheet',
         (r->>'source_row')::integer,
         left(r->>'raw_name', 300),
         r->>'classification',
         nullif(r->>'sky_id', ''),
         nullif(r->>'condition', ''),
         (r->>'previous_quantity')::integer,
         (r->>'desired_quantity')::integer,
         (r->>'delta')::integer,
         coalesce(nullif(r->>'status', ''), 'pending'),
         left(r->>'note', 500)
    from jsonb_array_elements(p_rows) as r;

  -- The summary, computed here rather than trusted from the client: these are
  -- the numbers the confirmation screen shows, and they must describe the rows
  -- that were actually stored.
  update public.inventory_imports im set
    supported_rows = c.supported,
    ignored_rows   = c.ignored,
    conflict_rows  = c.conflicts,
    increases      = c.inc,
    decreases      = c.dec,
    unchanged      = c.same,
    new_positions  = c.fresh,
    units_before   = c.before,
    units_after    = c.after
  from (
    select
      count(*) filter (where classification = 'SUPPORTED_COMPLETE_LOOSE_FIGURE')            as supported,
      count(*) filter (where classification like 'IGNORED%')                                 as ignored,
      count(*) filter (where status = 'conflict')                                            as conflicts,
      count(*) filter (where status = 'pending' and delta > 0)                               as inc,
      count(*) filter (where status = 'pending' and delta < 0)                               as dec,
      count(*) filter (where status = 'unchanged')                                           as same,
      count(*) filter (where status = 'pending' and previous_quantity = 0 and delta > 0)     as fresh,
      coalesce(sum(previous_quantity) filter (where classification = 'SUPPORTED_COMPLETE_LOOSE_FIGURE'), 0) as before,
      coalesce(sum(desired_quantity)  filter (where classification = 'SUPPORTED_COMPLETE_LOOSE_FIGURE'), 0) as after
    from public.inventory_import_rows where import_id = v_id
  ) c
  where im.id = v_id;

  return v_id;
end;
$$;

comment on function public.seller_create_import(text, text, timestamptz, text[], jsonb) is
  'Stores one import proposal and its summary. Since 0050 the unchanged counter reads the status the rows actually carry, so supported = increases + decreases + unchanged + conflicts holds (ADR-0087).';

revoke all on function public.seller_create_import(text, text, timestamptz, text[], jsonb)
  from public, anon;
grant execute on function public.seller_create_import(text, text, timestamptz, text[], jsonb)
  to authenticated;
