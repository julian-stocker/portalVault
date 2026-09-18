-- ===========================================================================
-- 0051 — one administrator predicate, and dotted usernames for the shop
--
-- Two problems, one migration, because they share a cause: a rule that lived
-- in two places drifted, and a rule that lived only in the client was not a
-- rule at all.
--
--
-- PART A — `is_shop_admin_for()` answered from the wrong table
--
-- `0041` moved administration to `public.platform_admins` and redefined the
-- no-argument `is_shop_admin()` to delegate to `is_platform_admin()`. It left
-- the one-argument `is_shop_admin_for(uuid)` reading the legacy
-- `public.shop_admins`. Two halves of the same predicate, answering from two
-- tables.
--
-- On Production the two disagreed, and inverted: the account that had just
-- been removed from `platform_admins` was still in `shop_admins` and therefore
-- still "an administrator", while the real administrator was in neither. The
-- visible symptom was the Business panel refusing to offer a shop grant —
-- `admin_find_accounts()` returns `is_shop_admin_for(u.id)` as its `is_admin`
-- column. The invisible one mattered more: `send-order-mail` authorises an
-- administrator caller with exactly this predicate, so the stale table was a
-- live authorization boundary.
--
-- The data was realigned by hand on 2026-09-18. That made the two tables agree
-- once; this makes them unable to disagree.
--
-- `shop_admins` IS NOT DROPPED. Nothing reads it after this migration, but
-- dropping a permission table in the same change that redirects the predicate
-- away from it removes the ability to see what it held if a question comes up
-- later. It is now inert, which is enough.
--
--
-- PART B — a dotted username, for a shop and only for a shop
--
-- `yulez.collectibles` is how the seller is written everywhere else in the
-- product, and it could not be a username: `profiles_username_format` allows
-- letters, digits and underscore. The dot was rejected for everyone.
--
-- Widening that for everyone would change what an ordinary account may call
-- itself, which is not wanted. So the syntax is widened and a second rule
-- decides who may use the new part of it: an account may hold a username
-- containing a dot only while it has an enabled operator grant on an active
-- seller — the same condition `can_operate_active_seller()` asks about the
-- caller, asked here about a row.
--
-- WHY A TRIGGER AND NOT A CHECK. A CHECK constraint cannot contain a subquery,
-- so it cannot ask about `seller_operators` at all. The syntax stays in the
-- CHECK, where it belongs; the entitlement is a trigger, which is the only
-- construct that can express it.
--
-- WHY THE DATABASE AT ALL. `src/lib/auth/username.ts` already says of itself
-- that it is "a convenience, never a boundary. The database decides." A rule
-- enforced only there would be bypassed by any authenticated caller writing
-- their own profile row through PostgREST — which RLS correctly permits.
--
--
-- PART C — a shop may not be taken away and leave an impossible account
--
-- If the entitlement can be withdrawn while the username still depends on it,
-- the account is left holding a name its own constraints would now reject:
-- unable to save an unrelated profile edit, and only repairable by somebody
-- noticing. So withdrawal is refused while the name still needs it, with a
-- message that says what to do. Nothing is renamed automatically — a username
-- is the person's, and inventing a replacement is not the database's business.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. One administrator predicate
--
-- Same signature, same return type, same volatility, same security properties,
-- same empty search_path, same grants — `0019` revoked it from every client
-- role and granted it to none, and that is preserved below. Only the table it
-- reads changes.
-- ---------------------------------------------------------------------------

create or replace function public.is_shop_admin_for(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and exists (
       select 1 from public.platform_admins p where p.user_id = p_user_id
     );
$$;

comment on function public.is_shop_admin_for(uuid) is
  'True when the NAMED account administers SkyIsles. Since 0051 it reads public.platform_admins, the same source is_platform_admin() uses — the legacy shop_admins table can no longer change this answer.';

revoke all on function public.is_shop_admin_for(uuid) from public, anon, authenticated;

comment on table public.shop_admins is
  'Superseded. platform_admins is the administrator permission since 0041, and since 0051 nothing reads this table at all. Kept rather than dropped so the historical grants remain legible; adding a row here grants nothing.';


-- ---------------------------------------------------------------------------
-- 2. What makes an account a shop account
--
-- One definition, used by both rules below, so the entitlement and the
-- withdrawal guard cannot drift the way the two admin predicates did.
--
-- It mirrors `can_operate_active_seller()` — enabled grant, active seller —
-- but takes the account as an argument instead of reading `auth.uid()`,
-- because a trigger is asking about a row rather than about its caller.
--
-- MULTIPLE GRANTS ARE POSSIBLE. `seller_operators` is keyed by
-- (seller_id, user_id), so one account may operate more than one shop. This
-- answers "any qualifying grant", which is what both callers need.
-- ---------------------------------------------------------------------------

create or replace function public.operates_any_active_seller(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and exists (
       select 1
         from public.seller_operators o
         join public.sellers s on s.id = o.seller_id
        where o.user_id = p_user_id
          and o.is_enabled
          and s.is_active
     );
$$;

comment on function public.operates_any_active_seller(uuid) is
  'True when the NAMED account holds an enabled operator grant on an active seller. The row-facing counterpart of can_operate_active_seller(), and the single definition of "may hold a dotted username" (0051).';

revoke all on function public.operates_any_active_seller(uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. The syntax
--
-- Dots are permitted BETWEEN segments and nowhere else, so `.yulez`, `yulez.`
-- and `yulez..collectibles` stay invalid for everybody. The 3–20 length is
-- unchanged and now stated separately from the pattern, because the pattern
-- can no longer carry it: a bounded repetition would have to be written around
-- the alternation, which is harder to read than saying the length once.
--
-- Nothing in the old character set is lost. Every username that was valid
-- before this migration is still valid after it, which is why no backfill is
-- needed and why the constraint can be replaced in place.
-- ---------------------------------------------------------------------------

alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format
  check (
    username is null
    or (
      length(username) between 3 and 20
      and username ~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$'
    )
  );

comment on column public.profiles.username is
  'Unique, case-insensitive display identity. NULL until onboarding. Letters, digits and underscore for every account; a dot between segments additionally for accounts that operate an active seller (0051). Uniqueness is enforced by profiles_username_lower_uniq.';


-- ---------------------------------------------------------------------------
-- 4. Who may use the new part of that syntax
--
-- AN UNCHANGED USERNAME IS ALWAYS ALLOWED THROUGH. The rule is about taking a
-- dotted name, not about holding one: if an account somehow ends up with a
-- dotted username and no grant, it must still be able to save its country or
-- its avatar. Blocking that would turn one wrong row into an account nobody
-- can edit, and the guard in section 5 is what keeps that row from existing in
-- the first place.
--
-- A NULL username is not a dotted username. Profile rows are created by the
-- `handle_new_user` trigger with `username` NULL (0001), and that path must
-- keep working.
-- ---------------------------------------------------------------------------

create or replace function public.profiles_business_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username is null or position('.' in new.username) = 0 then
    return new;
  end if;

  -- Untouched on an update: this is somebody editing something else.
  --
  -- The nesting is not style. PL/pgSQL evaluates a condition as one SQL
  -- expression rather than short-circuiting it, and OLD is unassigned during
  -- an INSERT — `tg_op = 'UPDATE' and old.username = ...` would fail on every
  -- profile ever created.
  if tg_op = 'UPDATE' then
    if new.username is not distinct from old.username then
      return new;
    end if;
  end if;

  if not public.operates_any_active_seller(new.id) then
    raise exception
      'a username may contain a dot only while the account operates a shop'
      using errcode = 'check_violation',
            constraint = 'profiles_username_business_only';
  end if;

  return new;
end;
$$;

comment on function public.profiles_business_username() is
  'Permits a dot in a username only for an account that operates an active seller (0051). An unchanged username always passes, so a profile never becomes uneditable.';

drop trigger if exists profiles_business_username_trg on public.profiles;
create trigger profiles_business_username_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_business_username();


-- ---------------------------------------------------------------------------
-- 5. The shop may not be withdrawn while the name still needs it
--
-- Fires only when the operation actually removes a qualifying grant: a DELETE
-- always does, an UPDATE only when it leaves the row disabled. An update that
-- keeps the grant enabled — a note, a timestamp — is not a withdrawal.
--
-- ONLY THE LAST ONE IS BLOCKED. Because an account may operate several shops,
-- losing one grant is only a problem when no other qualifying grant remains.
-- The row being changed is excluded from that count by its primary key, so the
-- question asked is genuinely "afterwards", not "now".
--
-- `errcode` is `restrict_violation` rather than `check_violation`: nothing
-- about the row is malformed. The operation is refused because of what it
-- would do to something else.
-- ---------------------------------------------------------------------------

create or replace function public.seller_operators_username_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
begin
  -- Still an enabled grant afterwards: nothing is being withdrawn.
  --
  -- Nested for the same reason as the trigger above, mirrored: NEW is
  -- unassigned during a DELETE, and a flat `tg_op = 'UPDATE' and new.is_enabled`
  -- would fail on every withdrawal this trigger exists to inspect.
  if tg_op = 'UPDATE' then
    if new.is_enabled then
      return new;
    end if;
  end if;

  select p.username into v_username
    from public.profiles p where p.id = old.user_id;

  if v_username is null or position('.' in v_username) = 0 then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if not exists (
    select 1
      from public.seller_operators o
      join public.sellers s on s.id = o.seller_id
     where o.user_id = old.user_id
       and o.is_enabled
       and s.is_active
       and o.seller_id <> old.seller_id
  ) then
    raise exception
      'this account''s username contains a dot, which only a shop account may use; it must be changed to a username without a dot before shop access is withdrawn'
      using errcode = 'restrict_violation',
            constraint = 'seller_operators_username_guard';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

comment on function public.seller_operators_username_guard() is
  'Refuses to withdraw the last qualifying shop grant from an account whose username contains a dot (0051). Nothing is renamed automatically: the operator changes the username first, then the grant can go.';

drop trigger if exists seller_operators_username_guard_trg on public.seller_operators;
create trigger seller_operators_username_guard_trg
  before update or delete on public.seller_operators
  for each row execute function public.seller_operators_username_guard();


-- ---------------------------------------------------------------------------
-- 6. What this migration does NOT close
--
-- `sellers.is_active` is never written by any function in this schema — there
-- is no deactivation path today, canonical or otherwise. If one is added, it
-- must respect the same invariant, because deactivating the last active seller
-- would strand a dotted username exactly as withdrawing the last grant would.
-- The same is true of deleting a seller or an account outright, where
-- `seller_operators` rows disappear by cascade without this trigger seeing a
-- statement it can refuse.
--
-- Guarding a path that does not exist would be machinery for a hypothesis, so
-- it is written down here instead of built.
-- ---------------------------------------------------------------------------
