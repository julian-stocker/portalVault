/**
 * What became of one position of a shop order, as the Orderbuch shows it.
 *
 * THE BUG THIS EXISTS FOR. An internal sale shows the ORDER's lines, and the
 * ledger printed one constant for every one of them: `outbooked`, „Verschickt
 * ✓". That was true while the only thing that could happen to a paid line was
 * shipping — commerce books the stock out when the order is paid, so the tick
 * was simply a restatement of "paid". Since 0095 a position can also be
 * cancelled or come back, and the constant went on claiming the parcel had
 * gone. SI-2026-001067 showed „1 storniert" on the order screen and
 * „Verschickt ✓" in the Orderbuch, for the same position, at the same moment.
 *
 * AND THE SECOND HALF OF IT: the same constant claimed the parcel had gone
 * for the two untouched positions of that order too, while the order itself
 * was `unfulfilled`. Booking stock out is not posting a parcel — see
 * `WENT_OUT`.
 *
 * WHERE THE TRUTH COMES FROM. `order_line_events` — append-only — through
 * `order_line_quantities()`, projected into `seller_sale()` by 0096. Nothing
 * is stored twice and nothing is inferred from money: a cancellation is not a
 * refund, a refund is not a cancellation, and neither is read off the other
 * (ADR-0102 addendum).
 *
 * WHY THIS CANNOT BE OVERWRITTEN LATER. `cancelled` and `returned` only ever
 * grow, because the events they are summed from are only ever appended. A
 * position that reads „Storniert" can never read „Verschickt ✓" again — not
 * through a shipment, not through a later edit. The terminality is a property
 * of the data, not of a rule on this screen.
 *
 * WHY A PARTIAL CANCELLATION IS NOT A LINE STATUS. One position can be three
 * and a half things at once — 1 of 3 cancelled, 1 returned, 1 still on its
 * way — and squeezing that into a single word would have to lie about two of
 * them. So the answer is a LIST of parts, and only when one part covers the
 * whole quantity does it collapse into a single terminal state.
 *
 * THE LEGACY LADDER IS UNTOUCHED. `saleItemStatus()` answers for workbook and
 * external sales out of `sale_items`; this answers for commerce lines out of
 * `order_lines`. Two sources, two functions, no shared branch.
 */

export type CommerceLinePartKind = "cancelled" | "returned" | "shipped" | "open";

/**
 * The fulfillment states in which the parcel has actually left (0010).
 *
 * AUSBUCHEN IST NICHT VERSENDEN. Commerce books the stock out the moment the
 * order is paid — the piece leaves the shelf so nobody else can buy it — and
 * that says nothing about whether it has been packed. `unfulfilled` and
 * `preparing` mean it has not. Reading the tick off the payment was the
 * second half of the same bug: SI-2026-001067 was `unfulfilled` and the
 * ledger showed „Verschickt ✓" for two positions nobody had posted.
 */
const WENT_OUT = new Set(["shipped", "completed"]);

export type CommerceLinePart = {
  kind: CommerceLinePartKind;
  quantity: number;
};

export type CommerceLineStatus = {
  /**
   * - `cancelled` / `returned` — one outcome covers the whole position
   * - `mixed` — two or more outcomes share it; read `parts`
   * - `shipped` — the whole position went out with the parcel
   * - `open` — nothing has happened to it and nothing has been posted yet
   */
  kind: "cancelled" | "returned" | "mixed" | "shipped" | "open";
  /** Always adds up to the ordered quantity. Empty parts are left out. */
  parts: CommerceLinePart[];
  /** Is this position finished — nothing of it can still go out? */
  closed: boolean;
};

/** A count from the projection: never negative, never more than was ordered. */
function within(value: unknown, ceiling: number): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.trunc(n), Math.max(0, ceiling));
}

export function commerceLineStatus(
  line: {
    quantity: number;
    cancelled?: number | null;
    returned?: number | null;
  },
  /**
   * `orders.fulfillment_status`, unchanged.
   *
   * IT DECIDES ONLY WHAT IS LEFT. The cancelled and returned quantities come
   * from an append-only ledger and are terminal; no fulfillment state can
   * take them back. Posting a parcel turns the REMAINDER from „offen" into
   * „verschickt" and touches nothing else.
   */
  fulfillmentStatus?: string | null,
): CommerceLineStatus {
  const ordered = Number.isFinite(line.quantity) ? Math.max(0, Math.trunc(line.quantity)) : 0;
  const cancelled = within(line.cancelled, ordered);
  /* Cancelled first: the two cannot claim the same piece, and a cancellation
     happens before dispatch while a return happens after it. */
  const returned = within(line.returned, ordered - cancelled);
  const rest = ordered - cancelled - returned;

  const restKind: CommerceLinePartKind =
    WENT_OUT.has(String(fulfillmentStatus ?? "")) ? "shipped" : "open";

  const parts: CommerceLinePart[] = [];
  if (cancelled > 0) parts.push({ kind: "cancelled", quantity: cancelled });
  if (returned > 0) parts.push({ kind: "returned", quantity: returned });
  if (rest > 0) parts.push({ kind: restKind, quantity: rest });

  const kind: CommerceLineStatus["kind"] =
    cancelled === ordered && ordered > 0 ? "cancelled"
    : returned === ordered && ordered > 0 ? "returned"
    : parts.length > 1 ? "mixed"
    : restKind;

  return { kind, parts, closed: rest === 0 && ordered > 0 };
}

/**
 * The dot beside the row.
 *
 * Nothing new is invented: a cancelled position gets the grey ↩ that a
 * cancelled position already has everywhere else in this ledger, and an
 * untouched one keeps the tick it had before 0096.
 */
export function commerceLineIndicator(
  status: CommerceLineStatus,
): { tone: "green" | "grey" | "returned"; glyph: "✓" | "↩" | "⇄" } {
  if (status.kind === "cancelled") return { tone: "grey", glyph: "↩" };
  if (status.kind === "returned") return { tone: "returned", glyph: "⇄" };
  /* Mixed: something is missing from the parcel, so it is not a plain tick. */
  if (status.kind === "mixed") return { tone: "grey", glyph: "↩" };
  return { tone: "green", glyph: "✓" };
}
