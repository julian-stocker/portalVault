/**
 * Where things sit on a figure ROW — and the arithmetic that proves it fits.
 *
 * WHY THIS IS A MODULE AND NOT A HANDFUL OF CLASS NAMES
 *
 * `card-template.ts` exists because the vertical card is placed on finished
 * artwork, and every number in it was read off a PNG. A row has no artwork,
 * so the temptation is to write the sizes straight into the markup and be
 * done. The reason not to is the one question a row has to answer and a card
 * does not:
 *
 *   > Does the name still have room on a 360 px phone, once the picture, the
 *   > hairline and the heart have taken theirs — and does the row stay FLAT?
 *
 * Both halves are arithmetic, not taste, and arithmetic belongs somewhere a
 * test can run it. `rowTextWidth()` and `rowHeight()` are the point of this
 * file: the tests compute the remaining width against the longest name the
 * real catalogue contains (`data/catalog/products.json`) and the resulting
 * height against the height this design replaced.
 *
 * FOUR COLUMNS, AND THE ORDER IS THE INFORMATION HIERARCHY
 *
 *   picture | hairline | name · edition · value · offer | heart
 *
 * The hairline is a column rather than a border so that it spans the row's
 * full height without anything having to know how tall the row became. The
 * heart is a column of its own rather than a corner of the text block, and
 * that is a geometric decision with a reason: its touch area is 44 px, the
 * offer sits at the bottom right of the text block, and two right-aligned
 * targets stacked inside one column would either overlap or force the row to
 * be 44 + 44 px tall. In its own column the heart's box can never meet the
 * offer's, whatever either one's height.
 *
 * THE CORRECTIONS, AND WHAT THEY CHANGED (UX-01C)
 *
 * The first row was 138 px tall on a phone, and most of that was air: a
 * 72 px picture, a separate 44 px offer band under it, and an action column
 * forced to 88 px to hold a slot for a bell that did not exist. All three
 * are gone. The offer moved INTO the text block's last line, the bell
 * reservation went away, and the picture now fits inside the height the text
 * needs anyway — so it grew back to 64 px without costing a pixel.
 *
 * The second pass spent 8 px of that back, deliberately: the offer is a pill
 * with a ground and a hairline now, and an action that looks like one gets
 * the full 44 px target. It was paid for out of the vertical padding (8 → 6)
 * and out of the element, which became a mark in front of the name instead
 * of a word on the meta line — which in turn freed the prominent position
 * under the name for the market value. 92 px with one line of name.
 */

/**
 * The measured geometry, in CSS pixels.
 *
 * These are the numbers the markup uses, written once. The component says
 * `px-2 py-1.5`, `gap-2 sm:gap-3`, `h-16 w-16 sm:h-18 sm:w-18`, `w-11` and
 * `min-h-11`, and a test holds those class names against these values — so
 * the two cannot drift apart without the drift being visible.
 */
export const ROW = {
  /**
   * Inside edge of the row. Tailwind `px-2 py-1.5`, at every width.
   *
   * TWO NUMBERS, BECAUSE THEY DO DIFFERENT WORK. The horizontal padding
   * competes with the name and the price line for width; the vertical one
   * competes with nothing and is pure height.
   *
   * BOTH ARE 6 px NOW. The horizontal one went from 8 to 6 to buy the price
   * line the width it needed for an ordinary amount to sit beside the offer
   * chip on a 360 px phone — together with the column gaps below, 10 px.
   */
  padX: 6,
  padY: 6,
  /** Between the four columns. Tailwind `gap-1.5` / `sm:gap-2.5`. */
  gap: 6,
  gapWide: 10,
  /**
   * The square picture stage.
   *
   * 64 px on a phone, and it is FREE: the text block needs 80 px anyway
   * (see `INFO_HEIGHT`), so anything up to 80 costs no height at all. That
   * is why the correction could make the row a third flatter and the picture
   * BIGGER at the same time.
   */
  image: 64,
  imageWide: 72,
  /** The hairline between picture and text. One pixel, its own column. */
  divider: 1,
  /**
   * One slot of the action bar, and the floor for every control on the row.
   *
   * 44 px is Apple's recommendation and the figure `FavoriteHeart` carries in
   * its own markup (`h-11 w-11`, held by `favorites/geometry.test.ts`). It is
   * also the floor the offer chip's touch target meets.
   *
   * IT WAS A COLUMN UNTIL UX-01D AND IS A BAR NOW. The heart used to stand in
   * a 44 px column at the row's far right, which took 50 px of width off the
   * text block for one control and left the rest of that column empty. The
   * marks moved up beside the name, the column went, and the width came back
   * to the name and to the price line — which is why the offer chip can now
   * reach the row's own edge.
   */
  touch: 44,
} as const;

/**
 * The TWO lines of the text block, in CSS pixels (UX-01D).
 *
 *   identity  the element's mark, the name, and the action bar. 44 px,
 *             because the bar's controls are 44 px — not because the name
 *             needs it. A name of one line is 16 and of two is 32, so BOTH
 *             fit inside the bar's own height and a long name costs the row
 *             nothing at all. That is the quiet win of moving the marks up
 *             here: the line that used to grow cannot any more.
 *   price     the `MARKTWERT` caption over its amount at the left, the
 *             series in the middle, the offer chip at the right edge. 44 px,
 *             because that is the chip's touch target; the caption and the
 *             amount together are 26 and sit inside it.
 *
 * THERE WERE THREE. The caption had a line of its own, 18 px above the
 * number it names and shared with the series. The operator asked for the two
 * to read as one piece of information, so they became one block — and the
 * row lost a line while gaining nothing in height.
 */
export const INFO = {
  /** The identity line — one bar slot tall. */
  identity: 44,
  /** One line of the name itself: 13 px at 1.2. Two are allowed. */
  name: 16,
  /**
   * The price line — 44 px, because that is the offer's touch target.
   *
   * THE VISIBLE CHIP IS 24 px AND THE TARGET IS 44, which the operator
   * allowed explicitly, twice. The ring and the ground are drawn by a layer
   * inset by 10 px top and bottom; the link fills the whole 44 and is what a
   * finger hits.
   */
  price: 44,
  /** Between the two lines. Tailwind `gap-0.5`. */
  gap: 2,
} as const;

/**
 * How much the visible chip is inset from its touch target, top and bottom.
 *
 * 10 px, so the chip reads as 24 px inside a 44 px target — one step tighter
 * than the first attempt's 9/26, because the operator asked for a chip and
 * not a pill.
 */
export const CHIP_INSET = 10;

/** The visible height of the offer chip — compact, as asked. */
export const CHIP_VISIBLE = INFO.price - 2 * CHIP_INSET;

/** How tall the text block is, which is what decides the row's height. */
export const INFO_HEIGHT = INFO.identity + INFO.gap + INFO.price;

/**
 * How wide the action bar is — because it costs WIDTH now, never height.
 *
 * Two marks today: the info link and the heart, 44 px each, side by side, so
 * their glyphs are 44 px apart and neither can be hit by accident. A third
 * arrives with UX-02's bell and takes another 44 px — from the name, which
 * is the only thing on that line able to give way.
 *
 * THE BELL IS COUNTED AT A FULL SLOT although it is not interactive yet, and
 * that is deliberate: UX-02 will make it a real control, and arithmetic that
 * assumed a decorative 20 px mark would have to be redone the day it works.
 * This is the one place where reserving is honest — it reserves a NUMBER for
 * a test to check, not a hole in the layout. Nothing holds space open on
 * screen: with no bell the bar is two slots wide and that is all.
 */
export function barWidth(withBell = false): number {
  return (withBell ? 3 : 2) * ROW.touch;
}

/**
 * The element's mark on the identity line — 14 px, and HISTORICAL.
 *
 * Removed from the tile at the operator's request (UX-01E correction): the
 * row showed the element as an abstract rune, a placeholder for artwork the
 * project does not have, and the top left is the name alone now. The number
 * stays as the measure of what the name gained — the mark and its gap were
 * 20 px, which is two and a half characters on the narrowest phone.
 *
 * `element-icon.tsx` itself stays, and no element data changed.
 */
export const ELEMENT_MARK_PX = 14;

/**
 * The gold diamond an owned row used to carry — 11 px, and HISTORICAL.
 *
 * Removed at UX-01E: ownership is the ground, the edge and the glow, and the
 * hidden sentence for anyone who cannot see them. Kept as a number so a test
 * can state that the identity line costs nothing for being owned.
 */
export const OWNED_DIAMOND_PX = 11;

/**
 * What is left for the NAME on the identity line.
 *
 * The element's mark, the diamond on an owned row, the bar, and a 6 px gap
 * between each (`gap-1.5`). The name is the only part that gives way: it is
 * `min-w-0` with `line-clamp-2`, so it clips at two lines with its full text
 * in `title` rather than pushing the bar anywhere.
 */
export function nameWidth(
  textWidth: number,
  { withBell = false }: { withBell?: boolean } = {},
): number {
  /*
   * THE NAME AND THE BAR, AND ONE GAP BETWEEN THEM. Two marks used to stand
   * before the name and both are gone: the gold diamond (UX-01E) and the
   * element's rune (UX-01E correction). So the identity line is the name, a
   * 6 px gap, and the bar — and the name is 20 px wider than it was an hour
   * ago, which is where the visible bell's 44 px partly came back from.
   */
  return textWidth - ROW.gap - barWidth(withBell);
}

/**
 * What the page itself takes off the viewport.
 *
 * Every catalogue surface wraps its content in `main … px-4`, on every width
 * (see `src/app/(public)/(catalog)/page.tsx`). 16 px a side, so a row on a
 * 360 px phone is 328 px wide and not 360.
 */
export const PAGE_PAD = 16;

/**
 * Picture, hairline, text — three since UX-01D.
 *
 * The heart's column was the fourth. It is a bar on the identity line now,
 * so the text block is the last column and runs to the row's inner edge.
 */
export const ROW_COLUMNS = 3;

/** The width of one row on a phone, where the list is a single column. */
export function phoneRowWidth(viewport: number): number {
  return viewport - 2 * PAGE_PAD;
}

/**
 * How tall a row is, for a name of one or two lines.
 *
 * The picture cannot make it taller unless it is taller than the text block,
 * which is the whole reason 64 px was affordable.
 */
export function rowHeight(nameLines = 1, wide = false, priceWraps = false): number {
  const image = wide ? ROW.imageWide : ROW.image;
  const wrapped = priceWraps ? AMOUNT_LINE + INFO.gap + 2 : 0;
  /*
   * THE NAME CANNOT MAKE THE ROW TALLER ANY MORE, and that is the point of
   * the identity line being a bar slot: one line of name is 16 px and two are
   * 32, both inside the bar's 44. `Math.max` rather than an addition is what
   * says so — and if a third line were ever allowed, this is the one place
   * that would start growing again.
   *
   * No `withBell` parameter either. The bell costs width now, not height
   * (`barWidth`), so a row with one is exactly as tall as a row without.
   */
  const identity = Math.max(INFO.identity, nameLines * INFO.name);
  const info = identity + INFO.gap + INFO.price + wrapped;
  return 2 * ROW.padY + Math.max(image, info);
}

/** The amount's own line, when the chip has wrapped off it. */
export const AMOUNT_LINE = 18;

/**
 * What the first row was, before the correction — kept as the yardstick.
 *
 * 8 + 8 padding, a 72 px picture beside a 50 px text stack, a 6 px gap and a
 * 44 px offer band of its own. The number is here so a test can state the
 * reduction instead of a report claiming it.
 */
export const PREVIOUS_ROW_HEIGHT = 2 * 8 + 72 + 6 + 44;

/**
 * What the row was at the end of UX-01C — the other yardstick.
 *
 * 92 px with a one-line name and 108 with two. UX-01D is 102 at BOTH, which
 * is 10 px more than the common case and 6 px less than the long one. The
 * trade is written down here so a test can state it: the row buys a reachable
 * info action, a heart that no longer costs a column, and a price line that
 * reaches the edge — for ten pixels, and for none at all on a long name.
 */
export const UX01C_ROW_HEIGHT = 92;
export const UX01C_ROW_HEIGHT_TWO_LINE = 108;

/**
 * What is left for the name, the edition, the value and the offer.
 *
 * Three columns and three gaps come off the row's inner width. The result is
 * the number that decides whether this design works at all: everything else
 * on the row has a fixed size, so the text block absorbs every width the
 * viewport happens to have.
 *
 * @param rowWidth  the outer width of the row itself, not of the viewport
 * @param wide      the `sm:` step — a larger picture and wider gaps
 */
export function rowTextWidth(rowWidth: number, wide = false): number {
  const gap = wide ? ROW.gapWide : ROW.gap;
  const image = wide ? ROW.imageWide : ROW.image;
  const gaps = (ROW_COLUMNS - 1) * gap;
  /* No `ROW.touch` here since UX-01D: the heart's column is a bar on the
     identity line, so the text block is the last column and the 44 px plus
     one gap it used to pay are the name's and the price line's now. */
  return rowWidth - 2 * ROW.padX - image - ROW.divider - gaps;
}

/**
 * What the longer of `OfferLink`'s two labels needs, in pixels.
 *
 * Measured in that component and written down in its own header: about
 * 101 px of text at 11 px, plus its 8 px of horizontal padding a side. Kept
 * here so the row's arithmetic can use the figure the offer line itself
 * states rather than a second estimate of it.
 */
export const OFFER_LABEL_PX = 101 + 2 * 8;

/**
 * What the `MARKTWERT` caption needs, in pixels.
 *
 * 8 px type with 0.08 em of tracking, which measures about 56 px. It no
 * longer sits beside the amount — since the operator's last decision it
 * stands ABOVE it, and this line it leaves behind is what the series and the
 * edition chip moved onto.
 */
export const MARKET_LABEL_PX = 56;

/**
 * What the edition chip needs at its longest, in pixels.
 *
 * "Legendary" at 10 px is about 50 px of text plus 12 px of padding.
 *
 * HISTORICAL SINCE UX-01C: the edition is a banderole across the foot of the
 * picture, inside a stage that is already there, so it takes no width on any
 * line. The number stays as the measure of what was reclaimed.
 */
export const EDITION_CHIP_PX = 50 + 12;

/**
 * What the amount needs at its widest, in pixels.
 *
 * "189,50 €" at 17 px semibold with tabular figures. The most expensive
 * figure in the catalogue is the yardstick, not an average one.
 */
export const AMOUNT_PX = 72;

/**
 * What an ORDINARY amount needs, in pixels.
 *
 * Up to two digits before the comma — "49,99 €" — at 17 px semibold with
 * tabular figures. This is the case that must fit beside the offer chip on
 * every phone, and `priceLineFits()` is where that is checked rather than
 * hoped.
 */
export const AMOUNT_ORDINARY_PX = 56;

/**
 * What the offer chip needs, in pixels — WHICH IS THE LABEL AND NOTHING MORE.
 *
 * `OfferLink` already carries `px-1.5 sm:px-2`, so the chip's wrapper adds no
 * horizontal padding of its own. The first attempt added 8 px a side on top,
 * which pushed the chip to 133 px and made the price line wrap on EVERY phone
 * row rather than only on the expensive ones. The arithmetic caught it; a
 * screenshot would have shown a wrapped line and looked merely unlucky.
 */
export const OFFER_CHIP_PX = OFFER_LABEL_PX;

/**
 * The compact label, in pixels — "ab 4,49 €" instead of "Angebote ab 4,49 €".
 *
 * Nine characters less at the offer line's own 11 px, which measures about
 * 6 px each, so 54 px come off the text and the padding stays. That is what
 * the series name on `/shop` gets, and it is why the chip can be at the edge
 * and the value at the left without either crowding the other.
 *
 * Phones only. From `sm:` the long label is back, and by then the row is wide
 * enough that `priceLineFits()` passes with it — which the test checks rather
 * than this comment claiming.
 */
export const OFFER_LABEL_SHORT_PX = 101 - 9 * 6;
export const OFFER_CHIP_COMPACT_PX = OFFER_LABEL_SHORT_PX + 2 * 8;

/**
 * The market-value block: the caption, or the amount, whichever is wider.
 *
 * They are stacked since UX-01D, so the block is as wide as its widest part
 * — not as wide as both. The caption is 56 px and an ordinary amount is 56
 * too, so an ordinary row is exactly the caption's width and only a
 * three-digit amount makes the block grow.
 */
export function marketBlockWidth(amount = AMOUNT_PX): number {
  return Math.max(MARKET_LABEL_PX, amount);
}

/**
 * Does the amount fit beside the offer chip, or does the chip wrap?
 *
 * THE FALLBACK IS A WRAP, NEVER A TRUNCATION AND NEVER A SMALLER PRICE —
 * the operator's instruction. This function is how a test states where the
 * boundary lies rather than a report claiming it.
 */
export function priceLineFits(
  textWidth: number,
  amount = AMOUNT_PX,
  chip = OFFER_CHIP_PX,
): boolean {
  return marketBlockWidth(amount) + ROW.gap + chip <= textWidth;
}

/**
 * How many characters of a name fit on one line of the text block.
 *
 * A DELIBERATELY PESSIMISTIC ESTIMATE, and it has to be: there is no browser
 * here to measure in, so the test needs an upper bound on the width of a
 * character rather than an average that a wide name would exceed.
 *
 * 0.56 em at the name's own 13 px is 7.28 px per character. The measured
 * average for this system stack at 13 px is nearer 6.4 px for mixed-case
 * Latin text, so every estimate below is conservative by about 12 % — which
 * is the direction an estimate used as a guarantee must err in.
 */
/**
 * 14 px since UX-01E — bigger and bolder, by one pixel and not two.
 *
 * The operator asked for a larger, clearly bold name. At 15 px a 360 px
 * phone tile with three marks in the bar holds nine characters a line
 * instead of ten, and the share of catalogue names that fit whole over two
 * lines falls from 82 % to 75 %. One pixel of type is not worth seven per
 * cent of names, so the weight does the rest of the work.
 */
export const NAME_FONT_PX = 14;
export const NAME_CHAR_RATIO = 0.56;

/** How many characters of the name fit on one line of a text block. */
export function nameCharsPerLine(textWidth: number): number {
  return Math.floor(textWidth / (NAME_FONT_PX * NAME_CHAR_RATIO));
}

/** The name is allowed two lines and clipped after them, like the card's. */
export const NAME_LINES = 2;

/**
 * The edition's strip under the picture — 13 px, one line of 8 px type.
 *
 * IT COSTS THE ROW NOTHING, which is the point of putting it here rather
 * than over the artwork: 64 px of picture plus 13 of strip is 77, and the
 * text block beside it needs 90 anyway. So a tile with an edition and a tile
 * without are the same height, and nothing has to be reserved for the
 * figures that have none.
 */
export const EDITION_STRIP = 13;

/** How tall the left column is, picture plus strip where there is one. */
export function imageColumnHeight(wide = false, withEdition = false): number {
  return (wide ? ROW.imageWide : ROW.image) + (withEdition ? EDITION_STRIP : 0);
}

/** The phone widths this design is held to. */
export const PHONE_WIDTHS = [360, 390, 414] as const;

/** The desktop widths UX-01E is held to, beside the phones. */
export const DESKTOP_WIDTHS = [768, 1024, 1280, 1600] as const;

/**
 * The container width at which a second column of rows is worth having.
 *
 * A CONTAINER QUERY AND NOT A VIEWPORT BREAKPOINT, because the question is
 * about the ROW's width and not the screen's — a row inside a narrower column
 * on some future page has the same problem a phone has.
 *
 * THE RULE: a row in two columns must never be narrower than a row on the
 * largest phone. That phone is 414 px and leaves the text block 237 px; the
 * row's fixed parts take 169 px at the `sm:` step, so a row needs 406 px to
 * match it, and two of those plus a 12 px gap is 824 px of container. 52 rem
 * is the next round number above that, and it splits into rows of 410 px with
 * 241 px of text block.
 *
 * So a tablet at 768 px stays one column — NOT because two would be unusable
 * there (193 px of text would work), but because they would be narrower than
 * the phone the design is tuned for, and a tablet is not a worse phone.
 */
/**
 * The gaps BETWEEN tiles — `gap-x-3 gap-y-2`, so 12 px across and 8 down.
 *
 * NOT `ROW.gapWide`, which is the gap between a row's own columns and happens
 * to be 10. The arithmetic borrowed that one once and was a pixel per column
 * out; two numbers that mean different things get two names.
 *
 * TWO VALUES BECAUSE THE TWO DIRECTIONS ARE DIFFERENT PROBLEMS. Side by side,
 * tiles need a seam the eye reads as a gutter; stacked, they are already
 * separated by their own grounds and edges, and 90 rows of catalogue are
 * shorter for the four pixels. Only the horizontal one enters the column
 * arithmetic, because that is the one `auto-fill` counts.
 */
export const GRID_GAP_X = 12;
export const GRID_GAP_Y = 8;

/** Kept under its old name for the callers that mean the column gap. */
export const GRID_GAP_WIDE = GRID_GAP_X;

/**
 * The narrowest and the widest a tile may be (UX-01E).
 *
 * `TILE_MIN` is derived, not chosen. A tile has to hold, at the `sm:` step:
 * 105 px of fixed parts (padding, picture, hairline, two gaps), a bar of
 * three 44 px marks where there is no offer, the element's mark and two
 * gaps, and a name wide enough to be worth setting in bold — about 102 px,
 * which is fourteen characters. That comes to 359, and 360 is the round
 * number above it.
 *
 * `TILE_MAX` answers the other half of the review: a single tile stretched
 * across a 736 px tablet was 102 px tall and seven times as wide. 520 keeps
 * the proportion under five to one, and the leftover goes to the margins
 * (`justify-center`) rather than into one over-long tile.
 */
export const TILE_MIN = 360;
export const TILE_MAX = 520;

/**
 * The most tiles that can ever stand side by side.
 *
 * THREE, AND THE PAGE IS WHY. `main` is `max-w-6xl`, so the container never
 * exceeds 1120 px, and a fourth tile would be 271 — far below `TILE_MIN`.
 * The number is therefore a consequence of the layout rather than a cap
 * anybody imposed, and `tileColumns()` is what enforces it.
 */
export const TILE_COLUMNS_MAX = 3;

/** `max-w-6xl` on the catalogue's `main`, in pixels. */
export const PAGE_MAX = 1152;

/**
 * The width the grid actually measures, for a given viewport.
 *
 * The page's own ceiling and its padding, in that order — which is why a
 * 1600 px screen lays out exactly like a 1280 px one.
 */
export function containerWidth(viewport: number): number {
  return Math.min(viewport, PAGE_MAX) - 2 * PAGE_PAD;
}

/**
 * How many tiles `repeat(auto-fill, minmax(min(TILE_MIN,100%), 1fr))` puts in
 * a row of this width.
 *
 * THE RULE THIS FUNCTION GOT WRONG ONCE, AND THE REASON THE TRACK'S MAXIMUM
 * IS `1fr`. `auto-fill` computes its repetition count from the track's
 * MAXIMUM sizing function whenever that maximum is definite, and only falls
 * back to the minimum when it is not. The first attempt wrote the tile's
 * 520 px ceiling into the track — `minmax(min(360px,100%), 520px)` — so the
 * browser counted 520 px tiles:
 *
 *     container 1120 → floor((1120+12) / 532) = 2
 *     container  968 → floor(( 968+12) / 532) = 1
 *
 * and three columns would have needed 1584 px of container, which the page's
 * `max-w-6xl` never gives. The catalogue therefore drew ONE centred tile on
 * a normal laptop — while THIS function, dividing by the minimum, said three.
 * The arithmetic was not wrong about the division; it was wrong about which
 * number the browser divides by, and so it confirmed the design instead of
 * catching it.
 *
 * With `1fr` as the maximum the count really is taken from the minimum, which
 * is what this computes. The ceiling moved to the tile (`FigureRow` carries
 * `max-w-[520px] mx-auto`), where it caps the WIDTH without touching the
 * COUNT.
 *
 * Never fewer than one: the `min(…, 100%)` is what keeps that single track
 * from overflowing a phone narrower than `TILE_MIN`.
 */
export function tileColumns(container: number): number {
  const fits = Math.floor((container + GRID_GAP_X) / (TILE_MIN + GRID_GAP_X));
  return Math.max(1, fits);
}

/**
 * How wide one TRACK is — the equal share of the row each tile is offered.
 *
 * `1fr` tracks take the whole container between them, so this is simply the
 * container less the gaps, divided by the count. It can exceed `TILE_MAX`,
 * and on a narrow desktop it does: a 600 px container is one track of 600.
 */
export function trackWidth(container: number): number {
  const columns = tileColumns(container);
  return (container - (columns - 1) * GRID_GAP_X) / columns;
}

/**
 * How wide the TILE inside that track ends up — the track, capped.
 *
 * The distinction is the whole of the bug fix: the track is what `auto-fill`
 * hands out and what decides the count; the tile is what the reader sees, and
 * it is never wider than `TILE_MAX`. A lone tile in a 600 px track is 520 and
 * centred in it; a tile in a three-column row is 365, because the track is.
 */
export function tileWidth(container: number): number {
  return Math.min(TILE_MAX, trackWidth(container));
}

export const TWO_COLUMN_AT_REM = 52;
export const TWO_COLUMN_AT_PX = TWO_COLUMN_AT_REM * 16;
