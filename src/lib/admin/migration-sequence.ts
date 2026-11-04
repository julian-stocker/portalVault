/**
 * The numbered sequence of `supabase/migrations/`.
 *
 * The project wants it gapless — every number from `0001` on, once. The one
 * exception is a number RESERVED by an explicit decision: it may be missing
 * until its migration is written, and nothing else may take it.
 *
 *   0177  the central backup (ADR-0175); the sales reconciliation went on
 *         at 0178 (operator decision of 2026-11-04, phase 4)
 */
export const RESERVED_MIGRATION_NUMBERS: ReadonlySet<number> = new Set([177]);

/** The numbers a gapless sequence up to the highest present one must contain. */
export function expectedMigrationNumbers(present: readonly number[]): number[] {
  const highest = Math.max(0, ...present);
  return Array.from({ length: highest }, (_, i) => i + 1)
    .filter((n) => !RESERVED_MIGRATION_NUMBERS.has(n) || present.includes(n));
}
