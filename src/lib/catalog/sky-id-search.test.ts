import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { filterFigures, groupSearchResults, skyIdQuery } from "./search";
import { sortFigures } from "./sort";
import type { CatalogFigure } from "./types";

/**
 * CAT-18 — die SKY-ID-Suche im Admin-Katalog.
 */

function figur(skyId: string, name: string, over: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId, name, slug: skyId.toLowerCase(), seriesCode: "G", seriesLabel: "Giants",
    seriesPosition: 1, categoryPosition: 1, categoryName: "Figuren", categoryId: 1,
    catalogGroup: "figure", cardType: "standard", itemType: "figure", characterId: null,
    element: null, imageFile: null, imageOverridePath: null, displayNameOverride: null,
    displayName: name, sortBaseName: name, sortVariantLabel: null,
    searchIndex: name.toLowerCase(), marketPrice: null, catalogVisible: true,
    baseSkyId: null, types: [], visibleType: null, ...over,
  } as CatalogFigure;
}

const KATALOG = sortFigures([
  figur("SKY-0147", "Sprocket"),
  figur("SKY-0850", "Sparkle Sprocket", { baseSkyId: "SKY-0147", types: ["chase"],
                                          visibleType: "chase", sortBaseName: "Sprocket" }),
  figur("SKY-0014", "Camo"),
  figur("SKY-1470", "Zukunft"),
  figur("SKY-0471", "Power Blue Trigger Happy", { seriesCode: "SC", seriesPosition: 4 }),
  figur("SKY-0900", "Portal 147 Edition"),
  figur("SKY-0901", "Portal 84709790", { seriesCode: "SF", seriesLabel: "Swap Force",
                                          seriesPosition: 2 }),
]);
const ids = (liste: CatalogFigure[]) => liste.map((f) => f.skyId);
const admin = (query: string) => ids(filterFigures(KATALOG, { query, skyIds: true }));

describe("eine Eingabe als SKY-ID", () => {
  it.each([
    ["SKY-0147", "SKY-0147", true], ["sky-0147", "SKY-0147", true], ["Sky-147", "SKY-0147", true],
    ["sky 147", "SKY-0147", true], ["SKY0147", "SKY-0147", true], ["  SKY-0147 ", "SKY-0147", true],
    ["0147", "SKY-0147", false], ["147", "SKY-0147", false], ["7", "SKY-0007", false],
  ])("%s → %s", (eingabe, erwartet, exklusiv) => {
    expect(skyIdQuery(eingabe)).toEqual({ skyId: erwartet, exclusive: exklusiv });
  });

  it("fünf und mehr Ziffern sind keine SKY-ID, Namen sowieso nicht", () => {
    for (const q of ["84709790", "14700", "Sprocket", "SKY-01470", "sky-", "", "SKY-01a"]) {
      expect(skyIdQuery(q), q).toBeNull();
    }
  });
});

describe("im Admin-Katalog", () => {
  it("eine vollständige SKY-ID trifft genau diese Figur — ohne Präfix-Unterschied", () => {
    for (const q of ["SKY-0147", "sky-0147", "Sky 147"]) expect(admin(q), q).toEqual(["SKY-0147"]);
  });

  it("Ziffern: die exakte SKY-ID zuerst, Namenstreffer bleiben", () => {
    expect(admin("147")).toEqual(["SKY-0147", "SKY-0900"]);
    expect(admin("0147")).toEqual(["SKY-0147"]);
  });

  it("keine Teiltreffer bei anderen IDs", () => {
    /* „14" ist SKY-0014, nie SKY-0147; der Name „Portal 147 Edition" trifft
       als Name und bleibt — Namenstreffer werden nicht ausgeblendet. */
    expect(admin("14")).toEqual(["SKY-0014", "SKY-0900"]);
    expect(admin("14")).not.toContain("SKY-0147");
    expect(admin("1470")).toEqual(["SKY-1470"]);
    /* SKY-0470 gibt es hier nicht; nie SKY-1470 oder SKY-0471. Der Name
       „Portal 84709790" enthält „470" und bleibt ein Namenstreffer. */
    expect(admin("470")).toEqual(["SKY-0901"]);
    expect(admin("SKY-0148")).toEqual([]);
  });

  it("eine Modellnummer im Namen bleibt Namenssuche", () => {
    expect(admin("84709790")).toEqual(["SKY-0901"]);
  });

  it("die Namenssuche ist unverändert", () => {
    expect(admin("Sprocket")).toEqual(["SKY-0147", "SKY-0850"]);
    expect(admin("sprocket")).toEqual(ids(filterFigures(KATALOG, { query: "sprocket" })));
  });

  it("Serienfilter gelten weiter", () => {
    expect(ids(filterFigures(KATALOG, { query: "SKY-0471", seriesCode: "G", skyIds: true })))
      .toEqual([]);
    expect(ids(filterFigures(KATALOG, { query: "SKY-0471", seriesCode: "SC", skyIds: true })))
      .toEqual(["SKY-0471"]);
  });

  it("die serienübergreifende Suche findet die ID in ihrer Serie", () => {
    const series = [{ code: "G", label: "Giants" }, { code: "SF", label: "Swap Force" },
                    { code: "SC", label: "SuperChargers" }];
    const gruppen = groupSearchResults(KATALOG,
      { query: "sky-0471", seriesCode: "G", series, skyIds: true });
    expect(gruppen.map((g) => [g.code, ids(g.figures)])).toEqual([["G", []], ["SC", ["SKY-0471"]]]);
  });
});

describe("außerhalb des Admin-Katalogs bleibt alles, wie es war", () => {
  it("ohne `skyIds` findet „147“ nur Namen, und die SKY-ID gar nichts", () => {
    expect(ids(filterFigures(KATALOG, { query: "147" }))).toEqual(["SKY-0900"]);
    expect(ids(filterFigures(KATALOG, { query: "SKY-0147" }))).toEqual([]);
  });

  it("nur der Katalog schaltet sie ein, und nur für den Admin", () => {
    const view = readFileSync("src/components/catalog/catalog-view.tsx", "utf8");
    expect(view).toContain("filterFigures(pool, { query: deferredQuery, seriesCode, skyIds: admin })");
    expect(view).toContain("groupSearchResults(pool, { query: deferredQuery, seriesCode, series, skyIds: admin })");
    for (const datei of ["src/components/collection/collection-view.tsx",
                         "src/components/shop/shop-view.tsx"]) {
      expect(readFileSync(datei, "utf8"), datei).not.toContain("skyIds");
    }
  });
});

describe("die Variantenreihenfolge (ADR-0169) bleibt", () => {
  it("die Suche nach dem Namen hält Basisfigur und Variante in Blockreihenfolge", () => {
    expect(admin("sprocket")).toEqual(["SKY-0147", "SKY-0850"]);
  });

  it("nur der exakte ID-Treffer wandert nach vorn, sonst nichts", () => {
    const k = sortFigures([figur("SKY-0850", "Sparkle Sprocket 850", { baseSkyId: "SKY-0147",
      types: ["chase"], visibleType: "chase", sortBaseName: "Sprocket" }), figur("SKY-0147", "Sprocket")]);
    expect(ids(filterFigures(k, { query: "850", skyIds: true }))).toEqual(["SKY-0850"]);
    expect(ids(filterFigures(k, { query: "", skyIds: true }))).toEqual(["SKY-0147", "SKY-0850"]);
  });
});
