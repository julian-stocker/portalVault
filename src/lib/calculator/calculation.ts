/**
 * Der Figuren-Kalkulator, als reine Rechnung (V1).
 *
 * WOFÜR. Ein Händler sieht auf Kleinanzeigen ein Paket mit dreißig
 * Skylanders und will in zwei Minuten wissen, was es ungefähr wert ist und
 * was er dafür höchstens zahlen will. Dieses Modul ist die Rechnung dahinter
 * — ohne Datenbank, ohne Browser, ohne React. Was hier steht, lässt sich
 * prüfen, ohne etwas zu rendern.
 *
 * GELD IST GANZZAHLIG. Jeder Betrag ist ein **Cent-Integer**. `0.1 + 0.2`
 * ist in Gleitkomma nicht `0.3`, und eine Summe über dreißig Positionen, die
 * `88.07999999` ergibt, ist in einem Werkzeug für Einkaufsentscheidungen
 * keine Kleinigkeit. Gerundet wird genau einmal, beim Eintritt
 * (`euroToCents`) und beim Prozentsatz — sonst nie.
 *
 * WAS ER NICHT IST. Er schreibt nichts. Kein Lagerbestand, keine Bewegung,
 * keine Bestellung, kein Warenkorb, kein Preis im Katalog. Ein manuell
 * gesetzter Einzelwert gilt für diese eine, flüchtige Rechnung und für nichts
 * sonst — er wird nirgends gespeichert und überschreibt keinen
 * `market_price`.
 *
 * DER WERT KOMMT AUS `skylanders.market_price`. Das ist im Projekt der
 * kanonische Marktwert und genau der, gegen den das Orderbuch seit `0053`
 * seinen Einkaufsfaktor rechnet (`purchase_market_value()`,
 * `orderbook_global_factor()` = Ausgaben ÷ bekannter Marktwert). Der
 * Katalog-Aufschlag aus `0094` ist ausdrücklich eine **Anzeigeeinstellung**
 * und wird hier nicht angewendet — dieselbe Zeile, die ihn eingeführt hat,
 * nennt „Buy-in-Faktor unberührt".
 */

/** Eine Position der Kalkulation. Eine Figur/Variante, einmal. */
export type CalculationLine = {
  /** Die Identität. Varianten sind eigene Katalogzeilen mit eigener SKY-ID. */
  skyId: string;
  name: string;
  series: string;
  image: string | null;
  /** Der Vorschlag aus dem Katalog, in Cent. `null` heißt: kein Marktwert bekannt. */
  suggestedCents: number | null;
  /** Was der Händler ansetzt, in Cent. Ohne Vorschlag beginnt es bei 0. */
  unitCents: number;
  quantity: number;
  /** Wahr, sobald der Händler den Wert selbst gesetzt hat. */
  manual: boolean;
};

/** Was der Katalog liefert — dieselbe Form wie `FigureChoice`. */
export type CalculatorChoice = {
  skyId: string;
  name: string;
  series: string;
  marketPrice: number | null;
  image?: string | null;
};

/** Mehr als das ist kein Kleinanzeigen-Paket mehr, sondern ein Tippfehler. */
export const MAX_QUANTITY = 99;

/** Der Ankaufsfaktor bewegt sich zwischen „geschenkt" und „zum Marktwert". */
export const MIN_FACTOR = 0;
export const MAX_FACTOR = 100;

/**
 * Womit gerechnet wird, wenn es keinen historischen Faktor gibt.
 *
 * Ein Rückfall, keine Aussage. Er wird in der Oberfläche ausdrücklich NICHT
 * als „historisch" ausgewiesen — eine erfundene Kennzahl wäre schlimmer als
 * gar keine, weil man sie beim Einkauf gegen sich selbst verwenden würde.
 */
export const FALLBACK_FACTOR = 50;

/**
 * Der historische Ankaufsfaktor in ganzen Prozent, oder `null`.
 *
 * `orderbook_global_factor()` liefert ein Verhältnis — Ausgaben ÷ bekannter
 * Marktwert über alle Einkäufe, auf sechs Stellen gerundet — oder `NULL`,
 * solange kein Einkauf einen bekannten Marktwert hat. **Die Formel steht
 * dort und wird hier nicht nachgebaut**; diese Funktion rechnet ein
 * Verhältnis in Prozent um und sortiert aus, was keine belastbare Zahl ist.
 *
 * `0` gilt als nicht belastbar: ein Schnitt von null Prozent hieße, alles
 * geschenkt bekommen zu haben, und ist in der Praxis ein leerer Datenstand.
 */
export function historicFactorPercent(ratio: unknown): number | null {
  const n = typeof ratio === "number" ? ratio : Number(ratio);
  if (ratio === null || ratio === undefined || ratio === "" || !Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.round(n * 100);
}

/**
 * Womit eine neue Kalkulation beginnt.
 *
 * Der historische Faktor ist **Ausgangspunkt, nicht Vorgabe**: das Ziel des
 * Betriebs ist, den eigenen Schnitt zu halten oder zu senken, also ist er
 * die Zahl, von der aus man ein Angebot beurteilt. Danach ist das Feld frei.
 *
 * Auf 0–100 begrenzt, weil das Eingabefeld es ist. Liegt der historische
 * Schnitt darüber — wer dauerhaft über Marktwert einkauft —, startet die
 * Kalkulation bei 100 %, und die Referenz daneben zeigt weiterhin den
 * echten Wert. Die Referenz wird nicht beschönigt.
 */
export function initialFactor(historic: number | null): number {
  return clampFactor(historic ?? FALLBACK_FACTOR);
}

/**
 * Euro aus der Datenbank zu Cent.
 *
 * `numeric(10,2)` kommt als Zahl oder String an; beides wird hier einmal
 * gerundet und ist danach ganzzahlig. `null` bleibt `null` — „kein Preis
 * bekannt" ist nicht dasselbe wie „kostet nichts" (ADR-0010).
 */
export function euroToCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Cent zurück zu Euro, für die Anzeige über `formatPrice`. */
export function centsToEuro(cents: number): number {
  return cents / 100;
}

/**
 * Ein getippter Betrag zu Cent.
 *
 * Deutsche Dezimaltrennung, wie überall im Betrieb (`parseMoney` im
 * Orderbuch). Leer ist **0**, nicht ungültig: ein Händler, der einen Wert
 * löscht, um ihn neu zu tippen, soll dabei keine Fehlermeldung sehen.
 * `null` heißt: das war keine Zahl, der bisherige Wert bleibt stehen.
 */
export function parseAmountToCents(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return 0;
  if (!/^\d*\.?\d*$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Ein getippter Prozentsatz, auf den erlaubten Bereich begrenzt. */
export function parseFactor(raw: string): number | null {
  const text = raw.trim().replace(",", ".").replace("%", "").trim();
  if (text === "") return 0;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return clampFactor(Math.round(n));
}

export function clampFactor(value: number): number {
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, Math.round(value)));
}

/**
 * Eine Figur aufnehmen.
 *
 * DIESELBE FIGUR ERHÖHT DIE MENGE. Wer „Trigger Happy" zweimal tippt, hat
 * zwei davon in der Kiste und nicht zwei Zeilen im Zettel. Die Identität ist
 * die SKY-ID, und damit bleiben `Free Ranger` und `Legendary Free Ranger`
 * getrennt: es sind zwei Katalogzeilen mit zwei Preisen (ADR-0034).
 *
 * EIN MANUELL GESETZTER WERT BLEIBT STEHEN. Wer 10,00 € angesetzt hat und
 * die Figur ein zweites Mal hinzufügt, bekommt zwei Stück zu 10,00 € — nicht
 * den Katalogvorschlag zurück.
 *
 * Neu ist die Position **vorne**: der Händler sieht, was er gerade getippt
 * hat, ohne zu scrollen.
 */
export function addFigure(
  lines: readonly CalculationLine[],
  choice: CalculatorChoice,
): CalculationLine[] {
  const existing = lines.findIndex((l) => l.skyId === choice.skyId);
  if (existing >= 0) return changeQuantity(lines, choice.skyId, 1);

  const suggested = euroToCents(choice.marketPrice);
  return [
    {
      skyId: choice.skyId,
      name: choice.name,
      series: choice.series,
      image: choice.image ?? null,
      suggestedCents: suggested,
      // Ohne bekannten Marktwert beginnt die Position bei 0 und wartet auf
      // eine Eingabe. Sie fliegt NICHT aus der Kalkulation — eine Figur ohne
      // Preis ist trotzdem in der Kiste.
      unitCents: suggested ?? 0,
      quantity: 1,
      manual: false,
    },
    ...lines,
  ];
}

/** Menge um `delta` verschieben. Unter 1 bleibt 1 — zum Entfernen gibt es `removeLine`. */
export function changeQuantity(
  lines: readonly CalculationLine[],
  skyId: string,
  delta: number,
): CalculationLine[] {
  return lines.map((line) =>
    line.skyId === skyId
      ? { ...line, quantity: clampQuantity(line.quantity + delta) }
      : line,
  );
}

/** Menge direkt setzen, etwa aus einem Zahlenfeld. */
export function setQuantity(
  lines: readonly CalculationLine[],
  skyId: string,
  quantity: number,
): CalculationLine[] {
  return lines.map((line) =>
    line.skyId === skyId ? { ...line, quantity: clampQuantity(quantity) } : line,
  );
}

export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(value)));
}

/**
 * Den Einzelwert von Hand setzen.
 *
 * Ab hier trägt die Position `manual: true` — nicht, weil die Rechnung das
 * bräuchte, sondern damit die Oberfläche sagen kann, dass hier ein Mensch
 * entschieden hat und nicht der Katalog.
 */
export function setUnitCents(
  lines: readonly CalculationLine[],
  skyId: string,
  cents: number,
): CalculationLine[] {
  const value = Math.max(0, Math.round(cents));
  return lines.map((line) =>
    line.skyId === skyId ? { ...line, unitCents: value, manual: true } : line,
  );
}

/** Zurück auf den Katalogvorschlag. Ohne Vorschlag zurück auf 0. */
export function resetUnitCents(
  lines: readonly CalculationLine[],
  skyId: string,
): CalculationLine[] {
  return lines.map((line) =>
    line.skyId === skyId
      ? { ...line, unitCents: line.suggestedCents ?? 0, manual: false }
      : line,
  );
}

export function removeLine(
  lines: readonly CalculationLine[],
  skyId: string,
): CalculationLine[] {
  return lines.filter((line) => line.skyId !== skyId);
}

/** Was diese Position insgesamt wert ist. Ganzzahlig, also exakt. */
export function lineTotalCents(line: CalculationLine): number {
  return line.unitCents * line.quantity;
}

export type CalculationTotals = {
  /** Unterschiedliche Figuren/Varianten. */
  positions: number;
  /** Stück insgesamt. */
  units: number;
  /** Gesamtwert in Cent. */
  totalCents: number;
  /** Positionen, für die der Katalog keinen Wert kennt und keiner gesetzt wurde. */
  withoutValue: number;
};

export function totals(lines: readonly CalculationLine[]): CalculationTotals {
  let units = 0;
  let totalCents = 0;
  let withoutValue = 0;
  for (const line of lines) {
    units += line.quantity;
    totalCents += lineTotalCents(line);
    if (line.unitCents === 0) withoutValue += 1;
  }
  return { positions: lines.length, units, totalCents, withoutValue };
}

/**
 * Die wichtigste Zahl: was das Paket höchstens kosten darf.
 *
 * `Gesamtwert × Faktor`, ganzzahlig gerechnet und einmal kaufmännisch
 * gerundet. Derselbe Zusammenhang, den das Orderbuch rückwärts als
 * Einkaufsfaktor ausweist — Ausgaben ÷ bekannter Marktwert (`0053`, `0059`).
 */
export function maxPurchaseCents(totalCents: number, factorPercent: number): number {
  return Math.round((totalCents * clampFactor(factorPercent)) / 100);
}
