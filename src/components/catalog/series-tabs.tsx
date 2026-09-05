/**
 * Series switch.
 *
 * Short codes rather than full titles: "Skylanders: Spyro's Adventure" never
 * fitted a phone, so the previous version showed a permanently half-cut
 * "Swap Forc…" as its normal state. All seven tabs now fit a 360 px screen,
 * and the full name of the chosen series is spelled out in the line below
 * the bar rather than inside it.
 *
 * Each tab carries both forms in its accessible name — the visible code plus
 * the full title as screen-reader text. That keeps voice control working
 * ("SA" is what a user sees and says) while a screen reader still hears
 * which game it is.
 *
 * No series colours. Element colour is a character metadatum (ADR-0034);
 * series is navigation. Two hue systems on one screen would collide.
 */
"use client";

import { seriesShort } from "@/lib/catalog/series-nav";
import { ALL_SERIES } from "@/lib/catalog/search";
import type { SeriesOption } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";

export function SeriesTabs({
  series,
  active,
  onSelect,
}: {
  series: readonly SeriesOption[];
  active: string;
  onSelect: (code: string) => void;
}) {
  const options = [
    { code: ALL_SERIES, short: de.catalog.allSeries, label: de.catalog.allSeries },
    ...series.map((option) => ({
      code: option.code,
      short: seriesShort(option.code),
      label: option.label,
    })),
  ];

  return (
    <div
      role="tablist"
      aria-label={de.catalog.seriesNav}
      // Still scrollable, because a seventh tab plus a wide "Alle" can still
      // overflow the narrowest phones — but now it is the exception rather
      // than the resting state.
      className="-mx-4 flex snap-x gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
    >
      {options.map((option) => {
        const isActive = option.code === active;
        return (
          <button
            key={option.code}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(option.code)}
            className={
              "flex min-h-11 shrink-0 snap-start items-center rounded-sky-md px-3.5 " +
              "text-sm font-medium whitespace-nowrap " +
              (isActive
                ? "bg-foreground text-background"
                : "border border-border text-muted hover:border-border-strong hover:text-foreground")
            }
          >
            {option.short}
            {option.short === option.label ? null : (
              <span className="sr-only">&nbsp;{option.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
