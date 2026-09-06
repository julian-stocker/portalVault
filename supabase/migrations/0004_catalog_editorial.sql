-- ===========================================================================
-- 0004 — catalog editorial
--
-- The catalog gets an editorial layer: what the owner decides about a
-- collectible, as opposed to what the legacy import states about it
-- (ADR-0039). Four ideas shape it, and the first one is why this migration
-- looks the way it does.
--
-- 1. A table grant is column-blind. `grant select on public.skylanders to
--    anon` covers every column the table will ever have, and RLS filters
--    ROWS, not columns. Measured against the running database on 2026-09-06:
--    an anonymous PostgREST client reads `select=*` and gets all twelve
--    columns. An internal note stored on that table would therefore have been
--    public through `GET /rest/v1/skylanders?select=admin_note`, however
--    carefully the application avoided selecting it.
--
--    So the split is by audience, not by convenience:
--
--      public product data  → columns on public.skylanders
--        catalog_visible, display_name_override
--      internal notes       → public.catalog_editorial, its own table
--        admin_note
--
-- 2. Import-owned and admin-owned columns never overlap. The importer's
--    upsert names its columns explicitly, so PostgREST writes ON CONFLICT DO
--    UPDATE SET for exactly those and leaves everything else alone — the same
--    mechanism that already keeps curated character links safe (ADR-0034).
--
-- 3. Product group is not variant, and neither is completion. `catalog_group`
--    answers "what kind of collectible is this?" and nothing else (ADR-0041).
--
-- 4. Editorial writes go through functions, not privileges. Clients keep no
--    write grant on skylanders, categories or catalog_editorial; the only way
--    in is four security-definer functions that each ask
--    public.is_shop_admin() first.
--
-- NOT additive in one respect, deliberately: section 2 replaces the SELECT
-- policy of `skylanders`. Until now it was `using (true)` — every row for
-- everyone. A hidden row has to stop being readable through the API, not just
-- through the application, and that is a policy change.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Public editorial columns on skylanders
--
-- Both belong to the public product model: what a visitor is shown, and
-- whether they are shown it at all. Neither is confidential, and both are
-- read on every catalog request — a join for them would cost more than it
-- protects.
--
-- `is_active` stays what it has always been — "the legacy source knows this
-- row", set to true by every import run (ADR-0037, section 6) — and is not
-- repurposed here.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  -- Editorial visibility. Independent of is_active (technical) and of
  -- shop_inventory.is_listed (commercial): three questions, three columns.
  --
  -- A hidden figure keeps its collection_items rows. It leaves the public
  -- catalog, the public search and BOTH halves of the completion fraction, so
  -- hiding something can never produce "415 of 414" (ADR-0040).
  add column catalog_visible boolean not null default true,

  -- The public name, when the derived one is wrong. NULL means "use the
  -- derivation" (ADR-0030). `name` stays the imported canonical spelling and
  -- is never rewritten; the slug does not follow either, so existing URLs
  -- survive an edit (ADR-0011).
  add column display_name_override text;

alter table public.skylanders
  add constraint skylanders_display_name_override_not_blank
    check (display_name_override is null or length(btrim(display_name_override)) > 0);

comment on column public.skylanders.catalog_visible is
  'Editorial visibility (ADR-0039). Admin-owned: no import writes it. False hides the row from the public catalog, from search, from the API for everyone but its owner and an administrator, and from both halves of completion.';
comment on column public.skylanders.display_name_override is
  'Public name chosen by an administrator. NULL means the derived display name applies (ADR-0030). Never written by an import. Public by nature — it is the name visitors read.';

-- The public catalog reads exactly this slice on every request.
create index skylanders_public_catalog_idx
  on public.skylanders (series_code)
  where is_active and catalog_visible;


-- ---------------------------------------------------------------------------
-- 2. Who may read which row
--
-- The old policy was `using (true)`: every row for everyone, which was right
-- while every row was public. It is replaced by one policy per role, because
-- the two roles now have genuinely different answers — and because the
-- anonymous one must not call is_shop_admin(), which anon has no EXECUTE
-- privilege on.
--
--   anon           the public catalog, and nothing else
--   authenticated  the public catalog
--                  + anything they own, however it was hidden
--                  + everything, if they are an administrator
--
-- The ownership branch is what keeps a collection whole: a figure hidden
-- after someone collected it still has to arrive with its name, price and
-- image, or their own collection would show a gap (ADR-0040).
--
-- No recursion: collection_items' own policies compare auth.uid() to
-- collection_items.user_id and never look at skylanders. The subquery uses
-- the unique index on (user_id, sky_id).
-- ---------------------------------------------------------------------------
drop policy skylanders_select_public on public.skylanders;

create policy skylanders_select_anon on public.skylanders
  for select to anon
  using (is_active and catalog_visible);

create policy skylanders_select_authenticated on public.skylanders
  for select to authenticated
  using (
    (is_active and catalog_visible)
    or public.is_shop_admin()
    or exists (
      select 1
        from public.collection_items ci
       where ci.sky_id = skylanders.sky_id
         and ci.user_id = (select auth.uid())
    )
  );

-- series and categories keep `using (true)`: a series label and a product
-- group are public catalog data (ADR-0041), and both tables are tiny.


-- ---------------------------------------------------------------------------
-- 3. categories.catalog_group — the product group
--
-- The audit of 2026-09-06 checked all 561 collectibles: each of the 24
-- category rows falls entirely into one product group, with none mixing two.
-- So the classification lives on the category — 24 rows to curate instead of
-- 561 — and no per-figure override exists. If a genuine exception ever
-- appears, `skylanders.catalog_group_override` can be added additively;
-- building it now would be a second truth with nothing to say (ADR-0041).
--
-- NULL is a real state: a category the legacy project adds later arrives
-- unclassified and must be classified deliberately. It is never guessed from
-- the category name, and it never falls back to 'item'.
-- ---------------------------------------------------------------------------
alter table public.categories
  add column catalog_group text;

alter table public.categories
  add constraint categories_catalog_group_known
    check (catalog_group is null or catalog_group in (
      'figure',            -- a plain figure of the game
      'giant',             -- Giants' oversized figures
      'swapper',           -- Swap Force's swappable figures
      'trap_master',
      'sensei',
      'vehicle',
      'trap',
      'creation_crystal',
      'mini',              -- Minis and Sidekicks: one product kind, two labels
      'item'               -- magic items, adventure locations, chests, trophies
    ));

comment on column public.categories.catalog_group is
  'Product group (ADR-0041): what kind of collectible this category holds. Editorial, never imported. NULL means "not classified yet" — visible under "Alle", never auto-assigned. Orthogonal to variant/special and to completion. Public data.';


-- ---------------------------------------------------------------------------
-- 4. Backfill — the 24 category rows that exist today
--
-- Written out, one row at a time, from the audit of 2026-09-06. No name
-- heuristic runs here or anywhere else: this is a curated decision recorded
-- once, exactly like data/characters/characters.json (ADR-0034).
--
-- Three categories carry variant or release information in their NAME while
-- holding plain figures: 'Varianten & LightCore', 'Giants Series 2 Figuren'
-- and 'Trap Team Series Figuren'. They map to 'figure' — the finish and the
-- re-release are dimension C, and dimension C is not built yet.
-- ---------------------------------------------------------------------------
update public.categories set catalog_group = 'figure'
 where (series_code, name) in (
   ('SA', 'Figuren'),
   ('SC', 'Figuren'),
   ('G',  'Giants neue Figuren'),
   ('G',  'Giants Series 2 Figuren'),
   ('SF', 'Swap Force neue Figuren'),
   ('SF', 'Varianten & LightCore'),
   ('T',  'Trap Team neue Figuren'),
   ('T',  'Trap Team Series Figuren')
 );

update public.categories set catalog_group = 'giant'
 where (series_code, name) = ('G', 'Giants große Figuren');

update public.categories set catalog_group = 'swapper'
 where (series_code, name) = ('SF', 'SWAP Force');

update public.categories set catalog_group = 'trap_master'
 where (series_code, name) = ('T', 'Trap Masters');

update public.categories set catalog_group = 'sensei'
 where (series_code, name) = ('I', 'Senseis');

update public.categories set catalog_group = 'vehicle'
 where (series_code, name) = ('SC', 'Fahrzeuge');

update public.categories set catalog_group = 'trap'
 where (series_code, name) = ('T', 'Traps');

update public.categories set catalog_group = 'creation_crystal'
 where (series_code, name) = ('I', 'Kreationskristalle');

-- Sidekicks (SA, G) and Minis (T) are the same product kind under two legacy
-- labels. The exact label stays in `name`; the group unites them.
update public.categories set catalog_group = 'mini'
 where (series_code, name) in (
   ('SA', 'Sidekicks'),
   ('G',  'Sidekicks'),
   ('T',  'Minis')
 );

update public.categories set catalog_group = 'item'
 where (series_code, name) in (
   ('SA', 'Magic Items'),
   ('G',  'Magic Items'),
   ('SF', 'Magic Items'),
   ('T',  'Trap Items'),
   ('SC', 'Trophies'),
   ('I',  'Locations & Truhen')
 );

-- The six software categories stay NULL on purpose: software is outside the
-- collector surface entirely (ADR-0029) and has no product group.


-- ---------------------------------------------------------------------------
-- 5. catalog_editorial — the internal side
--
-- Its own table for one reason: `skylanders` is world-readable, and a column
-- on a world-readable table is world-readable. Notes about stock, sourcing or
-- a customer are exactly what docs/SECURITY.md keeps out of the delivered
-- product, so they live where no client role has a privilege at all.
--
-- One row per figure, created on first note. A figure without a row simply
-- has no note — no backfill, no empty rows for 601 figures.
--
-- Deliberately NOT here: `edited_by` / `edited_at` on the figure. They would
-- be a second truth beside catalog_admin_changes, which already records who
-- changed what and when, and `edited_by` on a public table would publish who
-- curates the catalog. The journal is the answer to "who last touched this".
-- ---------------------------------------------------------------------------
create table public.catalog_editorial (
  sky_id     text        primary key,

  -- Internal remark. Never public, never in an API projection.
  admin_note text,

  updated_at timestamptz not null default now(),

  constraint catalog_editorial_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id)
    on update cascade
    on delete cascade,

  -- Long enough for a paragraph of context, short enough that nobody stores a
  -- document in a catalog row.
  constraint catalog_editorial_note_length
    check (admin_note is null or length(admin_note) <= 2000)
);

comment on table public.catalog_editorial is
  'Internal editorial data about a collectible (ADR-0039). Separate from public.skylanders because that table is world-readable and a table grant covers every column. No client privilege; readable only by an administrator through RLS, writable only through admin_set_admin_note().';


-- ---------------------------------------------------------------------------
-- 6. catalog_admin_changes — what was edited, and by whom
--
-- Append-only, like inventory_movements: a redactional change that leaves no
-- trace is a change nobody can explain later. Deliberately not event
-- sourcing — the current state lives in the columns above, this is the
-- history beside it.
--
-- One table for three entities. Separate tables would be structure without
-- content.
-- ---------------------------------------------------------------------------
create table public.catalog_admin_changes (
  id         bigint      generated always as identity primary key,

  -- 'skylander' → entity_id is a SKY-ID
  -- 'category'  → entity_id is the category id as text
  entity     text        not null,
  entity_id  text        not null,
  field      text        not null,

  -- Both sides as text: this table is read by a human, not joined on.
  old_value  text,
  new_value  text,

  -- NULL when the change came through the service role (an import, a script)
  -- or after the account was deleted. The change survives the person.
  changed_by uuid,
  changed_at timestamptz not null default now(),

  constraint catalog_admin_changes_entity_known
    check (entity in ('skylander', 'category')),

  constraint catalog_admin_changes_field_known
    check (field in (
      'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group'
    )),

  constraint catalog_admin_changes_changed_by_fk foreign key (changed_by)
    references auth.users (id) on delete set null
);

comment on table public.catalog_admin_changes is
  'Append-only journal of editorial catalog changes (ADR-0039). Written by triggers, never by the application, so no write path can forget it.';

create index catalog_admin_changes_entity_idx
  on public.catalog_admin_changes (entity, entity_id, changed_at desc);


-- ---------------------------------------------------------------------------
-- 6.1 Append-only, enforced
--
-- RLS keeps clients out, but the service role bypasses RLS. Triggers are not
-- bypassed, which is why the invariant lives here — the same reasoning as
-- prevent_inventory_movement_change() in 0003.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_catalog_change_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- The one permitted change, and the reason it has to be permitted:
    -- `changed_by` carries `on delete set null`, and SET NULL is an UPDATE.
    -- A blanket refusal here makes every account that ever edited the catalog
    -- undeletable — the account deletion fails with "Database error deleting
    -- user" and there is no way out short of dropping the trigger. That is
    -- exactly the defect ADR-0037 fixed for inventory_movements, and it was
    -- reproduced here; reproduced, found by verify:editorial leaving an
    -- account behind, and fixed the same way.
    --
    -- NULL-safe throughout: old_value, new_value and changed_by are all
    -- nullable, so plain equality would silently pass a row full of NULLs.
    if old.changed_by is not null
       and new.changed_by is null
       and (new.id, new.entity, new.entity_id, new.field,
            new.old_value, new.new_value, new.changed_at)
           is not distinct from
           (old.id, old.entity, old.entity_id, old.field,
            old.old_value, old.new_value, old.changed_at)
    then
      return new;
    end if;

    raise exception
      'catalog_admin_changes is append-only (ADR-0039): the only permitted change is anonymising changed_by to NULL when the account is deleted'
      using errcode = 'restrict_violation';
  end if;

  raise exception
    'catalog_admin_changes is append-only (ADR-0039): % on id % is not allowed',
    tg_op, old.id
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.prevent_catalog_change_edit() is
  'Refuses every DELETE, and every UPDATE except anonymising changed_by to NULL with all factual columns unchanged (the ON DELETE SET NULL path). Applies to the service role as well.';

create trigger catalog_admin_changes_append_only
  before update or delete on public.catalog_admin_changes
  for each row execute function public.prevent_catalog_change_edit();


-- ---------------------------------------------------------------------------
-- 6.2 The journal writes itself
--
-- On the tables, not in the application: a change made through any path — a
-- function below, a service-role script, psql — is recorded. Only editorial
-- columns are watched; an import touching name or price is not an editorial
-- event and would drown the journal.
-- ---------------------------------------------------------------------------
create or replace function public.log_skylander_editorial_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.catalog_visible is distinct from old.catalog_visible then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'catalog_visible',
            old.catalog_visible::text, new.catalog_visible::text,
            (select auth.uid()));
  end if;

  if new.display_name_override is distinct from old.display_name_override then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'display_name_override',
            old.display_name_override, new.display_name_override,
            (select auth.uid()));
  end if;

  return new;
end;
$$;

create trigger skylanders_log_editorial
  after update on public.skylanders
  for each row execute function public.log_skylander_editorial_change();

-- The note lives in its own table, so its journal entry is written there.
-- INSERT is covered as well: the first note on a figure is a change from
-- nothing to something.
create or replace function public.log_editorial_note_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old text := case when tg_op = 'INSERT' then null else old.admin_note end;
begin
  if new.admin_note is distinct from v_old then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', new.sky_id, 'admin_note',
            v_old, new.admin_note, (select auth.uid()));
  end if;
  return new;
end;
$$;

create trigger catalog_editorial_log_note
  after insert or update on public.catalog_editorial
  for each row execute function public.log_editorial_note_change();

create or replace function public.log_category_group_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.catalog_group is distinct from old.catalog_group then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('category', old.id::text, 'catalog_group',
            old.catalog_group, new.catalog_group, (select auth.uid()));
  end if;
  return new;
end;
$$;

create trigger categories_log_group
  after update on public.categories
  for each row execute function public.log_category_group_change();


-- ---------------------------------------------------------------------------
-- 7. The write paths
--
-- Four functions, one rule: ask public.is_shop_admin() first. The predicate
-- is the one from 0003 and stays the single authorization question in the
-- system — despite its name it is the general SkyIsles administrator today
-- (ADR-0039), and renaming a predicate that three shop functions already
-- depend on would be risk without gain.
--
-- security definer because clients hold no write privilege on any of these
-- tables and must not be given one: a grant would open every column,
-- including the ones the import owns.
--
-- `set search_path = ''` plus fully qualified names, exactly like 0003.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_catalog_visible(
  p_sky_id  text,
  p_visible boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  update public.skylanders set catalog_visible = p_visible where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.admin_set_display_name_override(
  p_sky_id text,
  p_value  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if not public.is_shop_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  -- An empty string is how a form says "reset": it becomes NULL, and NULL
  -- means the derived name applies again. The CHECK would reject '' anyway;
  -- turning it into a reset is friendlier than an error.
  update public.skylanders set display_name_override = v_clean where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.admin_set_admin_note(
  p_sky_id text,
  p_value  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if not public.is_shop_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.skylanders where sky_id = p_sky_id) then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;

  if v_clean is null then
    -- An emptied note leaves no row behind. The journal keeps the history.
    delete from public.catalog_editorial where sky_id = p_sky_id;
  else
    insert into public.catalog_editorial (sky_id, admin_note, updated_at)
    values (p_sky_id, v_clean, now())
    on conflict (sky_id)
      do update set admin_note = excluded.admin_note, updated_at = now();
  end if;
end;
$$;

create or replace function public.admin_set_catalog_group(
  p_category_id bigint,
  p_group       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_group, '')), '');
begin
  if not public.is_shop_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  -- The CHECK constraint is the vocabulary. Repeating the ten values here
  -- would be a second list to keep in step.
  update public.categories set catalog_group = v_clean where id = p_category_id;

  if not found then
    raise exception 'unknown category %', p_category_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- Reading the journal is an admin question too.
create or replace function public.admin_catalog_changes(
  p_entity    text,
  p_entity_id text,
  p_limit     integer default 20
)
returns table (
  field      text,
  old_value  text,
  new_value  text,
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
    select c.field, c.old_value, c.new_value, c.changed_at
      from public.catalog_admin_changes c
     where c.entity = p_entity
       and c.entity_id = p_entity_id
     order by c.changed_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 200);
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. Privileges and row level security
--
-- Postgres grants EXECUTE to PUBLIC on every new function, and Supabase
-- grants ALL on every new table to anon, authenticated and service_role
-- through ALTER DEFAULT PRIVILEGES. Both defaults are wrong here, so both are
-- revoked explicitly — GRANT is additive and removes nothing.
--
-- Note what is NOT granted: no client role gains any privilege on skylanders
-- or categories. The editorial columns are therefore closed for exactly the
-- same reason the imported ones are, and the functions above are the only
-- door — with is_shop_admin() as its lock.
--
-- catalog_editorial is the one table an administrator reads directly. Two
-- independent locks: `anon` holds no privilege at all, and `authenticated`
-- holds SELECT but meets a policy that asks is_shop_admin(). Either one alone
-- would be enough; both together mean a mistake in one is not a leak.
-- ---------------------------------------------------------------------------
revoke all on function public.admin_set_catalog_visible(text, boolean)      from public, anon;
revoke all on function public.admin_set_display_name_override(text, text)   from public, anon;
revoke all on function public.admin_set_admin_note(text, text)              from public, anon;
revoke all on function public.admin_set_catalog_group(bigint, text)         from public, anon;
revoke all on function public.admin_catalog_changes(text, text, integer)    from public, anon;

grant execute on function public.admin_set_catalog_visible(text, boolean)    to authenticated;
grant execute on function public.admin_set_display_name_override(text, text) to authenticated;
grant execute on function public.admin_set_admin_note(text, text)            to authenticated;
grant execute on function public.admin_set_catalog_group(bigint, text)       to authenticated;
grant execute on function public.admin_catalog_changes(text, text, integer)  to authenticated;

-- The journal: RLS on, no policy, no privilege. Unreachable for clients in
-- both directions; admins read it through the function above.
alter table public.catalog_admin_changes enable row level security;
revoke all on public.catalog_admin_changes from anon, authenticated;

-- The internal notes: readable by an administrator, invisible to everyone
-- else, writable by nobody through the API.
alter table public.catalog_editorial enable row level security;
revoke all on public.catalog_editorial from anon, authenticated;
grant select on public.catalog_editorial to authenticated;

create policy catalog_editorial_select_admin on public.catalog_editorial
  for select to authenticated
  using (public.is_shop_admin());
