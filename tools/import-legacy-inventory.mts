/**
 * V5 — the opening balance of the SkyIsles stock ledger (ADR-0044).
 *
 * Reads the business stock out of the legacy workbook and books it into
 * `shop_inventory` as `initial_import` movements. It runs once. Everything
 * after it is an ordinary movement booked in `/admin/inventory`.
 *
 *   npm run inventory:import-legacy                 dry run, writes nothing
 *   npm run inventory:import-legacy -- --apply      books the movements
 *   npm run inventory:import-legacy -- --file <p>   a different workbook
 *
 * WHAT IT READS, AND WHAT IT REFUSES TO READ
 *
 * The workbook is the legacy project's source of truth and holds far more
 * than stock: order sheets, an EÜR, buyer data, private collection columns
 * and private valuations. This tool opens exactly six sheets — the ones whose
 * name is a series code PortalVault already knows — and exactly two columns
 * of them:
 *
 *   A   the SKY-ID       the only identity that is ever used here
 *   F   "D" = Differenz  bought minus sold, i.e. business stock on hand
 *
 * Columns P–S (private collection) and U–X (private valuations) are never
 * read, and `Order *` / `EÜR *` are never opened at all. Nothing personal,
 * nothing financial and no article name is written to the database or to the
 * output: a name is printed only where a human has to decide something, and
 * only for business stock (docs/SECURITY.md).
 *
 * IDENTITY
 *
 * A row is matched by its SKY-ID and by nothing else. No name matching, no
 * fuzzy matching, no "looks like the same figure" (CLAUDE.md rule 2). An
 * unknown SKY-ID is reported, never guessed at, never created.
 *
 * PACKAGING
 *
 * The workbook has no packaging column, flag or relation — audited across all
 * six sheets. Where the legacy data does distinguish packaging it does so by
 * giving the item its own SKY-ID (`SKY-0049 "… - ohne OVP"`), which this tool
 * therefore imports like any other row. So everything is booked as `loose`,
 * as a stated V1 assumption rather than an invented precision. Correcting a
 * position to `boxed` later is two ordinary movements in the admin UI, which
 * is exactly what the journal is for.
 *
 * WHAT IT DOES NOT SET
 *
 * `unit_cost` stays NULL — the system path has no cost parameter at all, so
 * this is a property of the database, not of this file. `sale_price` stays
 * NULL and `is_listed` stays false: the import moves stock, and deciding what
 * to sell and for how much is a separate, manual act (ADR-0037, section 7).
 * There is no automatic price derivation from `market_price`.
 *
 * SAFETY
 *
 * - Dry run is the default. `--apply` is the only thing that writes.
 * - Validation runs to completion before the first write.
 * - **Repeatable.** Running it again after a complete run books nothing and
 *   exits 0. Running it again after a run that stopped half way books only
 *   the positions that are still missing. Both fall out of the same rule:
 *   the decision is made per position, from the journal, never from a count
 *   of what this process did (`src/lib/shop/legacy-plan.ts`).
 * - **Never adds to stock somebody is already managing.** A position that
 *   exists without an opening balance is a conflict, reported and left
 *   alone — see the plan module for why that is the whole safety property.
 * - The unique index `inventory_movements_one_initial_import` stays as the
 *   last line of defence. It is not the mechanism: a run that relied on it
 *   would fail with a constraint violation instead of finishing cleanly.
 * - Writes go through `system_record_inventory_movement()`, so stock and
 *   journal move in one transaction. `quantity` is never written directly.
 * - Never touches the legacy project. The workbook is opened read-only.
 */
import { resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { readWorkbook, type Workbook } from "./lib/xlsx.mts";
import {
  accountsForEveryRow,
  buildPlan,
  IMPORT_CONDITION,
  plannedPieces,
  positionKey,
  SKIP_LABELS,
  stockRows,
  type CatalogEntry,
  type LegacyStock,
  type PositionState,
} from "../src/lib/shop/legacy-plan.ts";

/** Where the legacy workbook lives, relative to the PortalVault checkout. */
const DEFAULT_WORKBOOK = "../webpage/skylanders.xlsx";

/** Column A: the SKY-ID. */
const COL_SKY_ID = 0;
/** Column B: the article name. Read only for the report, never written. */
const COL_NAME = 1;
/** Column D: "O" — bought. Read only to verify D - S = F. */
const COL_TOTAL = 3;
/** Column E: "S" — sold. Same. */
const COL_SOLD = 4;
/** Column F: "D" — business stock on hand. The one number that is imported. */
const COL_AVAILABLE = 5;

/** Row 1 is the header, row 2 the sums, row 3 blank. Articles start at 4. */
const FIRST_DATA_ROW = 4;

/**
 * The header cells that prove the column map still holds.
 *
 * The legacy sheet is maintained by hand. If someone inserts a column, this
 * tool must stop rather than import the "sold" figure as stock.
 */
const EXPECTED_HEADER: ReadonlyArray<readonly [number, string]> = [
  [COL_TOTAL, "O"],
  [COL_SOLD, "S"],
  [COL_AVAILABLE, "D"],
];

const SKY_ID = /^SKY-[0-9]{4}$/;

// ------------------------------------------------------------------ arguments

type Options = { apply: boolean; file: string };

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { apply: false, file: DEFAULT_WORKBOOK };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--file") options.file = argv[++i] ?? options.file;
    else if (arg.startsWith("--file=")) options.file = arg.slice("--file=".length);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return options;
}

// ------------------------------------------------------------------ reporting

const problems: string[] = [];

function fail(message: string): void {
  problems.push(message);
}

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

// ------------------------------------------------------------------ the input

/**
 * One article row of a series sheet.
 *
 * `LegacyStock` is what the planner needs; `bought` and `sold` are kept only
 * long enough to check the sheet's own arithmetic and are never used again.
 */
type LegacyRow = LegacyStock & { bought: number; sold: number };

function readNumber(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

/**
 * Reads the article rows of the sheets whose name is a known series code.
 *
 * An allowlist, not a filter: a sheet is opened because PortalVault knows a
 * series by that name, so `Order 2026` and `EÜR 2025` are not skipped by a
 * rule about their names — they are never reached at all.
 */
function readLegacyRows(workbook: Workbook, seriesCodes: readonly string[]): LegacyRow[] {
  const rows: LegacyRow[] = [];
  const seen = new Map<string, LegacyRow>();

  for (const code of seriesCodes) {
    if (!workbook.has(code)) {
      fail(`series ${code} has no sheet in the workbook`);
      continue;
    }

    const sheet = workbook.rows(code);
    const header = sheet.find((row) => row.row === 1);
    for (const [column, expected] of EXPECTED_HEADER) {
      const actual = (header?.cells.get(column) ?? "").trim();
      if (actual !== expected) {
        fail(`sheet ${code}: column ${column + 1} header is "${actual}", expected "${expected}"`);
      }
    }

    for (const line of sheet) {
      if (line.row < FIRST_DATA_ROW) continue;
      const skyId = (line.cells.get(COL_SKY_ID) ?? "").trim();
      if (skyId === "") continue;
      if (!SKY_ID.test(skyId)) {
        fail(`sheet ${code} row ${line.row}: "${skyId}" is not a SKY-ID`);
        continue;
      }

      const available = readNumber(line.cells.get(COL_AVAILABLE));
      const bought = readNumber(line.cells.get(COL_TOTAL));
      const sold = readNumber(line.cells.get(COL_SOLD));
      if (available === null || bought === null || sold === null) {
        fail(`sheet ${code} row ${line.row} (${skyId}): stock columns are not whole numbers`);
        continue;
      }
      if (available < 0) {
        fail(`sheet ${code} row ${line.row} (${skyId}): negative stock ${available}`);
        continue;
      }
      if (bought - sold !== available) {
        fail(
          `sheet ${code} row ${line.row} (${skyId}): ${bought} - ${sold} is not ${available}; ` +
            "the sheet's own arithmetic does not hold",
        );
        continue;
      }

      const row: LegacyRow = {
        skyId,
        name: (line.cells.get(COL_NAME) ?? "").trim(),
        sheet: code,
        row: line.row,
        available,
        bought,
        sold,
      };

      const previous = seen.get(skyId);
      if (previous) {
        fail(
          `${skyId} appears twice: ${previous.sheet} row ${previous.row} and ${code} row ${line.row}`,
        );
        continue;
      }
      seen.set(skyId, row);
      rows.push(row);
    }
  }

  return rows;
}

// --------------------------------------------------------------------- the DB

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run through npm, which loads .env.local.`);
    process.exit(1);
  }
  return value;
}

function serviceClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function fetchSeriesCodes(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from("series").select("code").order("position");
  if (error) throw new Error(`series: ${error.message}`);
  return (data ?? []).map((row) => row.code as string);
}

async function fetchCatalog(db: SupabaseClient): Promise<Map<string, CatalogEntry>> {
  const catalog = new Map<string, CatalogEntry>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("skylanders")
      .select("sky_id, is_active, categories!inner(name)")
      .order("sky_id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`skylanders: ${error.message}`);
    const page = (data ?? []) as unknown as {
      sky_id: string;
      is_active: boolean;
      categories: { name: string };
    }[];
    for (const row of page) {
      catalog.set(row.sky_id, {
        isActive: row.is_active,
        categoryName: row.categories.name,
      });
    }
    if (page.length < pageSize) break;
  }

  return catalog;
}

/**
 * Reads a whole table, one page at a time.
 *
 * PostgREST answers at most 1000 rows per request and says nothing about the
 * rest. A truncated read here would be the worst kind of bug this tool can
 * have: a position whose opening balance fell off the end of the page would
 * look un-imported, and the run would try to open it a second time. The
 * unique index would catch that — with a constraint violation instead of a
 * clean, repeatable run, which is exactly the failure this file exists to
 * prevent. So every read is paged to exhaustion.
 */
async function readAll<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  order: string,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .order(order)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as unknown as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

/**
 * What the ledger already says about every stock position.
 *
 * Read from the journal, never from the stock level. Two facts per position:
 * whether it exists at all, and whether it carries an `initial_import`. That
 * is everything `buildPlan` needs to tell "already done" from "somebody is
 * managing this by hand" — and both answers survive a run that stopped half
 * way, because neither of them is a memory of what this process did.
 */
async function fetchPositionStates(db: SupabaseClient): Promise<Map<string, PositionState>> {
  const [positions, movements] = await Promise.all([
    readAll<{ id: number; sky_id: string; condition: string }>(
      db,
      "shop_inventory",
      "id, sky_id, condition",
      "id",
    ),
    // Every movement, not only the opening balances: a position with manual
    // movements and no opening balance is the conflict case, and it can only
    // be seen by counting what is actually there.
    readAll<{ inventory_id: number; delta: number; reason: string }>(
      db,
      "inventory_movements",
      "inventory_id, delta, reason",
      "id",
    ),
  ]);

  const states = new Map<string, PositionState>();
  const keyOf = new Map<number, string>();

  for (const position of positions) {
    const key = positionKey(position.sky_id, position.condition);
    keyOf.set(position.id, key);
    states.set(key, { exists: true, movements: 0, openingBalance: null });
  }

  for (const movement of movements) {
    const key = keyOf.get(movement.inventory_id);
    if (!key) continue; // a movement whose position is gone cannot happen
    const state = states.get(key);
    if (!state) continue;
    state.movements += 1;
    if (movement.reason === "initial_import") state.openingBalance = movement.delta;
  }

  return states;
}

// ----------------------------------------------------------------------- main

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const path = resolve(process.cwd(), options.file);

  console.log("Legacy inventory import");
  console.log(`  workbook  ${options.file} (read-only)`);
  console.log(`  mode      ${options.apply ? "APPLY — writes movements" : "dry run"}`);
  console.log(`  condition ${IMPORT_CONDITION} (documented V1 assumption)`);

  const db = serviceClient();
  const seriesCodes = await fetchSeriesCodes(db);
  const workbook = readWorkbook(path);
  const rows = readLegacyRows(workbook, seriesCodes);

  heading("Workbook");
  console.log(`  sheets read      ${seriesCodes.join(", ")}`);
  console.log(`  article rows     ${rows.length}`);
  const withStock = rows.filter((row) => row.available > 0);
  const pieces = withStock.reduce((sum, row) => sum + row.available, 0);
  console.log(`  rows with stock  ${withStock.length}`);
  console.log(`  pieces on hand   ${pieces}`);

  const [catalog, states] = await Promise.all([fetchCatalog(db), fetchPositionStates(db)]);
  const plan = buildPlan(rows, catalog, states);

  heading("Scope");
  for (const reason of ["fixture", "not-in-catalog", "software", "inactive"] as const) {
    const group = plan.skipped.filter((row) => row.reason === reason);
    const count = group.reduce((sum, row) => sum + row.available, 0);
    console.log(
      `  excluded: ${SKIP_LABELS[reason]}`.padEnd(72) +
        `${group.length} positions, ${count} pieces`,
    );
    for (const row of group) {
      console.log(`      ${row.skyId}  ${String(row.available).padStart(2)} × ${row.name}`);
    }
  }

  heading("Plan");
  const planned = plannedPieces(plan);
  console.log(`  already opened       ${plan.already.length} positions — nothing to do`);
  console.log(`  conflicts            ${plan.conflicts.length} positions — not imported`);
  console.log(`  to import            ${plan.movements.length} positions, ${planned} pieces`);
  console.log(`  unit_cost            NULL for every movement`);
  console.log(`  sale_price/is_listed untouched — nothing is put on sale by this import`);

  // The one failure mode that would show up as missing stock rather than as
  // an error: a row silently falling out of every bucket.
  if (!accountsForEveryRow(plan, rows)) {
    fail(`internal: ${stockRows(rows).length} stock rows do not add up`);
  }

  // The positions somebody is already managing by hand. Loud, because this is
  // the case where a wrong decision would double real stock without any error
  // being raised (ADR-0044).
  if (plan.conflicts.length > 0) {
    heading(`Conflicts (${plan.conflicts.length}) — a human has to decide`);
    console.log("  These positions exist and carry movements, but no opening balance.");
    console.log("  Nothing is imported for them. Book a correction by hand if the");
    console.log("  legacy quantity is really missing from their stock.\n");
    for (const conflict of plan.conflicts) {
      console.log(
        `      ${conflict.skyId} / ${conflict.condition}` +
          `  ${conflict.movements} existing movement(s), legacy says ${conflict.legacyQuantity}` +
          `  — ${conflict.name}`,
      );
    }
  }

  // Where the workbook and the ledger have drifted apart since the import.
  // Informational only: the ledger is authoritative from the opening balance
  // onwards, and the workbook is not consulted again.
  const drifted = plan.already.filter((row) => row.openingBalance !== row.legacyQuantity);
  if (drifted.length > 0) {
    heading(`Already opened, workbook has moved on (${drifted.length})`);
    console.log("  Informational. The ledger is authoritative; nothing is re-imported.\n");
    for (const row of drifted) {
      console.log(
        `      ${row.skyId} / ${row.condition}` +
          `  opened with ${row.openingBalance}, workbook now says ${row.legacyQuantity}`,
      );
    }
  }

  if (problems.length > 0) {
    heading(`Problems (${problems.length})`);
    for (const problem of problems) console.log(`  ${problem}`);
    console.log("\nNothing was written.");
    process.exit(1);
  }

  // Nothing left to do. Said in one line, because this is what every run
  // after the first one should print.
  const settled = plan.movements.length === 0;

  if (!options.apply) {
    heading("Dry run");
    if (settled) {
      console.log(`  ${plan.already.length} already initial-imported · 0 changes`);
    } else {
      console.log(
        `  Nothing was written. Re-run with --apply to book ` +
          `${plan.movements.length} movements (${planned} pieces).`,
      );
    }
    process.exit(plan.conflicts.length > 0 ? 1 : 0);
  }

  if (settled) {
    heading("Applying");
    console.log(`  ${plan.already.length} already initial-imported · 0 changes`);
    process.exit(plan.conflicts.length > 0 ? 1 : 0);
  }

  heading("Applying");
  let booked = 0;
  let bookedPieces = 0;
  for (const move of plan.movements) {
    const { error } = await db.rpc("system_record_inventory_movement", {
      p_sky_id: move.skyId,
      p_condition: move.condition,
      p_delta: move.quantity,
      p_reason: "initial_import",
      p_note: `Legacy-Bestand ${move.sheet}`,
    });
    if (error) {
      // Reported and carried on rather than aborting: every position is its
      // own transaction, so the ones after this one are unaffected — and the
      // next run picks up exactly what is still missing.
      console.log(`  ${move.skyId}: ${error.message}`);
      fail(`${move.skyId}: ${error.message}`);
      continue;
    }
    booked += 1;
    bookedPieces += move.quantity;
  }
  console.log(
    `  booked ${booked} of ${plan.movements.length} movements (${bookedPieces} pieces)`,
  );

  if (problems.length > 0) {
    heading(`Problems (${problems.length})`);
    for (const problem of problems) console.log(`  ${problem}`);
    console.log("\n  Re-run the same command: what was booked is skipped, the rest is retried.");
    process.exit(1);
  }
  if (plan.conflicts.length > 0) process.exit(1);
}

await main();
