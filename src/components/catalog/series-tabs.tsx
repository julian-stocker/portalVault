/**
 * Series switch.
 *
 * Horizontally scrollable on phones with snap points, so a thumb lands on a
 * tab rather than between two.
 */
"use client";

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
  const options = [{ code: ALL_SERIES, label: de.catalog.allSeries, position: -1 }, ...series];

  return (
    <div
      role="tablist"
      aria-label={de.catalog.title}
      className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1"
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
              // min-h-11 is the only change here: 44 px touch target. The
              // visual redesign of the series navigation is a later phase.
              "flex min-h-11 shrink-0 snap-start items-center rounded-full px-4 " +
              "text-sm whitespace-nowrap " +
              (isActive
                ? "bg-foreground text-background"
                : "border border-border text-muted hover:text-foreground")
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
