/**
 * The filter button and the panel behind it (V3.3).
 *
 * Both pages used to lay every filter out beside the browse navigation, so a
 * phone showed three rows of pills before a single figure. The secondary
 * narrowing moves in here; what stays outside is what a visitor navigates
 * with — the search box and the games.
 *
 * IT REUSES THE DIALOG THAT EXISTS. Escape, the backdrop, the focus trap, the
 * focus return, the scroll lock and the portal all come from `Modal`
 * (IR-001). A second dialog infrastructure for a filter panel would be two
 * implementations of the same twelve edge cases, and the second one is always
 * the one that forgets to give focus back.
 *
 * It is a centred panel rather than a bottom sheet. On a phone `Modal` is
 * already near-full-width with an internal scroll and a safe-area inset,
 * which covers what a sheet would; building a sheet would mean a second
 * positioning mode in the dialog for a visual preference.
 *
 * FILTERS APPLY IMMEDIATELY. That is the architecture both pages already
 * have — every control writes straight to the view's state and the grid
 * re-renders — so there is no "apply" and nothing to cancel. Closing the
 * panel changes nothing back, which is why the reset is inside it.
 */
"use client";

import { useId, useState, type ReactNode } from "react";

import { Modal } from "@/components/ui/modal";
import { de } from "@/lib/i18n/de";

function SlidersGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" />
      <circle cx="10.5" cy="4.5" r="1.6" />
      <circle cx="5.5" cy="11.5" r="1.6" />
    </svg>
  );
}

/** One named group of options inside the panel. */
export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-medium tracking-wide text-on-deep-muted uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}

export function FilterSheet({
  /** How many filters are on. Counted by the page from its own state. */
  activeCount,
  onReset,
  children,
}: {
  activeCount: number;
  /** Clears every filter this panel owns. Absent when nothing is set. */
  onReset: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const active = activeCount > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={
          "focus-ring flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 " +
          "text-[13px] whitespace-nowrap shadow-card backdrop-blur-sm transition-colors sm:min-h-9 " +
          (active
            ? /* Indigo, not gold and not silver: a filter is neither
                 ownership nor trade (V3.1). The neutral status role already
                 carries "this is on". */
              "bg-status-ground font-semibold text-status-ink ring-1 ring-status-line"
            : "bg-deep/65 font-normal text-muted ring-1 ring-border/70 " +
              "hover:text-foreground hover:ring-border-strong")
        }
      >
        <SlidersGlyph />
        {de.browse.filter}
        {active ? (
          <span className="tabular-nums" aria-hidden="true">
            · {activeCount}
          </span>
        ) : null}
        {/* The count again, as a sentence, because "· 2" is not one. */}
        {active ? <span className="sr-only">{de.browse.filterActive(activeCount)}</span> : null}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} labelledBy={headingId} size="md">
        <div className="flex items-start gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
          <h2 id={headingId} className="flex-1 text-base font-semibold text-on-deep">
            {de.browse.filterHeading}
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={de.browse.filterClose}
            className={
              "focus-ring -mt-1.5 -mr-1.5 inline-flex h-11 w-11 shrink-0 items-center " +
              "justify-center rounded-full text-on-deep-muted transition-colors " +
              "hover:bg-white/10 hover:text-on-deep"
            }
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-5">{children}</div>
        </div>

        {active ? (
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <button
              type="button"
              onClick={onReset}
              className={
                "focus-ring min-h-11 w-full rounded-full text-sm text-on-deep-muted " +
                "ring-1 ring-border/70 transition-colors hover:text-on-deep hover:ring-border-strong"
              }
            >
              {de.browse.filterReset}
            </button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
