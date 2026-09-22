/**
 * The mark of something owned (V3.6).
 *
 * WHY IT EXISTS
 *
 * Ownership used to be the whole card: an owned figure was drawn on a second
 * artwork. That moved the card — the two files were never pixel-congruent, so
 * collecting a figure made the frame and the figure inside it appear to jump,
 * and a state change must not move the thing it is a state of. The artwork is
 * the same now whether or not anybody owns the figure, and this sits on top
 * of it. The pairs are gone from the design sources, from the build and from
 * `card-template.ts`; this is the only thing left that means "mine".
 *
 * WHY IT IS AN IMAGE AND NOT A DRAWING
 *
 * It was an inline SVG until V3.6 — a gold disc, a struck rim, a tick — drawn
 * here because no suitable artwork existed. One does now:
 * `designs/cards/collected.png`, built to WebP beside the six cards. A seal
 * that belongs to the same set of artworks as the cards should come from the
 * same place as the cards, and the operator can redraw it without touching
 * TypeScript.
 *
 * ONE POSITION, ONE SIZE, NO EXCEPTIONS. The geometry lives here rather than
 * at the call site, so it cannot acquire a per-card-type variant: this
 * component does not receive a card type and has nothing to branch on. What
 * it does receive it takes from `card-template.ts`, the file that already
 * owns every other measurement on this card. None of it changed in V3.6 —
 * the overlay is square, exactly as the box it replaces was.
 *
 * DECORATIVE. `◆ In deiner Sammlung` already says this in the meta row, in
 * words, where a screen reader and a forced-colours display both reach it.
 * `aria-hidden`, empty `alt`, and `pointer-events-none` so it never eats a
 * tap meant for the card beneath it.
 */

import { OWNERSHIP_OVERLAY, ROWS, WINDOW_FILL } from "@/lib/catalog/card-template";

/**
 * THE SIZE — one number, one axis.
 *
 * `cqw` because the card root is an `@container`: 1 cqw is 1 % of THIS card's
 * width, so the seal keeps its proportion in a two-column phone grid and a
 * five-column desktop one alike.
 *
 * Everything below is on the card's WIDTH, or derived from geometry that
 * already exists. Mixing the two axes is what put this in the wrong place
 * once already: the size was a share of the width while `top: 5%` is, per the
 * CSS box model, a share of the HEIGHT, and this card is 1562/1007 = 1.55×
 * taller than wide.
 */
const SIZE = "20.5cqw";

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
 * How far below that edge the seal's centre sits.
 *
 * It was centred exactly on the edge, which put half the medallion on the
 * frame and read as perched on the card's rim. Dropping the centre by a
 * stated amount leaves more of it on the white window and less on the top
 * border — the overlap is still there, it is simply weighted downward, and
 * the medallion reads as belonging to the picture rather than to the edge.
 *
 * 3 cqw in the first pass, 6 cqw now: the operator looked at it and wanted
 * the mark further from the top of the card and closer to the right of the
 * window. One value, in the card's own unit.
 */
const DROP = "6cqw";

/**
 * Centred on the window's top edge, then dropped.
 *
 * `calc` because the terms are deliberately on different axes — the edge
 * belongs to the card's HEIGHT, the seal's size and the drop to its WIDTH —
 * and this is the one place where that is stated instead of implied.
 */
const TOP = `calc(${WINDOW_TOP}% - ${SIZE} / 2 + ${DROP})`;

/** Midway between the window's outer edge and the card's. */
const RIGHT = `calc(${WINDOW_FILL.right} / 2)`;

/**
 * Top right of the figure inlay, straddling its frame (V3.6).
 *
 * The right offset is derived from `WINDOW_FILL.right` — the window's own
 * outer edge, read from the one place that measures it — rather than typed in
 * here. Three values, in order:
 *
 *   INSET.image        10.8 %   the image SLOT's padding. Left the medallion
 *                               floating inside the white, touching nothing.
 *   WINDOW_FILL.right   7.65 %  the window's outer edge. Reached the frame.
 *   half of that        3.82 %  where it sits now: the seal's right edge
 *                               lands midway between the window's edge and
 *                               the card's, so it covers the last of the
 *                               white, the whole frame beside it, and a
 *                               little of the border — and still ends 2 % of
 *                               the card short of the body's edge.
 *
 * Halving rather than picking a new number keeps the value tied to the
 * geometry: move the window and the medallion moves with it.
 *
 * A percentage in `right` resolves against the containing block's WIDTH, so
 * this really is the window's inset. The seal stays diagonally opposite the
 * variant badge at the foot of the window however long a variant's name gets.
 *
 * A plain `<img>` rather than `next/image`: the file is static, its size is
 * decided by CSS rather than by layout, and at roughly 38 px on screen the
 * 400 px `-sm` variant is already generous. A loader would add a request
 * shape and a wrapper for nothing.
 */
/**
 * OB DIE MARKE ÜBERHAUPT GEZEICHNET WIRD (V4.7).
 *
 * Seit der goldene Layer hinter einer gesammelten Karte liegt, übernimmt
 * dieser die Hervorhebung allein. Die Marke oben rechts wäre daneben eine
 * zweite Aussage über dieselbe Sache, und der Betreiber will das Ergebnis
 * zuerst ohne sie beurteilen.
 *
 * Ausgeschaltet, nicht ausgebaut: die Grafik, ihre Stelle in der
 * Asset-Pipeline, die Geometrie unten und die Aufrufstelle in der Karte
 * bleiben unverändert. Ein `true` hier bringt sie zurück, ohne dass
 * irgendetwas anderes angefasst werden muss.
 *
 * Nur die Besitzmarke. Das Abzeichen für Varianten ist eine andere
 * Komponente und bleibt unberührt, und „◆ In deiner Sammlung" steht
 * ohnehin im Text der Karte und nicht hier.
 */
const SHOW_OWNERSHIP_SEAL = false;

export function CollectedSeal() {
  if (!SHOW_OWNERSHIP_SEAL) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-20 block"
      style={{ top: TOP, right: RIGHT, width: SIZE, height: SIZE }}
    >
      {/*
       * A plain `<img>`, on purpose. `next/image` optimises images whose size
       * the layout decides; this one is 18 % of a container and is already
       * served at two widths from `public/`, so the loader would add a wrapper
       * and a request shape for nothing. At roughly 38 px on screen the 400 px
       * variant is generous, and the file never changes between viewers.
       */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={OWNERSHIP_OVERLAY.src}
        srcSet={`${OWNERSHIP_OVERLAY.small} 400w, ${OWNERSHIP_OVERLAY.src} 640w`}
        sizes="18cqw"
        alt=""
        decoding="async"
        className="h-full w-full object-contain"
      />
    </span>
  );
}
