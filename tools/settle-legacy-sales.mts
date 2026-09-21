/**
 * Close the workbook sale positions the reconciliation already accounted for.
 *
 *   npm run settle:legacy-sales:staging              preview, writes nothing
 *   npm run settle:legacy-sales:staging -- --apply   writes settled_at
 *
 * RUN THIS ONLY AFTER `reconcile:inventory` HAS BROUGHT STOCK ONTO COLUMN F.
 *
 * These positions were sold and never booked out. Their effect is already in
 * the workbook's final stock, and the reconciliation carried that onto the
 * shelf. Booking them out now would remove the same units a second time; so
 * they are closed WITHOUT a movement, through
 * `system_settle_reconciled_legacy_item` (0081), which writes one timestamp
 * and a note and cannot write anything else.
 *
 * The tool refuses to start until the shop matches the workbook, because the
 * order is the whole argument: closing first would leave the units on the
 * shelf with nothing left that says they should not be there.
 *
 * NOTHING IS HARDCODED. The population is whatever the database currently
 * shows as an open imported line: no counts, no SKY-IDs, no row numbers. One
 * environment having one such line and another having 187 must not change
 * how this behaves.
 */
import { openAsBlob } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireStagingIfRequested } from "./lib/staging-guard.mts";
import { readWorkbookParts } from "../src/lib/import/xlsx-reader.ts";
import { parseSharedStrings } from "../src/lib/import/sheet-rows.ts";
import { readCellGrid } from "../src/lib/import/cell-grid.ts";
import { indexCatalog, type CatalogEntry } from "../src/lib/orderbook/order-2026.ts";
import {
  LEGACY_CONDITION, WORKBOOK_SHEETS, isFixtureSkyId, resolveWorkbookPositions,
} from "../src/lib/orderbook/legacy-history.ts";

const WORKBOOK = process.env.SKYISLES_WORKBOOK
  ?? `${process.env.HOME}/Documents/eCommerce/skylanders.xlsx`;
const APPLY = process.argv.includes("--apply");
const SKIP_STOCK_GATE = process.argv.includes("--without-stock-gate");

requireStagingIfRequested("settle-legacy-sales");

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) { console.error(`Missing ${name}.`); process.exit(1); }
  return value;
};
const db: SupabaseClient = createClient(
  need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } });

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

console.log(`Target ${need("NEXT_PUBLIC_SUPABASE_URL")}`);
console.log(`Mode   ${APPLY ? "APPLY — writes settled_at" : "PREVIEW — writes nothing"}\n`);

/* ------------------------------------------ the precondition, actually checked */

const catalogRows = await page<{ sky_id: string; name: string; series_code: string; is_active: boolean }>(
  "skylanders", "sky_id, name, series_code, is_active", "sky_id");
const catalogIndex = indexCatalog(catalogRows.filter((row) => row.is_active)
  .map((row) => ({ skyId: row.sky_id, name: row.name, series: row.series_code }) as CatalogEntry));
const label = new Map(catalogRows.map((row) => [row.sky_id, `${row.name} [${row.series_code}]`]));

const blob = await openAsBlob(WORKBOOK);
const parts = await readWorkbookParts(blob, [...WORKBOOK_SHEETS]);
const shared = parseSharedStrings(parts.sharedStrings);
const { finalStock } = resolveWorkbookPositions(
  new Map(WORKBOOK_SHEETS.map((sheet) => [sheet, readCellGrid(parts.sheets.get(sheet) ?? "", shared)])),
  catalogIndex);

const inventory = await page<{ sky_id: string; condition: string; quantity: number }>(
  "shop_inventory", "sky_id, condition, quantity", "sky_id");
const held = new Map<string, number>();
for (const row of inventory) {
  if (isFixtureSkyId(row.sky_id) || row.condition !== LEGACY_CONDITION) continue;
  held.set(row.sky_id, row.quantity);
}
const offTarget = [...new Set([...finalStock.keys(), ...held.keys()])]
  .filter((skyId) => !isFixtureSkyId(skyId))
  .filter((skyId) => (held.get(skyId) ?? 0) !== (finalStock.get(skyId) ?? 0));

console.log(`── Precondition ──`);
console.log(`  positions still off the workbook target: ${offTarget.length}`);
if (offTarget.length > 0 && !SKIP_STOCK_GATE) {
  console.error("\nFAIL-CLOSED: reconcile the stock onto column F first; nothing was written.");
  for (const skyId of offTarget.slice(0, 10)) {
    console.error(`  ${skyId} ${label.get(skyId) ?? ""}: shop ${held.get(skyId) ?? 0}, workbook ${finalStock.get(skyId) ?? 0}`);
  }
  process.exit(1);
}

/* ------------------------------------------------------------- the population */

type Item = {
  id: number; sale_id: number; sky_id: string | null; raw_name: string | null;
  source_row: number | null; movement_id: number | null; return_movement_id: number | null;
  settled_at: string | null; not_shipped_at: string | null; legacy_stock_flag: string | null;
};
const items = await page<Item>("sale_items",
  "id, sale_id, sky_id, raw_name, source_row, movement_id, return_movement_id, settled_at, not_shipped_at, legacy_stock_flag",
  "id");
type Sale = { id: number; source: string; is_test: boolean; cancelled_at: string | null;
              stock_released_at: string | null; order_id: number | null };
const sales = await page<Sale>("sales",
  "id, source, is_test, cancelled_at, stock_released_at, order_id", "id");
const saleById = new Map(sales.map((sale) => [sale.id, sale]));

const open: Item[] = [];
const blocked: string[] = [];
for (const item of items) {
  const sale = saleById.get(item.sale_id);
  if (!sale || sale.source !== "excel_order_2026") continue;
  if (item.settled_at !== null || item.not_shipped_at !== null) continue;
  if (item.movement_id !== null || item.return_movement_id !== null) continue;
  // The workbook's own outcome wins wherever it has one.
  if ((item.legacy_stock_flag ?? "") !== "") continue;

  if (sale.is_test || sale.cancelled_at !== null) {
    blocked.push(`item ${item.id}: sale ${sale.id} is a test or was cancelled`); continue;
  }
  if (sale.order_id !== null) {
    blocked.push(`item ${item.id}: sale ${sale.id} belongs to an order`); continue;
  }
  if (sale.stock_released_at === null) {
    blocked.push(`item ${item.id}: sale ${sale.id} has not been released (0071)`); continue;
  }
  open.push(item);
}

const withFigure = open.filter((item) => item.sky_id !== null);
const withoutFigure = open.filter((item) => item.sky_id === null);
const figures = new Set(withFigure.map((item) => item.sky_id!));

console.log("\n── Open imported positions ──");
console.log(`  closable ....................... ${open.length}`);
console.log(`    with a catalog figure ........ ${withFigure.length} on ${figures.size} figures`);
console.log(`    without one .................. ${withoutFigure.length}`);
console.log(`  held back ...................... ${blocked.length}`);
for (const reason of blocked.slice(0, 10)) console.log(`    ${reason}`);

if (open.length === 0) {
  console.log("\nNothing to close.");
  process.exit(0);
}
if (!APPLY) {
  console.log("\nPreview only. Re-run with --apply to write.");
  process.exit(0);
}

/* ------------------------------------------------------------------- the apply */

const movementsBefore = await db.from("inventory_movements").select("*", { count: "exact", head: true });
let closed = 0;
for (const item of open) {
  const { error } = await db.rpc("system_settle_reconciled_legacy_item", { p_item_id: item.id });
  if (error) {
    console.error(`\nitem ${item.id}: ${error.message}`);
    console.error(`${closed} position(s) were closed before this point; re-running is safe and idempotent.`);
    process.exit(1);
  }
  closed += 1;
  if (closed % 50 === 0 || closed === open.length) console.log(`  ${closed}/${open.length}`);
}
const movementsAfter = await db.from("inventory_movements").select("*", { count: "exact", head: true });
console.log(`\nDone. ${closed} position(s) closed.`);
console.log(`inventory_movements: ${movementsBefore.count} before, ${movementsAfter.count} after `
  + `(${movementsAfter.count === movementsBefore.count ? "unchanged, as intended" : "CHANGED — investigate"}).`);
process.exit(movementsAfter.count === movementsBefore.count ? 0 : 1);
