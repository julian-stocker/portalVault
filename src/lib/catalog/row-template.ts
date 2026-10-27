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
   * The heart's column, and the floor for the controls in it.
   *
   * 44 px is Apple's recommendation and the figure `FavoriteHeart` carries
   * in its own markup (`h-11 w-11`, held by `favorites/geometry.test.ts`).
   * It is also the floor the offer's pill now meets.
   *
   * The column holds TWO positions on one x — the heart at the top, the
   * availability bell at the foot — but it reserves NOTHING: a row without a
   * bell is one slot tall, and only a row that actually carries one grows
   * (`ACTION_WITH_BELL`). A permanently empty 44 px was the single largest
   * piece of air the correction removed, and it must not come back.
   */
  touch: 44,
} as const;

/**
 * The three lines of the text block, in CSS pixels.
 *
 *   name   13 px at 1.2, with the element's mark in front of it — one line,
 *          two when a name is long
 *   label  the small `MARKTWERT` caption, and beside it the two softer facts:
 *          the series (or "not in the catalogue") and the edition chip
 *   price  the amount at 17 px, and the offer chip at the right. The chip's
 *          touch target is what sets this line's height
 */
export const INFO = {
  name: 16,
  /** The caption line. Its height comes from the edition chip, not the 8 px
   *  caption: 10 px of type plus `py-0.5` a side. */
  label: 16,
  /**
   * The price line — 44 px, because that is the offer's touch target.
   *
   * THE VISIBLE CHIP IS 26 px AND THE TARGET IS 44, which the operator
   * allowed explicitly. The ring and the ground are drawn by a layer inset
   * by 9 px top and bottom; the link fills the whole 44 and is what a finger
   * hits. The amount's own 17 px sit inside it.
   */
  price: 44,
  /** Between the three lines. Tailwind `gap-0.5`. */
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
export const INFO_HEIGHT = INFO.name + INFO.gap + INFO.label + INFO.gap + INFO.price;

/**
 * How tall the action column is when it carries both marks.
 *
 * The heart at the top and the bell at the foot, both 44 px, on one x. This
 * is NOT reserved: a row without a bell is `ROW.touch` tall in that column
 * and the text block decides the height. A row WITH one grows by the
 * difference, and only that row.
 */
export const ACTION_WITH_BELL = 2 * ROW.touch;

/**
 * What the page itself takes off the viewport.
 *
 * Every catalogue surface wraps its content in `main … px-4`, on every width
 * (see `src/app/(public)/(catalog)/page.tsx`). 16 px a side, so a row on a
 * 360 px phone is 328 px wide and not 360.
 */
export const PAGE_PAD = 16;

/** Picture, hairline, text, heart. */
export const ROW_COLUMNS = 4;

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
export function rowHeight(
  nameLines = 1,
  wide = false,
  withBell = false,
  priceWraps = false,
): number {
  const image = wide ? ROW.imageWide : ROW.image;
  const wrapped = priceWraps ? AMOUNT_LINE + INFO.gap + 2 : 0;
  const info = INFO_HEIGHT + (nameLines - 1) * INFO.name + wrapped;
  const action = withBell ? ACTION_WITH_BELL : ROW.touch;
  return 2 * ROW.padY + Math.max(image, info, action);
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
  return rowWidth - 2 * ROW.padX - image - ROW.divider - ROW.touch - gaps;
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
 * "Legendary" at 10 px is about 50 px of text plus 12 px of padding. It
 * shares line two with the value, and it is the one thing on that line
 * allowed to shorten — the price never is.
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
 * Does the amount fit beside the offer chip, or does the chip wrap?
 *
 * THE FALLBACK IS A WRAP, NEVER A TRUNCATION AND NEVER A SMALLER PRICE —
 * the operator's instruction. This function is how a test states where the
 * boundary lies rather than a report claiming it.
 */
export function priceLineFits(textWidth: number, amount = AMOUNT_PX): boolean {
  return amount + ROW.gap + OFFER_CHIP_PX <= textWidth;
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
export const NAME_FONT_PX = 13;
export const NAME_CHAR_RATIO = 0.56;

/** How many characters of the name fit on one line of a text block. */
export function nameCharsPerLine(textWidth: number): number {
  return Math.floor(textWidth / (NAME_FONT_PX * NAME_CHAR_RATIO));
}

/** The name is allowed two lines and clipped after them, like the card's. */
export const NAME_LINES = 2;

/** The phone widths this design is held to. */
export const PHONE_WIDTHS = [360, 390, 414] as const;

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
export const TWO_COLUMN_AT_REM = 52;
export const TWO_COLUMN_AT_PX = TWO_COLUMN_AT_REM * 16;
