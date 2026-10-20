/**
 * SPIELE UND PORTALE IM LAGER (ADR-0128).
 *
 * WAS HIER AUF DEM SPIEL STEHT. Das Lager hat immer schon Zubehör geführt —
 * 13 Lagerzeilen und 18 Verkaufspositionen hängen an Spielen, seit dem ersten
 * Tag. Sichtbar waren sie nicht: `fetchInventory()` sortierte jede nicht
 * sammelbare Zeile in einen `outsideScope`-Topf, und an die Oberfläche ging
 * davon nur die ANZAHL.
 *
 * Diese Datei prüft, dass sie jetzt sichtbar sind UND dass die Trennung
 * geblieben ist: nicht sammelbar, nicht shopfähig, nicht in den
 * Figurenkennzahlen.
 *
 * Die FILTER stehen in `inventory-filter.test.ts`, die KENNZAHLEN in
 * `inventory-overview.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  INVENTORY_KINDS, inventoryKind, isAccessoryPosition, isInventoryKind, isShopGoods,
  type InventoryPosition,
} from "./inventory-model.ts";
import type { CatalogFigure } from "@/lib/catalog/types";
import { isCollectible } from "@/lib/catalog/collectible";
import { de } from "@/lib/i18n/de";

const read = (p: string) => readFileSync(p, "utf8");
/** Quelltext ohne Kommentare — was er TUT, nicht was er sagt. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CATALOG = "src/lib/catalog/queries.ts";
const INVENTORY = "src/lib/admin/inventory.ts";
const VIEW = "src/components/admin/inventory-view.tsx";
const CARD = "src/components/admin/inventory-card.tsx";
const PANEL = "src/components/admin/inventory-overview.tsx";
const PAGE = "src/app/(business)/business/inventory/page.tsx";

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
  return {
    inventoryId: 1, skyId: "SKY-0001", condition: "loose", quantity: 1, reserved: 0,
    available: 1, salePrice: null, effectivePrice: 9, priceSource: "automatic",
    isListed: true, note: null, updatedAt: "2026-10-20T00:00:00Z", figure: figure(), ...over,
  };
}

/* ===================================================================== */
describe("die Art einer Lagerposition", () => {
  it("kennt genau die fünf Werte des CHECK aus 0135", () => {
    expect([...INVENTORY_KINDS]).toEqual(["figure", "game", "portal", "bundle", "other"]);
    /* Dieselbe Menge, die die Migration erlaubt. Wächst die eine, muss die
       andere wachsen. */
    const mig = readFileSync("supabase/migrations/0135_catalog_item_type.sql", "utf8");
    for (const kind of INVENTORY_KINDS) expect(mig, kind).toContain(`'${kind}'`);
  });

  it("liest den Artikeltyp der Katalogzeile", () => {
    for (const kind of INVENTORY_KINDS) {
      expect(inventoryKind(position({ figure: figure({ itemType: kind }) })), kind).toBe(kind);
    }
  });

  it("ohne Auskunft ist es eine Figur — nie Zubehör", () => {
    /*
     * Drei Wege zu „keine Auskunft": die Spalte fehlt (Abfrage ohne
     * `item_type`), sie ist NULL (Zeile vor `0135`), oder es gibt gar keine
     * Katalogzeile (außerhalb des Sortiments). Alle drei sind der
     * Normalfall, und der Normalfall ist die Figur.
     */
    expect(inventoryKind(position({ figure: figure({ itemType: undefined }) }))).toBe("figure");
    expect(inventoryKind(position({ figure: figure({ itemType: null }) }))).toBe("figure");
    expect(inventoryKind(position({ figure: null }))).toBe("figure");
  });

  it("und ein unbekannter Wert ebenfalls", () => {
    /* Eine spätere Migration könnte einen sechsten Typ einführen. Eine
       Position darf davon nicht aus der Liste fallen. */
    expect(inventoryKind(position({ figure: figure({ itemType: "sticker" }) }))).toBe("figure");
    expect(isInventoryKind("sticker")).toBe(false);
  });

  it("Zubehör ist alles außer einer Figur", () => {
    expect(isAccessoryPosition(position())).toBe(false);
    for (const kind of ["game", "portal", "bundle", "other"]) {
      expect(isAccessoryPosition(position({ figure: figure({ itemType: kind }) })), kind)
        .toBe(true);
    }
  });
});

/* ===================================================================== */
describe("Zubehör ist keine Shopware", () => {
  it("ein Spiel und ein Portal nicht, eine Figur schon", () => {
    expect(isShopGoods(position())).toBe(true);
    expect(isShopGoods(position({ figure: figure({ itemType: "game" }) }))).toBe(false);
    expect(isShopGoods(position({ figure: figure({ itemType: "portal" }) }))).toBe(false);
  });

  it("und das ist dieselbe Grenze, die is_shop_eligible() zieht", () => {
    /*
     * `0135` hat die Shop-Eignung an den Artikeltyp gehängt. Die Oberfläche
     * spiegelt das, statt einen Schalter anzubieten, der durchgeht und
     * nichts bewirkt: `set_shop_listing()` würde ein Portal listen, aber
     * `shop_offers()` filtert es wieder heraus.
     */
    const mig = readFileSync("supabase/migrations/0135_catalog_item_type.sql", "utf8");
    expect(mig).toContain("s.item_type = 'figure'");
  });

  it("die Karte bietet deshalb Freigabe und Preis nicht an, Bestand aber doch", () => {
    const card = code(CARD);
    expect(card).toContain("const shopGoods = isShopGoods(position);");
    expect(card).toContain("const sellable = operative && shopGoods;");
    /* Freigabe und Preis an `sellable` … */
    expect(card).toMatch(/\{sellable \? \(\s*<PriceEditor/);
    expect(card).toContain("{sellable ? (");
    /* … der Bestandsschritt weiter an `operative`: ein Portal wird gebucht
       wie jede Figur, `record_inventory_movement()` fragt nur den Zustand. */
    expect(card).toMatch(/\{operative \? \(\s*<StockStepper/);
  });

  it("und sagt einmal, warum — ohne Warnton", () => {
    expect(code(CARD)).toContain("copy.accessoryNotShopHint");
    expect(de.inventory.accessoryNotShopHint).toContain("nicht öffentlich angeboten");
    expect(de.inventory.accessoryNotShopHint).toContain("Historie");
    /* Kein Fehler und keine Gefahr: das ist die Sortimentsgrenze. */
    expect(code(CARD)).not.toMatch(/accessoryNotShopHint[\s\S]{0,200}text-danger/);
  });

  it("ohne Shop-Preis-Zelle, statt einer leeren", () => {
    /* „Shop-Preis —" wäre keine Auskunft: es gibt keinen, nicht bloß keinen
       eingetragenen. */
    const card = code(CARD);
    const preis = card.slice(card.indexOf("copy.salePrice") - 400,
                             card.indexOf("copy.salePrice"));
    expect(preis).toContain("{shopGoods ? (");
    /* Und der MARKTPREIS bleibt: ein Spiel hat einen, und er ist der
       Einkaufsmaßstab. */
    expect(card).toContain("copy.marketPrice");
  });
});

/* ===================================================================== */
describe("woher die Namen kommen", () => {
  it("aus einer zweiten Abfrage, nicht aus einem Schalter an fetchCatalog", () => {
    /*
     * `fetchCatalog()` bedient den öffentlichen Katalog, die Sammlung, die
     * Detailseite und den Adminkatalog. Ein `includeAccessories`-Flag dort
     * wäre ein Weg, auf dem ein Portal in den Sammlungsfortschritt gerät —
     * und der Fortschritt ist eine Zahl, die Nutzer kennen (ADR-0128, 7).
     */
    const catalog = code(CATALOG);
    expect(catalog).toContain("export async function fetchAccessoryCatalog()");
    expect(catalog).not.toContain("includeAccessories");
    /* `fetchCatalog()` legt weiter `collectibleOnly()` über sein Ergebnis. */
    expect(catalog).toContain("const figures = collectibleOnly(");
  });

  it("und über dieselbe eine Sammelbarkeitsregel, negiert", () => {
    expect(code(CATALOG)).toContain("filter((figure) => !isCollectible(figure))");
  });

  it("aktiv, und ohne den reservierten Fixture-Bereich", () => {
    /*
     * `SKY-9000`–`9999` gehört Fixtures (ADR-0070), und die Prüffigur
     * `SKY-9998` steht in einer Spiele-Kategorie. Sie bleibt damit dort, wo
     * sie heute ist: in der Zeile „außerhalb des Sortiments".
     */
    const fn = code(CATALOG).slice(code(CATALOG).indexOf("fetchAccessoryCatalog"));
    expect(fn).toContain('.eq("is_active", true)');
    expect(fn).toContain('.lt("sky_id", "SKY-9000")');
  });

  it("der Anzeigename ist der Rohname, nicht der abgeleitete Kurzname", () => {
    /*
     * ADR-0128 Punkt 1 sieht `Portal – <Serie>` als abgeleiteten Hauptnamen
     * vor. Für eine LAGERLISTE wäre das unbrauchbar: 21 Portale auf sechs
     * Serien, vier davon hießen gleich. Der Rohname trägt die Modellnummer,
     * und die unterscheidet die Varianten.
     */
    expect(code(CATALOG)).not.toContain("Portal – ");
    expect(read(CATALOG)).toContain("display_name_override ?? name");
  });

  it("und das alles hängt an 0135, nicht an 0137 oder 0138", () => {
    /*
     * EIN NÜTZLICHER BEFUND FÜR DEN STAGING-ABLAUF. Ein Spiel ist nicht
     * sammelbar, weil sein ARTIKELTYP `game` ist — das entscheidet
     * `isCollectible()` vor dem Kategorienamen, und `item_type` steht seit
     * `0135`, das auf Staging angewendet ist.
     *
     * Die 13 Lagerzeilen auf Spielen werden also schon JETZT benannt, ohne
     * dass `0137` oder `0138` gelaufen sein muss. Was die beiden hinzufügen,
     * sind die Portale — nicht die Sichtbarkeit.
     */
    const spiel = { categoryName: "Spiele", itemType: "game" };
    expect(isCollectible(spiel)).toBe(false);
    /* Und zwar auch dann, wenn die Kategorieliste noch die alte wäre: der
       Artikeltyp allein genügt. */
    expect(isCollectible({ categoryName: "Irgendwas", itemType: "game" })).toBe(false);
    expect(isCollectible({ categoryName: "Irgendwas", itemType: "portal" })).toBe(false);
  });

  it("und keine Variantenregel, kein Charakterindex, kein Sortierdurchgang", () => {
    const fn = code(CATALOG).slice(
      code(CATALOG).indexOf("export async function fetchAccessoryCatalog"),
      code(CATALOG).indexOf("export async function fetchFigureBySlug"),
    );
    for (const schritt of ["withVariants", "withCharacterSearch", "withCharacterFamily",
                           "withCharacterElement", "sortFigures", "fetchCharacterIndex"]) {
      expect(fn, schritt).not.toContain(schritt);
    }
  });
});

/* ===================================================================== */
describe("die Übersicht zeigt sie und trennt sie", () => {
  it("eine Bestandsverwaltung, nicht zwei", () => {
    /* Dieselbe RPC, dieselbe Tabelle, dieselbe Karte. */
    expect(code(INVENTORY)).toContain('rpc("admin_shop_inventory")');
    const page = code(PAGE);
    expect((page.match(/fetchInventory\(/g) ?? []).length).toBe(1);
    expect(page).not.toContain("accessoryInventory");
  });

  it("der Filter nach Art erscheint erst mit der zweiten Art", () => {
    /* Ein Auswahlfeld mit einer Auswahl ist keine Auswahl. */
    expect(code(VIEW)).toContain("kinds.length > 1 ? (");
    expect(code(VIEW)).toContain("kindsInStock(positions)");
  });

  it("die Zubehörzeile steht neben den fünf Kennzahlen, nicht in ihnen", () => {
    /* Keine sechste Zelle: die fünf sind gleich gewichtet und gleich breit,
       und eine sechste mit anderer Bedeutung würde das kaputtmachen. */
    expect(code(PANEL)).toContain("overview.accessoryPositions > 0");
    expect(code(PANEL)).toContain("copy.accessories(");
    expect(de.inventory.overview.accessories(2, 3))
      .toContain("in den Zahlen oben nicht enthalten");
  });

  it("und sie wird aus dem ungefilterten Bestand gezählt", () => {
    /* Wie die Kennzahlen: der Satz beschreibt das Lager, nicht die gerade
       sichtbare Auswahl. */
    expect(code(VIEW)).toContain("inventoryOverview(positions)");
    expect(code(VIEW)).not.toContain("inventoryOverview(visible)");
  });

  it("die Suche heißt nicht mehr „Figur suchen“", () => {
    expect(de.inventory.searchLabel).toBe("Artikel oder SKY-ID suchen");
  });

  it("jede Art hat ein Wort, in Mehrzahl für den Filter und Einzahl für die Karte", () => {
    for (const kind of INVENTORY_KINDS) {
      expect(typeof de.inventory.kinds[kind], kind).toBe("string");
    }
    expect(de.inventory.kinds.portal).toBe("Portale");
    expect(de.inventory.itemTypes.portal).toBe("Portal");
    /* Und die Einzahl ist dieselbe Quelle wie im Einkaufsbuch — ein Wort,
       zwei Fundstellen, keine zweite Wahrheit. */
    expect(de.inventory.itemTypes).toBe(de.business.orderbook.figures.itemTypes);
  });
});

/* ===================================================================== */
describe("ein Zubehörteil kommt auch ohne Einkauf ins Lager", () => {
  it("die Suche, die Positionen anlegt, kennt Figuren und Zubehör", () => {
    /* Ein Portal, das nicht über das Einkaufsbuch kam, braucht denselben
       Weg: suchen, Position anlegen, buchen. */
    expect(code(VIEW)).toContain("return [...catalog, ...accessories]");
  });

  it("und immer nur die operative Position (0108)", () => {
    /* Die Regel von 0108 bleibt unberührt: `lose`, und nichts sonst. */
    expect(code(VIEW)).toContain("OPERATIVE_CONDITION");
    expect(code(VIEW)).not.toContain("CONDITIONS.filter");
  });
});
