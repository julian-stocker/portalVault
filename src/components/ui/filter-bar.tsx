/**
 * The segmented filter bar.
 *
 * One control, two jobs: the series switch in the catalog and the showcase
 * filter in the collection. They look identical because they are the same
 * gesture — pick one slice of a grid — and having built two of them once
 * already, they drifted apart within a phase.
 *
 * Segmented rather than a row of outlined buttons: the options are mutually
 * exclusive, and a shared track says that before anyone reads a label. The
 * track also removes six borders from the screen, which was a large part of
 * why the page read as a form.
 *
 * Below `sm:` it scrolls sideways — the one element in the product allowed
 * to. `.no-scrollbar` hides the track, not the scrolling.
 */
"use client";

export type FilterOption = {
  /** Stable value handed back to `onSelect`. */
  value: string;
  label: string;
  /** Announced instead of `label` where the visible text is abbreviated. */
  srLabel?: string;
};

export function FilterBar({
  options,
  active,
  onSelect,
  label,
}: {
  options: readonly FilterOption[];
  active: string;
  onSelect: (value: string) => void;
  /** Accessible name of the whole bar, e.g. "Serie wählen". */
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={
        "no-scrollbar -mx-4 flex snap-x gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0 " +
        // The track. Fits its content on a phone so it does not stretch to a
        // full-width grey band behind three chips.
        "sm:w-fit sm:rounded-sky-lg sm:bg-border/40 sm:p-1"
      }
    >
      {options.map((option) => {
        const isActive = option.value === active;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(option.value)}
            className={
              "flex min-h-11 shrink-0 snap-start items-center rounded-sky-md px-3.5 " +
              "text-sm whitespace-nowrap transition-colors sm:min-h-9 " +
              (isActive
                ? // Raised out of the track rather than inverted: an active
                  // segment is the one in front, not the one painted black.
                  "bg-surface-raised font-medium text-foreground shadow-card"
                : "font-normal text-muted hover:text-foreground")
            }
          >
            {option.label}
            {option.srLabel ? <span className="sr-only">&nbsp;{option.srLabel}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
