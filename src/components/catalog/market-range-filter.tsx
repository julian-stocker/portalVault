/**
 * "Market value from … to …" (UX-01F).
 *
 * TWO NUMBERS AND A SENTENCE SAYING WHICH NUMBER THEY ARE. A catalogue tile
 * prints two kinds of money — the figure's MARKET VALUE and what SkyIsles
 * asks for the one in stock — and the operator asked for this filter to be
 * unmistakably the first. So the group is labelled "Marktwert von/bis" and
 * the hint under the inputs says `Marktwert, nicht Angebotspreis`. The rule
 * itself lives in `market-filter.ts`.
 *
 * EMPTY MEANS NO BOUND, never zero: a blank "von" must not exclude the
 * figures nobody has priced, and a blank "bis" must not exclude everything.
 * Half-typed input is treated as blank, so the list does not empty itself
 * while somebody is still typing.
 *
 * AND IT SAYS WHOM IT LEAVES OUT. A figure with no known market value cannot
 * satisfy a bound (ADR-0010: `null` is "nobody has priced this", never 0), so
 * the count of those is printed while a bound is set — 27 of 594 rows on
 * staging. Vanishing without explanation is what this avoids.
 */
"use client";

import {
  centsToEuro,
  euroToCents,
  isMarketRangeActive,
  type MarketRange,
} from "@/lib/catalog/market-filter";
import { de } from "@/lib/i18n/de";

const FIELD =
  "min-h-9 w-24 min-w-0 rounded-sky-sm bg-deep/50 px-2 text-[13px] text-foreground "
  + "tabular-nums ring-1 ring-border/50 transition-colors hover:ring-border focus-ring";

export function MarketRangeFilter({
  range,
  withoutPrice,
  onChange,
}: {
  range: MarketRange;
  /** How many loaded figures have no market value at all. */
  withoutPrice: number;
  onChange: (range: MarketRange) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <span>{de.catalog.marketRangeFrom}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={centsToEuro(range.minCents)}
            onChange={(event) =>
              onChange({ ...range, minCents: euroToCents(event.target.value) })
            }
            className={FIELD}
          />
          <span aria-hidden="true">€</span>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <span>{de.catalog.marketRangeTo}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={centsToEuro(range.maxCents)}
            onChange={(event) =>
              onChange({ ...range, maxCents: euroToCents(event.target.value) })
            }
            className={FIELD}
          />
          <span aria-hidden="true">€</span>
        </label>
      </div>
      <p className="text-[11px] leading-snug text-muted">
        {de.catalog.marketRangeHint}
        {isMarketRangeActive(range) && withoutPrice > 0
          ? ` · ${de.catalog.marketRangeNoPrice(withoutPrice)}`
          : ""}
      </p>
    </div>
  );
}
