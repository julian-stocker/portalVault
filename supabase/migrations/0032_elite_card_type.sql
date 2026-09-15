-- ===========================================================================
-- 0032 - Eon's Elite is its own card, not a kind of special
--
-- WHY
--
-- `0031` gave the catalogue `special`, deliberately broad: "an additional
-- official FORM or EDITION of a base figure within the same series, when no
-- stronger mark applies". Eon's Elite went in there with LightCore, Granite,
-- Nitro and the seasonal releases, and at 42 of the 95 rows it was nearly
-- half of the category on its own.
--
-- It does not belong with them. LightCore is a way of building a figure and
-- Granite is a finish; Eon's Elite is a PRODUCT LINE — its own packaging, its
-- own card, its own shelf. The operator drew an artwork for it, which is the
-- point at which a category that shares a picture with four other things
-- stops being a category.
--
-- So it gets the seventh value. `special` keeps the 53 that are genuinely a
-- form of something, and stays a meaningful word.
--
-- WHAT DOES NOT MOVE
--
-- Nothing about PACKAGING. The line has three rows per figure - the Series 1
-- box, the Series 2 box, and the loose figure - and all 42 are Eon's Elite,
-- so all 42 get the card. Which of them a visitor may SEE is a different
-- question, answered by `catalog_visible`, owned by an administrator, and not
-- touched here: this file writes `card_type` and nothing else.
--
-- THIS FILE REQUIRES 0031
--
-- Every statement below is guarded on `card_type = 'special'`, which is what
-- 0031 set. On a database that has not had 0031 the 42 rows are still
-- 'standard', nothing matches, and nothing is written - the guard degrades to
-- a no-op rather than to a wrong answer. The release order is therefore
-- 0031 and THEN 0032, never the two merged and never 0032 alone.
--
-- Staging already has 0031. Production does not, as of 2026-09-15.
--
-- THE LIST IS EXPLICIT
--
-- 42 sky_ids, written out, the same 42 that 0031 named. No LIKE on 'Elite %':
-- that pattern would also be true of a figure who simply happens to be called
-- Elite something, and the difference between the two is exactly what a
-- curated list records and a pattern cannot.
--
-- ROLLBACK
--
-- Set the 42 back to 'special' and restore the six-value CHECK.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The vocabulary grows to seven
--
-- Dropped and re-added, as in 0031: PostgreSQL has no
-- `alter constraint ... check`. No row changes; all six existing values
-- satisfy the new constraint.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  drop constraint if exists skylanders_card_type_known;

alter table public.skylanders
  add constraint skylanders_card_type_known
    check (card_type in ('standard', 'special', 'elite', 'dark', 'legendary', 'chase', 'prestige'));

comment on column public.skylanders.card_type is
  'Which base artwork this figure is printed on (0030, sixth value in 0031, seventh in 0032). Editorial and permanent: standard | special | elite | dark | legendary | chase | prestige. When several EDITIONS apply the highest wins - legendary > dark > special > standard - and chase and elite sit outside that chain: chase is a finish rather than an edition, elite is a product line whose members come from a curated list. NOT ownership: collecting a figure draws an overlay and never writes here. NOT packaging either: Eon''s Elite has three rows per figure and all three are elite, while which of them is public is catalog_visible. Mirrors CARD_TYPES in lib/catalog/card-type.ts.';


-- ---------------------------------------------------------------------------
-- 2. The 42 Eon's Elite rows
--
-- Guarded on the value 0031 set, so a later administrator's correction is
-- never quietly overwritten and a database without 0031 is left alone.
--
-- All three packaging rows of each figure, because all three ARE Eon's Elite:
--   14 Series 1 boxes, 14 Series 2 boxes, 14 loose figures.
-- ---------------------------------------------------------------------------
update public.skylanders set card_type = 'elite'
 where card_type = 'special'
   and sky_id in (
    'SKY-0011', 'SKY-0012', 'SKY-0013', 'SKY-0017', 'SKY-0018', 'SKY-0019', 'SKY-0022',
    'SKY-0023', 'SKY-0024', 'SKY-0030', 'SKY-0031', 'SKY-0032', 'SKY-0035', 'SKY-0036',
    'SKY-0037', 'SKY-0040', 'SKY-0041', 'SKY-0042', 'SKY-0049', 'SKY-0050', 'SKY-0051',
    'SKY-0056', 'SKY-0057', 'SKY-0058', 'SKY-0060', 'SKY-0061', 'SKY-0062', 'SKY-0066',
    'SKY-0067', 'SKY-0068', 'SKY-0071', 'SKY-0072', 'SKY-0073', 'SKY-0075', 'SKY-0076',
    'SKY-0077', 'SKY-0083', 'SKY-0084', 'SKY-0085', 'SKY-0089', 'SKY-0090', 'SKY-0091'
   );


-- ---------------------------------------------------------------------------
-- 3. What this file deliberately does not do
--
-- No visibility. `catalog_visible` is an administrator's editorial decision
-- (ADR-0039) and is set through `admin_set_catalog_visible()`; writing it from
-- a migration would freeze a decision that is theirs to change. On production
-- the 28 OVP rows are already hidden and the 14 loose ones are not, which is
-- the intended state; staging has not received that decision and needs it made
-- the same way it was made on production - in the admin.
--
-- No names. The public name is derived at read time from
-- `lib/catalog/variant.ts`, which reads "Elite Boomer - ohne OVP" as
-- "Eon''s Elite Boomer" without `name` being touched - and `name` is written by
-- the catalogue import on every run, so a rewrite here would not survive one.
--
-- No RPC change. `admin_set_card_type()` carries no vocabulary of its own; the
-- CHECK above is the one list in the database.
-- ---------------------------------------------------------------------------
