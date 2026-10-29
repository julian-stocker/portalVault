/**
 * "Market value from … to …" (UX-01F).
 *
 * The fifth narrowing of the same pool, and like the four before it it reads
 * one field and knows nothing about the others.
 *
 * IT IS THE MARKET VALUE AND NOT A PRICE, which the operator asked to be
 * unmistakable. The two numbers on a catalogue tile mean different things:
 *
 *   MARKTWERT          what a figure is worth — `skylanders.market_price`,
 *                      editorial, present for 567 of 594 rows
 *   "Angebote ab …"    what SkyIsles asks for the one it has in stock —
 *                      `shop_offers()`, present for a handful
 *
 * This filter reads the first. A range over offer prices would be a different
 * filter with a different name, and conflating them would mean a collector
 * who asks for "up to 10 €" gets figures worth 80 that happen to be on sale.
 * The panel says `Marktwert, nicht Angebotspreis` under the inputs for the
 * same reason.
 *
 * IT FILTERS THE NUMBER ON SCREEN. The catalogue may print a boosted market
 * value (`0094`, `catalogDisplayMarketPrice`), and a filter that compared the
 * raw figure would exclude a tile showing 11 € from "bis 12 €". So the bound
 * is compared against exactly what the tile prints.
 *
 * A FIGURE WITH NO KNOWN MARKET VALUE DOES NOT MATCH a bounded range, and
 * never counts as 0 (ADR-0010). `null` means "nobody has priced this", which
 * is not the same as "free" — and 27 of 594 rows are in that state, so the
 * panel says how many are being left out rather than letting them vanish.
 */
import { catalogDisplayMarketPrice } from "@/lib/catalog/market-boost";
import type { CatalogFigure } from "@/lib/catalog/types";

/** Both bounds in CENTS, like every other money value in the project. */
export type MarketRange = { minCents: number | null; maxCents: number | null };

export const DEFAULT_MARKET_RANGE: MarketRange = { minCents: null, maxCents: null };

export function isMarketRangeActive(range: MarketRange): boolean {
  return range.minCents !== null || range.maxCents !== null;
}

/**
 * Does this figure's printed market value fall inside the range?
 *
 * Inclusive at both ends: "von 10 bis 20" keeps a figure worth exactly 10 and
 * one worth exactly 20. A range whose bounds are the wrong way round matches
 * nothing, which is what it literally asks for — the panel does not reorder
 * the inputs, because silently swapping them would hide a typo.
 */
export function matchesMarketRange(
  figure: Pick<CatalogFigure, "marketPrice">,
  range: MarketRange,
  boostPercent: number,
): boolean {
  if (!isMarketRangeActive(range)) return true;
  if (figure.marketPrice === null) return false;
  /* The boost helper is null-in/null-out; the null case is already handled
     above, and this keeps the types honest rather than asserting. */
  const shown = catalogDisplayMarketPrice(figure.marketPrice, boostPercent);
  if (shown === null) return false;
  if (range.minCents !== null && shown < range.minCents) return false;
  if (range.maxCents !== null && shown > range.maxCents) return false;
  return true;
}

/** How many figures a bounded range necessarily leaves out. */
export function withoutMarketPrice(
  figures: readonly Pick<CatalogFigure, "marketPrice">[],
): number {
  let count = 0;
  for (const figure of figures) if (figure.marketPrice === null) count += 1;
  return count;
}

/**
 * Euro input to cents, for the two number fields.
 *
 * An empty field is `null` — no bound — and not 0, which would be a bound
 * that excludes nothing from below and everything from above. Anything that
 * is not a finite number at or above zero is also `null`: a half-typed "1,"
 * must not narrow the list to nothing while somebody is still typing.
 */
export function euroToCents(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  const euros = Number(trimmed);
  if (!Number.isFinite(euros) || euros < 0) return null;
  return Math.round(euros * 100);
}

/** Cents back to what the input shows, so a typed bound survives a re-render. */
export function centsToEuro(cents: number | null): string {
  if (cents === null) return "";
  return String(cents / 100);
}
