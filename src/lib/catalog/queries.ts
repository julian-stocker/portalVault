/**
 * Reading the catalog.
 *
 * Three small queries — figures, series, categories — joined in code rather
 * than through embedded selects.
 *
 * WHY NOT EMBEDDED SELECTS: there is no direct foreign key from `skylanders`
 * to `series`. The composite key points at `categories(id, series_code)`, and
 * the series is valid transitively through that (docs/DATABASE.md, 3.3).
 * PostgREST therefore cannot infer a `series(...)` embed, and asking for one
 * fails with "Could not find a relationship". Six series and thirty
 * categories are trivial to look up separately.
 *
 * The browser never talks to the database — it receives the result (ADR-0026).
 */
import { collectibleOnly, isCollectibleCategory } from "@/lib/catalog/collectible";
import { sortFigures } from "@/lib/catalog/sort";
import type { CatalogFigure, SeriesOption } from "@/lib/catalog/types";
import { createClient } from "@/lib/supabase/server";

type FigureRow = {
  sky_id: string;
  name: string;
  slug: string;
  series_code: string;
  category_id: number;
  market_price: string | number | null;
  image_file: string | null;
  is_active: boolean;
};

const FIGURE_COLUMNS =
  "sky_id, name, slug, series_code, category_id, market_price, image_file, is_active";

type Lookups = {
  series: Map<string, { label: string; position: number }>;
  categories: Map<number, { position: number; name: string }>;
};

async function loadLookups(): Promise<Lookups> {
  const supabase = await createClient();
  const [seriesResult, categoryResult] = await Promise.all([
    supabase.from("series").select("code, label, position"),
    supabase.from("categories").select("id, position, name"),
  ]);

  if (seriesResult.error) throw new Error(`series: ${seriesResult.error.message}`);
  if (categoryResult.error) throw new Error(`categories: ${categoryResult.error.message}`);

  return {
    series: new Map(
      (seriesResult.data ?? []).map((row) => [
        row.code as string,
        { label: row.label as string, position: row.position as number },
      ]),
    ),
    categories: new Map(
      (categoryResult.data ?? []).map((row) => [
        row.id as number,
        { position: row.position as number, name: row.name as string },
      ]),
    ),
  };
}

/**
 * numeric(10,2) arrives as a string over the wire. Parsing it here keeps the
 * "null means unknown, never 0" rule intact (ADR-0010).
 */
export function toFigure(row: FigureRow, lookups: Lookups): CatalogFigure {
  const series = lookups.series.get(row.series_code);
  return {
    skyId: row.sky_id,
    name: row.name,
    slug: row.slug,
    seriesCode: row.series_code,
    seriesLabel: series?.label ?? row.series_code,
    seriesPosition: series?.position ?? 0,
    categoryPosition: lookups.categories.get(row.category_id)?.position ?? 0,
    categoryName: lookups.categories.get(row.category_id)?.name ?? "",
    marketPrice: row.market_price === null ? null : Number(row.market_price),
    imageFile: row.image_file,
    isActive: row.is_active,
  };
}

/**
 * All active, collectible figures, in catalog order.
 *
 * Console games stay in the database but never reach the collector catalog
 * (src/lib/catalog/collectible.ts).
 */
export async function fetchCatalog(): Promise<CatalogFigure[]> {
  const supabase = await createClient();
  const [lookups, result] = await Promise.all([
    loadLookups(),
    supabase.from("skylanders").select(FIGURE_COLUMNS).eq("is_active", true),
  ]);

  if (result.error) throw new Error(`catalog: ${result.error.message}`);
  const figures = ((result.data ?? []) as FigureRow[]).map((row) => toFigure(row, lookups));
  return sortFigures(collectibleOnly(figures));
}

/** One figure by its slug. Navigation only — the identity is the SKY-ID. */
export async function fetchFigureBySlug(slug: string): Promise<CatalogFigure | null> {
  const supabase = await createClient();
  const [lookups, result] = await Promise.all([
    loadLookups(),
    supabase.from("skylanders").select(FIGURE_COLUMNS).eq("slug", slug).maybeSingle(),
  ]);

  if (result.error) throw new Error(`figure: ${result.error.message}`);
  return result.data ? toFigure(result.data as FigureRow, lookups) : null;
}

export async function fetchSeries(): Promise<SeriesOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("series")
    .select("code, label, position")
    .order("position");

  if (error) throw new Error(`series: ${error.message}`);
  return (data ?? []).map((row) => ({
    code: row.code as string,
    label: row.label as string,
    position: row.position as number,
  }));
}

/**
 * How many active, collectible figures the catalog holds — the denominator of
 * the collection progress. Software is excluded, so owning every figure can
 * actually reach 100 %.
 */
export async function countCollectibleFigures(): Promise<number> {
  const supabase = await createClient();
  const lookups = await loadLookups();

  const excluded = [...lookups.categories.entries()]
    .filter(([, category]) => !isCollectibleCategory(category.name))
    .map(([id]) => id);

  let query = supabase
    .from("skylanders")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  if (excluded.length > 0) {
    query = query.not("category_id", "in", `(${excluded.join(",")})`);
  }

  const { count, error } = await query;
  if (error) throw new Error(`catalog count: ${error.message}`);
  return count ?? 0;
}

export type { FigureRow, Lookups };
export { loadLookups, FIGURE_COLUMNS };
