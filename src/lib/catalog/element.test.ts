import { describe, expect, it } from "vitest";

import { ELEMENTS } from "./character.ts";
import {
  ELEMENT_LABELS,
  asElement,
  elementChipClass,
  elementPanelClass,
  elementLabel,
} from "./element.ts";
import { withCharacterElement } from "./queries.ts";
import type { CatalogFigure } from "@/lib/catalog/types";

function figure(overrides: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId: "SKY-0028",
    name: "Drobot",
    slug: "drobot",
    seriesCode: "SA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 0,
    categoryName: "Figuren",
    categoryId: 1,
    catalogGroup: "figure",
    catalogVisible: true,
    canonicalName: "",
    displayNameOverride: null,
    displayName: "Drobot",
    sortBaseName: "Drobot",
    sortVariantLabel: null,
    searchIndex: "drobot",
    marketPrice: 1.99,
    imageFile: null,
    isActive: true,
    element: null,
    characterId: null,
    ...overrides,
  };
}

describe("the element table", () => {
  it("covers exactly the ten canonical elements", () => {
    expect(Object.keys(ELEMENT_LABELS).sort()).toEqual([...ELEMENTS].sort());
  });

  it("gives every element a label, an accent and a chip", () => {
    for (const element of ELEMENTS) {
      expect(elementLabel(element), element).toBeTruthy();
      expect(elementChipClass(element), element).toContain("element-");

    }
  });

  it("keeps accent and chip apart — one paints, one writes", () => {
    expect(elementChipClass("Fire")).toMatch(/^text-/);
  });

  it("gives each element its own colour", () => {
    const chips = ELEMENTS.map((element) => elementChipClass(element));
    expect(new Set(chips).size).toBe(ELEMENTS.length);
  });

  it("reads in German while the values stay English", () => {
    // The keys are the canonical values the database stores; the labels are
    // the only user-facing part and follow the German UI (ADR-0019).
    expect(elementLabel("Magic")).toBe("Magie");
    expect(elementLabel("Tech")).toBe("Technologie");
    expect(elementLabel("Fire")).toBe("Feuer");
    expect(elementLabel("Light")).toBe("Licht");
    expect(elementLabel("Dark")).toBe("Dunkel");
  });

  it("keeps every canonical value untranslated as a key", () => {
    // A rename here would silently break the join to characters.element.
    expect(Object.keys(ELEMENT_LABELS)).toEqual([
      "Magic", "Tech", "Water", "Fire", "Life", "Undead", "Earth", "Air", "Light", "Dark",
    ]);
  });

  it("gives each element its own label", () => {
    expect(new Set(Object.values(ELEMENT_LABELS)).size).toBe(10);
  });
});

describe("asElement", () => {
  it("accepts the canonical values", () => {
    for (const element of ELEMENTS) expect(asElement(element)).toBe(element);
  });

  it("returns null for nothing, rather than a default", () => {
    expect(asElement(null)).toBeNull();
    expect(asElement(undefined)).toBeNull();
    expect(asElement("")).toBeNull();
  });

  it("returns null for a value outside the ten", () => {
    // Kaos belongs to his own element and must stay neutral (ADR-0034).
    expect(asElement("Kaos")).toBeNull();
    expect(asElement("Banana")).toBeNull();
    expect(asElement("fire")).toBeNull(); // the database CHECK is case exact
  });
});

describe("withCharacterElement", () => {
  const elements = new Map([
    [1, "Tech" as const],
    [2, "Fire" as const],
    [3, null],
  ]);

  it("attaches the curated element of a linked figure", () => {
    const [result] = withCharacterElement([figure({ characterId: 1 })], elements);
    expect(result.element).toBe("Tech");
  });

  it("leaves a figure without a character neutral", () => {
    // The whole point: 457 of 561 collectibles land here.
    const input = figure({ characterId: null, name: "Fire Kraken" });
    const [result] = withCharacterElement([input], elements);
    expect(result.element).toBeNull();
    expect(result).toBe(input); // untouched, not even a new object
  });

  it("never guesses from a name", () => {
    // "Fire Kraken" is a Water figure and "Light Hawk Owl" is a trap. Neither
    // has a character, so neither gets an element — no matter what it is
    // called.
    for (const name of ["Fire Kraken", "Light Hawk Owl", "Dark Spyro", "Magic Claw"]) {
      const [result] = withCharacterElement([figure({ name, displayName: name })], elements);
      expect(result.element, name).toBeNull();
    }
  });

  it("leaves a linked character without an element neutral", () => {
    // Kaos: linked, curated, and deliberately without one of the ten.
    const [result] = withCharacterElement([figure({ characterId: 3 })], elements);
    expect(result.element).toBeNull();
  });

  it("leaves a link to an unknown character neutral", () => {
    const [result] = withCharacterElement([figure({ characterId: 99 })], elements);
    expect(result.element).toBeNull();
  });

  it("is idempotent", () => {
    const once = withCharacterElement([figure({ characterId: 2 })], elements);
    const twice = withCharacterElement(once, elements);
    expect(twice[0]).toBe(once[0]);
  });
});

describe("the two element scales", () => {
  it("gives the ivory card its own ink, and dark panels the lighter set", () => {
    // Two grounds, two scales (ADR-0038, V3). Neither follows the colour
    // scheme, because neither of their grounds does.
    for (const element of ELEMENTS) {
      expect(elementChipClass(element), element).toContain("element-ink-");
      expect(elementPanelClass(element), element).not.toContain("element-ink-");
      expect(elementPanelClass(element), element).toContain("element-");
    }
  });

  it("keeps the two scales distinct for every element", () => {
    for (const element of ELEMENTS) {
      expect(elementChipClass(element)).not.toBe(elementPanelClass(element));
    }
  });

  it("names both as text colours, so the label stays the signal", () => {
    expect(elementChipClass("Fire")).toMatch(/^text-/);
    expect(elementPanelClass("Fire")).toMatch(/^text-/);
  });
});
