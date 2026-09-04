-- ===========================================================================
-- 0002 — characters
--
-- A Skylanders character is not the same thing as a collectible figure.
-- "Drobot" is one character; SKY-0028, SKY-0156 and SKY-0157 are three
-- separate collectible objects of that character, with three different market
-- prices. This migration adds the character as its own entity and links the
-- collectibles to it.
--
-- Three identities stay strictly apart (ADR-0034):
--   sky_id        identity of the collectible object — collection and shop
--                 hang off this, and only this
--   character_id  groups several collectibles into one character
--   display name  presentation only, derived at read time (ADR-0030)
--
-- Non-character objects — traps, vehicles, creation crystals, magic items —
-- keep character_id NULL. That is the normal case, not missing data.
--
-- Assignments are curated by hand in data/characters/characters.json and
-- applied by tools/import-characters.mts. Nothing here is derived from names
-- at runtime: the catalog contains "Fire Bone Hot Dog" (character: Hot Dog)
-- and "Mini Drobit" (character: Drobit, NOT Drobot), and no name rule gets
-- both of those right.
--
-- Additive only: one new table, one nullable column. No row is changed or
-- deleted, no type altered.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The character
-- ---------------------------------------------------------------------------
create table public.characters (
  id                bigint      generated always as identity primary key,

  -- An attribute, never a key. Relations hang off `id`, exactly as figure
  -- relations hang off sky_id and never off the slug (ADR-0011, ADR-0016).
  canonical_name    text        not null,

  -- NULL means "not reliably known", never "none" — the same rule that makes
  -- market_price nullable (ADR-0010). Kaos is the real case: as a Sensei he
  -- belongs to his own "Kaos" element, which is not one of the ten below, so
  -- his row stores NULL rather than a guess.
  element           text,
  species           text,
  role_type         text,

  -- SkyIsles writes its own short summary. No passage from any external
  -- source is copied. The length limit enforces that structurally rather
  -- than trusting a guideline: a pasted wiki article does not fit.
  short_description text,

  -- One primary source per character is enough for the pilot. A second
  -- source per field would be a bibliography, and no evidence says we need
  -- one yet.
  source_url        text,
  source_label      text,
  verified_at       date,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint characters_name_not_blank
    check (length(btrim(canonical_name)) > 0),

  -- The ten canonical elements. Light and Dark arrived with Trap Team, and
  -- both are in use by traps and creation crystals already.
  constraint characters_element_known
    check (element is null or element in (
      'Magic', 'Tech', 'Water', 'Fire', 'Life', 'Undead', 'Earth', 'Air',
      'Light', 'Dark'
    )),

  -- Product lines, not game mechanics. Lowercase because these are technical
  -- values, not display text — the German labels live in src/lib/i18n/de.ts.
  constraint characters_role_known
    check (role_type is null or role_type in (
      'core', 'giant', 'swapper', 'trap-master', 'supercharger', 'sensei',
      'mini', 'sidekick'
    )),

  constraint characters_description_short
    check (short_description is null or length(short_description) <= 600),

  -- A source reference that is not fetchable is not a source reference.
  constraint characters_source_url_https
    check (source_url is null or source_url like 'https://%')
);

comment on table public.characters is
  'Curated character metadata. Not fed by the catalog import; see tools/import-characters.mts.';

-- Duplicate guard, compared case-insensitively — the same construction as the
-- username rule (ADR-0020). It is an index, NOT a key: nothing references a
-- character by name.
create unique index characters_canonical_name_key
  on public.characters (lower(canonical_name));


-- ---------------------------------------------------------------------------
-- 2. The link
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column character_id bigint references public.characters (id) on delete restrict;

comment on column public.skylanders.character_id is
  'Curated. NULL for non-character objects and for figures not yet curated.';

-- Partial: today 104 of 600 rows carry a value, and only those are ever
-- looked up by it ("other figures of this character").
create index skylanders_character_id_idx
  on public.skylanders (character_id)
  where character_id is not null;


-- ---------------------------------------------------------------------------
-- 3. updated_at, like the four existing tables
-- ---------------------------------------------------------------------------
create trigger characters_set_updated_at
  before update on public.characters
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 4. Row Level Security
--
-- Character data is public product information: readable by everyone,
-- writable by no client. Same posture as the catalog itself (ADR-0016).
-- ---------------------------------------------------------------------------
alter table public.characters enable row level security;

create policy characters_select_all on public.characters
  for select to anon, authenticated
  using (true);

-- Deliberately no INSERT, UPDATE or DELETE policy. Curation runs through the
-- service role, which bypasses RLS — exactly like the catalog import. No
-- application role is introduced, and nothing is added to `profiles`, which
-- users can write to themselves.


-- ---------------------------------------------------------------------------
-- 5. Privileges
--
-- Supabase grants ALL to anon, authenticated and service_role on every new
-- table in `public` via ALTER DEFAULT PRIVILEGES, and GRANT is additive — so
-- the REVOKE below is required, not decorative.
--
-- TRUNCATE matters most: row level security does NOT apply to it, which makes
-- the table privilege the only thing between a client and an empty table.
-- ---------------------------------------------------------------------------
grant select on public.characters to anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.characters from anon, authenticated;

-- skylanders.character_id needs no separate grant: anon and authenticated
-- already hold SELECT only on that table, with everything else revoked
-- (migration 0001, section 7). The new column inherits that.
