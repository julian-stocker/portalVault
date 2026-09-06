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

/**
 * Where the price a position is offered for came from (ADR-0045).
 *
 * `manual`    somebody typed it; it is never recomputed
 * `automatic` derived from the market price and the shop-wide percentage
 *
 * Sent by the database rather than derived here from `salePrice === null`.
 * The same information, but stated once instead of re-inferred wherever it
 * is displayed.
 */
export const PRICE_SOURCES = ["manual", "automatic"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export function isPriceSource(value: unknown): value is PriceSource {
  return typeof value === "string" && (PRICE_SOURCES as readonly string[]).includes(value);
}

export type InventoryRow = {
  inventoryId: number;
  skyId: string;
  condition: Condition;
  quantity: number;
  reserved: number;
  available: number;
  /**
   * The MANUAL price override, or null when the automatic price applies.
   *
   * Since ADR-0045 this is not "the price" — `effectivePrice` is. Null here
   * means "no override", not "no price".
   */
  salePrice: number | null;
  /**
   * What the shop actually charges: the override, or market x percentage.
   * Null when there is neither an override nor a market price to derive one
   * from — such a position cannot be listed.
   */
  effectivePrice: number | null;
  priceSource: PriceSource;
  isListed: boolean;
  note: string | null;
  updatedAt: string;
};

/** The shop-wide configuration an administrator can change (ADR-0045). */
export type ShopSettings = {
  /** Percent of the market price. 90 means "ask nine tenths". */
  pricePercentage: number;
  updatedAt: string | null;
};

/** The bounds the database enforces. Stated here so a form can say them. */
export const MIN_PERCENTAGE = 0.01;
export const MAX_PERCENTAGE = 500;

export function isValidPercentage(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_PERCENTAGE && value <= MAX_PERCENTAGE;
}

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
