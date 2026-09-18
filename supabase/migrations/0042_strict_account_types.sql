-- ===========================================================================
-- 0042 — one account, one type
--
-- WHAT CHANGES, AND WHY IT IS NOT A TIGHTENING OF 0041
--
-- `0041` made BUSINESS and ADMIN orthogonal capabilities that an account could
-- hold together if somebody granted both. That was the right shape for the
-- problem it solved — separating two authorities that had been one predicate —
-- and it is the wrong shape for the product.
--
-- SkyIsles may later let a private collector sell out of their own collection.
-- If BUSINESS were "a collector with a selling permission", that future
-- feature and the commercial shop would be the same thing wearing two labels,
-- and there would be no way to give them different rules. So the identities
-- are separated now, while separating them is cheap:
--
--   USER      a private collector. No privileged membership anywhere.
--   BUSINESS  a commercial shop. No collection.
--   ADMIN     the platform. No collection, no shop.
--
-- A person who collects privately AND runs a shop uses two accounts. That is
-- the decision, not an accident of the implementation.
--
-- WHAT THIS IS NOT
--
-- Not a hierarchy, not a role table, not a marketplace. No `seller_id` reaches
-- commerce, `sellers_one_active` stands, and nothing about the catalog moves:
-- it belongs to SkyIsles and all three types read it (ADR-0076).
--
-- HISTORICAL DATA IS NEVER DELETED. Becoming a Business hides a collection; it
-- does not drop a row. Revoking the shop makes the same collection readable
-- again, unchanged. Account type controls access, never storage.
--
-- DEPENDS ON `0041`, which is applied on Staging. Not on `0035`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Does this account hold any privileged membership?
--
-- Deliberately NOT a claim that the two capabilities imply each other — they
-- still do not, and `is_platform_admin()` and `can_operate_active_seller()`
-- still never call one another. This answers a third, different question:
-- "is this account something other than a private collector?", which is what
-- the collection needs to know and nothing else does.
-- ---------------------------------------------------------------------------
create or replace function public.is_privileged_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and (
       exists (select 1 from public.platform_admins a where a.user_id = p_user_id)
       or exists (
         select 1 from public.seller_operators o
          where o.user_id = p_user_id and o.is_enabled)
     );
$$;

comment on function public.is_privileged_account(uuid) is
  'Whether this account is a Business or a platform Admin rather than a private collector (ADR-0078). Used by the collection, which belongs to collectors alone. Not an inheritance between the two capabilities.';

revoke all on function public.is_privileged_account(uuid) from public, anon;
grant execute on function public.is_privileged_account(uuid) to authenticated;

/** The same question about the caller, for policies that have no id to pass. */
create or replace function public.is_collector_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and not public.is_privileged_account((select auth.uid()));
$$;

comment on function public.is_collector_account() is
  'True for a signed-in private collector — an account with no Business and no Admin membership (ADR-0078).';

revoke all on function public.is_collector_account() from public, anon;
grant execute on function public.is_collector_account() to authenticated;


-- ---------------------------------------------------------------------------
-- 2. The exclusivity invariant, in the database
--
-- Two tables, so two triggers. A CHECK cannot see across tables and a foreign
-- key cannot express absence; a trigger on each side is the smallest thing
-- that holds against a direct RPC call, a direct INSERT, or the service role.
--
-- Both look at ENABLED membership only. A withdrawn seller operator keeps its
-- row — that history is the point of `is_enabled` (ADR-0077) — and must not
-- block a later Admin grant. Revoking first and granting second is exactly the
-- explicit transition the product wants.
-- ---------------------------------------------------------------------------
create or replace function public.seller_operators_exclusive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only an ENABLED grant conflicts. Disabling an operator is always allowed,
  -- including for an account that has since become an administrator.
  if new.is_enabled
     and exists (select 1 from public.platform_admins a where a.user_id = new.user_id) then
    raise exception
      'this account administers SkyIsles and cannot also operate a shop; revoke platform admin first'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.seller_operators_exclusive() is
  'Refuses to give a platform administrator a shop (ADR-0078). One account, one type.';

drop trigger if exists seller_operators_one_type on public.seller_operators;
create trigger seller_operators_one_type
  before insert or update on public.seller_operators
  for each row execute function public.seller_operators_exclusive();

create or replace function public.platform_admins_exclusive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.seller_operators o
     where o.user_id = new.user_id and o.is_enabled
  ) then
    raise exception
      'this account operates a shop and cannot also administer SkyIsles; revoke the shop first'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.platform_admins_exclusive() is
  'Refuses to make a shop operator a platform administrator (ADR-0078). The transition must be explicit: revoke, then grant.';

drop trigger if exists platform_admins_one_type on public.platform_admins;
create trigger platform_admins_one_type
  before insert or update on public.platform_admins
  for each row execute function public.platform_admins_exclusive();

/*
 * The existing administrator is not disturbed.
 *
 * `0041` seeded `platform_admins` from `shop_admins` before this migration
 * existed, and `seller_operators` is empty until a human grants a shop — so
 * there is nothing for these triggers to reject today. They fire from here on,
 * on new grants only, and no row is re-validated on the way in.
 */


-- ---------------------------------------------------------------------------
-- 3. The collection belongs to collectors
--
-- `0001` made it owner-only, which was the whole question then. It is now two
-- questions: whose row is it, and is this account a collector at all.
--
-- All four policies are replaced rather than added to, because a second
-- permissive policy would OR with the first and grant MORE, not less. Read is
-- closed as well as write: a Business account's old collection becomes
-- invisible, not merely frozen — and every row survives, so revoking the shop
-- brings it all back untouched.
-- ---------------------------------------------------------------------------
drop policy if exists collection_items_select_own on public.collection_items;
create policy collection_items_select_own on public.collection_items
  for select to authenticated
  using ((select auth.uid()) = user_id and public.is_collector_account());

drop policy if exists collection_items_insert_own on public.collection_items;
create policy collection_items_insert_own on public.collection_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id and public.is_collector_account());

-- USING decides which rows may be updated, WITH CHECK what they may become.
-- Both are required: without WITH CHECK an owner could move a row to another
-- account.
drop policy if exists collection_items_update_own on public.collection_items;
create policy collection_items_update_own on public.collection_items
  for update to authenticated
  using ((select auth.uid()) = user_id and public.is_collector_account())
  with check ((select auth.uid()) = user_id and public.is_collector_account());

drop policy if exists collection_items_delete_own on public.collection_items;
create policy collection_items_delete_own on public.collection_items
  for delete to authenticated
  using ((select auth.uid()) = user_id and public.is_collector_account());

comment on table public.collection_items is
  'A private collector''s own shelf. Owner-only since 0001 and collector-only since 0042 (ADR-0078): a Business or Admin account can neither read nor write one, and its rows are hidden rather than deleted.';


-- ---------------------------------------------------------------------------
-- 4. The grant paths say why, rather than letting the trigger say it
--
-- The triggers are the boundary. These two give the operator a sentence they
-- can act on instead of a constraint violation, and they refuse before any
-- row is touched.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_seller_operator(
  p_user_id uuid,
  p_enabled boolean,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_user_id is null then
    raise exception 'an operator is an account' using errcode = 'check_violation';
  end if;

  -- One account, one type (ADR-0078). Checked here for the message and again
  -- by the trigger, which is what a direct call meets.
  if coalesce(p_enabled, false)
     and exists (select 1 from public.platform_admins a where a.user_id = p_user_id) then
    raise exception
      'this account administers SkyIsles and cannot also operate a shop; revoke platform admin first'
      using errcode = 'check_violation';
  end if;

  select id into v_seller_id from public.sellers where is_active order by id limit 1;
  if v_seller_id is null then
    raise exception 'no active seller' using errcode = 'no_data_found';
  end if;

  /*
   * Disabling keeps the row. Access that was granted and withdrawn is a fact
   * about the past, and the account returns to being an ordinary collector
   * with its collection intact.
   */
  insert into public.seller_operators (seller_id, user_id, is_enabled, created_by, updated_by, note)
  values (v_seller_id, p_user_id, coalesce(p_enabled, false),
          (select auth.uid()), (select auth.uid()),
          nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (seller_id, user_id) do update
    set is_enabled = excluded.is_enabled,
        updated_at = now(),
        updated_by = excluded.updated_by,
        note       = coalesce(excluded.note, public.seller_operators.note);
end;
$$;

comment on function public.admin_set_seller_operator(uuid, boolean, text) is
  'Grants or withdraws permission to operate the active seller (ADR-0077, ADR-0078). Platform administrators only. Refuses an account that administers SkyIsles: one account, one type. Withdrawing returns the account to being a collector, with its collection intact.';

create or replace function public.admin_set_platform_admin(
  p_user_id uuid,
  p_enabled boolean,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_user_id is null then
    raise exception 'an administrator is an account' using errcode = 'check_violation';
  end if;

  if coalesce(p_enabled, false) then
    if exists (
      select 1 from public.seller_operators o
       where o.user_id = p_user_id and o.is_enabled
    ) then
      raise exception
        'this account operates a shop and cannot also administer SkyIsles; revoke the shop first'
        using errcode = 'check_violation';
    end if;

    insert into public.platform_admins (user_id, created_by, note)
    values (p_user_id, (select auth.uid()), nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (user_id) do nothing;
  else
    /*
     * The last administrator may not remove themselves. Nobody could grant it
     * back: `admin_set_platform_admin()` needs an administrator to call it, and
     * `shop_admins` is no longer read by anything.
     */
    if (select count(*) from public.platform_admins) <= 1 then
      raise exception 'the last platform administrator cannot be removed'
        using errcode = 'restrict_violation';
    end if;
    delete from public.platform_admins where user_id = p_user_id;
  end if;
end;
$$;

comment on function public.admin_set_platform_admin(uuid, boolean, text) is
  'Grants or withdraws platform administration (ADR-0078). Administrators only. Refuses an account that operates a shop — the transition must be explicit: revoke the shop first. Refuses to remove the last administrator, because nobody could grant it back.';

revoke all on function public.admin_set_platform_admin(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_platform_admin(uuid, boolean, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. What the application asks, in one word
-- ---------------------------------------------------------------------------
create or replace function public.my_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_platform_admin',  public.is_platform_admin(),
    'can_operate_seller', public.can_operate_active_seller(),
    -- Derived here so the application never computes an account type from two
    -- booleans and gets the precedence wrong (ADR-0078).
    'account_type', case
      when public.is_platform_admin()        then 'admin'
      when public.can_operate_active_seller() then 'business'
      else 'user'
    end
  );
$$;

comment on function public.my_capabilities() is
  'The current account''s type and its two capabilities (ADR-0078). Exactly one type: admin, business, or user. The two booleans cannot both be true — the database refuses that combination.';


-- ---------------------------------------------------------------------------
-- 6. What this migration deliberately does NOT do
--
-- No private selling. The identities are separated so that feature CAN exist
-- one day with its own rules; none of it is built here.
--
-- No deletion, anywhere. Becoming a Business hides a collection and drops no
-- row; revoking the shop shows it again.
--
-- No `seller_id` on commerce, no second seller, no marketplace, no onboarding,
-- no payouts, no commissions.
--
-- No change to what any of the three may READ of the catalog: it belongs to
-- SkyIsles and all three consume it (ADR-0076).
--
-- No new role table. Two memberships and one invariant between them.
--
-- No dependency on `0035`.
-- ---------------------------------------------------------------------------
