/**
 * "Only figures of this element" (UX-01F).
 *
 * A narrowing of the same pool, like `ownership.ts` and `availability.ts`
 * beside it, and it knows about one field and nothing else — which is what
 * lets it combine with series, search, group, ownership and availability
 * without any of them knowing it exists.
 *
 * THE HONEST PART, AND IT HAS TO BE SAID ON SCREEN. An element is a property
 * of the CHARACTER, not of the collectible (ADR-0034), and it reaches a
 * figure only through a curated `character_id`. That curation is a long way
 * from finished: on staging, **92 of 594 catalogue rows have a character**,
 * measured rather than assumed. So filtering by element does not narrow the
 * catalogue — it narrows to the curated seventh of it and silently drops the
 * rest.
 *
 * That is a real answer to a real question ("which Fire figures do I own"),
 * so the filter exists. But a control that hides 85 % of a catalogue without
 * saying so is a trap, which is why the panel prints the coverage next to it
 * and `elementCoverage()` computes it from the data in the browser rather
 * than from a number written here that would go stale.
 *
 * MULTIPLE ELEMENTS, NOT ONE. Ten elements as exclusive pills would make
 * "Fire or Water" unaskable and would turn a ten-item list into ten clicks to
 * compare two. An empty selection is the resting state and means "no
 * narrowing" — never "no element".
 */
import type { Element } from "@/lib/catalog/character";
import type { CatalogFigure } from "@/lib/catalog/types";

export type ElementSelection = ReadonlySet<Element>;

/** The resting state: no element chosen, nothing narrowed. */
export const NO_ELEMENTS: ElementSelection = new Set<Element>();

export function isElementActive(selected: ElementSelection): boolean {
  return selected.size > 0;
}

/**
 * Does this figure belong in the chosen elements?
 *
 * A figure with no character has no element, and it does NOT match once any
 * element is chosen. That is the narrowing doing what it says — but it is
 * also why the coverage is printed: "no element" is the common case, not an
 * exception.
 */
export function matchesElement(
  figure: Pick<CatalogFigure, "element">,
  selected: ElementSelection,
): boolean {
  if (selected.size === 0) return true;
  return figure.element !== null && selected.has(figure.element);
}

/**
 * How much of a catalogue this filter can ever reach.
 *
 * Counted from the figures in the browser, so the number on screen is the
 * number for the catalogue the visitor actually has — an administrator's
 * includes hidden rows, a collector's does not.
 */
export function elementCoverage(
  figures: readonly Pick<CatalogFigure, "element">[],
): { withElement: number; total: number } {
  let withElement = 0;
  for (const figure of figures) if (figure.element !== null) withElement += 1;
  return { withElement, total: figures.length };
}

/** Adds or removes one element, returning a new set. */
export function toggleElement(selected: ElementSelection, element: Element): Set<Element> {
  const next = new Set(selected);
  if (next.has(element)) next.delete(element);
  else next.add(element);
  return next;
}
