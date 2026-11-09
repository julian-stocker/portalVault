/**
 * WHICH EXISTING SALES COULD AN UNMATCHED ORDER BE? (2026-11-09, ADR-0182)
 *
 * The analysis is a snapshot: a sale created or corrected after it (sale 381
 * for 06-14518-99785) was never looked at for an order the analysis left
 * unmatched. This module looks again — at page load, read-only — with the
 * analysis' OWN scoring:
 *
 *   score       `scoreCandidate` (match.ts), unchanged. Its null ("no figure
 *               and no goods value in common") is shown as 0, not dropped:
 *               here nothing is assigned, so nothing has to be excluded.
 *   breakdown   every part of the score, side by side — figures by tier,
 *               pieces, goods value with discount, shipping, date, number.
 *   hints       NOT part of the score: a figure paired by name whose series
 *               is not the one the listing title names (`listingSeries`) — a
 *               possible wrong variant; a name contained in another (Fire
 *               Reactor / Fire Reactor (Crystal)). Shown, never counted.
 *   rivals      the unpaired sales the database's `rival_sale` rule would
 *               see if this pair were made (`rivals.ts`).
 *
 * WHO IS NO CANDIDATE: a sale paired anywhere in this session (an existing
 * pairing is never displaced), a sale carrying ANOTHER order number (stage A
 * of the analysis: it belongs to that order or to nobody), a test sale, a
 * cancelled sale. The window is wider than the analysis' ±3 days — a date
 * alone excludes nobody here; it only scores less.
 *
 * A HIGH SCORE IS A RECOMMENDATION. Identity is what the operator confirms.
 */
import { dayDelta, ledgerItemsNet, scoreCandidate } from "./match";
import { type AliasIndex, listingSeries, matchPieces } from "./names";
import { rivalOrders, rivalSales } from "./rivals";
import type { ExternalOrder, LedgerSale } from "./types";
import type { Match, RivalOrder, RivalSale } from "./view";

/** How far around the order date the page looks (the analysis: ±3). */
export const CANDIDATE_WINDOW_DAYS = 14;
/** Shown at first; the rest on request. */
export const CANDIDATE_LIMIT = 3;

const cents = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;
const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

export type FigureRow = {
  /** The report's name, or null for a SkyIsles piece the report does not have. */
  report: string | null;
  /** SkyIsles' piece (catalogue name, else raw), or null for a report piece SkyIsles lacks. */
  ledger: string | null;
  skyId: string | null;
  /** How the names were paired, as `matchPieces` decided. */
  tier: "exact" | "normalized" | "alias" | "fuzzy" | null;
  /** Not scored: the listing names one series, SkyIsles' figure is of another. */
  seriesHint: { listing: string; ledger: string } | null;
  /** Not scored: one name contains the other (a possible variant). */
  similarTo: string | null;
};

export type CandidateExplanation = {
  saleId: number;
  /** `scoreCandidate`, 0 where it answers null. */
  score: number;
  /** `scoreCandidate` would have offered this sale at all (within its ±3 days). */
  analysisCandidate: boolean;
  figures: { matched: number; reportPieces: number; ledgerPieces: number; rows: FigureRow[] };
  goods: { report: number; ledgerGross: number; discount: number; ledgerNet: number; netEqual: boolean; grossEqual: boolean };
  shipping: { report: number; ledger: number; equal: boolean };
  date: { report: string; ledger: string | null; delta: number | null };
  /** The sale's order number: null = missing (the usual case), else the same as the report's. */
  orderRef: string | null;
  rivals: readonly RivalSale[];
  /** The unpaired orders of the session the database would see as rivals (`rival_order`). */
  rivalOrders: readonly RivalOrder[];
  /** The sale's version as read — the assignment (0185) is refused if it moved since. */
  updatedAt: string | null;
};

type Order = Pick<ExternalOrder, "orderRef" | "soldOn" | "itemsValue" | "shipping" | "pieces" | "lines"> & { id?: number };
/** What a candidate is judged against besides itself: the other sales, who is paired, the session's orders. */
export type CandidateContext = {
  candidates: readonly LedgerSale[];
  paired: ReadonlySet<number>;
  matches?: readonly Pick<Match, "order" | "sale">[];
};

/** The whole comparison of one order with one sale — the score untouched, everything else beside it. */
export function explainCandidate(order: Order, sale: LedgerSale, aliases?: AliasIndex,
  context: CandidateContext = { candidates: [], paired: new Set() },
): CandidateExplanation {
  const scored = scoreCandidate(order as ExternalOrder, sale, aliases);
  const pieces = scored?.pieces ?? matchPieces(order, sale, aliases);
  const delta = sale.soldOn === null ? null : dayDelta(order.soldOn, sale.soldOn);
  const ledgerName = (k: number) => sale.pieces[k].name ?? sale.pieces[k].rawName ?? "";

  const rows: FigureRow[] = pieces.pairs.map((p) => {
    const line = order.lines[p.line];
    const piece = sale.pieces[p.piece];
    const listing = listingSeries(line.title ?? "");
    return {
      report: line.name, ledger: ledgerName(p.piece), skyId: piece.skyId, tier: p.tier,
      seriesHint: listing !== null && piece.seriesCode && piece.seriesCode !== listing
        ? { listing, ledger: piece.seriesCode } : null,
      similarTo: null,
    };
  });
  const leftLedger = [...pieces.unmatchedLedger];
  for (const ext of pieces.unmatchedExternal) {
    // A hint only: an unpaired SkyIsles piece whose name contains this one, or the other way round.
    const at = leftLedger.findIndex((k) => {
      const a = norm(ext.name), b = norm(ledgerName(k));
      return a !== "" && b !== "" && (a.includes(b) || b.includes(a));
    });
    rows.push({ report: ext.name, ledger: null, skyId: null, tier: null, seriesHint: null,
      similarTo: at >= 0 ? ledgerName(leftLedger[at]) : null });
  }
  for (const k of leftLedger) {
    rows.push({ report: null, ledger: ledgerName(k), skyId: sale.pieces[k].skyId, tier: null, seriesHint: null, similarTo: null });
  }

  const net = ledgerItemsNet(sale);
  return {
    saleId: sale.saleId,
    score: scored?.score ?? 0,
    analysisCandidate: scored !== null && delta !== null && Math.abs(delta) <= 3,
    figures: { matched: pieces.pairs.length, reportPieces: order.pieces, ledgerPieces: sale.pieces.length, rows },
    goods: { report: order.itemsValue, ledgerGross: sale.itemsSubtotal, discount: sale.discount, ledgerNet: net,
      netEqual: cents(net, order.itemsValue), grossEqual: cents(sale.itemsSubtotal, order.itemsValue) },
    shipping: { report: order.shipping, ledger: sale.shipping, equal: cents(sale.shipping, order.shipping) },
    date: { report: order.soldOn, ledger: sale.soldOn, delta },
    orderRef: sale.externalOrderRef,
    rivals: rivalSales({ order: order as unknown as Match["order"], sale: { id: sale.saleId } as Match["sale"] },
      context.candidates, context.paired),
    rivalOrders: rivalOrders(sale, order.id ?? -1, context.matches ?? []),
    updatedAt: sale.updatedAt ?? null,
  };
}

/** May this sale be shown as a candidate for this order at all? */
export function eligible(order: Pick<Order, "orderRef">, sale: LedgerSale, paired: ReadonlySet<number>): boolean {
  return !sale.isTest && sale.cancelledOn === null && !paired.has(sale.saleId)
    && (sale.externalOrderRef === null || sale.externalOrderRef === order.orderRef);
}

/**
 * The candidates of one unmatched order, best first: score, then the
 * smaller date distance, then the lower sale id — the same order every run.
 * `limit` null: all of them (the search).
 */
export function candidatesFor(order: Order, sales: readonly LedgerSale[], paired: ReadonlySet<number>,
  aliases?: AliasIndex, limit: number | null = CANDIDATE_LIMIT, matches: readonly Pick<Match, "order" | "sale">[] = [],
): { shown: CandidateExplanation[]; more: number } {
  const all = sales.filter((s) => eligible(order, s, paired))
    .map((s) => explainCandidate(order, s, aliases, { candidates: sales, paired, matches }))
    .sort((a, b) => b.score - a.score
      || Math.abs(a.date.delta ?? 9999) - Math.abs(b.date.delta ?? 9999) || a.saleId - b.saleId);
  return limit === null ? { shown: all, more: 0 } : { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}
