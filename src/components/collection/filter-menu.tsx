/**
 * The collection's filters.
 *
 * Deliberately small. "Duplikate" used to sit in the same bar as the six
 * games and behaved like a seventh, which meant you could look at duplicates
 * or at Giants but never at the duplicates *in* Giants (ADR-0038, V4.2). The
 * games are navigation; this is what narrows whatever they selected.
 *
 * One toggle today. The shape takes more — an element filter is the obvious
 * next one — but it is not built as a filter engine, because there is one
 * filter and guessing at the second would be building for a spec nobody has
 * written. An element filter in particular waits on data: only 102 of 561
 * collectibles carry a reliable element today.
 */
"use client";

import type { CollectionFilters } from "@/lib/collection/view";
import { de } from "@/lib/i18n/de";

export function FilterMenu({
  filters,
  onChange,
}: {
  filters: CollectionFilters;
  onChange: (filters: CollectionFilters) => void;
}) {
  const active = filters.duplicatesOnly;

  return (
    <div
      role="group"
      aria-label={de.collection.filterLabel}
      className="flex shrink-0 items-center gap-2"
    >
      {/* The word, so the control says what kind of control it is. It sits
          between the count and the view toggle now (V4.3), where a square
          chip beside a round series pill is no longer the thing that has to
          keep the two apart. */}
      <span className="text-[11px] tracking-wide text-muted uppercase">
        {de.collection.filterLabel}
      </span>
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onChange({ ...filters, duplicatesOnly: !active })}
        className={
          "flex min-h-9 items-center gap-1.5 rounded-sky-sm px-3 text-[13px] " +
          "whitespace-nowrap ring-1 transition-colors " +
          (active
            ? "bg-accent-subtle font-medium text-accent ring-accent/60"
            : "bg-surface/70 text-muted ring-border/70 hover:text-foreground")
        }
      >
        {de.collection.filter.duplicates}
        {/* The way out of the filter is the filter itself; a separate "×"
            would be a second target for the same action. */}
        {active ? <span aria-hidden="true">×</span> : null}
      </button>
    </div>
  );
}
