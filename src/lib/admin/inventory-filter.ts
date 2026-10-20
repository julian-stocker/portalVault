/**
 * Was die Lagerübersicht gerade zeigt — die Regel, ohne React.
 *
 * WARUM SIE HIER STEHT UND NICHT IN DER ANSICHT. Vier Filter, die
 * zusammenwirken, sind genau die Art Logik, die man einzeln nachfahren will:
 * „ein Portal mit Bestand, Serie SF, nicht im Shop" ist eine Frage mit einer
 * Antwort, und sie soll sich ohne Browser und ohne Datenbank stellen lassen.
 * In einem `useMemo` ließe sie sich nur über den Quelltext behaupten.
 *
 * GEFILTERT WIRD IM BROWSER, auf Zeilen, die die Seite ohnehin schon hält —
 * wie im Katalog (ADR-0026), und die Mengen sind hier noch kleiner: ein paar
 * hundert Positionen gegen 600 Katalogzeilen.
 */
import {
  INVENTORY_KINDS, inventoryKind, type InventoryKind, type InventoryPosition,
} from "@/lib/admin/inventory-model";
import { matchesQuery, normalizeForSearch } from "@/lib/catalog/search";

/** Bestand: alles, nur mit, nur ohne. */
export type StockFilter = "all" | "in" | "out";
/** Shopfreigabe: alles, nur freigegeben, nur nicht freigegeben. */
export type ListingFilter = "all" | "listed" | "unlisted";
/** Art: alles, oder genau eine der fünf Arten aus `0135`. */
export type KindFilter = "all" | InventoryKind;

export type InventoryFilters = {
  /** Freitext über Name, Suchindex und SKY-ID. */
  query: string;
  /** Serien-Code, leer heißt „alle". */
  seriesCode: string;
  stock: StockFilter;
  listing: ListingFilter;
  kind: KindFilter;
};

export const NO_FILTERS: InventoryFilters = {
  query: "", seriesCode: "", stock: "all", listing: "all", kind: "all",
};

/**
 * Trifft die Suche diese Position?
 *
 * Über den Suchindex der Katalogzeile — der kennt jede Schreibweise des
 * Namens, die kanonische eingeschlossen — und über die SKY-ID direkt. Eine
 * Position ohne Katalogzeile ist allein über ihre SKY-ID zu finden; sie hat
 * nichts anderes, und ein Name wird für sie nicht erfunden.
 *
 * FÜR ZUBEHÖR IST DAS DER WICHTIGE TEIL. Ein Portal heißt `84709790 (SF)` —
 * der Betreiber tippt die Modellnummer, und `matchesQuery` findet sie im
 * Namen. Ein eigener Zweig dafür ist nicht nötig.
 */
function matchesSearch(position: InventoryPosition, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  const normalized = normalizeForSearch(query);
  if (position.figure !== null && matchesQuery(position.figure, normalized)) return true;
  return position.skyId.toLowerCase().includes(trimmed.toLowerCase());
}

/** Eine Position gegen alle fünf Bedingungen. Alle müssen zutreffen. */
export function matchesFilters(
  position: InventoryPosition,
  filters: InventoryFilters,
): boolean {
  if (filters.seriesCode !== "" && position.figure?.seriesCode !== filters.seriesCode) {
    return false;
  }
  /*
   * DIE ART. `inventoryKind()` antwortet `figure`, wenn nichts anderes
   * bekannt ist — ein Filter auf `figure` zeigt deshalb auch eine Position,
   * deren Katalogzeile den Artikeltyp nicht mitgebracht hat. Das ist richtig
   * so: ohne Auskunft gilt der Normalfall, und keine Position verschwindet
   * aus der Liste, weil eine Spalte fehlte.
   */
  if (filters.kind !== "all" && inventoryKind(position) !== filters.kind) return false;
  if (filters.stock === "in" && position.available <= 0) return false;
  if (filters.stock === "out" && position.available > 0) return false;
  if (filters.listing === "listed" && !position.isListed) return false;
  if (filters.listing === "unlisted" && position.isListed) return false;
  return matchesSearch(position, filters.query);
}

/** Die sichtbaren Positionen, Reihenfolge unberührt. */
export function visiblePositions(
  positions: readonly InventoryPosition[],
  filters: InventoryFilters,
): InventoryPosition[] {
  return positions.filter((position) => matchesFilters(position, filters));
}

/**
 * Welche Arten liegen überhaupt im Lager?
 *
 * Damit der Filter nur anbietet, was es gibt: ein Auswahlfeld mit „Bundle",
 * hinter dem keine einzige Zeile steht, ist eine Sackgasse. Die Reihenfolge
 * ist die von `INVENTORY_KINDS` und nicht die des Zufalls, in dem die
 * Positionen geladen wurden.
 *
 * `figure` wird dabei NICHT mitgezählt, wenn es keine Figurenposition gibt —
 * die Liste beschreibt den Bestand, nicht das Vokabular.
 */
export function kindsInStock(
  positions: readonly InventoryPosition[],
): InventoryKind[] {
  const seen = new Set(positions.map(inventoryKind));
  /* `INVENTORY_KINDS` und keine zweite Liste: die Reihenfolge ist dort
     entschieden, und eine Kopie davon würde beim nächsten Artikeltyp
     auseinanderlaufen. */
  return INVENTORY_KINDS.filter((kind) => seen.has(kind));
}
