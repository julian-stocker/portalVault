/**
 * The stock's vocabulary and shapes — no database, no server.
 *
 * Split from the queries so a client component can hold a list of conditions
 * or reasons without dragging `lib/supabase/server` into the browser bundle.
 * Everything here is a constant, a type or a guard; the two rules it encodes
 * are product decisions (ADR-0037):
 *
 *   V1 knows exactly two conditions, `loose` and `boxed`
 *   an administrator may pick six reasons — never `initial_import`, which
 *   belonged to the one legacy opening balance and is booked by server
 *   tooling no client role can execute
 */
import type { CatalogFigure } from "@/lib/catalog/types";

/** V1 knows exactly two, and the database CHECK is the vocabulary. */
export const CONDITIONS = ["loose", "boxed"] as const;
export type Condition = (typeof CONDITIONS)[number];

export function isCondition(value: unknown): value is Condition {
  return typeof value === "string" && (CONDITIONS as readonly string[]).includes(value);
}

/**
 * The reasons an administrator may pick, in the order they are offered.
 *
 * `initial_import` is deliberately absent: it belonged to the one legacy
 * opening balance and is booked by server tooling through
 * `system_record_inventory_movement()`, which no browser can reach. The
 * database still accepts the value — this list is a product decision, not a
 * constraint, and the constraint is where it belongs.
 */
export const MOVEMENT_REASONS = [
  "purchase",
  "sale_external",
  "sale_skyisles",
  "return",
  "correction",
  "writeoff",
] as const;

export type MovementReason = (typeof MOVEMENT_REASONS)[number];

export function isMovementReason(value: unknown): value is MovementReason {
  return typeof value === "string" && (MOVEMENT_REASONS as readonly string[]).includes(value);
}

export type InventoryRow = {
  inventoryId: number;
  skyId: string;
  condition: Condition;
  quantity: number;
  reserved: number;
  available: number;
  salePrice: number | null;
  isListed: boolean;
  note: string | null;
  updatedAt: string;
};

/** A position together with the figure it holds. */
export type InventoryPosition = InventoryRow & {
  /** null when the position belongs to something outside the collector catalog. */
  figure: CatalogFigure | null;
};

export type Movement = {
  id: number;
  delta: number;
  reason: string;
  unitCost: number | null;
  currency: string | null;
  note: string | null;
  createdAt: string;
};
