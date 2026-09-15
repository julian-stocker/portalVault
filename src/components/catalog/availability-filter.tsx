/**
 * "Only what somebody is offering" (V3.3).
 *
 * Its own row in the filter panel, beside the ownership filter and never
 * inside it: owning a figure and being able to buy one are independent, and
 * folding them into one control would make "missing AND buyable" — the
 * combination somebody with money actually wants — unexpressible.
 *
 * Two states, both named. A bare on/off switch would leave the resting state
 * unlabelled, and "Alle" is a real answer rather than the absence of one.
 *
 * Same shape as `OwnershipFilter`, deliberately: two filters that combine
 * should look like two of the same kind of thing.
 */
"use client";

import { AVAILABILITY_MODES, type AvailabilityMode } from "@/lib/catalog/availability";
import { de } from "@/lib/i18n/de";

const LABELS: Record<AvailabilityMode, string> = {
  all: de.catalog.availabilityAll,
  available: de.catalog.availabilityOffered,
};

export function AvailabilityFilter({
  active,
  onSelect,
}: {
  active: AvailabilityMode;
  onSelect: (mode: AvailabilityMode) => void;
}) {
  return (
    <div role="tablist" aria-label={de.catalog.availabilityNav} className="flex shrink-0 gap-1.5">
      {AVAILABILITY_MODES.map((mode) => {
        const isActive = mode === active;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(mode)}
            className={
              // 44 px on touch, the panel's step on a pointer.
              "flex min-h-11 shrink-0 items-center rounded-full px-3 text-[13px] " +
              "whitespace-nowrap transition-colors sm:min-h-10 " +
              (isActive
                ? /* Indigo. A filter is neither ownership nor trade, so it
                     borrows neither gold nor silver (V3.1). */
                  "bg-status-ground font-medium text-status-ink ring-1 ring-status-line"
                : "bg-deep/50 text-muted ring-1 ring-border/50 hover:text-foreground hover:ring-border")
            }
          >
            {LABELS[mode]}
          </button>
        );
      })}
    </div>
  );
}
