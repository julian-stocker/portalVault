import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  CALCULATION_STATUSES, canHandOver, decodeLines, encodeLines, handOverItems,
  isCalculationStatus, LINES_VERSION, MAX_NAME_LENGTH, MAX_SAVED_LINES, normalizeName,
  suggestName, summarize, toSavedCalculation, type CalculationRow,
} from "./saved";
import { addFigure, setQuantity, setUnitCents, type CalculationLine } from "./calculation";

/**
 * Die gespeicherte Kalkulation (Calculator V2, ADR-0131).
 *
 * Zwei Fragen stehen hier im Mittelpunkt: bleibt eine alte Kalkulation
 * lesbar und nachvollziehbar, und lässt sich die spätere Übernahme ins
 * Orderbuch daraus bilden, ohne die Artikel ein zweites Mal zu pflegen?
 */

const SPYRO = { skyId: "SKY-0001", name: "Spyro", series: "SA", marketPrice: 12.9 };
const GILL = { skyId: "SKY-0003", name: "Gill Grunt", series: "SA", marketPrice: 8 };
const OHNE = { skyId: "SKY-0099", name: "Ohne Preis", series: "G", marketPrice: null };

const bau = (...c: { skyId: string; name: string; series: string; marketPrice: number | null }[]) =>
  c.reduce<CalculationLine[]>((lines, choice) => addFigure(lines, choice), []);

describe("der Schnappschuss", () => {
  it("speichert, WOMIT gerechnet wurde — nicht nur, was ausgewählt war", () => {
    const lines = setUnitCents(bau(SPYRO), "SKY-0001", 1500);
    const [zurueck] = decodeLines(encodeLines(lines));
    expect(zurueck.unitCents).toBe(1500);      // der angesetzte Wert
    expect(zurueck.suggestedCents).toBe(1290); // der Katalogwert von damals
    expect(zurueck.manual).toBe(true);         // und dass ein Mensch entschied
  });

  it("hält „kein Marktwert bekannt“ von „kostet nichts“ getrennt (ADR-0010)", () => {
    const [zurueck] = decodeLines(encodeLines(bau(OHNE)));
    expect(zurueck.suggestedCents).toBeNull();
    expect(zurueck.unitCents).toBe(0);
  });

  it("trägt seine Fassung, und eine unbekannte wird nicht geraten", () => {
    expect(encodeLines([]).version).toBe(LINES_VERSION);
    expect(decodeLines({ version: 99, lines: [{ sky_id: "SKY-0001", name: "x" }] })).toEqual([]);
  });

  it("behält die Reihenfolge über das Speichern hinweg (ADR-0131, Punkt 4)", () => {
    const lines = bau(SPYRO, GILL);
    expect(decodeLines(encodeLines(lines)).map((l) => l.skyId)).toEqual(["SKY-0003", "SKY-0001"]);
  });

  it("deckelt bei 200 Positionen — dieselbe Decke wie das Orderbuch", () => {
    expect(MAX_SAVED_LINES).toBe(200);
    const viele = Array.from({ length: 250 }, (_, i) => ({
      skyId: `SKY-${String(i + 1).padStart(4, "0")}`,
      name: `Figur ${i}`, series: "SA", marketPrice: 1,
    }));
    expect(encodeLines(bau(...viele)).lines).toHaveLength(200);
  });

  it("wirft nie", () => {
    for (const roh of [null, undefined, 42, "text", {}, { lines: [] }, { version: 1 }]) {
      expect(() => decodeLines(roh)).not.toThrow();
    }
  });
});

describe("die drei abgeleiteten Zahlen", () => {
  it("zählen Positionen, Stück und Summe in Cent", () => {
    const lines = setQuantity(bau(SPYRO, GILL), "SKY-0001", 3);
    const sums = summarize(lines);
    expect(sums.positions).toBe(2);
    expect(sums.units).toBe(4);           // 3 × Spyro + 1 × Gill
    expect(sums.totalCents).toBe(3 * 1290 + 800);
  });

  it("werden beim Lesen NEU gerechnet, nicht aus den Spalten geglaubt", () => {
    /*
     * Die Spalten sind eine Abkürzung für die Liste. Laufen sie je
     * auseinander, gilt das, womit gerechnet wurde — sonst zeigte die
     * Liste eine Zahl, die in der Kalkulation nicht vorkommt.
     */
    const row: CalculationRow = {
      id: "0b6c0f3e-3a4a-4f0e-9a2a-9f5f5f5f5f5f",
      name: "Test", status: "review",
      lines: encodeLines(bau(SPYRO)),
      factor_percent: 50,
      total_cents: 999999, positions: 42, units: 99,
      purchase_id: null,
      created_at: "2026-10-22T10:00:00Z", updated_at: "2026-10-22T10:00:00Z",
    };
    const saved = toSavedCalculation(row);
    expect(saved.totalCents).toBe(1290);
    expect(saved.positions).toBe(1);
    expect(saved.units).toBe(1);
  });

  it("ein unbekannter Status fällt auf „In Prüfung“ zurück", () => {
    const row = {
      id: "x", name: "n", status: "erfunden", lines: { version: 1, lines: [] },
      factor_percent: 50, total_cents: 0, positions: 0, units: 0, purchase_id: null,
      created_at: "", updated_at: "",
    } as unknown as CalculationRow;
    expect(toSavedCalculation(row).status).toBe("review");
  });
});

describe("der Name", () => {
  it("wird nur außen beschnitten (CLAUDE.md Regel 4)", () => {
    expect(normalizeName("  Willhaben – Sammlung 35 Figuren  "))
      .toBe("Willhaben – Sammlung 35 Figuren");
    /* Kein Ersetzen von Zeichen, kein Zusammenziehen von Leerraum im Inneren. */
    expect(normalizeName("eBay  –  2 Kisten")).toBe("eBay  –  2 Kisten");
  });

  it("hat eine Obergrenze, und sie ist die des CHECK", () => {
    expect(MAX_NAME_LENGTH).toBe(120);
    expect(normalizeName("x".repeat(500))).toHaveLength(120);
    const migration = readFileSync(
      "supabase/migrations/0142_purchase_calculations.sql", "utf8");
    expect(migration).toContain("between 1 and 120");
  });

  it("schlägt etwas vor, woran man ein Inserat wiedererkennt", () => {
    const tag = new Date("2026-10-22T08:00:00Z");
    expect(suggestName(bau(SPYRO), tag)).toBe("Spyro (2026-10-22)");
    expect(suggestName(bau(SPYRO, GILL), tag)).toBe("Gill Grunt + 1 weitere (2026-10-22)");
    /* Und niemals „Unbenannt“: drei davon machen die Liste unbrauchbar. */
    expect(suggestName([], tag)).not.toContain("Unbenannt");
  });
});

describe("der Status", () => {
  it("kennt genau vier Werte", () => {
    expect([...CALCULATION_STATUSES]).toEqual(["review", "negotiating", "bought", "rejected"]);
  });

  it("und die Datenbank kennt dieselben", () => {
    const migration = readFileSync(
      "supabase/migrations/0142_purchase_calculations.sql", "utf8");
    expect(migration)
      .toContain("status in ('review', 'negotiating', 'bought', 'rejected')");
  });

  it("weist alles andere ab", () => {
    expect(isCalculationStatus("gekauft")).toBe(false);
    expect(isCalculationStatus(null)).toBe(false);
  });
});

describe("die spätere Übernahme ins Orderbuch", () => {
  const basis = {
    id: "0b6c0f3e-3a4a-4f0e-9a2a-9f5f5f5f5f5f", name: "Willhaben", status: "negotiating",
    factor_percent: 55, total_cents: 0, positions: 0, units: 0,
    created_at: "", updated_at: "",
  };

  it("eine Position mit Menge 3 sind DREI Elemente", () => {
    /*
     * `seller_create_purchase_with_items` (0064) erwartet ein Element je
     * physischer Einheit und fasst Dubletten ausdrücklich nicht zusammen.
     * Diese Übersetzung hier ist der Grund, warum die Kalkulation die Menge
     * speichert und nicht nur die Figur.
     */
    const row = {
      ...basis, purchase_id: null,
      lines: encodeLines(setQuantity(bau(SPYRO, GILL), "SKY-0001", 3)),
    } as unknown as CalculationRow;
    const items = handOverItems(toSavedCalculation(row));
    expect(items).toHaveLength(4);
    expect(items.filter((i) => i.sky_id === "SKY-0001")).toHaveLength(3);
    /* Ein Zustand, und zwar der eine, den SkyIsles führt (ADR-0130). */
    expect(new Set(items.map((i) => i.condition))).toEqual(new Set(["loose"]));
  });

  it("und die Decke des Orderbuchs wird dabei nicht gesprengt", () => {
    /* 200 Positionen × Menge 1 sind 200 Elemente — genau die Decke. Mehr
       Stück als Positionen kann es geben; dann ist die Übernahme Sache des
       späteren Wegs und nicht dieser Übersetzung. */
    expect(MAX_SAVED_LINES).toBe(200);
    const migration = readFileSync(
      "supabase/migrations/0142_purchase_calculations.sql", "utf8");
    expect(migration).toContain("jsonb_array_length(lines -> 'lines') <= 200");
  });

  it("eine schon übernommene Kalkulation wird nicht zweimal übernommen", () => {
    const offen = { ...basis, purchase_id: null, lines: encodeLines(bau(SPYRO)) };
    const vergeben = { ...basis, purchase_id: 7, lines: encodeLines(bau(SPYRO)) };
    expect(canHandOver(toSavedCalculation(offen as unknown as CalculationRow))).toBe(true);
    expect(canHandOver(toSavedCalculation(vergeben as unknown as CalculationRow))).toBe(false);
  });

  it("eine leere Kalkulation auch nicht", () => {
    const leer = { ...basis, purchase_id: null, lines: encodeLines([]) };
    expect(canHandOver(toSavedCalculation(leer as unknown as CalculationRow))).toBe(false);
  });

  it("und die Datenbank hält dieselbe Regel", () => {
    const migration = readFileSync(
      "supabase/migrations/0142_purchase_calculations.sql", "utf8");
    /* Ein partieller Unique-Index: `null` beliebig oft, ein Einkauf einmal. */
    expect(migration).toContain("create unique index purchase_calculations_purchase_uniq");
    expect(migration).toContain("where purchase_id is not null");
  });

  it("aber gebaut ist der Weg nicht — und keine Aktion schreibt die Spalte", () => {
    /*
     * Die Architektur ist vorbereitet, die Übernahme ausdrücklich nicht
     * gebaut (Auftrag Punkt 6). Eine Spalte, die der Client setzen darf,
     * wäre genau die Sperre, die sie werden soll.
     */
    const actions = readFileSync("src/lib/calculator/saved-actions.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(?:\/\/|\*).*$/gm, "");
    expect(actions).not.toContain("purchase_id:");
    expect(actions).not.toContain("seller_create_purchase");
    expect(actions).not.toContain("purchases");
  });
});
