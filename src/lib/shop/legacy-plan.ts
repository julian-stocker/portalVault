/**
 * What the legacy opening balance would do — decided before anything is written.
 *
 * Pure: no database, no file system, no legacy data. The tool
 * (`tools/import-legacy-inventory.mts`) reads the workbook and the current
 * stock, hands both to `buildPlan`, and prints or applies the result. That
 * split exists so the rules below can be tested against constructed states
 * instead of against a production database that must not be used as a
 * fixture (ADR-0044).
 *
 * THE ONE QUESTION THIS FILE ANSWERS, PER POSITION
 *
 * The import is an **opening balance**: the first fact in a ledger. So the
 * only thing that decides whether a position may receive one is what its
 * ledger already says.
 *
 *   the position does not exist            → import
 *   it exists and has an initial_import    → already done, skip
 *   it exists and has none                 → CONFLICT, a human decides
 *
 * The third case is the important one and the reason this file exists. A
 * position exists only because somebody booked a movement against it, so
 * "exists without an opening balance" means real stock was managed here by
 * hand. Adding the legacy number on top would silently double it, and no
 * error would be raised — the stock would simply be wrong. It is reported
 * and left alone.
 *
 * Detection is by the **journal**, never by the stock level. A position back
 * at zero has still been opened, and re-opening it would be a second opening
 * balance for the same stock.
 */
// A relative path with its extension, not the `@/` alias: this module is
// imported by `tools/import-legacy-inventory.mts`, which Node runs directly
// and which knows nothing about the bundler's path mapping. The same reason
// `tools/import-catalog.mts` reaches into `src/` this way.
import { isCollectibleCategory } from "../catalog/collectible.ts";

/**
 * Everything the import books is booked as this.
 *
 * The workbook has no packaging column, flag or relation; the one packaging
 * distinction the legacy data makes is a SKY-ID of its own. A stated V1
 * assumption rather than invented precision (ADR-0044).
 */
export const IMPORT_CONDITION = "loose";

/**
 * The retained audit fixtures, which no import may ever touch.
 *
 * They are inactive and invisible, so the catalog rules already exclude them;
 * naming them makes the report say so rather than leaving it to be inferred
 * from a category check.
 */
export const FIXTURES: ReadonlySet<string> = new Set(["SKY-9998", "SKY-9994"]);

/** One article row of a series sheet, reduced to what the import may use. */
export type LegacyStock = {
  skyId: string;
  /** For the report only. Never written to the database. */
  name: string;
  sheet: string;
  row: number;
  /** Column F: business stock on hand. */
  available: number;
};

export type CatalogEntry = { isActive: boolean; categoryName: string };

/**
 * What the ledger already says about one `sky_id + condition`.
 *
 * `exists` and `movements` come from `shop_inventory` and
 * `inventory_movements`. A position with no state at all is simply absent
 * from the map.
 */
export type PositionState = {
  /** There is a row in `shop_inventory` for this position. */
  exists: boolean;
  /** Movements recorded against it, `initial_import` included. */
  movements: number;
  /** The delta of its `initial_import`, or null when it has none. */
  openingBalance: number | null;
};

/** The identity of a stock position, an offer and a cart line alike. */
export function positionKey(skyId: string, condition: string): string {
  return `${skyId}/${condition}`;
}

/** Why a row with stock is not imported at all. */
export type SkipReason = "fixture" | "not-in-catalog" | "software" | "inactive";

export const SKIP_LABELS: Readonly<Record<SkipReason, string>> = {
  fixture: "retained audit fixture, never imported",
  "not-in-catalog": "no catalog entry for this SKY-ID",
  software: "console software, outside the collector surface (ADR-0029)",
  inactive: "not active in the catalog",
};

export type PlannedMovement = {
  skyId: string;
  condition: string;
  quantity: number;
  sheet: string;
  row: number;
};

export type SkippedRow = LegacyStock & { reason: SkipReason };

/** A position that already carries its opening balance. Nothing to do. */
export type AlreadyImported = {
  skyId: string;
  condition: string;
  /** What the existing `initial_import` booked. */
  openingBalance: number;
  /** What the workbook says today. Informational: stock moves afterwards. */
  legacyQuantity: number;
};

/** A position that exists but was never opened. A human has to look at it. */
export type Conflict = {
  skyId: string;
  name: string;
  condition: string;
  /** How many movements it already carries, all of them manual. */
  movements: number;
  legacyQuantity: number;
};

export type Plan = {
  movements: PlannedMovement[];
  skipped: SkippedRow[];
  already: AlreadyImported[];
  conflicts: Conflict[];
};

export function buildPlan(
  rows: readonly LegacyStock[],
  catalog: ReadonlyMap<string, CatalogEntry>,
  states: ReadonlyMap<string, PositionState>,
): Plan {
  const movements: PlannedMovement[] = [];
  const skipped: SkippedRow[] = [];
  const already: AlreadyImported[] = [];
  const conflicts: Conflict[] = [];

  for (const row of rows) {
    // A row without stock is not a position. Nothing to open a balance for.
    if (row.available === 0) continue;

    if (FIXTURES.has(row.skyId)) {
      skipped.push({ ...row, reason: "fixture" });
      continue;
    }

    const entry = catalog.get(row.skyId);
    if (!entry) {
      skipped.push({ ...row, reason: "not-in-catalog" });
      continue;
    }
    if (!isCollectibleCategory(entry.categoryName)) {
      skipped.push({ ...row, reason: "software" });
      continue;
    }
    if (!entry.isActive) {
      skipped.push({ ...row, reason: "inactive" });
      continue;
    }

    const state = states.get(positionKey(row.skyId, IMPORT_CONDITION));

    // Already opened. Whatever the number says today, this run has nothing to
    // add: every change since the import is a movement somebody booked on
    // purpose, and the workbook is not authoritative any more.
    if (state?.openingBalance != null) {
      already.push({
        skyId: row.skyId,
        condition: IMPORT_CONDITION,
        openingBalance: state.openingBalance,
        legacyQuantity: row.available,
      });
      continue;
    }

    // Exists, but was never opened — so real stock is being managed here by
    // hand. Adding the legacy number would double it silently. Not automated.
    if (state?.exists) {
      conflicts.push({
        skyId: row.skyId,
        name: row.name,
        condition: IMPORT_CONDITION,
        movements: state.movements,
        legacyQuantity: row.available,
      });
      continue;
    }

    movements.push({
      skyId: row.skyId,
      condition: IMPORT_CONDITION,
      quantity: row.available,
      sheet: row.sheet,
      row: row.row,
    });
  }

  return { movements, skipped, already, conflicts };
}

/** Rows with stock, which is what the plan has to account for completely. */
export function stockRows(rows: readonly LegacyStock[]): LegacyStock[] {
  return rows.filter((row) => row.available > 0);
}

/**
 * Every stock row ends up in exactly one bucket.
 *
 * A guard against the plan quietly losing a row — the one failure mode that
 * would not show up as an error but as missing stock.
 */
export function accountsForEveryRow(plan: Plan, rows: readonly LegacyStock[]): boolean {
  const planned =
    plan.movements.length + plan.skipped.length + plan.already.length + plan.conflicts.length;
  return planned === stockRows(rows).length;
}

/** Pieces the plan would book. */
export function plannedPieces(plan: Plan): number {
  return plan.movements.reduce((sum, movement) => sum + movement.quantity, 0);
}
