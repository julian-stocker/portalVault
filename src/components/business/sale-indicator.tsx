/**
 * The status dot on a sold position.
 *
 * It sits in the FIRST cell, next to the position number, and that is the
 * whole point of it: `.ob-item > :first-child` is sticky, so on a phone the
 * dot and the number stay pinned to the left edge while the row scrolls
 * sideways. The reader sees whether anything is still owed without scrolling
 * three columns to `Status`.
 *
 * IT IS THE FIRST TRACK, AND THEREFORE THE STICKY ONE. `.ob-item >
 * :first-child` sticks to the left edge, so on a phone the dot stays put
 * while the row scrolls sideways — the reader always sees whether anything
 * is still owed, without reaching `Status` five columns away. `#` gives up
 * its sticky position to it, which is the right trade: a position number
 * that has scrolled away costs nothing, an unknown state costs a check.
 *
 * Einkauf is untouched by this. It renders six cells and the rule\'s own
 * fallback; only Verkauf overrides the list, which is exactly what
 * `--ob-item-columns` exists for.
 *
 * NEVER COLOUR ALONE. Each tone has its own glyph (○ ✓ !), and the accessible
 * name is the status in words. The column therefore works in greyscale, under
 * `forced-colors`, and for a screen reader — where the colour is not
 * information at all.
 */
import type { SaleItemIndicator } from "@/lib/orderbook/sales-view";

/**
 * Verkauf\'s seven tracks: the Einkauf list with the indicator in front.
 *
 * Defined once and imported by both sale screens, so the ledger\'s expansion
 * and the detail list cannot drift apart — the thing that produced two
 * different sale layouts in the first place.
 *
 * 1.25rem is a glyph and nothing else. It is deliberately too narrow for a
 * word: this column is a signal, and the sentence lives in `Status`.
 */
export const SALE_ITEM_COLUMNS =
  "1.25rem 2.5rem 9.5rem minmax(0, 1fr) 6rem 6rem 6.5rem";

/**
 * One class per tone. Written out rather than composed, because Tailwind
 * discovers classes by scanning the source: a name built at runtime is a
 * name that is never generated.
 */
const TONE: Record<SaleItemIndicator["tone"], string> = {
  grey: "text-muted",
  amber: "text-amber-400",
  green: "text-emerald-400",
  orange: "text-orange-400",
  returned: "text-orange-300",
};

export function SaleIndicator({ indicator, label }: {
  indicator: SaleItemIndicator;
  /** The status in words — the accessible name, not decoration. */
  label: string;
}) {
  return (
    <span role="img" aria-label={label} title={label}
          className={`${TONE[indicator.tone]} text-sm leading-none`}>
      {indicator.glyph}
    </span>
  );
}
