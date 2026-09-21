/**
 * Bring the operative stock onto the workbook's column F (ADR-0102).
 *
 *   npm run reconcile:inventory:staging              preview, writes nothing
 *   npm run reconcile:inventory:staging -- --apply   writes correction movements
 *
 * STRICTLY SEPARATE FROM `legacy_stock_events`. That table reconstructs what
 * the 2026 business year looked like and moves nothing. This moves real
 * stock, through the ordinary ledger, with one append-only `correction`
 * movement per position that disagrees with the workbook.
 *
 * IT DOES NOT TOUCH `shop_inventory.quantity` ITSELF.
 *
 * Every change goes through `system_record_inventory_movement`, which is the
 * same `apply_inventory_movement` the shop uses: it locks the position, moves
 * the quantity and journals the movement in one transaction, and its UPDATE
 * carries `quantity + delta >= reserved` in the WHERE clause. So a correction
 * that would drop a position below what customers have reserved fails at the
 * database rather than being caught by a check this tool did first. This tool
 * checks it too — in the plan, before anything is written — but the guard
 * that matters is the one that cannot be raced.
 *
 * ONE MOVEMENT PER POSITION, AND ONLY FOR A DIFFERENCE. A position already on
 * target is skipped; nothing is written to say so. That is what makes the
 * second run a no-op instead of a second set of zero-value corrections.
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

requireStagingIfRequested("reconcile-inventory");

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) { console.error(`Missing ${name}. Run through npm, which loads the env file.`); process.exit(1); }
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

console.log(`Workbook  ${WORKBOOK}`);
console.log(`Target    ${need("NEXT_PUBLIC_SUPABASE_URL")}`);
console.log(`Mode      ${APPLY ? "APPLY — writes correction movements" : "PREVIEW — writes nothing"}\n`);

/* ------------------------------------------------------- what the workbook says */

const catalogRows = await page<{ sky_id: string; name: string; series_code: string; is_active: boolean }>(
  "skylanders", "sky_id, name, series_code, is_active", "sky_id");
const catalogIndex = indexCatalog(catalogRows.filter((row) => row.is_active)
  .map((row) => ({ skyId: row.sky_id, name: row.name, series: row.series_code }) as CatalogEntry));
const label = new Map(catalogRows.map((row) => [row.sky_id, `${row.name} [${row.series_code}]`]));
const known = new Set(catalogRows.map((row) => row.sky_id));

const blob = await openAsBlob(WORKBOOK);
const parts = await readWorkbookParts(blob, [...WORKBOOK_SHEETS]);
const shared = parseSharedStrings(parts.sharedStrings);
const { finalStock } = resolveWorkbookPositions(
  new Map(WORKBOOK_SHEETS.map((sheet) => [sheet, readCellGrid(parts.sheets.get(sheet) ?? "", shared)])),
  catalogIndex);

/* ------------------------------------------------------------ what the shop has */

type InventoryRow = { sky_id: string; condition: string; quantity: number; reserved: number };
const inventory = await page<InventoryRow>(
  "shop_inventory", "sky_id, condition, quantity, reserved", "sky_id");

const held = new Map<string, InventoryRow>();
const otherConditions: InventoryRow[] = [];
for (const row of inventory) {
  if (isFixtureSkyId(row.sky_id)) continue;
  if (row.condition === LEGACY_CONDITION) held.set(row.sky_id, row);
  else otherConditions.push(row);
}

/* ------------------------------------------------------------------- the plan */

type Step = {
  skyId: string; condition: string; current: number; target: number;
  delta: number; reserved: number;
};
const steps: Step[] = [];
const problems: string[] = [];

for (const skyId of new Set([...finalStock.keys(), ...held.keys()])) {
  if (isFixtureSkyId(skyId)) { problems.push(`${skyId}: a fixture reached the plan`); continue; }
  if (!known.has(skyId)) { problems.push(`${skyId}: unknown to the catalog`); continue; }
  // A position the shop holds but the workbook never mentions is NOT a
  // silent zero. It means the workbook row failed to resolve, or the shop
  // holds something the stock-take does not know about — either way a
  // person decides, not a delta that empties the position.
  if (!finalStock.has(skyId)) {
    problems.push(`${skyId}: the shop holds ${held.get(skyId)?.quantity ?? 0} but the workbook has no row for it`);
    continue;
  }

  const target = finalStock.get(skyId) ?? 0;
  const row = held.get(skyId);
  const current = row?.quantity ?? 0;
  const reserved = row?.reserved ?? 0;

  if (target < 0) { problems.push(`${skyId}: workbook target is ${target}`); continue; }
  if (current === target) continue;

  // The database refuses this too; refusing here means refusing before the
  // first write rather than halfway through the run.
  if (target < reserved) {
    problems.push(`${skyId}: target ${target} is below the ${reserved} reserved for customers`);
    continue;
  }
  steps.push({ skyId, condition: LEGACY_CONDITION, current, target, delta: target - current, reserved });
}

/*
 * BOXED IS OUT OF SCOPE, AND SAYING SO IS THE POINT.
 *
 * The workbook has no condition dimension at all — column F is one number
 * per figure — so it can target `loose` and nothing else. Reconciling a
 * boxed position against a loose figure would be reading a number the source
 * does not contain, and quietly skipping it would hide stock.
 *
 * So these are listed, left exactly as they are, and counted apart from the
 * target. Production holds no boxed stock outside the fixtures today; if
 * that list is ever non-empty there, it is a question for a person before
 * the run, not a delta.
 */


/* ----------------------------------------------------------------- the preview */

steps.sort((a, b) => (a.delta === b.delta ? a.skyId.localeCompare(b.skyId) : a.delta - b.delta));

console.log("── Plan ──");
console.log(`  ${"SKY-ID".padEnd(9)} ${"Name".padEnd(38)} ${"Cond".padEnd(6)} ${"Ist".padStart(5)} ${"Ziel F".padStart(7)} ${"Delta".padStart(6)}`);
for (const step of steps) {
  console.log(`  ${step.skyId.padEnd(9)} ${String(label.get(step.skyId) ?? "?").slice(0, 38).padEnd(38)} `
    + `${step.condition.padEnd(6)} ${String(step.current).padStart(5)} ${String(step.target).padStart(7)} `
    + `${(step.delta > 0 ? "+" : "") + step.delta}`.padStart(7));
}

const outgoing = steps.filter((step) => step.delta < 0);
const incoming = steps.filter((step) => step.delta > 0);
const currentTotal = [...held.values()].reduce((sum, row) => sum + row.quantity, 0);
const targetTotal = [...new Set([...finalStock.keys(), ...held.keys()])]
  .filter((skyId) => !isFixtureSkyId(skyId))
  .reduce((sum, skyId) => sum + (finalStock.get(skyId) ?? 0), 0);
const fixtureRows = inventory.filter((row) => isFixtureSkyId(row.sky_id));
const fixtureTotal = fixtureRows.reduce((sum, row) => sum + row.quantity, 0);

console.log("\n── Totals ──");
console.log(`  positions needing a correction ... ${steps.length}`);
console.log(`    outgoing (−) .................. ${outgoing.length} positions, ${outgoing.reduce((s, x) => s + x.delta, 0)} units`);
console.log(`    incoming (+) .................. ${incoming.length} positions, +${incoming.reduce((s, x) => s + x.delta, 0)} units`);
console.log(`  net movement ..................... ${steps.reduce((s, x) => s + x.delta, 0)}`);
console.log(`  stock now (non-fixture, loose) ... ${currentTotal}`);
console.log(`  stock after ...................... ${targetTotal}   (= workbook column F)`);
console.log(`  fixtures, left untouched ......... ${fixtureTotal} units in ${fixtureRows.length} rows`);
console.log(`  reserved across all positions .... ${inventory.reduce((s, r) => s + r.reserved, 0)}`);

if (otherConditions.length > 0) {
  const units = otherConditions.reduce((sum, row) => sum + row.quantity, 0);
  console.log(`\n── Out of scope: ${otherConditions.length} non-loose position(s), ${units} unit(s), untouched ──`);
  for (const row of otherConditions) {
    console.log(`  ${row.sky_id.padEnd(9)} ${String(label.get(row.sky_id) ?? "?").slice(0, 38).padEnd(38)} `
      + `${row.condition.padEnd(6)} ${String(row.quantity).padStart(5)} units, ${row.reserved} reserved`);
  }
  console.log("  The workbook has no condition dimension and cannot target these.");
}

if (problems.length > 0) {
  console.error(`\nFAIL-CLOSED: ${problems.length} problem(s); nothing was written.`);
  for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("\nGate passed: every target is a known catalog figure, non-negative and above its reserved quantity.");

if (steps.length === 0) {
  console.log("\nNothing to reconcile — the shop already matches the workbook.");
  process.exit(0);
}
if (!APPLY) {
  console.log("\nPreview only. Re-run with --apply to write.");
  process.exit(0);
}

/* ------------------------------------------------------------------- the apply */

let written = 0;
for (const step of steps) {
  const { error } = await db.rpc("system_record_inventory_movement", {
    p_sky_id: step.skyId,
    p_condition: step.condition,
    p_delta: step.delta,
    p_reason: "correction",
    p_note: `Legacy-Abgleich auf Excel F (${step.current} → ${step.target}).`,
  });
  if (error) {
    console.error(`\n${step.skyId}: ${error.message}`);
    console.error(`${written} correction(s) were written before this point. They are append-only and correct;`);
    console.error("re-run the tool to continue — it recomputes the remaining difference from scratch.");
    process.exit(1);
  }
  written += 1;
  if (written % 25 === 0 || written === steps.length) console.log(`  ${written}/${steps.length}`);
}
console.log(`\nDone. ${written} correction movement(s) written.`);
