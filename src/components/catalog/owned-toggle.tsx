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
        // Same box in both states (V4.4). The tick that used to appear when
        // the filter was on made the button wider, and on a 390 px screen
        // that was enough to push it onto its own line — the control moved
        // because it had been used. Only colour changes now; nothing that
        // takes up space does. `font-medium` on one state alone would do the
        // same thing on a smaller scale, so the weight is fixed too.
        "flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-medium " +
        "whitespace-nowrap ring-1 transition-colors " +
        // Quiet while it is on, because on is simply the catalog. Off is the
        // state that changes what is listed, so that is the one the eye gets
        // told about — the same rule the collection's reset follows.
        (active
          ? "bg-deep/70 text-muted ring-border/70 hover:text-foreground"
          : "bg-accent-subtle text-accent ring-accent/60")
      }
    >
      {de.catalog.ownedFilter}
    </button>
  );
}
