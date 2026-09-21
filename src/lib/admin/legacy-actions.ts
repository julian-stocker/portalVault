"use server";

/**
 * The one thing the stock card fetches on demand: a position's legacy events.
 *
 * Separate from `actions.ts`, which is all writes. This reads, writes
 * nothing, and revalidates nothing — opening a history must not make the
 * page re-render around the reader.
 *
 * Authorisation is the database's: `seller_legacy_stock_events()` asks
 * `can_operate_active_seller()` itself and refuses anyone else, so this
 * wrapper adds a shape and not a boundary.
 */
import { fetchLegacyEvents } from "@/lib/admin/legacy-stock";
import type { LegacyEvent } from "@/lib/admin/stock-history";

const SKY_ID = /^SKY-\d{4,}$/;
const CONDITIONS = new Set(["loose", "boxed"]);

export async function loadLegacyEvents(
  skyId: string,
  condition: string,
): Promise<LegacyEvent[]> {
  if (!SKY_ID.test(skyId) || !CONDITIONS.has(condition)) return [];
  return fetchLegacyEvents(skyId, condition);
}
