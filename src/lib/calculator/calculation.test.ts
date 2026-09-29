import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  addFigure, centsToEuro, changeQuantity, clampFactor, clampQuantity, euroToCents,
  FALLBACK_FACTOR, historicFactorPercent, initialFactor, lineTotalCents, MAX_QUANTITY,
  maxPurchaseCents, parseAmountToCents, parseFactor, removeLine, resetUnitCents,
  setQuantity, setUnitCents, totals, type CalculationLine, type CalculatorChoice,
} from "./calculation";

/**
 * Der Figuren-Kalkulator (V1).
 *
 * Alles hier ist reine Rechnung — kein DOM, keine Datenbank. Das ist die
 * Stelle, an der der Kalkulator richtig oder falsch ist: die Oberfläche
 * darüber ordnet nur an.
 */
const SPYRO: CalculatorChoice = { skyId: "SKY-0001", name: "Spyro", series: "SA", marketPrice: 12.5 };
const LEGENDARY: CalculatorChoice =
  { skyId: "SKY-0002", name: "Legendary Spyro", series: "SA", marketPrice: 24.9 };
const NO_PRICE: CalculatorChoice =
  { skyId: "SKY-0777", name: "Kein Preis bekannt", series: "TT", marketPrice: null };

const build = (...choices: CalculatorChoice[]): CalculationLine[] =>
  choices.reduce<CalculationLine[]>((lines, c) => addFigure(lines, c), []);

describe("Geld ist ganzzahlig", () => {
  it("rechnet Euro genau einmal in Cent um", () => {
    expect(euroToCents(12.5)).toBe(1250);
    expect(euroToCents("0.89")).toBe(89);
    expect(euroToCents("1,05")).toBe(105);
  });

  it("trennt einen unbekannten Preis von einem Preis von null (ADR-0010)", () => {
    expect(euroToCents(null)).toBeNull();
    expect(euroToCents(undefined)).toBeNull();
    expect(euroToCents("")).toBeNull();
    expect(euroToCents("keine Zahl")).toBeNull();
    // 0 ist ein Wert, kein Unbekannt.
    expect(euroToCents(0)).toBe(0);
  });

  it("summiert ohne Gleitkommarest — der eigentliche Grund für Cent", () => {
    /*
     * In Euro gerechnet ergibt 0,10 + 0,20 nicht 0,30, und über dreißig
     * Positionen wird daraus ein sichtbarer Fehler in genau der Zahl, nach
     * der jemand seine Einkaufsentscheidung trifft.
     */
    expect(0.1 + 0.2).not.toBe(0.3);
    const lines = [
      { ...build(SPYRO)[0], unitCents: 10, quantity: 1 },
      { ...build(LEGENDARY)[0], unitCents: 20, quantity: 1 },
    ];
    expect(totals(lines).totalCents).toBe(30);
    expect(centsToEuro(totals(lines).totalCents)).toBe(0.3);
  });

  it("nimmt einen getippten Betrag mit Komma oder Punkt", () => {
    expect(parseAmountToCents("10")).toBe(1000);
    expect(parseAmountToCents("10,00")).toBe(1000);
    expect(parseAmountToCents("9.99")).toBe(999);
    expect(parseAmountToCents("  3,5 ")).toBe(350);
  });

  it("wertet ein leeres Feld als 0 und Unsinn als unverändert", () => {
    // Leer heißt: der Händler löscht gerade, um neu zu tippen.
    expect(parseAmountToCents("")).toBe(0);
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("-5")).toBeNull();
  });
});

describe("Figuren aufnehmen", () => {
  it("legt die erste Position mit dem Katalogwert an", () => {
    const [line] = build(SPYRO);
    expect(line.skyId).toBe("SKY-0001");
    expect(line.suggestedCents).toBe(1250);
    expect(line.unitCents).toBe(1250);
    expect(line.quantity).toBe(1);
    expect(line.manual).toBe(false);
  });

  it("nimmt mehrere unterschiedliche Figuren auf", () => {
    const lines = build(SPYRO, LEGENDARY, NO_PRICE);
    expect(lines).toHaveLength(3);
    expect(new Set(lines.map((l) => l.skyId)).size).toBe(3);
  });

  it("stellt die zuletzt aufgenommene nach vorn", () => {
    // Wer dreißig Figuren eintippt, soll die letzte sehen, ohne zu scrollen.
    expect(build(SPYRO, LEGENDARY)[0].skyId).toBe("SKY-0002");
  });

  it("erhöht bei derselben Figur die Menge statt eine zweite Zeile anzulegen", () => {
    const lines = build(SPYRO, SPYRO, SPYRO);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
  });

  it("hält Varianten getrennt — es sind eigene Katalogzeilen (ADR-0034)", () => {
    const lines = build(SPYRO, LEGENDARY);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.name).sort()).toEqual(["Legendary Spyro", "Spyro"]);
    // Und jede trägt ihren eigenen Wert.
    expect(lines.find((l) => l.skyId === "SKY-0002")?.unitCents).toBe(2490);
  });

  it("nimmt eine Figur ohne Preis auf, statt sie abzulehnen", () => {
    const [line] = build(NO_PRICE);
    expect(line.suggestedCents).toBeNull();
    expect(line.unitCents).toBe(0);
    expect(totals([line]).withoutValue).toBe(1);
  });

  it("behält einen selbst gesetzten Wert, wenn dieselbe Figur wiederkommt", () => {
    let lines = build(SPYRO);
    lines = setUnitCents(lines, "SKY-0001", 1000);
    lines = addFigure(lines, SPYRO);
    expect(lines[0].quantity).toBe(2);
    expect(lines[0].unitCents).toBe(1000);
    expect(lines[0].manual).toBe(true);
  });
});

describe("Menge", () => {
  it("erhöht und senkt", () => {
    let lines = build(SPYRO);
    lines = changeQuantity(lines, "SKY-0001", 1);
    expect(lines[0].quantity).toBe(2);
    lines = changeQuantity(lines, "SKY-0001", -1);
    expect(lines[0].quantity).toBe(1);
  });

  it("geht nie unter 1 — Entfernen ist eine eigene Handlung", () => {
    let lines = build(SPYRO);
    lines = changeQuantity(lines, "SKY-0001", -5);
    expect(lines[0].quantity).toBe(1);
    expect(lines).toHaveLength(1);
  });

  it("deckelt nach oben und verträgt Unsinn", () => {
    expect(clampQuantity(500)).toBe(MAX_QUANTITY);
    expect(clampQuantity(0)).toBe(1);
    expect(clampQuantity(Number.NaN)).toBe(1);
    expect(clampQuantity(3.7)).toBe(3);
  });

  it("lässt sich direkt setzen", () => {
    const lines = setQuantity(build(SPYRO), "SKY-0001", 12);
    expect(lines[0].quantity).toBe(12);
  });

  it("rührt andere Positionen nicht an", () => {
    const lines = changeQuantity(build(SPYRO, LEGENDARY), "SKY-0001", 4);
    expect(lines.find((l) => l.skyId === "SKY-0001")?.quantity).toBe(5);
    expect(lines.find((l) => l.skyId === "SKY-0002")?.quantity).toBe(1);
  });
});

describe("Einzelwert von Hand", () => {
  it("überschreibt den Vorschlag und merkt sich, dass ein Mensch entschieden hat", () => {
    const lines = setUnitCents(build(SPYRO), "SKY-0001", 1000);
    expect(lines[0].unitCents).toBe(1000);
    expect(lines[0].suggestedCents).toBe(1250);
    expect(lines[0].manual).toBe(true);
  });

  it("wirkt sofort auf die Summen", () => {
    let lines = build(SPYRO);
    lines = setQuantity(lines, "SKY-0001", 3);
    expect(totals(lines).totalCents).toBe(3750);
    lines = setUnitCents(lines, "SKY-0001", 1000);
    expect(totals(lines).totalCents).toBe(3000);
  });

  it("gibt einer Figur ohne Preis einen", () => {
    const lines = setUnitCents(build(NO_PRICE), "SKY-0777", 550);
    expect(lines[0].unitCents).toBe(550);
    expect(totals(lines).withoutValue).toBe(0);
  });

  it("kennt kein negatives Geld", () => {
    expect(setUnitCents(build(SPYRO), "SKY-0001", -100)[0].unitCents).toBe(0);
  });

  it("lässt sich auf den Katalogwert zurücksetzen", () => {
    let lines = setUnitCents(build(SPYRO), "SKY-0001", 1);
    lines = resetUnitCents(lines, "SKY-0001");
    expect(lines[0].unitCents).toBe(1250);
    expect(lines[0].manual).toBe(false);
  });

  it("setzt eine Position ohne Vorschlag auf 0 zurück, nicht auf etwas Erfundenes", () => {
    let lines = setUnitCents(build(NO_PRICE), "SKY-0777", 900);
    lines = resetUnitCents(lines, "SKY-0777");
    expect(lines[0].unitCents).toBe(0);
  });
});

describe("Entfernen und Leeren", () => {
  it("entfernt genau eine Position", () => {
    const lines = removeLine(build(SPYRO, LEGENDARY), "SKY-0001");
    expect(lines).toHaveLength(1);
    expect(lines[0].skyId).toBe("SKY-0002");
  });

  it("leeren heisst: keine Position mehr, und die Summen sind null", () => {
    const empty = totals([]);
    expect(empty).toEqual({ positions: 0, units: 0, totalCents: 0, withoutValue: 0 });
    expect(maxPurchaseCents(empty.totalCents, 60)).toBe(0);
  });
});

describe("Summen", () => {
  it("Positionswert ist Einzelwert mal Menge", () => {
    const line = setQuantity(build(SPYRO), "SKY-0001", 4)[0];
    expect(lineTotalCents(line)).toBe(5000);
  });

  it("zählt Positionen, Stück und Gesamtwert getrennt", () => {
    let lines = build(SPYRO, LEGENDARY);
    lines = setQuantity(lines, "SKY-0001", 3);
    const t = totals(lines);
    expect(t.positions).toBe(2);
    expect(t.units).toBe(4);
    expect(t.totalCents).toBe(3 * 1250 + 2490);
  });

  it("zählt eine Figur ohne Wert mit — bei Stückzahl, nicht beim Geld", () => {
    const lines = build(SPYRO, NO_PRICE);
    const t = totals(lines);
    expect(t.positions).toBe(2);
    expect(t.units).toBe(2);
    expect(t.totalCents).toBe(1250);
    expect(t.withoutValue).toBe(1);
  });
});

describe("Ankaufsfaktor und maximaler Einkaufspreis", () => {
  it("rechnet das Beispiel aus der Anforderung", () => {
    // Gesamtwert 146,80 € bei 60 % → 88,08 €
    expect(maxPurchaseCents(14680, 60)).toBe(8808);
    expect(centsToEuro(maxPurchaseCents(14680, 60))).toBe(88.08);
  });

  it("rundet genau einmal, kaufmännisch", () => {
    // 10,01 € × 55 % = 5,5055 € → 5,51 €
    expect(maxPurchaseCents(1001, 55)).toBe(551);
    expect(maxPurchaseCents(1, 50)).toBe(1);   // 0,5 Cent → 1
    expect(maxPurchaseCents(100, 0)).toBe(0);
    expect(maxPurchaseCents(100, 100)).toBe(100);
  });

  it("begrenzt den Faktor auf 0 bis 100", () => {
    expect(clampFactor(-20)).toBe(0);
    expect(clampFactor(140)).toBe(100);
    expect(clampFactor(60)).toBe(60);
    expect(FALLBACK_FACTOR).toBeGreaterThan(0);
    expect(FALLBACK_FACTOR).toBeLessThan(100);
  });

  it("nimmt einen getippten Faktor mit und ohne Prozentzeichen", () => {
    expect(parseFactor("60")).toBe(60);
    expect(parseFactor("60 %")).toBe(60);
    expect(parseFactor("59,6")).toBe(60);
    expect(parseFactor("")).toBe(0);
    expect(parseFactor("abc")).toBeNull();
  });
});

describe("der Kalkulator schreibt nichts", () => {
  it("das Rechenmodul kennt weder Datenbank noch Netz", () => {
    /*
     * Ohne Kommentare geprüft: die Prosa oben erklärt ausdrücklich, warum
     * dieses Modul weder Lager noch Bestellung anfasst, und nennt beide
     * Wörter dabei. Ein roher Textvergleich würde die Erklärung für den
     * Fehler halten — derselbe Grund, aus dem die anderen Quelltests hier
     * `code()` benutzen.
     */
    const code = readFileSync("src/lib/calculator/calculation.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const forbidden of ["supabase", "createClient", "fetch(", ".rpc(", "use server",
                             "shop_inventory", "inventory_movements", "order_lines",
                             "useCart", "stripe"]) {
      expect(code.includes(forbidden), `calculation.ts darf ${forbidden} nicht enthalten`)
        .toBe(false);
    }
  });

  it("verändert seine Eingabe nicht, sondern gibt eine neue Liste zurück", () => {
    const before = build(SPYRO);
    const snapshot = JSON.stringify(before);
    addFigure(before, LEGENDARY);
    changeQuantity(before, "SKY-0001", 5);
    setUnitCents(before, "SKY-0001", 1);
    removeLine(before, "SKY-0001");
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

/**
 * Der historische Ankaufsfaktor als Ausgangspunkt.
 *
 * Er kommt aus `orderbook_global_factor()` — Ausgaben ÷ bekannter Marktwert
 * über alle Einkäufe. Hier wird NICHT die Formel geprüft (die steht in der
 * Datenbank und hat dort ihren Ort), sondern was die Anwendung damit tut:
 * umrechnen, aussortieren, als Startwert nehmen — und ihn niemals anfassen.
 */
describe("der historische Ankaufsfaktor", () => {
  it("wird aus dem Verhältnis in ganze Prozent umgerechnet", () => {
    expect(historicFactorPercent(0.43)).toBe(43);
    expect(historicFactorPercent(0.4312)).toBe(43);
    expect(historicFactorPercent("0.385")).toBe(39);
    expect(historicFactorPercent(1)).toBe(100);
  });

  it("gilt ohne Datenlage als nicht vorhanden, nicht als null Prozent", () => {
    // `orderbook_global_factor()` antwortet NULL, solange kein Einkauf einen
    // bekannten Marktwert hat.
    expect(historicFactorPercent(null)).toBeNull();
    expect(historicFactorPercent(undefined)).toBeNull();
    expect(historicFactorPercent("")).toBeNull();
    expect(historicFactorPercent("keine Zahl")).toBeNull();
    expect(historicFactorPercent(0)).toBeNull();
    expect(historicFactorPercent(-0.2)).toBeNull();
  });

  it("wird zum Startwert einer neuen Kalkulation", () => {
    expect(initialFactor(43)).toBe(43);
    expect(initialFactor(38)).toBe(38);
  });

  it("fällt ohne historischen Wert auf 50 % zurück", () => {
    expect(initialFactor(null)).toBe(FALLBACK_FACTOR);
    expect(FALLBACK_FACTOR).toBe(50);
  });

  it("begrenzt den Startwert auf das, was das Feld halten kann", () => {
    // Wer historisch über Marktwert eingekauft hat: das Feld beginnt bei
    // 100, die Referenz daneben zeigt weiterhin den echten Wert.
    expect(initialFactor(112)).toBe(100);
    expect(historicFactorPercent(1.12)).toBe(112);
  });

  it("rechnet das Beispiel: 200,00 € historisch 43 % → 86,00 €", () => {
    const factor = initialFactor(historicFactorPercent(0.43));
    expect(factor).toBe(43);
    expect(maxPurchaseCents(20000, factor)).toBe(8600);
  });

  it("und nach dem Verstellen auf 38 % → 76,00 €, die Referenz bleibt 43 %", () => {
    const historic = historicFactorPercent(0.43);
    let factor = initialFactor(historic);
    factor = clampFactor(38);
    expect(maxPurchaseCents(20000, factor)).toBe(7600);
    // Der historische Wert ist eine gelesene Zahl und ändert sich dabei nicht.
    expect(historic).toBe(43);
  });

  it("verträgt die Ränder", () => {
    expect(maxPurchaseCents(20000, 0)).toBe(0);
    expect(maxPurchaseCents(20000, 100)).toBe(20000);
  });
});
