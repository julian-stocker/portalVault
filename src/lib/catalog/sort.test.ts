import { describe, expect, it } from "vitest";

import { sortFigures } from "./sort.ts";
import type { CatalogFigure } from "./types.ts";

function figure(
  name: string,
  seriesPosition: number,
  categoryPosition: number,
  variant?: { base: string; label: string },
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
    catalogVisible: true,
    canonicalName: "",
    displayNameOverride: null,
    marketPrice: null,
    imageFile: null,
    imageOverridePath: null,
    isActive: true,
    element: null,
    characterId: null,
    displayName: variant ? `${variant.base} (${variant.label})` : name,
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
    expect(result.map((f) => f.displayName)).toEqual(["Astroblast", "Astroblast (Legendary)"]);
  });

  it("orders several variants of one figure by their label", () => {
    const result = sortFigures([
      figure("Legendary Bash", 0, 0, { base: "Bash", label: "Legendary" }),
      figure("Bash", 0, 0),
      figure("Blue Bash", 0, 0, { base: "Bash", label: "Blue" }),
    ]);
    expect(result.map((f) => f.displayName)).toEqual([
      "Bash",
      "Bash (Blue)",
      "Bash (Legendary)",
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
      "Bash (Legendary)",
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
