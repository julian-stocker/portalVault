import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { compareFigures, sortFigures } from "./sort";
import {
  VARIANT_TOKENS, displayNameFor, eliteDisplayNameFor, parseVariant,
  searchFormsFor,
} from "./variant";
import { FAMILY_ORDER, familyRank } from "./card-type";
import { withBaseFigure, withCharacterFamily } from "./queries";
import type { CatalogFigure } from "./types";

/**
 * CAT-06 §5 — Varianten stehen bei ihrer Familie.
 *
 * DIE FAMILIE IST `character_id`, NICHT DER NAME. Das ist der ganze Punkt
 * dieser Datei: „Chrome Spyro" sortiert bei Spyro, weil ein Mensch die
 * Zuordnung kuratiert hat — nicht weil „Chrome" in einer Wortliste steht.
 *
 * WARUM „Chrome" NICHT IN DIE WORTLISTE KOMMT. Es wäre der bequeme Weg und
 * der falsche: `VARIANT_TOKENS` wirkt auf JEDE Figur, deren Name so beginnt,
 * und die Liste ist bewusst konservativ gehalten (`variant.ts`: ein Token
 * zählt nur, wenn der Restname in derselben Serie als Sammelobjekt
 * existiert). Eine kuratierte Familie ist dagegen eine Entscheidung je
 * Figur. Der letzte Test hier hält die Liste fest, damit dieser Reflex
 * auffällt.
 */

const KAT = { seriesPosition: 1, categoryPosition: 1 } as const;

function figur(ueber: Partial<CatalogFigure> & { name: string }): CatalogFigure {
  const { name, ...rest } = ueber;
  return {
    skyId: "SKY-0000", slug: "x", seriesCode: "SA", categoryName: "Figuren",
    categoryId: 10, cardType: "standard", itemType: "figure", characterId: null,
    element: null, imageFile: null, imageOverridePath: null,
    displayNameOverride: null, displayName: name, sortBaseName: name,
    sortVariantLabel: null, marketPrice: null, catalogVisible: true,
    ...KAT, name, ...rest,
  } as CatalogFigure;
}

/** Die Spyro-Familie, wie CAT-06 sie beschreibt — alle über `character_id`. */
const SPYRO_FAMILIE = [
  figur({ name: "LightCore Spyro", skyId: "SKY-0829", characterId: 7, cardType: "special" }),
  figur({ name: "Legendary Spyro", skyId: "SKY-0828", characterId: 7, cardType: "legendary" }),
  figur({ name: "Spyro", skyId: "SKY-0001", characterId: 7 }),
  figur({ name: "Chrome Spyro", skyId: "SKY-0825", characterId: 7 }),
  figur({ name: "Dark Spyro", skyId: "SKY-0826", characterId: 7, cardType: "dark" }),
];

describe("eine kuratierte Familie hält zusammen", () => {
  const namen = new Map([[7, "Spyro"]]);

  it("`character_id` hat Vorrang vor der Namensheuristik", () => {
    /* Keiner dieser fünf Namen ist mit der Wortliste zerlegbar — „Chrome",
       „LightCore" und „Silver" stehen nicht darin. Die Familie entsteht
       trotzdem, weil die ID sie entscheidet. */
    const mit = withCharacterFamily(SPYRO_FAMILIE, namen);
    expect(mit.map((f) => f.sortBaseName)).toEqual(
      ["Spyro", "Spyro", "Spyro", "Spyro", "Spyro"]);
    /* UND SIE SCHREIBT NUR DIESES EINE FELD. */
    for (const [i, f] of mit.entries()) {
      expect(f.displayName, f.name).toBe(SPYRO_FAMILIE[i].displayName);
      expect(f.sortVariantLabel, f.name).toBe(SPYRO_FAMILIE[i].sortVariantLabel);
      expect(f.cardType, f.name).toBe(SPYRO_FAMILIE[i].cardType);
    }
  });

  it("und sortiert dann in der Editionsreihenfolge, Standardfigur zuerst", () => {
    const sortiert = sortFigures(withCharacterFamily(SPYRO_FAMILIE, namen));
    expect(sortiert.map((f) => f.name)).toEqual([
      /* standard: die Figur, die die Familie trägt, zuerst (V3.9a) */
      "Spyro",
      "Chrome Spyro",
      /* special */
      "LightCore Spyro",
      /* dark */
      "Dark Spyro",
      /* legendary */
      "Legendary Spyro",
    ]);
  });

  it("die Editionsreihenfolge hat Vorrang vor der alphabetischen", () => {
    /* „Dark" kommt alphabetisch vor „LightCore", aber `special` kommt vor
       `dark` — eine fachlich begründete Reihenfolge schlägt das Alphabet. */
    expect(familyRank("special")).toBeLessThan(familyRank("dark"));
    expect(FAMILY_ORDER.indexOf("standard")).toBe(0);
  });

  it("sie funktioniert ohne Standardfigur", () => {
    const ohneBasis = withCharacterFamily(
      SPYRO_FAMILIE.filter((f) => f.name !== "Spyro"), namen);
    const sortiert = sortFigures(ohneBasis);
    expect(sortiert.map((f) => f.name)).toEqual([
      "Chrome Spyro", "LightCore Spyro", "Dark Spyro", "Legendary Spyro"]);
  });

  it("eine Familie über mehrere Serien wird NICHT in eine falsche Serie geholt", () => {
    /* Serie und Kategorie sortieren zuerst, und das bleibt so: eine
       Familienzuordnung darf eine Figur nicht in eine fremde Serie
       verschieben (CAT-06 §5). In einer Serienansicht gruppieren sie, über
       Serien hinweg nicht — das ist dieselbe Regel, nicht ihr Gegenteil. */
    const giants = figur({
      name: "LightCore Spyro", skyId: "SKY-0829", characterId: 7,
      cardType: "special", seriesCode: "G", seriesPosition: 2, categoryPosition: 1,
    });
    const sortiert = sortFigures(withCharacterFamily(
      [giants, ...SPYRO_FAMILIE.filter((f) => f.skyId !== "SKY-0829")], namen));
    expect(sortiert[sortiert.length - 1].skyId).toBe("SKY-0829");
    expect(sortiert[sortiert.length - 1].seriesCode).toBe("G");
  });

  it("eine fehlende Zuordnung beschädigt die Sortierung nicht", () => {
    /* Ohne `character_id` bleibt `sortBaseName` der Name — die Figur steht
       dann woanders, aber nichts bricht, und nichts wird falsch zugeordnet. */
    const ohne = SPYRO_FAMILIE.map((f) => ({ ...f, characterId: null }));
    const sortiert = sortFigures(withCharacterFamily(ohne, namen));
    expect(sortiert).toHaveLength(5);
    expect(sortiert.map((f) => f.name)).toEqual([
      "Chrome Spyro", "Dark Spyro", "Legendary Spyro", "LightCore Spyro", "Spyro"]);
    /* Und keine davon hat eine erfundene Familie bekommen. */
    expect(sortiert.every((f) => f.sortBaseName === f.name)).toBe(true);
  });

  it("eine unbekannte Familien-ID lässt die Figur, wie sie ist", () => {
    const fremd = withCharacterFamily([figur({ name: "Chrome Spyro", characterId: 99 })],
                                      namen);
    expect(fremd[0].sortBaseName).toBe("Chrome Spyro");
  });
});

describe("die Klammerschreibweise ist kein Mechanismus mehr", () => {
  it("die Sortierung braucht sie nicht", () => {
    /* Die fünf natürlichen Namen oben sortieren richtig, und keiner trägt
       eine Klammer. Das ist die Zusage aus CAT-06 §1. */
    const sortiert = sortFigures(withCharacterFamily(SPYRO_FAMILIE, new Map([[7, "Spyro"]])));
    expect(sortiert.every((f) => !f.name.includes("("))).toBe(true);
    expect(sortiert[0].name).toBe("Spyro");
  });

  it("ein vorhandener Klammername bleibt lesbar — Altbestand, kein Fehler", () => {
    /* „Crusher (Granite)" steht heute im Katalog. `variant.ts` zerlegt ihn
       weiter, damit die Anzeige „Granite Crusher" stimmt und die Sortierung
       bei Crusher bleibt. Abgeschafft wird die Schreibweise, nicht ihre
       Lesbarkeit (CAT-06: Altbestände dürfen bleiben). */
    const v = parseVariant("Crusher (Granite)", new Set(["Crusher"]));
    expect(v).toEqual({ baseName: "Crusher", variantLabel: "Granite", source: "suffix" });
  });

  it("kein ANZEIGENAME entsteht im Format Grundfigur (Variante)", () => {
    /*
     * Die Zusage, die zählt, und zwar am VERHALTEN geprüft und nicht am
     * Quelltext: `displayNameFor` normalisiert beide Schreibweisen auf die
     * Präfixform. Wer einen Klammernamen in der Datenbank hat, sieht
     * „Granite Crusher"; wer einen Präfixnamen hat, sieht ihn unverändert.
     * Erzeugt wird die Klammer nie.
     */
    for (const [roh, basis, label] of [
      ["Crusher (Granite)", "Crusher", "Granite"],
      ["Legendary Bash", "Bash", "Legendary"],
    ] as const) {
      const v = parseVariant(roh, new Set([basis]));
      expect(v, roh).not.toBeNull();
      const gezeigt = displayNameFor(roh, v);
      expect(gezeigt, roh).toBe(`${label} ${basis}`);
      expect(gezeigt, roh).not.toContain("(");
    }
    /* Und eine Figur ohne erkannte Variante behält ihren Namen Zeichen für
       Zeichen — auch wenn er eine Klammer trägt. */
    expect(displayNameFor("Crusher (Granite)", null)).toBe("Crusher (Granite)");
  });

  it("die Suche findet einen Klammernamen WEITERHIN — absichtlich", () => {
    /*
     * `searchFormsFor` baut die Klammerform bewusst mit: wer „Crusher
     * (Granite)" eintippt, weil er den Namen so im Katalog gesehen hat, muss
     * die Figur finden. Abgeschafft wird die Schreibweise als KONVENTION,
     * nicht die Fähigkeit, sie zu lesen (CAT-06: Altbestände dürfen bleiben).
     */
    const formen = searchFormsFor("Crusher (Granite)",
                                  parseVariant("Crusher (Granite)", new Set(["Crusher"])));
    expect(formen).toContain("Granite Crusher");
    expect(formen).toContain("Crusher (Granite)");
    expect(formen).toContain("Crusher");
  });

  it("und die neuen Wege erzeugen an keiner Stelle einen Namen", () => {
    /*
     * Weg B und C und die Familienverwaltung fassen `name` und `slug` gar
     * nicht an — das ist in `0158` auch als Nachbedingung festgehalten.
     * Hier wird es am Quelltext gegengeprüft.
     */
    /* Keine schreibt `name` oder `slug` — das ist die harte Zusage. */
    for (const datei of ["src/lib/admin/actions.ts",
                         "src/components/admin/draft-dialog.tsx",
                         "src/lib/admin/family-search.ts",
                         "supabase/migrations/0158_figure_families.sql"]) {
      const text = readFileSync(datei, "utf8");
      expect(text, datei).not.toContain("set name =");
      expect(text, datei).not.toContain("set slug =");
    }
    /*
     * Und keine baut eine Klammer um einen Namen. Der Dialog ist hier
     * ausgenommen, und zwar begründet: er setzt `${de.admin.mergeBlocked}
     * (${…})` zusammen — eine FEHLERMELDUNG mit der Liste der verweisenden
     * Tabellen, kein Figurenname. Ein Muster, das beides nicht
     * unterscheiden kann, würde hier nur Lärm machen.
     */
    for (const datei of ["src/lib/admin/actions.ts",
                         "src/lib/admin/family-search.ts",
                         "supabase/migrations/0158_figure_families.sql"]) {
      const text = readFileSync(datei, "utf8");
      expect(text, datei).not.toMatch(/\$\{[^}]*\}\s*\(\$\{/);
    }
  });

  it("eine Ausnahme bleibt, und sie ist eine andere Sache", () => {
    /*
     * `eliteDisplayNameFor` erzeugt „Eon's Elite Boomer (2)". Das ist KEIN
     * `Grundfigur (Variante)`: Eon's Elite ist eine Produktlinie (ADR,
     * `0032`), und die Zahl unterscheidet zwei Boomer DERSELBEN Linie. Sie
     * steht in `NOT_VARIANT_LABELS` und wird von der Variantenregel
     * ausdrücklich nicht als Variante gelesen. CAT-06 §1 nennt sie nicht,
     * und sie wird hier nicht stillschweigend mitabgeschafft — aber
     * benannt, damit niemand sie für einen Rückfall hält.
     */
    expect(eliteDisplayNameFor({
      baseName: "Elite Boomer", characterName: "Boomer", editionLabel: "2",
    } as Parameters<typeof eliteDisplayNameFor>[0])).toBe("Eon's Elite Boomer (2)");
  });
});

describe("VARIANT_TOKENS wird nicht erweitert, um fehlende Familien zu kaschieren", () => {
  it("Chrome, Silver, Flocked, LightCore und Volcanic stehen NICHT darin", () => {
    /*
     * CAT-06 §5 ausdrücklich: keine pauschale Erweiterung. Die Wortliste
     * wirkt auf JEDE Figur, deren Name so beginnt; eine kuratierte Familie
     * ist eine Entscheidung je Figur. Diese Zeile ist der Riegel gegen den
     * bequemen Reflex.
     */
    for (const wort of ["Chrome", "Silver", "Flocked", "LightCore", "Light Core",
                        "Volcanic", "Springtime", "Winterfest", "Birthday"]) {
      expect(VARIANT_TOKENS as readonly string[], wort).not.toContain(wort);
    }
  });

  it("und die Liste hat genau die Länge, die sie heute hat", () => {
    /* Eine Zahl, die bei jeder Erweiterung auffällt und gelesen werden muss.
       Wer ein Token hinzufügt, soll hier vorbeikommen und begründen. */
    expect(VARIANT_TOKENS).toHaveLength(31);
  });

  it("die Heuristik bleibt der Rückfall, wo sie wirklich trägt", () => {
    /* Sie verlangt eine Grundfigur in derselben Serie — das ist ihre ganze
       Sicherheit, und sie bleibt unangetastet. */
    expect(parseVariant("Legendary Bash", new Set(["Bash"]))).not.toBeNull();
    expect(parseVariant("Dark Sword", new Set(["Hammer"]))).toBeNull();
    expect(parseVariant("Chrome Spyro", new Set(["Spyro"]))).toBeNull();
  });
});

describe("Familie, Serie, Edition und Katalogeintrag bleiben vier Dinge", () => {
  it("der Vergleicher liest die Familie, nicht die Edition, als Gruppierung", () => {
    /* NUR DER FUNKTIONSRUMPF, nicht der Kopfkommentar — der nennt die
       Begriffe in erklärender und nicht in ausführender Reihenfolge. */
    const ganz = readFileSync("src/lib/catalog/sort.ts", "utf8");
    const rumpf = ganz.slice(ganz.indexOf("export function compareFigures"),
                             ganz.indexOf("/** Returns a sorted copy"));
    /* Die Reihenfolge der Kriterien ist die Architektur: Serie, Kategorie,
       Familie (als `sortBaseName`), dann Edition. */
    expect(rumpf.indexOf("seriesPosition")).toBeLessThan(rumpf.indexOf("sortBaseName"));
    expect(rumpf.indexOf("sortBaseName")).toBeLessThan(rumpf.indexOf("familyRank"));
  });

  it("eine Edition sagt nichts über die Familie", () => {
    /* Zwei Figuren derselben Edition in verschiedenen Familien, und zwei
       Familienmitglieder mit verschiedenen Editionen — beides muss gehen. */
    const a = figur({ name: "Chrome Spyro", characterId: 7, cardType: "standard" });
    const b = figur({ name: "Silver Eruptor", characterId: 8, cardType: "standard" });
    const mit = withCharacterFamily([a, b], new Map([[7, "Spyro"], [8, "Eruptor"]]));
    expect(mit.map((f) => f.sortBaseName)).toEqual(["Spyro", "Eruptor"]);
    expect(compareFigures(mit[1], mit[0])).toBeLessThan(0);
  });
});


/* ==========================================================================
 * CAT-07 — die ausdrücklich zugeordnete Basisfigur
 *
 * DER GENAUESTE DER DREI GRIFFE, deshalb der letzte: die Namensregel rät,
 * ein Charakter sagt „dieselbe Person", eine Basisfigur sagt „Variante GENAU
 * dieser Figur" — und nur die hat ein Mensch je Zeile entschieden.
 * ======================================================================= */

describe("eine zugeordnete Basisfigur gruppiert genauer als alles andere", () => {
  const spyro = figur({ name: "Spyro", skyId: "SKY-0053" });
  const varianten = [
    figur({ name: "Chrome Spyro", skyId: "SKY-0825", baseSkyId: "SKY-0053" }),
    figur({ name: "Dark Spyro", skyId: "SKY-0826", baseSkyId: "SKY-0053",
            cardType: "dark" }),
    figur({ name: "Legendary Spyro", skyId: "SKY-0827", baseSkyId: "SKY-0053",
            cardType: "legendary" }),
    figur({ name: "LightCore Spyro", skyId: "SKY-0829", baseSkyId: "SKY-0053",
            cardType: "special" }),
  ];

  it("die Basisfigur steht zuerst, dann die Varianten in Editionsreihenfolge", () => {
    const sortiert = sortFigures(withBaseFigure([...varianten, spyro]));
    expect(sortiert.map((f) => f.name)).toEqual([
      "Spyro",            /* standard, und sie trägt den Namen der Gruppe */
      "Chrome Spyro",     /* standard */
      "LightCore Spyro",  /* special */
      "Dark Spyro",       /* dark */
      "Legendary Spyro",  /* legendary */
    ]);
  });

  it("sie schlägt die Namensregel UND die Familie", () => {
    /*
     * Hier widersprechen sich alle drei absichtlich: die Namensregel würde
     * „Dark Spyro" unter „Spyro" einsortieren (dasselbe Ergebnis), die
     * Familie würde „Eruptor" sagen (falsch), die Basisfigur sagt
     * „Spyro". Die Basisfigur muss gewinnen, weil sie die einzige ist, die
     * jemand entschieden hat.
     */
    const konflikt = figur({
      name: "Chrome Spyro", skyId: "SKY-0825", baseSkyId: "SKY-0053",
      characterId: 99, sortBaseName: "Eruptor",
    });
    const mit = withBaseFigure([spyro, konflikt]);
    expect(mit.find((f) => f.skyId === "SKY-0825")!.sortBaseName).toBe("Spyro");
  });

  it("und sie schreibt NUR dieses eine Feld", () => {
    const mit = withBaseFigure([spyro, ...varianten]);
    for (const [i, f] of mit.entries()) {
      const vorher = [spyro, ...varianten][i];
      expect(f.displayName, f.name).toBe(vorher.displayName);
      expect(f.sortVariantLabel, f.name).toBe(vorher.sortVariantLabel);
      expect(f.cardType, f.name).toBe(vorher.cardType);
      expect(f.characterId, f.name).toBe(vorher.characterId);
      expect(f.name, f.name).toBe(vorher.name);
      expect(f.skyId, f.name).toBe(vorher.skyId);
    }
  });

  it("mehrere Varianten derselben Edition bleiben stabil sortiert", () => {
    /* Drei `standard`-Varianten: FAMILY_ORDER kann sie nicht trennen, der
       Gleichstandsbrecher „Grundfigur zuerst" nur von der Basisfigur. Danach
       entscheidet der Name — alphabetisch, aber deterministisch. */
    const drei = [
      figur({ name: "Silver Spyro", skyId: "SKY-0901", baseSkyId: "SKY-0053" }),
      figur({ name: "Chrome Spyro", skyId: "SKY-0825", baseSkyId: "SKY-0053" }),
      figur({ name: "Flocked Spyro", skyId: "SKY-0902", baseSkyId: "SKY-0053" }),
    ];
    const einmal = sortFigures(withBaseFigure([...drei, spyro])).map((f) => f.name);
    const andersherum = sortFigures(withBaseFigure([spyro, ...drei.reverse()]))
      .map((f) => f.name);
    expect(einmal).toEqual([
      "Spyro", "Chrome Spyro", "Flocked Spyro", "Silver Spyro"]);
    /* UND DIE EINGABEREIHENFOLGE ÄNDERT NICHTS. */
    expect(andersherum).toEqual(einmal);
  });

  it("eine Figur ohne Zuordnung behält ihre bisherige Sortierung", () => {
    /* Das ist die Zusage aus CAT-07: wer nicht zugeordnet ist, wird nicht
       angefasst. */
    const ohne = figur({ name: "Legendary Bash", sortBaseName: "Bash",
                         sortVariantLabel: "Legendary", cardType: "legendary" });
    const mit = withBaseFigure([ohne]);
    expect(mit[0]).toBe(ohne);
  });

  it("eine Basisfigur, die nicht in der Liste steht, ändert nichts", () => {
    /* Versteckt, Entwurf, oder in der Sammlung nicht vorhanden: dann kann
       die Variante sich nicht daneben sortieren, und sie bleibt, wie sie
       kam. Kein Absturz, keine erfundene Gruppe. */
    const waise = figur({ name: "Chrome Spyro", baseSkyId: "SKY-7777" });
    expect(withBaseFigure([waise])[0].sortBaseName).toBe("Chrome Spyro");
  });

  it("die Serie und die Kategorie sortieren weiter zuerst", () => {
    /*
     * `0159` lässt eine Zuordnung über Serien hinweg gar nicht zu. Über
     * KATEGORIEN hinweg wäre sie möglich — heute gibt es keinen solchen Fall
     * (gemessen: 0 von 70 Paaren), und falls einer entsteht, trennt die
     * Kategorieordnung ihn. Das ist dieselbe Regel wie bei der Familie und
     * nicht ihr Gegenteil.
     */
    const andereKat = figur({
      name: "Chrome Spyro", skyId: "SKY-0825", baseSkyId: "SKY-0053",
      categoryId: 99, categoryPosition: 9,
    });
    const sortiert = sortFigures(withBaseFigure([andereKat, spyro]));
    expect(sortiert[0].name).toBe("Spyro");
    expect(sortiert[1].name).toBe("Chrome Spyro");
    /* Und zwar weil die Kategorie zuerst sortiert, nicht weil die Gruppe
       hielte — hier zufällig dieselbe Reihenfolge, aber aus anderem Grund. */
    expect(compareFigures(spyro, andereKat)).toBeLessThan(0);
  });
});

describe("Familie und Basisfigur sind zwei Dinge", () => {
  it("der Katalog wendet beide an, in dieser Reihenfolge", () => {
    const quelle = readFileSync("src/lib/catalog/queries.ts", "utf8");
    const i = quelle.indexOf("const withFamily = withCharacterFamily(");
    const j = quelle.indexOf("const withBase = withBaseFigure(");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });

  it("die Sammlung wendet dieselbe Kette in derselben Reihenfolge an", () => {
    /* Eine Sammlungskarte darf nicht anders einsortiert sein als dieselbe
       Figur im Katalog — eine zweite Reihenfolge wäre genau das. */
    const quelle = readFileSync("src/lib/collection/queries.ts", "utf8");
    expect(quelle).toContain("withBaseFigure(");
    expect(quelle.indexOf("withBaseFigure("))
      .toBeLessThan(quelle.indexOf("withCharacterFamily("));
  });

  it("`withBaseFigure` kennt keine Namensheuristik", () => {
    const quelle = readFileSync("src/lib/catalog/queries.ts", "utf8");
    const fn = quelle.slice(quelle.indexOf("export function withBaseFigure"),
                            quelle.indexOf("export type CharacterIndex"));
    /* Sie liest `baseSkyId` und sonst nichts — kein Name, kein Token, kein
       `includes`. */
    expect(fn).not.toContain("VARIANT_TOKENS");
    expect(fn).not.toContain("startsWith");
    expect(fn).not.toContain("includes(");
    expect(fn).toContain("figure.baseSkyId");
  });
});
