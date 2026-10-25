/**
 * Reading someone's wishlist.
 *
 * Row level security limits every read here to the caller's own rows. There
 * is no filter on `user_id` in the code because there does not need to be
 * one — and relying on the database for it is the point
 * (`docs/SECURITY.md`).
 *
 * BOTH FUNCTIONS READ IN BULK, and that is not an optimisation detail. The
 * catalog draws up to 561 cards; a per-card "is this favourited" would be
 * 561 requests. The owned state has been loaded this way since V1.5, and the
 * wishlist follows it exactly.
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
  withCharacterFamily,
  withVariants,
} from "@/lib/catalog/queries";
import { isCollectible } from "@/lib/catalog/collectible";
import { sortFigures } from "@/lib/catalog/sort";
import type { CatalogFigure } from "@/lib/catalog/types";
import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

type FavoriteRow = {
  sky_id: string;
  skylanders: FigureRow | null;
};

/**
 * The SKY-IDs the signed-in user has marked.
 *
 * Returns an empty set for anonymous visitors, so the catalog renders the
 * same way for everyone and simply shows no hearts filled.
 */
export async function fetchFavoritedSkyIds(): Promise<Set<string>> {
  const supabase = await createClient();
  if (!(await currentUser())) return new Set();

  const { data, error } = await supabase.from("favorites").select("sky_id");
  if (error) throw new Error(`favorites: ${error.message}`);
  return new Set((data ?? []).map((row) => row.sky_id as string));
}

/**
 * The wishlist with the figures attached, in catalog order.
 *
 * INACTIVE FIGURES STAY, and for the same reason the collection keeps them:
 * something somebody marked must not vanish because the catalog import
 * deactivated the row. The figure is then simply not buyable, which is
 * information rather than a reason to forget the wish.
 */
export async function fetchFavorites(): Promise<CatalogFigure[]> {
  const supabase = await createClient();
  if (!(await currentUser())) return [];

  const [lookups, nameIndex, characterIndex, result] = await Promise.all([
    loadLookups(),
    fetchNameIndex(),
    fetchCharacterIndex(),
    // `skylanders(...)` embeds fine: favorites has a direct foreign key to it.
    supabase.from("favorites").select(`sky_id, skylanders(${FIGURE_COLUMNS})`),
  ]);
  if (result.error) throw new Error(`favorites: ${result.error.message}`);

  const figures: CatalogFigure[] = [];
  for (const row of (result.data ?? []) as unknown as FavoriteRow[]) {
    if (!row.skylanders) continue;
    const figure = toFigure(row.skylanders, lookups);
    /*
     * DIE WUNSCHLISTE IST AUSSCHLIESSLICH SAMMELBAR, und die Grenze steht
     * hier an der QUELLE — dieselbe Entscheidung wie in `fetchCollection`
     * (ADR-0128). Was gar nicht erst in die Liste kommt, kann in keinem
     * Filter und in keiner Suche wieder auftauchen.
     *
     * `favorites` hat nur einen Fremdschluessel auf `skylanders`, also
     * KOENNTE dort eine Zubehoerzeile stehen; ueber die Oberflaeche entsteht
     * sie nicht, weil der Katalog kein Zubehoer fuehrt und das Herz nur dort
     * sitzt. Entstuende sie doch, bliebe sie folgenlos.
     */
    if (!isCollectible(figure)) continue;
    figures.push(figure);
  }

  /*
   * Derselbe abgeleitete Anzeigename und dasselbe Element wie im Katalog,
   * aus denselben Funktionen — eine Karte auf der Wunschliste darf nicht
   * anders aussehen als dieselbe Karte im Katalog (ADR-0030).
   */
  const enriched = withCharacterElement(
    withCharacterFamily(withVariants(figures, nameIndex), characterNames(characterIndex)),
    characterElements(characterIndex),
  );

  return sortFigures(enriched);
}
