/**
 * The one row between browsing and the grid (V3.3).
 *
 * The catalog and the collection had grown the same shape twice and drawn it
 * differently: a count on the left and whatever controls that page happened
 * to have on the right, each page deciding its own spacing, its own wrapping
 * and its own idea of which control was primary. Two pages, one gesture —
 * "this is what you are looking at, and this is what you can do about it".
 *
 * It renders nothing of its own beyond the count. What goes on the right is
 * the page's business: the catalog has a filter button, the collection has a
 * filter button and a view switch. Neither is invented here.
 *
 * `aria-live` on the count so a filter change is announced without moving
 * focus — the behaviour both pages already had, kept in one place.
 */
"use client";

import type { ReactNode } from "react";

export function BrowseToolbar({
  count,
  children,
}: {
  /** What is being shown, already worded by the page. */
  count: ReactNode;
  /** The controls, right-aligned and treated as one group. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="text-sm text-muted" aria-live="polite">
        {count}
      </p>
      {children ? (
        /*
         * One group, not a scattering. `shrink-0` on the wrapper so the
         * controls stay whole and the count is the thing that gives way when
         * the row is tight.
         */
        <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}
