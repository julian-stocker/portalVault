import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";

/**
 * Was am Preis stehen muss, bevor jemand kauft (P1-3, P1-4 aus dem
 * Abschlussaudit vom 2026-09-25).
 *
 * ZWEI FLÄCHEN, EINE AUSSAGE. In den Warenkorb legen kann man auf der
 * Figurenseite und in der Schnellansicht des Katalogs. Beide zeigten einen
 * Preis und einen Kaufknopf, aber weder den Zustand der Ware noch den
 * Hinweis, dass Versand hinzukommt. Diese Datei hält fest, dass beide es
 * jetzt tun, aus derselben Übersetzung und derselben Komponente.
 *
 * UND KEINE ZWEITE ZAHL. Die Versandfreigrenze ist eine Einstellung des
 * Verkäufers. Sie stand als „75 €" im Shop-Intro und wäre still falsch
 * geworden, sobald er sie ändert. Der schärfste Test hier ist deshalb der
 * letzte: kein Geldbetrag als Literal in irgendeiner dieser Dateien.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const PANEL = "src/components/shop/offer-panel.tsx";
const QUICK = "src/components/catalog/quick-view.tsx";
const NOTE = "src/components/shop/shipping-note.tsx";
const QUERIES = "src/lib/commerce/shipping-queries.ts";
const FIGURE_PAGE = "src/app/(public)/skylanders/[slug]/page.tsx";
const CATALOG_PAGE = "src/app/(public)/(catalog)/page.tsx";
const SHOP_PAGE = "src/app/(public)/shop/page.tsx";

/** Jede Fläche, von der aus gekauft werden kann. */
const BUY_SURFACES = [
  ["Figurenseite", PANEL],
  ["Schnellansicht", QUICK],
] as const;

describe("der Zustand steht an jedem kaufbaren Angebot", () => {
  it("beide Kaufflächen benennen ihn", () => {
    for (const [name, path] of BUY_SURFACES) {
      expect(code(path), name).toContain("conditionLabel(offer.condition)");
    }
  });

  it("ohne Bedingung — auch wenn V1 nur eine Kondition verkauft", () => {
    /*
     * Die alte Regel im Angebotsblock war `buyable.length > 1`, und weil V1
     * ausschließlich `loose` verkauft, hieß das: nie. Genau diese Verknüpfung
     * darf nicht zurückkommen.
     */
    const panel = code(PANEL);
    expect(panel).not.toContain("buyable.length > 1");
    expect(panel).not.toMatch(/length > 1 \?[\s\S]{0,80}conditionLabel/);
  });

  it("aus der einen vorhandenen Übersetzung, nicht aus einer zweiten", () => {
    for (const [name, path] of BUY_SURFACES) {
      expect(code(path), name).toContain('from "@/lib/shop/condition"');
      for (const literal of ['"Lose"', '"OVP"', "'Lose'", "'OVP'"]) {
        expect(code(path), `${name}: ${literal}`).not.toContain(literal);
      }
    }
    expect(de.shop.conditionLoose).toBe("Lose");
    expect(de.shop.conditionBoxed).toBe("OVP");
  });

  it("kostet keine eigene Zeile", () => {
    // Figurenseite: in der Preiszeile des Panels, als kleiner Zusatz dahinter
    // — nicht im Kaufknopf darüber, der den Preis nur vorliest.
    const panel = code(PANEL);
    const inPanel = panel.slice(panel.indexOf("export function OfferPanel"));
    const priceLine = inPanel.slice(inPanel.indexOf("formatPrice(offer.price)"));
    expect(priceLine.slice(0, 200)).toContain("conditionLabel(offer.condition)");
    // Schnellansicht: auf der Zeile, die es ohnehin schon gab.
    expect(code(QUICK)).toContain("de.quickView.sellerKind");
  });
});

describe("der Versandhinweis steht beim Preis", () => {
  it("beide Kaufflächen zeigen ihn, aus derselben Komponente", () => {
    for (const [name, path] of BUY_SURFACES) {
      expect(code(path), name).toContain("<ShippingNote");
      expect(code(path), name).toContain('from "@/components/shop/shipping-note"');
    }
  });

  it("verlinkt auf /versand statt eine Zahl zu behaupten", () => {
    const note = code(NOTE);
    expect(note).toContain('href="/versand"');
    expect(note).toContain("de.shop.shippingLink");
  });

  it("nennt die Freigrenze, wenn sie da ist, und schweigt darüber, wenn nicht", () => {
    const note = code(NOTE);
    expect(note).toContain("freeFrom === null ? de.shop.shippingNoteBare : de.shop.shippingNote(");
    expect(de.shop.shippingNoteBare).not.toMatch(/\d/);
    expect(de.shop.shippingNote("€ 75,00")).toContain("€ 75,00");
    expect(de.shop.shippingNote("€ 75,00")).toMatch(/zzgl\. Versand/);
  });

  it("sagt auf beiden Flächen dasselbe — eine Komponente, ein Satz", () => {
    // Keine der beiden Flächen baut den Satz selbst zusammen.
    for (const [name, path] of BUY_SURFACES) {
      expect(code(path), name).not.toContain("shippingNote(");
      expect(code(path), name).not.toContain("shippingNoteBare");
    }
  });
});

describe("die Freigrenze hat genau eine Quelle", () => {
  it("kommt aus shipping_free_from(), und nur von dort", () => {
    const queries = code(QUERIES);
    expect(queries).toContain("export const fetchFreeShippingFrom");
    expect(queries).toContain('supabase.rpc("shipping_free_from")');
    // Genau eine Aufrufstelle im ganzen Projekt: auch die Versandseite liest
    // über denselben Helfer.
    expect((queries.match(/rpc\("shipping_free_from"\)/g) ?? [])).toHaveLength(1);
    expect(queries).toContain("fetchFreeShippingFrom()");
  });

  it("wird von jeder Seite gereicht, die eine Kauffläche zeigt", () => {
    for (const [name, path] of [
      ["Figurenseite", FIGURE_PAGE],
      ["Katalog", CATALOG_PAGE],
      ["Shop", SHOP_PAGE],
    ] as const) {
      expect(code(path), name).toContain("fetchFreeShippingFrom()");
      expect(code(path), name).toContain("freeShippingFrom");
    }
  });

  it("speist auch den Satz auf /shop", () => {
    expect(code(SHOP_PAGE)).toContain("de.shop.page.intro(seller.displayName, shippingFrom)");
    expect(de.shop.page.intro("X", "€ 75,00")).toContain("€ 75,00");
    expect(de.shop.page.intro("X", null)).not.toMatch(/\d/);
    expect(de.shop.page.introFallback(null)).not.toMatch(/\d/);
  });

  it("KEIN Geldbetrag als Literal, nirgends auf diesem Weg", () => {
    /*
     * Der eigentliche Punkt. „ab 75 € versandkostenfrei" stand bis zum
     * 2026-09-25 zweimal in `de.ts`; die Grenze ist eine Einstellung, keine
     * Konstante.
     */
    const copy = readFileSync("src/lib/i18n/de.ts", "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
      })
      .join("\n");
    const shopCopy = copy.slice(copy.indexOf("shop: {"), copy.indexOf("quickView: {"));
    expect(shopCopy).not.toMatch(/\d+\s*€|€\s*\d/);
    expect(shopCopy).not.toContain("versandkostenfrei\"");
    for (const path of [PANEL, QUICK, NOTE, SHOP_PAGE]) {
      expect(code(path), path).not.toMatch(/\d+[.,]\d{2}\s*€|€\s*\d/);
    }
  });
});
