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
import type { Character, Element } from "@/lib/catalog/character";
import { asElement } from "@/lib/catalog/element";
import { collectibleOnly, isCollectibleCategory } from "@/lib/catalog/collectible";
import { isCatalogGroup, type CatalogGroup } from "@/lib/catalog/group";
import { buildSearchIndex } from "@/lib/catalog/search";
import { sortFigures } from "@/lib/catalog/sort";
import {
  displayNameFor,
  parseVariant,
  searchFormsFor,
  sortPartsFor,
} from "@/lib/catalog/variant";
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
  catalog_visible: boolean;
  display_name_override: string | null;
  character_id: number | null;
};

// One string literal, not a concatenation: PostgREST's typing reads the
// select list at the type level, and a computed string loses the row type.
const FIGURE_COLUMNS =
  "sky_id, name, slug, series_code, category_id, market_price, image_file, is_active, character_id, catalog_visible, display_name_override";

type Lookups = {
  series: Map<string, { label: string; position: number }>;
  categories: Map<number, { position: number; name: string; catalogGroup: CatalogGroup | null }>;
};

async function loadLookups(): Promise<Lookups> {
  const supabase = await createClient();
  const [seriesResult, categoryResult] = await Promise.all([
    supabase.from("series").select("code, label, position"),
    supabase.from("categories").select("id, position, name, catalog_group"),
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
        {
          position: row.position as number,
          name: row.name as string,
          // A value the CHECK constraint already restricts; the guard keeps a
          // future value the app does not know yet out of the type.
          catalogGroup: isCatalogGroup(row.catalog_group) ? row.catalog_group : null,
        },
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
    categoryId: row.category_id,
    catalogGroup: lookups.categories.get(row.category_id)?.catalogGroup ?? null,
    // Filled in by withVariants() once the series context is known — unless
    // an administrator has chosen the public name, which wins over the
    // derivation (ADR-0039).
    displayName: row.display_name_override ?? row.name,
    sortBaseName: row.display_name_override ?? row.name,
    sortVariantLabel: null,
    // Both spellings, always: a search for the imported name has to keep
    // working after the public name was changed.
    searchIndex: buildSearchIndex(
      row.display_name_override === null ? [row.name] : [row.display_name_override, row.name],
    ),
    marketPrice: row.market_price === null ? null : Number(row.market_price),
    imageFile: row.image_file,
    isActive: row.is_active,
    catalogVisible: row.catalog_visible,
    canonicalName: row.name,
    displayNameOverride: row.display_name_override,
    characterId: row.character_id,
    // Filled in by withCharacterElement() once the character index is known.
    element: null,
  };
}

/**
 * Index of collectible names per series — the lookup the variant rule needs
 * to tell a variant from a name that merely starts with the same word.
 */
export function buildNameIndex(figures: readonly CatalogFigure[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const figure of figures) {
    let names = index.get(figure.seriesCode);
    if (!names) {
      names = new Set();
      index.set(figure.seriesCode, names);
    }
    names.add(figure.name);
  }
  return index;
}

/** Derives display name, sort parts and search index (ADR-0030). */
export function withVariants(
  figures: readonly CatalogFigure[],
  nameIndex: ReadonlyMap<string, ReadonlySet<string>>,
): CatalogFigure[] {
  return figures.map((figure) => {
    // An administrator's choice wins over the derivation (ADR-0039). The
    // canonical name still reaches the search index — toFigure put both
    // spellings there — but nothing is inferred from it any more: the public
    // name has been decided.
    if (figure.displayNameOverride !== null) return figure;

    const namesInSeries = nameIndex.get(figure.seriesCode) ?? new Set<string>();
    const variant = parseVariant(figure.name, namesInSeries);
    const { sortBaseName, sortVariantLabel } = sortPartsFor(figure.name, variant);
    return {
      ...figure,
      displayName: displayNameFor(figure.name, variant),
      sortBaseName,
      sortVariantLabel,
      searchIndex: buildSearchIndex(searchFormsFor(figure.name, variant)),
    };
  });
}

/**
 * Adds the curated character name to the search haystack.
 *
 * "Hot Dog" then also finds "Fire Bone Hot Dog", because the two are linked
 * by character_id — not because the names look alike. Nothing fuzzy happens
 * here: only the exact canonical name of the linked character is added, so
 * "Drobot" still never reaches "Mini Drobit" (a different character), and a
 * figure without a character keeps the index it already had.
 */
export function withCharacterSearch(
  figures: readonly CatalogFigure[],
  characterNames: ReadonlyMap<number, string>,
): CatalogFigure[] {
  return figures.map((figure) => {
    if (figure.characterId === null) return figure;
    const name = characterNames.get(figure.characterId);
    if (name === undefined) return figure;
    const extra = buildSearchIndex([name]);
    if (figure.searchIndex.includes(extra)) return figure;
    return { ...figure, searchIndex: `${figure.searchIndex} | ${extra}` };
  });
}

/**
 * Attaches the curated element to each linked figure.
 *
 * Separate from the search pass so each stays one job, and so a test can
 * prove the obvious thing: a figure without a character keeps `element: null`
 * no matter what its name looks like.
 */
export function withCharacterElement(
  figures: readonly CatalogFigure[],
  elements: ReadonlyMap<number, Element | null>,
): CatalogFigure[] {
  return figures.map((figure) => {
    if (figure.characterId === null) return figure;
    const element = elements.get(figure.characterId) ?? null;
    return element === figure.element ? figure : { ...figure, element };
  });
}

export type CharacterIndex = Map<number, { canonicalName: string; element: Element | null }>;

/** id -> name and element for every curated character. Nineteen rows today. */
export async function fetchCharacterIndex(): Promise<CharacterIndex> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("characters").select("id, canonical_name, element");
  if (error) throw new Error(`characters: ${error.message}`);
  return new Map(
    (data ?? []).map((row) => [
      row.id as number,
      {
        canonicalName: row.canonical_name as string,
        element: asElement(row.element as string | null),
      },
    ]),
  );
}

/** Convenience views of the index, so callers do not re-map it each time. */
export function characterNames(index: CharacterIndex): Map<number, string> {
  return new Map([...index].map(([id, entry]) => [id, entry.canonicalName]));
}

export function characterElements(index: CharacterIndex): Map<number, Element | null> {
  return new Map([...index].map(([id, entry]) => [id, entry.element]));
}

/**
 * Names of all active collectible figures, grouped by series.
 *
 * Used where the caller does not already hold the whole catalog — a detail
 * page or a collection. One small query rather than loading everything.
 */
export async function fetchNameIndex(): Promise<Map<string, Set<string>>> {
  const supabase = await createClient();
  const [lookups, result] = await Promise.all([
    loadLookups(),
    supabase.from("skylanders").select("name, series_code, category_id").eq("is_active", true).eq("catalog_visible", true),
  ]);
  if (result.error) throw new Error(`name index: ${result.error.message}`);

  const index = new Map<string, Set<string>>();
  for (const row of (result.data ?? []) as { name: string; series_code: string; category_id: number }[]) {
    const category = lookups.categories.get(row.category_id);
    if (!category || !isCollectibleCategory(category.name)) continue;
    let names = index.get(row.series_code);
    if (!names) {
      names = new Set();
      index.set(row.series_code, names);
    }
    names.add(row.name);
  }
  return index;
}

/**
 * All active, collectible figures, in catalog order.
 *
 * Console games stay in the database but never reach the collector catalog
 * (src/lib/catalog/collectible.ts).
 *
 * `includeHidden` is the administrator's view of the **same** catalog, not a
 * second one (ADR-0042). It drops exactly one filter — the editorial
 * `catalog_visible` — so an administrator can find a figure they hid and put
 * it back. Everything else stays: `is_active` still applies, software is
 * still excluded, and the row still has to pass RLS. "Admin mode" means the
 * collector catalog including its hidden entries, never every technical row
 * in `skylanders`.
 */
export async function fetchCatalog(
  options: { includeHidden?: boolean } = {},
): Promise<CatalogFigure[]> {
  const supabase = await createClient();
  let query = supabase.from("skylanders").select(FIGURE_COLUMNS).eq("is_active", true);
  if (!options.includeHidden) query = query.eq("catalog_visible", true);

  const [lookups, result] = await Promise.all([loadLookups(), query]);

  if (result.error) throw new Error(`catalog: ${result.error.message}`);
  const figures = collectibleOnly(
    ((result.data ?? []) as FigureRow[]).map((row) => toFigure(row, lookups)),
  );
  // The catalog already holds every collectible name, so the variant rule
  // needs no extra query here.
  const index = await fetchCharacterIndex();
  const withNames = withVariants(figures, buildNameIndex(figures));
  const withSearch = withCharacterSearch(withNames, characterNames(index));
  return sortFigures(withCharacterElement(withSearch, characterElements(index)));
}

/** One figure by its slug. Navigation only — the identity is the SKY-ID. */
export async function fetchFigureBySlug(slug: string): Promise<CatalogFigure | null> {
  const supabase = await createClient();
  const [lookups, result] = await Promise.all([
    loadLookups(),
    supabase.from("skylanders").select(FIGURE_COLUMNS).eq("slug", slug).maybeSingle(),
  ]);

  if (result.error) throw new Error(`figure: ${result.error.message}`);
  if (!result.data) return null;

  const figure = toFigure(result.data as FigureRow, lookups);
  const nameIndex = await fetchNameIndex();
  return withVariants([figure], nameIndex)[0];
}

type CharacterRow = {
  id: number;
  canonical_name: string;
  element: string | null;
  species: string | null;
  role_type: string | null;
  short_description: string | null;
  source_url: string | null;
  source_label: string | null;
  verified_at: string | null;
};

const CHARACTER_COLUMNS =
  "id, canonical_name, element, species, role_type, short_description, source_url, source_label, verified_at";

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    // The database CHECK already restricts these to the known values, so the
    // cast repeats a guarantee rather than assuming one.
    element: row.element as Character["element"],
    roleType: row.role_type as Character["roleType"],
    species: row.species,
    shortDescription: row.short_description,
    sourceUrl: row.source_url,
    sourceLabel: row.source_label,
    verifiedAt: row.verified_at,
  };
}

/** Everything a detail page shows. Character and related figures are optional. */
export type FigureDetail = {
  figure: CatalogFigure;
  character: Character | null;
  /** Other collectibles of the same character. Never contains `figure`. */
  related: CatalogFigure[];
};

/**
 * One figure with its character context.
 *
 * Two extra queries, and only when the figure actually carries a character:
 * 457 of the 561 collectibles have none today, and those pay nothing.
 */
export async function fetchFigureDetail(slug: string): Promise<FigureDetail | null> {
  const figure = await fetchFigureBySlug(slug);
  if (!figure) return null;
  if (figure.characterId === null) return { figure, character: null, related: [] };

  const supabase = await createClient();
  const [lookups, characterResult, siblingResult] = await Promise.all([
    loadLookups(),
    supabase.from("characters").select(CHARACTER_COLUMNS).eq("id", figure.characterId).maybeSingle(),
    supabase.from("skylanders").select(FIGURE_COLUMNS).eq("character_id", figure.characterId),
  ]);

  if (characterResult.error) throw new Error(`character: ${characterResult.error.message}`);
  if (siblingResult.error) throw new Error(`related figures: ${siblingResult.error.message}`);

  // Same collector rule as everywhere else: software never appears, and the
  // figure the page is about is not listed beside itself.
  const siblings = collectibleOnly(
    ((siblingResult.data ?? []) as FigureRow[])
      .map((row) => toFigure(row, lookups))
      .filter((row) => row.skyId !== figure.skyId),
  );
  const nameIndex = await fetchNameIndex();
  const character = characterResult.data ? toCharacter(characterResult.data as CharacterRow) : null;

  // Every figure here shares the one character, so its element applies to
  // all of them — no second query, and still no derivation from a name.
  const elements = new Map([[figure.characterId, character?.element ?? null]]);
  const related = sortFigures(withCharacterElement(withVariants(siblings, nameIndex), elements));

  return {
    figure: withCharacterElement([figure], elements)[0],
    character,
    related,
  };
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
    .eq("is_active", true).eq("catalog_visible", true);

  if (excluded.length > 0) {
    query = query.not("category_id", "in", `(${excluded.join(",")})`);
  }

  const { count, error } = await query;
  if (error) throw new Error(`catalog count: ${error.message}`);
  return count ?? 0;
}

/**
 * How many active collectibles each game holds.
 *
 * The collection page needs exactly this and nothing else from the catalog:
 * the denominators under "12 / 81". It used to load all 561 figures — with
 * names, slugs, prices, images and search indexes — carry them through the
 * variant and character enrichment, and ship them to the browser, only to
 * count them there (V4.3). One column, tallied on the server, answers the
 * same question.
 */
export async function countCollectibleFiguresBySeries(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const lookups = await loadLookups();

  const excluded = [...lookups.categories.entries()]
    .filter(([, category]) => !isCollectibleCategory(category.name))
    .map(([id]) => id);

  let query = supabase.from("skylanders").select("series_code").eq("is_active", true).eq("catalog_visible", true);
  if (excluded.length > 0) {
    query = query.not("category_id", "in", `(${excluded.join(",")})`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`series counts: ${error.message}`);

  const totals: Record<string, number> = {};
  for (const row of data ?? []) {
    const code = row.series_code as string;
    totals[code] = (totals[code] ?? 0) + 1;
  }
  return totals;
}

export type { FigureRow, Lookups };
export { loadLookups, FIGURE_COLUMNS };
