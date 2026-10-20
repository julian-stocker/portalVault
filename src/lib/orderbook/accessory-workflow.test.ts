/**
 * DER WEG EINES ZUBEHÖRARTIKELS, VON DER SUCHE BIS INS LAGER (ADR-0128).
 *
 * WARUM DIESE DATEI NEBEN DEN ANDEREN STEHT. `accessory-search.test.ts`
 * prüft die Suche, `inventory-filter.test.ts` die Filter,
 * `inventory-overview.test.ts` die Kennzahlen — jede für sich, jede mit
 * eigenen Fixtures. Was keine von ihnen prüft, ist die KETTE: dass dieselbe
 * Katalogzeile, die die Suche findet, als Position im Entwurf landet, als
 * Lagerzeile wiederkommt und dort richtig einsortiert wird. Genau dort
 * brechen Dinge, die einzeln funktionieren.
 *
 * DIE FIXTURES SIND DIE ECHTEN DATENFORMEN VON STAGING, gelesen am
 * 2026-10-20 nach dem Lauf von `0137`/`0138`:
 *
 *   SKY-0110  Spiel   Anzeigename `Skylanders Giants – PS3`,
 *                     Rohname `Spiel für Sony Playstation 3 PS3`,
 *                     Kategorie `Spiele`, Bestand 1, gelistet (Altlast)
 *   SKY-0632  Portal  Name `84709790 (SF)`, Kategorie `Portale`,
 *                     unsichtbar, ohne Preis, noch ohne Lagerzeile
 *   SKY-0012  Figur   der Normalfall daneben
 *
 * Es werden KEINE Daten auf Staging angelegt; die Formen sind abgeschrieben,
 * nicht erzeugt.
 */
import { describe, expect, it } from "vitest";

import {
  isAccessory, isPickableCatalogRow, rankFigure, searchFigures, type FigureChoice,
} from "./figure-search.ts";
import { addFigure, draftPayload, draftUnitCount, draftValue, setQuantity } from "./draft.ts";
import {
  inventoryKind, isAccessoryPosition, isShopGoods, type InventoryPosition,
} from "@/lib/admin/inventory-model";
import { inventoryOverview, isOffered } from "@/lib/admin/inventory-overview";
import { kindsInStock, visiblePositions, NO_FILTERS } from "@/lib/admin/inventory-filter";
import type { CatalogFigure } from "@/lib/catalog/types";
import { buildSearchIndex } from "@/lib/catalog/search";

/* --------------------------------------------------------------------- */
/* Die drei Artikel, in beiden Gestalten: als Auswahlzeile und als        */
/* Katalogzeile. Dieselbe SKY-ID, derselbe Name — das ist der Punkt.      */
/* --------------------------------------------------------------------- */

const SPIEL: FigureChoice = {
  skyId: "SKY-0110",
  name: "Skylanders Giants – PS3",
  rawName: "Spiel für Sony Playstation 3 PS3",
  series: "G",
  marketPrice: 12,
  itemType: "game",
  categoryName: "Spiele",
};
const PORTAL: FigureChoice = {
  skyId: "SKY-0632",
  name: "84709790 (SF)",
  rawName: "84709790 (SF)",
  series: "SF",
  marketPrice: null,
  itemType: "portal",
  categoryName: "Portale",
};
const FIGUR: FigureChoice = {
  skyId: "SKY-0012",
  name: "Spyro",
  series: "SA",
  marketPrice: 9.5,
  itemType: "figure",
  categoryName: "Figuren",
};
const KATALOG = [FIGUR, SPIEL, PORTAL];

function katalogzeile(choice: FigureChoice, over: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId: choice.skyId, name: choice.rawName ?? choice.name, slug: "x",
    seriesCode: choice.series, seriesLabel: choice.series, seriesPosition: 0,
    categoryPosition: 0, categoryName: choice.categoryName ?? "", categoryId: 1,
    catalogGroup: null, cardType: "standard",
    catalogVisible: choice.itemType === "figure" || choice.itemType === "game",
    canonicalName: choice.rawName ?? choice.name, displayNameOverride: null,
    marketPrice: choice.marketPrice, imageFile: null, imageOverridePath: null,
    displayName: choice.name, sortBaseName: choice.name, sortVariantLabel: null,
    searchIndex: buildSearchIndex([choice.name, choice.rawName ?? choice.name]),
    isActive: true, element: null, characterId: null, itemType: choice.itemType, ...over,
  };
}

function lagerzeile(
  choice: FigureChoice, over: Partial<InventoryPosition> = {},
): InventoryPosition {
  const quantity = over.quantity ?? 1;
  return {
    inventoryId: Number(choice.skyId.slice(4)), skyId: choice.skyId, condition: "loose",
    quantity, reserved: 0, available: quantity, salePrice: null,
    effectivePrice: choice.marketPrice, priceSource: "automatic", isListed: true,
    note: null, updatedAt: "2026-10-20T00:00:00Z",
    figure: katalogzeile(choice), ...over,
  };
}

/* ===================================================================== */
describe("1. Vorhandene Spiele und Portale suchen und auswählen", () => {
  it("ein Spiel über seinen Anzeigenamen", () => {
    /* So heißen die 39 Spiele auf Staging wirklich: `Skylanders Giants – PS3`
       und nicht `Wii Spiel`. Alle 39 Anzeigenamen sind verschieden. */
    expect(searchFigures(KATALOG, "Giants").map((c) => c.skyId)).toEqual(["SKY-0110"]);
  });

  it("über die Plattform, die im Anzeigenamen steckt", () => {
    expect(searchFigures(KATALOG, "PS3").map((c) => c.skyId)).toEqual(["SKY-0110"]);
  });

  it("und über den Rohnamen aus der Arbeitsmappe", () => {
    /* Der Rohname bleibt erreichbar — eine Mappe von 2024 kennt die
       redaktionellen Entscheidungen von heute nicht. */
    expect(searchFigures(KATALOG, "Playstation").map((c) => c.skyId)).toEqual(["SKY-0110"]);
  });

  it("ein Portal über seine Modellnummer", () => {
    /* Der Betreiber hält es in der Hand und kennt keinen Namen dafür. */
    expect(searchFigures(KATALOG, "84709790").map((c) => c.skyId)).toEqual(["SKY-0632"]);
  });

  it("und beide über ihre ART, wenn der Name nicht einfällt", () => {
    expect(searchFigures(KATALOG, "portal").map((c) => c.skyId)).toEqual(["SKY-0632"]);
    expect(searchFigures(KATALOG, "spiele").map((c) => c.skyId)).toEqual(["SKY-0110"]);
  });

  it("der Name schlägt die Art — „Spyro“ bleibt die Figur", () => {
    /* Sonst stünde bei jeder Figurensuche die halbe Kategorie davor. */
    expect(searchFigures(KATALOG, "Spyro").map((c) => c.skyId)).toEqual(["SKY-0012"]);
    expect(rankFigure(FIGUR, "spyro")! < rankFigure(SPIEL, "spiele")!).toBe(true);
  });

  it("und die Trefferliste weist nur das Zubehör als solches aus", () => {
    expect(isAccessory(SPIEL)).toBe(true);
    expect(isAccessory(PORTAL)).toBe(true);
    expect(isAccessory(FIGUR)).toBe(false);
  });
});

/* ===================================================================== */
describe("2. Ein neu angelegter Artikel bleibt auffindbar", () => {
  it("auch unsichtbar im Katalog — sonst wäre er nach dem ersten Mal fort", () => {
    /*
     * `seller_create_catalog_item` schreibt `catalog_visible = false`. Der
     * Artikel geht über die zurückgegebene SKY-ID direkt in die Position;
     * ohne diese Regel wäre er danach nie wieder wählbar — nicht für ein
     * zweites Exemplar und nicht für den nächsten Einkauf.
     */
    const neu = { is_active: true, catalog_visible: false, item_type: "portal" };
    expect(isPickableCatalogRow(neu)).toBe(true);
  });

  it("eine ausgeblendete FIGUR bleibt dagegen draußen", () => {
    expect(isPickableCatalogRow(
      { is_active: true, catalog_visible: false, item_type: "figure" })).toBe(false);
  });

  it("und eine falsch angelegte Zubehörzeile nimmt `is_active` wieder heraus", () => {
    expect(isPickableCatalogRow(
      { is_active: false, catalog_visible: false, item_type: "portal" })).toBe(false);
  });
});

/* ===================================================================== */
describe("3. Ein gemischter Einkauf", () => {
  /** Zwei Figuren, ein Spiel, zwei gleiche Portale. */
  const entwurf = (() => {
    let lines = addFigure([], FIGUR);
    lines = setQuantity(lines, FIGUR.skyId, 2);
    lines = addFigure(lines, SPIEL);
    lines = addFigure(lines, PORTAL);
    lines = setQuantity(lines, PORTAL.skyId, 2);
    return lines;
  })();

  it("Figur, Spiel und Portal stehen als eigene Zeilen nebeneinander", () => {
    expect(entwurf.map((l) => l.skyId))
      .toEqual(["SKY-0012", "SKY-0110", "SKY-0632"]);
    /* Und jede Zeile trägt den Anzeigenamen, den die Suche gezeigt hat. */
    expect(entwurf.map((l) => l.name))
      .toEqual(["Spyro", "Skylanders Giants – PS3", "84709790 (SF)"]);
  });

  it("Mengen wirken auf ein Portal wie auf eine Figur", () => {
    expect(entwurf.map((l) => l.quantity)).toEqual([2, 1, 2]);
    expect(draftUnitCount(entwurf)).toBe(5);
  });

  it("jede Einheit geht einzeln an die Datenbank — fünf Positionen", () => {
    /* Eine Einkaufsposition ist EIN physisches Objekt (0053). */
    const payload = draftPayload(entwurf);
    expect(payload).toHaveLength(5);
    expect(payload.filter((p) => p.sky_id === "SKY-0632")).toHaveLength(2);
  });

  it("und der bekannte Marktwert verfälscht sich am preislosen Portal nicht", () => {
    /*
     * 2 × 9,50 € + 1 × 12 € = 31 €. Die zwei Portale haben keinen Marktpreis
     * — NULL heißt unbekannt und nie 0 (ADR-0010), sie zählen also als
     * Einheiten mit, aber nicht im Wert.
     */
    const wert = draftValue(100, entwurf);
    expect(wert.knownValue).toBe(31);
    expect(wert.knownItems).toBe(3);
    expect(wert.unknownItems).toBe(2);
    expect(wert.countedItems).toBe(5);
    /* Und die Übersicht sagt, dass sie unvollständig ist, statt eine Zahl
       zu zeigen, die nach allem aussieht. */
    expect(wert.complete).toBe(false);
  });
});

/* ===================================================================== */
describe("4. Und im Lager", () => {
  /*
   * Der Stand von Staging in klein: Figuren mit Bestand, 13 Spiele-Zeilen
   * (hier eine, stellvertretend) — und ein Portal, das gerade eingebucht
   * wurde.
   */
  const FIGUR_LAGER = lagerzeile(FIGUR, { quantity: 3 });
  const SPIEL_LAGER = lagerzeile(SPIEL, { quantity: 1, isListed: true });
  const PORTAL_LAGER = lagerzeile(PORTAL, { quantity: 2, isListed: false, effectivePrice: null });
  const LAGER = [FIGUR_LAGER, SPIEL_LAGER, PORTAL_LAGER];

  it("dieselbe Katalogzeile trägt dieselbe Art wie in der Suche", () => {
    /* Die Kette: was die Suche `game` nannte, nennt das Lager auch `game`. */
    expect(inventoryKind(SPIEL_LAGER)).toBe("game");
    expect(inventoryKind(PORTAL_LAGER)).toBe("portal");
    expect(inventoryKind(FIGUR_LAGER)).toBe("figure");
  });

  it("das eingebuchte Portal steht in der Liste — es wird benannt, nicht gezählt", () => {
    const sichtbar = visiblePositions(LAGER, NO_FILTERS);
    expect(sichtbar.map((p) => p.skyId))
      .toEqual(["SKY-0012", "SKY-0110", "SKY-0632"]);
    expect(sichtbar.every((p) => p.figure !== null)).toBe(true);
  });

  it("und ist über die Art zu filtern", () => {
    expect(kindsInStock(LAGER)).toEqual(["figure", "game", "portal"]);
    expect(visiblePositions(LAGER, { ...NO_FILTERS, kind: "portal" })
      .map((p) => p.skyId)).toEqual(["SKY-0632"]);
  });

  it("ein GELISTETES Spiel ist trotzdem kein Angebot — die Altlast auf Staging", () => {
    /*
     * Alle 13 Spiele-Lagerzeilen tragen `is_listed = true`. Die Flagge ist
     * wirkungslos: `shop_offers()` filtert sie über `is_shop_eligible()` am
     * Artikeltyp heraus, und `verify:shop:staging` zählt sie als
     * „held back: not a collectible 13". Die Oberfläche darf dafür keinen
     * Schalter zeigen, der „Im Shop" sagt.
     */
    expect(SPIEL_LAGER.isListed).toBe(true);
    expect(isOffered(SPIEL_LAGER)).toBe(false);
    expect(isShopGoods(SPIEL_LAGER)).toBe(false);
  });

  it("die fünf Kennzahlen bleiben Figurenzahlen", () => {
    const alles = inventoryOverview(LAGER);
    const nurFigur = inventoryOverview([FIGUR_LAGER]);
    expect(alles.stockPieces).toBe(nurFigur.stockPieces);
    expect(alles.marketValue).toBe(nurFigur.marketValue);
    expect(alles.offeredPieces).toBe(nurFigur.offeredPieces);
  });

  it("und das Zubehör steht daneben: 2 Positionen, 3 Stück", () => {
    const o = inventoryOverview(LAGER);
    expect(o.accessoryPositions).toBe(2);
    expect(o.accessoryPieces).toBe(3);
    expect(LAGER.filter(isAccessoryPosition).map((p) => p.skyId))
      .toEqual(["SKY-0110", "SKY-0632"]);
  });
});
