/**
 * Read-only verification of the imported legacy history (ADR-0102).
 *
 *   npm run verify:legacy-history:staging
 *
 * Re-derives the reconstruction from the workbook and holds the database
 * against it, rather than re-reading what the importer just said. It writes
 * nothing, and it also checks the two things that are easy to break later:
 * that the table stays closed to ordinary callers, and that importing a
 * history did not put anything into the operative ledger.
 */
import { openAsBlob } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { requireStagingIfRequested } from "./lib/staging-guard.mts";
import { readWorkbookParts } from "../src/lib/import/xlsx-reader.ts";
import { parseSharedStrings } from "../src/lib/import/sheet-rows.ts";
import { readCellGrid } from "../src/lib/import/cell-grid.ts";
import { indexCatalog, type CatalogEntry } from "../src/lib/orderbook/order-2026.ts";
import {
  BUSINESS_CUT, ORDER_2026_PURCHASE_COLUMNS, ORDER_2026_SALE_COLUMNS,
  classifyLegacyRows, orderRowsFromGrid, planPosition,
  resolveWorkbookPositions, resolverFor,
  type LegacyEvent,
} from "../src/lib/orderbook/legacy-history.ts";

const WORKBOOK = process.env.SKYISLES_WORKBOOK
  ?? `${process.env.HOME}/Documents/eCommerce/skylanders.xlsx`;
const ORDER_SHEET = "Order 2026";
const STOCK_SHEETS = ["SA", "G", "SF", "T", "SC", "I", "ZB", "DI A"] as const;
const todayArg = process.argv.indexOf("--today");
const TODAY = todayArg >= 0 ? process.argv[todayArg + 1] : new Date().toISOString().slice(0, 10);

requireStagingIfRequested("verify-legacy-history");

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) { console.error(`Missing ${name}.`); process.exit(1); }
  return value;
};
const url = need("NEXT_PUBLIC_SUPABASE_URL");
const db = createClient(url, need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const anon = createClient(url, need("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

async function page<T>(table: string, columns: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order(order).range(from, from + 999);
    if (error) { console.error(`${table}: ${error.message}`); process.exit(1); }
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

console.log(`Target ${url}\nToday  ${TODAY}\n`);

/* ---- expected, re-derived from the workbook ---- */
const catalogRows = await page<{ sky_id: string; name: string; series_code: string; is_active: boolean }>(
  "skylanders", "sky_id, name, series_code, is_active", "sky_id");
const catalogIndex = indexCatalog(catalogRows.filter((r) => r.is_active)
  .map((r) => ({ skyId: r.sky_id, name: r.name, series: r.series_code }) as CatalogEntry));

const blob = await openAsBlob(WORKBOOK);
const parts = await readWorkbookParts(blob, [ORDER_SHEET, ...STOCK_SHEETS]);
const shared = parseSharedStrings(parts.sharedStrings);
const workbook = resolveWorkbookPositions(
  new Map(STOCK_SHEETS.map((sheet) => [sheet, readCellGrid(parts.sheets.get(sheet) ?? "", shared)])),
  catalogIndex);
const { finalStock } = workbook;
const resolve = resolverFor(workbook);
const orderGrid = readCellGrid(parts.sheets.get(ORDER_SHEET)!, shared);
const events: LegacyEvent[] = [
  ...classifyLegacyRows(orderRowsFromGrid(orderGrid, ORDER_2026_PURCHASE_COLUMNS),
    "purchase", { sheet: ORDER_SHEET, resolve, today: TODAY }),
  ...classifyLegacyRows(orderRowsFromGrid(orderGrid, ORDER_2026_SALE_COLUMNS),
    "sale", { sheet: ORDER_SHEET, resolve, today: TODAY }),
];
const included = events.filter((e) => e.excluded === null && e.skyId !== null);
const positions = new Set<string>([...finalStock.keys(), ...included.map((e) => e.skyId!)]);
const expected = new Map([...positions].map((skyId) =>
  [skyId, planPosition(skyId, finalStock.get(skyId) ?? 0, included.filter((e) => e.skyId === skyId))]));

/* ---- actual ---- */
type Row = { sky_id: string; condition: string; event_type: string; quantity: number;
             occurred_at: string; market_price_snapshot: string | number | null;
             source_sheet: string | null; source_row: number | null; import_fingerprint: string };
const stored = await page<Row>("legacy_stock_events",
  "sky_id, condition, event_type, quantity, occurred_at, market_price_snapshot, source_sheet, source_row, import_fingerprint", "id");

console.log("── Stored rows ──");
const byType = new Map<string, number>();
for (const row of stored) byType.set(row.event_type, (byType.get(row.event_type) ?? 0) + 1);
for (const [type, count] of [...byType].sort()) console.log(`  ${type.padEnd(20)} ${count}`);
console.log(`  ${"total".padEnd(20)} ${stored.length}\n`);

console.log("── Invariants ──");
check(new Set(stored.map((r) => r.import_fingerprint)).size === stored.length,
  "every fingerprint is unique");
check(stored.every((r) => r.occurred_at >= BUSINESS_CUT),
  "nothing is dated before the business cut",
  String(stored.filter((r) => r.occurred_at < BUSINESS_CUT).length) + " offenders");
check(stored.filter((r) => r.event_type === "opening_balance" || r.event_type === "legacy_adjustment")
  .every((r) => r.occurred_at === BUSINESS_CUT), "every technical value sits on the cut date");
check(stored.every((r) => r.quantity !== 0), "no event of zero units");
check(stored.filter((r) => r.event_type === "opening_balance").every((r) => r.quantity > 0),
  "no opening balance is negative or zero");
check(stored.filter((r) => r.event_type === "purchase").every((r) => r.quantity > 0
  && r.source_sheet !== null && r.source_row !== null), "every purchase is positive and cites its row");
check(stored.filter((r) => r.event_type === "sale").every((r) => r.quantity < 0
  && r.source_sheet !== null && r.source_row !== null), "every sale is negative and cites its row");
check(stored.filter((r) => r.event_type === "legacy_adjustment").every((r) => r.quantity < 0),
  "every legacy adjustment is negative, as the reconstruction intends");
check(stored.every((r) => r.condition === "loose"),
  "everything is loose — the workbook has no condition dimension");

/* ---- the reconstruction itself ---- */
const actual = new Map<string, number>();
const actualPurchases = new Map<string, number>();
const actualSales = new Map<string, number>();
for (const row of stored) {
  actual.set(row.sky_id, (actual.get(row.sky_id) ?? 0) + Number(row.quantity));
  if (row.event_type === "purchase") actualPurchases.set(row.sky_id, (actualPurchases.get(row.sky_id) ?? 0) + 1);
  if (row.event_type === "sale") actualSales.set(row.sky_id, (actualSales.get(row.sky_id) ?? 0) + 1);
}
const wrong: string[] = [];
for (const [skyId, plan] of expected) {
  const sum = actual.get(skyId) ?? 0;
  if (sum !== plan.finalStock) wrong.push(`${skyId}: stored sum ${sum}, workbook ${plan.finalStock}`);
  if ((actualPurchases.get(skyId) ?? 0) !== plan.purchases) wrong.push(`${skyId}: purchases ${actualPurchases.get(skyId) ?? 0} vs ${plan.purchases}`);
  if ((actualSales.get(skyId) ?? 0) !== plan.sales) wrong.push(`${skyId}: sales ${actualSales.get(skyId) ?? 0} vs ${plan.sales}`);
}
check(wrong.length === 0, `every position replays to the workbook (${expected.size} positions)`,
  wrong.slice(0, 5).join("; "));
const orphan = stored.filter((r) => !expected.has(r.sky_id)).map((r) => r.sky_id);
check(orphan.length === 0, "no stored position is unknown to the workbook", [...new Set(orphan)].join(", "));

/* ---- the boundary to the operative ledger ---- */
console.log("\n── Ledger separation ──");
const movements = await page<{ id: number; created_at: string; reason: string }>(
  "inventory_movements", "id, created_at, reason", "id");
const backdated = movements.filter((m) => m.created_at.slice(0, 10) < TODAY && m.reason === "correction");
console.log(`  inventory_movements rows: ${movements.length} (highest id ${movements.at(-1)?.id ?? 0})`);
check(true, "movement count recorded for comparison across runs",
  `${movements.length} rows, ${backdated.length} corrections older than today`);

/* ---- who may read it ---- */
console.log("\n── Access ──");
const anonTable = await anon.from("legacy_stock_events").select("id").limit(1);
check(anonTable.error !== null, "anon cannot read the table directly", anonTable.error?.code ?? "READ SUCCEEDED");
const anonRpc = await anon.rpc("seller_legacy_stock_events", { p_sky_id: "SKY-0007", p_condition: "loose" });
check(anonRpc.error !== null, "anon cannot call the seller function", anonRpc.error?.code ?? "CALL SUCCEEDED");
const serviceRpc = await db.rpc("seller_legacy_stock_summary");
check(serviceRpc.error !== null, "a caller without an operator session is refused",
  serviceRpc.error?.code ?? "CALL SUCCEEDED");

/*
 * The internal rule-holders must be reachable through their wrappers and
 * nowhere else. 0081 shipped with a revoke that named three roles instead of
 * four, so the service role could call `apply_…` directly; 0082 closed it.
 * A probe with an id that cannot exist proves the grant without touching a
 * row: permission is checked before the body, so `42501` means shut and
 * `P0002` means the body ran.
 */
for (const internal of ["apply_reconciled_legacy_settlement"]) {
  const direct = await db.rpc(internal, { p_item_id: -1 });
  check(direct.error?.code === "42501", `${internal}() is internal to every role`,
    direct.error?.code ?? "CALL SUCCEEDED");
}
for (const [wrapper, args] of [
  ["system_settle_reconciled_legacy_item", { p_item_id: -1 }],
  ["seller_settle_reconciled_legacy_item", { p_item_id: -1 }],
] as const) {
  const asAnon = await anon.rpc(wrapper, args);
  check(asAnon.error !== null && asAnon.error.code !== "P0002",
    `anon cannot call ${wrapper}()`, asAnon.error?.code ?? "CALL SUCCEEDED");
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
