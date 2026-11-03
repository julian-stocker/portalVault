/**
 * The whole pipeline in one call, for tests: read → merge → cover → match → diff.
 *
 * The later server action will run the same steps; this keeps the tests from
 * re-assembling them by hand and drifting apart from each other.
 */

import { type Coverage, coverageOf } from "../coverage.ts";
import { mergeReports } from "../dedupe.ts";
import { reconcile, type ReconciliationRow, summarize, type Summary } from "../diff.ts";
import { matchOrders, type MatchOptions } from "../match.ts";
import { parseSalesReport } from "../registry.ts";
import type { ExternalReport, LedgerSale } from "../types.ts";

export type Run = { reports: ExternalReport[]; coverage: Coverage; rows: ReconciliationRow[]; summary: Summary };

export function runReconciliation(
  files: readonly { name: string; text: string; fingerprint?: string }[],
  sales: readonly LedgerSale[],
  options?: MatchOptions,
): Run {
  const reports = files.map((f) => {
    const result = parseSalesReport(f.text, f.name);
    if (!result.ok) throw new Error(`${f.name}: ${result.error.code} ${result.error.detail ?? ""}`);
    return result.report;
  });
  const merged = mergeReports(reports.map((report, i) => ({ report, fingerprint: files[i].fingerprint ?? files[i].name })));
  const coverage = coverageOf(reports, merged.orders);
  const rows = reconcile(matchOrders(merged.orders, sales, coverage, options));
  return { reports, coverage, rows, summary: summarize(rows) };
}

/** The row about one order number, or about one sale. */
export function rowFor(run: Run, key: { orderRef?: string; saleId?: number }): ReconciliationRow {
  const row = run.rows.find((r) => {
    const e = r.entry;
    if (key.orderRef !== undefined && (e.kind === "pair" || e.kind === "external_only") && e.order.orderRef === key.orderRef) return true;
    if (key.saleId !== undefined && e.kind !== "external_only" && e.sale.saleId === key.saleId) return true;
    return false;
  });
  if (!row) throw new Error(`no row for ${JSON.stringify(key)}`);
  return row;
}
