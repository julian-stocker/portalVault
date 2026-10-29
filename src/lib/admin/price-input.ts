/**
 * Was in einem Preisfeld steht, als Zahl (CAT-09).
 *
 * EIGENE DATEI, DAMIT SIE GEPRÜFT WERDEN KANN, ohne eine Oberfläche zu
 * rendern — dieselbe Trennung wie bei `base-figure-rank.ts`.
 *
 * DREI ERGEBNISSE, UND DAS DRITTE IST DER PUNKT:
 *
 *   `null`          das Feld ist leer → „Preis offen" (ADR-0010)
 *   eine Zahl       ein gültiger Betrag, auf zwei Stellen gerundet
 *   "ungueltig"     alles andere — und zwar AUSDRÜCKLICH, nicht als 0
 *
 * Eine 0 wäre der stille Fehler: `Number("")` ist 0, `parseFloat("abc")` ist
 * `NaN`, und beide würden als Preis durchgehen, wenn man sie nur mit
 * `|| null` behandelt. „Preis offen" und „null Euro" sind verschiedene
 * Aussagen, und genau an dieser Stelle dürfen sie nicht verschmelzen.
 */

/** Was `parsePriceInput` zurückgibt, wenn die Eingabe kein Preis ist. */
export type PriceParse = number | null | "ungueltig";

/**
 * Komma oder Punkt, beides.
 *
 * `4,99` und `4.99` sind dasselbe. Einen TAUSENDERPUNKT gibt es bei einem
 * Figurenpreis nicht — der höchste Marktwert im Katalog liegt bei gut 100 € —,
 * und `1.234,56` würde hier als ungültig gelesen statt als 1234,56: eine
 * Zahl mit zwei Trennzeichen ist eine Eingabe, bei der niemand raten soll.
 */
export function parsePriceInput(roh: string): PriceParse {
  const text = roh.trim();
  if (text === "") return null;                 /* „Preis offen" */

  /* Euro-Zeichen und Leerzeichen sind Zierde, kein Inhalt. */
  const ohneZier = text.replace(/[€\s]/g, "");
  if (ohneZier === "") return null;

  /* Genau ein Trennzeichen, und es trennt die Nachkommastellen. */
  const kommas = (ohneZier.match(/,/g) ?? []).length;
  const punkte = (ohneZier.match(/\./g) ?? []).length;
  if (kommas + punkte > 1) return "ungueltig";

  const normiert = ohneZier.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normiert)) return "ungueltig";

  const zahl = Number(normiert);
  if (!Number.isFinite(zahl)) return "ungueltig";
  /* 0 ist kein Preis (ADR-0010) — und ausdrücklich NICHT „Preis offen". */
  if (zahl <= 0) return "ungueltig";
  if (zahl > 99999999.99) return "ungueltig";
  return Math.round(zahl * 100) / 100;
}

/**
 * Der gespeicherte Wert, wie er ins Feld geschrieben wird.
 *
 * Mit Komma, weil die Oberfläche deutsch ist — und ohne Währungszeichen,
 * weil das Feld eine Zahl aufnimmt und kein Satz ist. `null` ergibt ein
 * leeres Feld: „Preis offen" ist die Abwesenheit einer Zahl, nicht eine.
 */
export function formatPriceInput(wert: number | null): string {
  if (wert === null) return "";
  return wert.toFixed(2).replace(".", ",");
}
