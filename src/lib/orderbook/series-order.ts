/**
 * Spielserie als Sortierschlüssel — eine Stelle für Kalkulator und Orderbuch.
 *
 * DIE REIHENFOLGE STEHT IN DER DATENBANK. `series.position` ist die
 * Erscheinungsreihenfolge (SA 0, G 1, SF 2, T 3, SC 4, I 5; die
 * Sonderserien SMOK und TEST bei 98/99, siehe `catalog/series-nav.ts`). Hier
 * wird nichts davon wiederholt: wer eine siebte Serie anlegt, bekommt sie an
 * der Stelle, die ihre `position` sagt, ohne dass diese Datei es erfährt.
 *
 * Trap Team heißt im Katalog `T`, nicht `TT` — auch das ist ein Grund, die
 * Liste nicht noch einmal von Hand zu schreiben.
 *
 * KEINE SERIE IST KEIN FEHLER. Ein Portal ohne Katalogzuordnung, eine
 * Arbeitsmappenzeile ohne SKY-ID oder ein Code, den die Tabelle (noch) nicht
 * kennt, bekommen `UNKNOWN_SERIES`: sie stehen hinter allen bekannten Serien,
 * und zwar alle zusammen. Weggelassen wird nichts — Sortieren entscheidet nur
 * über die Reihenfolge, nie über die Menge.
 *
 * Rein: keine Datenbank, kein Browser. Die Positionen kommen als Map herein,
 * geladen einmal je Anfrage von `fetchSeriesTable()`.
 */

/** `series_code` → `series.position`. */
export type SeriesPositions = ReadonlyMap<string, number>;

/** Der Rang eines Artikels ohne (bekannte) Serie: hinter allen anderen. */
export const UNKNOWN_SERIES = Number.POSITIVE_INFINITY;

/** Die Position dieser Serie, oder `UNKNOWN_SERIES`. */
export function seriesRank(
  code: string | null | undefined,
  positions: SeriesPositions,
): number {
  if (code === null || code === undefined) return UNKNOWN_SERIES;
  return positions.get(code) ?? UNKNOWN_SERIES;
}

/**
 * Zwei Serienränge vergleichen. `Infinity - Infinity` wäre `NaN` und würde
 * `sort` verwirren, deshalb kein einfaches `a - b`.
 */
export function compareSeriesRank(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Was eine gespeicherte Einkaufsposition zum Sortieren braucht — nicht mehr.
 * Bewusst schmal, damit die Regel ohne `PurchaseItem` testbar ist.
 */
export type SortableItem = {
  id: number;
  position: number;
  name: string;
  seriesCode: string | null;
};

/**
 * Gespeicherter Einkauf, in Serienblöcken (SA → G → SF → T → SC → I).
 *
 *   1. Serie, nach `series.position`.
 *   2. Innerhalb der Serie der Anzeigename (de-AT) — so findet man im
 *      Karton, was auf dem Schirm steht.
 *   3. Bei gleichem Namen die Positionsnummer: drei Wash Bucklers stehen in
 *      der Reihenfolge, in der sie erfasst wurden.
 *
 * OHNE SERIE: ein Block am Ende, und darin NICHT nach Name, sondern nach
 * Positionsnummer. Diese Zeilen sind Rohnamen aus einer Arbeitsmappe oder
 * freie Artikel; ihr Name ist kein Ordnungsmerkmal, die Erfassung schon.
 *
 * NUR DARSTELLUNG. Die Funktion gibt eine neue Liste zurück und ändert kein
 * Element: `id`, `position`, Menge, Preis und Zustand bleiben, was sie waren.
 */
export function sortPurchaseItemsBySeries<T extends SortableItem>(
  items: readonly T[],
  positions: SeriesPositions,
): T[] {
  return [...items].sort((a, b) => {
    const ra = seriesRank(a.seriesCode, positions);
    const rb = seriesRank(b.seriesCode, positions);
    const bySeries = compareSeriesRank(ra, rb);
    if (bySeries !== 0) return bySeries;
    if (ra !== UNKNOWN_SERIES) {
      const byName = a.name.localeCompare(b.name, "de-AT");
      if (byName !== 0) return byName;
    }
    return a.position !== b.position ? a.position - b.position : a.id - b.id;
  });
}
