/**
 * "Alle · Sammlung · Fehlen · Verfügbar" — the catalogue's quick filter
 * (UX-01F).
 *
 * Four named views, exactly one highlighted, and the highlighted one always
 * describes what is on screen — the rule `OwnershipFilter` was rewritten for
 * and the rule this inherits.
 *
 * IT SETS TWO DIMENSIONS AND OWNS NEITHER. The values are a projection of
 * ownership × availability (`quick-filter.ts`), so nothing was merged and
 * every combination the dialog can express still works. When the dialog has
 * set a combination none of the four names — "missing AND buyable" — this
 * highlights NOTHING rather than picking the closest lie.
 *
 * NOT EVERY VISITOR GETS FOUR. Signed out, "Sammlung" and "Fehlen" have no
 * answer: nothing is owned, so "Fehlen" would quietly mean "everything". The
 * caller passes the list, which comes from the project's existing
 * `offersOwnershipFilter`, so there is no second rule about who may ask.
 *
 * The same pills as the filters it summarises, at the browse row's size: this
 * is the control used on most visits, so it sits on screen rather than behind
 * the filter button — but it is still narrowing, not navigation, so it does
 * not borrow the series grid's weight.
 */
"use client";

import type { QuickFilter } from "@/lib/catalog/quick-filter";
import { de } from "@/lib/i18n/de";

const LABELS: Readonly<Record<QuickFilter, string>> = {
  all: de.catalog.quickAll,
  owned: de.catalog.quickOwned,
  missing: de.catalog.quickMissing,
  available: de.catalog.quickAvailable,
};

export function QuickFilterBar({
  options,
  active,
  onSelect,
}: {
  options: readonly QuickFilter[];
  /** `null` means the dialog set something none of these four describes. */
  active: QuickFilter | null;
  onSelect: (value: QuickFilter) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={de.catalog.quickNav}
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      <span className="shrink-0 text-[11px] text-muted">{de.catalog.quickNav}</span>
      {options.map((value) => {
        const isActive = value === active;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(value)}
            className={
              /* 44 px on touch, the browse row's step on a pointer — the
                 same two numbers `AvailabilityFilter` uses. */
              "flex min-h-11 shrink-0 items-center rounded-full px-3 text-[13px] "
              + "whitespace-nowrap transition-colors sm:min-h-9 "
              + (isActive
                ? "bg-status-ground font-medium text-status-ink ring-1 ring-status-line"
                : "bg-deep/50 text-muted ring-1 ring-border/50 hover:text-foreground hover:ring-border")
            }
          >
            {LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}
