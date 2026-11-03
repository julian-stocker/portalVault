/**
 * What differs between a matched sale and its external order — field by field.
 *
 * THREE KINDS OF STATEMENT, NEVER MIXED
 *
 *   findings   PROVEN: the two values differ. `delta` = SkyIsles − report.
 *   causes     POSSIBLE explanations attached to a finding — "the SkyIsles day
 *              is the payment day", "the report's total is 0 and nothing was
 *              shipped". A cause is a reading, not a fact: a report total of 0
 *              suggests a cancellation, it does not prove one.
 *   hints      not safely interpretable at all: a different spelling, a
 *              listing title that names another series. They never make a
 *              sale deviating.
 *
 * WHICH AMOUNTS ARE COMPARED
 *
 *   goods      `items_subtotal − discount_amount` against Σ quantity × unit
 *              price. eBay's unit prices are already after its volume discount;
 *              SkyIsles stores the discount separately. Comparing
 *              `items_subtotal` alone would invent ~146 € of "deviation" across
 *              2026 that does not exist.
 *   shipping   `shipping_charged` against the report's shipping.
 *   total      what SkyIsles expects to have received (goods + shipping −
 *              refunds, 0 when cancelled) against the report's total, which eBay
 *              has already reduced by its refunds. This is where an unrecorded
 *              refund or cancellation shows — without saying which it was.
 *
 * A missing `external_order_ref` is an ADDITION, not a deviation: the
 * historical sales have none, and that is not an error in the sale.
 *
 * BUILT FOR A FIELD-BY-FIELD MERGE SCREEN
 *
 * Every finding has an `id` that is stable within its pair, the value for the
 * left (SkyIsles) and the right (report) column, and the decisions that make
 * sense for exactly that field. Nothing here decides; it only describes.
 */

import { roundMoney } from "../orderbook/sales-money.ts";
import { type Certainty, dayDelta, ledgerItemsNet, type MatchEntry, type MatchedPair } from "./match.ts";
import { type NameTier, seriesHint } from "./names.ts";
import type { ExternalOrder, IsoDay, LedgerSale } from "./types.ts";

export type Decision = "take_external" | "keep_ledger" | "manual" | "defer";

export type FindingField = "sold_on" | "items_net" | "shipping" | "pieces" | "figure" | "total" | "external_order_ref";

export type CauseCode =
  | "matches_payment_date"
  | "matches_shipping_date"
  | "ledger_discount_not_in_report"
  | "report_total_zero_not_shipped"
  | "report_total_zero_after_shipping"
  | "report_total_reduced"
  | "report_total_increased"
  | "ledger_cancelled"
  | "ledger_refund_not_in_report"
  | "follows_from_other_fields";

export type Cause = { code: CauseCode; amount?: number };

export type Finding = {
  id: string;
  field: FindingField;
  /** `deviation`: the values differ. `addition`: SkyIsles has nothing where the report has a value. */
  kind: "deviation" | "addition";
  ledger: string | number | null;
  external: string | number | null;
  /** SkyIsles − report: days for a date, euros for money, pieces for a count; null where it means nothing. */
  delta: number | null;
  causes: Cause[];
  decisions: Decision[];
};

export type Hint =
  | { code: "name_spelling"; line: number; piece: number; tier: Exclude<NameTier, "exact">; external: string; ledger: string }
  | { code: "series"; line: number; piece: number; listing: string; ledger: string };

export type PairDiff = {
  findings: Finding[];
  hints: Hint[];
  /** No deviation. Additions and hints do not count. */
  conforms: boolean;
};

const VALUE_DECISIONS: Decision[] = ["take_external", "keep_ledger", "manual", "defer"];
// A refund or cancellation is not a value to copy: it needs an amount, a reason, a date.
const EVENT_DECISIONS: Decision[] = ["manual", "keep_ledger", "defer"];
const ADDITION_DECISIONS: Decision[] = ["take_external", "keep_ledger", "defer"];

const differs = (a: number, b: number): boolean => Math.abs(a - b) >= 0.005;

/** What SkyIsles expects the platform to have paid out for the goods and shipping. */
export function ledgerExpectedTotal(sale: LedgerSale): number {
  if (sale.cancelledOn) return 0;
  return roundMoney(ledgerItemsNet(sale) + sale.shipping - sale.refundsTotal);
}

export function diffPair(pair: Pick<MatchedPair, "order" | "sale" | "pieces">): PairDiff {
  const { order, sale, pieces } = pair;
  const findings: Finding[] = [];

  // ---- date --------------------------------------------------------------
  if (sale.soldOn !== null && sale.soldOn !== order.soldOn) {
    const causes: Cause[] = [];
    if (order.paidOn && sale.soldOn === order.paidOn) causes.push({ code: "matches_payment_date" });
    if (order.shippedOn && sale.soldOn === order.shippedOn) causes.push({ code: "matches_shipping_date" });
    findings.push({
      id: "sold_on", field: "sold_on", kind: "deviation",
      ledger: sale.soldOn, external: order.soldOn, delta: dayDelta(order.soldOn, sale.soldOn as IsoDay),
      causes, decisions: VALUE_DECISIONS,
    });
  }

  // ---- goods and shipping -----------------------------------------------
  const net = ledgerItemsNet(sale);
  const itemsDelta = roundMoney(net - order.itemsValue);
  if (differs(net, order.itemsValue)) {
    const causes: Cause[] = [];
    if (!differs(sale.itemsSubtotal, order.itemsValue) && sale.discount > 0) {
      causes.push({ code: "ledger_discount_not_in_report", amount: sale.discount });
    }
    findings.push({
      id: "items_net", field: "items_net", kind: "deviation",
      ledger: net, external: order.itemsValue, delta: itemsDelta, causes, decisions: VALUE_DECISIONS,
    });
  }
  const shippingDelta = roundMoney(sale.shipping - order.shipping);
  if (differs(sale.shipping, order.shipping)) {
    findings.push({
      id: "shipping", field: "shipping", kind: "deviation",
      ledger: sale.shipping, external: order.shipping, delta: shippingDelta, causes: [], decisions: VALUE_DECISIONS,
    });
  }

  // ---- pieces and figures -----------------------------------------------
  if (sale.pieces.length !== order.pieces) {
    findings.push({
      id: "pieces", field: "pieces", kind: "deviation",
      ledger: sale.pieces.length, external: order.pieces, delta: sale.pieces.length - order.pieces,
      causes: [], decisions: VALUE_DECISIONS,
    });
  }
  // One finding per unmatched slot: an external piece SkyIsles lacks, a SkyIsles
  // piece the report lacks, or — side by side — one of each.
  const slots = Math.max(pieces.unmatchedExternal.length, pieces.unmatchedLedger.length);
  for (let i = 0; i < slots; i += 1) {
    const external = pieces.unmatchedExternal[i];
    const ledgerIndex = pieces.unmatchedLedger[i];
    const ledgerPiece = ledgerIndex === undefined ? null : sale.pieces[ledgerIndex];
    findings.push({
      id: `figure:${i}`, field: "figure", kind: "deviation",
      ledger: ledgerPiece ? (ledgerPiece.name ?? ledgerPiece.rawName) : null,
      external: external ? external.name : null,
      delta: null, causes: [], decisions: VALUE_DECISIONS,
    });
  }

  // ---- what was received ---------------------------------------------------
  const expected = ledgerExpectedTotal(sale);
  if (differs(expected, order.total)) {
    const causes: Cause[] = [];
    const delta = roundMoney(expected - order.total);
    const reportReduction = roundMoney(order.itemsValue + order.shipping - order.total);
    if (order.total === 0) {
      causes.push({ code: order.shippedOn ? "report_total_zero_after_shipping" : "report_total_zero_not_shipped" });
    } else if (reportReduction > 0) {
      causes.push({ code: "report_total_reduced", amount: reportReduction });
    } else if (reportReduction < 0) {
      causes.push({ code: "report_total_increased", amount: -reportReduction });
    }
    if (sale.cancelledOn) causes.push({ code: "ledger_cancelled" });
    if (sale.refundsTotal > 0 && reportReduction <= 0) causes.push({ code: "ledger_refund_not_in_report", amount: sale.refundsTotal });
    if (!differs(delta, roundMoney(itemsDelta + shippingDelta)) && (differs(itemsDelta, 0) || differs(shippingDelta, 0))) {
      causes.push({ code: "follows_from_other_fields" });
    }
    findings.push({
      id: "total", field: "total", kind: "deviation",
      ledger: expected, external: order.total, delta, causes, decisions: EVENT_DECISIONS,
    });
  }

  // ---- reference -----------------------------------------------------------
  if (!sale.externalOrderRef) {
    findings.push({
      id: "external_order_ref", field: "external_order_ref", kind: "addition",
      ledger: null, external: order.orderRef, delta: null, causes: [], decisions: ADDITION_DECISIONS,
    });
  }

  // ---- hints ---------------------------------------------------------------
  const hints: Hint[] = [];
  for (const p of pieces.pairs) {
    const piece = sale.pieces[p.piece];
    const line = order.lines[p.line];
    if (p.tier !== "exact") {
      hints.push({
        code: "name_spelling", line: p.line, piece: p.piece, tier: p.tier,
        external: line.name, ledger: piece.name ?? piece.rawName ?? "",
      });
    }
    const series = seriesHint(line, piece);
    if (series) hints.push({ code: "series", line: p.line, piece: p.piece, ...series });
  }

  return { findings, hints, conforms: findings.every((f) => f.kind !== "deviation") };
}

// ---------------------------------------------------------------------------
// One row per order or sale, and the totals over them
// ---------------------------------------------------------------------------

export type Category =
  | "exact"          // certain identity, no deviation
  | "deviating"      // certain identity, at least one deviation
  | "probable"       // paired on weaker evidence
  | "ambiguous"      // competing candidates; nothing taken over
  | "external_only"  // in the report, not in SkyIsles
  | "ledger_only"    // in SkyIsles within the covered period, not in the report
  | "not_comparable";

export type ReconciliationRow = {
  category: Category;
  entry: MatchEntry;
  diff: PairDiff | null;
  /** `YYYY-MM` the row is counted under: the order's month, else the sale's. */
  month: string | null;
};

const CERTAIN: ReadonlySet<Certainty> = new Set(["deterministic", "unique"]);

export function reconcile(entries: readonly MatchEntry[]): ReconciliationRow[] {
  return entries.map((entry) => {
    if (entry.kind === "pair") {
      const diff = diffPair(entry);
      const category: Category = !CERTAIN.has(entry.certainty)
        ? (entry.certainty === "ambiguous" ? "ambiguous" : "probable")
        : diff.conforms ? "exact" : "deviating";
      return { category, entry, diff, month: entry.order.soldOn.slice(0, 7) };
    }
    if (entry.kind === "external_only") return { category: "external_only", entry, diff: null, month: entry.order.soldOn.slice(0, 7) };
    return { category: entry.kind, entry, diff: null, month: entry.sale.soldOn?.slice(0, 7) ?? null };
  });
}

export type MoneyTotals = { positive: number; negative: number; balance: number; count: number };

export type Summary = {
  categories: Record<Category, number>;
  byMonth: Record<string, Record<Category, number>>;
  /** Over pairs with CERTAIN identity only — an uncertain pair's difference may belong to another sale. */
  money: Record<"items_net" | "shipping" | "total", MoneyTotals>;
  deviations: Record<Exclude<FindingField, "external_order_ref">, number>;
  referenceAdditions: number;
};

const emptyCategories = (): Record<Category, number> => ({
  exact: 0, deviating: 0, probable: 0, ambiguous: 0, external_only: 0, ledger_only: 0, not_comparable: 0,
});

export function summarize(rows: readonly ReconciliationRow[]): Summary {
  const categories = emptyCategories();
  const byMonth: Summary["byMonth"] = {};
  const money: Summary["money"] = {
    items_net: { positive: 0, negative: 0, balance: 0, count: 0 },
    shipping: { positive: 0, negative: 0, balance: 0, count: 0 },
    total: { positive: 0, negative: 0, balance: 0, count: 0 },
  };
  const deviations: Summary["deviations"] = { sold_on: 0, items_net: 0, shipping: 0, pieces: 0, figure: 0, total: 0 };
  let referenceAdditions = 0;

  for (const row of rows) {
    categories[row.category] += 1;
    const month = row.month ?? "unknown";
    byMonth[month] ??= emptyCategories();
    byMonth[month][row.category] += 1;
    if (!row.diff) continue;
    const certain = row.category === "exact" || row.category === "deviating";
    const counted = new Set<FindingField>();
    for (const f of row.diff.findings) {
      if (f.kind === "addition") {
        if (f.field === "external_order_ref") referenceAdditions += 1;
        continue;
      }
      // An order with three wrong figures is ONE order with a figure deviation.
      if (f.field !== "external_order_ref" && !counted.has(f.field)) {
        deviations[f.field] += 1;
        counted.add(f.field);
      }
      if (certain && (f.field === "items_net" || f.field === "shipping" || f.field === "total") && f.delta !== null) {
        const t = money[f.field];
        if (f.delta > 0) t.positive = roundMoney(t.positive + f.delta);
        else t.negative = roundMoney(t.negative + f.delta);
        t.balance = roundMoney(t.positive + t.negative);
        t.count += 1;
      }
    }
  }
  return { categories, byMonth, money, deviations, referenceAdditions };
}

/** Convenience for tests and the later screen: the order a row is about, if any. */
export const rowOrder = (row: ReconciliationRow): ExternalOrder | null =>
  row.entry.kind === "pair" || row.entry.kind === "external_only" ? row.entry.order : null;
