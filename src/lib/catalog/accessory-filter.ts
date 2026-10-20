/**
 * Was der Zubehörbereich gerade zeigt — die Regel, ohne React.
 *
 * Dieselbe Bauart wie `@/lib/admin/inventory-filter`: drei Bedingungen, die
 * zusammenwirken, gehören an einen Ort, an dem man sie einzeln nachfahren
 * kann. „Portale der Serie SF, die ‚84‘ im Namen tragen" ist eine Frage mit
 * einer Antwort.
 *
 * WAS HIER NICHT ENTSCHIEDEN WIRD: ob ein Artikel überhaupt gezeigt werden
 * DARF. Das ist `catalog_visible`, und das entscheidet die Abfrage
 * (`fetchAccessoryCatalog`), nicht ein Filter im Browser. Ein Filter, der
 * Sichtbarkeit herstellt, wäre ein Filter, den man abschalten kann.
 */
import { itemTypeOf, type ItemType } from "@/lib/catalog/item-type";
import { matchesQuery, normalizeForSearch } from "@/lib/catalog/search";
import type { CatalogFigure } from "@/lib/catalog/types";

/** Art: alles, oder genau eine der Zubehörarten. */
export type AccessoryTypeFilter = "all" | ItemType;

export type AccessoryFilters = {
  /** Freitext über Name, Rohname und SKY-ID. */
  query: string;
  /** Serien-Code, leer heißt „alle". */
  seriesCode: string;
  type: AccessoryTypeFilter;
};

export const NO_ACCESSORY_FILTERS: AccessoryFilters = {
  query: "", seriesCode: "", type: "all",
};

/**
 * Trifft die Suche diesen Artikel?
 *
 * Über den Suchindex der Katalogzeile — der kennt Anzeigename UND Rohname —
 * und über die SKY-ID. Für Zubehör ist der zweite Teil der wichtige: ein
 * Portal heißt `84709790 (SF)`, und wer es in der Hand hält, tippt die
 * Modellnummer.
 */
function matchesSearch(item: CatalogFigure, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  if (matchesQuery(item, normalizeForSearch(query))) return true;
  return item.skyId.toLowerCase().includes(trimmed.toLowerCase());
}

/** Ein Artikel gegen alle drei Bedingungen. Alle müssen zutreffen. */
export function matchesAccessoryFilters(
  item: CatalogFigure,
  filters: AccessoryFilters,
): boolean {
  if (filters.seriesCode !== "" && item.seriesCode !== filters.seriesCode) return false;
  if (filters.type !== "all" && itemTypeOf(item) !== filters.type) return false;
  return matchesSearch(item, filters.query);
}

/** Die sichtbaren Artikel, Reihenfolge unberührt. */
export function visibleAccessories(
  items: readonly CatalogFigure[],
  filters: AccessoryFilters,
): CatalogFigure[] {
  return items.filter((item) => matchesAccessoryFilters(item, filters));
}

/**
 * Die Serien, die in dieser Menge wirklich vorkommen.
 *
 * Damit die Serienauswahl keine leeren Einträge anbietet. Die Reihenfolge
 * kommt aus der übergebenen Serienliste — also die des Katalogs, nicht die
 * zufällige der Artikel.
 */
export function accessorySeriesPresent<T extends { code: string }>(
  items: readonly CatalogFigure[],
  series: readonly T[],
): T[] {
  const seen = new Set(items.map((item) => item.seriesCode));
  return series.filter((option) => seen.has(option.code));
}
