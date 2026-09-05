/**
 * Symbols or table.
 *
 * Two real buttons with `aria-pressed`, not a styled `<select>` and not a
 * pair of divs: the choice is a toggle between two states, and that is what
 * a screen reader should hear. Keyboard reachable like any button.
 *
 * The icons are decorative — each button carries its own visible label, so
 * nothing here depends on recognising a glyph.
 */
"use client";

import { VIEW_MODES, type ViewMode } from "@/components/collection/view-mode";
import { de } from "@/lib/i18n/de";

function SymbolsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.2" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M2 3.5h12M2 8h12M2 12.5h12" />
    </svg>
  );
}

const ICON: Record<ViewMode, () => React.ReactElement> = {
  symbols: SymbolsIcon,
  table: TableIcon,
};

export function ViewToggle({
  mode,
  onSelect,
}: {
  mode: ViewMode;
  onSelect: (mode: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label={de.collection.viewLabel}
      className="flex shrink-0 gap-1 rounded-full bg-deep/70 p-1 ring-1 ring-border/70"
    >
      {VIEW_MODES.map((option) => {
        const Icon = ICON[option];
        const isActive = option === mode;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(option)}
            className={
              "flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] " +
              "whitespace-nowrap transition-colors " +
              (isActive
                ? "bg-accent-subtle font-medium text-accent ring-1 ring-accent/60"
                : "text-muted hover:text-foreground")
            }
          >
            <Icon />
            {de.collection.view[option]}
          </button>
        );
      })}
    </div>
  );
}
