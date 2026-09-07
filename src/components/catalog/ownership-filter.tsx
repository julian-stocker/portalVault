/**
 * "Alle · Besitz · Fehlen" — the catalog's ownership filter.
 *
 * Three segments, exactly one highlighted, and the highlighted one is always
 * what is on screen. Its predecessor was a single toggle called "Besitz
 * anzeigen" that lit up while owned figures were **hidden**; every other
 * highlighted control in the product means "this is your current view", so
 * that one read backwards however it was labelled.
 *
 * The same pills as the product-group tabs, at the same size (ADR-0041): this
 * is the third and smallest level of narrowing, under the game and under the
 * kind of thing, and it should look like it. Not three large buttons — it
 * shares a line with the count.
 *
 * Display only. It writes nothing, and it does not touch the gold frame:
 * ownership stays marked on every card in every state.
 *
 * Rendered only where the question has an answer — signed in, and not for an
 * administrator (`offersOwnershipFilter`).
 */
"use client";

import { OWNERSHIP_MODES, type OwnershipMode } from "@/lib/catalog/ownership";
import { de } from "@/lib/i18n/de";

const LABELS: Readonly<Record<OwnershipMode, string>> = {
  all: de.catalog.ownershipAll,
  owned: de.catalog.ownershipOwned,
  missing: de.catalog.ownershipMissing,
};

export function OwnershipFilter({
  active,
  onSelect,
}: {
  active: OwnershipMode;
  onSelect: (mode: OwnershipMode) => void;
}) {
  return (
    <div role="tablist" aria-label={de.catalog.ownershipNav} className="flex shrink-0 gap-1.5">
      {OWNERSHIP_MODES.map((mode) => {
        const isActive = mode === active;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(mode)}
            className={
              // 40 px, the same step as the group tabs above it.
              "flex min-h-10 shrink-0 items-center rounded-full px-3 text-[13px] " +
              "whitespace-nowrap transition-colors " +
              (isActive
                ? "bg-accent/15 font-medium text-accent ring-1 ring-accent/50"
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
