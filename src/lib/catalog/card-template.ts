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
 * The alpha channel of all six artworks was read. Their windows agree
 * horizontally to within a pixel or two — x 83…85 to 909…923 — and disagree
 * at the top, because each one has an ornamented head that opens into the
 * full width at a different height:
 *
 *   card 125   dark 134   legendary 146   chase 153   prestige/collection 253
 *
 * The bottom agrees again: 773…791.
 *
 * This rectangle is the UNION plus a small overscan, not the intersection.
 * The artwork sits ON TOP of the image and masks it, so a fill that is
 * slightly too large costs nothing and leaves no seam — which is exactly what
 * the old value did (it was ~11 px wider than silver.png's actual hole).
 * Taking the intersection instead would shrink the picture on four artworks
 * to accommodate the two with the tallest ornament, and those two are meant
 * to cover more of the figure.
 */
export const WINDOW_FILL = zone(76, 930, 116, 800);

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

/** One artwork: the 640 px file and the 400 px one beside it. */
export type CardArtwork = { src: string; small: string };

/** The two cards a figure of one type can be printed on. */
export type CardArtworkPair = {
  /** Nobody owns it. */
  plain: CardArtwork;
  /** Somebody does. */
  collected: CardArtwork;
};

const pair = (name: string): CardArtworkPair => ({
  plain: { src: `/images/cards/${name}.webp`, small: `/images/cards/${name}-sm.webp` },
  collected: {
    src: `/images/cards/${name}.collected.webp`,
    small: `/images/cards/${name}.collected-sm.webp`,
  },
});

/**
 * WHICH CARD A FIGURE IS PRINTED ON (V3.5, revised in fix round 1).
 *
 * TWO AXES, STILL TWO. `card_type` says what the collectible is and never
 * changes; ownership picks which of that type's two cards is drawn. The
 * earlier version had one ownership artwork for all five types, which made
 * every owned figure look the same whatever it was — a Legendary in somebody's
 * collection stopped being visibly Legendary. Each type keeps its own identity
 * now, owned or not.
 *
 * Typed as a total `Record`, so a sixth card type cannot be added to
 * `CARD_TYPES` without both of its artworks: the compiler asks for them.
 *
 * `prestige.collected` exists and is, today, a byte-identical copy of
 * `prestige.png` — the operator's placeholder until the real artwork is
 * drawn. It is listed here like any other pair rather than being special-cased
 * in code: an owned Prestige figure therefore looks like an unowned one for
 * now, which is the intended interim state, and replacing the source PNG plus
 * one `npm run cards:build` is the entire migration to the final artwork. No
 * fallback branch to find and delete later.
 *
 * There is no `collection` entry and no collection artwork any more. Ownership
 * was never a card type and now has no file of its own either.
 */
export const CARD_ARTWORK: Readonly<Record<CardType, CardArtworkPair>> = {
  standard: pair("card"),
  dark: pair("dark"),
  legendary: pair("legendary"),
  chase: pair("chase"),
  prestige: pair("prestige"),
};

/**
 * WHETHER AN OWNED FIGURE GETS ITS OWN ARTWORK — currently: no.
 *
 * The five `.collected` artworks exist and are built, and `CARD_ARTWORK`
 * carries both halves of every pair. They are not drawn, because the two
 * halves are not pixel-for-pixel congruent: the window and the frame sit a
 * few pixels apart, so collecting a figure made the card and the figure
 * inside it appear to jump. A state change must not move the thing it is a
 * state of.
 *
 * Ownership is shown by an overlay on the plain card instead — same symbol,
 * same place, same size on all five types — so the artwork underneath never
 * changes and nothing shifts.
 *
 * This is a switch, not a deletion. The pairs stay mapped and stay built; the
 * day the artworks line up, this becomes `true` and nothing else has to be
 * rebuilt or remembered.
 */
export const USE_COLLECTED_ARTWORK = false;

/**
 * The card a figure is printed on, given its type and whether it is owned.
 *
 * One place, so the switch above cannot be half-applied: no component asks
 * the question a second time and no caller reaches into a pair directly.
 */
export function artworkFor(cardType: CardType, owned: boolean): CardArtwork {
  const artwork = CARD_ARTWORK[cardType];
  return owned && USE_COLLECTED_ARTWORK ? artwork.collected : artwork.plain;
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
  dark: "dark",
  legendary: "dark",
  chase: "dark",
  prestige: "light",
};

/*
 * One tone per card type, for both of its cards.
 *
 * A collected artwork is the same card with an ownership treatment on it, not
 * a different design — `dark.collected.png` is still dark stock. The tone is
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
