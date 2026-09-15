-- ===========================================================================
-- 0031 - a sixth card, and the forms that belong on it
--
-- WHY
--
-- `0030` gave the catalogue five cards and classified 76 figures. It also said
-- what it was not: "Seasonal, event and edition variants - Easter, Halloween,
-- Royale, Nitro, Mystical - are real things this list has no word for. They
-- stay 'standard' until somebody decides otherwise."
--
-- Somebody decided otherwise. `special` is that word.
--
-- WHAT `special` MEANS
--
-- An additional official FORM or EDITION of a base figure within the same
-- series, when no stronger mark applies. LightCore, Eon's Elite, Nitro, Blue,
-- Power Blue, Mystical, Granite, the seasonal and event releases, and the
-- named one-offs - Punch Pop Fizz, Winterfest Lob Star, Ultimate Kaos and the
-- rest. It is deliberately broad: the alternative was a long tail of figures
-- printed on the plain card while visibly being something else.
--
-- WHEN SEVERAL MARKS APPLY, THE HIGHEST WINS
--
--     legendary  >  dark  >  special  >  standard
--
-- One row, one column, one value. SKY-0130 "Legendary Chill Light Core" is a
-- LightCore AND a Legendary; it stays `legendary`, and the LightCore survives
-- in what the figure is called rather than in what it is printed on. It is the
-- only figure in the catalogue where the rule has to decide anything today,
-- and it is deliberately absent from the list below.
--
-- `chase` SITS OUTSIDE THAT CHAIN
--
-- It answers a different question - the same figure in a different finish -
-- so it is not "stronger" or "weaker" than `special` and nothing here demotes
-- one to the other wholesale. Exactly ONE figure moves between them:
-- SKY-0117 "Crusher (Granite)". Granite is a named form the operator released
-- as `special`, and it was classified `chase` in 0030 before that word
-- existed. The other 29 chase figures - Crystal, Pearl, Jade, Glow, Scarlet,
-- Molten, Bronze, Metallic, Golden - are colour and material runs and stay
-- exactly where they are.
--
-- WHAT THIS FILE DOES NOT DO
--
-- It does not rename anything. The public display name is derived at read time
-- from `lib/catalog/variant.ts`, so "Crusher (Granite)" is shown as "Granite
-- Crusher" without `name` being touched - which matters, because `name` is
-- written by the catalogue import on every run and a rewrite here would be
-- silently undone. No slug moves, no character link moves, no commerce,
-- inventory, order, seller or collection row is read or written.
--
-- THE LIST IS EXPLICIT, AND SO IS ITS STARTING POINT
--
-- 95 sky_ids, written out. Each statement also names the value it expects to
-- find - `and card_type = 'standard'`, or `'chase'` for Granite - so a later
-- administrator's correction is never quietly overwritten by a re-run, and a
-- figure that has moved on its own is left alone rather than reset.
--
-- Forms: Elite 42 · LightCore 17 · Nitro 6 · Power Blue 3 · Blue 2 · Easter 2 · Mystical 2 · Birthday Bash 1 · Candy-Coated 1 · Egg Bomber 1 · Enchanted 1 · Frightful 1 · Gnarly 1 · Granite 1 · Halloween 1 · Hard Boiled 1 · Jingle Bell 1 · Jolly 1 · Kickoff 1 · Missile-Tow 1 · Punch 1 · Quick Draw 1 · Royale 1 · Solar Flare 1 · Spring Ahead 1 · Steel Plated 1 · Ultimate 1 · Winterfest 1.
--
-- ROLLBACK
--
-- Set the 95 ids back to their previous value and restore the five-value CHECK.
-- Nothing else is touched.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The vocabulary grows to six
--
-- Dropped and re-added rather than altered: PostgreSQL has no
-- `alter constraint ... check`, and this is why the column is text with a
-- CHECK instead of an enum (0030). No row changes; the old five all satisfy
-- the new constraint.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  drop constraint if exists skylanders_card_type_known;

alter table public.skylanders
  add constraint skylanders_card_type_known
    check (card_type in ('standard', 'special', 'dark', 'legendary', 'chase', 'prestige'));

comment on column public.skylanders.card_type is
  'Which base artwork this figure is printed on (0030, sixth value added in 0031). Editorial and permanent: standard | special | dark | legendary | chase | prestige. When several marks apply the highest wins - legendary > dark > special > standard - and chase sits outside that chain as a finish rather than an edition. NOT ownership: collecting a figure draws an overlay and never writes here, and there is no collection card type. NOT the variant system either: it changes no name, no slug and no sort order. Mirrors CARD_TYPES in lib/catalog/card-type.ts.';


-- ---------------------------------------------------------------------------
-- 2. The reclassification
--
-- Two statements, split by the value each expects to find, because they are
-- two different claims: 94 figures were never classified, and 1 was
-- classified before the word existed.
-- ---------------------------------------------------------------------------

-- 94 figures that have been 'standard' since 0030.
update public.skylanders set card_type = 'special'
 where card_type = 'standard'
   and sky_id in (
    'SKY-0009', 'SKY-0011', 'SKY-0012', 'SKY-0013', 'SKY-0017', 'SKY-0018', 'SKY-0019',
    'SKY-0022', 'SKY-0023', 'SKY-0024', 'SKY-0030', 'SKY-0031', 'SKY-0032', 'SKY-0035',
    'SKY-0036', 'SKY-0037', 'SKY-0040', 'SKY-0041', 'SKY-0042', 'SKY-0049', 'SKY-0050',
    'SKY-0051', 'SKY-0056', 'SKY-0057', 'SKY-0058', 'SKY-0060', 'SKY-0061', 'SKY-0062',
    'SKY-0066', 'SKY-0067', 'SKY-0068', 'SKY-0071', 'SKY-0072', 'SKY-0073', 'SKY-0075',
    'SKY-0076', 'SKY-0077', 'SKY-0083', 'SKY-0084', 'SKY-0085', 'SKY-0089', 'SKY-0090',
    'SKY-0091', 'SKY-0127', 'SKY-0129', 'SKY-0135', 'SKY-0140', 'SKY-0143', 'SKY-0144',
    'SKY-0146', 'SKY-0154', 'SKY-0157', 'SKY-0159', 'SKY-0166', 'SKY-0171', 'SKY-0218',
    'SKY-0222', 'SKY-0225', 'SKY-0232', 'SKY-0243', 'SKY-0244', 'SKY-0246', 'SKY-0247',
    'SKY-0251', 'SKY-0263', 'SKY-0265', 'SKY-0266', 'SKY-0294', 'SKY-0295', 'SKY-0296',
    'SKY-0320', 'SKY-0327', 'SKY-0329', 'SKY-0408', 'SKY-0420', 'SKY-0464', 'SKY-0469',
    'SKY-0471', 'SKY-0473', 'SKY-0483', 'SKY-0487', 'SKY-0492', 'SKY-0507', 'SKY-0509',
    'SKY-0521', 'SKY-0523', 'SKY-0525', 'SKY-0537', 'SKY-0540', 'SKY-0545', 'SKY-0549',
    'SKY-0552', 'SKY-0557', 'SKY-0574'
   );

-- SKY-0117 "Crusher (Granite)". The one figure that leaves chase.
update public.skylanders set card_type = 'special'
 where card_type = 'chase'
   and sky_id in (
    'SKY-0117'
   );

-- Prestige: still nothing, still on purpose. The type exists, has its own
-- artwork and is offered in the admin; no automatic rule assigns it.


-- ---------------------------------------------------------------------------
-- 3. Three public names that say nothing
--
-- `display_name_override` lets an administrator choose the public name instead
-- of the derived one. Three rows hold an override BYTE-IDENTICAL to `name`:
--
--   SKY-0011  'Elite Boomer - ohne OVP'
--   SKY-0012  'Elite Boomer'
--   SKY-0013  'Elite Boomer (2)'
--
-- They change no text. What they do change is that `withVariants()` returns
-- early for them, so the derivation never runs - a silent opt-out that looks
-- like a decision and is not one. None of the three would be touched by the
-- derivation anyway ("Elite" is not a variant token, and "(2)" is on the
-- explicit not-a-variant list), so clearing them is a no-op on screen and
-- removes a special case that would otherwise have to be reasoned about every
-- time the naming rules move.
--
-- Guarded on equality: an override that differs from the name is a real
-- editorial decision and is left alone. The other four are:
--
--   SKY-0280  'Horn Blast Whirwind (Clear Crystal)' -> 'Whirlwind (Clear Crystal)'
--             KEPT. It repairs a typo in the raw data. The derivation cannot:
--             the base "Horn Blast Whirwind" does not exist, because the real
--             figure (SKY-0279) is spelled "Whirlwind".
--   SKY-0370  'Mini Gnarly Barkley'        -> 'Mini Barkley (Gnarly)'
--   SKY-0379  'Mini Power Punsh Pet Vac'   -> 'Mini Pet Vac (Power Punsh)'
--   SKY-0386  'Mini Eggsellent Weeruptor'  -> 'Mini Weeruptor (Eggsellent)'
--             KEPT, and flagged. These three spell the OLD suffix convention
--             that V3.6 reverses, so they now read differently from every
--             other variant on the site. Clearing them would restore the
--             prefix form the operator asked for - and would also stop each
--             one sorting next to its base figure, because the base name is in
--             the middle of the raw name rather than at its end. That is a
--             trade-off for the operator to make, not a cleanup.
-- ---------------------------------------------------------------------------
update public.skylanders set display_name_override = null
 where display_name_override = name
   and sky_id in ('SKY-0011', 'SKY-0012', 'SKY-0013');


-- ---------------------------------------------------------------------------
-- 4. The RPC is unchanged
--
-- `admin_set_card_type()` from 0030 carries no vocabulary of its own - the
-- CHECK above is the one list in the database - so extending that list is the
-- whole of what it takes for an administrator to be able to choose `special`.
-- Nothing to alter, nothing to re-grant.
-- ---------------------------------------------------------------------------
