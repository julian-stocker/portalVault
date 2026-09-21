"use server";

/**
 * What a stock card fetches when its history is opened — and only then.
 *
 * A position's timeline has two sources and neither belongs on the page
 * load: 2 671 reconstructed events sit across 600 positions, and the
 * operative ledger grows for as long as the shop runs. Both are fetched by
 * the card the operator actually opened, in ONE round trip, because they are
 * shown as one list.
 *
 * WHAT THIS IS NOT FOR. Nothing here feeds `Eingekauft` or `Verkauft`. Those
 * come from two complete aggregates loaded once for the whole page
 * (`seller_legacy_stock_summary()`, `seller_business_trade_totals()`), and
 * the timeline's limit must never touch them — that coupling is exactly what
 * 0086 removed.
 *
 * Separate from `actions.ts`, which is all writes. This reads, writes
 * nothing, and revalidates nothing — opening a history must not make the
 * page re-render around the reader.
 *
 * Authorisation is the database's: both functions ask
 * `can_operate_active_seller()` themselves and refuse anyone else, so this
 * wrapper adds a shape and not a boundary.
 */
import { fetchMovements } from "@/lib/admin/inventory";
import { fetchLegacyEvents } from "@/lib/admin/legacy-stock";
import { HISTORY_LIMIT, type CardHistory } from "@/lib/admin/stock-history";

const SKY_ID = /^SKY-\d{4,}$/;
const CONDITIONS = new Set(["loose", "boxed"]);

/*
 * A "use server" module may export async functions and nothing else, so
 * `HISTORY_LIMIT` and `CardHistory` live in `stock-history.ts` with the rest
 * of the pure logic and are imported here.
 */
export async function loadCardHistory(
  skyId: string,
  condition: string,
  inventoryId: number,
): Promise<CardHistory> {
  if (!SKY_ID.test(skyId) || !CONDITIONS.has(condition)) {
    return { legacy: [], movements: [] };
  }
  if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
    return { legacy: [], movements: [] };
  }

  const [legacy, movements] = await Promise.all([
    fetchLegacyEvents(skyId, condition),
    fetchMovements(inventoryId, HISTORY_LIMIT),
  ]);
  return { legacy, movements };
}
