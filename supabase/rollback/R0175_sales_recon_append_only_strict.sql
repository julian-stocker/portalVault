-- ===========================================================================
-- ROLLBACK OF 0175 — the append-only guard back to the body from `0169`
--
-- WHAT IT DOES: `create or replace` of `sales_recon_evidence_is_append_only()`
-- with the body from `0169`, character for character, and its old comment.
-- The two triggers, the foreign keys, the ACL and every row stay.
--
-- WHAT IT COSTS — AND WHY IT IS A ROLLBACK, NOT A REPAIR: with the body of
-- `0169` the defect is back. An account that decided or applied in a
-- reconciliation can no longer be deleted ("… is append-only" from the
-- `on delete set null` of `decided_by` / `applied_by`). References that an
-- earlier account deletion already cleared stay NULL; nothing comes back.
--
-- IT IS IDEMPOTENT: where the function already carries the body of `0169`
-- it says so and the replace changes nothing. It aborts when a THIRD
-- version stands — then the situation is to be clarified, not overwritten.
--
-- EXECUTION: as one unit (the SQL editor runs it as one implicit
-- transaction), or wrapped in `begin` / `commit`.
-- ===========================================================================

do $pre$
declare
  v_body text;
begin
  if to_regprocedure('public.sales_recon_evidence_is_append_only()') is null then
    raise exception 'R0175 abort: sales_recon_evidence_is_append_only() does not exist here';
  end if;
  select md5(p.prosrc) into v_body from pg_proc p
   where p.oid = to_regprocedure('public.sales_recon_evidence_is_append_only()');
  if v_body = 'aedd3c64076884fbf29d0308f5e26ec7' then
    raise notice 'R0175: sales_recon_evidence_is_append_only() already carries the body from 0169.';
  elsif v_body is distinct from 'ee1027ee285c6a31163fa3f123c07c73' then
    raise exception 'R0175 abort: sales_recon_evidence_is_append_only() is % — neither 0169 '
      '(aedd3c64076884fbf29d0308f5e26ec7) nor 0175 (ee1027ee285c6a31163fa3f123c07c73). A third version is not overwritten blindly.',
      coalesce(v_body, '(none)');
  end if;
end
$pre$;

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

comment on function public.sales_recon_evidence_is_append_only() is null;

do $post$
begin
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.sales_recon_evidence_is_append_only()'))
     is distinct from 'aedd3c64076884fbf29d0308f5e26ec7' then
    raise exception 'R0175 postcondition: the trigger function is not the body from 0169';
  end if;
  raise notice 'R0175: sales_recon_evidence_is_append_only() is the body from 0169 again. '
    'Accounts that decided or applied in a reconciliation cannot be deleted while it stands.';
end
$post$;
