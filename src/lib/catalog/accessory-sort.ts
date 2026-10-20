/**
 * Die Reihenfolge des Zubehörkatalogs.
 *
 * Vier Ordnungen, und jede beantwortet eine andere Frage:
 *
 *   name       alphabetisch — wer einen Namen sucht und ihn halb kennt
 *   series     nach Serie, innerhalb davon nach Name — die Katalogordnung
 *   platform   nach Plattform — „was habe ich für die Wii?"
 *   kind       Spiele, dann Portale — die Art als erste Ebene
 *
 * JEDE IST STABIL UND VOLLSTÄNDIG. Hinter dem gewählten Schlüssel kommt
 * immer dieselbe Folge: Serie, dann Name, dann SKY-ID. Damit steht eine
 * Zeile bei gleichem Schlüssel immer an derselben Stelle, und zwei Aufrufe
 * mit denselben Daten liefern dieselbe Liste — sonst springt die Ansicht
 * beim Tippen.
 *
 * `localeCompare` mit `de`: „Ü" gehört zu „U", und `numeric` sorgt dafür,
 * dass `0000502` vor `84157790` steht und `Wii 2` nicht vor `Wii 10`.
 */
import { platformOf } from "@/lib/catalog/accessory-facts";
import { ITEM_TYPES, itemTypeOf } from "@/lib/catalog/item-type";
import type { CatalogFigure } from "@/lib/catalog/types";

export const ACCESSORY_SORTS = ["name", "series", "platform", "kind"] as const;
export type AccessorySort = (typeof ACCESSORY_SORTS)[number];

export function isAccessorySort(value: unknown): value is AccessorySort {
  return typeof value === "string" && (ACCESSORY_SORTS as readonly string[]).includes(value);
}

const text = (a: string, b: string) =>
  a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });

/**
 * Der zweite, dritte und vierte Schlüssel — immer dieselben.
 *
 * `seriesPosition` statt des Codes: die Serien stehen in der Reihenfolge
 * ihres Erscheinens, nicht alphabetisch (`Giants` vor `Swap Force`, aber
 * `SA` vor `G`).
 */
function rest(a: CatalogFigure, b: CatalogFigure): number {
  return a.seriesPosition - b.seriesPosition
    || text(a.displayName, b.displayName)
    || text(a.skyId, b.skyId);
}

/**
 * Sortiert, ohne die übergebene Liste zu verändern.
 *
 * Eine Ansicht, die ihre eigene Eingabe umsortiert, ist eine Ansicht, deren
 * Reihenfolge davon abhängt, wie oft sie gerendert wurde.
 */
export function sortAccessories(
  items: readonly CatalogFigure[],
  sort: AccessorySort,
): CatalogFigure[] {
  const kopie = [...items];
  switch (sort) {
    case "name":
      return kopie.sort((a, b) => text(a.displayName, b.displayName) || rest(a, b));
    case "series":
      return kopie.sort(rest);
    case "platform":
      /* Ohne Plattform ans Ende — ein leeres Feld ist keine Gruppe, und
         oben stünde sonst eine Reihe Portale unter der Überschrift
         „Plattform". */
      return kopie.sort((a, b) => {
        const pa = platformOf(a);
        const pb = platformOf(b);
        if (pa === null && pb !== null) return 1;
        if (pa !== null && pb === null) return -1;
        return (pa === null || pb === null ? 0 : text(pa, pb)) || rest(a, b);
      });
    case "kind":
      /* In der Reihenfolge von `ITEM_TYPES`, nicht alphabetisch: `game` vor
         `portal` ist eine Entscheidung, `bundle` vor `game` wäre Zufall. */
      return kopie.sort((a, b) =>
        ITEM_TYPES.indexOf(itemTypeOf(a)) - ITEM_TYPES.indexOf(itemTypeOf(b)) || rest(a, b));
  }
}
