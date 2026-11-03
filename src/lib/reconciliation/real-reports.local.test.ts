/**
 * The pipeline against the REAL reports — locally, on request, read-only.
 *
 *   SKYISLES_EBAY_REPORTS=~/SkyIsles-Daten/ebay/2026 \
 *   SKYISLES_SALES_EXPORT=~/SkyIsles-Daten/exports/production-ebay-sales.csv \
 *   npx vitest run src/lib/reconciliation/real-reports.local.test.ts
 *
 * Without the variables every test here is skipped, so `npm test` and CI never
 * see real data. The files are only READ: nothing is copied, written or logged
 * beyond counts — no order number, no name, no amount of a single order.
 *
 * The expected numbers are the result of the 2026 analysis (311 orders, 302
 * exact, 8 certain with deviations, 1 probable). If they differ, the cause is
 * investigated; the expectation is not adjusted to make the run green.
 */

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { runReconciliation } from "./testing/run";
import type { LedgerSale } from "./types";

const expand = (path: string | undefined) => (path ? path.replace(/^~(?=\/|$)/, homedir()) : undefined);
const REPORTS = expand(process.env.SKYISLES_EBAY_REPORTS);
const EXPORT = expand(process.env.SKYISLES_SALES_EXPORT);

function readReports(dir: string) {
  return readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".csv")).sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

/**
 * The SQL-editor export of `production-ebay-sales.sql`: one row per piece,
 * `null` written as the word. Older exports lack the provenance columns.
 */
function readLedger(path: string): { sales: LedgerSale[]; rows: number; declared: number } {
  const { records } = parseCsv(readFileSync(path, "utf8"), ",");
  const [header, ...data] = records.map((r) => r.fields);
  const at = (name: string) => header.indexOf(name);
  const value = (row: string[], name: string): string | null => {
    const v = at(name) < 0 ? undefined : row[at(name)];
    return v === undefined || v === "" || v === "null" ? null : v;
  };
  const rows = data.filter((r) => r.length === header.length);
  const sales = new Map<number, LedgerSale>();
  for (const row of rows) {
    const id = Number(value(row, "sale_id"));
    let sale = sales.get(id);
    if (!sale) {
      sale = {
        saleId: id,
        source: value(row, "source") ?? "",
        isTest: value(row, "is_test") === "true",
        soldOn: value(row, "sold_at"),
        itemsSubtotal: Number(value(row, "items_subtotal") ?? 0),
        discount: Number(value(row, "discount_amount") ?? 0),
        shipping: Number(value(row, "shipping_charged") ?? 0),
        refundsTotal: Number(value(row, "refunds_total") ?? 0),
        cancelledOn: value(row, "cancelled_on"),
        externalOrderRef: value(row, "external_order_ref"),
        pieces: [],
      };
      sales.set(id, sale);
    }
    if (value(row, "sale_item_id") !== null) {
      sale.pieces.push({
        itemId: Number(value(row, "sale_item_id")),
        skyId: value(row, "sky_id"),
        name: value(row, "figure_name"),
        rawName: value(row, "raw_name"),
        baseSkyId: value(row, "base_sky_id"),
      });
    }
  }
  return { sales: [...sales.values()], rows: rows.length, declared: Number(value(rows[0] ?? [], "export_total_rows") ?? -1) };
}

describe.skipIf(!REPORTS)("the real eBay reports 2026 (local only)", () => {
  const files = REPORTS ? readReports(REPORTS) : [];
  const reportsOnly = REPORTS ? runReconciliation(files, []) : null;

  it("reads nine files, 311 orders, 1 258 positions and 1 375 pieces", () => {
    const run = reportsOnly!;
    expect(files).toHaveLength(9);
    const orders = run.reports.flatMap((r) => r.orders);
    expect(orders).toHaveLength(311);
    expect(orders.reduce((n, o) => n + o.lines.length, 0)).toBe(1258);
    expect(orders.reduce((n, o) => n + o.pieces, 0)).toBe(1375);
  });

  it("finds every footer count confirmed and no reading issue", () => {
    const run = reportsOnly!;
    expect(run.coverage.files.map((f) => f.footerMatches)).toEqual(Array(9).fill(true));
    expect(run.reports.flatMap((r) => r.issues.map((i) => i.code))).toEqual([]);
  });

  it("finds the record chain 1061–2518 complete across all nine files", () => {
    const c = reportsOnly!.coverage;
    expect([c.recordFirst, c.recordLast, c.firstSoldOn, c.lastSoldOn]).toEqual([1061, 2518, "2026-01-01", "2026-09-29"]);
    expect(c.gaps).toEqual([]);
    expect(c.chainComplete).toBe(true);
    expect(c.overlappingFiles).toEqual([]);
  });

  it.skipIf(!EXPORT)("matches the Production export as the analysis did", () => {
    const ledger = readLedger(EXPORT!);
    // The export must be complete before it is believed.
    expect(ledger.rows).toBe(ledger.declared);

    const run = runReconciliation(files, ledger.sales);
    const s = run.summary;
    console.info("[real-reports] categories", JSON.stringify(s.categories));
    console.info("[real-reports] deviations", JSON.stringify(s.deviations), "money", JSON.stringify(s.money));

    expect(s.categories.exact).toBe(302);
    expect(s.categories.deviating).toBe(8);
    expect(s.categories.probable).toBe(1);
    expect(s.categories.ambiguous).toBe(0);
    expect(s.categories.external_only).toBe(0);
    expect(s.categories.ledger_only).toBe(0);
    expect(s.money.items_net.count).toBe(0);
    expect(s.money.shipping.count).toBe(0);
    expect(s.money.total).toEqual({ positive: 56.17, negative: 0, balance: 56.17, count: 2 });
  });
});
