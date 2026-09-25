/**
 * Import the reconstructed 2026 legacy stock history (ADR-0102).
 *
 *   npm run legacy:history:staging              preview, writes nothing
 *   npm run legacy:history:staging -- --apply   inserts what is missing
 *
 * IT WRITES ONE TABLE AND NOTHING ELSE. No `inventory_movements`, no
 * `shop_inventory`, no purchase and no sale. The reconstructed history is
 * additive and never touches the operative ledger — bringing the real stock
 * onto the workbook's figure is a separate, append-only reconciliation run.
 *
 * THIS TOOL ONLY EVER INSERTS, because the table is append-only (0079) and
 * stays that way. When a corrected workbook makes rows change or fall out of
 * the plan, the run names them and refuses: removing them is a deliberate,
 * separately reviewed act; the one it was done with is a protocol now
 * (`docs/history/2026-09-22-phase-c-legacy-history-prune.md`).
 * See the reconciliation block below for why a fingerprint alone is not
 * enough to notice a changed opening balance.
 *
 * WHY THE SERVICE ROLE HERE, AGAINST THE USUAL RULE
 *
 * `0052` taught us to import through the seller functions, because a
 * service-role proof proves nothing about authorization. That rule is about
 * PRODUCT paths — purchases and sales a Seller Operator also creates by hand.
 * `legacy_stock_events` has no product write path by design: RLS is closed,
 * there is no insert function, and the only reader is a seller-gated view.
 * A one-shot reconstruction written once by a migration tool is the whole
 * lifecycle, so there is no authorization story to get wrong.
 *
 * IDEMPOTENT BY FINGERPRINT. Every row carries a deterministic readable key
 * with a unique index behind it. A second run inserts nothing; a half-finished
 * run resumes exactly where it stopped.
 *
 * THE WORKBOOK IS READ SELECTIVELY AND NEVER WRITTEN.
 */
import { openAsBlob } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireStagingIfRequested } from "./lib/staging-guard.mts";
import { readWorkbookParts } from "../src/lib/import/xlsx-reader.ts";
import { parseSharedStrings } from "../src/lib/import/sheet-rows.ts";
import { readCellGrid } from "../src/lib/import/cell-grid.ts";
import { indexCatalog, type CatalogEntry } from "../src/lib/orderbook/order-2026.ts";
import {
  BUSINESS_CUT, LEGACY_CONDITION, classifyLegacyRows, eventFingerprint,
  ORDER_2026_PURCHASE_COLUMNS, ORDER_2026_SALE_COLUMNS,
  orderRowsFromGrid, planPosition, planProblems, resolveWorkbookPositions,
  resolverFor, technicalFingerprint,
  type LegacyEvent, type PositionPlan,
} from "../src/lib/orderbook/legacy-history.ts";

const WORKBOOK = process.env.SKYISLES_WORKBOOK
  ?? `${process.env.HOME}/Documents/eCommerce/skylanders.xlsx`;
const ORDER_SHEET = "Order 2026";
const STOCK_SHEETS = ["SA", "G", "SF", "T", "SC", "I", "ZB", "DI A"] as const;
const APPLY = process.argv.includes("--apply");

/**
 * The classification date, fixed rather than read from the clock.
 *
 * `--today` exists for tests. Without it the run uses the real date, and the
 * report prints which one it used, because the future-dated group is decided
 * by exactly this comparison and a silent clock would make the import
 * irreproducible.
 */
const todayArg = process.argv.indexOf("--today");
const TODAY = todayArg >= 0 ? process.argv[todayArg + 1] : new Date().toISOString().slice(0, 10);

requireStagingIfRequested("import-legacy-history");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) { console.error(`Missing ${name}. Run through npm, which loads the env file.`); process.exit(1); }
  return value;
}

const db: SupabaseClient = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

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

/* ---------------------------------------------------------------- workbook */

/* -------------------------------------------------------------------- main */

console.log(`Workbook  ${WORKBOOK}`);
console.log(`Target    ${requireEnv("NEXT_PUBLIC_SUPABASE_URL")}`);
console.log(`Today     ${TODAY}   (business cut ${BUSINESS_CUT})`);
console.log(`Mode      ${APPLY ? "APPLY — writes legacy_stock_events" : "PREVIEW — writes nothing"}\n`);

const catalogRows = await page<{ sky_id: string; name: string; series_code: string; is_active: boolean; market_price: string | number | null }>(
  "skylanders", "sky_id, name, series_code, is_active, market_price", "sky_id");
const catalog: CatalogEntry[] = catalogRows.filter((row) => row.is_active)
  .map((row) => ({ skyId: row.sky_id, name: row.name, series: row.series_code }));
const catalogIndex = indexCatalog(catalog);
const marketPrice = new Map(catalogRows.map((row) =>
  [row.sky_id, row.market_price === null || row.market_price === undefined ? null : Number(row.market_price)]));

const blob = await openAsBlob(WORKBOOK);
const parts = await readWorkbookParts(blob, [ORDER_SHEET, ...STOCK_SHEETS]);
const shared = parseSharedStrings(parts.sharedStrings);
const orderXml = parts.sheets.get(ORDER_SHEET);
if (!orderXml) { console.error(`Sheet "${ORDER_SHEET}" not found.`); process.exit(1); }

const workbook = resolveWorkbookPositions(
  new Map(STOCK_SHEETS.map((sheet) => [sheet, readCellGrid(parts.sheets.get(sheet) ?? "", shared)])),
  catalogIndex);
const { finalStock } = workbook;
const resolve = resolverFor(workbook);

const orderGrid = readCellGrid(orderXml, shared);
const events: LegacyEvent[] = [
  ...classifyLegacyRows(
    orderRowsFromGrid(orderGrid, ORDER_2026_PURCHASE_COLUMNS),
    "purchase", { sheet: ORDER_SHEET, resolve, today: TODAY }),
  ...classifyLegacyRows(
    orderRowsFromGrid(orderGrid, ORDER_2026_SALE_COLUMNS),
    "sale", { sheet: ORDER_SHEET, resolve, today: TODAY }),
];

const included = events.filter((event) => event.excluded === null && event.skyId !== null);
const positions = new Set<string>([...finalStock.keys(), ...included.map((event) => event.skyId!)]);
const plans: PositionPlan[] = [...positions].sort().map((skyId) =>
  planPosition(skyId, finalStock.get(skyId) ?? 0, included.filter((event) => event.skyId === skyId)));

/* ---------------------------------------------------------- the fail gate */

const problems = planProblems(plans);
const unknownFigures = [...positions].filter((skyId) => !marketPrice.has(skyId));
if (unknownFigures.length > 0) {
  problems.push(...unknownFigures.map((skyId) => ({ skyId, problem: "not in the catalog" })));
}

console.log("── Reconstruction ──");
console.log(`  positions ................ ${plans.length}`);
console.log(`  purchase events .......... ${included.filter((e) => e.kind === "purchase").length}`);
console.log(`  sale events .............. ${included.filter((e) => e.kind === "sale").length}`);
console.log(`  return events ............ ${included.filter((e) => e.kind === "return").length}`);
console.log(`  correction events ........ ${included.filter((e) => e.kind === "correction").length}`);
console.log(`  opening_balance > 0 ...... ${plans.filter((p) => p.openingBalance > 0).length}  sum ${plans.reduce((s, p) => s + p.openingBalance, 0)}`);
console.log(`  legacy_adjustment ........ ${plans.filter((p) => p.legacyAdjustment !== 0).length}  sum ${plans.reduce((s, p) => s + p.legacyAdjustment, 0)}`);
console.log(`  reconstructed == workbook  ${plans.filter((p) => p.reconstructedFinal === p.finalStock).length}/${plans.length}`);
console.log(`  workbook total ........... ${plans.reduce((s, p) => s + p.finalStock, 0)}`);

const byReason = new Map<string, number>();
for (const event of events) if (event.excluded) byReason.set(event.excluded, (byReason.get(event.excluded) ?? 0) + 1);
console.log("\n── Excluded source rows ──");
for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason.padEnd(22)} ${count}`);
}
const future = events.filter((event) => event.excluded === "future_date");
if (future.length > 0) {
  console.log(`\n  future-dated and deliberately NOT imported (${future.length}):`);
  for (const event of future) {
    console.log(`    row ${event.sourceRow}  ${event.occurredAt}  "${event.rawName}"  ${event.skyId}`);
  }
}

if (problems.length > 0) {
  console.error(`\nFAIL-CLOSED: ${problems.length} problem(s); nothing was written.`);
  for (const problem of problems.slice(0, 40)) console.error(`  ${problem.skyId}: ${problem.problem}`);
  process.exit(1);
}
console.log("\nGate passed: every position reconstructs to the workbook and no opening balance is negative.");

/* -------------------------------------------------------------- the rows */

type EventRow = {
  sky_id: string; condition: string; event_type: string; quantity: number;
  occurred_at: string; market_price_snapshot: number | null;
  source_sheet: string | null; source_row: number | null;
  import_fingerprint: string; note: string | null;
};

const rows: EventRow[] = [];
for (const plan of plans) {
  const price = marketPrice.get(plan.skyId) ?? null;
  if (plan.openingBalance > 0) {
    rows.push({
      sky_id: plan.skyId, condition: plan.condition, event_type: "opening_balance",
      quantity: plan.openingBalance, occurred_at: BUSINESS_CUT, market_price_snapshot: price,
      source_sheet: null, source_row: null,
      import_fingerprint: technicalFingerprint("opening_balance", plan.skyId, plan.condition),
      note: "Technischer Startbestand zum Business-Start. Kein Einkauf.",
    });
  }
  if (plan.legacyAdjustment !== 0) {
    rows.push({
      sky_id: plan.skyId, condition: plan.condition, event_type: "legacy_adjustment",
      quantity: plan.legacyAdjustment, occurred_at: BUSINESS_CUT, market_price_snapshot: price,
      source_sheet: null, source_row: null,
      import_fingerprint: technicalFingerprint("legacy_adjustment", plan.skyId, plan.condition),
      note: "Historischer Bestandsabgleich aufgrund unvollständig rekonstruierbarer Legacy-Daten. Kein realer physischer Lagerbestand.",
    });
  }
}
for (const event of included) {
  rows.push({
    sky_id: event.skyId!, condition: LEGACY_CONDITION, event_type: event.kind,
    quantity: event.quantity, occurred_at: event.occurredAt,
    market_price_snapshot: marketPrice.get(event.skyId!) ?? null,
    source_sheet: event.sourceSheet, source_row: event.sourceRow,
    import_fingerprint: eventFingerprint(event),
    note: event.rawName,
  });
}

const duplicates = rows.length - new Set(rows.map((row) => row.import_fingerprint)).size;
if (duplicates > 0) {
  console.error(`\nFAIL-CLOSED: ${duplicates} duplicate fingerprint(s) in the plan; nothing was written.`);
  process.exit(1);
}

/*
 * WAS IN DER DATENBANK STEHT — UND OB ES NOCH STIMMT.
 *
 * Bis hierher war dieser Import rein additiv: was der Abdruck schon kennt,
 * bleibt liegen. Das trägt, solange die Arbeitsmappe nur wächst. Es trägt
 * NICHT, wenn der Verkäufer eine Zeile korrigiert:
 *
 *   · Eine Zeile verschwindet aus dem Plan (ein `x` wurde zu `-`) — ihr
 *     Ereignis bleibt sonst für immer in der Historie stehen.
 *   · Der TECHNISCHE Abdruck von `opening_balance` und `legacy_adjustment`
 *     ist `(Art, Figur, Zustand)` und enthält KEINE Menge. Ändert sich der
 *     Startbestand einer Figur, trägt die alte Zeile denselben Abdruck und
 *     gilt als „schon da" — die Datenbank behielte stillschweigend die alte
 *     Zahl, und die Summe stimmte nie wieder.
 *
 * Deshalb wird hier verglichen statt nur nachgeschlagen, und zwar über die
 * fachlichen Felder. `market_price_snapshot` gehört NICHT dazu: es ist der
 * Preis zum Zeitpunkt des Imports, keine Aussage der Arbeitsmappe.
 */
type StoredRow = EventRow & { id: number };
const storedRows = await page<StoredRow>("legacy_stock_events",
  "id, sky_id, condition, event_type, quantity, occurred_at, source_sheet, source_row, import_fingerprint, note",
  "id");
const stored = new Map(storedRows.map((row) => [row.import_fingerprint, row]));

const same = (a: StoredRow, b: EventRow) =>
  a.sky_id === b.sky_id && a.condition === b.condition && a.event_type === b.event_type
  && a.quantity === b.quantity && String(a.occurred_at).slice(0, 10) === String(b.occurred_at).slice(0, 10)
  && (a.source_sheet ?? null) === (b.source_sheet ?? null)
  && (a.source_row ?? null) === (b.source_row ?? null)
  && (a.note ?? null) === (b.note ?? null);

const pending = rows.filter((row) => !stored.has(row.import_fingerprint));
const drifted = rows.map((row) => {
  const was = stored.get(row.import_fingerprint);
  return was !== undefined && !same(was, row) ? { was, now: row } : null;
}).filter((x): x is { was: StoredRow; now: EventRow } => x !== null);
const planned = new Set(rows.map((row) => row.import_fingerprint));
const stale = storedRows.filter((row) => !planned.has(row.import_fingerprint));

console.log("\n── Rows ──");
console.log(`  planned .................. ${rows.length}`);
console.log(`  in the database .......... ${storedRows.length}`);
console.log(`  unchanged ................ ${rows.length - pending.length - drifted.length}`);
console.log(`  to insert ................ ${pending.length}`);
console.log(`  changed (replace) ........ ${drifted.length}`);
console.log(`  no longer planned (drop) . ${stale.length}`);
for (const { was, now } of drifted.slice(0, 40)) {
  console.log(`    ~ #${was.id} ${was.event_type} ${was.sky_id}` +
    ` ${was.quantity} → ${now.quantity}` +
    `${was.occurred_at.slice(0, 10) === now.occurred_at.slice(0, 10) ? "" : ` · ${was.occurred_at.slice(0, 10)} → ${now.occurred_at.slice(0, 10)}`}`);
}
for (const row of stale.slice(0, 40)) {
  console.log(`    - #${row.id} ${row.event_type} ${row.sky_id} ${row.quantity}` +
    ` ${row.source_sheet ?? "—"}:${row.source_row ?? "—"} ${JSON.stringify(row.note ?? "")}`);
}
const after = rows.length;
console.log(`  after a full rebuild ..... ${after}`);

/*
 * FAIL CLOSED, STATT EINE HALB ALTE HISTORIE ZU HINTERLASSEN.
 *
 * Einfügen darf dieses Werkzeug. Entfernen nicht — `legacy_stock_events` ist
 * append-only (0079), und dieser Schutz bleibt: ein Importer, der sich seine
 * eigene Vorgeschichte wegräumen kann, ist kein Protokoll mehr. Stehen also
 * geänderte oder entfallene Zeilen an, nennt der Lauf sie vollständig und
 * hält an. Das Entfernen ist ein eigener, einzeln geprüfter Vorgang; 2026-09
 * wurde er einmal je Umgebung ausgeführt und liegt seither nur noch als
 * Protokoll vor (`docs/history/2026-09-22-phase-c-legacy-history-prune.md`).
 * Danach fügt ein gewöhnliches `--apply` den Rest ein.
 */
const removals = [...drifted.map((d) => d.was), ...stale];
if (APPLY && removals.length > 0) {
  console.error(`\nFAIL-CLOSED: ${drifted.length} changed and ${stale.length} obsolete row(s)` +
    ` stand in the way of the plan.`);
  console.error("  This tool only inserts; legacy_stock_events is append-only by design.");
  console.error("  Removing them is a separate, reviewed act — not this tool's job, and not");
  console.error("  a script that still lies ready to run. The one it was done with in 2026-09");
  console.error("  is a protocol now: docs/history/2026-09-22-phase-c-legacy-history-prune.md.");
  console.error("  Nothing was written.");
  process.exit(1);
}
const withoutPrice = pending.filter((row) => row.market_price_snapshot === null);
if (withoutPrice.length > 0) {
  const figures = [...new Set(withoutPrice.map((row) => row.sky_id))];
  console.log(`  without a market price ... ${withoutPrice.length} rows on ${figures.join(", ")} (snapshot stays NULL by decision)`);
}

if (!APPLY) {
  console.log("\nPreview only. Re-run with --apply to write.");
  process.exit(0);
}

let written = 0;
const toWrite = pending;
for (let from = 0; from < toWrite.length; from += 500) {
  const batch = toWrite.slice(from, from + 500);
  const { error } = await db.from("legacy_stock_events").insert(batch);
  if (error) {
    console.error(`\nInsert failed at row ${from}: ${error.message}`);
    console.error(`${written} row(s) were written before this point; the fingerprint index makes a re-run safe.`);
    process.exit(1);
  }
  written += batch.length;
  console.log(`  inserted ${written}/${toWrite.length}`);
}
console.log(`\nDone. ${written} row(s) written.`);
