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
import { V1_CONDITION } from "@/lib/shop/offer";

/**
 * The vocabulary the database still knows — `loose` and `boxed`.
 *
 * NOT the set an operator may choose from any more; see
 * `OPERATIVE_CONDITION`. This list stays because historical rows exist and
 * have to be *read* and *labelled*: an old order line, an imported workbook
 * row and the eight Staging fixture positions are all genuinely `boxed`, and
 * a screen that printed "Lose" over them would be lying about the past.
 */
export const CONDITIONS = ["loose", "boxed"] as const;
export type Condition = (typeof CONDITIONS)[number];

export function isCondition(value: unknown): value is Condition {
  return typeof value === "string" && (CONDITIONS as readonly string[]).includes(value);
}

/**
 * The one condition SkyIsles trades (0108).
 *
 * SkyIsles handelt ausschließlich mit losen Figuren. OVP is no longer an
 * operative product; whoever wants to trade originally packaged figures uses
 * another platform for that.
 *
 * NOT a fourth copy of the rule: this is `V1_CONDITION` from
 * `lib/shop/offer.ts`, which is itself the client-side twin of
 * `public.v1_sale_condition()` (0028). Since 0108 the database refuses any
 * other condition in `record_inventory_movement()` and `set_shop_listing()`,
 * so a screen that offered one would be offering a refusal.
 * `loose-only-ui.test.ts` holds the three expressions of the rule together.
 */
export const OPERATIVE_CONDITION: Condition = V1_CONDITION;

/**
 * May an operator still act on this position?
 *
 * `false` for a historical `boxed` row: it is shown, it is labelled, its
 * history is readable — but booking, pricing and listing it would be refused
 * by 0108, so those controls are not offered. Reading is never gated.
 */
export function isOperativeCondition(value: unknown): boolean {
  return value === OPERATIVE_CONDITION;
}

/**
 * The reasons an administrator may pick, in the order they are offered.
 *
 * `initial_import` is deliberately absent: it belonged to the one legacy
 * opening balance and is booked by server tooling through
 * `system_record_inventory_movement()`, which no browser can reach. The
 * database still accepts the value — this list is a product decision, not a
 * constraint, and the constraint is where it belongs.
 *
 * `sale_skyisles` is absent for the same reason and a different one: since
 * 0025 a sale booked here is `sale` (ADR-0065). The old value stays a
 * permitted value in the database forever — history can never be renamed —
 * so it still has a label in `de.inventory.reasons`. It just cannot be
 * chosen for a NEW booking.
 */
export const MOVEMENT_REASONS = [
  "purchase",
  "sale_external",
  "sale",
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
