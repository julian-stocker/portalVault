/**
 * Which SkyIsles sale is which external order?
 *
 * THIS ANSWERS IDENTITY, NOT CORRECTNESS
 *
 * A sale with the wrong date, a missing piece and an unrecorded refund is
 * still the sale of that order — and must be found as such, or its errors can
 * never be shown. So matching decides only who belongs to whom, with how much
 * certainty. Whether the two agree is `diff.ts`'s question, answered after.
 *
 * TWO STAGES
 *
 *   A  references    a sale whose `external_order_ref` is the order number IS
 *                    that order — `deterministic`, whatever else differs. A
 *                    sale with a DIFFERENT stored reference is never offered to
 *                    another order. Most historical sales carry no reference;
 *                    that is not an error, just the reason stage B exists.
 *   B  evidence      every other sale within ±3 days is a candidate, scored on
 *                    figures, goods value after discount, pieces, shipping and
 *                    the date distance. One global assignment (`assignment.ts`)
 *                    then decides, each order and each sale at most once.
 *
 * CERTAINTY OF A STAGE-B PAIR
 *
 *   ambiguous   another candidate scores within the margin (default 10 of
 *               ~105) for the same order or the same sale. Never taken over
 *               automatically; the competitors are listed.
 *   unique      no competitor, at least half the pieces agree, and either the
 *               goods value matches or the date is at most one day off.
 *   probable    paired, but on weaker evidence (e.g. same day and amount,
 *               figures not recognisable).
 *
 * The thresholds were checked against the 2026 data: 310 unique, 1 probable,
 * 0 ambiguous among 311 orders.
 */

import { roundMoney } from "../orderbook/sales-money.ts";
import { assignMaximum, type Edge } from "./assignment.ts";
import { type Coverage, judgeDay } from "./coverage.ts";
import { type AliasIndex, buildAliasIndex, matchPieces, type PieceMatch } from "./names.ts";
import type { ExternalOrder, IsoDay, LedgerSale } from "./types.ts";

export type Certainty = "deterministic" | "unique" | "probable" | "ambiguous";

export type Competitor = { orderRef: string; saleId: number; score: number };

export type MatchedPair = {
  kind: "pair";
  order: ExternalOrder;
  sale: LedgerSale;
  certainty: Certainty;
  score: number;
  /** sale day − order day, in days. */
  dateDelta: number;
  pieces: PieceMatch;
  /** Other candidates within the margin — the reason for `ambiguous`. */
  competitors: Competitor[];
};

export type NotComparableReason =
  | "test" | "no_date" | "before_coverage" | "after_coverage" | "inside_gap" | "no_coverage" | "edge_day";

export type MatchEntry =
  | MatchedPair
  | { kind: "external_only"; order: ExternalOrder }
  | { kind: "ledger_only"; sale: LedgerSale }
  | { kind: "not_comparable"; sale: LedgerSale; reason: NotComparableReason };

export type MatchOptions = {
  dateWindowDays?: number;
  ambiguityMargin?: number;
  /**
   * Names each SKY-ID was ever sold under, from the WHOLE ledger
   * (`seller_recon_aliases`). The candidates of one period alone would miss
   * an alias that was only ever used outside it. Merged with the candidates'
   * own names.
   */
  aliases?: AliasIndex;
};

/** Goods value after discount — the only SkyIsles amount comparable with eBay's line values. */
export const ledgerItemsNet = (sale: Pick<LedgerSale, "itemsSubtotal" | "discount">): number =>
  roundMoney(sale.itemsSubtotal - sale.discount);

export function dayDelta(from: IsoDay, to: IsoDay): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const cents = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

type Scored = { score: number; pieces: PieceMatch; delta: number; amountEqual: boolean };

/** The evidence that this sale is this order, as one number. */
export function scoreCandidate(order: ExternalOrder, sale: LedgerSale, aliases?: AliasIndex): Scored | null {
  if (sale.soldOn === null) return null;
  const delta = dayDelta(order.soldOn, sale.soldOn);
  const pieces = matchPieces(order, sale, aliases);
  const amountEqual = cents(ledgerItemsNet(sale), order.itemsValue);
  // A goods value that matches only before the discount still says "probably this one".
  const grossEqual = !amountEqual && cents(sale.itemsSubtotal, order.itemsValue);
  if (pieces.pairs.length === 0 && !amountEqual) return null;
  const score = 50 * pieces.ratio
    + (amountEqual ? 30 : grossEqual ? 20 : 0)
    + (order.pieces === sale.pieces.length ? 10 : 0)
    + (cents(sale.shipping, order.shipping) ? 5 : 0)
    + (delta === 0 ? 10 : Math.abs(delta) === 1 ? 6 : 2);
  return { score, pieces, delta, amountEqual };
}

function mergeAliases(own: AliasIndex, extra?: AliasIndex): AliasIndex {
  if (!extra) return own;
  const merged = new Map<string, string[]>();
  for (const [sky, names] of [...own, ...extra]) merged.set(sky, [...new Set([...(merged.get(sky) ?? []), ...names])]);
  return merged;
}

export function matchOrders(
  orders: readonly ExternalOrder[],
  sales: readonly LedgerSale[],
  coverage: Coverage,
  options: MatchOptions = {},
): MatchEntry[] {
  const window = options.dateWindowDays ?? 3;
  const margin = options.ambiguityMargin ?? 10;
  const aliases = mergeAliases(buildAliasIndex(sales), options.aliases);
  const entries: MatchEntry[] = [];

  const usableSale = (s: LedgerSale) => !s.isTest && s.soldOn !== null;

  // ---- Stage A: stored references ----------------------------------------
  const byRef = new Map<string, LedgerSale[]>();
  for (const s of sales) {
    if (!usableSale(s) || !s.externalOrderRef) continue;
    const list = byRef.get(s.externalOrderRef);
    if (list) list.push(s);
    else byRef.set(s.externalOrderRef, [s]);
  }
  const matchedOrders = new Set<string>();
  const matchedSales = new Set<number>();
  for (const order of orders) {
    const list = byRef.get(order.orderRef);
    if (!list || list.length !== 1) continue;
    const sale = list[0];
    const scored = scoreCandidate(order, sale, aliases);
    entries.push({
      kind: "pair", order, sale, certainty: "deterministic",
      score: scored?.score ?? 0,
      dateDelta: sale.soldOn ? dayDelta(order.soldOn, sale.soldOn) : 0,
      pieces: scored?.pieces ?? matchPieces(order, sale, aliases),
      competitors: [],
    });
    matchedOrders.add(order.orderRef);
    matchedSales.add(sale.saleId);
  }

  // ---- Stage B: evidence --------------------------------------------------
  const restOrders = orders.filter((o) => !matchedOrders.has(o.orderRef));
  // A sale that already names an order belongs to that order or to nobody.
  const restSales = sales.filter((s) => usableSale(s) && !matchedSales.has(s.saleId) && !s.externalOrderRef);
  const duplicateRefs = new Set([...byRef].filter(([, list]) => list.length > 1).map(([ref]) => ref));
  for (const ref of duplicateRefs) {
    // Two sales claim one order number: offer both, and the pair can only be ambiguous.
    for (const s of byRef.get(ref) ?? []) if (!matchedSales.has(s.saleId)) restSales.push(s);
  }

  const edges: (Edge & { scored: Scored })[] = [];
  restOrders.forEach((order, row) => {
    restSales.forEach((sale, col) => {
      if (sale.externalOrderRef && sale.externalOrderRef !== order.orderRef) return;
      if (sale.soldOn === null || Math.abs(dayDelta(order.soldOn, sale.soldOn)) > window) return;
      const scored = scoreCandidate(order, sale, aliases);
      if (scored) edges.push({ row, col, score: scored.score, scored });
    });
  });

  const chosen = assignMaximum(edges);
  const byKey = new Map(edges.map((e) => [`${e.row}:${e.col}`, e]));
  for (const pick of chosen) {
    const edge = byKey.get(`${pick.row}:${pick.col}`) as Edge & { scored: Scored };
    const order = restOrders[edge.row];
    const sale = restSales[edge.col];
    const competitors = edges
      .filter((e) => (e.row === edge.row) !== (e.col === edge.col) && e.score >= edge.score - margin)
      .map((e) => ({ orderRef: restOrders[e.row].orderRef, saleId: restSales[e.col].saleId, score: e.score }));
    const { pieces, delta, amountEqual } = edge.scored;
    let certainty: Certainty;
    if (competitors.length > 0 || duplicateRefs.has(order.orderRef)) certainty = "ambiguous";
    else if (pieces.ratio >= 0.5 && (amountEqual || Math.abs(delta) <= 1)) certainty = "unique";
    else certainty = "probable";
    entries.push({ kind: "pair", order, sale, certainty, score: edge.score, dateDelta: delta, pieces, competitors });
    matchedOrders.add(order.orderRef);
    matchedSales.add(sale.saleId);
  }

  // ---- What is left -------------------------------------------------------
  for (const order of orders) if (!matchedOrders.has(order.orderRef)) entries.push({ kind: "external_only", order });
  for (const sale of sales) {
    if (matchedSales.has(sale.saleId)) continue;
    if (sale.isTest) entries.push({ kind: "not_comparable", sale, reason: "test" });
    else if (sale.soldOn === null) entries.push({ kind: "not_comparable", sale, reason: "no_date" });
    else {
      const verdict = judgeDay(coverage, sale.soldOn);
      if (!verdict.comparable) entries.push({ kind: "not_comparable", sale, reason: verdict.reason });
      // On an edge day the order may lie just outside the files: unproven either way.
      else if (verdict.edge) entries.push({ kind: "not_comparable", sale, reason: "edge_day" });
      else entries.push({ kind: "ledger_only", sale });
    }
  }
  return entries;
}
