import { describe, expect, it } from "vitest";

import { ALL_SERIES, filterFigures, matchesQuery, normalizeForSearch } from "./search.ts";
import type { CatalogFigure } from "./types.ts";

function figure(overrides: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId: "SKY-0001",
    name: "Drobot",
    slug: "drobot",
    seriesCode: "SA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 1,
    marketPrice: 12.99,
    imageFile: "00ef420dacfdcd4f.webp",
    isActive: true,
    ...overrides,
  };
}

describe("normalizeForSearch", () => {
  it("lowercases and trims", () => {
    expect(normalizeForSearch("  Drobot  ")).toBe("drobot");
  });

  it("spells out umlauts so 'fuer' finds 'für' either way round", () => {
    expect(normalizeForSearch("Spiel für Xbox One")).toBe("spiel fuer xbox one");
    expect(normalizeForSearch("fuer")).toBe("fuer");
  });

  it("drops apostrophes so 'Spyros' finds \"Spyro's\"", () => {
    expect(normalizeForSearch("Spyro's Adventure")).toBe("spyros adventure");
  });

  it("keeps spaces, digits and hyphens", () => {
    expect(normalizeForSearch("Game (Xbox 360)")).toBe("game (xbox 360)");
    expect(normalizeForSearch("Wham-Shell")).toBe("wham-shell");
  });
});

describe("matchesQuery", () => {
  it("matches a substring anywhere in the name", () => {
    expect(matchesQuery(figure({ name: "Trigger Happy" }), "happy")).toBe(true);
    expect(matchesQuery(figure({ name: "Trigger Happy" }), "igge")).toBe(true);
  });

  it("matches everything when the query is empty", () => {
    expect(matchesQuery(figure(), "")).toBe(true);
  });

  it("finds an umlaut name typed without the umlaut", () => {
    expect(matchesQuery(figure({ name: "Spiel für Xbox One" }), "fuer")).toBe(true);
  });

  it("finds an apostrophe name typed without it", () => {
    expect(matchesQuery(figure({ name: "Spyro's Adventure Wii" }), "spyros")).toBe(true);
  });

  it("does not match something absent", () => {
    expect(matchesQuery(figure({ name: "Drobot" }), "bash")).toBe(false);
  });
});

describe("filterFigures", () => {
  const figures = [
    figure({ skyId: "SKY-0001", name: "Drobot", seriesCode: "SA" }),
    figure({ skyId: "SKY-0100", name: "Drobot", seriesCode: "G" }),
    figure({ skyId: "SKY-0002", name: "Bash", seriesCode: "SA" }),
    figure({ skyId: "SKY-0300", name: "Bat Spin", seriesCode: "T" }),
  ];

  it("returns everything with no filters", () => {
    expect(filterFigures(figures, {})).toHaveLength(4);
    expect(filterFigures(figures, { seriesCode: ALL_SERIES })).toHaveLength(4);
  });

  it("filters by series", () => {
    expect(filterFigures(figures, { seriesCode: "SA" }).map((f) => f.skyId)).toEqual([
      "SKY-0001",
      "SKY-0002",
    ]);
  });

  it("filters by query across series", () => {
    expect(filterFigures(figures, { query: "drobot" })).toHaveLength(2);
  });

  it("combines both", () => {
    const result = filterFigures(figures, { query: "drobot", seriesCode: "G" });
    expect(result.map((f) => f.skyId)).toEqual(["SKY-0100"]);
  });

  it("returns an empty list rather than throwing when nothing matches", () => {
    expect(filterFigures(figures, { query: "nichts davon" })).toEqual([]);
  });

  it("keeps the incoming order", () => {
    expect(filterFigures(figures, { query: "ba" }).map((f) => f.name)).toEqual(["Bash", "Bat Spin"]);
  });
});
