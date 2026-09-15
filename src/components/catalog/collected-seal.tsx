/**
 * The mark of something owned (V3.5, fix round 2).
 *
 * WHY IT EXISTS
 *
 * Ownership used to be the whole card: an owned figure was drawn on a second
 * artwork. That moved the card — the two files are not pixel-congruent, so
 * collecting a figure made the frame and the figure inside it appear to jump,
 * and a state change must not move the thing it is a state of. The artwork is
 * the same now whether or not anybody owns the figure, and this sits on top
 * of it.
 *
 * WHAT IT IS NOT
 *
 * Not the crown. `collected-crown.tsx` was removed in 297c67a and a test
 * keeps it removed; this is a different mark with a different shape, drawn
 * here rather than painted into an artwork so it sits in one place on all
 * five card types.
 *
 * Not a cart tick either. `CartCheckedGlyph` says "this is in your basket" in
 * commerce amber and `cart-toast.tsx` says "added" in trade silver — two
 * other sentences in two other colours. Gold means possession and nothing
 * else (V3.1), so gold is what this is.
 *
 * ONE POSITION, ONE SIZE, NO EXCEPTIONS. The geometry lives here rather than
 * at the call site, so it cannot acquire a per-card-type variant: this
 * component does not receive a card type and has nothing to branch on. What
 * it does receive it takes from `card-template.ts`, the file that already
 * owns every other measurement on this card.
 *
 * DECORATIVE. `◆ In deiner Sammlung` already says this in the meta row, in
 * words, where a screen reader and a forced-colours display both reach it.
 * `aria-hidden`, and `pointer-events-none` so it never eats a tap meant for
 * the card beneath it.
 */

import { INSET, ROWS } from "@/lib/catalog/card-template";

/**
 * A seal: gold disc, struck rim, dark tick.
 *
 * Three tokens, all from the ownership family, none of them new —
 * `--own-ink` is the gold of a collected state, `--own-ink-on-card` the
 * deeper gold that reads as the rim's shadow, and `--on-own` is measured at
 * 8.5:1 on the first of them, which is what makes the tick legible.
 */
function SealGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-full w-full">
      {/* The disc. */}
      <circle cx="12" cy="12" r="11" fill="var(--own-ink)" />
      {/* The struck rim — a seal has an edge, a checkbox does not. */}
      <circle
        cx="12"
        cy="12"
        r="11"
        fill="none"
        stroke="var(--own-ink-on-card)"
        strokeWidth="1.6"
      />
      {/* The impressed inner line, a hair inside the rim. Low opacity so it
          reads as depth at 26 px rather than as a second ring. */}
      <circle
        cx="12"
        cy="12"
        r="8.4"
        fill="none"
        stroke="var(--on-own)"
        strokeWidth="0.9"
        opacity="0.28"
      />
      {/* The tick. Heavy enough to survive being drawn small. */}
      <path
        d="m7.4 12.3 3.1 3.2 6.1-6.6"
        fill="none"
        stroke="var(--on-own)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * THE SIZE — one number, one axis (fix round 3).
 *
 * `cqw` is right and stays: the card root is an `@container`, so 1 cqw is
 * 1 % of THIS card's width and the seal keeps its proportion in a two-column
 * phone grid and a five-column desktop one alike.
 *
 * What was wrong in round 2 was not the unit but the MIXTURE of units. The
 * size was a share of the card's WIDTH (`12cqw`) while `top: 5%` is, per the
 * CSS box model, a share of the containing block's HEIGHT — and this card is
 * 1562/1007 = 1.55× taller than it is wide. So `5%` was really 7.76 % of the
 * width: the offset grew by half again behind the number, and the seal came
 * to rest inside the picture instead of on its upper edge. Two references,
 * two behaviours, one of them invisible in the source.
 *
 * Everything below is therefore on the card's WIDTH, or derived from the
 * geometry that already exists — no second set of measurements.
 */

/**
 * 18 % of the card's width — the operator's final value.
 *
 * It has been 12 % (too big, and mispositioned by the axis bug below), then
 * 9 % (correctly placed, too small once the position was right). 18 % is the
 * doubling asked for after seeing 9 % in the browser.
 *
 * Changing it moves nothing: `TOP` is derived from it, so the seal grows
 * symmetrically about its centre and that centre stays on the window's top
 * edge. This is the only number to touch if the size is judged again.
 */
const SIZE = "18cqw";

/**
 * The top edge of the image window, in per cent of the card's HEIGHT — the
 * rows above it, summed from the one list that defines them. Derived rather
 * than typed out, so it cannot fall out of step with `ROWS`.
 */
const WINDOW_TOP = ROWS.slice(
  0,
  ROWS.findIndex((row) => row.area === "image"),
).reduce((sum, row) => sum + row.height, 0);

/**
 * Centred on that edge: half the seal on the frame, half on the window, which
 * is the "aufgesetztes Siegel" the operator described. `calc` because the two
 * terms are deliberately on different axes here — the edge belongs to the
 * card's height, the seal's own size to its width — and this is the one place
 * where that is stated instead of implied.
 */
const TOP = `calc(${WINDOW_TOP}% - ${SIZE} / 2)`;

/**
 * Top right of the figure inlay.
 *
 * The right offset is `INSET.image` itself — the same value the window slot
 * pads with, not a copy of it — and a percentage in `right` resolves against
 * the containing block's WIDTH, so this really is the image inset. The seal
 * therefore lines up with the window's own margin, sits fully inside the
 * card, and stays diagonally opposite the variant badge at the foot of the
 * window however long a variant's name gets.
 *
 * Inline `style` rather than Tailwind classes because three of the four
 * values are computed from `ROWS` and `INSET`; an arbitrary-value class would
 * have to be a literal, which is exactly the duplication this avoids.
 */
export function CollectedSeal() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-20 block"
      style={{ top: TOP, right: INSET.image, width: SIZE, height: SIZE }}
    >
      <SealGlyph />
    </span>
  );
}
