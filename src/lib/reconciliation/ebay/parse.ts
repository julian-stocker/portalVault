/**
 * eBay Seller Hub "Orders Report" (German CSV) → `ExternalReport`.
 *
 * THE FILE'S SHAPE, MEASURED ON NINE REAL REPORTS
 *
 *     line 1     `;;;;…` — an empty record of 41 fields
 *     line 2     the header, 80 columns
 *     line 3     an empty record of 80 fields
 *     …          data
 *     (empty)
 *     footer     `24;Verkaufsprotokoll(e) heruntergeladen;`
 *     last       `Verkäufername : <seller>`
 *
 * An order of ONE position is one row carrying everything. An order of
 * SEVERAL positions is a summary row (no `Artikelnummer`; order totals,
 * shipping, payment date) followed by one row per position (listing, title,
 * variation, quantity, unit price, transaction number). Those position rows
 * share the order number with their summary — they are one order, not
 * duplicates.
 *
 * `Verkauft für` is the UNIT price on a position row (and on a one-position
 * order, even with a quantity of 7), but the order's goods total on a summary
 * row. The goods value is therefore always recomputed from the positions as
 * Σ quantity × unit price; a summary that disagrees is reported, not believed.
 *
 * Only the columns in `columns.ts` are ever read. See there for why.
 */

import { roundMoney } from "../../orderbook/sales-money.ts";
import { isEmptyRecord, parseCsv } from "../csv.ts";
import type { ExternalLine, ExternalOrder, ParseResult, ReportIssue } from "../types.ts";
import { COUNTRY_CODES, EBAY_COLUMNS, type EbayColumn, FOOTER_LABEL, REQUIRED_COLUMNS } from "./columns.ts";
import { parseEbayDate, parseEbayMoney, parseQuantity } from "./values.ts";

export const EBAY_PARSER_ID = "ebay-orders-report-de";
export const EBAY_PARSER_VERSION = 1;

/** `…12345` — enough to find an order again, too little to publish one. */
export const shortRef = (ref: string): string => (ref.length > 5 ? `…${ref.slice(-5)}` : ref);

type Row = { line: number; get: (column: EbayColumn) => string };

/** Does this text look like an eBay Orders Report? Cheap: the header names only. */
export function looksLikeEbayOrdersReport(text: string): boolean {
  const head = text.slice(0, 20_000);
  return head.includes(EBAY_COLUMNS.recordNo) && head.includes(EBAY_COLUMNS.orderRef)
    && head.includes(EBAY_COLUMNS.soldOn);
}

/**
 * The variation value as the figure's name.
 *
 * eBay writes `[Charakter:Swarm]`; a listing with two attributes writes
 * `[Charakter:Swarm][Zustand:gut]`. The first value names the figure.
 */
export function variantName(variant: string): string | null {
  const match = /\[\s*[^:\]]+:\s*([^\]]*?)\s*\]/.exec(variant);
  return match && match[1] !== "" ? match[1] : null;
}

export function parseEbayOrdersReport(text: string, fileName: string): ParseResult {
  if (!looksLikeEbayOrdersReport(text)) return { ok: false, error: { code: "not_this_format" } };

  const { records } = parseCsv(text, ";");
  const headerIndex = records.findIndex((r) =>
    r.fields.includes(EBAY_COLUMNS.recordNo) && r.fields.includes(EBAY_COLUMNS.orderRef));
  if (headerIndex < 0) return { ok: false, error: { code: "no_header" } };

  const header = records[headerIndex].fields.map((h) => h.trim());
  const position = new Map<EbayColumn, number>();
  for (const [key, name] of Object.entries(EBAY_COLUMNS) as [EbayColumn, string][]) {
    const at = header.indexOf(name);
    if (at >= 0) position.set(key, at);
  }
  const missing = REQUIRED_COLUMNS.filter((key) => !position.has(key));
  if (missing.length > 0) {
    return { ok: false, error: { code: "missing_columns", detail: missing.map((k) => EBAY_COLUMNS[k]).join(", ") } };
  }

  const issues: ReportIssue[] = [];
  let footerCount: number | null = null;

  // Group the data rows by order number, in the order the file lists them.
  const groups = new Map<string, Row[]>();
  for (const record of records.slice(headerIndex + 1)) {
    const fields = record.fields;
    if (isEmptyRecord(fields)) continue;
    if (fields.length >= 2 && /^\d+$/.test(fields[0].trim()) && fields[1].trim() === FOOTER_LABEL) {
      footerCount = Number(fields[0].trim());
      continue;
    }
    if (fields.length === 1 && /^Verkäufername\s*:/.test(fields[0].trim())) continue;
    if (fields.length !== header.length) {
      issues.push({ code: "ragged_row", row: record.line, detail: `${fields.length}/${header.length}` });
      continue;
    }
    const row: Row = {
      line: record.line,
      // A column the report does not have reads as empty.
      get: (column) => {
        const at = position.get(column);
        return at === undefined ? "" : fields[at];
      },
    };
    const ref = row.get("orderRef").trim();
    if (ref === "") {
      issues.push({ code: "ragged_row", row: record.line, detail: "no order number" });
      continue;
    }
    const group = groups.get(ref);
    if (group) group.push(row);
    else groups.set(ref, [row]);
  }

  const orders: ExternalOrder[] = [];
  for (const [ref, rows] of groups) {
    const order = buildOrder(ref, rows, fileName, issues);
    if (order) orders.push(order);
  }

  return {
    ok: true,
    report: { parser: EBAY_PARSER_ID, parserVersion: EBAY_PARSER_VERSION, fileName, orders, footerCount, issues },
  };
}

function buildOrder(ref: string, rows: Row[], fileName: string, issues: ReportIssue[]): ExternalOrder | null {
  const order = shortRef(ref);
  const summaries = rows.filter((r) => r.get("listingId").trim() === "");
  const positions = rows.filter((r) => r.get("listingId").trim() !== "");

  if (summaries.length > 1) issues.push({ code: "several_summaries", order, row: summaries[1].line });
  if (summaries.length > 0 && positions.length === 0) {
    issues.push({ code: "summary_without_lines", order, row: summaries[0].line });
    return null;
  }
  if (summaries.length === 0 && positions.length > 1) {
    // Not something eBay writes; the order is still assembled, from its positions.
    issues.push({ code: "several_lines_without_summary", order, row: positions[1].line });
  }
  const head = summaries[0] ?? positions[0];

  const money = (row: Row, column: EbayColumn): number | null | undefined => {
    const read = parseEbayMoney(row.get(column));
    if (read.ok) return read.value;
    issues.push({ code: read.reason === "foreign_currency" ? "foreign_currency" : "invalid_money", order, row: row.line, detail: EBAY_COLUMNS[column] });
    return undefined;
  };
  const day = (row: Row, column: EbayColumn): string | null | undefined => {
    const read = parseEbayDate(row.get(column));
    if (read.ok) return read.value;
    issues.push({ code: "invalid_date", order, row: row.line, detail: EBAY_COLUMNS[column] });
    return undefined;
  };

  const lines: ExternalLine[] = [];
  for (const row of positions) {
    const quantity = parseQuantity(row.get("quantity"));
    if (quantity === null) {
      issues.push({ code: "invalid_quantity", order, row: row.line });
      return null;
    }
    const unitPrice = money(row, "price");
    if (unitPrice === undefined || unitPrice === null) {
      if (unitPrice === null) issues.push({ code: "invalid_money", order, row: row.line, detail: EBAY_COLUMNS.price });
      return null;
    }
    const lineRef = row.get("lineRef").trim();
    if (lineRef === "") issues.push({ code: "line_without_reference", order, row: row.line });
    const variant = row.get("variant").trim();
    const title = row.get("title").trim();
    lines.push({
      lineRef: lineRef === "" ? null : lineRef,
      listingId: row.get("listingId").trim(),
      title,
      variant: variant === "" ? null : variant,
      name: (variant !== "" ? variantName(variant) : null) ?? title,
      quantity,
      unitPrice,
      value: roundMoney(quantity * unitPrice),
    });
  }

  const soldOn = day(head, "soldOn");
  const paidOn = day(head, "paidOn");
  const shippedOn = day(head, "shippedOn") ?? (positions.length > 0 ? day(positions[0], "shippedOn") : null);
  const shipping = money(head, "shipping");
  const total = money(head, "total");
  if (soldOn === undefined || soldOn === null || paidOn === undefined || shipping === undefined || total === undefined) {
    if (soldOn === null) issues.push({ code: "invalid_date", order, row: head.line, detail: EBAY_COLUMNS.soldOn });
    return null;
  }

  const itemsValue = roundMoney(lines.reduce((sum, l) => sum + l.value, 0));
  const pieces = lines.reduce((sum, l) => sum + l.quantity, 0);

  if (summaries.length > 0) {
    const stated = parseEbayMoney(head.get("price"));
    if (stated.ok && stated.value !== null && Math.abs(stated.value - itemsValue) >= 0.005) {
      issues.push({ code: "items_value_mismatch", order, row: head.line, detail: `${stated.value} ≠ ${itemsValue}` });
    }
    const statedQty = parseQuantity(head.get("quantity"));
    if (statedQty !== null && statedQty !== pieces) {
      issues.push({ code: "quantity_mismatch", order, row: head.line, detail: `${statedQty} ≠ ${pieces}` });
    }
  }

  const recordText = head.get("recordNo").trim();
  const recordNo = /^\d+$/.test(recordText) ? Number(recordText) : null;
  if (rows.some((r) => r.get("recordNo").trim() !== recordText)) {
    issues.push({ code: "record_number_differs", order, row: head.line });
  }

  const country = head.get("destinationCountry").trim();
  const service = head.get("shippingService").trim();

  return {
    channel: "ebay",
    orderRef: ref,
    recordNo,
    soldOn,
    paidOn: paidOn ?? null,
    shippedOn: shippedOn ?? null,
    itemsValue,
    shipping: shipping ?? 0,
    total: total ?? roundMoney(itemsValue + (shipping ?? 0)),
    pieces,
    combined: summaries.length > 0,
    destinationCountry: country === "" ? null : (COUNTRY_CODES[country] ?? null),
    shippingService: service === "" ? null : service,
    lines,
    sourceFile: fileName,
  };
}
