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
/*
 * THE CANVAS MOVED (V3.5).
 *
 * 1024×1536 for as long as the card was `silver` or `gold`. The six artworks
 * that replaced them are 1007×1562 — a different ratio (0.6447 against
 * 0.6667), not a rescale — so every number below was re-derived against the
 * new box rather than converted from the old one. `build-card-templates.mts`
 * asserts the source size, so an artwork delivered at the old dimensions
 * stops the build instead of silently shifting every slot.
 */
export const CARD_CANVAS = { width: 1007, height: 1562 } as const;
export const CARD_ASPECT = "1007 / 1562";

/** A zone as CSS insets, in percent of the canvas. */
import type { CardType } from "@/lib/catalog/card-type";

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
  /* 0.78 until fix round 1. The two rows below it were sitting high against
     the artwork, so this gained 2.00 and `frame-bottom` gave the same 2.00
     back — market value stays exactly where it was, meta and trade move down
     together, and the nine rows still account for 100 %. A first, deliberately
     small correction; the browser decides whether it is enough. */
  { area: "sep", height: 2.78 },
  { area: "meta", height: 7.75 },
  { area: "trade", height: 9.05 },
  /* 6.47, not 6.46: the nine rows summed to 99.99 before this release and
     the tolerance absorbed it. Since one of them was being changed anyway,
     the missing hundredth is given back here and the card is whole. */
  { area: "frame-bottom", height: 6.47 },
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
/*
 * THE HORIZONTAL INSETS, NOW ACTUALLY IN FORCE (fix round 1).
 *
 * These were declared here and ignored: `figure-card.tsx` imported `INSET`
 * and then wrote `px-[10.8%]`, `px-[13%]` and `px-[10%]` as literals, so this
 * object was documentation with a lint warning attached. V3.5 changed the
 * numbers and nothing moved, which is how it was noticed.
 *
 * The values below are the ones that were EFFECTIVELY rendering — the
 * literals, not the V3.5 declarations — because that is the geometry the
 * browser showed and the operator approved. Adopting the declared 9.6 % and
 * 12 % would have moved a layout that was just signed off, for no reason
 * anybody asked for.
 *
 * They are applied as inline styles rather than classes: a Tailwind arbitrary
 * value has to be a literal in the source to be generated at all, so
 * `px-[${INSET.image}]` would produce no CSS. An inline style carries the
 * value itself, which is the same remedy the commerce surface uses.
 */
/**
 * HOW FAR THE FIGURE'S NAME SITS BELOW THE CENTRE OF ITS ROW (V3.6).
 *
 * The name is centred in a row 10.48 % of the card tall. A two-line name —
 * "Elite Boomer - ohne OVP" is the one that showed it — very nearly fills
 * that row, so its first line ends up hard against the frame under the image
 * window with no air at all.
 *
 * A TRANSFORM, NOT PADDING. Padding would shrink a box the long names already
 * fill and could clip the second line; a translate moves what is drawn and
 * nothing that is measured. What it moves into is the top of the market row,
 * which is empty by construction — that row is `justify-end`, so its content
 * sits at its foot.
 *
 * Deliberately small. 2 % of the card's width is about four pixels on a
 * phone's two-column grid, which is the "kleines Stück" this was asked for
 * and not a layout change. ONE value for all six card types; this is the only
 * number to touch if it should sit lower still.
 */
export const NAME_DROP = "2cqw";

export const INSET = {
  /** The window. */
  image: "10.8%",
  /** The paper: name, market value, meta. */
  text: "13%",
  /** The trade row. */
  trade: "10%",
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
/*
 * MEASURED, NOT CONVERTED (V3.5).
 *
 * MEASURED TWICE, AND THE SECOND TIME PROPERLY (V3.6).
 *
 * The first reading walked the artworks' CENTRE AXIS and found the window at
 * y 125…791 — comfortably inside a fill that started at 116. The browser
 * disagreed: a thin transparent strip showed along the top of the window on
 * five of the six cards.
 *
 * The centre axis is not where the window is highest. Every artwork has an
 * ornamented head — a point or diamond over the middle of the frame — and the
 * hole follows it upward. Read column by column instead of down one line, the
 *true extrema are:
 *
 *   card 99   chase 99   special 103   dark 103   legendary 103   prestige 141
 *
 * So the old top of 116 cut 17 px off the deepest notch, and that notch was
 * exactly the strip that showed. Horizontally and at the foot the old values
 * were never in doubt: x 83…923 against a fill of 76…930, and the hole ends
 * at 819 against a fill reaching 916.
 *
 * THIS RECTANGLE IS THE UNION PLUS OVERSCAN, NOT THE INTERSECTION. The
 * artwork sits ON TOP of the fill and masks it, so a fill that is too large
 * costs nothing and leaves no seam; a fill that is too small leaves a hole in
 * the card. The top is now 80 — 19 px above the deepest notch, and 30 px
 * below the row where `prestige`'s frame stops being opaque across the whole
 * band, which is the point past which white would start showing OUTSIDE the
 * card. Both margins were measured, not guessed.
 *
 * Taking the intersection instead would shrink the picture on five artworks
 * to accommodate the one with the tallest ornament, and that one is meant to
 * cover more of the figure.
 */
export const WINDOW_FILL = zone(76, 930, 80, 836);

/**
 * Layout debugging.
 *
 * Set to `true` — or pass `data-card-layout-debug` by hand in devtools — to
 * paint every slot so the geometry can be checked against the artwork in the
 * browser. The attribute is simply absent otherwise, so production rendering
 * is byte-identical with this off.
 */
export const LAYOUT_DEBUG = false;

/** One artwork: the 640 px file and the 400 px one beside it. */
export type CardArtwork = { src: string; small: string };

const art = (name: string): CardArtwork => ({
  src: `/images/cards/${name}.webp`,
  small: `/images/cards/${name}-sm.webp`,
});

/**
 * WHICH CARD A FIGURE IS PRINTED ON (V3.6).
 *
 * One artwork per card type. That is the whole mapping now.
 *
 * WHAT THIS REPLACED, AND WHY. Until V3.6 every type carried a PAIR — the
 * card, and a second "collected" card drawn for owners. The pairs were built,
 * shipped, and never used: their frames and windows sat a few pixels apart, so
 * collecting a figure made the card and the figure inside it appear to jump,
 * and a state change must not move the thing it is a state of. The operator
 * abandoned the idea and removed the source PNGs; the switch that held it back
 * (`USE_COLLECTED_ARTWORK`) is gone with it, because a flag nobody will ever
 * set is just a second state to reason about.
 *
 * OWNERSHIP IS NOW FULLY ORTHOGONAL. It draws `OWNERSHIP_OVERLAY` on top of
 * whichever card this returns and changes nothing underneath — see
 * `components/catalog/collected-seal.tsx`. There is no owned/unowned artwork,
 * no `collection` card type, and no file that means "mine".
 *
 * Typed as a total `Record`, so a seventh card type cannot join `CARD_TYPES`
 * without its artwork: the compiler asks for it.
 */
export const CARD_ARTWORK: Readonly<Record<CardType, CardArtwork>> = {
  standard: art("card"),
  special: art("special"),
  elite: art("elite"),
  dark: art("dark"),
  legendary: art("legendary"),
  chase: art("chase"),
  prestige: art("prestige"),
};

/**
 * The mark drawn over an owned figure's card.
 *
 * Not a card type and not in `CARD_ARTWORK`: it is square where the cards are
 * 1007 × 1562, it is drawn on top rather than underneath, and it is the same
 * file for every type. Keeping it out of that record is what stops it from
 * ever being reachable as `artworkFor(...)`.
 */
export const OWNERSHIP_OVERLAY: CardArtwork = art("collected");

/**
 * The golden aura drawn BEHIND an owned figure's card.
 *
 * Same canvas as the cards, so it needs no geometry of its own: centre it and
 * scale it, and it lines up by construction. It is a finished PNG with its
 * own alpha — there is no CSS glow, no `box-shadow` and no filter anywhere
 * near it, because the light has a shape the artwork draws and a rectangle
 * with a blur does not.
 *
 * Kept out of `CARD_ARTWORK` for the same reason as the seal above: it is not
 * a card a figure can be printed on, and it must never be reachable through
 * `artworkFor(...)`.
 */
export const COLLECTED_GLOW: CardArtwork = art("collected.layer");

/**
 * How much bigger than the card the glow is drawn — MEASURED, not guessed.
 *
 * TWO NUMBERS, BECAUSE THE ARTWORK IS NOT EVENLY THICK.
 *
 * The layer is a RING, and what the eye reads is its bright band, not its
 * faint tail. The card edge therefore has to land INSIDE that band. Measured
 * on the shipped derivative, in canvas pixels (1007 × 1562):
 *
 *   bright band (alpha > 200)   left 46–107   top 79–134
 *   content     (alpha > 10)    x 30–976      y 74–1487
 *
 * A layer drawn at scale S puts the card's left edge at `1007 · (1 − 1/S) / 2`
 * and its top edge at `1562 · (1 − 1/S) / 2`; one canvas pixel is then
 * `S · cardWidth / 1007` on screen, on both axes. With a single S that gave
 * 5.9 px of bright glow at the sides but 7.3 px above and below — the band is
 * simply drawn thicker there, and the uniform scale carried the difference
 * straight through.
 *
 * Solving that for the same 5.9 px of BAND gave Sy = 1.1512, and on screen it
 * still stood noticeably further out than the sides. The band was the wrong
 * target: what the eye reads at the top and bottom is the whole outer
 * contour, faint tail included, and that tail is drawn differently there than
 * at the sides. So Y is set from the rendered result rather than from the
 * alpha channel — the measurement above stays as the record of how the range
 * was found, not as the rule for this number.
 *
 * X stays at 1.16, which the operator judged correct at the sides and which
 * must not move. The difference between the axes is a deliberate, accepted
 * stretch of an abstract glow — the CARD is untouched by it, and both axes
 * stay centred, so nothing shifts up or down.
 *
 * Useful range for X, where the card edge stays inside the side band:
 * 1.11 – 1.19. Y is judged in the browser; lower it to pull the top and
 * bottom glow closer to the card edge.
 */
export const COLLECTED_GLOW_SCALE_X = 1.16;
export const COLLECTED_GLOW_SCALE_Y = 1.12;

/**
 * A hair to the right, because the artwork is not centred in its own canvas.
 *
 * The ring sat a little further from the left edge of the source than from
 * the right — the measured margins were 11 px and 5 px before normalising,
 * and cropping to the content box carried that asymmetry into the middle
 * rather than removing it. Scaled up by 1.16 it reads as a sliver of glow
 * standing out past the card's left edge that is not there on the right.
 *
 * So the LAYER moves, not the card: a small shift added to the centring
 * transform. `cqw` is one per cent of the card's own width — the card is the
 * `@container` — so this is a share of the card and not a fixed pixel count,
 * and it scales with every breakpoint exactly as the glow does. At the
 * catalog's ~220 px card, 0.45 cqw is about 1 px.
 *
 * It cannot move the card, the artwork or anything else: it lives inside the
 * glow's own `transform`, and the glow is a `pointer-events-none` image
 * behind everything.
 */
export const COLLECTED_GLOW_OFFSET_X = "0.45cqw";

/**
 * The card a figure is printed on.
 *
 * Takes the type and nothing else. Ownership used to be a second parameter
 * here; it is not a property of the card any more.
 */
export function artworkFor(cardType: CardType): CardArtwork {
  return CARD_ARTWORK[cardType];
}

/**
 * WHICH INK IS LEGIBLE ON WHICH ARTWORK (V3.5).
 *
 * Until now there was one ink — `--template-ink`, near-black, calibrated on
 * silver and gold, which are both light. The new artworks are not: measured
 * mean brightness of the flat text areas is 219 on `card` and 205 on
 * `prestige`/`collection`, but 36 on `dark` and 28 on `legendary`. Near-black
 * text on either of those is unreadable.
 *
 * So the ink is part of the artwork's description rather than a global
 * constant. `light` means dark ink on a bright card; `dark` means bright ink
 * on a dark one. The colours themselves stay tokens in `globals.css` — this
 * says which pair to use, never what they are.
 *
 * `chase` is ornamented rather than flat and has no measurable text ground.
 * It is given the dark-card pair, because its ornament is dense and bright
 * ink carries further across a busy surface than dark ink does. That is the
 * one entry here decided by judgement rather than by measurement, and it is
 * the first thing to check in a browser.
 *
 * This is a legibility fact, not a design role. Gold still means ownership,
 * silver trade, amber commerce; none of them is set from here.
 */
export type ArtworkTone = "light" | "dark";

export const ARTWORK_TONE: Readonly<Record<CardType, ArtworkTone>> = {
  standard: "light",
  special: "light",
  /* Measured on the artwork the operator delivered: the text area's mean
     brightness is 210, between `prestige` (205) and `special` (213). */
  elite: "light",
  dark: "dark",
  legendary: "dark",
  /*
   * LIGHT since V3.6, and it was wrong before.
   *
   * `chase.png` is a crystal artwork: bright, busy, and heavily textured. It
   * was entered as "dark" in V3.5 on the strength of how it looks rather than
   * what it measures, and the measurement disagrees — the mean brightness of
   * its text area is 225, the brightest of the six after `card` at 222. The
   * near-white on-dark ink was therefore painted onto near-white paper, and
   * the name, the market value and the price were close to invisible.
   *
   * The texture is what made this look like a judgement call. It is not: the
   * ink has to be legible against the surface it sits on, and that surface is
   * light.
   */
  chase: "light",
  prestige: "light",
};

/*
 * One tone per card type, for both of its cards.
 *
 * A collected artwork is the same card with an ownership treatment on it, not
 * a different design. The tone is
 * therefore a property of the type, not of the pair, and there is no second
 * table to keep in step. If a collected artwork ever needs the other ink, that
 * is a finding for the browser and a deliberate change here, not something to
 * guess at from the file size.
 */

/** The two grounds text lands on, read off the artwork. */
export const SURFACE = {
  /** The paper. silver.png #f3e8d5, gold.png #f7e8c6 — same luminance. */
  paper: "#f3e8d5",
  /** The plate. gold.png is the darker of the two, so contrast is measured on it. */
  plate: "#b8bcc3",
} as const;
