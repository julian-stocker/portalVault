/**
 * Cards or rows (UX-01C, ADR-0148).
 *
 * Two real buttons with `aria-pressed`, not a styled `<select>` and not a
 * pair of divs: the choice is a toggle between two states, and that is what
 * a screen reader should hear. Keyboard reachable like any button.
 *
 * WHY THIS IS NOT THE COLLECTION'S `ViewToggle`. That component answers a
 * different question — cards or a TABLE — with its own two icons and its own
 * labels, and `/collection` is out of scope for UX-01C. What the two share
 * is the mechanism underneath (`@/lib/ui/view-store`), which is where the
 * subtle part lives; what differs is two glyphs and two words, and threading
 * those through a generic component would cost more than it saves. Same
 * shape, same sizes, same tokens, so the two read as one control in two
 * places.
 *
 * The icons are decorative — each button carries its own visible label, so
 * nothing here depends on recognising a glyph.
 */
"use client";

import { CATALOG_VIEWS, type CatalogView } from "@/components/catalog/catalog-view-mode";
import { de } from "@/lib/i18n/de";

/** Four tiles: the grid of cards. The same glyph the collection uses. */
function CardsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.2" />
    </svg>
  );
}

/**
 * A picture beside two lines, twice — the row, drawn as what it is.
 *
 * Deliberately NOT the collection's three plain rules: that glyph means a
 * table, and this is not one. A thumbnail with text beside it is the shape
 * the list actually has.
 */
function RowsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
      <rect x="1.5" y="2" width="4" height="4" rx="1" />
      <rect x="7" y="2.6" width="7.5" height="1.3" rx="0.65" />
      <rect x="7" y="4.9" width="5" height="1.1" rx="0.55" />
      <rect x="1.5" y="10" width="4" height="4" rx="1" />
      <rect x="7" y="10.6" width="7.5" height="1.3" rx="0.65" />
      <rect x="7" y="12.9" width="5" height="1.1" rx="0.55" />
    </svg>
  );
}

const ICON: Record<CatalogView, () => React.ReactElement> = {
  cards: CardsIcon,
  rows: RowsIcon,
};

export function CatalogViewToggle({
  view,
  onSelect,
}: {
  view: CatalogView;
  onSelect: (view: CatalogView) => void;
}) {
  return (
    <div
      role="group"
      aria-label={de.catalog.viewLabel}
      className="flex shrink-0 gap-1 rounded-full bg-deep/70 p-1 ring-1 ring-border/70"
    >
      {CATALOG_VIEWS.map((option) => {
        const Icon = ICON[option];
        const isActive = option === view;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(option)}
            /* `min-h-9` plus the group's `p-1` is 44 px of target, which is
               the floor every control in this product holds to. */
            className={
              "flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] " +
              "whitespace-nowrap transition-colors " +
              (isActive
                ? "bg-status-ground font-medium text-status-ink ring-1 ring-status-line"
                : "text-muted hover:text-foreground")
            }
          >
            <Icon />
            {de.catalog.view[option]}
          </button>
        );
      })}
    </div>
  );
}
