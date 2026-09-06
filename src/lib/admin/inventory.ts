/**
 * The shop's stock, for the operator.
 *
 * Reads go through `admin_shop_inventory()` and `admin_inventory_movements()`
 * (migration 0005), writes through `record_inventory_movement()` and
 * `set_shop_listing()` (migration 0003). All four ask
 * `public.is_shop_admin()` inside the database, so this module is convenience
 * rather than a boundary — a request that never touches the UI is refused
 * just the same.
 *
 * Three separations the shop foundation makes, kept here (ADR-0037):
 *
 *   quantity  changes only through a movement, never by assignment
 *   reserved  belongs to a later checkout; nothing here writes it
 *   is_listed is not stock — "listed but sold out" is a real state, and so
 *             is "in stock but deliberately not offered"
 *
 * And one the catalog makes: the shop price is SkyIsles' own,
 * `skylanders.market_price` is a reference. Editing one never moves the other
 * (ADR-0033) — but since ADR-0045 the shop price may be *derived* from the
 * market price by a shop-wide percentage. Derived, not copied: no row holds
 * the automatic value, so a market price change and a percentage change both
 * take effect without writing a single inventory row.
 *
 * The arithmetic itself is in the database (`public.shop_price`), in one
 * place, and this module only reads the result. Money is not computed twice.
 */
import { isCollectible } from "@/lib/catalog/collectible";
import type { CatalogFigure } from "@/lib/catalog/types";
import { createClient } from "@/lib/supabase/server";

import {
  isCondition,
  isPriceSource,
  type InventoryPosition,
  type InventoryRow,
  type Movement,
  type ShopSettings,
} from "@/lib/admin/inventory-model";

export * from "@/lib/admin/inventory-model";

type RawRow = {
  inventory_id: number;
  sky_id: string;
  condition: string;
  quantity: number;
  reserved: number;
  available: number;
  sale_price: string | number | null;
  effective_price: string | number | null;
  price_source: string;
  is_listed: boolean;
  note: string | null;
  updated_at: string;
};

function toRow(raw: RawRow): InventoryRow {
  return {
    inventoryId: raw.inventory_id,
    skyId: raw.sky_id,
    condition: isCondition(raw.condition) ? raw.condition : "loose",
    quantity: raw.quantity,
    reserved: raw.reserved,
    available: raw.available,
    salePrice: raw.sale_price === null ? null : Number(raw.sale_price),
    effectivePrice: raw.effective_price === null ? null : Number(raw.effective_price),
    priceSource: isPriceSource(raw.price_source) ? raw.price_source : "automatic",
    isListed: raw.is_listed,
    note: raw.note,
    updatedAt: raw.updated_at,
  };
}

/**
 * Every stock position, paired with its figure.
 *
 * The catalog is passed in rather than fetched again: the page has it, and
 * the figure it carries is the one the rest of the product shows — display
 * name including an administrator's override, image, series, market price.
 *
 * A position whose SKY-ID is not in that catalog gets `figure: null`. That
 * is how the operational list stays the operational list: the old
 * verification fixture (SKY-9998, inactive, in a software category) and any
 * historical position on something outside the collector scope are separated
 * out rather than deleted — their movements are append-only history
 * (ADR-0037), and history is not tidied away.
 */
export async function fetchInventory(
  catalog: readonly CatalogFigure[],
): Promise<{ positions: InventoryPosition[]; outsideScope: InventoryPosition[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_shop_inventory");
  if (error) throw new Error(`inventory: ${error.message}`);

  const byId = new Map(catalog.filter(isCollectible).map((figure) => [figure.skyId, figure]));
  const positions: InventoryPosition[] = [];
  const outsideScope: InventoryPosition[] = [];

  for (const raw of (data ?? []) as RawRow[]) {
    const row = toRow(raw);
    const figure = byId.get(row.skyId) ?? null;
    (figure ? positions : outsideScope).push({ ...row, figure });
  }

  return { positions, outsideScope };
}

/** The recent movements of one position, newest first. */
export async function fetchMovements(inventoryId: number, limit = 20): Promise<Movement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_inventory_movements", {
    p_inventory_id: inventoryId,
    p_limit: limit,
  });
  if (error) return [];
  return (
    (data ?? []) as {
      id: number;
      delta: number;
      reason: string;
      unit_cost: string | number | null;
      currency: string | null;
      note: string | null;
      created_at: string;
    }[]
  ).map((row) => ({
    id: row.id,
    delta: row.delta,
    reason: row.reason,
    unitCost: row.unit_cost === null ? null : Number(row.unit_cost),
    currency: row.currency,
    note: row.note,
    createdAt: row.created_at,
  }));
}

/**
 * The shop-wide configuration (ADR-0045).
 *
 * One row, read through `admin_shop_settings()` — no client role holds a
 * privilege on `shop_settings`, so this is the only way in. A failure is not
 * swallowed: an administrator changing prices has to know the number in front
 * of them is the real one.
 */
export async function fetchShopSettings(): Promise<ShopSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_shop_settings");
  if (error) throw new Error(`shop settings: ${error.message}`);

  const row = ((data ?? []) as { price_percentage: string | number; updated_at: string }[])[0];
  if (!row) throw new Error("shop settings: no row");

  return { pricePercentage: Number(row.price_percentage), updatedAt: row.updated_at };
}
