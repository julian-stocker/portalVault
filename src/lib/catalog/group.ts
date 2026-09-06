/**
 * Product groups — what kind of collectible something is.
 *
 * One of three independent dimensions, and the middle one (ADR-0041):
 *
 *   A  series          Trap Team          — navigation, `series_code`
 *   B  product group   Falle, Fahrzeug    — this file, `categories.catalog_group`
 *   C  variant         Legendary, Dark    — not built yet
 *
 * B says **what** an object is. It says nothing about whether it is a special
 * and nothing about what counts towards completion: a vehicle is not a
 * special, a trap is not a special, and a trap master can perfectly well have
 * a Legendary edition. The catalog holds "Legendary Hand of Fate" — an item
 * with a Legendary finish — which is the case that proves the two dimensions
 * cannot be folded together.
 *
 * The classification lives on the category, not on the figure. All 561
 * collectibles were checked on 2026-09-06: each of the twenty categories
 * falls entirely into one group. Twenty rows to curate instead of 561, and no
 * override until real data asks for one.
 */

/** The ten groups. Order is the display order — curated, never alphabetical. */
export const CATALOG_GROUPS = [
  "figure",
  "giant",
  "swapper",
  "trap_master",
  "sensei",
  "vehicle",
  "trap",
  "creation_crystal",
  "mini",
  "item",
] as const;

export type CatalogGroup = (typeof CATALOG_GROUPS)[number];

/**
 * German labels for the sub-navigation.
 *
 * German where the word is ordinary, the product line's own name where that
 * is what collectors call it — "Swapper" and "Trap Masters" are names, not
 * translations.
 */
export const GROUP_LABELS: Readonly<Record<CatalogGroup, string>> = {
  figure: "Figuren",
  giant: "Giants",
  swapper: "Swapper",
  trap_master: "Trap Masters",
  sensei: "Senseis",
  vehicle: "Fahrzeuge",
  trap: "Fallen",
  creation_crystal: "Kreationskristalle",
  mini: "Minis",
  item: "Items",
};

export function isCatalogGroup(value: unknown): value is CatalogGroup {
  return typeof value === "string" && (CATALOG_GROUPS as readonly string[]).includes(value);
}

/** The label, or a dash for a category nobody has classified yet. */
export function groupLabel(group: CatalogGroup | null): string {
  return group === null ? "—" : GROUP_LABELS[group];
}

/**
 * The groups actually present in a set of figures, in display order.
 *
 * What the later sub-navigation is built from: a game without vehicles must
 * not offer an empty "Fahrzeuge" tab, and Imaginators has no plain figures at
 * all. Unclassified rows (`null`) produce no tab — they stay reachable under
 * "Alle", never silently filed under a group they were never given.
 */
export function groupsPresent(
  figures: readonly { catalogGroup: CatalogGroup | null }[],
): CatalogGroup[] {
  const present = new Set(figures.map((figure) => figure.catalogGroup));
  return CATALOG_GROUPS.filter((group) => present.has(group));
}

/** Whether a figure belongs to the chosen group. `null` matches only "Alle". */
export function matchesGroup(
  figure: { catalogGroup: CatalogGroup | null },
  group: CatalogGroup | null,
): boolean {
  return group === null || figure.catalogGroup === group;
}
