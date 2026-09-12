/**
 * Shared placeholder geometry.
 *
 * THE DEFECT THIS FILE EXISTS FOR
 *
 * The series tab placeholders were an array of Tailwind width classes, mapped
 * with the width itself as the React key:
 *
 *   ["w-16", "w-36", "w-24", "w-28", "w-28", "w-32"].map((width) => (
 *     <Bar key={width} … />
 *   ))
 *
 * `w-28` appears twice — deliberately, because real series names repeat
 * widths — so every render of the collection's loading state logged
 * `Encountered two children with the same key, 'w-28'`. A presentational
 * value was standing in for an identity it never had.
 *
 * WHY THE ID LOOKS LIKE THIS
 *
 * A placeholder has no business identity: it stands for a series whose name
 * is not known yet. Its position in a fixed, never-reordered, never-filtered
 * list is the only honest identity available — so the id pairs the width with
 * that position and is built ONCE here, not from the render's iteration
 * variable. `key={index}` would have worked and would have hidden what the
 * key actually means.
 *
 * Shared rather than duplicated: the catalog and the collection show the same
 * tab row, and two copies of a fixed list are two chances to drift.
 */
export type SkeletonBar = { id: string; width: string };

const WIDTHS = ["w-16", "w-36", "w-24", "w-28", "w-28", "w-32"] as const;

export const SERIES_BARS: readonly SkeletonBar[] = WIDTHS.map((width, index) => ({
  id: `series-bar-${index}-${width}`,
  width,
}));
