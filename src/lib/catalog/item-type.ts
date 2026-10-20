/**
 * WAS EIN KATALOGARTIKEL IST — das Vokabular von `skylanders.item_type`.
 *
 * Die fünf Werte des CHECK aus `0135`, an EINER Stelle. Vier Bereiche fragen
 * danach, und sie müssen dieselbe Antwort bekommen:
 *
 *   der Zubehörbereich im Katalog   welche Arten es zu filtern gibt
 *   die Lagerübersicht              welche Art eine Lagerposition hat
 *   die Artikelsuche im Orderbuch   welches Etikett ein Treffer trägt
 *   die Sammlung                    gar keine — sie sieht nur Figuren
 *
 * ---------------------------------------------------------------------------
 * VIER EIGENSCHAFTEN, DIE NICHT DASSELBE SIND (ADR-0128)
 *
 *   ARTIKELTYP      `item_type` — was das Ding IST. Diese Datei.
 *   SAMMELBARKEIT   `isCollectible()` — gehört es in eine Sammlung?
 *   SICHTBARKEIT    `catalog_visible` — zeigt der öffentliche Katalog es?
 *   SHOPFÄHIGKEIT   `is_shop_eligible()` — darf es verkauft werden?
 *
 * Keine folgt aus einer anderen. Ein Spiel ist sichtbar, aber nicht sammelbar
 * und nicht verkäuflich. Ein Portal ist zusätzlich unsichtbar, bis ein
 * Administrator entscheidet. Eine ausgeblendete Figur ist sammelbar und
 * bleibt es. Wer eine der vier aus einer anderen ableitet, baut genau den
 * Fehler, den `0135` und `0137` verhindern sollen.
 * ---------------------------------------------------------------------------
 */

/**
 * Die fünf Werte, in Anzeigereihenfolge.
 *
 * `figure` zuerst, weil es der Normalfall ist; dann die vier Zubehörarten in
 * der Häufigkeit, in der sie vorkommen. Dieselbe Menge, die der CHECK auf
 * `skylanders.item_type` erlaubt — wächst die eine, wächst die andere.
 */
export const ITEM_TYPES = ["figure", "game", "portal", "bundle", "other"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** Alles außer einer Figur. Das ist die Menge, die „Zubehör" heißt. */
export const ACCESSORY_TYPES = ITEM_TYPES.filter((t) => t !== "figure");

export function isItemType(value: unknown): value is ItemType {
  return typeof value === "string" && (ITEM_TYPES as readonly string[]).includes(value);
}

/**
 * Der Artikeltyp einer Katalogzeile, so weit er bekannt ist.
 *
 * `figure`, WENN NICHTS ANDERES BEKANNT IST. Das ist kein Zögern, sondern
 * dieselbe Regel wie überall in dieser Arbeit: fehlt `item_type` — weil eine
 * Abfrage die Spalte nicht holt oder weil eine Zeile älter ist als `0135` —,
 * dann verhält sich alles wie vorher. „Keine Auskunft" heißt nie „Zubehör",
 * und ein Wert, den diese Fassung nicht kennt, lässt keine Zeile aus einer
 * Figurenliste verschwinden.
 */
export function itemTypeOf(figure: { itemType?: string | null }): ItemType {
  return isItemType(figure.itemType) ? figure.itemType : "figure";
}

/** Ist das Zubehör — also alles außer einer Figur? */
export function isAccessory(figure: { itemType?: string | null }): boolean {
  return itemTypeOf(figure) !== "figure";
}

/**
 * Welche Arten in einer Menge wirklich vorkommen, in Anzeigereihenfolge.
 *
 * Damit eine Filterleiste nur anbietet, was es gibt: ein Knopf „Bundles",
 * hinter dem keine einzige Zeile steht, ist eine Sackgasse. Die Reihenfolge
 * ist die von `ITEM_TYPES` und nicht die, in der die Zeilen geladen wurden.
 */
export function itemTypesPresent(
  items: readonly { itemType?: string | null }[],
): ItemType[] {
  const seen = new Set(items.map(itemTypeOf));
  return ITEM_TYPES.filter((type) => seen.has(type));
}
