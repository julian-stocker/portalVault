/**
 * A special edition, as a banderole across the foot of the photograph
 * (UX-01C, ADR-0148).
 *
 * WHICH EDITIONS EXIST, AND IT IS NOT A JUDGEMENT CALL
 *
 * `skylanders.card_type` is the structured classification, and the database
 * restricts it by CHECK to exactly seven values (`0032`):
 *
 *     standard · special · elite · dark · legendary · chase · prestige
 *
 * It is editorial and permanent, and V3.6 settled that it is the ONLY thing
 * that decides how a figure is presented: "no `name.includes(…)` at render
 * time, no re-derivation from `parseVariant()`, no client-side guess — an
 * administrator's correction must outlive every later import and every later
 * rename." This component therefore reads the column through
 * `namesEdition()` and nothing else.
 *
 * WHAT IS DELIBERATELY ABSENT: a "Crystal" banner. There is no crystal card
 * type. Crystal finishes are carried by `chase` — whose artwork the build
 * describes as "a crystal artwork" — and the only Crystal vocabulary in the
 * project is `VARIANT_TOKENS` ("Clear Crystal", "Green Crystal", …), which is
 * matched against NAMES. Using it here would be the name-guessing that
 * ADR-0034 and V3.6 both forbid, so such a figure keeps its `chase` banner
 * and the finish stays part of what it is called.
 *
 * TWO TIERS, FROM THE RANK THAT ALREADY EXISTS
 *
 * `VariantSeal` solved this exact question for the vertical card: two inks,
 * both dark plates with a light edge so they read as stamped into the plate
 * rather than laid on it — Legendary ivory on near-black, "the one finish
 * collectors chase"; everything else a cool grey, quieter. The row keeps that
 * language and picks the tier from `EDITION_RANK`, the project's own
 * ordering, rather than from a new opinion.
 *
 * DELIBERATELY NOT GOLD, for the reason the seal gives: gold means
 * possession and an edition is a property of the OBJECT. A gold banner would
 * make an unowned Legendary look owned.
 *
 * WHERE IT SITS: absolutely, across the foot of the picture stage. It costs
 * the row NO height — the stage is a fixed square and the banner is inside
 * it — and it covers the bottom fifth, where a figure has its base rather
 * than its face. The photograph itself is untouched: no filter, no dimming,
 * no scaling.
 */
import { namesEdition } from "@/lib/catalog/card";
import { CARD_TYPE_LABELS, EDITION_RANK, type CardType } from "@/lib/catalog/card-type";

/**
 * The two plates, character for character the pair `variant-seal.tsx` uses.
 *
 * Copied rather than imported, and held against that file by a test so the
 * two cannot drift: the seal belongs to the card's artwork layer and this to
 * a row, and neither should have to import the other to stay in step. The
 * contrast was measured there, not here.
 */
const BRIGHT = "bg-[#241f19] text-[#f3e6c8]";
const QUIET = "bg-[#3a3442] text-[#ded7e8]";

/**
 * Which editions get the bright plate.
 *
 * `EDITION_RANK` is the project's own ordering of the chain
 * (`legendary > dark > special > standard`), with `chase` and `elite`
 * deliberately outside it. Taking the top of that chain gives Legendary and
 * Prestige the bright plate and leaves Dark, Special, Elite and Chase on the
 * quiet one — the same split `VariantSeal` makes, derived instead of
 * restated.
 */
const BRIGHT_FROM_RANK = 3;

export function isHeadlineEdition(cardType: CardType): boolean {
  return EDITION_RANK[cardType] >= BRIGHT_FROM_RANK;
}

export function EditionBanner({ cardType }: { cardType: CardType }) {
  /*
   * `standard` is what a figure is when nobody has said otherwise, so it gets
   * no banner — the same rule, and the same function, the row already uses to
   * decide whether an edition is worth naming at all.
   */
  if (!namesEdition(cardType)) return null;

  return (
    <span
      /*
       * Decorative to a screen reader: a row already carries the figure's
       * name, its ownership sentence and its element, and the edition is part
       * of what the figure IS rather than a state anybody acts on. One more
       * word between the picture and the name would be noise.
       *
       * `pointer-events-none` so the banderole never eats a tap meant for the
       * row's collect toggle underneath it.
       */
      aria-hidden="true"
      className={
        "pointer-events-none absolute inset-x-0 bottom-0 truncate px-1 text-center "
        + "font-mono text-[8px] leading-[13px] font-medium tracking-[0.08em] uppercase "
        /* One pixel of highlight inside a dark field is what makes a plate
           look pressed rather than laid on. No radius, no blur, no glow —
           the same treatment the variant seal uses. */
        + "shadow-[inset_0_1px_0_rgb(255_255_255/0.22)] "
        + (isHeadlineEdition(cardType) ? BRIGHT : QUIET)
      }
    >
      {CARD_TYPE_LABELS[cardType]}
    </span>
  );
}
