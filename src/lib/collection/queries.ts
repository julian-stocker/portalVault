/**
 * Reading someone's collection.
 *
 * Row level security limits every read here to the caller's own rows. There
 * is no filter on user_id in the code because there does not need to be one —
 * and relying on the database for it is the point (docs/SECURITY.md).
 */
import {
  FIGURE_COLUMNS,
  fetchNameIndex,
  loadLookups,
  toFigure,
  withVariants,
  type FigureRow,
} from "@/lib/catalog/queries";
import { sortFigures } from "@/lib/catalog/sort";
import type { CollectionEntry } from "@/lib/catalog/types";
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
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Set();

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
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  const [lookups, nameIndex, result] = await Promise.all([
    loadLookups(),
    fetchNameIndex(),
    // skylanders(...) embeds fine: collection_items has a direct foreign key
    // to it. Only the series would need a hop that does not exist.
    supabase.from("collection_items").select(`sky_id, quantity, skylanders(${FIGURE_COLUMNS})`),
  ]);
  if (result.error) throw new Error(`collection: ${result.error.message}`);

  const entries: CollectionEntry[] = [];
  for (const row of (result.data ?? []) as unknown as CollectionRow[]) {
    if (!row.skylanders) continue;
    entries.push({ quantity: row.quantity, figure: toFigure(row.skylanders, lookups) });
  }

  // Same derived display name as the catalog, from the same function.
  const enriched = withVariants(entries.map((e) => e.figure), nameIndex);
  entries.forEach((entry, index) => {
    entry.figure = enriched[index];
  });

  const order = new Map(sortFigures(entries.map((e) => e.figure)).map((f, i) => [f.skyId, i]));
  return entries.sort((a, b) => (order.get(a.figure.skyId) ?? 0) - (order.get(b.figure.skyId) ?? 0));
}
