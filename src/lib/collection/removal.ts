/**
 * Which figures the page currently shows as removed.
 *
 * Kept out of the component and expressed as a set of SKY-IDs so the state is
 * idempotent by construction: pressing "Entfernen" twice, or an undo racing a
 * slow request, can only ever land on "removed" or "not removed" — never on a
 * count that drifts (ADR-0027).
 */
import type { CollectionEntry } from "@/lib/catalog/types";

export function withRemoval(
  current: ReadonlySet<string>,
  skyId: string,
  removed: boolean,
): ReadonlySet<string> {
  if (current.has(skyId) === removed) return current; // nothing to re-render
  const next = new Set(current);
  if (removed) next.add(skyId);
  else next.delete(skyId);
  return next;
}

/** The figures that still count towards the numbers. */
export function remainingEntries(
  entries: readonly CollectionEntry[],
  removed: ReadonlySet<string>,
): CollectionEntry[] {
  return entries.filter((entry) => !removed.has(entry.figure.skyId));
}
