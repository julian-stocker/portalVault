/**
 * What crosses the wire — in both directions — and nothing more.
 *
 *   browser → server action   `UploadInput`: the parsed reports. Checked here
 *                             key by key, because a server action is a public
 *                             endpoint and its argument is whatever a client
 *                             sends.
 *   server → database         `SessionPayload` for `seller_recon_create`
 *                             (0172), which checks every key again. Built by
 *                             listing fields explicitly — never by spreading
 *                             an object, so a field added to the model later
 *                             cannot slip into the database unnoticed.
 *   database → server         `ledgerSales()` turns `seller_recon_candidates`
 *                             into the model the matcher reads.
 *
 * Pure: no Supabase, no Next. The server action wires it up.
 */

import { type Coverage, fileCoverage } from "../coverage.ts";
import type { Finding, ReconciliationRow, Summary } from "../diff.ts";
import type { AliasIndex } from "../names.ts";
import type { ExternalLine, ExternalOrder, ExternalReport, LedgerSale } from "../types.ts";

// ---------------------------------------------------------------------------
// Browser → server
// ---------------------------------------------------------------------------

export type UploadFile = { fingerprint: string; report: ExternalReport };
export type UploadInput = { channel: "ebay"; files: UploadFile[] };

const ORDER_KEYS = new Set([
  "channel", "orderRef", "recordNo", "soldOn", "paidOn", "shippedOn", "itemsValue", "shipping", "total",
  "pieces", "combined", "destinationCountry", "shippingService", "lines", "sourceFile",
]);
const LINE_KEYS = new Set(["lineRef", "listingId", "title", "variant", "name", "quantity", "unitPrice", "value"]);
const REPORT_KEYS = new Set(["parser", "parserVersion", "fileName", "orders", "footerCount", "issues"]);
const ISSUE_KEYS = new Set(["code", "row", "order", "detail"]);

export class PayloadError extends Error {}

function onlyKeys(value: unknown, allowed: ReadonlySet<string>, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new PayloadError(`${what}: not an object`);
  const unknown = Object.keys(value).filter((k) => !allowed.has(k));
  if (unknown.length > 0) throw new PayloadError(`${what}: unknown field(s) ${unknown.sort().join(", ")}`);
  return value as Record<string, unknown>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/*
 * No contact data in free text — the same rule as `sales_recon_no_contact`
 * (0172): an e-mail address or an international phone number is refused,
 * a plain digit run (a portal's model number) is not.
 */
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const PHONE = /\+[0-9]{2}[0-9 /().-]{6,}[0-9]/;
const hasContact = (v: unknown): boolean => typeof v === "string" && (EMAIL.test(v) || PHONE.test(v));
const isText = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const isOptText = (v: unknown, max: number) => v === null || isText(v, max);
const isNumber = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const isOptDay = (v: unknown) => v === null || (typeof v === "string" && DAY.test(v));

/**
 * Accept the browser's upload only in exactly the model's shape.
 * Throws `PayloadError` naming the first problem — never echoing a value.
 */
export function validateUpload(input: unknown): UploadInput {
  const top = onlyKeys(input, new Set(["channel", "files"]), "upload");
  if (top.channel !== "ebay") throw new PayloadError("upload: unknown channel");
  if (!Array.isArray(top.files) || top.files.length === 0 || top.files.length > 100) {
    throw new PayloadError("upload: 1 to 100 files");
  }
  let orders = 0;
  for (const [i, raw] of top.files.entries()) {
    const file = onlyKeys(raw, new Set(["fingerprint", "report"]), `file ${i}`);
    if (typeof file.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(file.fingerprint)) {
      throw new PayloadError(`file ${i}: fingerprint is not a SHA-256`);
    }
    const report = onlyKeys(file.report, REPORT_KEYS, `file ${i} report`);
    if (!isText(report.fileName, 200) || /[/\\]/.test(report.fileName as string)) throw new PayloadError(`file ${i}: file name`);
    if (!Array.isArray(report.orders) || !Array.isArray(report.issues)) throw new PayloadError(`file ${i}: orders/issues`);
    for (const issue of report.issues) onlyKeys(issue, ISSUE_KEYS, `file ${i} issue`);
    for (const [j, rawOrder] of report.orders.entries()) {
      const where = `file ${i} order ${j}`;
      const o = onlyKeys(rawOrder, ORDER_KEYS, where);
      const ok = o.channel === "ebay" && isText(o.orderRef, 64) && /^[A-Za-z0-9-]+$/.test(o.orderRef as string)
        && (o.recordNo === null || isNumber(o.recordNo, 0, 1e8)) && typeof o.soldOn === "string" && DAY.test(o.soldOn)
        && isOptDay(o.paidOn) && isOptDay(o.shippedOn)
        && isNumber(o.itemsValue, 0, 1e6) && isNumber(o.shipping, 0, 1e6) && isNumber(o.total, 0, 1e6)
        && isNumber(o.pieces, 0, 1e4) && typeof o.combined === "boolean"
        && isOptText(o.destinationCountry, 2) && isOptText(o.shippingService, 100) && isText(o.sourceFile, 200)
        && Array.isArray(o.lines) && o.lines.length <= 500;
      if (!ok) throw new PayloadError(`${where}: shape`);
      if ([o.orderRef, o.shippingService, o.sourceFile].some(hasContact)) throw new PayloadError(`${where}: contact data`);
      for (const [k, rawLine] of (o.lines as unknown[]).entries()) {
        const l = onlyKeys(rawLine, LINE_KEYS, `${where} line ${k}`);
        const lineOk = isOptText(l.lineRef, 64) && isText(l.listingId, 32) && isText(l.title, 300)
          && isOptText(l.variant, 300) && isText(l.name, 200)
          && isNumber(l.quantity, 1, 1e4) && isNumber(l.unitPrice, 0, 1e6) && isNumber(l.value, 0, 1e6);
        if (!lineOk) throw new PayloadError(`${where} line ${k}: shape`);
        if ([l.lineRef, l.title, l.variant, l.name].some(hasContact)) throw new PayloadError(`${where} line ${k}: contact data`);
      }
      orders += 1;
    }
  }
  if (orders > 5000) throw new PayloadError("upload: more than 5000 orders");
  return input as UploadInput;
}

// ---------------------------------------------------------------------------
// Server → database
// ---------------------------------------------------------------------------

type Scalar = string | number | null;

export type SessionPayload = {
  channel: "ebay";
  parser: string;
  parserVersion: number;
  coverage: { coveredFrom: string | null; coveredTo: string | null; recordFirst: number | null; recordLast: number | null; chainComplete: boolean };
  summary: Summary;
  files: {
    fileName: string; fingerprint: string; footerCount: number | null; orders: number;
    firstSoldOn: string | null; lastSoldOn: string | null; recordFirst: number | null; recordLast: number | null;
  }[];
  orders: {
    orderRef: string; recordNo: number | null; soldOn: string; paidOn: string | null; shippedOn: string | null;
    itemsValue: number; shipping: number; total: number; pieces: number; combined: boolean;
    destinationCountry: string | null; shippingService: string | null; sourceFile: string;
    lines: { lineRef: string | null; listingId: string; title: string; variant: string | null; name: string; quantity: number; unitPrice: number; value: number }[];
  }[];
  matches: {
    orderRef: string | null; saleId: number | null; saleUpdatedAt: string | null;
    category: string; certainty: string | null; score: number | null; dateDelta: number | null;
    competitors: { orderRef: string; saleId: number; score: number }[];
    reason: string | null;
    findings: { key: string; field: string; kind: string; ledger: Scalar; external: Scalar; delta: number | null; causes: { code: string; amount?: number }[] }[];
  }[];
};

const line = (l: ExternalLine) => ({
  lineRef: l.lineRef, listingId: l.listingId, title: l.title, variant: l.variant, name: l.name,
  quantity: l.quantity, unitPrice: l.unitPrice, value: l.value,
});

const order = (o: ExternalOrder) => ({
  orderRef: o.orderRef, recordNo: o.recordNo, soldOn: o.soldOn, paidOn: o.paidOn, shippedOn: o.shippedOn,
  itemsValue: o.itemsValue, shipping: o.shipping, total: o.total, pieces: o.pieces, combined: o.combined,
  destinationCountry: o.destinationCountry, shippingService: o.shippingService, sourceFile: o.sourceFile,
  lines: o.lines.map(line),
});

const finding = (f: Finding) => ({
  key: f.id, field: f.field, kind: f.kind, ledger: f.ledger, external: f.external, delta: f.delta,
  causes: f.causes.map((c) => (c.amount === undefined ? { code: c.code } : { code: c.code, amount: c.amount })),
});

function updatedAt(sale: LedgerSale): string {
  if (!sale.updatedAt) throw new PayloadError(`sale ${sale.saleId}: no updated_at — the snapshot is required`);
  return sale.updatedAt;
}

export function sessionPayload(input: {
  parser: string;
  parserVersion: number;
  files: readonly UploadFile[];
  orders: readonly ExternalOrder[];
  coverage: Coverage;
  rows: readonly ReconciliationRow[];
  summary: Summary;
}): SessionPayload {
  return {
    channel: "ebay",
    parser: input.parser,
    parserVersion: input.parserVersion,
    coverage: {
      coveredFrom: input.coverage.firstSoldOn, coveredTo: input.coverage.lastSoldOn,
      recordFirst: input.coverage.recordFirst, recordLast: input.coverage.recordLast,
      chainComplete: input.coverage.chainComplete,
    },
    summary: input.summary,
    files: input.files.map((f) => {
      const c = fileCoverage(f.report);
      return {
        fileName: f.report.fileName, fingerprint: f.fingerprint, footerCount: c.footerCount, orders: c.orders,
        firstSoldOn: c.firstSoldOn, lastSoldOn: c.lastSoldOn, recordFirst: c.recordFirst, recordLast: c.recordLast,
      };
    }),
    orders: input.orders.map(order),
    matches: input.rows.map((row) => {
      const e = row.entry;
      if (e.kind === "pair") {
        return {
          orderRef: e.order.orderRef, saleId: e.sale.saleId, saleUpdatedAt: updatedAt(e.sale),
          category: row.category, certainty: e.certainty, score: Math.round(e.score * 1000) / 1000,
          dateDelta: e.dateDelta, competitors: e.competitors, reason: null,
          findings: (row.diff?.findings ?? []).map(finding),
        };
      }
      if (e.kind === "external_only") {
        return {
          orderRef: e.order.orderRef, saleId: null, saleUpdatedAt: null, category: row.category,
          certainty: null, score: null, dateDelta: null, competitors: [], reason: null, findings: [],
        };
      }
      return {
        orderRef: null, saleId: e.sale.saleId, saleUpdatedAt: updatedAt(e.sale), category: row.category,
        certainty: null, score: null, dateDelta: null, competitors: [],
        reason: e.kind === "not_comparable" ? e.reason : null, findings: [],
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Database → server
// ---------------------------------------------------------------------------

type CandidateRow = {
  saleId: number; source: string; isTest: boolean; soldOn: string | null;
  itemsSubtotal: number | string; discount: number | string; shipping: number | string; refundsTotal: number | string;
  cancelledOn: string | null; externalOrderRef: string | null; updatedAt: string;
  pieces: { itemId: number; skyId: string | null; name: string | null; rawName: string | null; seriesCode: string | null; baseSkyId: string | null }[];
};

/** `seller_recon_candidates` → the matcher's model. Numerics may arrive as strings. */
export function ledgerSales(rows: unknown): LedgerSale[] {
  if (!Array.isArray(rows)) return [];
  return (rows as CandidateRow[]).map((r) => ({
    saleId: Number(r.saleId),
    source: r.source,
    isTest: r.isTest === true,
    soldOn: r.soldOn,
    itemsSubtotal: Number(r.itemsSubtotal),
    discount: Number(r.discount),
    shipping: Number(r.shipping),
    refundsTotal: Number(r.refundsTotal),
    cancelledOn: r.cancelledOn,
    externalOrderRef: r.externalOrderRef,
    updatedAt: r.updatedAt,
    pieces: (r.pieces ?? []).map((p) => ({
      itemId: Number(p.itemId), skyId: p.skyId, name: p.name, rawName: p.rawName,
      seriesCode: p.seriesCode, baseSkyId: p.baseSkyId,
    })),
  }));
}

/** `seller_recon_aliases` → the alias table. */
export function aliasIndex(value: unknown): AliasIndex {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return new Map();
  return new Map(Object.entries(value as Record<string, unknown>)
    .map(([sky, names]) => [sky, Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : []]));
}
