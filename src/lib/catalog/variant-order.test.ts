import { describe, expect, it } from "vitest";

import { VARIANT_SORT_ORDER, variantTier } from "./catalog-type";
import { withBaseFigure, withCharacterFamily } from "./queries";
import { filterFigures } from "./search";
import { compareFigures, sortFigures } from "./sort";
import type { CatalogFigure } from "./types";

/**
 * CAT-17 — eine Basisfigur und ihre Varianten sind EIN Block (ADR-0169).
 *
 * Die Fälle sind die echten von Staging am 2026-11-02 (rein lesend): Spyro
 * mit fünf Varianten, Legendary LightCore Chill mit zwei Variantentypes,
 * Silver Boomer ohne Variantentype, Gnarly Barkley mit nur „Mini", und
 * Fire Bone Hot Dog als Sonderform, die selbst Basisfigur ist.
 */

function figur(ueber: Partial<CatalogFigure> & { name: string; skyId: string }): CatalogFigure {
  return {
    slug: ueber.skyId.toLowerCase(), seriesCode: "SA", seriesLabel: "SA", seriesPosition: 0,
    categoryPosition: 1, categoryName: "Figuren", categoryId: 10, catalogGroup: "figure",
    cardType: "standard", itemType: "figure", characterId: null, element: null,
    imageFile: null, imageOverridePath: null, displayNameOverride: null,
    displayName: ueber.name, sortBaseName: ueber.name, sortVariantLabel: null,
    searchIndex: ueber.name.toLowerCase(), marketPrice: null, catalogVisible: true,
    baseSkyId: null, types: [], visibleType: null,
    ...ueber,
  } as CatalogFigure;
}

const variante = (name: string, skyId: string, typ: string | null, base = "SKY-0053") =>
  figur({ name, skyId, baseSkyId: base, types: typ ? [typ] : [], visibleType: typ });

const spyro = figur({ name: "Spyro", skyId: "SKY-0053" });
const SPYRO = [
  variante("Chrome Spyro", "SKY-0825", "chase"),
  variante("Elite Spyro", "SKY-0056", "elite"),
  variante("Dark Spyro", "SKY-0054", "dark"),
  variante("Legendary Spyro", "SKY-0055", "legendary"),
  variante("Spyro Light Core", "SKY-0901", "lightcore"),
  variante("Astro Spyro", "SKY-0902", "special"),
  variante("Prestige Spyro", "SKY-0903", "prestige"),
];
const namen = (liste: CatalogFigure[]) => liste.map((f) => f.name);

describe("die Basisfigur steht vor allen ihren Varianten", () => {
  it("auch wenn eine Variante alphabetisch, nach SKY-ID oder nach Eingang früher käme", () => {
    /* „Astro Spyro" steht alphabetisch vor „Spyro", SKY-0054 bis SKY-0056
       haben andere Nummern, und alle kommen in der Eingabe vor der Basisfigur. */
    const aus = sortFigures([...SPYRO, spyro]);
    expect(aus[0].skyId).toBe("SKY-0053");
  });

  it("und die Varianten folgen in der festgelegten Reihenfolge — vollständig", () => {
    expect(namen(sortFigures([...SPYRO, spyro]))).toEqual([
      "Spyro",
      "Astro Spyro",       // special
      "Legendary Spyro",   // legendary
      "Dark Spyro",        // dark
      "Spyro Light Core",  // lightcore
      "Elite Spyro",       // elite
      "Chrome Spyro",      // chase
      "Prestige Spyro",    // prestige
    ]);
  });

  it("die Liste ist genau die des Betreibers, Prestige am Ende", () => {
    expect([...VARIANT_SORT_ORDER]).toEqual(
      ["special", "legendary", "dark", "lightcore", "elite", "chase", "prestige"]);
  });

  it("Special vor Chase, unabhängig vom Namen", () => {
    const aus = sortFigures([
      variante("Aaa Chase Spyro", "SKY-0001", "chase"),
      variante("Zzz Special Spyro", "SKY-0999", "special"),
      spyro,
    ]);
    expect(namen(aus)).toEqual(["Spyro", "Zzz Special Spyro", "Aaa Chase Spyro"]);
  });
});

describe("mehrere Types, kein Type, Figurentypen", () => {
  it("bei zwei Variantentypes entscheidet das Banner", () => {
    // SKY-0130 „Legendary LightCore Chill": legendary + lightcore, Banner legendary.
    expect(variantTier({ types: ["legendary", "lightcore"], visibleType: "legendary" }))
      .toBe("legendary");
    // SKY-0172 Employee Edition LightCore Prism Break: chase + lightcore, Banner chase.
    expect(variantTier({ types: ["chase", "lightcore"], visibleType: "chase" })).toBe("chase");
  });

  it("ohne Banner — oder mit einem Figurenbanner — entscheidet der Bannervorschlag", () => {
    expect(variantTier({ types: ["legendary", "lightcore"], visibleType: null }))
      .toBe("legendary");
    // SKY-0835 Fruit Punch Camo: chase, aber kein Banner.
    expect(variantTier({ types: ["chase"], visibleType: null })).toBe("chase");
    expect(variantTier({ types: ["sensei", "special"], visibleType: "sensei" })).toBe("special");
  });

  it("Giant, Swapper, Sensei, Mini, Trap, Fahrzeug sind keine Stufe", () => {
    for (const typ of ["giant", "swapper", "sensei", "mini", "master", "trap", "vehicle"]) {
      expect(variantTier({ types: [typ], visibleType: typ }), typ).toBeNull();
    }
  });

  it("eine Variante ohne Variantentype steht am Ende ihres Blocks, nie davor", () => {
    // SKY-0010 Boomer, SKY-0011 Elite Boomer, SKY-0836 Silver Boomer (types leer).
    const boomer = figur({ name: "Boomer", skyId: "SKY-0010" });
    const aus = sortFigures([
      variante("Silver Boomer", "SKY-0836", null, "SKY-0010"),
      variante("Elite Boomer", "SKY-0011", "elite", "SKY-0010"),
      boomer,
    ]);
    expect(namen(aus)).toEqual(["Boomer", "Elite Boomer", "Silver Boomer"]);
  });

  it("eine Mini-Variante steht hinter ihrer Mini-Basisfigur (Gnarly Barkley)", () => {
    // Vor CAT-17 stand SKY-0370 VOR SKY-0369: beide standard, der Tiebreak
    // über den Anzeigenamen hat verloren.
    const barkley = figur({ name: "Barkley", skyId: "SKY-0369", types: ["mini"], visibleType: "mini",
                            sortBaseName: "Bark" });
    const gnarly = figur({ name: "Gnarly Barkley", skyId: "SKY-0370", baseSkyId: "SKY-0369",
                           types: ["mini"], visibleType: "mini", sortBaseName: "Bark" });
    expect(namen(sortFigures([gnarly, barkley]))).toEqual(["Barkley", "Gnarly Barkley"]);
  });

  it("die Basisfigur bleibt vorn, auch wenn sie selbst einen Variantentype trägt", () => {
    const basis = figur({ name: "Legendary Base", skyId: "SKY-0100", types: ["legendary"],
                          visibleType: "legendary" });
    const aus = sortFigures([
      variante("Special Variant", "SKY-0101", "special", "SKY-0100"), basis]);
    expect(namen(aus)).toEqual(["Legendary Base", "Special Variant"]);
  });
});

describe("gleichrangige Varianten und Stabilität", () => {
  const zwei = [
    variante("Molten Spyro", "SKY-0811", "chase"),
    variante("Bronze Spyro", "SKY-0812", "chase"),
    spyro,
  ];

  it("gleiche Stufe: nach Anzeigename", () => {
    expect(namen(sortFigures(zwei))).toEqual(["Spyro", "Bronze Spyro", "Molten Spyro"]);
  });

  it("gleicher Name: nach SKY-ID — nie nach Eingangsreihenfolge", () => {
    const a = variante("Twin", "SKY-0812", "chase");
    const b = variante("Twin", "SKY-0811", "chase");
    expect(sortFigures([a, b, spyro]).map((f) => f.skyId))
      .toEqual(["SKY-0053", "SKY-0811", "SKY-0812"]);
    expect(sortFigures([b, spyro, a]).map((f) => f.skyId))
      .toEqual(["SKY-0053", "SKY-0811", "SKY-0812"]);
  });

  it("jede Eingangsreihenfolge ergibt dieselbe Ausgabe", () => {
    const alle = [...SPYRO, spyro, figur({ name: "Stealth Elf", skyId: "SKY-0059" })];
    const erwartet = sortFigures(alle).map((f) => f.skyId);
    for (let i = 0; i < alle.length; i++) {
      const gedreht = [...alle.slice(i), ...alle.slice(0, i)];
      expect(sortFigures(gedreht).map((f) => f.skyId)).toEqual(erwartet);
      expect(sortFigures([...gedreht].reverse()).map((f) => f.skyId)).toEqual(erwartet);
    }
  });
});

describe("Sonderform als Basisfigur — Fire Bone Hot Dog", () => {
  const hotDog = new Map([[42, "Hot Dog"]]);
  const sf = { seriesCode: "SF", seriesPosition: 2, categoryPosition: 22 };
  const fireBone = figur({ name: "Fire Bone Hot Dog", skyId: "SKY-0274", characterId: 42, ...sf });
  const fritoLay = ["Red", "Purple", "Green"].map((farbe, i) =>
    figur({ name: `Frito-Lay Hot Dog (${farbe})`, skyId: `SKY-027${5 + i}`, characterId: 42,
            baseSkyId: "SKY-0274", types: ["chase"], visibleType: "chase", ...sf }));
  const nachbar = figur({ name: "Freeze Blade", skyId: "SKY-0217", ...sf });
  const lava = figur({ name: "Lava Barf Eruptor", skyId: "SKY-0283", ...sf });

  it("die Varianten stehen direkt hinter ihr, nichts schiebt sich dazwischen", () => {
    const aus = sortFigures(withBaseFigure(withCharacterFamily(
      [...fritoLay, nachbar, lava, fireBone], hotDog)));
    const i = aus.findIndex((f) => f.skyId === "SKY-0274");
    expect(aus.slice(i, i + 4).map((f) => f.skyId))
      .toEqual(["SKY-0274", "SKY-0277", "SKY-0276", "SKY-0275"]);
  });
});

describe("Serien- und Kategoriegrenzen", () => {
  it("ein Block überschreitet keine Kategorie — die Kategorie gewinnt", () => {
    const anderswo = figur({ name: "Dark Spyro", skyId: "SKY-0054", baseSkyId: "SKY-0053",
                             types: ["dark"], visibleType: "dark", categoryPosition: 5 });
    const zwischen = figur({ name: "Zook", skyId: "SKY-0080", categoryPosition: 3 });
    const aus = sortFigures([anderswo, zwischen, spyro]);
    expect(aus.map((f) => f.skyId)).toEqual(["SKY-0053", "SKY-0080", "SKY-0054"]);
  });

  it("Serie vor allem anderen", () => {
    const giants = figur({ name: "Aaa", skyId: "SKY-0200", seriesCode: "G", seriesPosition: 1 });
    expect(sortFigures([giants, ...SPYRO, spyro]).at(-1)?.skyId).toBe("SKY-0200");
  });
});

describe("Suche und Filter verändern die Reihenfolge nicht", () => {
  const katalog = sortFigures([...SPYRO, spyro, figur({ name: "Stealth Elf", skyId: "SKY-0059" })]);

  it("ein Chase-Filter ohne Basisfigur behält die Chase-Varianten an ihrem Platz", () => {
    const chase = katalog.filter((f) => variantTier(f) === "chase");
    expect(namen(chase)).toEqual(["Chrome Spyro"]);
    const nurVarianten = katalog.filter((f) => f.baseSkyId !== null);
    expect(namen(nurVarianten)).toEqual(namen(katalog).slice(1, SPYRO.length + 1));
  });

  it("Suche nach dem Namen der Basisfigur findet sie in Katalogreihenfolge", () => {
    const treffer = filterFigures(katalog, { query: "spyro" });
    expect(namen(treffer)).toEqual(namen(katalog).filter((n) => n.includes("Spyro")));
  });

  it("Suche nach einem Variantennamen findet genau sie", () => {
    expect(namen(filterFigures(katalog, { query: "chrome" }))).toEqual(["Chrome Spyro"]);
  });

  it("ein Serienfilter zeigt nur die gewählte Serie", () => {
    const g = figur({ name: "Chill", skyId: "SKY-0128", seriesCode: "G", seriesPosition: 1 });
    const beide = sortFigures([...katalog, g]);
    expect(filterFigures(beide, { seriesCode: "G" }).map((f) => f.skyId)).toEqual(["SKY-0128"]);
    expect(filterFigures(beide, { seriesCode: "SA" })).toHaveLength(katalog.length);
  });
});

describe("keine Kachel geht verloren, keine kommt doppelt", () => {
  it("auch nicht, wenn die Basisfigur fehlt (Entwurf, versteckt, nicht in der Sammlung)", () => {
    const aus = sortFigures(SPYRO);
    expect(aus).toHaveLength(SPYRO.length);
    expect(new Set(aus.map((f) => f.skyId)).size).toBe(SPYRO.length);
    // Sie bleiben trotzdem in Stufenreihenfolge beisammen.
    expect(aus[0].name).toBe("Astro Spyro");
  });

  it("auch nicht bei einer doppelten SKY-ID in derselben Liste", () => {
    const doppelt = [spyro, { ...spyro }];
    expect(sortFigures(doppelt)).toHaveLength(2);
  });

  it("die Eingabe bleibt unverändert", () => {
    const eingabe = [...SPYRO, spyro];
    const kopie = [...eingabe];
    sortFigures(eingabe);
    expect(eingabe).toEqual(kopie);
  });

  it("der paarweise Vergleich bleibt eine totale Ordnung (Shop)", () => {
    for (const a of SPYRO) for (const b of SPYRO) {
      expect(Math.sign(compareFigures(a, b)) + Math.sign(compareFigures(b, a))).toBe(0);
      if (a !== b) expect(compareFigures(a, b)).not.toBe(0);
    }
  });
});
