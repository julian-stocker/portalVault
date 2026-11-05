/**
 * Reconciliation sessions built the real way, for the SQL tests from 0179 on:
 * synthetic report → parser → the database's own candidates → matching →
 * payload → `seller_recon_create`. Plus the few calls a test needs around a
 * session (decide, apply, read) and one fingerprint over everything the
 * reconciliation and the sales book hold.
 */

import type { PGlite } from "@electric-sql/pglite";
import { coverageOf } from "../coverage";
import { mergeReports } from "../dedupe";
import { reconcile, summarize } from "../diff";
import { matchOrders } from "../match";
import { parseSalesReport } from "../registry";
import { aliasIndex, sessionPayload } from "../server/payload";
import { ledgerSales } from "../server/payload";
import { ebayReport, type FixtureOrder } from "../testing/ebay-fixture";
import { one } from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export type Spec = {
  ref: string | null; sold: string; shipping?: number; total?: number; lines: FixtureOrder["lines"];
  ledger: {
    sold: string; subtotal: number; discount?: number; shipping?: number; pieces: string[]; refunds?: number[];
    /** The sale already carries the order's number (stage A: a `deterministic` pair). From 0180 on. */
    carriesRef?: boolean;
    /** The sale was cancelled before the analysis. From 0180 on. */
    cancelled?: boolean;
  } | null;
};

/** Sales in SkyIsles and the report orders that go with them. */
export async function seedSales(db: PGlite, specs: readonly Spec[]): Promise<Map<string, number>> {
  const saleOf = new Map<string, number>();
  for (const [i, s] of specs.entries()) {
    if (!s.ledger) continue;
    const id = await one<number>(db,
      `insert into public.sales (channel, sold_at, items_subtotal, discount_amount, shipping_charged, source)
       values ('ebay', $1, $2, $3, $4, 'excel_order_2026') returning id`,
      [s.ledger.sold, s.ledger.subtotal, s.ledger.discount ?? 0, s.ledger.shipping ?? 5.49]);
    for (const [k, name] of s.ledger.pieces.entries()) {
      await db.query(`insert into public.sale_items (sale_id, position, raw_name) values ($1, $2, $3)`, [id, k + 1, name]);
    }
    for (const amount of s.ledger.refunds ?? []) {
      await db.query(`insert into public.sale_refunds (sale_id, amount) values ($1, $2)`, [id, amount]);
    }
    if (s.ledger.carriesRef) {
      await db.query(`update public.sales set external_order_ref = $2 where id = $1`, [id, s.ref]);
    }
    if (s.ledger.cancelled) {
      await db.query(`update public.sales set cancelled_at = $2::date where id = $1`, [id, s.ledger.sold]);
    }
    saleOf.set(s.ref ?? `ledger-${i}`, id);
  }
  return saleOf;
}

/** The whole analysis, as the server action runs it; `fingerprint` is one hex digit. */
export async function analyseSpecs(db: PGlite, specs: readonly Spec[], fingerprint = "b"): Promise<number> {
  let record = 1000;
  const orders: FixtureOrder[] = specs.filter((s) => s.ref !== null && s.lines.length > 0)
    .sort((a, b) => a.sold.localeCompare(b.sold)).map((s) => {
      record += s.lines.length > 1 ? s.lines.length + 1 : 1;
      return { ref: s.ref!, record, sold: s.sold, shipping: s.shipping, total: s.total, lines: s.lines };
    });
  const parsed = parseSalesReport(ebayReport(orders), "synthetic-2026.csv");
  if (!parsed.ok) throw new Error(parsed.error.code);
  const files = [{ fingerprint: fingerprint.repeat(64), report: parsed.report }];
  const merged = mergeReports(files);
  const coverage = coverageOf([parsed.report], merged.orders);
  const candidates = await one(db, `select public.seller_recon_candidates('ebay', $1, $2)`, [coverage.firstSoldOn, coverage.lastSoldOn]);
  const aliases = await one(db, `select public.seller_recon_aliases('ebay')`);
  const rows = reconcile(matchOrders(merged.orders, ledgerSales(candidates), coverage, { aliases: aliasIndex(aliases) }));
  const payload = sessionPayload({ parser: parsed.report.parser, parserVersion: parsed.report.parserVersion, files,
    orders: merged.orders, coverage, rows, summary: summarize(rows) });
  return one<number>(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(payload)]);
}

/**
 * A HAND-BUILT payload in the shape of the 0176 refusal probe (`miniPayload`):
 * one order, category `exact`, NO finding, amounts 1 / 0 / 1 — whatever the
 * sale really holds. The case of discarded session 3 on Staging.
 */
export async function contradictingSession(db: PGlite, saleId: number, soldOn: string, fingerprint = "9"): Promise<number> {
  const updatedAt = await one<string>(db, `select to_jsonb(updated_at) #>> '{}' from public.sales where id = $1`, [saleId]);
  const payload = {
    channel: "ebay", parser: "ebay-orders-report-de", parserVersion: 1,
    coverage: { coveredFrom: soldOn, coveredTo: soldOn, recordFirst: 1, recordLast: 1, chainComplete: true },
    summary: { categories: { exact: 1 } },
    files: [{ fileName: "verify-recon-refusals-x.csv", fingerprint: fingerprint.repeat(64), footerCount: 1, orders: 1,
      firstSoldOn: soldOn, lastSoldOn: soldOn, recordFirst: 1, recordLast: 1 }],
    orders: [{ orderRef: "VRF-0001", recordNo: 1, soldOn, paidOn: null, shippedOn: null, itemsValue: 1, shipping: 0, total: 1,
      pieces: 1, combined: false, destinationCountry: "DE", shippingService: null, sourceFile: "verify-recon-refusals-x.csv",
      lines: [{ lineRef: "1", listingId: "1", title: "Testposition", variant: null, name: "Testfigur", quantity: 1, unitPrice: 1, value: 1 }] }],
    matches: [{ orderRef: "VRF-0001", saleId, saleUpdatedAt: updatedAt, category: "exact", certainty: "deterministic",
      score: 100, dateDelta: 0, competitors: [], reason: null, findings: [] }],
  };
  return one<number>(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(payload)]);
}

export type FindingRow = { id: number; field: string; ledger_value: unknown; external_value: unknown };

export async function findingOf(db: PGlite, session: number, ref: string, field: string): Promise<FindingRow> {
  const r = await db.query<FindingRow>(`
    select f.id, f.field, f.ledger_value, f.external_value from public.sales_recon_findings f
      join public.sales_recon_matches m on m.id = f.match_id
      join public.sales_recon_orders o on o.id = m.order_id
     where m.session_id = $1 and o.order_ref = $2 and f.field = $3`, [session, ref, field]);
  if (r.rows.length !== 1) throw new Error(`no ${field} finding for ${ref}`);
  return r.rows[0];
}

export const decideOn = (db: PGlite, f: FindingRow, decision: string, manual: unknown = null, reason: string | null = null) =>
  one<number>(db, `select public.seller_recon_decide($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb)`,
    [f.id, decision, manual === null ? null : JSON.stringify(manual), reason, JSON.stringify(f.ledger_value), JSON.stringify(f.external_value)]);

export const applySession = (db: PGlite, session: number, expected: number) =>
  one<Json>(db, `select public.seller_recon_apply($1, $2)`, [session, expected]);

/** 0180: the preview of exactly these decisions, and the apply bound to its token. */
export const previewSelection = (db: PGlite, session: number, ids: readonly number[]) =>
  one<Json>(db, `select public.seller_recon_preview($1, $2::bigint[])`, [session, ids]);

export const applySelection = (db: PGlite, session: number, ids: readonly number[], token: string | null) =>
  one<Json>(db, `select public.seller_recon_apply($1, $2::bigint[], $3)`, [session, ids, token]);

export const readSession = (db: PGlite, session: number, category: string | null = null, offset = 0, limit = 200): Promise<Json> =>
  one(db, `select public.seller_recon_session($1, $2, $3, $4)`, [session, category, offset, limit]);

export const matchByRef = (page: Json, ref: string): Json => page.matches.find((m: Json) => m.order?.order_ref === ref);

/** Everything the reconciliation stores and the sales book holds, as one fingerprint. */
export const everything = (db: PGlite) => one<string>(db, `select md5(
  coalesce((select string_agg(to_jsonb(s)::text, ';' order by s.id) from public.sales s), '') || '|' ||
  coalesce((select string_agg(to_jsonb(i)::text, ';' order by i.id) from public.sale_items i), '') || '|' ||
  coalesce((select string_agg(to_jsonb(r)::text, ';' order by r.id) from public.sale_refunds r), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.sales_recon_sessions x), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.sales_recon_matches x), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.sales_recon_findings x), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.sales_recon_decisions x), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.sales_recon_applications x), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.orderbook_audit x), ''))`);
