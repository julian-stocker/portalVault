/**
 * Five numbers about the shelf, derived from the page's own rows.
 *
 * NO QUERY OF ITS OWN. `/business/inventory` already loads every position
 * through `admin_shop_inventory()` — quantity, reserved, available, the
 * effective price and the listing flag — and pairs each one with its catalog
 * figure. Everything below is a fold over that array, so the overview costs
 * one pass and not one request; a per-position lookup here would be the same
 * fan-out the page removed when it stopped fetching a movement list per card.
 *
 * THE CANONICAL MARKET PRICE, AND ONLY THAT (0094, ADR-0105). The temporary
 * catalog boost is a display valuation for the catalog and the collection.
 * The Business side values its own shelf at what the database holds, so
 * `Marktwert` here is `quantity × skylanders.market_price` and this module
 * neither imports nor knows about the boost.
 *
 * `shop_inventory` IS THE CURRENT TRUTH. Nothing here replays
 * `inventory_movements`, reads `legacy_stock_events` or consults a workbook
 * figure: those describe how the shelf got here, not what is on it.
 */
import type { InventoryPosition } from "@/lib/admin/inventory-model";

/**
 * THE FIVE, AND WHICH PIECES EACH ONE COUNTS.
 *
 * Reserved stock is the reason this needs saying out loud. A piece held for
 * an open order is STILL ON THE SHELF and still owned, so it counts in
 * `stockPieces` and in `marketValue`. It is NOT free, so it counts in
 * neither `offeredPieces` nor `shopValue`. `reservedPieces` is what makes
 * the difference between those two halves readable instead of a discrepancy
 * somebody has to work out.
 */
export type InventoryOverview = {
  /** Every physical piece on the shelf — `quantity`, summed. */
  stockPieces: number;
  /** Of those, the ones held for an open order — `reserved`, summed. */
  reservedPieces: number;
  /** Pieces a customer could actually buy right now. */
  offeredPieces: number;
  /** `quantity × canonical market price`, summed. Euro. */
  marketValue: number;
  /** `available × shop price`, summed over the offered positions. Euro. */
  shopValue: number;
  /** Positions carrying stock whose figure has no market price (ADR-0010). */
  withoutMarketPrice: number;
};

export const NO_INVENTORY_OVERVIEW: InventoryOverview = {
  stockPieces: 0,
  reservedPieces: 0,
  offeredPieces: 0,
  marketValue: 0,
  shopValue: 0,
  withoutMarketPrice: 0,
};

/**
 * Is this position one the public shop actually offers?
 *
 * MIRRORS `shop_offers()` (0029), clause for clause, against the data this
 * page already holds:
 *
 *   is_listed                     → `isListed`
 *   condition = v1_sale_condition → `condition === "loose"`
 *   shop_price(...) is not null   → `effectivePrice !== null`, the very same
 *                                   function, computed by the database and
 *                                   handed over in the row
 *   is_shop_eligible(sky_id)      → the figure is a collectible one (only
 *                                   those become `positions`), and it is
 *                                   active and catalog-visible
 *
 * Plus the one thing `shop_offers()` reports rather than filters on:
 * `available_quantity > 0`. A listed position with nothing free is in the
 * projection with `available: false` — it is a sold-out listing, and no
 * customer can buy a piece of it, so it contributes no pieces here.
 *
 * The rule is restated rather than queried because the alternative is a
 * second round trip for a number the page can already see. The test holds it
 * against the migration text so the two cannot drift apart.
 */
export function isOffered(position: InventoryPosition): boolean {
  return (
    position.isListed
    && position.condition === "loose"
    && position.effectivePrice !== null
    && position.available > 0
    && position.figure !== null
    && position.figure.isActive
    && position.figure.catalogVisible
  );
}

/**
 * The five figures, in one pass.
 *
 * MONEY IS SUMMED IN CENTS. A euro total built by adding floats drifts —
 * 0.1 + 0.2 — and this one is read beside prices the database rounded. Unit
 * price to integer cents, times the count, summed as integers, divided once
 * at the end. The same discipline `automaticShopPrice()` and
 * `catalogDisplayMarketPrice()` follow.
 *
 * A figure without a market price is left OUT of `marketValue` and counted in
 * `withoutMarketPrice` instead — never valued at 0 €, which is the rule the
 * whole product follows for an unknown price (ADR-0010).
 */
export function inventoryOverview(
  positions: readonly InventoryPosition[],
): InventoryOverview {
  let stockPieces = 0;
  let reservedPieces = 0;
  let offeredPieces = 0;
  let marketCents = 0;
  let shopCents = 0;
  let withoutMarketPrice = 0;

  for (const position of positions) {
    /*
     * The shelf, and the part of it that is spoken for. `quantity` is what
     * is physically there; `reserved` is how much of that an open order
     * holds. `available` — the database's `quantity − reserved` — is what
     * the two shop figures below use.
     */
    stockPieces += position.quantity;
    reservedPieces += position.reserved;

    const marketPrice = position.figure?.marketPrice ?? null;
    if (marketPrice === null) {
      if (position.quantity > 0) withoutMarketPrice += 1;
    } else {
      /* `quantity`, not `available`: a reserved piece is still owned, and
         what it is worth does not depend on somebody's open basket. */
      marketCents += Math.round(marketPrice * 100) * position.quantity;
    }

    if (isOffered(position)) {
      offeredPieces += position.available;
      shopCents += Math.round((position.effectivePrice ?? 0) * 100) * position.available;
    }
  }

  return {
    stockPieces,
    reservedPieces,
    offeredPieces,
    marketValue: marketCents / 100,
    shopValue: shopCents / 100,
    withoutMarketPrice,
  };
}
