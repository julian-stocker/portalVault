import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

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
    categoryId: 1,
    catalogGroup: "figure",
    cardType: "standard",
    catalogVisible: true,
    canonicalName: name,
    displayNameOverride: null,
    marketPrice: 12.99,
    imageFile: null,
    imageOverridePath: null,
    displayName: name,
    sortBaseName: name,
    sortVariantLabel: null,
    searchIndex: name.toLowerCase(),
    isActive: true,
    element: null,
    characterId: null,
    baseSkyId: null,
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

describe("the rule is a category rule — and since 0137 also an item-type rule", () => {
  it("excludes exactly these five category names, in this order", () => {
    // Growing this set is a deliberate act, not something that should happen
    // by accident. The coupling to the legacy category names is documented in
    // collectible.ts and docs/SKYLANDERS_DATA.md.
    //
    // `Spiele` kommt aus der Legacy-Quelle; die vier anderen entstehen erst
    // mit `0137` und tragen heute keine Zeile — genau das ist die Bedingung,
    // unter der die Migration laufen darf.
    expect([...NON_COLLECTIBLE_CATEGORIES]).toEqual([
      "Spiele", "Portale", "Bundles", "Taschen", "Zubehör",
    ]);
  });

  it("die SQL-Fassung nennt genau dieselben Namen (0137)", () => {
    /* `verify:shop` vergleicht beide zur Laufzeit gegen die Datenbank. Hier
       wird der TEXT verglichen, damit eine Abweichung schon im Testlauf
       auffällt und nicht erst gegen eine Umgebung. */
    const sql = readFileSync("supabase/migrations/0137_catalog_accessories.sql", "utf8");
    const liste = [...NON_COLLECTIBLE_CATEGORIES].map((n) => `'${n}'`).join(", ");
    expect(sql).toContain(`select array[${liste}]::text[];`);
  });

  it("ein Artikeltyp ausser figure ist nicht sammelbar, egal in welcher Kategorie", () => {
    /* Der zweite Riegel. Er greift auch dann, wenn jemand eine Kategorie
       anders benennt als die fünf Namen oben. */
    expect(isCollectible({ categoryName: "Figuren", itemType: "portal" })).toBe(false);
    expect(isCollectible({ categoryName: "Senseis", itemType: "game" })).toBe(false);
    expect(isCollectible({ categoryName: "Traps", itemType: "bundle" })).toBe(false);
    expect(isCollectible({ categoryName: "Traps", itemType: "other" })).toBe(false);
  });

  it("figure bleibt sammelbar, und eine fehlende Auskunft ändert nichts", () => {
    expect(isCollectible({ categoryName: "Figuren", itemType: "figure" })).toBe(true);
    /* `undefined` heisst „keine Auskunft", nicht „keine Figur": ein Aufrufer,
       der die Spalte nicht gelesen hat, bekommt das Verhalten von vor 0137. */
    expect(isCollectible({ categoryName: "Figuren" })).toBe(true);
    expect(isCollectible({ categoryName: "Figuren", itemType: null })).toBe(true);
    /* Und die Kategorie behält das letzte Wort, wenn der Typ figure sagt —
       `SKY-9998` steht als Fixture in `SA`/`Spiele`. */
    expect(isCollectible({ categoryName: "Spiele", itemType: "figure" })).toBe(false);
  });
});
