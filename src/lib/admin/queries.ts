/**
 * What the administration area reads.
 *
 * Separate from `lib/catalog/queries.ts` on purpose: the public catalog shows
 * what is active and visible, this one shows **everything**, including what
 * an administrator has hidden. Two different questions, two functions — a
 * shared one with a flag would be one `if` away from leaking hidden rows into
 * the public catalog.
 *
 * Nothing here is protected by being in this file. Every caller sits below
 * `(admin)/layout.tsx`, and the rows themselves are readable by anyone —
 * `skylanders` is a public table. What is *not* public is the editorial
 * columns' write path (migration 0004) and `admin_note`, which no public
 * projection selects.
 */
import { isCollectibleCategory } from "@/lib/catalog/collectible";
import { isCatalogGroup, type CatalogGroup } from "@/lib/catalog/group";
import { createClient } from "@/lib/supabase/server";

export type AdminFigure = {
  skyId: string;
  /** The imported name. Read-only everywhere in the admin area. */
  canonicalName: string;
  /** What the public sees: the override, or the imported name. */
  publicName: string;
  displayNameOverride: string | null;
  slug: string;
  seriesCode: string;
  seriesLabel: string;
  categoryId: number;
  categoryName: string;
  catalogGroup: CatalogGroup | null;
  imageFile: string | null;
  /** An administrator's uploaded picture, or null (ADR-0046). */
  imageOverridePath: string | null;
  isActive: boolean;
  catalogVisible: boolean;
};

type Row = {
  sky_id: string;
  name: string;
  slug: string;
  series_code: string;
  category_id: number;
  image_file: string | null;
  image_override_path: string | null;
  is_active: boolean;
  catalog_visible: boolean;
  display_name_override: string | null;
};

/**
 * No `admin_note` here, and that is the point.
 *
 * The note lives in `catalog_editorial`, a table of its own, because
 * `skylanders` is world-readable and a table grant covers every column it
 * will ever have (ADR-0039). Selecting it from here would be selecting it
 * from a public row.
 */
const ADMIN_COLUMNS =
  "sky_id, name, slug, series_code, category_id, image_file, image_override_path, is_active, catalog_visible, display_name_override";

type Lookups = {
  series: Map<string, string>;
  categories: Map<number, { name: string; group: CatalogGroup | null }>;
};

async function lookups(): Promise<Lookups> {
  const supabase = await createClient();
  const [series, categories] = await Promise.all([
    supabase.from("series").select("code, label"),
    supabase.from("categories").select("id, name, catalog_group"),
  ]);
  if (series.error) throw new Error(`series: ${series.error.message}`);
  if (categories.error) throw new Error(`categories: ${categories.error.message}`);

  return {
    series: new Map((series.data ?? []).map((row) => [row.code as string, row.label as string])),
    categories: new Map(
      (categories.data ?? []).map((row) => [
        row.id as number,
        {
          name: row.name as string,
          group: isCatalogGroup(row.catalog_group) ? row.catalog_group : null,
        },
      ]),
    ),
  };
}

function toAdminFigure(row: Row, index: Lookups): AdminFigure {
  const category = index.categories.get(row.category_id);
  return {
    skyId: row.sky_id,
    canonicalName: row.name,
    publicName: row.display_name_override ?? row.name,
    displayNameOverride: row.display_name_override,
    slug: row.slug,
    seriesCode: row.series_code,
    seriesLabel: index.series.get(row.series_code) ?? row.series_code,
    categoryId: row.category_id,
    categoryName: category?.name ?? "",
    catalogGroup: category?.group ?? null,
    imageFile: row.image_file,
    imageOverridePath: row.image_override_path,
    isActive: row.is_active,
    catalogVisible: row.catalog_visible,
  };
}

/**
 * The internal note for one figure, or null.
 *
 * A separate read from a separate table. It succeeds only for an
 * administrator: `catalog_editorial` holds no privilege for `anon` and its
 * policy asks `is_shop_admin()` for everyone else. A non-admin gets an empty
 * result rather than an error, which is the right shape for a page that
 * nobody but an admin can open anyway.
 */
export async function fetchAdminNote(skyId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_editorial")
    .select("admin_note")
    .eq("sky_id", skyId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.admin_note as string | null) ?? null;
}

export type AdminCatalogPage = {
  figures: AdminFigure[];
  /** Rows matching the filter, not rows on this page. */
  total: number;
};

export const ADMIN_PAGE_SIZE = 50;

/**
 * One page of the catalog, unfiltered by visibility.
 *
 * Paginated on the server. The public catalog ships all 561 figures to the
 * browser because it filters and searches there (ADR-0026); an editing table
 * has no such need, and 561 rows of form controls would be a slow page for
 * no gain.
 */
export async function fetchAdminCatalog(options: {
  page?: number;
  series?: string;
  query?: string;
  hiddenOnly?: boolean;
}): Promise<AdminCatalogPage> {
  const supabase = await createClient();
  const index = await lookups();
  const page = Math.max(1, options.page ?? 1);
  const from = (page - 1) * ADMIN_PAGE_SIZE;

  let query = supabase
    .from("skylanders")
    .select(ADMIN_COLUMNS, { count: "exact" })
    .order("sky_id")
    .range(from, from + ADMIN_PAGE_SIZE - 1);

  if (options.series) query = query.eq("series_code", options.series);
  if (options.hiddenOnly) query = query.eq("catalog_visible", false);
  if (options.query && options.query.trim() !== "") {
    const term = options.query.trim();
    // Name or SKY-ID. `%` and `,` would break the filter syntax, so they go.
    const safe = term.replace(/[%,()]/g, "");
    if (safe !== "") {
      query = query.or(
        `name.ilike.%${safe}%,sky_id.ilike.%${safe}%,display_name_override.ilike.%${safe}%`,
      );
    }
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`admin catalog: ${error.message}`);

  return {
    figures: ((data ?? []) as unknown as Row[]).map((row) => toAdminFigure(row, index)),
    total: count ?? 0,
  };
}

/** One figure, whatever its visibility. Null when the SKY-ID is unknown. */
export async function fetchAdminFigure(skyId: string): Promise<AdminFigure | null> {
  const supabase = await createClient();
  const [index, result] = await Promise.all([
    lookups(),
    supabase.from("skylanders").select(ADMIN_COLUMNS).eq("sky_id", skyId).maybeSingle(),
  ]);
  if (result.error) throw new Error(`admin figure: ${result.error.message}`);
  if (!result.data) return null;
  return toAdminFigure(result.data as unknown as Row, index);
}

export type AdminCategory = {
  id: number;
  seriesCode: string;
  seriesLabel: string;
  name: string;
  catalogGroup: CatalogGroup | null;
  /** Active collectibles in this category — the size of the decision. */
  figures: number;
};

/** The twenty categories, with how much each one classifies. */
export async function fetchAdminCategories(): Promise<AdminCategory[]> {
  const supabase = await createClient();
  const index = await lookups();
  const [categories, figures] = await Promise.all([
    supabase.from("categories").select("id, series_code, name, position").order("series_code"),
    supabase.from("skylanders").select("category_id").eq("is_active", true),
  ]);
  if (categories.error) throw new Error(`categories: ${categories.error.message}`);
  if (figures.error) throw new Error(`category counts: ${figures.error.message}`);

  const counts = new Map<number, number>();
  for (const row of figures.data ?? []) {
    const id = row.category_id as number;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (categories.data ?? [])
    // Software has no product group and never will (ADR-0029). Listing the
    // six 'Spiele' rows as "not classified yet" would ask for a decision
    // that has already been made.
    .filter((row) => isCollectibleCategory(row.name as string))
    .map((row) => ({
    id: row.id as number,
    seriesCode: row.series_code as string,
    seriesLabel: index.series.get(row.series_code as string) ?? (row.series_code as string),
    name: row.name as string,
    catalogGroup: index.categories.get(row.id as number)?.group ?? null,
    figures: counts.get(row.id as number) ?? 0,
  }));
}

export type CatalogChange = {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
};

/** The editorial history of one figure, newest first. */
export async function fetchCatalogChanges(skyId: string): Promise<CatalogChange[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_catalog_changes", {
    p_entity: "skylander",
    p_entity_id: skyId,
    p_limit: 20,
  });
  // The journal is a convenience on a detail page, not the page's purpose.
  // A failure here must not take the editor down with it.
  if (error) return [];
  return ((data ?? []) as { field: string; old_value: string | null; new_value: string | null; changed_at: string }[]).map(
    (row) => ({
      field: row.field,
      oldValue: row.old_value,
      newValue: row.new_value,
      changedAt: row.changed_at,
    }),
  );
}
