/**
 * KATALOG, LAGER, SAMMLUNG — DREI MENGEN, DREI REGELN (ADR-0128).
 *
 * Das Ziel dieser Arbeit in einem Satz:
 *
 *   Katalog   = alle relevanten Artikel, soweit freigegeben
 *   Lager     = alle tatsächlich vorhandenen Bestände
 *   Sammlung  = ausschliesslich sammelbare Figuren
 *
 * Diese Datei prüft die Regeln, die das tragen, und vor allem die VIER
 * EIGENSCHAFTEN, die nicht dasselbe sind: Artikeltyp, Sammelbarkeit,
 * Sichtbarkeit, Shopfähigkeit. Jede Verwechslung davon wäre ein Fehler, den
 * man erst in der Oberfläche sieht.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  ACCESSORY_TYPES, ITEM_TYPES, isAccessory, isItemType, itemTypeOf, itemTypesPresent,
} from "./item-type.ts";
import {
  accessorySeriesPresent, matchesAccessoryFilters, visibleAccessories,
  NO_ACCESSORY_FILTERS, type AccessoryFilters,
} from "./accessory-filter.ts";
import { isCollectible } from "./collectible.ts";
import type { CatalogFigure } from "@/lib/catalog/types";
import { buildSearchIndex } from "@/lib/catalog/search";
import { de } from "@/lib/i18n/de";
import { code as codeOf, latestFunction } from "@/test-support/migrations";

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const QUERIES = "src/lib/catalog/queries.ts";
const COLLECTION = "src/lib/collection/queries.ts";
const VIEW = "src/components/catalog/accessory-view.tsx";
const CARD = "src/components/catalog/accessory-card.tsx";
const PAGE = "src/app/(public)/zubehoer/page.tsx";
const CATALOG_VIEW = "src/components/catalog/catalog-view.tsx";

function artikel(over: Partial<CatalogFigure> = {}): CatalogFigure {
  const name = over.displayName ?? over.name ?? "Bash";
  return {
    skyId: "SKY-0001", name, slug: "x", seriesCode: "SA", seriesLabel: "Spyro's Adventure",
    seriesPosition: 0, categoryPosition: 0, categoryName: "Figuren", categoryId: 1,
    catalogGroup: "figure", cardType: "standard", catalogVisible: true, canonicalName: name,
    displayNameOverride: null, marketPrice: 10, imageFile: null, imageOverridePath: null,
    displayName: name, sortBaseName: name, sortVariantLabel: null,
    searchIndex: buildSearchIndex([name]), isActive: true, element: null,
    characterId: null,
    baseSkyId: null, itemType: "figure", ...over,
  };
}

/* Die echten Formen von Staging, 2026-10-20. */
const SPIEL = artikel({
  skyId: "SKY-0110", displayName: "Skylanders Giants – PS3",
  name: "Spiel für Sony Playstation 3 PS3", seriesCode: "G", seriesLabel: "Giants",
  categoryName: "Spiele", itemType: "game", catalogVisible: true, marketPrice: 25,
  searchIndex: buildSearchIndex(["Skylanders Giants – PS3", "Spiel für Sony Playstation 3 PS3"]),
});
const PORTAL = artikel({
  skyId: "SKY-0632", displayName: "84709790 (SF)", name: "84709790 (SF)",
  seriesCode: "SF", seriesLabel: "Swap Force", categoryName: "Portale",
  itemType: "portal", catalogVisible: false, marketPrice: null,
  searchIndex: buildSearchIndex(["84709790 (SF)"]),
});
const FIGUR = artikel({ skyId: "SKY-0012", displayName: "Spyro" });

/* ===================================================================== */
describe("die vier Eigenschaften sind vier Eigenschaften", () => {
  it("ein Spiel ist SICHTBAR und trotzdem nicht sammelbar", () => {
    expect(SPIEL.catalogVisible).toBe(true);
    expect(isCollectible(SPIEL)).toBe(false);
  });

  it("ein Portal ist weder sichtbar noch sammelbar — aber es EXISTIERT", () => {
    expect(PORTAL.catalogVisible).toBe(false);
    expect(isCollectible(PORTAL)).toBe(false);
    expect(itemTypeOf(PORTAL)).toBe("portal");
  });

  it("eine Figur bleibt sammelbar, auch wenn sie ausgeblendet ist", () => {
    /* Sichtbarkeit ist redaktionell, Sammelbarkeit fachlich. Eine
       ausgeblendete Figur gehört weiter in eine Sammlung. */
    const versteckt = artikel({ catalogVisible: false });
    expect(isCollectible(versteckt)).toBe(true);
  });

  it("und Sammelbarkeit folgt dem Artikeltyp, nicht der Kategorie allein", () => {
    /* Beide Riegel, getrennt geprüft: eine falsch benannte Kategorie darf
       ein Portal nicht sammelbar machen. */
    expect(isCollectible({ categoryName: "Figuren", itemType: "portal" })).toBe(false);
    expect(isCollectible({ categoryName: "Portale", itemType: "figure" })).toBe(false);
  });
});

/* ===================================================================== */
describe("das Vokabular hat EINEN Ort", () => {
  it("fünf Werte, dieselben wie der CHECK aus 0135", () => {
    expect([...ITEM_TYPES]).toEqual(["figure", "game", "portal", "bundle", "other"]);
    const mig = read("supabase/migrations/0135_catalog_item_type.sql");
    for (const t of ITEM_TYPES) expect(mig, t).toContain(`'${t}'`);
  });

  it("Zubehör ist alles ausser figure", () => {
    expect([...ACCESSORY_TYPES]).toEqual(["game", "portal", "bundle", "other"]);
    expect(isAccessory(SPIEL)).toBe(true);
    expect(isAccessory(PORTAL)).toBe(true);
    expect(isAccessory(FIGUR)).toBe(false);
  });

  it("und die Lageransicht benutzt dasselbe Vokabular, keine Kopie", () => {
    /* Zwei Fassungen derselben fünf Werte liefen beim sechsten Artikeltyp
       auseinander. */
    expect(code("src/lib/admin/inventory-model.ts"))
      .toContain('from "@/lib/catalog/item-type"');
    expect(code("src/lib/admin/inventory-model.ts"))
      .toContain("export const INVENTORY_KINDS = ITEM_TYPES;");
  });

  it("ohne Auskunft ist es eine Figur — nie Zubehör", () => {
    expect(itemTypeOf({})).toBe("figure");
    expect(itemTypeOf({ itemType: null })).toBe("figure");
    expect(itemTypeOf({ itemType: "sticker" })).toBe("figure");
    expect(isItemType("sticker")).toBe(false);
  });

  it("und angeboten wird nur, was vorkommt", () => {
    expect(itemTypesPresent([FIGUR, SPIEL, PORTAL])).toEqual(["figure", "game", "portal"]);
    expect(itemTypesPresent([SPIEL])).toEqual(["game"]);
    expect(itemTypesPresent([])).toEqual([]);
  });
});

/* ===================================================================== */
describe("der Zubehörbereich zeigt nur, was freigegeben ist", () => {
  it("die Freigabe entscheidet die ABFRAGE, nicht ein Filter im Browser", () => {
    /*
     * Ein Filter, der Sichtbarkeit herstellt, ist ein Filter, den man
     * abschalten kann. Deshalb steht `catalog_visible` in der Abfrage —
     * und dort als dasselbe `includeHidden` wie bei `fetchCatalog()`.
     */
    const q = code(QUERIES);
    expect(q).toContain('if (!options.includeHidden) rows = rows.eq("catalog_visible", true);');
    /* Und der Filter im Browser kennt `catalogVisible` gar nicht. */
    expect(code("src/lib/catalog/accessory-filter.ts")).not.toContain("catalogVisible");
  });

  it("die öffentliche Seite fragt ohne includeHidden, der Admin mit", () => {
    const page = code(PAGE);
    expect(page).toContain("fetchAccessoryCatalog({ includeHidden: admin })");
    expect(page).toContain("const admin = await isAdmin();");
  });

  it("sie fragt KEINE Sammlung — und das ist der bindende Teil", () => {
    /*
     * Für Zubehör lautet die Antwort auf „besitzt du das?" nicht nein,
     * sondern: die Frage gibt es nicht (ADR-0128). Ein Besitzsiegel wäre
     * ein Versprechen, das `isCollectible()` ablehnt, und ein Sammelknopf
     * eine Falle — er sähe aus, als täte er etwas.
     */
    expect(code(PAGE)).not.toContain("fetchOwnedSkyIds");
    for (const datei of [VIEW, CARD]) {
      const quelle = code(datei);
      for (const bauteil of ["fetchOwnedSkyIds", "setCollected", "owned", "CollectChip"]) {
        expect(quelle, `${datei} / ${bauteil}`).not.toContain(bauteil);
      }
    }
  });

  it("das Angebot DAGEGEN wird gefragt — aus derselben Projektion wie der Shop", () => {
    /*
     * Es ist heute leer, jedes Mal: `shop_offers()` ruft
     * `is_shop_eligible()`, und das verlangt `item_type = 'figure'`
     * (`0135`). Gefragt wird trotzdem, und zwar `fetchOffers()` — DIE
     * Projektion, die auch Shop und Figurenkatalog lesen. Eine zweite
     * Angebotsverwaltung für Zubehör gibt es nicht und soll es nicht
     * geben; fällt die Produktentscheidung, füllt sich dieselbe Stelle.
     */
    const page = code(PAGE);
    expect(page).toContain("fetchOffers()");
    expect(page).toContain("offerRecord(offers)");
    expect(page).not.toContain("shop_offers");        // keine eigene Abfrage
    /* Und die Kachel sagt das Fehlen, statt eine Lücke zu lassen. */
    expect(de.accessories.noOffer).toBe("Aktuell kein Angebot");
    expect(code(CARD)).toContain("copy.noOffer");
  });

  it("aber kein Weg vom Zubehör in den Warenkorb", () => {
    /* Sichtbar heisst nicht käuflich. Solange `is_shop_eligible()` Zubehör
       ablehnt, darf keine Kachel einen Kaufknopf tragen. */
    for (const datei of [VIEW, CARD]) {
      for (const bauteil of ["addToCart", "AddToCart", "/warenkorb", "CartButton"]) {
        expect(code(datei), `${datei} / ${bauteil}`).not.toContain(bauteil);
      }
    }
  });

  it("und benutzt die Figurenkarte NICHT", () => {
    /* Die Kartenoptik der Figuren bleibt unangetastet (ADR-0038): Element,
       Charakter, Variante, Besitz und Preis hat ein Portal nicht. */
    const view = code(VIEW);
    for (const bauteil of ["FigureCard", "CatalogCard", "figure-card", "CollectChip"]) {
      expect(view, bauteil).not.toContain(bauteil);
    }
  });

  it("der Weg dorthin steht im Katalog, nicht in der Hauptnavigation", () => {
    /*
     * Die hat drei Ziele und soll sie behalten (ADR-0036). Seit der
     * Tab-Leiste steht der Weg nicht mehr als einzelner Link im Kopf,
     * sondern als oberste Navigationsebene — seit UX-01F als
     * `CatalogSectionSwitch` mit drei Bereichen, und die Adresse steht
     * weiterhin in der Bereichsdefinition, nicht in der Leiste.
     */
    expect(code(CATALOG_VIEW)).toContain("<CatalogSectionSwitch");
    expect(code(CATALOG_VIEW)).toContain('area="figures"');
    expect(code("src/lib/catalog/catalog-section.ts")).toContain('href: "/zubehoer"');
    expect(code("src/components/layout/site-nav.tsx")).not.toContain("/zubehoer");
  });
});

/* =====================================================================
 * EIN FREIGEGEBENES PORTAL (geprüft, bevor eines freigegeben wird)
 *
 * `admin_set_catalog_visible(sky_id, true)` ist eine schlichte Zuweisung
 * ohne Figurenbeschränkung — sie wirkt auf ein Portal wie auf eine Figur.
 * Die Frage ist deshalb nicht, OB die Funktion reicht, sondern was danach
 * passiert. Hier steht die Antwort, und zwar an einem Portal, das die
 * Freigabe schon trägt.
 * ================================================================== */
describe("ein freigegebenes Portal", () => {
  const FREI = artikel({
    skyId: "SKY-0632", displayName: "84709790 (SF)", name: "84709790 (SF)",
    seriesCode: "SF", seriesLabel: "Swap Force", categoryName: "Portale",
    itemType: "portal", marketPrice: null,
    /* DER EINE UNTERSCHIED zum Portal von heute. */
    catalogVisible: true,
  });

  it("erscheint im Zubehörbereich", () => {
    /* Die Abfrage liefert es — `is_active AND catalog_visible` —, und der
       Filter lässt es durch. */
    expect(FREI.catalogVisible).toBe(true);
    expect(visibleAccessories([FREI], NO_ACCESSORY_FILTERS).map((i) => i.skyId))
      .toEqual(["SKY-0632"]);
  });

  it("und wird dadurch NICHT sammelbar", () => {
    /*
     * Die verbindliche Zusicherung. `isCollectible()` fragt den Artikeltyp
     * und den Kategorienamen — `catalog_visible` kommt darin gar nicht vor.
     */
    expect(isCollectible(FREI)).toBe(false);
    expect(code("src/lib/catalog/collectible.ts")).not.toContain("catalogVisible");
  });

  it("und kommt nicht in den Figurenkatalog, aus dem der Fortschritt rechnet", () => {
    /* `fetchCatalog()` legt `collectibleOnly()` über jedes Ergebnis — der
       Nenner der 534 bleibt davon unberührt, freigegeben oder nicht. */
    expect(code(QUERIES)).toContain("const figures = collectibleOnly(");
  });

  it("und wird NICHT allein dadurch verkäuflich", () => {
    /*
     * SICHTBAR UND VERKÄUFLICH SIND ZWEI ENTSCHEIDUNGEN, und das gilt vor
     * wie nach `0139`. Was sich geändert hat, ist die Stelle:
     *
     *   bis 0139   `is_shop_eligible()` lehnte jedes Zubehörteil am
     *              ARTIKELTYP ab — verkäuflich war es nie.
     *   ab  0139   verkäuflich ist es erst mit einer ausdrücklichen
     *              Freigabe AN DER LAGERPOSITION (`sale_released`,
     *              Vorgabe `false`). Die Katalogsichtbarkeit ist dafür
     *              notwendig, nie hinreichend.
     *
     * Beide Male gilt dieselbe Zusicherung: eine Freigabe im Katalog
     * bewirkt keine im Shop.
     */
    expect(codeOf(latestFunction("is_shop_eligible").body)).toContain("s.item_type = 'figure'");

    const tor = codeOf(latestFunction("is_position_sellable").body);
    /* Der Zubehörzweig verlangt die Sichtbarkeit UND die Freigabe. */
    expect(tor).toContain("s.catalog_visible");
    expect(tor).toContain("and i.sale_released");
    expect(tor).not.toContain("or i.sale_released");

    /* Und `shop_offers()` FRAGT das Tor, statt die Bedingung zu
       wiederholen: eine Regel, ein Ort, vier Türen. */
    expect(codeOf(latestFunction("shop_offers").body))
      .toContain("public.is_position_sellable(i.id)");
  });

  it("und bekommt keine Detailseite", () => {
    /*
     * `/skylanders/[slug]` verlangt `isCollectible(figure)` UND
     * `catalogVisible`. Die Freigabe erfüllt das zweite, das erste bleibt
     * nein — die Seite antwortet weiter mit 404. Deshalb sind die Zeilen im
     * Zubehörbereich auch keine Verweise.
     */
    const detail = code("src/app/(public)/skylanders/[slug]/page.tsx");
    expect(detail).toContain("!isCollectible(figure)");
    expect(code(VIEW)).not.toContain("/skylanders/");
  });

  it("die Freigabefunktion selbst kennt keine Figurenbeschränkung", () => {
    /* Eine Zuweisung auf einer Zeile, mehr nicht — sie wirkt auf ein Portal
       wie auf eine Figur, und das ist der Grund, warum nichts Neues nötig
       ist. */
    const fn = latestFunction("admin_set_catalog_visible");
    expect(codeOf(fn.body)).toContain("update public.skylanders set catalog_visible");
    expect(codeOf(fn.body)).toContain("public.is_platform_admin()");
    expect(codeOf(fn.body)).not.toContain("item_type");
    expect(codeOf(fn.body)).not.toContain("non_collectible");
  });
});

/* ===================================================================== */
describe("die Filter des Zubehörbereichs", () => {
  const LISTE = [FIGUR, SPIEL, PORTAL];
  const mit = (o: Partial<AccessoryFilters>): AccessoryFilters =>
    ({ ...NO_ACCESSORY_FILTERS, ...o });
  const ids = (l: readonly CatalogFigure[]) => l.map((i) => i.skyId);

  it("ohne Filter steht alles da, was die Abfrage geliefert hat", () => {
    expect(ids(visibleAccessories(LISTE, NO_ACCESSORY_FILTERS)))
      .toEqual(["SKY-0012", "SKY-0110", "SKY-0632"]);
  });

  it("nach Art", () => {
    expect(ids(visibleAccessories(LISTE, mit({ type: "game" })))).toEqual(["SKY-0110"]);
    expect(ids(visibleAccessories(LISTE, mit({ type: "portal" })))).toEqual(["SKY-0632"]);
    expect(visibleAccessories(LISTE, mit({ type: "bundle" }))).toEqual([]);
  });

  it("nach Serie", () => {
    expect(ids(visibleAccessories(LISTE, mit({ seriesCode: "SF" })))).toEqual(["SKY-0632"]);
  });

  it("über den Anzeigenamen, den Rohnamen und die Modellnummer", () => {
    expect(ids(visibleAccessories(LISTE, mit({ query: "Giants" })))).toEqual(["SKY-0110"]);
    expect(ids(visibleAccessories(LISTE, mit({ query: "Playstation" })))).toEqual(["SKY-0110"]);
    expect(ids(visibleAccessories(LISTE, mit({ query: "84709790" })))).toEqual(["SKY-0632"]);
    expect(ids(visibleAccessories(LISTE, mit({ query: "SKY-0632" })))).toEqual(["SKY-0632"]);
  });

  it("und alle Bedingungen müssen zutreffen, nicht irgendeine", () => {
    expect(matchesAccessoryFilters(PORTAL, mit({ type: "portal", seriesCode: "SF" }))).toBe(true);
    expect(matchesAccessoryFilters(PORTAL, mit({ type: "portal", seriesCode: "G" }))).toBe(false);
    expect(matchesAccessoryFilters(PORTAL, mit({ type: "game", seriesCode: "SF" }))).toBe(false);
  });

  it("die Serienauswahl bietet nur Serien an, die vorkommen", () => {
    const serien = [
      { code: "SA", label: "Spyro's Adventure", position: 0 },
      { code: "G", label: "Giants", position: 1 },
      { code: "SF", label: "Swap Force", position: 2 },
      { code: "T", label: "Trap Team", position: 3 },
    ];
    expect(accessorySeriesPresent([SPIEL, PORTAL], serien).map((s) => s.code))
      .toEqual(["G", "SF"]);
  });

  it("und jede Art hat ein Wort", () => {
    for (const t of ITEM_TYPES) expect(typeof de.inventory.kinds[t], t).toBe("string");
    expect(de.accessories.intro).toContain("nicht in die Sammlung");
    expect(de.accessories.intro).toContain("Shop");
  });
});

/* ===================================================================== */
describe("die Sammlung bleibt ausschliesslich sammelbar", () => {
  it("die Grenze steht an der QUELLE der Sammlungsabfrage", () => {
    /*
     * Die verbindliche Anforderung. Was nicht in die Liste kommt, kann in
     * keiner Statistik, keinem Filter und keiner Suche wieder auftauchen.
     */
    const q = code(COLLECTION);
    expect(q).toContain("if (!isCollectible(figure)) continue;");
    expect(q).toContain('from "@/lib/catalog/collectible"');
  });

  it("und die Sammlungsansicht holt sie nicht wieder herein", () => {
    /*
     * Hier stand `owned.filter((entry) => !isCollectible(entry.figure))` —
     * absichtlich, damit ein Hinweis sie erwähnen konnte. Seit ADR-0128
     * erscheint Zubehör gar nicht, auch nicht als Hinweis.
     */
    const view = code("src/components/collection/collection-view.tsx");
    expect(view).toContain("const counted = useMemo(() => ownedEntries(rows), [rows]);");
    expect(view).not.toContain("!isCollectible");
  });

  it("der Hinweis ist weg, und die Zusicherung der Statistik ist geblieben", () => {
    const overview = code("src/components/collection/collection-overview.tsx");
    expect(overview).not.toContain("nonCollectibleOwned");
    /* Die Funktion zählt weiter — als dritte Schicht und als Aussage über
       ihre eigene Eingabe. */
    expect(code("src/lib/collection/stats.ts")).toContain("nonCollectibleOwned += 1;");
    expect(code("src/lib/collection/stats.ts")).toContain("if (!isCollectible(entry.figure))");
  });

  it("drei Schichten, und jede trägt allein", () => {
    /* Abfrage, Kartenbau, Statistik. Fällt eine aus, halten die anderen. */
    expect(code(COLLECTION)).toContain("isCollectible");
    expect(code("src/lib/collection/view.ts")).toContain("if (!isCollectible(entry.figure)) continue;");
    expect(code("src/lib/collection/stats.ts")).toContain("isCollectible");
  });

  it("der Fortschritt zählt kein Zubehör — auch nicht im Nenner", () => {
    /* Der Nenner kommt aus den sammelbaren Katalogzeilen, und `fetchCatalog`
       legt `collectibleOnly()` darüber. 534 bleiben 534. */
    expect(code(QUERIES)).toContain("const figures = collectibleOnly(");
  });

  it("und der öffentliche Katalog führt weiter kein Zubehör", () => {
    /* Der Zubehörbereich ist eine EIGENE Abfrage — `fetchCatalog()` bleibt
       die Figurenmenge, und daran hängt die Sammlung. */
    const q = code(QUERIES);
    const fetchCatalog = q.slice(q.indexOf("export async function fetchCatalog"),
                                q.indexOf("export async function fetchAccessoryCatalog"));
    expect(fetchCatalog).toContain("collectibleOnly(");
    expect(fetchCatalog).not.toContain("item_type");
  });
});
