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
import { platformOf } from "@/lib/catalog/accessory-facts";
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
  /**
   * Plattform-Etikett, leer heißt „alle".
   *
   * Nur Spiele tragen eine (`platformOf`), also blendet dieser Filter jedes
   * Portal aus, sobald er gesetzt ist — und das ist richtig: wer „PS3"
   * wählt, sucht ein Spiel.
   */
  platform: string;
};

export const NO_ACCESSORY_FILTERS: AccessoryFilters = {
  query: "", seriesCode: "", type: "all", platform: "",
};

/**
 * Trifft die Suche diesen Artikel?
 *
 * Über den Suchindex der Katalogzeile — der kennt Anzeigename UND Rohname —
 * über die SKY-ID, und über die Plattform. Für Zubehör ist die SKY-ID-
 * beziehungsweise Modellsuche die wichtige: ein Portal heisst
 * `84709790 (SF)`, und wer es in der Hand hält, tippt die Modellnummer —
 * die steht im Namen und damit im Suchindex.
 *
 * Die Plattform kommt dazu, weil sie in der Zeile steht und man sucht, was
 * man sieht: „PS4" findet die vier PS4-Spiele, auch wenn der Rohname
 * `Spiel für Sony Playstation 4 PS4` lautet und der Anzeigename anders.
 */
function matchesSearch(item: CatalogFigure, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  if (matchesQuery(item, normalizeForSearch(query))) return true;
  if (item.skyId.toLowerCase().includes(trimmed.toLowerCase())) return true;
  const plattform = platformOf(item);
  return plattform !== null && plattform.toLowerCase().includes(trimmed.toLowerCase());
}

/** Ein Artikel gegen alle drei Bedingungen. Alle müssen zutreffen. */
export function matchesAccessoryFilters(
  item: CatalogFigure,
  filters: AccessoryFilters,
): boolean {
  if (filters.seriesCode !== "" && item.seriesCode !== filters.seriesCode) return false;
  if (filters.type !== "all" && itemTypeOf(item) !== filters.type) return false;
  if (filters.platform !== "" && platformOf(item) !== filters.platform) return false;
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
