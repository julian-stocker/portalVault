/**
 * The second navigation level: what kind of collectible (ADR-0041).
 *
 * Below the games, and deliberately quieter than them — a game is where you
 * are, a product group is how you narrow it. Smaller pills, no shadow, a
 * lighter ground: the series bar has to stay the primary level or the header
 * turns into two competing rows of buttons.
 *
 * Which tabs appear comes from the data, never from a table per series
 * (`groupTabs`). One component for collectors and administrators alike; what
 * differs between them is the catalog that was loaded, not the navigation.
 *
 * It scrolls sideways below `sm:` for the same reason the series bar does:
 * Trap Team offers six entries, and wrapping them onto a second line moves
 * everything under it every time a game is picked.
 */
"use client";

import type { GroupTab } from "@/lib/catalog/group";
import type { CatalogGroup } from "@/lib/catalog/group";
import { formatNumber } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export function ProductGroupTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly GroupTab[];
  /** `null` is "Alle". */
  active: CatalogGroup | null;
  onSelect: (group: CatalogGroup | null) => void;
}) {
  // A game with nothing but figures needs no second level at all: one tab
  // beside "Alle" would be a control with nothing to choose.
  if (tabs.length <= 2) return null;

  return (
    <div
      role="tablist"
      aria-label={de.catalog.groupNav}
      className="no-scrollbar -mx-4 flex snap-x gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
    >
      {tabs.map((tab) => {
        const isActive = tab.group === active;
        return (
          <button
            key={tab.group ?? "all"}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.group)}
            className={
              // 40 px: comfortably tappable, visibly one step below the
              // series pills above.
              "flex min-h-10 shrink-0 snap-start items-center gap-1.5 rounded-full px-3 " +
              "text-[13px] whitespace-nowrap transition-colors " +
              (isActive
                ? "bg-accent/15 font-medium text-accent ring-1 ring-accent/50"
                : "bg-deep/50 text-muted ring-1 ring-border/50 hover:text-foreground hover:ring-border")
            }
          >
            {tab.label}
            {/* The count is information, not decoration — announced with the
                label so a screen reader hears "Fallen, 57 Figuren". */}
            <span aria-hidden="true" className="tabular-nums opacity-70">
              {formatNumber(tab.count)}
            </span>
            <span className="sr-only">, {de.catalog.figureCount(tab.count)}</span>
          </button>
        );
      })}
    </div>
  );
}
