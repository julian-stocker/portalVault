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
 *   > hairline and the action column have taken theirs?
 *
 * That is arithmetic, not taste, and arithmetic belongs somewhere a test can
 * run it. `rowTextWidth()` is the whole point of this file: the test computes
 * the remaining width at 360, 390 and 414 px and compares it against the
 * longest name the real catalogue contains (`data/catalog/products.json`),
 * rather than against a guess.
 *
 * FOUR COLUMNS, AND THE ORDER IS THE INFORMATION HIERARCHY
 *
 *   picture | hairline | identity, value, offer | actions
 *
 * The hairline is a column rather than a border so that it spans the row's
 * full height without anything having to know how tall the row became.
 *
 * NOTHING HERE IS A BREAKPOINT. The two `*Wide` values are the `sm:` step and
 * the only one: everything between a phone and a desktop is absorbed by the
 * text column, which simply gets wider and lets its last line stop wrapping.
 */

/**
 * The measured geometry, in CSS pixels.
 *
 * These are the numbers the markup uses, written once. The component says
 * `p-2 sm:p-3`, `gap-2 sm:gap-3`, `h-18 w-18 sm:h-22 sm:w-22` and `w-11`, and
 * a test holds those class names against these values — so the two cannot
 * drift apart without the drift being visible.
 */
export const ROW = {
  /** Inside edge of the row. Tailwind `p-2` / `sm:p-3`. */
  pad: 8,
  padWide: 12,
  /** Between the four columns. Tailwind `gap-2` / `sm:gap-3`. */
  gap: 8,
  gapWide: 12,
  /**
   * The square picture stage.
   *
   * 72 px on a phone: large enough that a figure is recognisable at a glance
   * — which is the whole reason a collector scans a list — and small enough
   * to leave the name a column it can live in (see `rowTextWidth`).
   */
  image: 72,
  imageWide: 88,
  /** The hairline between picture and text. One pixel, its own column. */
  divider: 1,
  /**
   * The action column, and the floor for every control in it.
   *
   * 44 px is Apple's recommendation and the figure the rest of this project
   * already uses — the heart on the vertical card is a 44 px box
   * (`favorite-heart.tsx`), and the orderbook holds its rows to the same
   * number (`src/lib/orderbook/mobile-layout.test.ts`).
   */
  touch: 44,
  /**
   * How many of those slots the action column RESERVES.
   *
   * Two: the favourite heart today, and the availability bell that UX-02
   * will put underneath it (ADR-0147, migration `0150`). The space is held
   * open now so that adding the bell later changes no geometry and moves no
   * text — the alternative is a row that grows by 44 px on every card the
   * day the bell arrives, which is a layout change disguised as a feature.
   */
  actionSlots: 2,
} as const;

/**
 * What the page itself takes off the viewport.
 *
 * Every catalogue surface wraps its content in `main … px-4`, on every width
 * (see `src/app/(public)/(catalog)/page.tsx`). 16 px a side, so a row on a
 * 360 px phone is 328 px wide and not 360.
 */
export const PAGE_PAD = 16;

/** Picture, hairline, text, actions. */
export const ROW_COLUMNS = 4;

/**
 * How much height the action column holds open, whatever is in it.
 *
 * The row is always at least this tall plus its padding, so the heart sits at
 * the top of a column that already has room for the bell below it.
 */
export const ROW_ACTION_HEIGHT = ROW.touch * ROW.actionSlots;

/** The width of one row on a phone, where the list is a single column. */
export function phoneRowWidth(viewport: number): number {
  return viewport - 2 * PAGE_PAD;
}

/**
 * What is left for the name, the value and the offer.
 *
 * Three columns and three gaps come off the row's inner width. The result is
 * the number that decides whether this design works at all: everything else
 * on the row has a fixed size, so the text column absorbs every width the
 * viewport happens to have.
 *
 * @param rowWidth  the outer width of the row itself, not of the viewport
 * @param wide      the `sm:` step — a larger picture and wider gaps
 */
export function rowTextWidth(rowWidth: number, wide = false): number {
  const pad = wide ? ROW.padWide : ROW.pad;
  const gap = wide ? ROW.gapWide : ROW.gap;
  const image = wide ? ROW.imageWide : ROW.image;
  const gaps = (ROW_COLUMNS - 1) * gap;
  return rowWidth - 2 * pad - image - ROW.divider - ROW.touch - gaps;
}

/**
 * What is left for the offer band.
 *
 * The band sits UNDER the identity block and spans the content column, so it
 * keeps the picture's width and the hairline's as well — which is the second
 * reason it is a band rather than a fourth line in the text column: it gets
 * about 90 px more than the text does, and `OfferLink`'s longer label needs
 * roughly 101 px at 11 px plus its padding.
 */
export function rowOfferWidth(rowWidth: number, wide = false): number {
  const pad = wide ? ROW.padWide : ROW.pad;
  const gap = wide ? ROW.gapWide : ROW.gap;
  return rowWidth - 2 * pad - gap - ROW.touch;
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
 * How many characters of a name fit on one line of the text column.
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

/** How many characters of the name fit on one line of a text column. */
export function nameCharsPerLine(textWidth: number): number {
  return Math.floor(textWidth / (NAME_FONT_PX * NAME_CHAR_RATIO));
}

/** The name is allowed two lines and clipped after them, like the card's. */
export const NAME_LINES = 2;

/** The phone widths this design is held to. */
export const PHONE_WIDTHS = [360, 390, 414] as const;
