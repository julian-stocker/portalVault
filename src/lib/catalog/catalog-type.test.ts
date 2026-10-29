import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  CATALOG_TYPES, TYPE_GROUPS, TYPE_GROUP_LABELS, TYPE_GROUP_ORDER, TYPE_LABELS,
  TYPE_PRIORITY, asCatalogTypes, bannerChoices, bannerType, groupOfType,
  isCatalogType, isHeadlineType, isVariantType, proposeVisibleType,
  type CatalogType,
} from "./catalog-type";
import { CARD_TYPES } from "./card-type";

/**
 * CAT-10 — DER TYPE, und was ihn von der KARTENKUNST trennt.
 *
 * DIE WICHTIGSTE ZUSAGE DIESER DATEI steht im letzten Abschnitt: `card_type`
 * wird NICHT abgeleitet. Der Betreiber hat ausdrücklich verlangt, das zu
 * prüfen, und die Prüfung lief gegen alle 701 Katalogzeilen
 * (`supabase/checks/cat10_projection_proof.sql`). Hier wird festgehalten,
 * dass der Code dieser Entscheidung folgt — dass also nirgends eine
 * Projektion zurückkommt.
 */

const MIGRATION = "supabase/migrations/0163_catalog_types.sql";
const SQL = readFileSync(MIGRATION, "utf8");
const MODUL = readFileSync("src/lib/catalog/catalog-type.ts", "utf8");

/** Ausführbarer Code: Blockkommentare und Zeilenkommentare weg. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");

describe("das Vokabular", () => {
  it("sind siebzehn Werte in drei Gruppen", () => {
    expect(CATALOG_TYPES).toHaveLength(17);
    expect(TYPE_GROUPS.figures).toHaveLength(6);
    expect(TYPE_GROUPS.extra).toHaveLength(4);
    expect(TYPE_GROUPS.variants).toHaveLength(7);
  });

  it("und die Liste ist genau die, die der Betreiber genannt hat", () => {
    expect([...TYPE_GROUPS.figures]).toEqual(
      ["giant", "swapper", "master", "sensei", "mini", "sidekick"]);
    expect([...TYPE_GROUPS.extra]).toEqual(["item", "trap", "vehicle", "crystal"]);
    /* `prestige` ist der achtzehnte Punkt der Liste — Entscheidung D1: die
       Kartenkunst dafür existiert und drei Zeilen tragen sie. */
    expect([...TYPE_GROUPS.variants]).toEqual(
      ["lightcore", "special", "dark", "legendary", "elite", "chase", "prestige"]);
  });

  it("„Standard“ ist KEIN Wert, sondern die leere Menge", () => {
    /*
     * Die einzige Abweichung von der Liste des Betreibers, und sie gewinnt
     * eine Zusage: es gibt keinen Zustand „Standard UND Giant", der erklärt
     * werden müsste.
     */
    expect(CATALOG_TYPES as readonly string[]).not.toContain("standard");
    expect(proposeVisibleType([])).toBeNull();
    expect(bannerChoices([])).toEqual([]);
  });

  it("jeder Wert steht in genau einer Gruppe", () => {
    for (const t of CATALOG_TYPES) {
      const treffer = TYPE_GROUP_ORDER.filter(
        (g) => (TYPE_GROUPS[g] as readonly string[]).includes(t));
      expect(treffer, t).toHaveLength(1);
      expect(groupOfType(t)).toBe(treffer[0]);
    }
  });

  it("jeder Wert hat eine Beschriftung, und keine ist leer", () => {
    expect(Object.keys(TYPE_LABELS).sort()).toEqual([...CATALOG_TYPES].sort());
    for (const t of CATALOG_TYPES) expect(TYPE_LABELS[t].length, t).toBeGreaterThan(2);
    for (const g of TYPE_GROUP_ORDER) {
      expect(TYPE_GROUP_LABELS[g].length, g).toBeGreaterThan(3);
    }
  });

  it("die Beschriftungen sind nicht übersetzt — das Hobby spricht englisch", () => {
    expect(TYPE_LABELS.legendary).toBe("Legendary");
    expect(TYPE_LABELS.lightcore).toBe("LightCore");
    expect(TYPE_LABELS.chase).toBe("Chase");
    /* Und `master` heisst „Master", nicht „Trap Master": der Betreiber hat
       es so benannt, und das Banner hat 13 px Höhe. */
    expect(TYPE_LABELS.master).toBe("Master");
  });

  it("der Wächter weist ab, was nicht dazugehört", () => {
    for (const falsch of ["standard", "superduper", "", " giant", "GIANT", null,
                          42, undefined, ["giant"]]) {
      expect(isCatalogType(falsch), String(falsch)).toBe(false);
    }
    for (const t of CATALOG_TYPES) expect(isCatalogType(t), t).toBe(true);
  });

  it("`isVariantType` trennt die Varianten von allem anderen", () => {
    for (const t of TYPE_GROUPS.variants) expect(isVariantType(t), t).toBe(true);
    for (const t of [...TYPE_GROUPS.figures, ...TYPE_GROUPS.extra]) {
      expect(isVariantType(t), t).toBe(false);
    }
  });
});

describe("die Menge wird bereinigt, nicht geglaubt", () => {
  it("unbekannte Werte fallen heraus statt eine Suche zu zerbrechen", () => {
    expect(asCatalogTypes(["giant", "superduper", "legendary"]))
      .toEqual(["giant", "legendary"]);
    expect(asCatalogTypes(["standard"])).toEqual([]);
  });

  it("jeder Wert einmal, in fester Reihenfolge", () => {
    /* Nicht die Reihenfolge der Kästchenklicks: eine Kachel soll nicht davon
       abhängen, in welcher Folge jemand ausgewählt hat. */
    expect(asCatalogTypes(["legendary", "giant", "legendary"]))
      .toEqual(["giant", "legendary"]);
    expect(asCatalogTypes(["chase", "mini"])).toEqual(["mini", "chase"]);
  });

  it("und was kein Array ist, ist die leere Menge", () => {
    for (const falsch of [null, undefined, "giant", 7, {}]) {
      expect(asCatalogTypes(falsch), String(falsch)).toEqual([]);
    }
  });
});

describe("die Priorität ist ein VORSCHLAG und nie eine Wirkung (D4)", () => {
  it("sie kennt jeden Wert, und jeden einmal", () => {
    expect([...TYPE_PRIORITY].sort()).toEqual([...CATALOG_TYPES].sort());
  });

  it("die Reihenfolge ist die des Betreibers, mit Prestige davor", () => {
    const platz = (t: CatalogType) => TYPE_PRIORITY.indexOf(t);
    /* Chase > Elite > Legendary > Dark > Special > LightCore > Figuren. */
    expect(platz("chase")).toBeLessThan(platz("elite"));
    expect(platz("elite")).toBeLessThan(platz("legendary"));
    expect(platz("legendary")).toBeLessThan(platz("dark"));
    expect(platz("dark")).toBeLessThan(platz("special"));
    expect(platz("special")).toBeLessThan(platz("lightcore"));
    expect(platz("lightcore")).toBeLessThan(platz("giant"));
    /* Und `prestige` ganz vorn (D1): drei Zeilen im ganzen Katalog. */
    expect(platz("prestige")).toBe(0);
  });

  it("der Vorschlag für die vier Fälle des Betreibers", () => {
    expect(proposeVisibleType(["lightcore", "legendary"])).toBe("legendary");
    expect(proposeVisibleType(["mini", "chase"])).toBe("chase");
    expect(proposeVisibleType(["giant", "legendary"])).toBe("legendary");
    expect(proposeVisibleType(["trap", "special"])).toBe("special");
  });

  it("er ist von der Reihenfolge der Eingabe unabhängig", () => {
    expect(proposeVisibleType(["legendary", "lightcore"])).toBe("legendary");
    expect(proposeVisibleType(["chase", "mini"])).toBe("chase");
  });

  /*
   * DIE WICHTIGSTE ZEILE DIESES ABSCHNITTS. `bannerType()` liest
   * AUSSCHLIESSLICH die Auswahl. Läse sie die Priorität, erschienen auf 248
   * öffentlichen Kacheln Banner, die niemand gewählt hat — gemessen am
   * Bestand.
   */
  it("`bannerType` liest die Priorität NICHT", () => {
    expect(bannerType({ visibleType: null })).toBeNull();
    expect(bannerType({})).toBeNull();
    expect(bannerType({ visibleType: "legendary" })).toBe("legendary");
    /* Auch nicht, wenn eine Menge daneben steht. */
    expect(bannerType({ visibleType: null } as never)).toBeNull();
    expect(code(MODUL)).not.toMatch(/bannerType[\s\S]{0,300}proposeVisibleType/);
    expect(code(MODUL)).not.toMatch(/bannerType[\s\S]{0,300}TYPE_PRIORITY/);
  });

  it("und ein unbekannter Wert in `visible_type` zeichnet nichts", () => {
    expect(bannerType({ visibleType: "superduper" })).toBeNull();
    expect(bannerType({ visibleType: "standard" })).toBeNull();
  });
});

describe("das Dropdown bietet nur an, was hinterlegt ist", () => {
  it("die Auswahl ist die bereinigte Menge — nie alle siebzehn", () => {
    expect(bannerChoices(["lightcore", "legendary"]))
      .toEqual(["lightcore", "legendary"]);
    expect(bannerChoices(["trap"])).toEqual(["trap"]);
    expect(bannerChoices(["trap", "superduper"])).toEqual(["trap"]);
  });

  it("und sie ist NIEMALS der ganze Katalog", () => {
    for (const menge of [["giant"], ["trap", "special"], []]) {
      expect(bannerChoices(menge).length).toBeLessThan(CATALOG_TYPES.length);
    }
  });
});

describe("die zwei Platten", () => {
  it("Legendary und Prestige hell, alles andere leise", () => {
    expect(isHeadlineType("legendary")).toBe(true);
    expect(isHeadlineType("prestige")).toBe(true);
    for (const t of CATALOG_TYPES.filter(
      (x) => x !== "legendary" && x !== "prestige")) {
      expect(isHeadlineType(t), t).toBe(false);
    }
  });

  it("ein Giant bekommt keinen Rang — er ist keine stärkere Ausgabe", () => {
    /* Dieselbe Begründung, mit der `chase` und `elite` in `EDITION_RANK`
       ausserhalb der Kette stehen: ein Vergleich, den die Sache nicht
       macht, wird nicht erfunden. */
    expect(isHeadlineType("giant")).toBe(false);
    expect(isHeadlineType("trap")).toBe(false);
  });
});

describe("DER TYPE IST NICHT DIE KARTENKUNST — und das ist gemessen", () => {
  /**
   * Die Entscheidung, um die der Betreiber ausdrücklich gebeten hat.
   *
   * `supabase/checks/cat10_projection_proof.sql` hat die Projektion gegen
   * alle 701 Katalogzeilen gerechnet und drei Lücken gefunden; die Migration
   * schreibt sie in ihren Kopf, und diese Zusagen halten fest, dass der Code
   * ihnen folgt.
   */
  it("die Migration nennt die drei Lücken namentlich", () => {
    expect(SQL).toContain("SKY-0854");
    expect(SQL).toContain("4d6bbb026b37449cc0d2def77949d095");
    expect(SQL).toContain("ece2af88f8f9ecaeb985ccfcea5f6b12");
    expect(SQL).toContain("denselben Rang 0");
  });

  it("und sie MISST ihre Zusage, statt sie zu behaupten", () => {
    /* Abdruck vor der Belegung, Vergleich danach, Abbruch bei Abweichung. */
    expect(SQL).toContain("die Erstbelegung hat eine Kartenkunst veraendert");
    expect(code(SQL)).toContain("v_kunst");
  });

  it("keine der zwei neuen Funktionen nennt card_type", () => {
    const rumpf = (name: string) => {
      const a = SQL.indexOf(`create or replace function public.${name}(`);
      expect(a, name).toBeGreaterThan(-1);
      return SQL.slice(a, SQL.indexOf("\n$$;", a));
    };
    for (const name of ["admin_set_figure_types", "admin_set_visible_type"]) {
      expect(rumpf(name), name).not.toContain("card_type");
      /* Und keine der beiden fasst die Variantenbeziehung an (D7). */
      expect(rumpf(name), name).not.toContain("base_sky_id");
      expect(rumpf(name), name).not.toContain("character_id");
    }
  });

  it("das Modul leitet nichts ab — keine Projektion, kein EDITION_RANK", () => {
    expect(code(MODUL)).not.toContain("EDITION_RANK");
    expect(code(MODUL)).not.toContain("card_type");
    expect(code(MODUL)).not.toContain("cardType");
    expect(code(MODUL)).not.toContain("CARD_TYPES");
  });

  it("die beiden Vokabulare teilen Wörter und sonst nichts", () => {
    /*
     * Sechs Werte kommen in beiden vor — `special`, `dark`, `legendary`,
     * `elite`, `chase`, `prestige` —, und genau das macht die Verwechslung
     * möglich. Deshalb steht hier, WAS sie unterscheidet: `card_type` hat
     * `standard` und KEIN `lightcore`, die Typmenge umgekehrt.
     */
    const gemeinsam = CATALOG_TYPES.filter(
      (t) => (CARD_TYPES as readonly string[]).includes(t));
    expect(gemeinsam.sort()).toEqual(
      ["chase", "dark", "elite", "legendary", "prestige", "special"]);
    expect(CARD_TYPES as readonly string[]).toContain("standard");
    expect(CARD_TYPES as readonly string[]).not.toContain("lightcore");
    expect(CATALOG_TYPES as readonly string[]).toContain("lightcore");
    expect(CATALOG_TYPES as readonly string[]).not.toContain("standard");
  });
});

describe("das Vokabular steht in SQL und in TypeScript gleich", () => {
  it("die CHECK kennt genau die siebzehn", () => {
    const a = SQL.indexOf("add constraint skylanders_types_known");
    const b = SQL.indexOf(";", a);
    const block = SQL.slice(a, b);
    for (const t of CATALOG_TYPES) {
      expect(block, `${t} fehlt in der CHECK`).toContain(`'${t}'`);
    }
    /* Und keinen achtzehnten: gezählt, nicht nur gesucht. */
    expect(block.match(/'[a-z]+'/g) ?? []).toHaveLength(17);
  });

  it("die schreibende Funktion weist jeden anderen Wert NAMENTLICH ab", () => {
    const a = SQL.indexOf("create or replace function public.admin_set_figure_types(");
    const block = SQL.slice(a, SQL.indexOf("\n$$;", a));
    for (const t of CATALOG_TYPES) expect(block, t).toContain(`'${t}'`);
    expect(block).toContain("ist kein Type");
  });

  it("und die Journalwerte heissen types und visible_type", () => {
    expect(SQL).toContain("array['types', 'visible_type']");
    expect(SQL).toContain("'0163 Nachbedingung: das Journal kennt die zwei neuen Werte '");
  });
});
