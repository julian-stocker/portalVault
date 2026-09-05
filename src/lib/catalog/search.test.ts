import { describe, expect, it } from "vitest";

import {
  ALL_SERIES,
  buildSearchIndex,
  filterFigures,
  groupSearchResults,
  matchesQuery,
  normalizeForSearch,
  ownedFigures,
} from "./search.ts";
import type { CatalogFigure } from "./types.ts";
import { displayNameFor, parseVariant, searchFormsFor, sortPartsFor } from "./variant.ts";

/**
 * Builds a figure the way the query layer does, so the derived fields are
 * real rather than hand-written.
 */
function figure(overrides: Partial<CatalogFigure> = {}, namesInSeries: string[] = []): CatalogFigure {
  const name = overrides.name ?? "Drobot";
  const variant = parseVariant(name, new Set(namesInSeries));
  const parts = sortPartsFor(name, variant);
  return {
    skyId: "SKY-0001",
    name: "Drobot",
    slug: "drobot",
    seriesCode: "SA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 1,
    categoryName: "Figuren",
    marketPrice: 12.99,
    imageFile: "00ef420dacfdcd4f.webp",
    isActive: true,
    element: null,
    characterId: null,
    displayName: displayNameFor(name, variant),
    sortBaseName: parts.sortBaseName,
    sortVariantLabel: parts.sortVariantLabel,
    searchIndex: buildSearchIndex(searchFormsFor(name, variant)),
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

describe("matchesQuery across variant spellings (ADR-0030)", () => {
  const legendaryBash = figure({ skyId: "SKY-0008", name: "Legendary Bash" }, ["Bash"]);

  it("finds the figure by its canonical name", () => {
    expect(matchesQuery(legendaryBash, normalizeForSearch("Legendary Bash"))).toBe(true);
    expect(matchesQuery(legendaryBash, normalizeForSearch("legendary"))).toBe(true);
  });

  it("finds it by the displayed name", () => {
    expect(matchesQuery(legendaryBash, normalizeForSearch("Bash (Legendary)"))).toBe(true);
  });

  it("finds it by the plain word order in between", () => {
    expect(matchesQuery(legendaryBash, normalizeForSearch("Bash Legendary"))).toBe(true);
  });

  it("still finds it by the base name alone", () => {
    expect(matchesQuery(legendaryBash, normalizeForSearch("bash"))).toBe(true);
  });

  it("does not match an unrelated query", () => {
    expect(matchesQuery(legendaryBash, normalizeForSearch("spyro"))).toBe(false);
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

describe("groupSearchResults — searching past the active tab", () => {
  const SERIES = [
    { code: "SA", label: "Spyro's Adventure" },
    { code: "G", label: "Giants" },
    { code: "SF", label: "Swap Force" },
  ];
  const make = (skyId: string, name: string, seriesCode: string): CatalogFigure => ({
    skyId,
    name,
    slug: skyId.toLowerCase(),
    seriesCode,
    seriesLabel: seriesCode,
    seriesPosition: 0,
    categoryPosition: 0,
    categoryName: "Figuren",
    displayName: name,
    sortBaseName: name,
    sortVariantLabel: null,
    searchIndex: buildSearchIndex([name]),
    marketPrice: 10,
    imageFile: null,
    isActive: true,
    element: null,
    characterId: null,
  });
  const figures = [
    make("SKY-0001", "Drobot", "SA"),
    make("SKY-0002", "Bash", "SA"),
    make("SKY-0100", "LightCore Drobot", "G"),
    make("SKY-0200", "Drobot Redux", "SF"),
  ];

  it("answers with the active game first", () => {
    const groups = groupSearchResults(figures, { query: "drobot", seriesCode: "SA", series: SERIES });
    expect(groups[0]).toMatchObject({ code: "SA", active: true });
    expect(groups[0].figures.map((f) => f.skyId)).toEqual(["SKY-0001"]);
  });

  it("then the other games, in the order the database gave", () => {
    const groups = groupSearchResults(figures, { query: "drobot", seriesCode: "SA", series: SERIES });
    expect(groups.map((g) => g.code)).toEqual(["SA", "G", "SF"]);
    expect(groups.every((g) => g.code === "SA" || !g.active)).toBe(true);
  });

  it("never renders a game with no hits", () => {
    const groups = groupSearchResults(figures, { query: "bash", seriesCode: "SA", series: SERIES });
    expect(groups.map((g) => g.code)).toEqual(["SA"]);
  });

  it("keeps the active game even with nothing in it, so the answer is visible", () => {
    // "Nothing in Spyro's Adventure, but two elsewhere" is the useful answer.
    const groups = groupSearchResults(figures, { query: "drobot", seriesCode: "G", series: SERIES });
    expect(groups[0]).toMatchObject({ code: "G", active: true });
    expect(groups.map((g) => g.code)).toEqual(["G", "SA", "SF"]);
  });

  it("puts the active game first even when it is last in the database order", () => {
    const groups = groupSearchResults(figures, { query: "drobot", seriesCode: "SF", series: SERIES });
    expect(groups.map((g) => g.code)).toEqual(["SF", "SA", "G"]);
  });

  it("an empty query is every figure, still grouped", () => {
    const groups = groupSearchResults(figures, { query: "", seriesCode: "SA", series: SERIES });
    expect(groups.flatMap((g) => g.figures)).toHaveLength(4);
  });

  it("finds nothing without inventing a group", () => {
    const groups = groupSearchResults(figures, { query: "zzz", seriesCode: "SA", series: SERIES });
    expect(groups).toHaveLength(1);
    expect(groups[0].figures).toEqual([]);
  });
});

/**
 * "In Besitz" (ADR-0038, V4.2).
 *
 * The catalog's one view filter. It narrows the pool the rest of the catalog
 * works from, which is what makes it hold across the grid, the search and the
 * cross-series results without a second code path.
 */
describe("the ownership filter", () => {
  const catalog = [
    figure({ skyId: "SKY-0001", name: "Bash", seriesCode: "SA" }),
    figure({ skyId: "SKY-0002", name: "Boomer", seriesCode: "SA" }),
    figure({ skyId: "SKY-0100", name: "Bouncer", seriesCode: "GI" }),
    figure({ skyId: "SKY-0200", name: "Blast Zone", seriesCode: "SF" }),
  ];
  const owned = new Set(["SKY-0002", "SKY-0100"]);

  it("keeps only what is owned, in catalog order", () => {
    expect(ownedFigures(catalog, owned).map((f) => f.skyId)).toEqual(["SKY-0002", "SKY-0100"]);
  });

  it("crosses series: the filter is about ownership, not about a game", () => {
    const codes = ownedFigures(catalog, owned).map((f) => f.seriesCode);
    expect(new Set(codes)).toEqual(new Set(["SA", "GI"]));
  });

  it("changes nothing about the figures themselves", () => {
    // Display only: no rewriting, no reordering, the same objects.
    const [first] = ownedFigures(catalog, owned);
    expect(first).toBe(catalog[1]);
  });

  it("returns nothing rather than everything when nothing is owned", () => {
    // The failure that matters: an empty set must not read as "no filter".
    expect(ownedFigures(catalog, new Set())).toEqual([]);
  });

  it("still searches inside the narrowed pool", () => {
    // Both "B" figures in SA match the query; only the owned one survives.
    const pool = ownedFigures(catalog, owned);
    const hits = filterFigures(pool, { query: "bo", seriesCode: "SA" });
    expect(hits.map((f) => f.skyId)).toEqual(["SKY-0002"]);
  });

  it("keeps the cross-series search grouped, with the active game first", () => {
    const pool = ownedFigures(catalog, owned);
    const groups = groupSearchResults(pool, {
      query: "bo",
      seriesCode: "GI",
      series: [
        { code: "SA", label: "Spyro's Adventure" },
        { code: "GI", label: "Giants" },
        { code: "SF", label: "Swap Force" },
      ],
    });
    expect(groups[0]?.code).toBe("GI");
    expect(groups.flatMap((g) => g.figures.map((f) => f.skyId))).toEqual([
      "SKY-0100",
      "SKY-0002",
    ]);
  });

  it("survives a cleared search: the pool is not rebuilt by typing", () => {
    const pool = ownedFigures(catalog, owned);
    expect(filterFigures(pool, { query: "", seriesCode: "SA" }).map((f) => f.skyId)).toEqual([
      "SKY-0002",
    ]);
  });
});
