/**
 * Zahlen, die auf Server und Browser gleich aussehen.
 *
 * DER FEHLER, DEN DIESE DATEI BEWACHT.
 *
 * Im Orderbuch meldete React einen Hydration-Mismatch:
 *
 *     Server: 2.118 Artikel
 *     Client: 2 118 Artikel
 *
 * Beide Seiten riefen DIESELBE Zeile — `items.toLocaleString("de-AT")`. Sie
 * kamen auseinander, weil das Trennzeichen nicht im Code steht, sondern in
 * den CLDR-Daten der ICU-Bibliothek, mit der die Laufzeit gebaut wurde. Für
 * österreichisches Deutsch wurde dieses Zeichen zwischen CLDR-Fassungen
 * geändert: früher `.`, heute ein geschütztes Leerzeichen. Node und Browser
 * bringen verschiedene ICU-Fassungen mit, also schrieb der Server die eine
 * Zeichenkette ins HTML und der Browser baute die andere.
 *
 * Gemessen auf dieser Maschine, Node v26.7.0 / ICU 78 / CLDR 48:
 *
 *     Intl.NumberFormat("de-AT").format(2118)  →  "2 118"
 *     Intl.NumberFormat("de-DE").format(2118)  →  "2.118"
 *
 * Und — schlimmer, weil ohne jede Hydration sichtbar — dieselbe ICU gruppiert
 * `de-AT` je nach Stil verschieden: Währung mit `.`, Dezimalzahl mit U+00A0.
 * Die Summenzeile des Orderbuchs zeigte deshalb „€ 12.345,67" neben
 * „2 118 Artikel": dieselbe Größenordnung, zwei Gruppierungen, eine Zeile.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  euroAmount, fixedNumber, percentAmount, plainNumber, rangedNumber,
} from "./format-number";
import { formatDeduction, formatNumber, formatPercent, formatPrice } from "./format";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const NBSP = " ";

describe("die Gruppierung ist festgelegt, nicht geliehen", () => {
  it("Tausender mit Punkt, Dezimalstelle mit Komma", () => {
    expect(plainNumber(2118)).toBe("2.118");
    expect(plainNumber(999)).toBe("999");
    expect(plainNumber(1000)).toBe("1.000");
    expect(plainNumber(1234567)).toBe("1.234.567");
    expect(plainNumber(12345.678)).toBe("12.345,678");
  });

  it("kein geschütztes Leerzeichen — in keiner Ausgabe", () => {
    /*
     * DAS IST DIE EIGENTLICHE PRÜFUNG. U+00A0 und U+202F sehen auf dem
     * Bildschirm wie ein Leerzeichen aus und sind verschiedene Zeichen; ein
     * Mismatch zwischen ihnen wäre in der Fehlermeldung unsichtbar. Eine
     * Gruppierung darf hier niemals ein Leerzeichen sein, welches auch immer.
     */
    for (const value of [2118, 1234567, -98765.4, 1e6]) {
      expect(plainNumber(value), String(value)).not.toMatch(/[   ]/);
      expect(fixedNumber(value, 2), String(value)).not.toMatch(/[   ]/);
    }
    /* Beim Betrag und beim Prozentsatz ist das EINE U+00A0 vor dem Zeichen
       erlaubt — und genau eines. */
    expect([...euroAmount(1234567.89)].filter((c) => c === NBSP)).toHaveLength(1);
    expect([...percentAmount(123.456)].filter((c) => c === NBSP)).toHaveLength(1);
  });

  it("und das Ergebnis hängt nicht an der Laufzeit", () => {
    /*
     * Kein `Intl`, kein `toLocaleString`, keine Locale im Modul. Damit kann
     * keine ICU-Fassung das Ergebnis mehr verschieben — der Grund, warum die
     * Zeichen hier von Hand gesetzt sind und nicht geliehen werden.
     */
    const source = read("src/lib/format-number.ts");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("Intl");
    expect(code).not.toContain("toLocaleString");
    expect(code).not.toContain("de-AT");
  });
});

describe("gegenüber ICU hat sich NUR das Trennzeichen geändert", () => {
  /*
   * Der stärkste Test dieser Datei. Er nimmt die Ausgabe der echten
   * `Intl`-Formatierer für `de-AT`, ersetzt darin das Gruppierungszeichen
   * durch einen Punkt — und erwartet dann Zeichen für Zeichen dasselbe.
   *
   * Damit ist belegt, dass Vorzeichenstellung, Dezimalkomma, Stellenzahl,
   * Rundung, die Stellung des Eurozeichens und sein geschütztes Leerzeichen
   * unverändert sind. Geändert wurde ein Zeichen, nicht ein Format.
   */
  /*
   * Nur ein Trennzeichen ZWISCHEN Ziffern wird ersetzt. Die erste Fassung
   * ersetzte jedes U+00A0 vor einer Ziffer — und traf damit auch das
   * geschützte Leerzeichen hinter dem Eurozeichen, sodass „€ 0,00" mit
   * „€.0,00" verglichen wurde. Vom Test selbst gefunden.
   */
  const normalise = (text: string) =>
    text.replace(/(?<=\d)[\u00A0\u202F](?=\d)/g, ".");

  const plain = new Intl.NumberFormat("de-AT");
  const money = new Intl.NumberFormat("de-AT", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const percent = new Intl.NumberFormat("de-AT", {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
  });

  const SAMPLES = [0, 1, 7.5, 999, 1000, 2118, 12345.678, 1234567,
                   -5, -1000.5, -1234567.89, 0.125];

  it("plainNumber gegen Intl.NumberFormat(de-AT)", () => {
    for (const value of SAMPLES) {
      expect(plainNumber(value), String(value)).toBe(normalise(plain.format(value)));
    }
  });

  it("euroAmount gegen die Währungsformatierung — Zeichen, Platz, Abstand", () => {
    for (const value of SAMPLES) {
      expect(euroAmount(value), String(value)).toBe(normalise(money.format(value)));
    }
  });

  it("percentAmount gegen die Prozentformatierung", () => {
    for (const value of [0, 0.1234, 1, 12.345, -0.5]) {
      expect(percentAmount(value), String(value)).toBe(normalise(percent.format(value)));
    }
  });

  it("fixedNumber und rangedNumber gegen ihre Optionen", () => {
    /* Die beiden Formen, die im Orderbuch wirklich vorkommen: der Faktor mit
       zwei festen Stellen, und die Prozentzahl mit höchstens einer. */
    const two = new Intl.NumberFormat("de-AT",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const atMostOne = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 1 });
    const atLeastTwo = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2 });

    for (const value of [0, 2.5, 1.005, 2.345, -1.5, 12345.6789]) {
      expect(fixedNumber(value, 2), String(value)).toBe(normalise(two.format(value)));
      expect(rangedNumber(value, 0, 1), String(value)).toBe(normalise(atMostOne.format(value)));
      expect(rangedNumber(value, 2, 3), String(value)).toBe(normalise(atLeastTwo.format(value)));
    }
  });
});

describe("die Ränder", () => {
  it("minus null bekommt kein Vorzeichen", () => {
    expect(plainNumber(-0)).toBe("0");
    expect(euroAmount(-0)).toBe(`€${NBSP}0,00`);
  });

  it("das Minus steht vor dem Eurozeichen, wie bei ICU", () => {
    expect(euroAmount(-5)).toBe(`-€${NBSP}5,00`);
  });

  it("Unendlich wird nicht als „Infinity“ geschrieben", () => {
    expect(plainNumber(Number.POSITIVE_INFINITY)).toBe("∞");
    expect(plainNumber(Number.NEGATIVE_INFINITY)).toBe("-∞");
  });

  it("gerundet wird auf dem Wert, den die Zahl wirklich hat", () => {
    /*
     * 1.005 ist als Gleitkommazahl 1,00499999999999989… — `toFixed` macht
     * daraus „1,00". ICU rundet aber die KÜRZESTE Dezimaldarstellung, also
     * „1.005", und antwortet „1,01". Gemessen, und hier festgehalten, weil
     * die erste Fassung dieser Datei `toFixed` benutzte und damit angezeigte
     * Geldbeträge um einen Cent verschoben hätte.
     */
    expect(fixedNumber(1.005, 2)).toBe("1,01");
    expect(new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2,
      maximumFractionDigits: 2 }).format(1.005)).toBe("1,01");
    expect(fixedNumber(999.995, 2)).toBe("1.000,00");
  });

  it("überzählige Nullen werden nicht geschrieben", () => {
    expect(rangedNumber(2.5, 0, 3)).toBe("2,5");
    expect(rangedNumber(2, 0, 3)).toBe("2");
    expect(rangedNumber(2.5, 2, 3)).toBe("2,50");
  });
});

describe("eine Seite gruppiert jetzt überall gleich", () => {
  it("Betrag und Anzahl setzen denselben Trenner", () => {
    /*
     * Der Befund, der ohne Hydration sichtbar war: in CLDR 48 gruppiert
     * `de-AT` die Währung mit `.` und die Dezimalzahl mit U+00A0. Die
     * Summenzeile des Orderbuchs zeigte beides nebeneinander.
     */
    expect(plainNumber(2118)).toContain(".");
    expect(euroAmount(2118)).toContain("2.118");
    expect(percentAmount(21.18)).toContain("2.118");
  });
});

describe("format.ts gibt nur noch weiter", () => {
  it("formatPrice, formatNumber und formatPercent benutzen die festen Muster", () => {
    expect(formatPrice(12345.67)).toBe(euroAmount(12345.67));
    expect(formatNumber(2118)).toBe(plainNumber(2118));
    expect(formatPercent(0.1234)).toBe(percentAmount(0.1234));
  });

  it("die Platzhalter und das Abzugsminus sind unberührt", () => {
    expect(formatPrice(null)).toBe("–");
    expect(formatPrice(Number.NaN)).toBe("–");
    expect(formatNumber(null)).toBe("0");
    expect(formatDeduction(5.83)).toBe(`−€${NBSP}5,83`);
    expect(formatDeduction(0)).toBe(`€${NBSP}0,00`);
  });

  it("und in format.ts wird keine Zahl mehr von Intl formatiert", () => {
    const source = read("src/lib/format.ts");
    /* Ohne Kommentare: der Kopf der Datei NENNT `Intl.NumberFormat`, um zu
       erklären, was dort stand und warum es weg ist. */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("Intl.NumberFormat");
    /* Die Datumsformatierer bleiben — und sollen bleiben. */
    expect(source).toContain("new Intl.DateTimeFormat(LOCALE");
  });
});

describe("die Klasse des Fehlers, nicht nur die eine Stelle", () => {
  const FILES = [
    "src/lib/i18n/de.ts",
    "src/components/business/orderbook-ledger.tsx",
    "src/components/business/sales-ledger.tsx",
    "src/components/business/purchase-details.tsx",
    "src/components/business/new-purchase.tsx",
    "src/app/(business)/business/orderbuch/[id]/page.tsx",
  ];

  it("keine Zahl im Orderbuch geht mehr durch toLocaleString", () => {
    /*
     * `toLocaleString` auf einer ZAHL ist der Fehler. Auf einem `Date` ist es
     * eine andere Sache — dieselbe Familie, aber ein eigener Befund, der
     * gemeldet und nicht nebenbei geändert wurde.
     */
    for (const file of FILES) {
      const source = read(file);
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const line of code.split("\n")) {
        if (!line.includes("toLocaleString")) continue;
        expect(line, `${file}: ${line.trim()}`).toMatch(/new Date\(|at\.toLocaleString/);
      }
    }
  });

  it("und die Zähltexte formatieren über das feste Muster", () => {
    const de = read("src/lib/i18n/de.ts");
    expect(de).toContain('import { plainNumber, rangedNumber } from "@/lib/format-number";');
    expect(de).toContain("plainNumber(items)");
  });
});
