import { describe, expect, it } from "vitest";

import { sortFigures } from "./sort.ts";
import type { CatalogFigure } from "./types.ts";

function figure(
  name: string,
  seriesPosition: number,
  categoryPosition: number,
  variant?: { base: string; label: string },
  cardType: CatalogFigure["cardType"] = "standard",
): CatalogFigure {
  return {
    skyId: `SKY-${String(seriesPosition * 100 + categoryPosition).padStart(4, "0")}`,
    name,
    slug: name.toLowerCase(),
    seriesCode: "X",
    seriesLabel: "X",
    seriesPosition,
    categoryPosition,
    categoryName: "Figuren",
    categoryId: 1,
    catalogGroup: "figure",
    cardType,
    catalogVisible: true,
    canonicalName: "",
    displayNameOverride: null,
    marketPrice: null,
    imageFile: null,
    imageOverridePath: null,
    isActive: true,
    element: null,
    characterId: null,
    displayName: variant ? `${variant.label} ${variant.base}` : name,
    sortBaseName: variant ? variant.base : name,
    sortVariantLabel: variant ? variant.label : null,
    searchIndex: name.toLowerCase(),
  };
}

describe("sortFigures", () => {
  it("orders by series first", () => {
    const result = sortFigures([figure("A", 2, 0), figure("B", 0, 0), figure("C", 1, 0)]);
    expect(result.map((f) => f.name)).toEqual(["B", "C", "A"]);
  });

  it("orders by category within a series", () => {
    const result = sortFigures([figure("A", 0, 3), figure("B", 0, 1), figure("C", 0, 2)]);
    expect(result.map((f) => f.name)).toEqual(["B", "C", "A"]);
  });

  it("orders by name within a category, using German collation", () => {
    const result = sortFigures([figure("Zook", 0, 0), figure("Ätna", 0, 0), figure("Bash", 0, 0)]);
    // "Ä" sorts next to "A", not after "Z".
    expect(result.map((f) => f.name)).toEqual(["Ätna", "Bash", "Zook"]);
  });

  it("puts a base figure before its variants (ADR-0030)", () => {
    const result = sortFigures([
      figure("Legendary Astroblast", 0, 0, { base: "Astroblast", label: "Legendary" }),
      figure("Astroblast", 0, 0),
    ]);
    expect(result.map((f) => f.displayName)).toEqual(["Astroblast", "Legendary Astroblast"]);
  });

  it("orders several variants of one figure by their label", () => {
    const result = sortFigures([
      figure("Legendary Bash", 0, 0, { base: "Bash", label: "Legendary" }),
      figure("Bash", 0, 0),
      figure("Blue Bash", 0, 0, { base: "Bash", label: "Blue" }),
    ]);
    expect(result.map((f) => f.displayName)).toEqual([
      "Bash",
      "Blue Bash",
      "Legendary Bash",
    ]);
  });

  it("is not split apart by another figure starting with the same word", () => {
    // "Bash Junior" sorts after the whole Bash family rather than between
    // the base and its variant.
    const result = sortFigures([
      figure("Bash Junior", 0, 0),
      figure("Legendary Bash", 0, 0, { base: "Bash", label: "Legendary" }),
      figure("Bash", 0, 0),
    ]);
    expect(result.map((f) => f.displayName)).toEqual([
      "Bash",
      "Legendary Bash",
      "Bash Junior",
    ]);
  });

  it("does not mutate the input", () => {
    const input = [figure("B", 1, 0), figure("A", 0, 0)];
    const copy = [...input];
    sortFigures(input);
    expect(input).toEqual(copy);
  });

  it("puts series before category before name", () => {
    const result = sortFigures([
      figure("Aaa", 1, 0),
      figure("Zzz", 0, 1),
      figure("Mmm", 0, 0),
    ]);
    expect(result.map((f) => f.name)).toEqual(["Mmm", "Zzz", "Aaa"]);
  });
});

/**
 * A family stays a family (V3.6).
 *
 * The display name now begins with the variant label — "Blue Bash", not
 * "Bash (Blue)" — and that changed nothing here, because nothing here has ever
 * read the display name. `sortBaseName` is the truth, and it is still the BASE.
 */
describe("the Bash block", () => {
  const bash = () => [
    figure("Legendary Bash", 0, 0, { base: "Bash", label: "Legendary" }, "legendary"),
    figure("Blue Bash", 0, 0, { base: "Bash", label: "Blue" }, "special"),
    figure("Bash", 0, 0),
    figure("Chill Light Core", 0, 0, undefined, "special"),
  ];

  it("keeps Bash, Blue Bash and Legendary Bash together, under Bash", () => {
    /*
     * The failure this guards: sorting by what a visitor sees would file
     * "Blue Bash" under B-l-u-e and "Legendary Bash" under L, scattering one
     * figure's family across the alphabet. "Chill Light Core" is here to prove
     * the block is contiguous and not merely sorted.
     */
    const order = sortFigures(bash()).map((f) => f.displayName);
    expect(order).toEqual(["Bash", "Blue Bash", "Legendary Bash", "Chill Light Core"]);
  });

  it("orders one family by edition, not by label", () => {
    /*
     * standard · special · chase · dark · legendary · prestige — the
     * operator's order. Alphabetically the labels would run Blue, Chase, Dark,
     * Legendary, which happens to agree; "Zebra" proves it is the type that
     * decides and not the word.
     */
    const family = [
      figure("Legendary Spyro", 0, 0, { base: "Spyro", label: "Legendary" }, "legendary"),
      figure("Zebra Spyro", 0, 0, { base: "Spyro", label: "Zebra" }, "special"),
      figure("Dark Spyro", 0, 0, { base: "Spyro", label: "Dark" }, "dark"),
      figure("Spyro", 0, 0),
      figure("Pearl Spyro", 0, 0, { base: "Spyro", label: "Pearl" }, "chase"),
    ];
    expect(sortFigures(family).map((f) => f.cardType)).toEqual([
      "standard",
      "special",
      "chase",
      "dark",
      "legendary",
    ]);
  });

  it("breaks a tie inside one edition with the label", () => {
    const two = [
      figure("Molten Hot Dog", 0, 0, { base: "Hot Dog", label: "Molten" }, "chase"),
      figure("Bronze Hot Dog", 0, 0, { base: "Hot Dog", label: "Bronze" }, "chase"),
      figure("Hot Dog", 0, 0),
    ];
    expect(sortFigures(two).map((f) => f.displayName)).toEqual([
      "Hot Dog",
      "Bronze Hot Dog",
      "Molten Hot Dog",
    ]);
  });

  it("does not read the display name at all", () => {
    // Two figures whose displayed names sort the other way round from their
    // bases. The base wins.
    const pair = [
      figure("Zulu Aardvark", 0, 0, { base: "Aardvark", label: "Zulu" }, "special"),
      figure("Bash", 0, 0),
    ];
    expect(sortFigures(pair).map((f) => f.sortBaseName)).toEqual(["Aardvark", "Bash"]);
    expect(sortFigures(pair).map((f) => f.displayName)).toEqual(["Zulu Aardvark", "Bash"]);
  });
});
