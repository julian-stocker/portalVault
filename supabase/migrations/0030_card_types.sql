-- ===========================================================================
-- 0030 - a figure is printed on a card, and which card is editorial
--
-- WHY
--
-- Every figure card is drawn on one of two artworks: silver, or gold when the
-- viewer owns it. That is one axis doing two jobs. A Dark Spyro and an
-- ordinary Spyro are different collectibles and have always looked alike,
-- while "gold" says nothing about the figure and everything about who is
-- looking at it.
--
-- So the two are separated. `card_type` is a permanent editorial fact about
-- the collectible - standard, dark, legendary, chase, prestige - and decides
-- the base artwork. Ownership stays a per-viewer state that overrides the
-- artwork at render time and never touches this column.
--
-- WHAT THIS COLUMN IS NOT
--
-- Not ownership: there is no 'collection' card type, and collecting a figure
-- must never write here. The application draws `collection.webp` over any
-- card type; the column keeps saying what the figure is.
--
-- Not the variant system: `lib/catalog/variant.ts` decides how a figure is
-- NAMED and SORTED, and this migration changes no name, no slug, no override
-- and no character link. "Dark Spyro" is still called "Spyro (Dark)" on
-- screen after it becomes card_type 'dark', and a figure whose type an
-- administrator later changes keeps its name exactly as it is.
--
-- Not a complete taxonomy either. Seasonal, event and edition variants -
-- Easter, Halloween, Royale, Nitro, Mystical - are real things this list has
-- no word for. They stay 'standard' until somebody decides otherwise.
--
-- WHY text + CHECK AND NOT AN ENUM
--
-- Every closed value set in this schema is text with a CHECK constraint:
-- `categories.catalog_group`, `shop_inventory.condition`,
-- `order_lines.condition`, `commerce_settings.mode`. There is no
-- `create type ... as enum` anywhere. A CHECK is also the more movable of the
-- two for a list the operator expects to revisit: an enum value cannot be
-- removed, and `alter type ... add value` does not roll back cleanly.
--
-- THE BACKFILL IS A LIST, NOT A RULE
--
-- 76 identities, written out. No LIKE, no regex, no name matching - three
-- reasons:
--
--   The classification was derived in the application, where `parseVariant()`
--   already knows that a variant needs a base figure to be a variant OF. That
--   is what tells "Dark Spyro" (a variant of SKY-0053) from "Dark Pyramid" (a
--   trap whose name happens to start with the word). A LIKE pattern here
--   would be a second, cruder classifier disagreeing with the first.
--
--   A list is reviewable. Every id below was read and approved one by one
--   before this file existed.
--
--   And it is stable. A figure renamed next year keeps its card type, because
--   nothing here depends on what it is called.
--
-- Two of the ids carry typos in their names - SKY-0252 "Legendary Grim
-- Creemper" and SKY-0280 "Horn Blast Whirwind (Clear Crystal)". Both are
-- deliberately NOT corrected here: this migration classifies, it does not
-- edit names.
--
-- WHAT IS NOT BACKFILLED
--
-- Prestige. It is a valid type with its own artwork and the admin can set it,
-- but no automatic rule assigns it and no figure gets it here. The operator
-- wants to decide that one by hand.
--
-- ROLLBACK
--
-- `alter table public.skylanders drop column card_type;` and drop the
-- function below. Nothing else is touched, so there is nothing else to undo.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The column
--
-- NOT NULL with a default, so every existing row and every future import gets
-- 'standard' without the import having to know this column exists.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column if not exists card_type text not null default 'standard';

alter table public.skylanders
  drop constraint if exists skylanders_card_type_known;

alter table public.skylanders
  add constraint skylanders_card_type_known
    check (card_type in ('standard', 'dark', 'legendary', 'chase', 'prestige'));

comment on column public.skylanders.card_type is
  'Which base artwork this figure is printed on (0030). Editorial and permanent: standard | dark | legendary | chase | prestige. NOT ownership - collecting a figure overrides the artwork at render time and never writes here, and there is no collection card type. NOT the variant system either: it changes no name, no slug and no sort order. Mirrors CARD_TYPES in lib/catalog/card-type.ts.';


-- ---------------------------------------------------------------------------
-- 2. The backfill
--
-- `where card_type = 'standard'` on every statement: applying this file twice
-- writes nothing the second time, and an administrator's later correction is
-- never undone by a re-run.
-- ---------------------------------------------------------------------------

-- Dark variants: 21 figures.
update public.skylanders set card_type = 'dark'
 where card_type = 'standard'
   and sky_id in (
    'SKY-0054', 'SKY-0205', 'SKY-0240', 'SKY-0261', 'SKY-0284', 'SKY-0286', 'SKY-0288',
    'SKY-0333', 'SKY-0340', 'SKY-0355', 'SKY-0475', 'SKY-0485', 'SKY-0490', 'SKY-0494',
    'SKY-0500', 'SKY-0504', 'SKY-0511', 'SKY-0516', 'SKY-0559', 'SKY-0566', 'SKY-0580'
   );

-- Legendary variants: 25 figures.
update public.skylanders set card_type = 'legendary'
 where card_type = 'standard'
   and sky_id in (
    'SKY-0008', 'SKY-0016', 'SKY-0055', 'SKY-0070', 'SKY-0115', 'SKY-0130', 'SKY-0141',
    'SKY-0168', 'SKY-0174', 'SKY-0179', 'SKY-0215', 'SKY-0228', 'SKY-0252', 'SKY-0269',
    'SKY-0315', 'SKY-0322', 'SKY-0344', 'SKY-0349', 'SKY-0390', 'SKY-0462', 'SKY-0466',
    'SKY-0478', 'SKY-0527', 'SKY-0569', 'SKY-0577'
   );

-- Chase: a special colour or material finish of an existing figure - Crystal,
-- Pearl, Jade, Glow, Granite, Scarlet, Molten, Bronze, Metallic, Golden.
-- 30 figures. Seasonal and event editions are deliberately not in here.
update public.skylanders set card_type = 'chase'
 where card_type = 'standard'
   and sky_id in (
    'SKY-0027', 'SKY-0039', 'SKY-0044', 'SKY-0080', 'SKY-0082', 'SKY-0117', 'SKY-0121',
    'SKY-0123', 'SKY-0132', 'SKY-0134', 'SKY-0137', 'SKY-0138', 'SKY-0151', 'SKY-0161',
    'SKY-0163', 'SKY-0172', 'SKY-0176', 'SKY-0193', 'SKY-0211', 'SKY-0241', 'SKY-0258',
    'SKY-0275', 'SKY-0276', 'SKY-0277', 'SKY-0280', 'SKY-0331', 'SKY-0335', 'SKY-0337',
    'SKY-0512', 'SKY-0572'
   );

-- Prestige: nothing. Stated as a comment rather than as an empty statement so
-- the omission reads as a decision instead of an oversight.


-- ---------------------------------------------------------------------------
-- 3. Setting it by hand
--
-- The same shape as `admin_set_catalog_group()`: authorisation first, then the
-- row. Touches one column and nothing else - a card type is not a licence to
-- edit a figure, and `updated_at` belongs to the import rather than to an
-- editorial decision, which is why the three comparable mutations on this
-- table (`admin_set_catalog_visible`, `admin_set_display_name_override`,
-- `admin_set_image_override`) leave it alone as well.
--
-- THE CHECK CONSTRAINT IS THE VOCABULARY.
--
-- An earlier draft listed the five values here too, so that a typo came back
-- as a sentence instead of as a raw check violation. That is a second list to
-- keep in step, and `admin_set_catalog_group()` already refused the same
-- trade for the same reason. One list in the database, one in the
-- application, and a test that holds them against each other.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_card_type(
  p_sky_id    text,
  p_card_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Trimmed, not vetted. Whitespace is an accident of a form field; which
  -- words are card types is the constraint's business. An empty string
  -- reaches it and is refused there, with the value named.
  v_clean text := btrim(coalesce(p_card_type, ''));
begin
  if not public.is_shop_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  update public.skylanders set card_type = v_clean where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown figure %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.admin_set_card_type(text, text) is
  'Sets which base artwork a figure is printed on (0030). Administrators only. Writes card_type and nothing else - not the name, not an override, not the visibility, not updated_at. An unknown value is refused by skylanders_card_type_known, which is the one vocabulary in the database.';

revoke all on function public.admin_set_card_type(text, text) from public, anon;
grant  execute on function public.admin_set_card_type(text, text) to authenticated;
