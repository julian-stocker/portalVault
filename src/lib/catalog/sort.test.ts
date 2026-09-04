import { describe, expect, it } from "vitest";

import { sortFigures } from "./sort.ts";
import type { CatalogFigure } from "./types.ts";

function figure(
  name: string,
  seriesPosition: number,
  categoryPosition: number,
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
    marketPrice: null,
    imageFile: null,
    isActive: true,
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
