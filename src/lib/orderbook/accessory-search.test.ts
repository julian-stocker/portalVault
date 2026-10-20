/**
 * Zubehör im Einkaufsbuch: suchen, erkennen, mischen (0137).
 *
 * WAS HIER GEPRÜFT WIRD UND WAS NICHT. Diese Datei prüft reine Logik und
 * Quelltext — die Rangfolge der Suche, das Erkennen eines Zubehörartikels,
 * die Mischung aus Figuren und Zubehör in einem Entwurf, und dass die
 * Oberfläche die Felder benutzt, die seit `0137` ankommen. Sie prüft KEIN
 * Datenbankverhalten; dass `seller_create_catalog_item` eine Figur ablehnt
 * und welche 21 SKY-IDs `0138` setzt, steht in
 * `src/lib/catalog/accessories.test.ts` als Textbefund, in den Migrationen
 * selbst als Nachbedingung und in `npm run verify:check-sql` (P22-P27) als
 * Lauf gegen echtes PostgreSQL.
 *
 * DIE DREI FÄLLE, DIE DIE AUFGABE NENNT
 *
 *   BESTEHENDE ARTIKEL — die 39 Spiele. Sie waren immer Katalogzeilen; neu
 *   ist, dass die Suche sie als Spiel ausweist und über „spiel" findet.
 *   NEU ANGELEGTE ARTIKEL — ein Portal mit Modellnummer als Namen. Es wird
 *   über die Art gefunden, weil niemand `84709790` im Kopf hat.
 *   GEMISCHTE EINKÄUFE — Figuren und Zubehör in einem Entwurf: Mengen,
 *   Preise und Zeilen müssen unberührt bleiben.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  isAccessory, isPickableCatalogRow, MAX_RESULTS, rankFigure, searchFigures,
  type FigureChoice,
} from "./figure-search.ts";
import { addFigure, draftValue, setQuantity } from "./draft.ts";

const read = (p: string) => readFileSync(p, "utf8");

/* --------------------------------------------------------------------- */
/* Fixtures. Echte Formen: eine Figur, ein Spiel mit Anzeigenamen, ein   */
/* Portal, dessen Name eine Modellnummer ist.                            */
/* --------------------------------------------------------------------- */

const SPYRO: FigureChoice = {
  skyId: "SKY-0012", name: "Spyro", series: "SA", marketPrice: 9.5,
  itemType: "figure", categoryName: "Figuren",
};
/* Ein Spiel wie im Katalog: Rohname aus der Arbeitsmappe, Anzeigename vom
   Administrator (0117), Kategorie `Spiele`, Artikeltyp `game` seit 0135. */
const SPIEL: FigureChoice = {
  skyId: "SKY-0001", name: "Spectrum Adventure (PC)", rawName: "Game (PC)",
  series: "SA", marketPrice: 14, itemType: "game", categoryName: "Spiele",
};
/* Ein Portal, wie `seller_create_catalog_item` es anlegt: der Name ist die
   Modellnummer, es gibt keinen Preis, die Kategorie heisst `Portale`. */
const PORTAL: FigureChoice = {
  skyId: "SKY-0823", name: "84709790 Portal (SF)", series: "SF",
  marketPrice: null, itemType: "portal", categoryName: "Portale",
};
const TASCHE: FigureChoice = {
  skyId: "SKY-0824", name: "Tragetasche", series: "T",
  marketPrice: null, itemType: "other", categoryName: "Zubehör",
};
/* Und eine Zeile aus der Zeit VOR 0137: die alte Funktionsfassung lieferte
   weder Artikeltyp noch Kategorie. */
const OHNE_AUSKUNFT: FigureChoice = {
  skyId: "SKY-0200", name: "Jet-Vac", series: "SF", marketPrice: 7,
};

const KATALOG = [SPYRO, SPIEL, PORTAL, TASCHE, OHNE_AUSKUNFT];

/* ===================================================================== */
describe("isAccessory", () => {
  it("erkennt Spiel, Portal und Zubehör", () => {
    expect(isAccessory(SPIEL)).toBe(true);
    expect(isAccessory(PORTAL)).toBe(true);
    expect(isAccessory(TASCHE)).toBe(true);
  });

  it("eine Figur ist keines", () => {
    expect(isAccessory(SPYRO)).toBe(false);
  });

  it("und eine fehlende Auskunft macht aus einer Figur kein Zubehör", () => {
    /* `undefined` heisst „die alte Funktionsfassung läuft noch", nicht
       „keine Figur". Das ist der Fall zwischen Migration und Deployment. */
    expect(isAccessory(OHNE_AUSKUNFT)).toBe(false);
  });
});

/* ===================================================================== */
describe("suchen", () => {
  it("findet ein Spiel über seinen Anzeigenamen wie jede Figur", () => {
    expect(searchFigures(KATALOG, "spectrum").map((c) => c.skyId)).toEqual(["SKY-0001"]);
  });

  it("findet ein Spiel auch über seinen Rohnamen aus der Arbeitsmappe", () => {
    expect(searchFigures(KATALOG, "game (pc)").map((c) => c.skyId)).toEqual(["SKY-0001"]);
  });

  it("findet ein Portal über die Modellnummer in seinem Namen", () => {
    expect(searchFigures(KATALOG, "84709").map((c) => c.skyId)).toEqual(["SKY-0823"]);
  });

  it("findet Portale über die ART — der Grund, warum die Kategorie mitkommt", () => {
    /* Der Betreiber hat das Ding in der Hand und kennt `84709790` nicht. */
    expect(searchFigures(KATALOG, "portal").map((c) => c.skyId)).toEqual(["SKY-0823"]);
  });

  it("findet Spiele über die Kategorie", () => {
    expect(searchFigures(KATALOG, "spiele").map((c) => c.skyId)).toEqual(["SKY-0001"]);
  });

  it("und Zubehör ebenso", () => {
    expect(searchFigures(KATALOG, "zubehör").map((c) => c.skyId)).toEqual(["SKY-0824"]);
  });

  it("der Name schlägt die Art — immer", () => {
    /* `Portalfigur` ist eine erfundene Figur, deren NAME mit „portal"
       beginnt. Sie muss über dem Portal stehen, dessen ART so heisst. */
    const namensgleich: FigureChoice = {
      skyId: "SKY-0300", name: "Portalfigur", series: "T", marketPrice: 3,
      itemType: "figure", categoryName: "Figuren",
    };
    expect(searchFigures([PORTAL, namensgleich], "portal").map((c) => c.skyId))
      .toEqual(["SKY-0300", "SKY-0823"]);
    expect(rankFigure(namensgleich, "portal")).toBeLessThan(rankFigure(PORTAL, "portal")!);
  });

  it("die Art trifft nur am Wortanfang", () => {
    /* `includes` hätte „or" aus „Portale" geholt und mit zwei Zeichen den
       halben Katalog geliefert.
       Geprüft an einer Zeile, deren NAME das Bruchstück nicht enthält —
       sonst hätte der Namenstreffer geantwortet und nicht die Art. */
    const stilles: FigureChoice = {
      skyId: "SKY-0825", name: "0000586", series: "T",
      marketPrice: null, itemType: "portal", categoryName: "Portale",
    };
    expect(rankFigure(stilles, "ortale")).toBeNull();
    expect(rankFigure(stilles, "rtal")).toBeNull();
    /* Am Anfang trifft sie: das ist der Zweck. */
    expect(rankFigure(stilles, "portale")).not.toBeNull();
    expect(rankFigure(TASCHE, "behör")).toBeNull();
  });

  it("eine Zeile ohne Artikeltyp und ohne Kategorie verhält sich wie vor 0137", () => {
    expect(searchFigures(KATALOG, "jet").map((c) => c.skyId)).toEqual(["SKY-0200"]);
    expect(rankFigure(OHNE_AUSKUNFT, "portal")).toBeNull();
  });

  it("und eine Figur wird durch die neuen Felder nicht gefunden, wo sie es vorher nicht wurde", () => {
    expect(rankFigure(SPYRO, "portal")).toBeNull();
    expect(rankFigure(SPYRO, "spiel")).toBeNull();
    /* Die Kategorie `Figuren` ist ebenfalls suchbar, und das ist richtig:
       wer „figuren" tippt, will Figuren. */
    expect(rankFigure(SPYRO, "figuren")).not.toBeNull();
  });

  it("die Ergebnisgrenze gilt unverändert", () => {
    const viele: FigureChoice[] = Array.from({ length: 20 }, (_, i) => ({
      skyId: `SKY-9${String(i).padStart(3, "0")}`,
      name: `${i} Portal`, series: "SF", marketPrice: null,
      itemType: "portal", categoryName: "Portale",
    }));
    expect(searchFigures(viele, "portale")).toHaveLength(MAX_RESULTS);
  });
});

/* ===================================================================== */
describe("gemischte Einkäufe", () => {
  it("Figur, Spiel und Portal stehen als eigene Zeilen im Entwurf", () => {
    let lines = addFigure([], SPYRO);
    lines = addFigure(lines, SPIEL);
    lines = addFigure(lines, PORTAL);
    expect(lines.map((l) => l.skyId)).toEqual(["SKY-0012", "SKY-0001", "SKY-0823"]);
    expect(lines.every((l) => l.quantity === 1)).toBe(true);
  });

  it("zwei gleiche Portale sind eine Zeile mit Menge zwei — wie bei Figuren", () => {
    const lines = addFigure(addFigure([], PORTAL), PORTAL);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(2);
  });

  it("die Mengensteuerung wirkt auf ein Portal wie auf eine Figur", () => {
    const lines = setQuantity(addFigure([], PORTAL), "SKY-0823", 3);
    expect(lines[0].quantity).toBe(3);
    expect(setQuantity(lines, "SKY-0823", 0)).toEqual([]);
  });

  it("ein preisloses Portal zählt mit, ohne den bekannten Wert zu verfälschen", () => {
    /* `marketPrice: null` heisst „unbekannt" und ist nie 0 (ADR-0010): das
       Portal zählt als Position, trägt aber nichts zum bekannten Wert bei,
       und der Faktor sagt deshalb ausdrücklich „nicht vollständig". */
    let lines = addFigure([], SPYRO);
    lines = addFigure(lines, PORTAL);
    const wert = draftValue(20, lines);
    expect(wert.knownValue).toBe(9.5);
    expect(wert.knownItems).toBe(1);
    expect(wert.countedItems).toBe(2);
    expect(wert.unknownItems).toBe(1);
  });
});

/* ===================================================================== */
describe("die Oberfläche benutzt, was ankommt", () => {
  const SEARCH_UI = read("src/components/business/figure-search.tsx");
  const ADD_UI = read("src/components/business/add-purchase-item.tsx");
  const NEW_UI = read("src/components/business/new-catalog-item.tsx");
  const QUERIES = read("src/lib/orderbook/queries.ts");
  const ACTIONS = read("src/lib/orderbook/actions.ts");

  it("die Katalogabfrage führt Artikeltyp und Kategorie mit", () => {
    expect(QUERIES).toContain("itemType:");
    expect(QUERIES).toContain("categoryName:");
    /* Und sie wirft beides nicht weg, wenn die Spalte fehlt — dann ist es
       `undefined`, nicht `"figure"`. */
    expect(QUERIES).toContain("r.item_type === undefined || r.item_type === null");
  });

  it("die Trefferliste zeigt die Art nur bei Zubehör", () => {
    expect(SEARCH_UI).toContain("isAccessory(choice)");
    expect(SEARCH_UI).toContain("copy.itemTypes");
  });

  it("der Kasten zum Anlegen bietet keine Figur an", () => {
    expect(NEW_UI).toContain('const WAEHLBAR = ["portal", "game", "bundle", "other"] as const;');
    expect(NEW_UI).not.toMatch(/WAEHLBAR[^;]*"figure"/);
  });

  it("er korrigiert den eingetippten Namen nicht", () => {
    for (const attribut of ['autoCorrect="off"', 'autoCapitalize="off"', "spellCheck={false}"]) {
      expect(NEW_UI, attribut).toContain(attribut);
    }
  });

  it("die erfolglose Suche führt in das Anlegen, mit dem getippten Namen", () => {
    expect(ADD_UI).toContain("onFree={(name) => { setDraftName(name)");
    expect(ADD_UI).toContain("initialName={draftName}");
  });

  it("angelegt und hinzugefügt ist EIN Schritt, ohne zweite Suche", () => {
    expect(ACTIONS).toContain("seller_create_catalog_item");
    const block = ACTIONS.slice(ACTIONS.indexOf("export async function createCatalogItem"));
    const koerper = block.slice(0, block.indexOf("\n}\n") + 2);
    expect(koerper).toContain("seller_add_purchase_item");
    expect(koerper).toContain("p_sky_id: skyId");
  });

  it("der halbe Erfolg wird gesagt, nicht verschwiegen", () => {
    /*
     * Der Artikel ist angelegt, die Position nicht entstanden — dann trägt
     * das Ergebnis eine SKY-ID. Nur die Fehlermeldung zu zeigen hiesse, den
     * Betreiber in das Anlegen zurückzuschicken, und dieselbe Sache bekäme
     * eine zweite Identität (CLAUDE.md Regel 2).
     */
    const ui = read("src/components/business/new-catalog-item.tsx");
    expect(ui).toContain("result.skyId === undefined");
    expect(ui).toContain("copy.createdNotAdded(result.skyId)");
    /* Und die Server Action gibt die SKY-ID im Fehlerfall wirklich mit. */
    const actions = read("src/lib/orderbook/actions.ts");
    expect(actions).toContain("return { ok: false, message: orderbookMessage(added.error), skyId }");
    /* Der Artikel wird dabei NICHT wieder gelöscht. */
    expect(actions).not.toContain("delete_catalog_item");
  });

  it("und der Freitextweg bleibt erreichbar", () => {
    expect(ADD_UI).toContain('setMode("free")');
    expect(ADD_UI).toContain("addPurchaseItem(purchaseId, skyId, name)");
  });
});

/* ===================================================================== */
/*
 * WAS ÜBERHAUPT ZUR WAHL STEHT (0117, geschärft in 0137)
 *
 * Der Fall, der diese Regel nötig gemacht hat: `seller_create_catalog_item`
 * legt jeden Zubehörartikel mit `catalog_visible = false` an — im
 * öffentlichen Katalog hat er nichts zu suchen. Mit dem Riegel von `0117`
 * auf ALLEN Zeilen wäre genau dieser Artikel unmittelbar nach seiner
 * Entstehung wieder unauffindbar: einmal hinzugefügt, weil die SKY-ID aus der
 * Anlegefunktion direkt in die Position geht — und danach nie wieder, nicht
 * für ein zweites Exemplar und nicht für den nächsten Einkauf. Der Bestand
 * wäre da, die Historie auch, nur der Weg dorthin nicht.
 */
/* ===================================================================== */
describe("was im Einkauf zur Wahl steht", () => {
  /** Eine Zeile, wie `seller_import_catalog()` sie liefert. */
  const zeile = (ueber: Record<string, unknown> = {}) => ({
    is_active: true, catalog_visible: true, item_type: "figure", ...ueber,
  });

  it("eine sichtbare, aktive Figur steht zur Wahl", () => {
    expect(isPickableCatalogRow(zeile())).toBe(true);
  });

  it("eine AUSGEBLENDETE Figur nicht — der Grund von 0117 bleibt in Kraft", () => {
    /* Eon's Elite: drei Katalogzeilen je Figur, zwei davon seit Langem nicht
       mehr angeboten. Genau die sollen nicht zur Wahl stehen. */
    expect(isPickableCatalogRow(zeile({ catalog_visible: false }))).toBe(false);
  });

  it("ein NEUES PORTAL steht zur Wahl, obwohl es unsichtbar ist", () => {
    /* Das ist die Ausnahme, und sie ist der ganze Punkt. */
    expect(isPickableCatalogRow(
      zeile({ catalog_visible: false, item_type: "portal" }))).toBe(true);
  });

  it("und ebenso ein Spiel, ein Bundle und sonstiges Zubehör", () => {
    for (const art of ["game", "bundle", "other"]) {
      expect(isPickableCatalogRow(
        zeile({ catalog_visible: false, item_type: art })), art).toBe(true);
    }
  });

  it("`is_active = false` nimmt JEDE Zeile aus der Wahl — auch ein Portal", () => {
    /* Der technische Riegel gilt ohne Ausnahme. Er ist damit der Weg, eine
       falsch angelegte Zubehörzeile wieder aus der Auswahl zu nehmen. */
    expect(isPickableCatalogRow(zeile({ is_active: false }))).toBe(false);
    expect(isPickableCatalogRow(
      zeile({ is_active: false, item_type: "portal" }))).toBe(false);
    expect(isPickableCatalogRow(
      zeile({ is_active: false, catalog_visible: false, item_type: "portal" }))).toBe(false);
  });

  it("ohne Auskunft bleibt es beim Verhalten von 0117", () => {
    /*
     * Läuft noch die siebenspaltige Fassung der RPC — zwischen Migration und
     * Deployment —, fehlen die Felder. Dann wird NICHTS ausgefiltert, was
     * vorher drin war, und es öffnet sich auch nichts: eine ausgeblendete
     * Zeile ohne Artikeltyp bleibt draußen.
     */
    expect(isPickableCatalogRow({})).toBe(true);
    expect(isPickableCatalogRow({ catalog_visible: false })).toBe(false);
    expect(isPickableCatalogRow({ catalog_visible: false, item_type: null })).toBe(false);
    expect(isPickableCatalogRow({ is_active: true, catalog_visible: true })).toBe(true);
  });

  it("und `figure` ist ausdrücklich keine Ausnahme", () => {
    /* Sonst stünde über den Artikeltyp plötzlich jede ausgeblendete Figur
       zur Wahl — das Gegenteil von 0117. */
    expect(isPickableCatalogRow(
      zeile({ catalog_visible: false, item_type: "figure" }))).toBe(false);
  });
});
