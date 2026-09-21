/**
 * Reading the reconstructed legacy history for the stock screens (ADR-0102).
 *
 * Both reads go through the seller-gated functions from `0079`. The table
 * itself has RLS on and no policy, so there is no other way in — and the
 * operator holds the seller role already, which is what the rest of
 * `/business` runs on.
 *
 * WHY THE SUMMARY IS LOADED FOR EVERY CARD AND THE EVENTS ARE NOT.
 *
 * `seller_legacy_stock_summary()` answers the whole page in one call, and
 * every card needs its two counters. The individual events are 2 671 rows
 * across 600 positions and only the opened card shows them, so they are
 * fetched when a history is opened. One call per open, not 264 on load.
 */
import { createClient } from "@/lib/supabase/server";

import { positionKey } from "@/lib/admin/position-key";
import type { LegacyEvent, LegacyTotals } from "@/lib/admin/stock-history";

export { positionKey };

/**
 * Reconstructed purchase and sale counts per position.
 *
 * Empty on failure rather than throwing: the counters are an enrichment of
 * a page that has to work without them. A card that shows no legacy total
 * is wrong by omission; a stock screen that refuses to load is worse.
 */
export async function fetchLegacyTotals(): Promise<Map<string, LegacyTotals>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_legacy_stock_summary");
  if (error) return new Map();

  const totals = new Map<string, LegacyTotals>();
  for (const row of (data ?? []) as {
    sky_id: string;
    condition: string;
    purchased_units: number;
    sold_units: number;
  }[]) {
    totals.set(positionKey(row.sky_id, row.condition), {
      purchasedUnits: Number(row.purchased_units) || 0,
      soldUnits: Number(row.sold_units) || 0,
    });
  }
  return totals;
}

/** The reconstructed events of one position, oldest first. */
export async function fetchLegacyEvents(
  skyId: string,
  condition: string,
): Promise<LegacyEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_legacy_stock_events", {
    p_sky_id: skyId,
    p_condition: condition,
  });
  if (error) return [];

  return ((data ?? []) as {
    occurred_at: string;
    event_type: string;
    quantity: number;
    market_price_snapshot: string | number | null;
    source_sheet: string | null;
    source_row: number | null;
    note: string | null;
  }[]).map((row) => ({
    occurredAt: row.occurred_at,
    eventType: row.event_type,
    quantity: Number(row.quantity),
    // NULL stays null. Two supported figures have no canonical price and
    // inventing one would be worse than admitting none (ADR-0102).
    marketPriceSnapshot:
      row.market_price_snapshot === null || row.market_price_snapshot === undefined
        ? null
        : Number(row.market_price_snapshot),
    sourceSheet: row.source_sheet,
    sourceRow: row.source_row,
    note: row.note,
  }));
}
