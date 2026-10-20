/**
 * DIE FILTER DER LAGERÜBERSICHT, an gemischtem Bestand (ADR-0128).
 *
 * WARUM DIESE DATEI EXISTIERT. Die Regel stand bis hierher in einem
 * `useMemo` in `inventory-view.tsx` und war nur über ihren Quelltext zu
 * behaupten. Fünf Bedingungen, die zusammenwirken, sind aber genau die Art
 * Logik, die man einzeln nachfahren will: „ein Portal mit Bestand, Serie SF,
 * nicht im Shop" ist eine Frage mit einer Antwort.
 *
 * DER BESTAND HIER IST DER ECHTE FALL IN KLEIN: zwei Figuren, ein Spiel, ein
 * Portal, eine Position ohne Katalogzeile. Die 13 Spiele-Lagerzeilen auf
 * Staging sind dasselbe, nur mehr davon.
 */
import { describe, expect, it } from "vitest";

import {
  kindsInStock, matchesFilters, visiblePositions, NO_FILTERS,
  type InventoryFilters,
} from "./inventory-filter.ts";
import type { InventoryPosition } from "@/lib/admin/inventory-model";
import type { CatalogFigure } from "@/lib/catalog/types";

function figure(over: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId: "SKY-0001", name: "Bash", slug: "bash", seriesCode: "SA", seriesLabel: "SA",
    seriesPosition: 0, categoryPosition: 0, categoryName: "Figuren", categoryId: 1,
    catalogGroup: "figure", cardType: "standard", catalogVisible: true, canonicalName: "Bash",
    displayNameOverride: null, marketPrice: 10, imageFile: null, imageOverridePath: null,
    displayName: "Bash", sortBaseName: "Bash", sortVariantLabel: null,
    searchIndex: "bash", isActive: true, element: null, characterId: null, ...over,
  };
}

function position(over: Partial<InventoryPosition> = {}): InventoryPosition {
  const quantity = over.quantity ?? 1;
  const reserved = over.reserved ?? 0;
  return {
    inventoryId: 1, skyId: "SKY-0001", condition: "loose",
    quantity, reserved, available: over.available ?? quantity - reserved,
    salePrice: null, effectivePrice: 9, priceSource: "automatic", isListed: true,
    note: null, updatedAt: "2026-10-20T00:00:00Z", figure: figure(), ...over,
  };
}

/* --------------------------------------------------------------------- */
/* Der gemischte Bestand                                                 */
/* --------------------------------------------------------------------- */

/** Figur, Serie SA, Bestand 3, im Shop. */
const BASH = position({
  inventoryId: 1, skyId: "SKY-0001", quantity: 3,
  figure: figure({ skyId: "SKY-0001", itemType: "figure", searchIndex: "bash" }),
});
/** Figur, Serie SF, ausverkauft, nicht im Shop. */
const JETVAC = position({
  inventoryId: 2, skyId: "SKY-0200", quantity: 0, isListed: false,
  figure: figure({
    skyId: "SKY-0200", displayName: "Jet-Vac", seriesCode: "SF", seriesLabel: "SF",
    searchIndex: "jet-vac jetvac", itemType: "figure",
  }),
});
/** Spiel, Serie T, Bestand 2 — der Fall, der bisher unsichtbar war. */
const SPIEL = position({
  inventoryId: 3, skyId: "SKY-0307", quantity: 2, isListed: false,
  figure: figure({
    skyId: "SKY-0307", displayName: "Spiel für Xbox One (EN)", seriesCode: "T",
    seriesLabel: "T", categoryName: "Spiele", itemType: "game",
    searchIndex: "spiel fuer xbox one en", marketPrice: 25,
  }),
});
/** Portal, Serie SF, Bestand 1, unsichtbar im Katalog, ohne Preis. */
const PORTAL = position({
  inventoryId: 4, skyId: "SKY-0632", quantity: 1, isListed: false, effectivePrice: null,
  figure: figure({
    skyId: "SKY-0632", displayName: "84709790 (SF)", seriesCode: "SF", seriesLabel: "SF",
    categoryName: "Portale", itemType: "portal", catalogVisible: false,
    marketPrice: null, searchIndex: "84709790 sf",
  }),
});
/** Und eine Zeile ohne Katalogzeile — außerhalb des Sortiments. */
const FREMD = position({ inventoryId: 5, skyId: "SKY-9998", quantity: 1, figure: null });

const LAGER = [BASH, JETVAC, SPIEL, PORTAL, FREMD];

const mit = (over: Partial<InventoryFilters>): InventoryFilters => ({ ...NO_FILTERS, ...over });
const ids = (list: readonly InventoryPosition[]) => list.map((p) => p.skyId);

/* ===================================================================== */
describe("ohne Filter", () => {
  it("steht alles da — Figuren, Spiele, Portale und das Fremde", () => {
    /* Der Unterschied zu vorher: SKY-0307 und SKY-0632 kamen in dieser
       Liste überhaupt nicht vor. */
    expect(ids(visiblePositions(LAGER, NO_FILTERS)))
      .toEqual(["SKY-0001", "SKY-0200", "SKY-0307", "SKY-0632", "SKY-9998"]);
  });

  it("und die Reihenfolge bleibt unberührt", () => {
    const umgekehrt = [...LAGER].reverse();
    expect(ids(visiblePositions(umgekehrt, NO_FILTERS))).toEqual(ids(umgekehrt));
  });
});

/* ===================================================================== */
describe("Filter nach Art", () => {
  it("Figuren zeigt nur Figuren", () => {
    expect(ids(visiblePositions(LAGER, mit({ kind: "figure" }))))
      /* SKY-9998 ist dabei: ohne Katalogzeile ist nichts anderes bekannt,
         und der Normalfall ist die Figur. Umetikettiert wird sie nicht. */
      .toEqual(["SKY-0001", "SKY-0200", "SKY-9998"]);
  });

  it("Spiele zeigt nur das Spiel", () => {
    expect(ids(visiblePositions(LAGER, mit({ kind: "game" })))).toEqual(["SKY-0307"]);
  });

  it("Portale zeigt nur das Portal", () => {
    expect(ids(visiblePositions(LAGER, mit({ kind: "portal" })))).toEqual(["SKY-0632"]);
  });

  it("eine Art ohne Bestand zeigt nichts — und wirft nicht", () => {
    expect(visiblePositions(LAGER, mit({ kind: "bundle" }))).toEqual([]);
  });

  it("und eine Zeile ohne Artikeltyp zählt als Figur", () => {
    /* Die Zeile aus der Zeit vor `0135`. Sie darf aus der Figurenliste nicht
       verschwinden, nur weil eine Spalte fehlte. */
    const ohne = position({
      inventoryId: 9, skyId: "SKY-0500",
      figure: figure({ skyId: "SKY-0500", itemType: undefined }),
    });
    expect(matchesFilters(ohne, mit({ kind: "figure" }))).toBe(true);
    expect(matchesFilters(ohne, mit({ kind: "game" }))).toBe(false);
  });
});

/* ===================================================================== */
describe("Filter nach Bestand und Shop", () => {
  it("„auf Lager“ lässt die ausverkaufte Figur weg, das Spiel aber nicht", () => {
    expect(ids(visiblePositions(LAGER, mit({ stock: "in" }))))
      .toEqual(["SKY-0001", "SKY-0307", "SKY-0632", "SKY-9998"]);
  });

  it("„nicht auf Lager“ findet genau die ausverkaufte Figur", () => {
    expect(ids(visiblePositions(LAGER, mit({ stock: "out" })))).toEqual(["SKY-0200"]);
  });

  it("„im Shop“ findet kein Zubehör — es ist nie gelistet", () => {
    expect(ids(visiblePositions(LAGER, mit({ listing: "listed" }))))
      .toEqual(["SKY-0001", "SKY-9998"]);
  });

  it("„nicht im Shop“ findet Spiel und Portal", () => {
    expect(ids(visiblePositions(LAGER, mit({ listing: "unlisted" }))))
      .toEqual(["SKY-0200", "SKY-0307", "SKY-0632"]);
  });
});

/* ===================================================================== */
describe("Filter nach Serie", () => {
  it("SF zeigt die Figur und das Portal derselben Serie", () => {
    expect(ids(visiblePositions(LAGER, mit({ seriesCode: "SF" }))))
      .toEqual(["SKY-0200", "SKY-0632"]);
  });

  it("eine Position ohne Katalogzeile hat keine Serie und fällt heraus", () => {
    expect(ids(visiblePositions(LAGER, mit({ seriesCode: "SA" })))).toEqual(["SKY-0001"]);
  });
});

/* ===================================================================== */
describe("die Suche", () => {
  it("findet ein Portal über seine Modellnummer", () => {
    /* DER FALL, UM DEN ES GEHT. Ein Portal heißt `84709790 (SF)` — der
       Betreiber hat es in der Hand und kennt keinen Namen dafür. */
    expect(ids(visiblePositions(LAGER, mit({ query: "84709790" })))).toEqual(["SKY-0632"]);
  });

  it("findet ein Spiel über seinen Anzeigenamen", () => {
    expect(ids(visiblePositions(LAGER, mit({ query: "Xbox" })))).toEqual(["SKY-0307"]);
  });

  it("findet jede Position über ihre SKY-ID, auch die ohne Katalogzeile", () => {
    expect(ids(visiblePositions(LAGER, mit({ query: "sky-9998" })))).toEqual(["SKY-9998"]);
    expect(ids(visiblePositions(LAGER, mit({ query: "SKY-0632" })))).toEqual(["SKY-0632"]);
  });

  it("und eine leere Suche filtert nichts", () => {
    expect(visiblePositions(LAGER, mit({ query: "   " }))).toHaveLength(LAGER.length);
  });
});

/* ===================================================================== */
describe("die Filter wirken zusammen", () => {
  it("Portale mit Bestand in Serie SF — eine Position", () => {
    expect(ids(visiblePositions(LAGER, mit({
      kind: "portal", stock: "in", seriesCode: "SF", listing: "unlisted",
    })))).toEqual(["SKY-0632"]);
  });

  it("und eine Bedingung, die keine erfüllt, zeigt nichts", () => {
    /* Ein Portal, das im Shop steht, gibt es nicht — und das ist der Riegel,
       nicht ein leeres Ergebnis aus Versehen. */
    expect(visiblePositions(LAGER, mit({ kind: "portal", listing: "listed" }))).toEqual([]);
  });

  it("jede einzelne Bedingung muss zutreffen, nicht irgendeine", () => {
    /* Richtige Serie, falsche Art. */
    expect(matchesFilters(PORTAL, mit({ seriesCode: "SF", kind: "game" }))).toBe(false);
    /* Richtige Art, falsche Serie. */
    expect(matchesFilters(PORTAL, mit({ seriesCode: "T", kind: "portal" }))).toBe(false);
    /* Beides richtig. */
    expect(matchesFilters(PORTAL, mit({ seriesCode: "SF", kind: "portal" }))).toBe(true);
  });
});

/* ===================================================================== */
describe("welche Arten der Filter anbietet", () => {
  it("nur die, die wirklich im Lager liegen", () => {
    expect(kindsInStock(LAGER)).toEqual(["figure", "game", "portal"]);
  });

  it("in der Reihenfolge von INVENTORY_KINDS, nicht in der des Ladens", () => {
    expect(kindsInStock([PORTAL, SPIEL, BASH])).toEqual(["figure", "game", "portal"]);
  });

  it("ein reines Figurenlager bietet eine Art an — und die Ansicht blendet das Feld dann aus", () => {
    expect(kindsInStock([BASH, JETVAC])).toEqual(["figure"]);
  });

  it("ein leeres Lager bietet keine an", () => {
    expect(kindsInStock([])).toEqual([]);
  });
});
