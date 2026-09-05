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
 * V3 seats the track in the dark world and gives the active segment a gold
 * edge: on a deep ground a raised white chip was the only bright thing on the
 * page and pulled the eye off the figures.
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
        // Separate pills on the world rather than one enclosed track: the
        // track was a control panel laid over the artwork, and the artwork is
        // the point (ADR-0038, V3.1).
        "no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
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
              "flex min-h-11 shrink-0 snap-start items-center rounded-full px-4 " +
              "text-sm whitespace-nowrap shadow-card backdrop-blur-sm transition-colors sm:min-h-10 " +
              (isActive
                ? "bg-accent-subtle font-semibold text-accent ring-1 ring-accent/70"
                : "bg-deep/65 font-normal text-muted ring-1 ring-border/70 " +
                  "hover:text-foreground hover:ring-border-strong")
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
