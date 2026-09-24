/**
 * WHAT IS STILL OWED, PER POSITION — DERIVED, NEVER STORED.
 *
 * An order line is a snapshot: "Bash, loose, three of them, at this price".
 * That number never changes. What changes is what happened to those three —
 * one cancelled because the shelf lied, one shipped and returned, one still
 * to go out — and every one of those is an EVENT, appended to
 * `order_line_events` and never edited.
 *
 * So `cancelled_quantity` and `returned_quantity` are not columns. They are
 * sums over the ledger, computed here and in one SQL function that agrees
 * with this file. A stored counter beside an append-only ledger is a second
 * truth, and the only question about a second truth is when it will disagree.
 *
 * THE THREE STOCK OUTCOMES, AND WHY THE CLIENT DOES NOT CHOOSE THEM.
 *
 * Cancelling one figure means one of three completely different things for
 * the shelf:
 *
 *   none       the position was never booked out — the payment never
 *              converted its reservation. Nothing left, nothing comes back.
 *   restocked  it was booked out and the piece is really there. It becomes
 *              sellable again: +qty `return`.
 *   shortfall  it was booked out and the piece is NOT there — the stock
 *              figure was wrong before anyone noticed. +qty `return` undoes
 *              the sale, −qty `correction` writes off the phantom, net zero.
 *              Booking only the `return` would put the phantom back.
 *
 * The first of the three is a TECHNICAL fact the server already knows from
 * `order_reservations.movement_id`, and nobody should be asked about it. The
 * operator answers one question — "is the piece physically there?" — and
 * `resolveStockOutcome()` combines that answer with the technical fact. The
 * browser never sends an outcome; it sends a yes or a no.
 */

/** What the operator is asked, and the only thing they are asked. */
export type StockPresence = "present" | "missing";

/** What the server decides from that answer plus the technical state. */
export type StockOutcome = "none" | "restocked" | "shortfall";

/**
 * The rule, in one place.
 *
 * `wasBookedOut` is `order_reservations.movement_id is not null` for this
 * line's position — the canonical proof that stock actually left. Without it
 * there is nothing to give back, whatever anybody says about the shelf, and
 * an answer of "present" must not be allowed to invent a movement.
 */
export function resolveStockOutcome(
  wasBookedOut: boolean,
  presence: StockPresence,
): StockOutcome {
  if (!wasBookedOut) return "none";
  return presence === "present" ? "restocked" : "shortfall";
}

/** How many inventory movements an outcome writes. Net effect in brackets. */
export function movementsFor(outcome: StockOutcome): number {
  // none 0 (0) · restocked 1 (+qty) · shortfall 2 (+qty and −qty, net 0)
  return outcome === "none" ? 0 : outcome === "restocked" ? 1 : 2;
}

/** Does this outcome change the shelf at all, once both movements are in? */
export function changesStock(outcome: StockOutcome): boolean {
  return outcome === "restocked";
}

export type LineEvent = {
  kind: "cancelled" | "returned";
  quantity: number;
};

export type OrderLineQuantities = {
  /** The snapshot. Never changes. */
  ordered: number;
  cancelled: number;
  returned: number;
  /** Ordered minus cancelled — what the parcel may still contain. */
  fulfillable: number;
  /** Of the fulfillable, what has not come back yet. */
  outstanding: number;
  /** The most that may still be cancelled. */
  cancellable: number;
  /** The most that may still be received back. */
  returnable: number;
};

export function lineQuantities(
  ordered: number,
  events: readonly LineEvent[],
): OrderLineQuantities {
  let cancelled = 0;
  let returned = 0;
  for (const event of events) {
    if (event.kind === "cancelled") cancelled += event.quantity;
    else returned += event.quantity;
  }
  const fulfillable = Math.max(0, ordered - cancelled);
  const outstanding = Math.max(0, fulfillable - returned);
  return {
    ordered,
    cancelled,
    returned,
    fulfillable,
    outstanding,
    /* Cancelling and returning draw on the same pool: a piece that came back
       cannot also be cancelled, and one that was cancelled never shipped. */
    cancellable: Math.max(0, ordered - cancelled - returned),
    returnable: outstanding,
  };
}

/**
 * Why this order must not be marked shipped — or `null` when it may be.
 *
 * TWO REASONS, AND A PARTIAL CANCELLATION IS NEITHER. Eight figures with one
 * cancelled is seven figures that still have to reach somebody; blocking the
 * parcel because of the eighth would be the wrong answer to a routine day.
 *
 * `withdrawn` is the customer stepping out of the contract, which is about
 * the whole order and stops everything. `nothing_to_ship` is the case where
 * every line has been cancelled down to zero — there is no parcel to send.
 */
/**
 * Why a quantity was cancelled (0097).
 *
 * THE REASON AND THE SHELF ARE TWO QUESTIONS. This one is the operator's
 * account of WHY; whether the piece is physically there is asked separately
 * and answered separately, and the database derives `stock_outcome` from
 * that answer alone. „Artikel beschädigt" is not a statement about the shelf:
 * a damaged piece may well be lying there, and a cancellation for a buyer's
 * change of mind may still find an empty slot. Coupling them would guess.
 *
 * The values are the ones `order_line_events_reason_code_known` allows, and
 * nothing else reaches the database.
 */
export const CANCEL_REASONS = [
  "buyer_request",
  "item_not_found",
  "item_damaged",
  "stock_incorrect",
  "other",
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export function isCancelReason(value: unknown): value is CancelReason {
  return typeof value === "string" && (CANCEL_REASONS as readonly string[]).includes(value);
}

/** Free text belongs to exactly one of them. */
export const REASON_TAKES_TEXT: CancelReason = "other";


/**
 * What a cancelled quantity is worth, as a SUGGESTION.
 *
 * `line_total` is what the line actually cost, discounts on the line already
 * applied, so a share of it is the honest starting point: cents, integer
 * arithmetic, half away from zero — the same discipline as everywhere else
 * money is divided in this codebase.
 *
 * IT IS A SUGGESTION AND CANNOT BE MORE. An order-level `discount_amount`
 * has no per-line share that any rule in this system defines, and shipping
 * is its own question. The operator decides the amount and it is stored as
 * an allocation; this only saves them the arithmetic in the ordinary case.
 */
export function suggestedRefund(
  line: { lineTotal: number; quantity: number },
  cancelledQuantity: number,
): number {
  if (line.quantity <= 0 || cancelledQuantity <= 0) return 0;
  if (!Number.isFinite(line.lineTotal) || line.lineTotal <= 0) return 0;
  const whole = Math.round(line.lineTotal * 100);
  /* The last piece carries the rounding remainder, so cancelling all of them
     one at a time adds up to the line total exactly. */
  if (cancelledQuantity >= line.quantity) return whole / 100;
  return Math.floor((whole * cancelledQuantity + line.quantity / 2) / line.quantity) / 100;
}

/**
 * What is still owed for the cancelled quantities, position by position.
 *
 * THE BUG THIS EXISTS FOR. The order screen computed two numbers from two
 * different notions of „offen" and then asked the database to reconcile them:
 *
 *   the AMOUNT   = every cancelled position's share MINUS everything already
 *                  repaid    → 5,83 − 4,04 = 1,79
 *   the SPLIT    = every cancelled position's share, full stop
 *                  → Drill Sergeant 4,04 + Eruptor 1,79 = 5,83
 *
 * `allocationsValid()` compared 5,83 with 1,79 and refused, and the operator
 * read „Die Aufteilung ergibt nicht den Erstattungsbetrag." for a repayment
 * that was perfectly ordinary: cancel a position, repay it, cancel a second
 * one, repay that. The first position was being offered a second time.
 *
 * THE FIX IS NOT AN ADJUSTMENT, IT IS ONE SOURCE. Both numbers now come from
 * this list: the amount is its sum, the split is its entries. They cannot
 * disagree, because there is nothing left to disagree with.
 *
 * WHAT IS OWED. Every piece that will not stay with the customer: cancelled
 * before dispatch, or returned after it. One supply, not two — the database
 * derives both limits from `ordered − cancelled − returned`, so a piece
 * cannot be both. Money does not care which of the two happened, and asking
 * would have no answer where a line has one of each.
 *
 * WHAT IS NETTED, AND WITH WHAT. Per position, against the ALLOCATIONS of
 * earlier refunds — not against their totals. A repayment for the shipping
 * says nothing about what a cancelled figure is worth, and subtracting it
 * from a position's share would hide money that is still owed.
 *
 * WHAT IS NOT GUESSED. A refund recorded without any allocation cannot be
 * attributed to a position, and this does not try: see `unattributedRefund()`.
 * The screen says so and the operator decides. A split that adds up by
 * guessing is worse than one the operator had to look at.
 *
 * A CANCELLATION IS STILL NOT A REFUND. Nothing here writes anything; it is
 * arithmetic on what the operator will be shown before they decide.
 */
export type OpenLineRefund = {
  orderLineId: number;
  /** How many of the cancelled pieces have not been repaid yet. */
  quantity: number;
  /** What they come to, in euros. Always > 0 — settled lines are left out. */
  amount: number;
};

export type LineAllocation = {
  type: string;
  orderLineId: number | null;
  quantity: number | null;
  /* `numeric` arrives as a string over PostgREST. */
  amount: unknown;
};

export function openLineRefunds(
  lines: readonly {
    id: number;
    lineTotal: number;
    quantity: number;
    /** Pieces called off before dispatch. */
    cancelled: number;
    /** Pieces that came back after it. Both draw on the same supply. */
    returned?: number;
  }[],
  /** Every allocation of every refund already recorded for this order. */
  allocations: readonly LineAllocation[],
): OpenLineRefund[] {
  /* What each position has already been repaid, in cents and pieces. */
  const paid = new Map<number, { cents: number; quantity: number }>();
  for (const one of allocations) {
    if (one.type !== "line" || one.orderLineId === null) continue;
    const seen = paid.get(one.orderLineId) ?? { cents: 0, quantity: 0 };
    seen.cents += Math.max(0, Math.round(Number(one.amount) * 100));
    seen.quantity += Math.max(0, Math.trunc(Number(one.quantity ?? 0)));
    paid.set(one.orderLineId, seen);
  }

  const open: OpenLineRefund[] = [];
  for (const line of lines) {
    const ordered = Math.max(0, Math.trunc(line.quantity));
    const cancelled = Math.max(0, Math.trunc(line.cancelled));
    const returned = Math.max(0, Math.trunc(line.returned ?? 0));
    /*
     * EIN VORRAT, NICHT ZWEI. Stornieren und Zurücknehmen greifen auf
     * dieselben Stücke zu — `order_line_quantities()` leitet beide Grenzen
     * aus `ordered − cancelled − returned` ab, und beide RPCs weisen mehr
     * ab. `cancelled + returned ≤ ordered` ist damit zugesichert; das
     * `Math.min` ist der Gürtel zum Hosenträger, für eine Projektion, die
     * aus einer Umgebung ohne diese Garantie kommt.
     *
     * Vorher stand hier `cancelled` allein, und eine zurückgenommene Menge
     * bekam nie einen Vorschlag: Ninja Stealth Elf, 1 storniert und
     * erstattet, 1 retour — `owed` blieb bei 0,89 €, davon 0,89 € zugeordnet,
     * also „nichts offen", während ein Stück unbezahlt beim Kunden weg war.
     */
    const settled = Math.min(ordered, cancelled + returned);
    if (settled <= 0) continue;
    /*
     * KUMULATIV GERECHNET, NICHT STÜCK FÜR STÜCK ADDIERT. `suggestedRefund`
     * gibt bei voller Menge den ganzen `line_total` zurück, also trägt das
     * letzte Stück den Rundungsrest: 1,00 € auf drei ergibt 0,33 / 0,34 /
     * 0,33 und in Summe wieder genau 1,00 €. Drei einzeln gerundete Drittel
     * täten das nicht.
     */
    const owed = Math.round(
      suggestedRefund({ lineTotal: line.lineTotal, quantity: line.quantity }, settled) * 100);
    const seen = paid.get(line.id) ?? { cents: 0, quantity: 0 };
    const cents = owed - seen.cents;
    if (cents <= 0) continue;
    open.push({
      orderLineId: line.id,
      /* At least one piece: there is money open for this position, so some
         part of it is unpaid, whatever an allocation without a quantity
         left unsaid. */
      quantity: Math.min(settled, Math.max(1, settled - seen.quantity)),
      amount: cents / 100,
    });
  }
  return open;
}

/**
 * What is still owed for the SHIPPING, as a separate question (0097).
 *
 * WHY IT IS SEPARATE AND WHY IT IS NOT SUGGESTED BY DEFAULT. The Hinsendekosten
 * are owed on a withdrawal (§ 357 Abs. 2 BGB) and normally not owed when one
 * position out of eight is cancelled — the parcel goes out either way. No rule
 * in this system can tell those two apart, so the screen offers the amount and
 * the operator decides. A pre-ticked box would be a legal judgement with a
 * checkmark beside it.
 *
 * WHY IT CANNOT BE PAID TWICE. Netted against the `shipping` allocations that
 * already exist, exactly as a position is netted against its own. A partial
 * shipping refund therefore leaves the remainder open and nothing more.
 *
 * `line`, `goodwill` and `other` allocations are ignored here, just as
 * `shipping` is ignored by `openLineRefunds()`: each kind answers for itself.
 */
export function openShippingRefund(
  shippingAmount: unknown,
  allocations: readonly LineAllocation[],
): number {
  const cents = (value: unknown) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
  };
  const charged = cents(shippingAmount);
  let repaid = 0;
  for (const one of allocations) {
    if (one.type !== "shipping") continue;
    repaid += cents(one.amount);
  }
  return Math.max(0, charged - repaid) / 100;
}

/** The sum of the list above — what the refund field is pre-filled with. */
export function openRefundTotal(open: readonly OpenLineRefund[]): number {
  return open.reduce((sum, one) => sum + Math.round(one.amount * 100), 0) / 100;
}

/**
 * Money repaid that no allocation accounts for.
 *
 * Allocations are optional, and every refund recorded before 0095 has none.
 * Such a repayment cannot be netted against a position without guessing
 * which one, so it is not — it is shown, and the operator lowers the amount
 * if it belonged to a position after all.
 */
export function unattributedRefund(
  refunds: readonly { amount: unknown }[],
  allocations: readonly { amount: unknown }[],
): number {
  const cents = (value: unknown) => Math.max(0, Math.round(Number(value ?? 0) * 100));
  const repaid = refunds.reduce((sum, one) => sum + cents(one.amount), 0);
  const split = allocations.reduce((sum, one) => sum + cents(one.amount), 0);
  return Math.max(0, repaid - split) / 100;
}


/**
 * The allocation kinds a refund may be split into.
 *
 * `line` names a position and a quantity; the other three name an amount and
 * nothing else, because shipping, goodwill and "other" do not belong to any
 * one article. A refund needs no allocation at all — every row recorded
 * before this existed stays valid — but where there is one, the parts must
 * add up to the whole.
 */
export const ALLOCATION_TYPES = ["line", "shipping", "goodwill", "other"] as const;
export type AllocationType = (typeof ALLOCATION_TYPES)[number];

export type RefundAllocation = {
  type: AllocationType;
  orderLineId: number | null;
  quantity: number | null;
  amount: number;
};

/** Do the parts add up, and does each one have the shape its kind requires? */
export function allocationsValid(
  allocations: readonly RefundAllocation[],
  amount: number,
): boolean {
  if (allocations.length === 0) return true;   // no allocation is allowed
  let cents = 0;
  for (const one of allocations) {
    if (!Number.isFinite(one.amount) || one.amount <= 0) return false;
    if ((one.type === "line") !== (one.orderLineId !== null)) return false;
    if (one.quantity !== null && (!Number.isInteger(one.quantity) || one.quantity <= 0)) {
      return false;
    }
    if (one.type !== "line" && one.quantity !== null) return false;
    cents += Math.round(one.amount * 100);
  }
  return cents === Math.round(amount * 100);
}
