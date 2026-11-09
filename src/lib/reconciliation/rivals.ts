/**
 * WHO BLOCKS THE ORDER NUMBER — the `rival_sale` rule of 0180, for display.
 *
 * `sales_recon_take_check` refuses taking over an order number when ANOTHER
 * sale could be the same order: same channel, not a test, not cancelled,
 * without an order number of its own, not attached to a shop order, dated
 * within ±3 days of the report's order date, left UNPAIRED in this session,
 * and sharing a figure name with the report's lines — exact, trimmed,
 * case-insensitive, against the position's raw name or its catalogue name.
 *
 * The database only says "rival_sale". The operator needs to see WHICH sale,
 * on which day, with which figures — and that is this function, the same
 * predicate on the same data (`seller_recon_candidates`). It decides
 * nothing: the refusal stays the database's, and nothing here can make a
 * take-over pass. (The candidates are external sales already: the
 * `order_id is null` part of the rule is theirs.)
 */
import type { IsoDay, LedgerSale } from "./types";
import type { Match, RivalOrder, RivalSale } from "./view";

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

function shiftDay(day: IsoDay | string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/** The window the rule looks into, for loading the candidates: ±3 days around the order date. */
export function rivalWindow(soldOn: string): { from: string; to: string } {
  return { from: shiftDay(soldOn, -3), to: shiftDay(soldOn, 3) };
}

/**
 * The rivals of one pair. `pairedSaleIds`: every sale the session paired with
 * an order (they are no rivals). Empty when the pair has no order lines — the
 * database then refuses with `no_lines`, not `rival_sale`.
 */
export function rivalSales(
  match: Pick<Match, "order" | "sale">, candidates: readonly LedgerSale[], pairedSaleIds: ReadonlySet<number>,
): RivalSale[] {
  const order = match.order;
  if (order === null || match.sale === null || order.lines === null) return [];
  const names = new Set(order.lines.map((l) => norm(l.name)));
  const { from, to } = rivalWindow(order.soldOn);
  const out: RivalSale[] = [];
  for (const s of candidates) {
    if (s.saleId === match.sale.id || pairedSaleIds.has(s.saleId)) continue;
    if (s.isTest || s.cancelledOn !== null || s.externalOrderRef !== null || s.soldOn === null) continue;
    if (s.soldOn < from || s.soldOn > to) continue;
    const shared = s.pieces
      .filter((p) => names.has(norm(p.rawName)) || names.has(norm(p.name)))
      .map((p) => p.rawName ?? p.name ?? "");
    if (shared.length === 0) continue;
    out.push({ saleId: s.saleId, soldOn: s.soldOn, shared, pieces: s.pieces.map((p) => p.rawName ?? p.name ?? ""),
      updatedAt: s.updatedAt ?? null });
  }
  return out.sort((a, b) => a.soldOn.localeCompare(b.soldOn) || a.saleId - b.saleId);
}

/** Does this pair ask for the order number at all? Only then can `rival_sale` refuse it. */
export function wantsOrderNumber(match: Pick<Match, "findings">): boolean {
  return match.findings.some((f) => f.field === "external_order_ref" && !f.applied);
}

/**
 * The other half of 0180's rule (`rival_order`): another order of the SAME
 * session, itself unpaired (no sale), dated within ±3 days of the SALE's
 * date, whose lines share a figure name with the sale's positions — raw name
 * or catalogue name, exact after trim and case. `ownOrderId` is the order of
 * the pair in question (never its own rival).
 */
export function rivalOrders(
  sale: Pick<LedgerSale, "soldOn" | "pieces">, ownOrderId: number,
  matches: readonly Pick<Match, "order" | "sale">[],
): RivalOrder[] {
  if (sale.soldOn === null) return [];
  const names = new Set(sale.pieces.flatMap((p) => [norm(p.rawName), norm(p.name)]).filter((n) => n !== ""));
  const { from, to } = rivalWindow(sale.soldOn);
  const out: RivalOrder[] = [];
  for (const m of matches) {
    const o = m.order;
    if (o === null || o.id === ownOrderId || m.sale !== null || o.lines === null) continue;
    if (o.soldOn < from || o.soldOn > to) continue;
    const shared = o.lines.map((l) => l.name).filter((n) => names.has(norm(n)));
    if (shared.length > 0) out.push({ orderId: o.id, orderRef: o.orderRef, soldOn: o.soldOn, shared });
  }
  return out.sort((a, b) => a.soldOn.localeCompare(b.soldOn) || a.orderId - b.orderId);
}
