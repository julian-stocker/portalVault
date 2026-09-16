-- ===========================================================================
-- 0036 - tester accounts, and what each of them may test
--
-- WHY
--
-- `0021` gave one account one thing: `commerce_testers` says who may check out
-- while the shop is in sandbox. That was the right size for one question. It
-- is the wrong size for the second one, because the honest answer to "add
-- performance tracking" would be a second table with the same shape, and the
-- answer to the third a third.
--
-- So the shape becomes general once, and never again: a tester is an account
-- somebody deliberately put on a list, and a tester permission is an additive
-- fact about that account. Two testers may carry different ones.
--
-- WHAT THIS IS NOT
--
-- Not a role system. A tester permission grants exactly the one thing it
-- names: it never implies another permission, and it never implies
-- `shop_admins`. An administrator is not a tester unless somebody listed them,
-- which is the rule `0021` already wrote down and this file keeps.
--
-- Not a feature-flag framework either. There is no percentage rollout, no
-- environment targeting, no expiry. It is a list of accounts and a list of
-- things they may test.
--
-- THE LEGACY TABLE STAYS, AND IT IS NOT THE AUTHORITY
--
-- `commerce_testers` is not dropped here. Dropping a working permission table
-- in the same migration that replaces it leaves no way back if the new one
-- misbehaves in production. It becomes a MIRROR: every write below keeps it in
-- step, and nothing reads it any more. Section 6 says exactly how.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. testers - the accounts somebody put on the list
--
-- The same shape as `shop_admins` and `commerce_testers`, for the same
-- reasons: the identity is the user id, a deleted account leaves no permission
-- behind, and there is no `enabled` column because the row IS the state. Two
-- ways to say the same thing is two ways for them to disagree.
-- ---------------------------------------------------------------------------
create table if not exists public.testers (
  user_id    uuid        primary key,

  created_at timestamptz not null default now(),
  -- Who put them on the list. A record, not an authorisation, and it must
  -- survive that person's own account being deleted.
  created_by uuid,
  note       text,

  constraint testers_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete cascade,

  constraint testers_created_by_fk foreign key (created_by)
    references auth.users (id)
    on update cascade
    on delete set null
);

comment on table public.testers is
  'Accounts deliberately designated as test accounts (ADR-0071). Membership alone grants nothing - it is the row in tester_permissions that does. Existence is the state: withdrawing is a delete, and the permissions follow by cascade. Unrelated to shop_admins.';

alter table public.testers enable row level security;
revoke all on public.testers from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. tester_features - the vocabulary, as data
--
-- WHY A TABLE AND NOT A CHECK OR AN ENUM
--
-- Every other closed set in this schema is a CHECK, and rightly: `card_type`
-- and `commerce_mode` are closed by the subject matter. This set is
-- deliberately OPEN — the whole point is that a fourth test feature arrives
-- without redesigning anything — and the difference matters:
--
--   an enum  needs ALTER TYPE, which does not compose well in a transaction
--   a CHECK  needs dropping and re-adding the constraint for every value
--   a table  needs one INSERT
--
-- The validation is not weaker for it. A foreign key refuses an invented key
-- exactly as a CHECK would, and the German label the admin area shows lives
-- beside the key instead of in a second map in the application.
-- ---------------------------------------------------------------------------
create table if not exists public.tester_features (
  key         text        primary key,
  -- What the administrator reads. German, like every other visible label.
  label       text        not null,
  description text        not null,
  -- Display order in the admin area, so the list does not reorder itself.
  position    smallint    not null default 0,

  constraint tester_features_key_format check (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  constraint tester_features_label_not_blank check (length(btrim(label)) > 0)
);

comment on table public.tester_features is
  'The vocabulary of tester permissions (ADR-0071). A new test feature is an INSERT here, never a schema change. Not client readable: the admin area receives it through admin_tester_state().';

alter table public.tester_features enable row level security;
revoke all on public.tester_features from anon, authenticated;

insert into public.tester_features (key, label, description, position) values
  ('commerce', 'E-Commerce',
   'Darf zur Kasse gehen, während der Shop im Sandbox-Modus ist. Entspricht der bisherigen Commerce-Testerliste.', 1),
  ('performance_tracking', 'Performance-Tracking',
   'Die Anwendung misst bei diesem Konto automatisch, wie lange Navigationen dauern, und speichert nur Routen und Zeiten.', 2)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 3. tester_permissions - the additive facts
--
-- Keyed on the tester rather than on `auth.users`, so removing a tester takes
-- their permissions with it by cascade. That is the whole of "remove tester":
-- one delete, and nothing else in the account is touched.
-- ---------------------------------------------------------------------------
create table if not exists public.tester_permissions (
  user_id    uuid        not null,
  permission text        not null,

  granted_at timestamptz not null default now(),
  granted_by uuid,

  primary key (user_id, permission),

  constraint tester_permissions_tester_fk foreign key (user_id)
    references public.testers (user_id)
    on update cascade
    on delete cascade,

  -- The registry decides what a permission may be called. An invented key is
  -- refused here rather than stored and puzzled over later.
  constraint tester_permissions_feature_fk foreign key (permission)
    references public.tester_features (key)
    on update cascade
    on delete restrict,

  constraint tester_permissions_granted_by_fk foreign key (granted_by)
    references auth.users (id)
    on update cascade
    on delete set null
);

comment on table public.tester_permissions is
  'Additive tester permissions (ADR-0071). One row grants exactly the feature it names: never another permission, never shop_admins. Read only through has_tester_permission().';

alter table public.tester_permissions enable row level security;
revoke all on public.tester_permissions from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. tester_permission_changes - the narrow journal
--
-- Append-only, and deliberately small. `catalog_admin_changes` is for the
-- catalogue and its CHECK says so; stretching it to cover permissions would
-- make "entity" mean two unrelated things. `payment_events` and `order_events`
-- belong to their own subjects for the same reason.
--
-- Membership is recorded as well as permissions, and without muddying the
-- field: `permission` is NULL for the two membership actions, which is exactly
-- what "this was not about a permission" looks like.
-- ---------------------------------------------------------------------------
create table if not exists public.tester_permission_changes (
  id         bigint      generated always as identity primary key,

  user_id    uuid        not null,
  -- NULL for added/removed: those are about the account, not about a feature.
  permission text,
  action     text        not null,

  -- NULL when the change came through server tooling rather than a person, and
  -- after the actor's own account is deleted. The record survives the person.
  changed_by uuid,
  changed_at timestamptz not null default now(),

  constraint tester_permission_changes_action_known
    check (action in ('added', 'removed', 'granted', 'revoked')),

  -- The two shapes, stated rather than assumed.
  constraint tester_permission_changes_shape
    check (
      (action in ('added', 'removed') and permission is null)
      or (action in ('granted', 'revoked') and permission is not null)
    ),

  constraint tester_permission_changes_changed_by_fk foreign key (changed_by)
    references auth.users (id) on delete set null
);

comment on table public.tester_permission_changes is
  'Append-only journal of tester membership and permission changes (ADR-0071). No foreign key to testers: an entry must outlive the row it describes, which is the only reason the journal exists.';

alter table public.tester_permission_changes enable row level security;
revoke all on public.tester_permission_changes from anon, authenticated;

create index if not exists tester_permission_changes_user_idx
  on public.tester_permission_changes (user_id, changed_at desc);


-- ---------------------------------------------------------------------------
-- 5. The checks
--
-- `has_tester_permission()` takes no user argument, and that is the point: it
-- can only ever answer about the caller. A `has_tester_permission(uuid, text)`
-- would be a lookup service for other people's accounts, which is the reason
-- `is_shop_admin()` has no argument either (0003).
-- ---------------------------------------------------------------------------
create or replace function public.has_tester_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tester_permissions tp
     where tp.user_id = (select auth.uid())
       and tp.permission = p_permission
  );
$$;

comment on function public.has_tester_permission(text) is
  'True when the CALLING account holds this tester permission (ADR-0071). Takes no user id on purpose. An unknown permission is false, not an error - a caller asking about a feature that does not exist has not been granted it.';

revoke all on function public.has_tester_permission(text) from public, anon;
grant  execute on function public.has_tester_permission(text) to authenticated;

-- The named-account counterpart, for the privileged callers that hold a user
-- id instead of a session - the payment path. Exactly as restricted as
-- `is_commerce_tester_for()` was: no client role may execute it, so it cannot
-- become a way to enumerate anybody.
create or replace function public.has_tester_permission_for(
  p_user_id   uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and exists (
       select 1
         from public.tester_permissions tp
        where tp.user_id = p_user_id
          and tp.permission = p_permission
     );
$$;

comment on function public.has_tester_permission_for(uuid, text) is
  'True when the NAMED account holds this tester permission. For callers that hold a user id instead of a session (the payment path). Executable by no client role.';

revoke all on function public.has_tester_permission_for(uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. Commerce keeps working, and this is now where it reads from
--
-- The two 0021 functions stay, with the same names, the same signatures and
-- the same privileges. Only their bodies change: they ask the generic model.
--
-- Everything that called them still does, untouched - `commerce_checkout_allowed()`,
-- the order visibility predicate, `admin_find_accounts()`, `admin_commerce_state()`.
-- Rewriting checkout logic in the migration that replaces the permission store
-- would be two risks taken at once.
-- ---------------------------------------------------------------------------
create or replace function public.is_commerce_tester()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_tester_permission('commerce');
$$;

comment on function public.is_commerce_tester() is
  'True when the calling account may check out in sandbox. Since 0036 a compatibility wrapper around the commerce tester permission (ADR-0071); commerce_testers is no longer read.';

revoke all on function public.is_commerce_tester() from public, anon, authenticated;

create or replace function public.is_commerce_tester_for(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_tester_permission_for(p_user_id, 'commerce');
$$;

comment on function public.is_commerce_tester_for(uuid) is
  'True when the named account may check out in sandbox. Since 0036 a compatibility wrapper around the commerce tester permission (ADR-0071).';

revoke all on function public.is_commerce_tester_for(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. The legacy mirror
--
-- ONE AUTHORITY FOR READS, ONE MIRROR FOR ROLLBACK.
--
-- After this migration nothing reads `commerce_testers` - the two functions
-- above were its only readers and they now ask `tester_permissions`. The table
-- is kept and kept CURRENT so that reverting 0036 (restoring the two 0021
-- bodies) restores working commerce, including for testers added afterwards.
-- Without the mirror a rollback would silently drop their access.
--
-- That is the whole of the "two tables" question: they cannot drift in a way
-- anybody notices, because only one of them is ever consulted. A later
-- migration drops the mirror once the generic model has run in production.
-- ---------------------------------------------------------------------------
create or replace function public.sync_legacy_commerce_tester(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.tester_permissions
     where user_id = p_user_id and permission = 'commerce'
  ) then
    insert into public.commerce_testers (user_id, granted_by, note)
    select p_user_id, t.created_by, t.note
      from public.testers t where t.user_id = p_user_id
    on conflict (user_id) do update set note = excluded.note;
  else
    delete from public.commerce_testers where user_id = p_user_id;
  end if;
end;
$$;

comment on function public.sync_legacy_commerce_tester(uuid) is
  'Keeps the retained commerce_testers table in step with the commerce tester permission, so reverting 0036 restores working sandbox checkout. Write-only mirror: nothing reads commerce_testers after 0036 (ADR-0071). Internal - executable by no client role.';

revoke all on function public.sync_legacy_commerce_tester(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 8. Carrying the existing testers across
--
-- Conflict-safe, so re-applying the migration changes nothing. The timestamps
-- and the actor come across because they mean the same thing on both sides:
-- when this account was put on the list, and by whom.
--
-- No journal entries are written for these. The journal records what somebody
-- DID; inventing four entries for a data move would put an actor and a moment
-- on a decision nobody made today.
-- ---------------------------------------------------------------------------
insert into public.testers (user_id, created_at, created_by, note)
  select ct.user_id, ct.granted_at, ct.granted_by, ct.note
    from public.commerce_testers ct
on conflict (user_id) do nothing;

insert into public.tester_permissions (user_id, permission, granted_at, granted_by)
  select ct.user_id, 'commerce', ct.granted_at, ct.granted_by
    from public.commerce_testers ct
on conflict (user_id, permission) do nothing;


-- ---------------------------------------------------------------------------
-- 9. Administration
--
-- Every one of these asks `is_shop_admin()` first. A tester holds no privilege
-- on any table above and cannot execute any of these, so a tester can neither
-- grant themselves anything nor look at who else is on the list.
-- ---------------------------------------------------------------------------

-- 9.1 Everything the admin area needs, in one document.
create or replace function public.admin_tester_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_features jsonb;
  v_testers  jsonb;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- The registry, so the admin area never carries its own copy of the list.
  select coalesce(jsonb_agg(f order by f ->> 'position'), '[]'::jsonb)
    into v_features
    from (
      select jsonb_build_object(
               'key', tf.key, 'label', tf.label,
               'description', tf.description, 'position', tf.position
             ) as f
        from public.tester_features tf
    ) rows;

  select coalesce(jsonb_agg(t order by t ->> 'created_at'), '[]'::jsonb)
    into v_testers
    from (
      select jsonb_build_object(
               'user_id',     te.user_id,
               'username',    p.username,
               'email',       u.email,
               'created_at',  te.created_at,
               'note',        te.note,
               'is_admin',    public.is_shop_admin_for(te.user_id),
               'permissions', coalesce(
                 (select jsonb_agg(tp.permission order by tp.permission)
                    from public.tester_permissions tp
                   where tp.user_id = te.user_id),
                 '[]'::jsonb)
             ) as t
        from public.testers te
        left join public.profiles p on p.id = te.user_id
        left join auth.users     u on u.id = te.user_id
    ) rows;

  return jsonb_build_object('features', v_features, 'testers', v_testers);
end;
$$;

comment on function public.admin_tester_state() is
  'The tester list with each account''s permissions, plus the feature registry (ADR-0071). Administrators only. The registry travels with the state so the admin area never hardcodes the vocabulary.';

revoke all on function public.admin_tester_state() from public, anon;
grant  execute on function public.admin_tester_state() to authenticated;


-- 9.2 Membership.
create or replace function public.admin_set_tester(
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
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_user_id is null then
    raise exception 'a tester is named by account, never by address'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'no such account' using errcode = 'no_data_found';
  end if;

  if coalesce(p_enabled, false) then
    insert into public.testers (user_id, created_by, note)
    values (p_user_id, (select auth.uid()), nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (user_id) do update set note = excluded.note;

    insert into public.tester_permission_changes (user_id, permission, action, changed_by)
    values (p_user_id, null, 'added', (select auth.uid()));
  else
    -- One delete. `tester_permissions` follows by cascade, and nothing else in
    -- the account is touched: not the auth row, not the collection, not the
    -- orders, not shop_admins.
    delete from public.testers where user_id = p_user_id;

    insert into public.tester_permission_changes (user_id, permission, action, changed_by)
    values (p_user_id, null, 'removed', (select auth.uid()));
  end if;

  perform public.sync_legacy_commerce_tester(p_user_id);
end;
$$;

comment on function public.admin_set_tester(uuid, boolean, text) is
  'Adds or removes a tester account, named by user_id only (ADR-0071). Removing cascades the permissions and touches nothing else about the account. Administrators only.';

revoke all on function public.admin_set_tester(uuid, boolean, text) from public, anon;
grant  execute on function public.admin_set_tester(uuid, boolean, text) to authenticated;


-- 9.3 One permission.
create or replace function public.admin_set_tester_permission(
  p_user_id    uuid,
  p_permission text,
  p_enabled    boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.testers t where t.user_id = p_user_id) then
    raise exception 'not a tester account' using errcode = 'no_data_found';
  end if;

  -- Said here as well as by the foreign key, so the message names the value
  -- rather than a constraint.
  if not exists (select 1 from public.tester_features f where f.key = p_permission) then
    raise exception 'unknown tester permission %', p_permission
      using errcode = 'check_violation';
  end if;

  if coalesce(p_enabled, false) then
    insert into public.tester_permissions (user_id, permission, granted_by)
    values (p_user_id, p_permission, (select auth.uid()))
    on conflict (user_id, permission) do nothing;

    insert into public.tester_permission_changes (user_id, permission, action, changed_by)
    values (p_user_id, p_permission, 'granted', (select auth.uid()));
  else
    delete from public.tester_permissions
     where user_id = p_user_id and permission = p_permission;

    insert into public.tester_permission_changes (user_id, permission, action, changed_by)
    values (p_user_id, p_permission, 'revoked', (select auth.uid()));
  end if;

  if p_permission = 'commerce' then
    perform public.sync_legacy_commerce_tester(p_user_id);
  end if;
end;
$$;

comment on function public.admin_set_tester_permission(uuid, text, boolean) is
  'Grants or revokes one tester permission (ADR-0071). Administrators only. The permission must exist in tester_features; an invented key is refused by name. Granting one never grants another and never grants shop_admins.';

revoke all on function public.admin_set_tester_permission(uuid, text, boolean) from public, anon;
grant  execute on function public.admin_set_tester_permission(uuid, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 10. The 0021 admin entry point, still working
--
-- The existing admin panel calls this and will keep calling it until the new
-- one replaces it. It now maintains the generic model - membership, the
-- commerce permission, the journal and the mirror - so there is no window in
-- which the old button writes to a table nothing reads.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_commerce_tester(
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
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(p_enabled, false) then
    -- Membership first: the permission has nowhere to hang otherwise.
    perform public.admin_set_tester(p_user_id, true, p_note);
    perform public.admin_set_tester_permission(p_user_id, 'commerce', true);
  else
    /*
     * Withdrawing COMMERCE, not tester membership. An account that also tests
     * something else keeps testing it — which is the difference this migration
     * exists to make. A tester left with no permissions stays on the list,
     * visible and harmless, until somebody removes them deliberately.
     */
    if exists (select 1 from public.testers t where t.user_id = p_user_id) then
      perform public.admin_set_tester_permission(p_user_id, 'commerce', false);
    end if;
  end if;
end;
$$;

comment on function public.admin_set_commerce_tester(uuid, boolean, text) is
  'Compatibility entry point from 0021, kept for the existing admin panel. Since 0036 it maintains the generic tester model (ADR-0071). Withdrawing removes the commerce permission only, not tester membership - an account testing something else keeps testing it.';

revoke all on function public.admin_set_commerce_tester(uuid, boolean, text) from public, anon;
grant  execute on function public.admin_set_commerce_tester(uuid, boolean, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 11. What is deliberately absent
--
-- No drop of `commerce_testers`. See section 7: it is the way back, and the
-- way back is worth one migration of patience.
--
-- No client privilege on any table here. Not select, not insert. A tester
-- cannot read the tester list, the registry or the journal, and cannot grant
-- themselves anything, because there is no path that would let them.
--
-- No telemetry. `perf_navigations` and its functions are 0037; this migration
-- decides who may be measured, not what is measured.
-- ---------------------------------------------------------------------------
