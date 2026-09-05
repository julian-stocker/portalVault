import { describe, expect, it } from "vitest";

import { ELEMENTS, ROLE_TYPES } from "@/lib/catalog/character";
import { ELEMENT_LABELS } from "@/lib/catalog/element";
import { de } from "./de.ts";

/**
 * Every stored value that reaches the screen needs a German reading.
 *
 * These are the two enums the database constrains. Adding a value to either
 * without adding a label would not fail a build — the row would simply
 * render nothing, quietly. That is what this catches.
 */
describe("labels cover every stored value", () => {
  it("names all eight product lines", () => {
    for (const role of ROLE_TYPES) {
      expect(de.character.roles[role], role).toBeTruthy();
    }
    expect(Object.keys(de.character.roles).sort()).toEqual([...ROLE_TYPES].sort());
  });

  it("names all ten elements", () => {
    for (const element of ELEMENTS) {
      expect(ELEMENT_LABELS[element], element).toBeTruthy();
    }
  });
});

describe("the wording carries the meaning", () => {
  it("calls the role the original one", () => {
    // Mini Jini debuted as a Giants sidekick and returned as a Trap Team
    // mini. The stored value is the character's first role, not the role of
    // the collectible being looked at (ADR-0034).
    expect(de.character.role).toBe("Ursprüngliche Rolle");
  });

  it("calls the derived series the first figure, not a debut", () => {
    // Kaos has been the villain since 2011; his first figure is from
    // Imaginators. "Debüt" would be wrong for him, "Erste Figur" is not.
    expect(de.character.firstRelease).toBe("Erste Figur");
    expect(de.character.firstRelease).not.toContain("Debüt");
  });

  it("calls the price a market value, never a purchase", () => {
    // A reference value, not a shop price (ADR-0033).
    expect(de.catalog.marketValue).toBe("Marktwert");
    for (const word of ["Preis", "Kaufen", "kaufen"]) {
      expect(de.catalog.marketValue).not.toContain(word);
    }
  });

  it("has no price of zero anywhere — unknown is not free", () => {
    // ADR-0010: null means "no known market price" and never 0.
    expect(de.catalog.noPrice).not.toMatch(/0[.,]00/);
  });
});
