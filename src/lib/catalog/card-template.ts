/**
 * The card templates, and where things sit on them.
 *
 * `designs/cards/silver.png` and `gold.png` are finished artwork: the frame,
 * the paper, the gold, the crown and the silver plate are all painted into the
 * asset. Nothing here draws any of that a second time — the card is the
 * picture, and this module only says where the dynamic parts go on top of it.
 *
 * MEASURED, NOT GUESSED
 *
 * Every number below was read off the two files. The opaque card body is
 * 921 px wide in both; the zones differ by at most 6 px, which at a rendered
 * 161 px card is 0.7 px. The values used are the INTERSECTION of the two, so
 * an overlay can never sit outside either template.
 *
 *   opaque body      silver  x 53–973  y 44–1472      gold  x 53–973  y 46–1472
 *   image window     silver  x 107–917 y 111–780      gold  x 111–914 y 114–775
 *   silver plate     silver  x 100–924 y 1273–1407    gold  x 103–921 y 1267–1406
 *
 * THE RENDER BOX IS THE FULL CANVAS, not the opaque body: the gold template's
 * glow extends past the frame on purpose, and clipping to the body would cut
 * it off. Both files are 1024 × 1536, so one box and one set of coordinates
 * serve both — which is what makes collecting a figure change the surface and
 * move nothing else.
 */

/** Both sources, and therefore the card's aspect ratio. 2:3 exactly. */
export const CARD_CANVAS = { width: 1024, height: 1536 } as const;
export const CARD_ASPECT = "1024 / 1536";

/** A zone as CSS insets, in percent of the canvas. */
export type Zone = { top: string; right: string; bottom: string; left: string };

const pct = (px: number, total: number) => `${((px / total) * 100).toFixed(3)}%`;

function zone(left: number, right: number, top: number, bottom: number): Zone {
  return {
    left: pct(left, CARD_CANVAS.width),
    right: pct(CARD_CANVAS.width - right, CARD_CANVAS.width),
    top: pct(top, CARD_CANVAS.height),
    bottom: pct(CARD_CANVAS.height - bottom, CARD_CANVAS.height),
  };
}

/**
 * THE ROW GRID — every band of the card, measured off the artwork.
 *
 * The decorative template decides where things go; this is that decision
 * written down. Nine rows that sum to exactly 100 %, so a slot cannot drift
 * and a long name cannot push anything below it.
 *
 *   frame-top       0.00 –  7.42 %   frame above the window
 *   image           7.42 – 50.46 %   the transparent window
 *   pad            50.46 – 51.95 %   air under it
 *   name           51.95 – 62.43 %   up to two lines
 *   market         62.43 – 73.96 %   MARKTWERT + price
 *   sep            73.96 – 74.74 %   the painted diamond rule
 *   meta           74.74 – 82.49 %   ownership + element
 *   trade          82.49 – 91.54 %   the silver plate
 *   frame-bottom   91.54 – 100.00 %  frame below it
 *
 * `pad` and `sep` carry nothing. They are rows rather than margins precisely
 * so that nothing can be nudged into them: `sep` is where the artwork paints
 * its ornament, and reserving it is what keeps text off it.
 *
 * Percentages, never pixels — the card is a fixed 2:3, so one grid serves
 * every width from 158 px to 236 px without a second layout.
 */
export const ROWS = [
  { area: "frame-top", height: 7.42 },
  { area: "image", height: 43.03 },
  { area: "pad", height: 1.5 },
  { area: "name", height: 10.48 },
  { area: "market", height: 11.52 },
  { area: "sep", height: 0.78 },
  { area: "meta", height: 7.75 },
  { area: "trade", height: 9.05 },
  { area: "frame-bottom", height: 8.46 },
] as const;

export type CardArea = (typeof ROWS)[number]["area"];

/** `grid-template-rows`, from the measurements above. */
export const GRID_ROWS = ROWS.map((r) => `${r.height}%`).join(" ");

/** `grid-template-areas`, one column, in DOM order. */
export const GRID_AREAS = ROWS.map((r) => `"${r.area}"`).join(" ");

/**
 * Side insets per slot, also measured.
 *
 * They differ because the artwork's own openings differ: the window is wider
 * than the text field, and the plate is wider than both.
 */
export const INSET = {
  /** The window, from the larger of the two holes plus its soft edge. */
  image: "10.8%",
  /** The paper. Inset further: the template's paper curls at the fold. */
  text: "13%",
  /** The silver plate. */
  trade: "10.1%",
} as const;

/**
 * The white that fills the window — DELIBERATELY LARGER THAN THE HOLE.
 *
 * The holes are not identical —
 *
 *   silver   fully transparent  x 108–917  y 111–780
 *   gold     fully transparent  x 111–914  y 114–774
 *
 * — so a white sized to the smaller left 3 px of the larger bare on the right
 * and 5 px at the foot, and the dark page showed through as a band along the
 * frame. Each hole also has a 3–10 px soft edge beyond that.
 *
 * This bleeds past both holes and past their feathering. The overshoot is
 * invisible: the template is drawn on top and is fully opaque there.
 */
export const WINDOW_FILL = zone(96, 929, 99, 793);

/**
 * Layout debugging.
 *
 * Set to `true` — or pass `data-card-layout-debug` by hand in devtools — to
 * paint every slot so the geometry can be checked against the artwork in the
 * browser. The attribute is simply absent otherwise, so production rendering
 * is byte-identical with this off.
 */
export const LAYOUT_DEBUG = false;

/**
 * The template files. `sm` is for a phone showing two columns.
 *
 * Named by state rather than by colour at the call site — `silver` and `gold`
 * are what the files are called, but what decides is possession.
 */
export const TEMPLATE = {
  owned: { src: "/images/cards/gold.webp", small: "/images/cards/gold-sm.webp" },
  plain: { src: "/images/cards/silver.webp", small: "/images/cards/silver-sm.webp" },
} as const;

/** The two grounds text lands on, read off the artwork. */
export const SURFACE = {
  /** The paper. silver.png #f3e8d5, gold.png #f7e8c6 — same luminance. */
  paper: "#f3e8d5",
  /** The plate. gold.png is the darker of the two, so contrast is measured on it. */
  plate: "#b8bcc3",
} as const;
