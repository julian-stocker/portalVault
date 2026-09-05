import { describe, expect, it } from "vitest";

import {
  NON_COLLECTIBLE_CATEGORIES,
  collectibleOnly,
  isCollectible,
  isCollectibleCategory,
} from "./collectible.ts";
import type { CatalogFigure } from "./types.ts";

function figure(categoryName: string, name = "Drobot"): CatalogFigure {
  return {
    skyId: "SKY-0001",
    name,
    slug: "drobot",
    seriesCode: "SA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 1,
    categoryName,
    marketPrice: 12.99,
    imageFile: null,
    displayName: name,
    sortBaseName: name,
    sortVariantLabel: null,
    searchIndex: name.toLowerCase(),
    isActive: true,
    element: null,
    characterId: null,
  };
}

describe("isCollectibleCategory", () => {
  it("rejects the games category", () => {
    expect(isCollectibleCategory("Spiele")).toBe(false);
  });

  it("accepts every physical category the catalog actually uses", () => {
    // The full set from the six series, verified against the database.
    const physical = [
      "Figuren",
      "Sidekicks",
      "Magic Items",
      "Giants große Figuren",
      "Giants neue Figuren",
      "Giants Series 2 Figuren",
      "SWAP Force",
      "Swap Force neue Figuren",
      "Varianten & LightCore",
      "Trap Masters",
      "Trap Team neue Figuren",
      "Trap Team Series Figuren",
      "Minis",
      "Trap Items",
      "Traps",
      "Trophies",
      "Fahrzeuge",
      "Senseis",
      "Locations & Truhen",
      "Kreationskristalle",
    ];
    for (const name of physical) {
      expect(isCollectibleCategory(name)).toBe(true);
    }
    // 20 physical categories plus "Spiele" in six series is the full 30.
    expect(physical.length).toBe(20);
  });

  it("is exact rather than fuzzy, so a category merely containing the word stays collectible", () => {
    expect(isCollectibleCategory("Spielfiguren")).toBe(true);
    expect(isCollectibleCategory("spiele")).toBe(true);
  });
});

describe("isCollectible", () => {
  it("classifies a game as not collectible", () => {
    expect(isCollectible(figure("Spiele", "Game (Xbox 360)"))).toBe(false);
    expect(isCollectible(figure("Spiele", "Wii U Spiel"))).toBe(false);
  });

  it("classifies a figure as collectible", () => {
    expect(isCollectible(figure("Figuren"))).toBe(true);
  });

  it("does not look at the name — the category decides", () => {
    // A figure whose name mentions a console is still a figure.
    expect(isCollectible(figure("Magic Items", "Nintendo Sammelstück"))).toBe(true);
    // And a game with an innocuous name is still a game.
    expect(isCollectible(figure("Spiele", "Irgendwas"))).toBe(false);
  });
});

describe("collectibleOnly", () => {
  it("removes games and keeps the order", () => {
    const figures = [
      figure("Spiele", "Game (PC)"),
      figure("Figuren", "Bash"),
      figure("Spiele", "Wii Spiel"),
      figure("Traps", "Air Hourglass"),
    ];
    expect(collectibleOnly(figures).map((f) => f.name)).toEqual(["Bash", "Air Hourglass"]);
  });

  it("returns everything when nothing is excluded", () => {
    const figures = [figure("Figuren"), figure("Traps")];
    expect(collectibleOnly(figures)).toHaveLength(2);
  });

  it("returns an empty list rather than throwing when everything is excluded", () => {
    expect(collectibleOnly([figure("Spiele"), figure("Spiele")])).toEqual([]);
  });
});

describe("the rule stays a category rule", () => {
  it("excludes exactly one category name", () => {
    // Growing this set is a deliberate act, not something that should happen
    // by accident. The coupling to the legacy category names is documented in
    // collectible.ts and docs/SKYLANDERS_DATA.md.
    expect([...NON_COLLECTIBLE_CATEGORIES]).toEqual(["Spiele"]);
  });
});
