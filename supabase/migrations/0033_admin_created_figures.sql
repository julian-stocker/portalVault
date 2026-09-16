-- ===========================================================================
-- 0033 - SkyIsles issues its own catalogue entries
--
-- WHY
--
-- Until now PortalVault could not create a figure. It validated SKY-IDs and
-- upserted what the legacy export carried, and ADR-0006 said so plainly:
-- catalogue maintenance stays in the legacy system for V1. New identities
-- came from `etl/assign_ids.py` and its ledger, whose high-water mark is 820.
--
-- ADR-0070 ends that for NEW figures. The legacy allocator is frozen, the
-- ledger stays the historical record, and SkyIsles issues from 821 onward.
-- Nothing about the 820 existing identities changes: they were issued the way
-- they were issued, and they keep their numbers forever.
--
-- THE NAMESPACE, WHICH IS THE WHOLE POINT OF THIS FILE
--
--   SKY-0001 - SKY-0820   historical, issued by the legacy project
--   SKY-0821 - SKY-8999   productive SkyIsles allocation range
--   SKY-9000 - SKY-9999   reserved system/test range
--
-- The reserved band exists because it is already occupied and cannot be
-- vacated: `SKY-9994` and `SKY-9998` carry inventory, orders, reservations
-- and journal rows on production, `SKY-9101` does on staging, and the verify
-- tools draw fixtures from 9001, 9002 and 9994-9999. A SKY-ID is immutable by
-- trigger and `order_lines.sky_id` is deliberately not a foreign key, so
-- renumbering them is not merely awkward - it is impossible without leaving
-- order lines pointing at nothing.
--
-- So the band is not cleaned up. It is DECLARED, and the allocator is stopped
-- below it. That turns "nobody will ever create eight thousand figures" from
-- a hope into a constraint.
--
-- THE FORMAT IS NOT THE RANGE
--
-- `skylanders_sky_id_format` stays `^SKY-[0-9]{4}$` and is NOT narrowed. It
-- describes what a SKY-ID may look like, and `SKY-9994` is a perfectly valid
-- SKY-ID. The 8999 ceiling is a rule about AUTOMATIC ISSUANCE and lives in
-- `admin_create_figure()`, where the decision is actually made. Confusing the
-- two would invalidate rows that are in daily use.
--
-- WHAT THIS FILE DOES NOT DO
--
-- No delete. No category creation. No character link - `character_id` stays
-- NULL on creation and curation stays where ADR-0034 put it. No market price:
-- that is still the legacy path (ADR-0007). No image: the picture is a second
-- phase against the storage bucket, under the SKY-ID this function returns.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. source - where a row came from, and nothing more
--
-- Provenance, not a class. Nothing in the product may branch on it: not
-- visibility, not permissions, not commerce, not which artwork is printed,
-- not ordering, not any other treatment. An admin-created figure is a
-- catalogue entry in exactly the sense an imported one is (ADR-0070).
--
-- It exists for two concrete jobs. The import can tell its own rows from
-- somebody else's, which is what stops every new figure from appearing in the
-- "in the database but not in the export" warning forever. And in five years
-- it is still answerable where SKY-0834 came from.
--
-- NOT NULL with a default, so the 602 existing rows become 'import' without a
-- backfill statement.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column if not exists source text not null default 'import';

alter table public.skylanders
  drop constraint if exists skylanders_source_known;

alter table public.skylanders
  add constraint skylanders_source_known
    check (source in ('import', 'admin'));

comment on column public.skylanders.source is
  'Provenance only (ADR-0070): import = came from the legacy export, admin = created in the admin catalogue. Never a permission, never a visibility, never a commerce or display rule - an admin-created row is as canonical as an imported one. The catalogue import must never name this column in its payload; src/lib/catalog/import-payload.test.ts pins that.';


-- ---------------------------------------------------------------------------
-- 2. sky_id_seq - the productive allocator
--
-- A sequence for the same reason `order_number_seq` is one (0010): `nextval`
-- is atomic, so two administrators pressing the button at the same moment
-- cannot receive the same identity, and it does NOT participate in rollback.
--
-- That last property is the requirement here, not a side effect. A SKY-ID is
-- permanent and is never recycled (ADR-0001). If a create fails on a
-- constraint, its number is spent and the next create takes the one after it.
-- A gap means "this number was drawn once", which is exactly true, and is the
-- same shape the legacy ledger has always had - 14 of the numbers below 820
-- are internal positions that never became public rows either.
--
-- START WITH 821: one past the legacy high-water mark of 820, verified
-- read-only against production and staging on 2026-09-16 - neither holds any
-- SKY-ID between 0821 and 8999.
-- ---------------------------------------------------------------------------
create sequence if not exists public.sky_id_seq as bigint start with 821 increment by 1;

comment on sequence public.sky_id_seq is
  'Feeds new SKY-IDs from 821 (ADR-0070). Monotonic, never reset, never recycled; a rolled back create leaves a gap on purpose. Drawn only by admin_create_figure(), which refuses anything above 8999 so the reserved system/test range 9000-9999 stays out of reach.';

-- Supabase grants USAGE on new sequences in `public` to anon and
-- authenticated. 0010 records what that costs: a caller who reaches a
-- sequence can burn numbers. Nothing outside the SECURITY DEFINER function
-- below needs this one.
revoke all on sequence public.sky_id_seq from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. The editorial journal learns two more fields
--
-- `created` is new. `card_type` closes a gap that has been open since 0030:
-- `admin_set_card_type()` has been writing an editorial column for three
-- migrations without anything recording it.
--
-- No backfill. The changes that were not journalled were not journalled; a
-- row invented now would claim a timestamp and an actor nobody knows.
-- ---------------------------------------------------------------------------
alter table public.catalog_admin_changes
  drop constraint if exists catalog_admin_changes_field_known;

alter table public.catalog_admin_changes
  add constraint catalog_admin_changes_field_known
    check (field in (
      'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
      'image_override_path', 'card_type', 'created'
    ));


-- ---------------------------------------------------------------------------
-- 4. card_type joins the trigger, not the RPC
--
-- ONE JOURNAL SOURCE PER MUTATION. The alternative was to log inside
-- `admin_set_card_type()`, which would cover exactly one caller: a service
-- role UPDATE, a future second RPC or a repair statement would all write the
-- column and leave no trace. The trigger sits on the table, so it cannot be
-- walked around.
--
-- It stays AFTER UPDATE. Creation is an INSERT, fires nothing here, and is
-- journalled once by `admin_create_figure()` as `created` - so a new figure
-- gets one entry rather than one per column.
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

  if new.image_override_path is distinct from old.image_override_path then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'image_override_path',
            old.image_override_path, new.image_override_path,
            (select auth.uid()));
  end if;

  if new.card_type is distinct from old.card_type then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'card_type',
            old.card_type, new.card_type,
            (select auth.uid()));
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. slugify() - the same rule as src/lib/catalog/slug.ts, in SQL
--
-- ADR-0011 fixes the rule; this is a second implementation of it, and a
-- second implementation is a liability unless it is held against the first.
-- `supabase/tests/0033_slug_parity.sql` runs both over the same fixtures, and
-- `src/lib/catalog/slug-sql-parity.test.ts` holds this body against the
-- TypeScript one step by step.
--
-- Why it has to exist at all: the uniqueness check and the INSERT must be one
-- statement sequence inside one transaction. Computing the slug in TypeScript
-- would mean reading the taken slugs, deciding, and then writing - the
-- read-then-write race the whole design is avoiding.
--
-- The steps are in the order the TypeScript uses them, and the order matters:
-- umlauts are spelled out BEFORE decomposition, or "ü" collapses to a bare
-- "u"; lowercasing happens AFTER the combining marks are gone; apostrophes
-- vanish before the separator pass, so "Spyro's" is "spyros" and not
-- "spyro-s".
-- ---------------------------------------------------------------------------
create or replace function public.slugify(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := coalesce(p_value, '');
begin
  -- 1. German umlauts are spelled out, matched case-insensitively.
  v := regexp_replace(v, 'ä', 'ae', 'gi');
  v := regexp_replace(v, 'ö', 'oe', 'gi');
  v := regexp_replace(v, 'ü', 'ue', 'gi');
  v := replace(v, 'ß', 'ss');
  v := replace(v, 'ẞ', 'ss');

  -- 2. Remaining diacritics: decompose, then drop the combining marks.
  --    The range is built with chr() rather than written out: U+0300-U+036F
  --    are invisible, and a source file that carries them literally is one
  --    careless editor away from losing them.
  v := normalize(v, NFKD);
  v := regexp_replace(v, '[' || chr(768) || '-' || chr(879) || ']', '', 'g');

  -- 3. Case.
  v := lower(v);

  -- 4. Apostrophes vanish without replacement - both the ASCII one and U+2019.
  v := regexp_replace(v, '[''’]', '', 'g');

  -- 5. Every remaining run of non-[a-z0-9] becomes one hyphen. Bracket
  --    characters disappear, their content survives: "Game (Xbox 360)"
  --    becomes "game-xbox-360".
  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');

  -- 6. Collapse, then trim.
  v := regexp_replace(v, '-{2,}', '-', 'g');
  v := regexp_replace(v, '^-+|-+$', '', 'g');

  return v;
end;
$$;

comment on function public.slugify(text) is
  'Normalises a name into slug form exactly as src/lib/catalog/slug.ts does (ADR-0011). Held against it by supabase/tests/0033_slug_parity.sql. No client needs it: the browser previews a slug with the TypeScript implementation and the database decides the real one.';

revoke all on function public.slugify(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. next_figure_slug() - the three-stage rule, against what is taken
--
-- ADR-0011, in order: the name, then the name qualified with the SERIES LABEL
-- ("drobot-giants", never "drobot-g"), then qualified once more with the
-- SKY-ID. Stage three has never fired against the real data and cannot
-- collide, because the SKY-ID is unique.
--
-- ONLY THE NEW SIDE IS EVER QUALIFIED. An existing slug is never recomputed
-- and never moved - that is the stability guarantee, and it is why this asks
-- what is taken rather than assigning a whole set the way a first import
-- does.
-- ---------------------------------------------------------------------------
create or replace function public.next_figure_slug(
  p_name        text,
  p_series_code text,
  p_sky_id      text
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_base   text := public.slugify(p_name);
  v_label  text;
  v_slug   text;
begin
  -- A name that survives normalisation as nothing at all would produce an
  -- empty slug, which the format CHECK rejects with a message about a
  -- constraint. Say what actually happened instead.
  if v_base = '' then
    raise exception 'name % yields an empty slug', p_name
      using errcode = 'check_violation';
  end if;

  v_slug := v_base;
  if not exists (select 1 from public.skylanders where slug = v_slug) then
    return v_slug;
  end if;

  select label into v_label from public.series where code = p_series_code;
  v_slug := v_base || '-' || public.slugify(coalesce(v_label, p_series_code));
  if not exists (select 1 from public.skylanders where slug = v_slug) then
    return v_slug;
  end if;

  return v_slug || '-' || public.slugify(p_sky_id);
end;
$$;

comment on function public.next_figure_slug(text, text, text) is
  'The next free slug for a figure, following ADR-0011: name, then name + series label, then + SKY-ID. Only the new figure is ever qualified; no existing slug is recomputed or moved.';

revoke all on function public.next_figure_slug(text, text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. admin_create_figure() - one transaction, or nothing
--
-- The V3.8 editor writes five fields with five calls and reports honestly
-- when four of them land. Creation does not get that excuse: there is no
-- useful state between "no figure" and "a figure", so this is one function
-- and one transaction. A constraint violation anywhere below rolls back the
-- row, the note and the journal entry together.
--
-- The one thing that does NOT roll back is the sequence value, and that is
-- deliberate - see section 2.
--
-- WHAT IT REFUSES TO TAKE
--
-- No sky_id: the caller does not get to choose an identity. No slug: derived.
-- No market price, no image_file, no image_override_path, no character_id.
-- Each of those belongs to somebody else - the legacy price path (ADR-0007),
-- the import (ADR-0009), the storage bucket (ADR-0046), the curated character
-- file (ADR-0034) - and a create that accepted them would be a quiet way to
-- write columns their owners maintain.
--
-- HIDDEN BY DEFAULT. A new figure is not public until an administrator says
-- so. The alternative publishes a half-described row to every visitor the
-- moment the button is pressed.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_figure(
  p_name                  text,
  p_series_code           text,
  p_category_id           bigint,
  p_card_type             text    default 'standard',
  p_catalog_visible       boolean default false,
  p_display_name_override text    default null,
  p_admin_note            text    default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text   := btrim(coalesce(p_name, ''));
  v_next     bigint;
  v_sky_id   text;
  v_slug     text;
  v_override text   := nullif(btrim(coalesce(p_display_name_override, '')), '');
  v_note     text   := nullif(btrim(coalesce(p_admin_note, '')), '');
begin
  if not public.is_shop_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_name = '' then
    raise exception 'a figure needs a name' using errcode = 'check_violation';
  end if;

  -- The identity, before anything is written.
  v_next := nextval('public.sky_id_seq');

  -- The productive range ends at 8999; 9000-9999 is the reserved system/test
  -- range and is not reachable by automatic issuance (ADR-0070). Stated here
  -- rather than left to the format CHECK, which would accept 9000 happily and
  -- collide with a fixture instead.
  if v_next > 8999 then
    raise exception
      'SKY-ID allocation range exhausted: % is beyond SKY-8999, and SKY-9000-9999 is the reserved system/test range (ADR-0070)',
      v_next
      using errcode = 'check_violation';
  end if;

  v_sky_id := 'SKY-' || lpad(v_next::text, 4, '0');
  v_slug   := public.next_figure_slug(v_name, p_series_code, v_sky_id);

  -- The composite foreign key decides whether the category belongs to the
  -- series. It is not re-asked here: one rule, in one place.
  insert into public.skylanders
    (sky_id, name, slug, series_code, category_id,
     card_type, catalog_visible, display_name_override, source, is_active)
  values
    (v_sky_id, v_name, v_slug, p_series_code, p_category_id,
     coalesce(nullif(btrim(coalesce(p_card_type, '')), ''), 'standard'),
     coalesce(p_catalog_visible, false), v_override, 'admin', true);

  -- Only when there is one. An empty row in catalog_editorial would be a note
  -- that says nothing, and its INSERT trigger would journal it as a change.
  if v_note is not null then
    insert into public.catalog_editorial (sky_id, admin_note)
    values (v_sky_id, v_note);
  end if;

  -- One entry for the creation. The editorial trigger is AFTER UPDATE and
  -- does not fire on this INSERT, so there is no second log of the same fact.
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', v_sky_id, 'created', null, v_name, (select auth.uid()));

  return v_sky_id;
end;
$$;

comment on function public.admin_create_figure(text, text, bigint, text, boolean, text, text) is
  'Creates a catalogue figure and returns its SKY-ID (ADR-0070). Administrators only. Atomic: row, note and journal entry commit together or not at all. Issues from public.sky_id_seq and refuses anything above SKY-8999. Writes source = admin, catalog_visible = false, character_id NULL, no price and no image - those belong to the import, the curated character file, the legacy price path and the storage bucket respectively.';

-- All three, not just PUBLIC: Supabase grants EXECUTE on every new function in
-- `public` to anon and authenticated explicitly, so revoking PUBLIC alone
-- leaves both in place (0010 records how that was found out).
revoke all on function public.admin_create_figure(text, text, bigint, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_create_figure(text, text, bigint, text, boolean, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 8. What is deliberately absent
--
-- No admin_delete_figure(). `collection_items` and `shop_inventory` are both
-- `on delete restrict`, and `order_lines.sky_id` is not a foreign key at all -
-- a delete is therefore either blocked or silently leaves order lines
-- pointing at a figure that no longer exists. A figure created by mistake is
-- set `catalog_visible = false` through the editor that already exists, and
-- its SKY-ID stays spent, which is what ADR-0001 requires.
--
-- No INSERT, UPDATE or DELETE grant on public.skylanders for any client role.
-- The revokes from 0001 stand; the only write path this migration opens is
-- the SECURITY DEFINER function above.
--
-- No category creation. Series and categories still come from the import, and
-- a create whose category does not exist is blocked rather than inventing a
-- free-text one.
-- ---------------------------------------------------------------------------
