/**
 * "Besitz anzeigen" — the catalog's one view filter (ADR-0038, V4.3).
 *
 * **On by default**, and on means the whole catalog: owned figures and
 * missing ones together. Switched off it hides what is already owned, which
 * leaves the list a collector actually wants in front of a shelf — what is
 * still missing.
 *
 * V4.2 had it the other way round ("In Besitz", off by default, on showed
 * only owned figures). That answered a question the collection page answers
 * better, and it made the resting state of the catalog depend on a filter.
 *
 * Display only. It never writes, and it does not touch the gold frame —
 * ownership is still marked on every card, whether or not the filter is on.
 *
 * Rendered only for a signed-in visitor. Nobody signed out has an answer to
 * it, and a control that is present but meaningless is worse than no control.
 */
"use client";

import { de } from "@/lib/i18n/de";

/** A tick. Decorative — `aria-pressed` carries the state. */
function CheckGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function OwnedToggle({
  active,
  onChange,
}: {
  /** True while owned figures are shown — the resting state. */
  active: boolean;
  onChange: (active: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onChange(!active)}
      className={
        "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] " +
        "whitespace-nowrap ring-1 transition-colors " +
        // Quiet while it is on, because on is simply the catalog. Off is the
        // state that changes what is listed, so that is the one the eye gets
        // told about — the same rule the collection's reset follows.
        (active
          ? "bg-deep/70 text-muted ring-border/70 hover:text-foreground"
          : "bg-accent-subtle font-medium text-accent ring-accent/60")
      }
    >
      {active ? <CheckGlyph /> : null}
      {de.catalog.ownedFilter}
    </button>
  );
}
