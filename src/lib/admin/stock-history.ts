/**
 * One timeline out of two sources, and the two counters above it.
 *
 * A stock position has a history in two places and they mean different
 * things (ADR-0102):
 *
 *   `legacy_stock_events`   a RECONSTRUCTION of the 2026 business year from
 *                           the owner's workbook. Nothing here moved stock.
 *   `inventory_movements`   the operative append-only ledger — what SkyIsles
 *                           actually booked.
 *
 * The operator wants one chronological list, not two. So they are merged for
 * display and marked so a reader can tell them apart — but they are never
 * merged into a quantity.
 *
 * NO RUNNING BALANCE, EVER.
 *
 * This module deliberately exposes no "stock after this entry". The
 * reconstruction guarantees the END, not the path: for fifteen figures its
 * intermediate sums go negative, because the legacy data does not support a
 * defensible curve and the owner chose closure over plausibility. A column
 * of running totals would present that gap as a fact. The current stock is
 * `shop_inventory.quantity` and comes from nowhere else.
 */

export type LedgerSource = "legacy" | "operative";

/**
 * What counts as buying and selling, and what deliberately does not.
 *
 * THE ARITHMETIC USING THESE LIVES IN SQL, NOT HERE. Both halves of the
 * counters are aggregated by the database — `seller_legacy_stock_summary()`
 * for the reconstruction, `seller_business_trade_totals()` for the operative
 * ledger — because only the database sees every row. These two sets are the
 * readable statement of the same split, and `stock-card.test.ts` holds the
 * two in step.
 *
 * `return`, `correction`, `writeoff`, `opening_balance` and
 * `legacy_adjustment` are none of the two. A return is not a purchase — the
 * goods came back, nobody bought anything — and a correction is a recount.
 * Counting either would make "Eingekauft" mean "everything that ever
 * increased the number", which is not the question the operator is asking.
 *
 * `initial_import` is excluded for the same reason it is excluded from the
 * reasons an operator may pick: it was the one legacy opening balance, and
 * the reconstruction now says that better.
 */
export const PURCHASE_REASONS: ReadonlySet<string> = new Set(["purchase"]);

/** `sale_skyisles` is history — renamed to `sale` in 0025, never rewritten. */
export const SALE_REASONS: ReadonlySet<string> = new Set([
  "sale",
  "sale_external",
  "sale_skyisles",
]);

/** One legacy event, as `seller_legacy_stock_events()` returns it. */
export type LegacyEvent = {
  occurredAt: string;
  eventType: string;
  quantity: number;
  /** The canonical price at the migration cut. NULL is legitimate. */
  marketPriceSnapshot: number | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  note: string | null;
};

/** One operative movement, as `admin_inventory_movements()` returns it. */
export type OperativeMovement = {
  id: number;
  delta: number;
  reason: string;
  unitCost: number | null;
  note: string | null;
  createdAt: string;
};

/**
 * How many operative rows an opened card shows.
 *
 * A DISPLAY CUT-OFF AND NOTHING ELSE. No lifetime figure may be derived
 * from a list this number truncates — `tradeCounters` takes aggregates for
 * exactly that reason (0086). Raising or lowering it changes what a reader
 * scrolls through and nothing that is counted.
 */
export const HISTORY_LIMIT = 20;

/** Both sources of one card's timeline, fetched together when it opens. */
export type CardHistory = {
  legacy: LegacyEvent[];
  movements: OperativeMovement[];
};

export type LedgerEntry = {
  /** Stable across renders; the two sources cannot collide. */
  key: string;
  source: LedgerSource;
  /** The day, as `YYYY-MM-DD`. The workbook knows no hour. */
  date: string;
  /** `event_type` for a legacy row, `reason` for a movement. */
  kind: string;
  /** Signed units: positive into stock, negative out. */
  quantity: number;
  /**
   * What one unit was worth, when that is recorded.
   *
   * Legacy rows carry `market_price_snapshot`. Operative movements carry NO
   * market price — `inventory_movements` has `unit_cost`, which is a cost
   * basis and a different thing — so this is null for them. Showing today's
   * market price here would be inventing a historical one (ADR-0102).
   */
  marketValue: number | null;
  note: string | null;
  /**
   * Where a reconstructed row came from, e.g. `Order 2026!1635`.
   *
   * The audit anchor: a legacy row is checkable against the workbook only if
   * it says which line it is. Null for the two technical kinds, which have
   * no source line by construction, and for every operative movement.
   */
  sourceRef: string | null;
};

/** Sortable instant. A legacy date is placed at the start of its day. */
function instant(entry: { source: LedgerSource; date: string; raw: string }): number {
  return entry.source === "legacy"
    ? Date.parse(`${entry.date}T00:00:00Z`)
    : Date.parse(entry.raw);
}

/** `2026-03-23T14:05:00Z` → `2026-03-23`. A legacy date passes through. */
export function dayOf(value: string): string {
  return value.slice(0, 10);
}

/**
 * Both sources as one list, oldest first.
 *
 * Oldest first because that is how a ledger reads and how the card scrolls:
 * the newest entry sits at the bottom, where the view is parked on open.
 *
 * Ties on the same day resolve legacy-before-operative. A reconstructed
 * event describes something that happened before SkyIsles booked anything,
 * so on the one day both can occur — the migration cut — the reconstruction
 * belongs above.
 */
export function mergeHistory(
  legacy: readonly LegacyEvent[],
  movements: readonly OperativeMovement[],
): LedgerEntry[] {
  const entries: (LedgerEntry & { at: number; tie: number })[] = [];

  for (const [index, event] of legacy.entries()) {
    const date = dayOf(event.occurredAt);
    entries.push({
      key: `legacy:${event.sourceSheet ?? "-"}:${event.sourceRow ?? "-"}:${event.eventType}:${index}`,
      source: "legacy",
      date,
      kind: event.eventType,
      quantity: event.quantity,
      marketValue: event.marketPriceSnapshot,
      note: event.note,
      sourceRef:
        event.sourceSheet !== null && event.sourceRow !== null
          ? `${event.sourceSheet}!${event.sourceRow}`
          : null,
      at: instant({ source: "legacy", date, raw: event.occurredAt }),
      tie: index,
    });
  }

  for (const movement of movements) {
    const date = dayOf(movement.createdAt);
    entries.push({
      key: `movement:${movement.id}`,
      source: "operative",
      date,
      kind: movement.reason,
      quantity: movement.delta,
      marketValue: null,
      note: movement.note,
      sourceRef: null,
      at: instant({ source: "operative", date, raw: movement.createdAt }),
      tie: movement.id,
    });
  }

  entries.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    if (a.source !== b.source) return a.source === "legacy" ? -1 : 1;
    return a.tie - b.tie;
  });

  // The sort keys are internal; what leaves this function is the entry.
  return entries.map((entry) => ({
    key: entry.key,
    source: entry.source,
    date: entry.date,
    kind: entry.kind,
    quantity: entry.quantity,
    marketValue: entry.marketValue,
    note: entry.note,
    sourceRef: entry.sourceRef,
  }));
}

/**
 * Documented purchases and sales of one position, already aggregated.
 *
 * Two of these exist per position and they come from the same shape: the
 * reconstructed half from `seller_legacy_stock_summary()` (0079), the
 * operative half from `seller_business_trade_totals()` (0086). BOTH ARE
 * COMPLETE — neither is paginated, neither is capped.
 */
export type TradeTotals = {
  purchasedUnits: number;
  soldUnits: number;
};

/** The reconstructed half. Kept as its own name because the card says so. */
export type LegacyTotals = TradeTotals;

export type TradeCounters = {
  /** Documented business purchases from 2026-01-01, plus real ones since. */
  purchased: number;
  /** Documented business sales from 2026-01-01, plus real ones since. */
  sold: number;
};

/**
 * `Eingekauft` and `Verkauft` — documented trade, and nothing else.
 *
 * TWO COMPLETE AGGREGATES, ADDED. Nothing else. Neither half counts an
 * opening balance, a legacy adjustment, a correction or a return.
 *
 * THE TIMELINE IS NOT AN INPUT HERE, AND MUST NEVER BECOME ONE.
 *
 * It used to be: the operative half was summed from the movement list the
 * card happened to hold, and that list is capped — `p_limit`, hard-limited
 * to 500 by the database. A position past that would have undercounted its
 * own lifetime, silently, with nothing on screen to suggest it. A figure
 * about the whole life of a position cannot be derived from a window onto
 * it, however wide the window is made. `seller_business_trade_totals()`
 * (0086) aggregates without a limit, and this function only adds.
 */
export function tradeCounters(
  legacy: TradeTotals | undefined,
  operative: TradeTotals | undefined,
): TradeCounters {
  return {
    purchased: (legacy?.purchasedUnits ?? 0) + (operative?.purchasedUnits ?? 0),
    sold: (legacy?.soldUnits ?? 0) + (operative?.soldUnits ?? 0),
  };
}

/**
 * How far the stepper may be pulled down.
 *
 * `reserved` is the floor, not zero: stock promised to a checkout may not be
 * corrected away. The database refuses it too, in the WHERE clause of
 * `apply_inventory_movement()`, and that refusal is the one that counts —
 * this only keeps the button from asking.
 */
export function draftFloor(reserved: number): number {
  return Math.max(0, reserved);
}

/** What a draft would book. Zero means: nothing to write. */
export function draftDelta(draft: number, saved: number): number {
  return draft - saved;
}
