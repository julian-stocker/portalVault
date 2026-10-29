/**
 * "Only these elements" — the catalogue's element filter (UX-01F).
 *
 * MULTI-SELECT, not exclusive. Ten elements as one-of pills would make "Fire
 * or Water" unaskable; an empty selection is the resting state and narrows
 * nothing.
 *
 * THE LABEL IS THE WORD, NOT THE COLOUR. `element.ts` states the rule — "Colour
 * is never the only signal — the label always names the element" — and this
 * panel keeps it: each pill is the element's German name, and the element's
 * own hue is not used here at all. Series and element hues on one screen were
 * already ruled out (ADR-0035), and a filter panel is navigation chrome.
 *
 * AND IT SAYS WHAT IT CANNOT REACH. An element comes from a curated
 * `character_id` (ADR-0034), and the curation covers a small part of the
 * catalogue — 92 of 594 rows on staging when this was built. A filter that
 * silently dropped the other 85 % would be a trap, so the coverage is printed
 * under the pills and counted from the figures in the browser rather than
 * from a number in this file that would go stale.
 */
"use client";

import { ELEMENTS } from "@/lib/catalog/character";
import type { Element } from "@/lib/catalog/character";
import { elementLabel } from "@/lib/catalog/element";
import { type ElementSelection } from "@/lib/catalog/element-filter";
import { de } from "@/lib/i18n/de";

export function ElementFilter({
  selected,
  coverage,
  onToggle,
}: {
  selected: ElementSelection;
  /** How many of the loaded figures an element can be known for. */
  coverage: { withElement: number; total: number };
  onToggle: (element: Element) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {ELEMENTS.map((element) => {
          const isActive = selected.has(element);
          return (
            <button
              key={element}
              type="button"
              aria-pressed={isActive}
              onClick={() => onToggle(element)}
              className={
                "flex min-h-9 shrink-0 items-center rounded-full px-3 text-[12px] "
                + "whitespace-nowrap transition-colors "
                + (isActive
                  ? "bg-status-ground font-medium text-status-ink ring-1 ring-status-line"
                  : "bg-deep/50 text-muted ring-1 ring-border/50 hover:text-foreground hover:ring-border")
              }
            >
              {elementLabel(element)}
            </button>
          );
        })}
      </div>
      {/* The honest cost of the filter, in the data's own numbers. */}
      <p className="text-[11px] leading-snug text-muted">
        {de.catalog.elementCurated(coverage.withElement, coverage.total)}
      </p>
    </div>
  );
}
