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

/** The 2 px accent bar. Sits on `surface`, so the theme-aware token fits. */
const ACCENT: Readonly<Record<Element, string>> = {
  Magic: "bg-element-magic",
  Tech: "bg-element-tech",
  Water: "bg-element-water",
  Fire: "bg-element-fire",
  Life: "bg-element-life",
  Undead: "bg-element-undead",
  Earth: "bg-element-earth",
  Air: "bg-element-air",
  Light: "bg-element-light",
  Dark: "bg-element-dark",
};

/**
 * The badge text colour. The badge outline is drawn from `currentColor`, so
 * one token carries both and the pair can never disagree.
 */
const CHIP: Readonly<Record<Element, string>> = {
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

export function elementAccentClass(element: Element): string {
  return ACCENT[element];
}

export function elementChipClass(element: Element): string {
  return CHIP[element];
}
