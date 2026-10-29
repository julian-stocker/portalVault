import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { parsePriceInput, formatPriceInput } from "./price-input";
import { catalogDisplayMarketPrice } from "@/lib/catalog/market-boost";

/**
 * CAT-09 — der Marktwert an der Kachel, als Rechnung.
 *
 * ZWEI GEFAHREN, und beide sind hier benannt:
 *
 *   1. „PREIS OFFEN" WIRD ZU 0 €. `Number("")` ist 0, und eine 0 im
 *      Marktwert heisst „diese Figur ist nichts wert" statt „wir wissen es
 *      nicht" (ADR-0010). Die beiden Aussagen dürfen nicht verschmelzen.
 *   2. DER ZUSCHLAG WIRD ZWEIMAL GERECHNET. Der Katalog DRUCKT
 *      `market_price × (1 + Zuschlag)`; schreibt die Bearbeitung den
 *      gedruckten Betrag zurück, ist er beim nächsten Lesen doppelt drin.
 */

describe("was in einem Preisfeld steht, als Zahl", () => {
  it("ein leeres Feld heisst „Preis offen“ — und ist NICHT 0", () => {
    for (const leer of ["", "   ", "€", " € "]) {
      expect(parsePriceInput(leer), JSON.stringify(leer)).toBeNull();
    }
    /* Der Unterschied, der alles entscheidet. */
    expect(parsePriceInput("0")).toBe("ungueltig");
    expect(parsePriceInput("0,00")).toBe("ungueltig");
    expect(parsePriceInput("0.00")).toBe("ungueltig");
  });

  it("Komma und Punkt sind dasselbe", () => {
    expect(parsePriceInput("4,99")).toBe(4.99);
    expect(parsePriceInput("4.99")).toBe(4.99);
    expect(parsePriceInput("12")).toBe(12);
    expect(parsePriceInput("12,5")).toBe(12.5);
    expect(parsePriceInput(" 5,76 €")).toBe(5.76);
  });

  it("und zwei Trennzeichen sind eine Eingabe, bei der nicht geraten wird", () => {
    /* `1.234,56` wäre als Tausenderpunkt gemeint oder als Tippfehler —
       beides ist möglich, also entscheidet die Funktion nichts. */
    expect(parsePriceInput("1.234,56")).toBe("ungueltig");
    expect(parsePriceInput("1,234.56")).toBe("ungueltig");
  });

  it("alles andere ist ungültig, und ausdrücklich", () => {
    for (const murks of ["abc", "4,999", "-5", "-5,00", "4,9,9", "1e3", "4,", ",99",
                         "99999999999", "NaN", "Infinity"]) {
      expect(parsePriceInput(murks), murks).toBe("ungueltig");
    }
  });

  it("der gespeicherte Wert kommt mit Komma ins Feld zurück", () => {
    expect(formatPriceInput(4.99)).toBe("4,99");
    expect(formatPriceInput(12)).toBe("12,00");
    expect(formatPriceInput(null)).toBe("");
  });

  it("und ein Umlauf durch Feld und zurück verändert ihn nicht", () => {
    for (const wert of [4.99, 12, 0.01, 104.71, 5.76]) {
      expect(parsePriceInput(formatPriceInput(wert)), String(wert)).toBe(wert);
    }
    expect(parsePriceInput(formatPriceInput(null))).toBeNull();
  });
});

describe("der Zuschlag wird nicht zurückgeschrieben", () => {
  it("die Kachel DRUCKT mehr, als gespeichert ist", () => {
    /* 5 % auf 5,48 ergibt 5,75 — und 5,75 ist nicht der gespeicherte Wert. */
    expect(catalogDisplayMarketPrice(5.48, 5)).toBe(5.75);
    expect(catalogDisplayMarketPrice(5.48, 0)).toBe(5.48);
    expect(catalogDisplayMarketPrice(null, 5)).toBeNull();
  });

  it("und das Feld ist mit dem GESPEICHERTEN Wert vorbelegt", () => {
    /*
     * DIE FALLE, GERECHNET. Schriebe das Feld den gedruckten Betrag zurück,
     * wäre der Zuschlag beim nächsten Lesen zweimal drin — und beim nächsten
     * Speichern dreimal. Nach fünf Bearbeitungen stünde ein Viertel mehr da,
     * ohne dass jemand eine Zahl geändert hätte.
     */
    let gespeichert = 5.48;
    for (let i = 0; i < 5; i++) {
      const gedruckt = catalogDisplayMarketPrice(gespeichert, 5)!;
      /* So wäre es falsch: */
      gespeichert = parsePriceInput(formatPriceInput(gedruckt)) as number;
    }
    expect(gespeichert).toBeGreaterThan(6.9);     /* 5,48 → 6,99: +27 % */

    /* Und so ist es richtig: das Feld trägt den gespeicherten Wert. */
    let richtig = 5.48;
    for (let i = 0; i < 5; i++) {
      richtig = parsePriceInput(formatPriceInput(richtig)) as number;
    }
    expect(richtig).toBe(5.48);
  });

  it("die Oberfläche bindet an `figure.marketPrice`, nicht an den gedruckten Betrag", () => {
    const karte = readFileSync("src/components/catalog/catalog-card.tsx", "utf8");
    const inline = readFileSync("src/components/admin/inline-price.tsx", "utf8");
    expect(karte).toContain("marketPrice={figure.marketPrice}");
    /* Das Feld wird aus `wert` gefüllt, und `wert` kommt aus `marketPrice`. */
    expect(inline).toContain("useState<number | null>(marketPrice)");
    expect(inline).toContain("setText(formatPriceInput(wert))");
    /* Gespeichert wird, was im Feld steht — nie der gedruckte Betrag. */
    expect(inline).toContain("setMarketPrice(skyId, gelesen)");
    expect(inline).not.toMatch(/setMarketPrice\([^)]*catalogDisplayMarketPrice/);
  });

  it("und die Serveraktion schreibt genau eine Spalte", () => {
    const sql = readFileSync("supabase/migrations/0162_admin_price_and_delete.sql", "utf8");
    const rumpf = sql.slice(sql.indexOf("create or replace function public.admin_set_market_price"),
                            sql.indexOf("comment on function public.admin_set_market_price"));
    expect(rumpf).toContain("set market_price     = p_price");
    expect(rumpf).toContain("price_updated_at = case when p_price is null");
    /*
     * Kein zweites Feld, kein Status, keine Sichtbarkeit, kein Name — am
     * CODE gemessen: der Rumpf zählt in einem Kommentar auf, was er NICHT
     * anfasst, und die Wörter stehen dort.
     */
    const ohneProsa = rumpf.replace(/\/\*[\s\S]*?\*\//g, "")
                           .replace(/^\s*--.*$/gm, "");
    for (const fremd of ["catalog_status", "catalog_visible", "set name",
                         "set slug", "card_type", "character_id", "base_sky_id"]) {
      expect(ohneProsa, fremd).not.toContain(fremd);
    }
    /* Und 0 wird mit einem Satz abgewiesen, nicht von der Constraint. */
    expect(rumpf).toContain("ist kein Preis");
  });
});
