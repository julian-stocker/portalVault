/**
 * Reading someone's collection.
 *
 * Row level security limits every read here to the caller's own rows. There
 * is no filter on user_id in the code because there does not need to be one —
 * and relying on the database for it is the point (docs/SECURITY.md).
 */
import {
  FIGURE_COLUMNS,
  characterElements,
  characterNames,
  fetchCharacterIndex,
  fetchNameIndex,
  loadLookups,
  toFigure,
  type FigureRow,
  withCharacterElement,
  withBaseFigure,
  withCharacterFamily,
  withVariants,
} from "@/lib/catalog/queries";
import { isCollectible } from "@/lib/catalog/collectible";
import { sortFigures } from "@/lib/catalog/sort";
import type { CollectionEntry } from "@/lib/catalog/types";
import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

type CollectionRow = {
  sky_id: string;
  quantity: number;
  skylanders: FigureRow | null;
};

/**
 * The SKY-IDs the signed-in user owns.
 *
 * Returns an empty set for anonymous visitors, so the catalog renders the
 * same way for everyone and simply shows no collected state.
 */
export async function fetchOwnedSkyIds(): Promise<Set<string>> {
  const supabase = await createClient();
  if (!(await currentUser())) return new Set();

  const { data, error } = await supabase.from("collection_items").select("sky_id");
  if (error) throw new Error(`owned: ${error.message}`);
  return new Set((data ?? []).map((row) => row.sky_id as string));
}

/**
 * The full collection with the figures attached.
 *
 * Inactive figures are deliberately included: something already owned must
 * not vanish from a collection just because it left the catalog.
 */
export async function fetchCollection(): Promise<CollectionEntry[]> {
  const supabase = await createClient();
  if (!(await currentUser())) return [];

  const [lookups, nameIndex, characterIndex, result] = await Promise.all([
    loadLookups(),
    fetchNameIndex(),
    fetchCharacterIndex(),
    // skylanders(...) embeds fine: collection_items has a direct foreign key
    // to it. Only the series would need a hop that does not exist.
    supabase.from("collection_items").select(`sky_id, quantity, skylanders(${FIGURE_COLUMNS})`),
  ]);
  if (result.error) throw new Error(`collection: ${result.error.message}`);

  const entries: CollectionEntry[] = [];
  for (const row of (result.data ?? []) as unknown as CollectionRow[]) {
    if (!row.skylanders) continue;
    const figure = toFigure(row.skylanders, lookups);
    /*
     * DIE SAMMLUNG IST AUSSCHLIESSLICH SAMMELBAR (ADR-0128).
     *
     * Die Grenze steht hier, an der QUELLE, und nicht erst in der Anzeige:
     * was gar nicht erst in die Liste kommt, kann in keiner Statistik, in
     * keinem Filter und in keiner Suche wieder auftauchen. Die Prüfungen in
     * `buildCollectionRows()` und `collectionStats()` bleiben trotzdem
     * stehen — sie sind die zweite und dritte Schicht, und jede trägt für
     * sich allein.
     *
     * `collection_items` hat nur einen Fremdschlüssel auf `skylanders`, also
     * KÖNNTE dort eine Zubehörzeile stehen; über die Oberfläche entsteht sie
     * nicht, weil der Katalog kein Zubehör führt und der Schalter nur dort
     * existiert. Entstünde sie doch, bliebe sie folgenlos: sie wird hier
     * verworfen, bevor irgendetwas sie zählt.
     */
    if (!isCollectible(figure)) continue;
    entries.push({ quantity: row.quantity, figure });
  }

  // Same derived display name and the same element as the catalog, from the
  // same functions — a collection card must not look different.
  /*
   * DIESELBE KETTE IN DERSELBEN REIHENFOLGE wie `fetchCatalog()` — Name,
   * Familie, Basisfigur (CAT-07). Eine Sammlungskarte darf nicht anders
   * aussehen und nicht anders einsortiert sein als dieselbe Figur im
   * Katalog, und eine zweite Reihenfolge wäre genau das.
   *
   * `withBaseFigure()` arbeitet hier auf der SAMMLUNG: steht die Basisfigur
   * nicht darin, weil der Besitzer sie nicht hat, bleibt die Variante wie
   * sie kam. Das ist richtig — sie kann sich nicht neben eine Figur
   * sortieren, die hier nicht vorkommt.
   */
  const enriched = withCharacterElement(
    withBaseFigure(
      withCharacterFamily(
        withVariants(entries.map((e) => e.figure), nameIndex),
        characterNames(characterIndex),
      ),
    ),
    characterElements(characterIndex),
  );
  entries.forEach((entry, index) => {
    entry.figure = enriched[index];
  });

  const order = new Map(sortFigures(entries.map((e) => e.figure)).map((f, i) => [f.skyId, i]));
  return entries.sort((a, b) => (order.get(a.figure.skyId) ?? 0) - (order.get(b.figure.skyId) ?? 0));
}
