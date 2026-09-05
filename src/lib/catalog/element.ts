/**
 * How an element is shown.
 *
 * Presentation only. This module knows nothing about where an element comes
 * from — that is always `characters.element`, curated by hand (ADR-0034).
 * Nothing here derives an element from a name, a category, a series or a
 * variant, and there is no fallback: no character, or a character without a
 * reliable element, means no element is shown. That is the normal case for
 * 457 of the 561 collectibles and must never look unfinished.
 *
 * The class strings are written out in full rather than composed, because
 * Tailwind only emits classes it can see literally in the source. That is
 * also why there is exactly one table for both the card and the character
 * panel: a second one would drift.
 */
import { ELEMENTS, type Element } from "@/lib/catalog/character";

/**
 * The label shown to a reader.
 *
 * The one place where the element becomes user-facing text, and therefore
 * German (ADR-0019). The keys stay the canonical English values used by the
 * database, the curated file and every type — only the reading changes.
 * A second table anywhere would be a second truth.
 */
export const ELEMENT_LABELS: Readonly<Record<Element, string>> = {
  Magic: "Magie",
  Tech: "Technologie",
  Water: "Wasser",
  Fire: "Feuer",
  Life: "Leben",
  Undead: "Untot",
  Earth: "Erde",
  Air: "Luft",
  Light: "Licht",
  Dark: "Dunkel",
};

/**
 * The element's colour on the ivory collectible card.
 *
 * Two scales exist because there are two grounds (ADR-0038, V3): `ink` is
 * tuned for the card and the plate, the plain names for dark panels. Neither
 * follows the colour scheme, because neither of their grounds does.
 *
 * Colour is never the only signal — the label always names the element.
 */
const CHIP: Readonly<Record<Element, string>> = {
  Magic: "text-element-ink-magic",
  Tech: "text-element-ink-tech",
  Water: "text-element-ink-water",
  Fire: "text-element-ink-fire",
  Life: "text-element-ink-life",
  Undead: "text-element-ink-undead",
  Earth: "text-element-ink-earth",
  Air: "text-element-ink-air",
  Light: "text-element-ink-light",
  Dark: "text-element-ink-dark",
};

/** The same ten, tuned for the dark panels: detail page, character panel. */
const PANEL: Readonly<Record<Element, string>> = {
  Magic: "text-element-magic",
  Tech: "text-element-tech",
  Water: "text-element-water",
  Fire: "text-element-fire",
  Life: "text-element-life",
  Undead: "text-element-undead",
  Earth: "text-element-earth",
  Air: "text-element-air",
  Light: "text-element-light",
  Dark: "text-element-dark",
};

/**
 * Narrows a stored value to a known element.
 *
 * The database CHECK already restricts the column, so this guards against
 * the one thing a CHECK cannot: a value arriving from somewhere it should
 * not have. An unknown value yields null — never a default colour.
 */
export function asElement(value: string | null | undefined): Element | null {
  if (typeof value !== "string") return null;
  return (ELEMENTS as readonly string[]).includes(value) ? (value as Element) : null;
}

export function elementLabel(element: Element): string {
  return ELEMENT_LABELS[element];
}

/** On the ivory card. */
export function elementChipClass(element: Element): string {
  return CHIP[element];
}

/** On a dark panel — the detail page and the character panel. */
export function elementPanelClass(element: Element): string {
  return PANEL[element];
}
