/**
 * DIE VIER KENNZAHLEN ÜBER DER LAGERLISTE (V4.9).
 *
 * Zwei Dinge stehen hier auf dem Spiel. Erstens die Definition von „Im Shop":
 * sie muss dieselbe sein, die `shop_offers()` in der Datenbank anwendet —
 * sonst behauptet die Übersicht etwas über ein Angebot, das es so nicht gibt.
 * Zweitens die Abgrenzung zum Katalog-Aufschlag aus 0094: das Lager bewertet
 * seinen eigenen Bestand mit dem GESPEICHERTEN Marktpreis, und dieses Modul
 * darf den Aufschlag nicht einmal kennen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { inventoryOverview, isOffered } from "./inventory-overview.ts";
import type { InventoryPosition } from "@/lib/admin/inventory-model";
import type { CatalogFigure } from "@/lib/catalog/types";
import { code, latestFunction } from "@/test-support/migrations";

/**
 * Quelltext ohne Kommentare.
 *
 * Die Abgrenzungen unten pruefen, was der Code TUT — der Kopfkommentar des
 * Moduls nennt genau die Dinge, die es nicht anfasst, und ein Wortfilter ueber
 * die ganze Datei wuerde daran haengenbleiben statt an einer echten Zeile.
 */
const stripped = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const MODULE = "src/lib/admin/inventory-overview.ts";

function figure(overrides: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId: "SKY-0001", name: "Bash", slug: "bash", seriesCode: "SA", seriesLabel: "SA",
    seriesPosition: 0, categoryPosition: 0, categoryName: "Figuren", categoryId: 1,
    catalogGroup: "figure", cardType: "standard", catalogVisible: true, canonicalName: "Bash",
    displayNameOverride: null, marketPrice: 10, imageFile: null, imageOverridePath: null,
    displayName: "Bash", sortBaseName: "Bash", sortVariantLabel: null, searchIndex: "bash",
    isActive: true, element: null, characterId: null, ...overrides,
  };
}

function position(over: Partial<InventoryPosition> = {}): InventoryPosition {
  const quantity = over.quantity ?? 1;
  const reserved = over.reserved ?? 0;
  return {
    inventoryId: 1, skyId: "SKY-0001", condition: "loose",
    quantity, reserved, available: over.available ?? quantity - reserved,
    salePrice: null, effectivePrice: 9, priceSource: "automatic", isListed: true,
    note: null, updatedAt: "2026-09-23T00:00:00Z", figure: figure(),
    ...over,
  };
}

describe("what counts as offered", () => {
  it("is the same rule shop_offers() applies", () => {
    const sql = code(latestFunction("shop_offers").body);
    // Jede Klausel der Projektion hat hier ihre Entsprechung.
    expect(sql).toContain("where i.is_listed");
    expect(sql).toContain("i.condition = public.v1_sale_condition()");
    expect(sql).toContain("public.is_shop_eligible(i.sky_id)");
    expect(sql).toContain("public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null");
    expect(sql).toContain("(i.available_quantity > 0) as available");

    const source = stripped(MODULE);
    for (const clause of [
      "position.isListed",
      'position.condition === "loose"',
      "position.effectivePrice !== null",
      "position.available > 0",
      "position.figure.isActive",
      "position.figure.catalogVisible",
    ]) expect(source, clause).toContain(clause);
  });

  it.each([
    ["nicht gelistet", { isListed: false }],
    ["OVP statt lose", { condition: "boxed" as const }],
    ["kein Shop-Preis", { effectivePrice: null }],
    ["nichts frei", { quantity: 2, reserved: 2, available: 0 }],
    ["Figur inaktiv", { figure: figure({ isActive: false }) }],
    ["Figur ausgeblendet", { figure: figure({ catalogVisible: false }) }],
    ["ausserhalb des Katalogs", { figure: null }],
  ])("refuses a position that is %s", (_, over) => {
    expect(isOffered(position(over as Partial<InventoryPosition>))).toBe(false);
  });

  it("accepts a listed, priced, loose position with something free", () => {
    expect(isOffered(position())).toBe(true);
  });
});

describe("the five figures", () => {
  it("counts PIECES in the shop, not positions", () => {
    const overview = inventoryOverview([
      position({ inventoryId: 1, quantity: 5 }),
      position({ inventoryId: 2, skyId: "SKY-0002", quantity: 3 }),
    ]);
    expect(overview.offeredPieces).toBe(8);
  });

  /**
   * DIE EINE UNTERSCHEIDUNG, AN DER ALLES HÄNGT.
   *
   * Reservierte Ware liegt im Regal und gehört dem Verkäufer — sie zählt
   * also zum Bestand und zum Marktwert. Kaufbar ist sie nicht, also zählt
   * sie weder „Im Shop" noch zum Shopwert. „Reserviert" macht die Differenz
   * zwischen beiden Hälften lesbar.
   */
  it("keeps reserved stock in the shelf and out of the shop", () => {
    const overview = inventoryOverview([
      position({ quantity: 4, reserved: 1, available: 3, effectivePrice: 9 }),
    ]);
    expect(overview.stockPieces).toBe(4);        // alles, was physisch da ist
    expect(overview.reservedPieces).toBe(1);     // davon gehalten
    expect(overview.offeredPieces).toBe(3);      // kaufbar
    expect(overview.marketValue).toBe(40);       // 4 x 10,00 — auch das reservierte
    expect(overview.shopValue).toBe(27);         // 3 x 9,00 — nur die freien
    /*
     * Für DIESE eine Position geht die Rechnung auf, weil sie gelistet,
     * bepreist und shopfähig ist. Das ist ein Merkmal des Testfalls, KEINE
     * allgemeine Regel — siehe den Fall darunter.
     */
    expect(overview.stockPieces - overview.reservedPieces).toBe(overview.offeredPieces);
  });

  it("shows a zero rather than nothing when nothing is reserved", () => {
    expect(inventoryOverview([position({ quantity: 2 })]).reservedPieces).toBe(0);
    const panel = readFileSync("src/components/admin/inventory-overview.tsx", "utf8");
    // Kein `> 0`-Vorbehalt um die Kennzahl: sie steht immer da.
    expect(panel).toContain("label={copy.reserved}");
    expect(panel).not.toMatch(/reservedPieces > 0 \?/);
  });

  it("values stock at the STORED market price, never the boosted one", () => {
    // 10,00 EUR x 3 = 30,00 — und nicht 31,50, was der Katalog bei 5 % zeigt.
    expect(inventoryOverview([position({ quantity: 3 })]).marketValue).toBe(30);
    const source = stripped(MODULE);
    expect(source).not.toContain("market-boost");
    expect(source).not.toContain("catalogDisplayMarketPrice");
    expect(source).not.toContain("boost");
  });

  it("values the shop at the offered pieces and their shop price", () => {
    const overview = inventoryOverview([
      position({ quantity: 4, reserved: 1, available: 3, effectivePrice: 9 }),
      // Nicht gelistet: zählt im Lager und im Marktwert, nicht im Shopwert.
      position({ inventoryId: 2, skyId: "SKY-0002", quantity: 2, isListed: false }),
    ]);
    expect(overview.offeredPieces).toBe(3);
    expect(overview.shopValue).toBe(27);
    expect(overview.stockPieces).toBe(6);        // 4 + 2, alles physisch da
    expect(overview.reservedPieces).toBe(1);
    expect(overview.marketValue).toBe(60);
    /*
     * UND HIER GEHT SIE NICHT AUF — absichtlich festgehalten.
     *
     * „Bestand − reserviert = im Shop" ist keine Invariante: vorhandene Ware
     * kann ungelistet, ohne Preis, OVP oder katalogunsichtbar sein und fehlt
     * dann in „Im Shop", ohne reserviert zu sein. 6 − 1 ist 5, kaufbar sind 3.
     */
    expect(overview.stockPieces - overview.reservedPieces).not.toBe(overview.offeredPieces);
  });

  it("leaves a figure without a market price out, and says so", () => {
    const overview = inventoryOverview([
      position({ quantity: 2, figure: figure({ marketPrice: null }) }),
      position({ inventoryId: 2, skyId: "SKY-0002", quantity: 1 }),
    ]);
    // Niemals 0 EUR fuer einen unbekannten Preis (ADR-0010).
    expect(overview.marketValue).toBe(10);
    expect(overview.withoutMarketPrice).toBe(1);
    // Der Bestand selbst zaehlt trotzdem.
    expect(overview.stockPieces).toBe(3);
  });

  it("the order on screen is shelf, held, buyable, then the two amounts", () => {
    const panel = readFileSync("src/components/admin/inventory-overview.tsx", "utf8");
    const at = (key: string) => panel.indexOf(`label={copy.${key}}`);
    const order = ["stock", "reserved", "offered", "marketValue", "shopValue"].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Fuenf nebeneinander ab `sm:`, zwei Spalten auf dem Telefon.
    expect(panel).toContain("grid-cols-2");
    expect(panel).toContain("sm:grid-cols-5");
    // Die fuenfte Zelle fuellt die Telefonzeile, statt neben einem Loch zu stehen.
    expect(panel).toContain("col-span-2 sm:col-span-1");
  });

  it("sums money in cents, so a long shelf does not drift", () => {
    const rows = Array.from({ length: 300 }, (_, i) =>
      position({ inventoryId: i + 1, skyId: `SKY-${String(i).padStart(4, "0")}`,
                 quantity: 1, effectivePrice: 0.1, figure: figure({ marketPrice: 0.1 }) }));
    expect(inventoryOverview(rows).marketValue).toBe(30);
    expect(inventoryOverview(rows).shopValue).toBe(30);
  });

  it("an empty shelf is five zeroes, not a crash", () => {
    expect(inventoryOverview([])).toEqual({
      stockPieces: 0, reservedPieces: 0, offeredPieces: 0,
      marketValue: 0, shopValue: 0, withoutMarketPrice: 0,
    });
  });
});

describe("where the numbers come from", () => {
  const VIEW = readFileSync("src/components/admin/inventory-view.tsx", "utf8");
  const PAGE = readFileSync("src/app/(business)/business/inventory/page.tsx", "utf8");

  it("is one pass over rows the page already has", () => {
    expect(VIEW).toContain("inventoryOverview(positions)");
    // Keine zweite Abfrage und kein neuer Aufruf auf der Seite.
    expect(PAGE).not.toContain("inventoryOverview");
    expect(PAGE).not.toContain("overview");
    const source = stripped(MODULE);
    expect(source).not.toContain("createClient");
    expect(source).not.toContain("supabase");
  });

  it("describes the shelf, not the current filter", () => {
    // `positions`, nicht `visible`: eine Kennzahl, die sich beim Tippen
    // aendert, ist keine.
    expect(VIEW).toContain("useMemo(() => inventoryOverview(positions), [positions])");
    expect(VIEW).not.toContain("inventoryOverview(visible)");
  });

  it("sits above the search", () => {
    expect(VIEW.indexOf("<InventoryOverviewPanel"))
      .toBeLessThan(VIEW.indexOf('htmlFor="inventory-search"'));
  });

  it("never reads a historical or reconstructed figure", () => {
    const source = stripped(MODULE);
    for (const forbidden of ["inventory_movements", "legacy_stock_events",
                             "legacyTotals", "tradeTotals", "806", "824"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
