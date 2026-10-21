/**
 * DIE VERKAUFSOBERFLÄCHE FÜR ZUBEHÖR (Phase C, ADR-0129/0130).
 *
 * Vier Flächen, und jede muss dasselbe tun wie bei Figuren — mit genau den
 * Unterschieden, die ein Portal von einer Figur trennt:
 *
 *   Lager          Preis, Lieferumfang, USK, Freigabe, und der GRUND
 *   Kachel         Preis und Lieferumfang, ein Weg zur Detailseite
 *   Detailseite    die Produktangaben und `OfferPanel` — dieselbe Komponente
 *   Shop           dasselbe Raster, dieselbe Projektion, die eigene Kachel
 *
 * UND KEINE SAMMLUNG, nirgends.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";

const read = (p: string) => readFileSync(p, "utf8");
/** Quelltext ohne Kommentare — was er TUT, nicht was er sagt. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(?:\/\/|\*).*$/gm, "");

const DETAIL = "src/app/(public)/zubehoer/[slug]/page.tsx";
const KACHEL = "src/components/catalog/accessory-card.tsx";
const SHOP_PAGE = "src/app/(public)/shop/page.tsx";
const SHOP_VIEW = "src/components/shop/shop-view.tsx";
const FIGUR_DETAIL = "src/app/(public)/skylanders/[slug]/page.tsx";
const QUERIES = "src/lib/catalog/queries.ts";

/* ===================================================================== */
describe("1. die Detailseite eines Zubehörartikels", () => {
  const seite = code(DETAIL);

  it("404 ohne Sichtbarkeit — dieselbe Regel wie bei der Figurenseite", () => {
    expect(seite).toContain("if (!item || !item.isActive || !item.catalogVisible) notFound();");
    /* Und die Figurenseite bleibt figurenonly: zwei Adressräume. */
    expect(code(FIGUR_DETAIL)).toContain("!isCollectible(figure)");
  });

  it("und eine FIGUR hat hier keine Adresse", () => {
    /* `fetchAccessoryBySlug()` gibt sie nicht heraus — sonst gäbe es eine
       Figur an zwei Adressen, einmal mit und einmal ohne Sammeln. */
    const q = code(QUERIES);
    expect(q).toContain("return isCollectible(figure) ? null : figure;");
  });

  it("nutzt dieselbe Angebotskomponente wie die Figurenseite", () => {
    expect(seite).toContain("<OfferPanel");
    expect(seite).toContain('from "@/components/shop/offer-panel"');
    /* Keine zweite Kaufarchitektur: der Warenkorb ist derselbe. */
    expect(seite).not.toContain("useAddToCart");
    expect(seite).not.toContain("cart_items");
  });

  it("zeigt die Produktangaben, die ein Gebrauchtkauf braucht", () => {
    for (const angabe of ["copy.detailType", "copy.detailSeries",
      "de.inventory.condition", "de.shop.conditionStandard",
      "de.shop.deliveryScopeLabel", "item.skyId"]) {
      expect(seite, angabe).toContain(angabe);
    }
  });

  it("die USK nur bei Spielen — und nie geraten", () => {
    expect(seite).toContain('itemTypeOf(item) === "game" ? fetchUskRating(item.skyId)');
    expect(seite).toContain("de.inventory.uskValue(usk)");
    expect(seite).toContain("de.inventory.uskNone");
    /* Und die Abfrage nimmt `usk_rating` NICHT in die Katalogspalten:
       auf Production gibt es die Spalte noch nicht, und eine Spaltenliste
       mit ihr legte dort den ganzen Katalog lahm. */
    const q = read(QUERIES);
    const spalten = q.slice(q.indexOf("const FIGURE_COLUMNS"), q.indexOf("const FIGURE_COLUMNS") + 400);
    expect(spalten).not.toContain("usk_rating");
    expect(code(QUERIES)).toContain("const COLUMN_MISSING = \"42703\";");
  });

  it("der Lieferumfang kommt aus dem ANGEBOT, nicht aus dem Artikel", () => {
    /* Zwei Exemplare desselben Spiels können verschieden vollständig
       sein — die Angabe gehört zur Lagerposition (`0139`). */
    expect(seite).toContain("eigene[0]?.deliveryScope");
  });

  it("und keine Sammlung: kein Knopf, kein Siegel, kein Fortschritt", () => {
    for (const verboten of ["CollectButton", "fetchOwnedSkyIds", "owned",
      "collectionStats", "Besitz"]) {
      expect(seite, verboten).not.toContain(verboten);
    }
  });
});

/* ===================================================================== */
describe("2. die Kachel führt zur Detailseite, nicht in den Warenkorb", () => {
  const kachel = code(KACHEL);

  it("die ganze Kachel ist ein Weg", () => {
    expect(kachel).toContain("<Link");
    expect(kachel).toContain("href={`/zubehoer/${item.slug}`}");
    expect(kachel).toContain("copy.openOffers(item.displayName)");
  });

  it("und trägt keinen Kaufknopf", () => {
    for (const verboten of ["AddToCartButton", "useAddToCart", "addToCart",
      "/warenkorb", "/cart"]) {
      expect(kachel, verboten).not.toContain(verboten);
    }
  });

  it("sie zeigt Preis UND Lieferumfang, sobald es ein Angebot gibt", () => {
    expect(kachel).toContain("formatPrice(guenstigstes.price)");
    expect(kachel).toContain("deliveryScopeLabel(guenstigstes?.deliveryScope ?? null)");
    /* Und ohne Angebot den ruhigen Satz. */
    expect(kachel).toContain("copy.noOffer");
    expect(de.accessories.noOffer).toBe("Aktuell kein Angebot");
  });

  it("weiterhin ohne Sammelknopf und ohne Besitzsiegel", () => {
    for (const verboten of ["CollectChip", "setCollected", "owned"]) {
      expect(kachel, verboten).not.toContain(verboten);
    }
  });
});

/* ===================================================================== */
describe("3. der Shop zeigt Zubehör — in demselben Raster", () => {
  const seite = code(SHOP_PAGE);
  const ansicht = code(SHOP_VIEW);

  it("eine Seite, eine Projektion, beide Kataloge", () => {
    expect(seite).toContain("fetchAccessoryCatalog()");
    expect(seite).toContain("shopEntries([...figuren, ...zubehoer], offers)");
    /* Keine zweite Angebotsabfrage. */
    expect(seite.match(/fetchOffers\(\)/g)).toHaveLength(1);
  });

  it("aber nicht in der Figurenkarte", () => {
    expect(ansicht).toContain("isAccessory(entry.figure) ? (");
    expect(ansicht).toContain("<AccessoryCard");
    /* `CatalogCard` bleibt, wie sie ist — die Entscheidung fällt davor. */
    expect(ansicht).toContain("<CatalogCard");
  });

  it("und die Regel, was ins Schaufenster darf, steht an EINER Stelle", () => {
    const surface = code("src/lib/shop/surface.ts");
    expect(surface).toContain("if (!isCollectible(figure) && !isAccessory(figure)) continue;");
    expect(surface).toContain("if (!figure.catalogVisible) continue;");
    /* Die Verkäuflichkeit entscheidet die Datenbank, nicht diese Datei. */
    expect(surface).not.toContain("sale_released");
    expect(surface).not.toContain("saleReleased");
  });
});

/* ===================================================================== */
describe("4. was die Oberfläche NICHT selbst entscheidet", () => {
  it("die Verkaufsregeln werden nicht im Browser nachgebaut", () => {
    /*
     * Jede Bedingung aus `is_position_sellable()` steht in der Datenbank.
     * Die Oberfläche fragt `seller_sale_state()` und übersetzt den Grund —
     * zwei Herleitungen derselben Regel liefen auseinander.
     */
    for (const datei of [DETAIL, KACHEL, SHOP_VIEW,
      "src/components/admin/inventory-card.tsx"]) {
      const quelle = code(datei);
      for (const regel of ["usk_rating", "sale_released", "is_position_sellable"]) {
        expect(quelle, `${datei} / ${regel}`).not.toContain(regel);
      }
    }
  });

  it("und die Sammlung bleibt figurenonly", () => {
    /* Keine der vier Flächen fasst Sammlungscode an. */
    for (const datei of [DETAIL, KACHEL, SHOP_VIEW]) {
      expect(code(datei), datei).not.toContain("collection");
    }
  });
});
