import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { baseRank, basePrefix, baseWordScore, sortByBaseRank }
  from "./base-figure-rank";
import {
  ARTICLE_CLASS_BY_CATEGORY, articleClass, categoriesOfClass, sameArticleClass,
} from "@/lib/catalog/article-class";

/**
 * CAT-08 — die Auswahl des Basisartikels.
 *
 * DER ANLASS, und er stand im Dialog zu lesen: beim Entwurf SKY-0854 „White
 * Flocked LightCore Prism Break" bot die Auswahl zuerst **Portale** an und
 * danach hundert unpassende Figuren. Zwei Fehler in einem — ein fehlender
 * fachlicher Filter und keine Sortierung.
 *
 * UND EIN DRITTER, DER MEINER WAR: der erste Filter liess nur
 * CHARAKTERFIGUREN durch. Das ist falsch, denn ein Trap, ein Fahrzeug, ein
 * Kreationskristall kann ebenfalls eine Variante haben — 30 der Entwürfe sind
 * genau das. Gefragt wird deshalb nach der ARTIKELART, und die kommt aus
 * `item_type` und der Kategorie, nie aus dem Namen.
 *
 * DIE GRENZE, DIE DIESE DATEI ZIEHT: die Art entscheidet, WER angeboten
 * wird; der Rang nur, in welcher REIHENFOLGE. Ein Artikel mit Rang 0 ist ein
 * gültiger Basisartikel — er steht weiter unten.
 */

const z = (skyId: string, nameRaw: string, name = nameRaw) => ({ skyId, nameRaw, name });

describe("die Artikelart kommt aus strukturierten Daten, nie aus dem Namen", () => {
  it("Figur zu Figur, Trap zu Trap, Fahrzeug zu Fahrzeug", () => {
    expect(articleClass({ categoryName: "Figuren", itemType: "figure" })).toBe("character");
    expect(articleClass({ categoryName: "Traps", itemType: "figure" })).toBe("trap");
    expect(articleClass({ categoryName: "Trap Items", itemType: "figure" })).toBe("trap");
    expect(articleClass({ categoryName: "Fahrzeuge", itemType: "figure" })).toBe("vehicle");
    expect(articleClass({ categoryName: "Kreationskristalle", itemType: "figure" }))
      .toBe("crystal");
    expect(articleClass({ categoryName: "Magic Items", itemType: "figure" }))
      .toBe("magic_item");
    expect(articleClass({ categoryName: "Trophies", itemType: "figure" })).toBe("trophy");
    expect(articleClass({ categoryName: "Locations & Truhen", itemType: "figure" }))
      .toBe("location");
  });

  it("`item_type` geht der Kategorie vor — Portale und Spiele trägt er allein", () => {
    expect(articleClass({ categoryName: "Portale", itemType: "portal" })).toBe("portal");
    expect(articleClass({ categoryName: "Spiele", itemType: "game" })).toBe("game");
    /* Auch ohne Kategoriewissen: der Typ reicht. */
    expect(articleClass({ categoryName: "Noch unbenannt", itemType: "portal" }))
      .toBe("portal");
  });

  it("und er trennt Traps, Fahrzeuge und Figuren NICHT — deshalb die Kategorie", () => {
    /*
     * GEMESSEN AM BESTAND (2026-10-29, `cat08_article_types.sql`): alle 640
     * Figurenzeilen tragen `item_type = 'figure'`, Traps und Fahrzeuge
     * eingeschlossen. Wer nur den Typ fragt, bekommt eine Antwort, die drei
     * Arten zusammenwirft.
     */
    const typ = "figure";
    expect(articleClass({ categoryName: "Traps", itemType: typ }))
      .not.toBe(articleClass({ categoryName: "Figuren", itemType: typ }));
    expect(articleClass({ categoryName: "Fahrzeuge", itemType: typ }))
      .not.toBe(articleClass({ categoryName: "Figuren", itemType: typ }));
  });

  it("alle dreizehn Figurenkategorien sind eine Art — auch Series 2 und LightCore", () => {
    /*
     * ANFORDERUNG 10: „Giants Series 2 Figuren“ und „Varianten & LightCore“
     * sind Kategorien echter Basisartikel. Wer sie ausschlösse, nähme dem
     * Bediener genau die Zeilen weg, die er braucht.
     */
    expect(categoriesOfClass("character")).toEqual([
      "Figuren", "Giants Series 2 Figuren", "Giants große Figuren",
      "Giants neue Figuren", "Minis", "SWAP Force", "Senseis", "Sidekicks",
      "Swap Force neue Figuren", "Trap Masters", "Trap Team Series Figuren",
      "Trap Team neue Figuren", "Varianten & LightCore",
    ].sort());
  });

  it("eine unbekannte Kategorie bekommt KEINE geratene Art", () => {
    /* ANFORDERUNG 7. `null` ist ein Ergebnis, kein Fehler. */
    expect(articleClass({ categoryName: "Smoke Test Kategorie", itemType: "figure" }))
      .toBeNull();
    expect(articleClass({ categoryName: "Eine neue Kategorie", itemType: "figure" }))
      .toBeNull();
    expect(articleClass({ categoryName: "", itemType: null })).toBeNull();
  });

  it("und ein Widerspruch zwischen Typ und Kategorie auch nicht", () => {
    /* Sagt `item_type` `portal` und die Kategorie `Figuren`, stimmt eines
       von beiden nicht — dann wird gefragt und nicht entschieden. */
    expect(articleClass({ categoryName: "Figuren", itemType: "portal" })).toBeNull();
    expect(articleClass({ categoryName: "Traps", itemType: "game" })).toBeNull();
  });

  it("`sameArticleClass` ist mit „keine Auskunft“ nie gleich", () => {
    const trap = { categoryName: "Traps", itemType: "figure" };
    const trap2 = { categoryName: "Trap Items", itemType: "figure" };
    const figur = { categoryName: "Figuren", itemType: "figure" };
    const unbekannt = { categoryName: "Smoke Test Kategorie", itemType: "figure" };
    expect(sameArticleClass(trap, trap2)).toBe(true);
    expect(sameArticleClass(trap, figur)).toBe(false);
    expect(sameArticleClass(unbekannt, unbekannt)).toBe(false);
    expect(sameArticleClass(unbekannt, figur)).toBe(false);
  });

  it("die 23 Kategorien des Bestands sind bis auf die Testkategorie zugeordnet", () => {
    /*
     * Gemessen am 2026-10-29. Fehlt eine, bekommt sie keine Kandidaten —
     * das ist sicher, aber der Bediener soll es an einer Zusage merken und
     * nicht an einer leeren Liste.
     */
    const gemessen = [
      "Fahrzeuge", "Figuren", "Giants große Figuren", "Giants neue Figuren",
      "Giants Series 2 Figuren", "Kreationskristalle", "Locations & Truhen",
      "Magic Items", "Minis", "Portale", "Senseis", "Sidekicks", "Spiele",
      "SWAP Force", "Swap Force neue Figuren", "Trap Items", "Trap Masters",
      "Trap Team neue Figuren", "Trap Team Series Figuren", "Traps", "Trophies",
      "Varianten & LightCore",
    ];
    for (const kat of gemessen) {
      expect(ARTICLE_CLASS_BY_CATEGORY[kat], kat).toBeDefined();
    }
    expect(ARTICLE_CLASS_BY_CATEGORY["Smoke Test Kategorie"]).toBeUndefined();
  });
});

describe("der Rang sagt, welcher Basisartikel wahrscheinlich gemeint ist", () => {
  it("SKY-0854: die verwandten Namen stehen oben, die fremden unten", () => {
    const entwurf = "White Flocked LightCore Prism Break";
    /* Die Suffixform trägt am stärksten. */
    expect(baseRank(entwurf, "LightCore Prism Break")).toBe(21);
    expect(baseRank(entwurf, "Prism Break")).toBe(11);
    expect(baseRank(entwurf, "Spyro")).toBe(0);

    const liste = sortByBaseRank(entwurf, [
      z("SKY-0053", "Spyro"),
      z("SKY-0170", "Prism Break"),
      z("SKY-0199", "LightCore Prism Break"),
      z("SKY-0015", "Chop Chop"),
    ]);
    expect(liste.map((x) => x.nameRaw)).toEqual([
      "LightCore Prism Break", "Prism Break", "Chop Chop", "Spyro",
    ]);
  });

  it("die Vorsilbe sagt, WARUM — sie ist der Rest des Entwurfsnamens", () => {
    expect(basePrefix("White Flocked LightCore Prism Break", "LightCore Prism Break"))
      .toBe("White Flocked");
    expect(basePrefix("Chrome Spyro", "Spyro")).toBe("Chrome");
    expect(basePrefix("Spyro", "Chop Chop")).toBe("");
  });

  it("die Wortgrenze ist Pflicht", () => {
    expect(baseRank("Shot Dog", "Hot Dog")).toBe(0);
    expect(baseRank("Fire Bone Hot Dog", "Hot Dog")).toBe(7);
    /* ADR-0034 nennt genau diesen Fall: „Bone Bash Roller Brawl“ gehört zu
       Roller Brawl und nicht zu Bash. */
    expect(baseRank("Bone Bash Roller Brawl", "Bash")).toBe(0);
    expect(baseRank("Bone Bash Roller Brawl", "Roller Brawl")).toBe(12);
  });

  it("derselbe Name ist kein Rang — ein Artikel ist nicht seine eigene Variante", () => {
    expect(baseRank("Spyro", "Spyro")).toBe(0);
    expect(baseRank("  Spyro ", "spyro")).toBe(0);
  });

  it("er rechnet nicht mit Mustern — ein Name darf % und _ enthalten", () => {
    expect(baseRank("100% Boomer", "Boomer")).toBe(6);
    expect(baseRank("Cynder", "%")).toBe(0);
    expect(baseRank("Cynder", "_ynder")).toBe(0);
  });

  it("die Klammerform bekommt keinen Rang — sie ist keine Variante (CAT-06)", () => {
    expect(baseRank("Eon's Elite Boomer (2)", "Eon's Elite Boomer")).toBe(0);
    expect(baseRank("Elite Spyro (2)", "Elite Spyro")).toBe(0);
    expect(baseRank("Elite Spyro", "Spyro")).toBe(5);
  });

  it("Editionen sind nicht ausgeschlossen, nur einsortiert", () => {
    for (const [entwurf, basis, rang] of [
      ["White Flocked LightCore Prism Break", "LightCore Prism Break", 21],
      ["Legendary LightCore Chill", "LightCore Chill", 15],
      ["Dark Mega Ram Spyro", "Mega Ram Spyro", 14],
      ["Metallic Blue Chop Chop", "Chop Chop", 9],
    ] as const) {
      expect(baseRank(entwurf, basis), `${entwurf} -> ${basis}`).toBe(rang);
    }
  });

  it("er gilt für JEDE Artikelart — Traps und Fahrzeuge genauso", () => {
    /*
     * Die echten Entwürfe vom 2026-10-29. Der Rang fragt nicht, was die
     * Zeile IST — das hat der Artikelartfilter schon entschieden.
     */
    expect(baseRank("Legendary Undead Orb Trap", "Undead Orb Trap")).toBe(15);
    expect(baseRank("Mobile Hot Streak", "Hot Streak")).toBe(10);
    expect(baseRank("Bronze Tomb Buggy", "Tomb Buggy")).toBe(10);
    expect(baseRank("Patina Burn-Cycle", "Burn-Cycle")).toBe(10);
    expect(baseRank("Fire Acorn", "Acorn")).toBe(5);
  });

  it("das zweite Signal findet die SUFFIXschreibweise — der Fall SKY-0854", () => {
    /*
     * DER BEFUND AM ECHTEN BESTAND (2026-10-29): die LightCore-Figur in `G`
     * heisst „Prism Break Light Core" — Suffixform, mit Leerzeichen. Der
     * Entwurf heisst „White Flocked LightCore Prism Break" — Präfixform,
     * ohne Leerzeichen. Die Suffixregel findet sie deshalb NICHT.
     */
    const entwurf = "White Flocked LightCore Prism Break";
    expect(baseRank(entwurf, "Prism Break Light Core")).toBe(0);
    expect(baseWordScore(entwurf, "Prism Break Light Core")).toBe(4);
    expect(baseWordScore(entwurf, "Prism Break")).toBe(2);
    expect(baseWordScore(entwurf, "Chill Light Core")).toBe(0);

    /*
     * IN DER LISTE STEHEN BEIDE OBEN, und in dieser Reihenfolge: „Prism
     * Break" trägt das STARKE Signal (es ist ein echtes Wortgrenzen-Suffix,
     * Rang 11), „Prism Break Light Core" das schwache (vier geteilte
     * Wörter). Plätze eins und zwei von 77 — das ist der Unterschied zu
     * vorher, wo die LightCore-Zeile alphabetisch bei `P` stand.
     */
    const liste = sortByBaseRank(entwurf, [
      z("SKY-0148", "Bash"),
      z("SKY-0171", "Prism Break Light Core"),
      z("SKY-0170", "Prism Break"),
      z("SKY-0129", "Chill Light Core"),
    ]);
    expect(liste.map((x) => x.skyId)).toEqual([
      "SKY-0170", "SKY-0171", "SKY-0148", "SKY-0129",
    ]);
  });

  it("ein einzelnes Wort zählt nicht — ADR-0034s Gegenbeispiel", () => {
    /* „Bash" steckt in „Bone Bash Roller Brawl", gehört aber zu Roller
       Brawl. Ein Wort ist ein Zufall, zwei sind eine Aussage. */
    expect(baseWordScore("Bone Bash Roller Brawl", "Bash")).toBe(0);
    expect(baseWordScore("Bone Bash Roller Brawl", "Roller Brawl")).toBe(2);
    expect(baseWordScore("Fire Acorn", "Acorn")).toBe(0);
  });

  it("und das starke Signal geht dem schwachen vor", () => {
    /* „Prism Break" ist ein echtes Suffix von „LightCore Prism Break" —
       damit steht es oben, obwohl die andere Zeile mehr Wörter teilt. */
    const liste = sortByBaseRank("White Flocked LightCore Prism Break", [
      z("SKY-0171", "Prism Break Light Core"),
      z("SKY-0199", "LightCore Prism Break"),
    ]);
    expect(liste.map((x) => x.nameRaw)).toEqual([
      "LightCore Prism Break", "Prism Break Light Core",
    ]);
  });

  it("die Reihenfolge ist stabil und die Eingabe bleibt unberührt", () => {
    const liste = sortByBaseRank("Gold Zook", [
      z("SKY-0187", "Zook"), z("SKY-0100", "Camo"), z("SKY-0050", "Bash"),
    ]);
    expect(liste.map((x) => x.skyId)).toEqual(["SKY-0187", "SKY-0050", "SKY-0100"]);
    const eingabe = [z("SKY-0002", "B"), z("SKY-0001", "A")];
    expect(sortByBaseRank("x", eingabe).map((x) => x.skyId)).toEqual(["SKY-0001", "SKY-0002"]);
    expect(eingabe.map((x) => x.skyId)).toEqual(["SKY-0002", "SKY-0001"]);
  });
});

describe("gefiltert wird im Server, nicht im Browser", () => {
  const SUCHE = readFileSync("src/lib/admin/base-figure-search.ts", "utf8");
  const QUERIES = readFileSync("src/lib/admin/queries.ts", "utf8");
  const DIALOG = readFileSync("src/components/admin/draft-dialog.tsx", "utf8");

  it("fetchBaseFigures vergleicht die Artikelart", () => {
    expect(QUERIES).toContain("articleClass({");
    expect(QUERIES).toContain("!== eigeneArt) return false;");
    expect(QUERIES).toContain('from "@/lib/catalog/article-class"');
  });

  it("und bei unbekannter Art bietet es NICHTS an", () => {
    expect(QUERIES).toContain("if (eigeneArt === null) return false;");
  });

  it("der Browser filtert nicht fachlich nach", () => {
    expect(DIALOG).not.toContain("ARTICLE_CLASS_BY_CATEGORY");
    expect(DIALOG).not.toContain("articleClass(");
    expect(DIALOG).not.toContain("Portale");
  });

  it("die vier alten Filter stehen weiter im Server", () => {
    expect(QUERIES).toContain("/* nicht sie selbst */");
    expect(QUERIES).toContain("/* keine Varianten */");
    expect(QUERIES).toContain("/* keine Entwürfe */");
    expect(QUERIES).toContain('.eq("series_code", serie)');
  });

  it("Artikel MIT Varianten werden nicht ausgeschlossen", () => {
    /*
     * ANFORDERUNG 4. Der Filter fragt `r.base_sky_id` — die Spalte der
     * Kandidatin —, nicht, ob auf sie gezeigt wird. `varianten` wird nur
     * gezählt und angezeigt.
     */
    expect(QUERIES).toContain("if (r.base_sky_id !== null) return false;");
    expect(QUERIES).toContain("varianten: variantenZu.get(String(r.sky_id)) ?? 0");
  });

  it("die Suche trifft Anzeigename, Rohname und SKY-ID", () => {
    expect(SUCHE).toContain("falte(k.name).includes(q)");
    expect(SUCHE).toContain("falte(k.nameRaw).includes(q)");
    expect(SUCHE).toContain("k.skyId.toLowerCase().includes(roh)");
  });

  it("sortiert wird immer, und begrenzt auch", () => {
    expect(SUCHE).toContain('sortByBaseRank(entwurfName ?? "", gefiltert)');
    expect(SUCHE).toContain("sortiert.slice(0, 8)");
    expect(SUCHE).toContain("gefunden: gefiltert.length");
  });

  it("die Empfehlung ist eine Reihenfolge und keine Auswahl", () => {
    /* ANFORDERUNG 6, am Code ablesbar: `empfehlung` trägt eine SKY-ID und
       eine Vorsilbe für die ANZEIGE. Nirgends wird damit etwas vorbelegt,
       abgesendet oder veröffentlicht. */
    expect(SUCHE).toContain("NUR ZUR ANZEIGE");
    expect(DIALOG).toContain("basis?.empfehlung?.skyId === b.skyId");
    expect(DIALOG.match(/setGewaehlteBasis\(/g)?.length).toBe(3);
    expect(DIALOG).not.toMatch(/empfehlung[^;]*setGewaehlteBasis/);
  });

  it("die Liste ist kompakt und sagt, wonach gesucht wurde", () => {
    expect(DIALOG).not.toContain("baseVariantsSoFar");
    expect(DIALOG).toContain("baseVariantsShort");
    expect(DIALOG).toContain("b.varianten > 0 ?");
    expect(DIALOG).toContain("katUnterschiedlich");
    expect(DIALOG).toContain("baseSearchHintClass");
    expect(DIALOG).toContain("baseClassUnknown");
  });
});
