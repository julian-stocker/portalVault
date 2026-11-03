-- ---------------------------------------------------------------------------
-- 0175 — an account that decided or applied in a reconciliation can be
--        deleted again (ADR-0176)
--
-- THE DEFECT IN 0169. `sales_recon_decisions.decided_by` and
-- `sales_recon_applications.applied_by` reference `auth.users` with
-- `on delete set null`. PostgreSQL carries that out as an UPDATE of the
-- referencing row — and both tables carry a BEFORE UPDATE OR DELETE trigger
-- (`sales_recon_evidence_is_append_only`) that refuses every UPDATE. So the
-- moment an account had made one decision, deleting it failed with
-- "sales_recon_decisions is append-only", and Supabase reported
-- "Database error deleting user". Measured on PostgreSQL, not assumed.
--
-- This is the defect ADR-0037 fixed for `inventory_movements` and ADR-0039
-- for `catalog_admin_changes`; 0169 repeated it.
--
-- THE FIX, AND ONLY THE FIX. The trigger function gets a new body; the two
-- triggers, the foreign keys and every row stay as they are. It still
-- refuses EVERY delete and EVERY update, with exactly one exception — the
-- anonymisation that an account deletion performs:
--
--   * the row is in `sales_recon_decisions` (column `decided_by`) or in
--     `sales_recon_applications` (column `applied_by`);
--   * that column goes from an account to NULL — nothing else;
--   * every other column is unchanged, compared as the whole row in jsonb
--     text form (so a column added later is covered without a new list);
--   * the update comes from inside another trigger (`pg_trigger_depth() > 1`):
--     the referential action of the foreign key, not a statement;
--   * and the account no longer exists in `auth.users`.
--
-- The last two together are what makes it narrower than ADR-0037/0039: a
-- direct `update … set decided_by = null` is refused even by the database
-- owner, because the account it names still exists — and while it exists,
-- the foreign key keeps the reference valid. Only the deletion itself can
-- clear it, and only for the account being deleted.
--
-- WHAT STAYS. Decision, shown values, manual payload, reason, time; outcome,
-- old and new value, time — the whole evidence. What goes is the pointer to
-- an account that no longer exists, which is the point of deleting it
-- (data minimisation). The sessions (`created_by`, `closed_by`,
-- `discarded_by`) never had this problem: they carry no such trigger.
--
-- IT CONTAINS NO DATA STATEMENT. No row is read into, written or removed.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Which version stands here?
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_body text;
begin
  if to_regclass('public.sales_recon_decisions') is null
     or to_regclass('public.sales_recon_applications') is null
     or to_regprocedure('public.sales_recon_evidence_is_append_only()') is null then
    raise exception '0175 needs 0169: the reconciliation tables or their trigger function are missing';
  end if;

  if (select count(*) from pg_trigger t
       where t.tgrelid in ('public.sales_recon_decisions'::regclass,
                           'public.sales_recon_applications'::regclass)
         and not t.tgisinternal
         and t.tgfoid = 'public.sales_recon_evidence_is_append_only()'::regprocedure) <> 2 then
    raise exception '0175 abort: the two append-only triggers of 0169 are not both in place';
  end if;

  select md5(p.prosrc) into v_body from pg_proc p
   where p.oid = to_regprocedure('public.sales_recon_evidence_is_append_only()');

  if v_body = 'ee1027ee285c6a31163fa3f123c07c73' then
    raise exception '0175 abort: sales_recon_evidence_is_append_only() carries the body of 0175 '
      'already — applied here already';
  end if;
  if v_body is distinct from 'aedd3c64076884fbf29d0308f5e26ec7' then
    raise exception '0175 abort: sales_recon_evidence_is_append_only() is % and not the body '
      'from 0169 (aedd3c64076884fbf29d0308f5e26ec7). A foreign version is not overwritten blindly.',
      coalesce(v_body, '(none)');
  end if;
end
$pre$;


-- ---------------------------------------------------------------------------
-- 2. The new body
-- ---------------------------------------------------------------------------
create or replace function public.sales_recon_evidence_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column  text := case tg_table_name
                      when 'sales_recon_decisions'    then 'decided_by'
                      when 'sales_recon_applications' then 'applied_by'
                    end;
  v_old     jsonb;
  v_new     jsonb;
  v_account uuid;
begin
  if tg_op = 'UPDATE' and v_column is not null then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_account := (v_old ->> v_column)::uuid;
    if v_account is not null
       and v_new -> v_column = 'null'::jsonb
       and (v_new - v_column)::text = (v_old - v_column)::text
       and pg_trigger_depth() > 1
       and not exists (select 1 from auth.users u where u.id = v_account) then
      return new;
    end if;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.sales_recon_evidence_is_append_only() from public, anon, authenticated;

comment on function public.sales_recon_evidence_is_append_only() is
  'Append-only guard of sales_recon_decisions and sales_recon_applications (0169, ADR-0174), narrowed by 0175 (ADR-0176). Refuses every DELETE and every UPDATE - except the one an account deletion performs through on delete set null: decided_by / applied_by from an account to NULL, every other column unchanged, issued from inside the referential action (pg_trigger_depth() > 1), and the account already gone from auth.users. A direct UPDATE is refused even for the owner, because the named account still exists.';


-- ---------------------------------------------------------------------------
-- 3. Postconditions
-- ---------------------------------------------------------------------------
do $post$
declare
  v_body text;
begin
  select md5(p.prosrc) into v_body from pg_proc p
   where p.oid = to_regprocedure('public.sales_recon_evidence_is_append_only()');
  if v_body is distinct from 'ee1027ee285c6a31163fa3f123c07c73' then
    raise exception '0175 postcondition: the trigger function is %, expected '
      'ee1027ee285c6a31163fa3f123c07c73', v_body;
  end if;

  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.sales_recon_evidence_is_append_only()')
                    and p.prosecdef
                    and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c
                          where c like 'search\_path=%')) then
    raise exception '0175 postcondition: the trigger function lost security definer or its search_path';
  end if;

  if (select count(*) from pg_trigger t
       where t.tgrelid in ('public.sales_recon_decisions'::regclass,
                           'public.sales_recon_applications'::regclass)
         and not t.tgisinternal
         and t.tgenabled = 'O'
         and t.tgtype & 2 = 2      -- BEFORE
         and t.tgtype & 1 = 1      -- FOR EACH ROW
         and t.tgtype & 24 = 24    -- UPDATE and DELETE
         and t.tgfoid = 'public.sales_recon_evidence_is_append_only()'::regprocedure) <> 2 then
    raise exception '0175 postcondition: the two append-only triggers are not both enabled '
      'BEFORE UPDATE OR DELETE FOR EACH ROW';
  end if;

  if exists (select 1 from pg_proc p,
                    aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = to_regprocedure('public.sales_recon_evidence_is_append_only()')
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) then
    raise exception '0175 postcondition: a client role may execute the trigger function';
  end if;

  raise notice '0175: sales_recon_evidence_is_append_only ee1027ee285c6a31163fa3f123c07c73 - '
    'an account deletion can clear decided_by / applied_by, nothing else can change a row. No row touched.';
end
$post$;
