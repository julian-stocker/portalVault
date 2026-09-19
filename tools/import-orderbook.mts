/**
 * Historical Orderbuch import, in batches (ADR-0088).
 *
 *   npm run orderbook:import:staging -- --year 2025
 *   npm run orderbook:import:staging -- --year 2025 --apply
 *   npm run orderbook:import:staging -- --undated
 *
 * Preview is the default and writes nothing. `--apply` re-reads the workbook
 * and re-classifies before writing, so the thing applied is never the thing a
 * preview printed — the workbook is a file on a disk and can change in between.
 *
 * IT RUNS AS A SELLER OPERATOR, NOT AS THE SERVICE ROLE.
 *
 * `SKYISLES_OPERATOR_EMAIL` / `SKYISLES_OPERATOR_PASSWORD` sign in through the
 * ordinary anon client, and every read and write goes through the same
 * `seller_*` functions the Business screens call. The service-role key is not
 * used here at all. That is not ceremony: the last importer proved itself with
 * a service-role key, which bypasses RLS, and shipped a permission defect that
 * skipped 28 Production rows (see `0052`).
 *
 * THE WORKBOOK IS READ SELECTIVELY AND NEVER WRITTEN.
 *
 * `openAsBlob` plus the shipped `readWorkbookParts()` pull eight worksheets out
 * of a 450 MB archive without inflating the 449 MB of embedded pictures.
 */
import { openAsBlob } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";
import { readWorkbookParts } from "../src/lib/import/xlsx-reader.ts";
import { parseSharedStrings, parseSheet } from "../src/lib/import/sheet-rows.ts";
import {
  STOCK_SHEETS, groupRows, indexCatalog, parseOrderSheet,
  type CatalogEntry, type PurchaseGroup,
} from "../src/lib/orderbook/order-2026.ts";
import {
  applyBatch, isDuplicateFingerprint, planBatch,
  type BatchPlan, type GroupPlan,
} from "../src/lib/orderbook/batch-import.ts";

const WORKBOOK = process.env.SKYISLES_WORKBOOK
  ?? `${process.env.HOME}/Documents/eCommerce/skylanders.xlsx`;
const ORDER_SHEET = "Order 2026";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? "") : null;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run through npm, which loads the env file.`);
    process.exit(1);
  }
  return value;
}

/** Sign in as the operator. The password is read and never printed. */
async function operatorClient(): Promise<SupabaseClient> {
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email: requireEnv("SKYISLES_OPERATOR_EMAIL"),
    password: requireEnv("SKYISLES_OPERATOR_PASSWORD"),
  });
  if (error) {
    console.error(`Operator sign-in failed: ${error.message}`);
    process.exit(1);
  }
  return client;
}

/**
 * Which groups this run is about.
 *
 * A calendar year, or the purchases whose date the workbook lost — thirteen
 * groups whose date formula reads `#REF!`. They are a scope of their own
 * because they belong to no year, and guessing one is the thing we refuse.
 */
type Scope = { kind: "year"; year: number } | { kind: "undated" };

const describe = (scope: Scope) =>
  scope.kind === "year" ? `dated ${scope.year}` : "undated (#REF!)";

/** Read the workbook and classify. Called once for preview and again for apply. */
async function readAndPlan(client: SupabaseClient, scope: Scope): Promise<{
  plan: BatchPlan; groups: PurchaseGroup[]; bytesRead: number;
}> {
  const blob = await openAsBlob(WORKBOOK);
  const parts = await readWorkbookParts(blob, [ORDER_SHEET, ...STOCK_SHEETS]);
  const shared = parseSharedStrings(parts.sharedStrings);

  const orderXml = parts.sheets.get(ORDER_SHEET);
  if (!orderXml) throw new Error(`Sheet "${ORDER_SHEET}" not found in the workbook.`);

  const stock = new Map<string, string>();
  for (const sheet of STOCK_SHEETS) {
    const xml = parts.sheets.get(sheet);
    if (!xml) continue;
    for (const row of parseSheet(sheet, xml, shared)) stock.set(`${sheet}|${row.sourceRow}`, row.name);
  }

  const [catalog, mappings, fingerprints] = await Promise.all([
    client.rpc("seller_import_catalog"),
    client.rpc("seller_orderbook_mappings"),
    client.rpc("seller_purchase_fingerprints"),
  ]);
  for (const [label, response] of [["seller_import_catalog", catalog],
                                   ["seller_orderbook_mappings", mappings],
                                   ["seller_purchase_fingerprints", fingerprints]] as const) {
    if (response.error) throw new Error(`${label}: ${response.error.message}`);
  }

  const entries: CatalogEntry[] = (catalog.data as { sky_id: string; name: string; series_code: string }[])
    .map((row) => ({ skyId: row.sky_id, name: row.name, series: row.series_code }));

  const saved = new Map<string, string | null>();
  for (const row of mappings.data as { normalised_name: string; sky_id: string | null }[]) {
    saved.set(row.normalised_name, row.sky_id);
  }

  const imported = new Set<string>(
    (fingerprints.data as { import_fingerprint: string }[]).map((row) => row.import_fingerprint),
  );

  const groups = groupRows(parseOrderSheet(orderXml, shared)).filter((group) =>
    group.items.length > 0
    && (scope.kind === "undated"
          ? group.date === null
          : group.date?.startsWith(String(scope.year)) === true));

  const plan = await planBatch(groups, {
    stockName: (sheet, row) => stock.get(`${sheet}|${row}`) ?? null,
    bySheetName: indexCatalog(entries),
    mappings: saved,
    imported,
  });

  return { plan, groups, bytesRead: parts.bytesRead };
}

function report(plan: BatchPlan, bytesRead: number): void {
  const t = plan.totals;
  console.log(`\nread ${(bytesRead / 1048576).toFixed(2)} MB of the workbook\n`);
  console.log("  grp        rows date       status            src  ign  mig  fml  map  unc  unm  amb        cost");
  for (const p of plan.plans) {
    const v = p.preview;
    console.log(
      `${String(p.headerRow).padStart(5)} ${`${p.firstRow}-${p.lastRow}`.padEnd(11)} ${p.date ?? "—         "}` +
      ` ${p.status.padEnd(17)} ${String(v.sourceRows).padStart(4)} ${String(v.ignoredDamaged.length).padStart(4)}` +
      ` ${String(v.migrated.length).padStart(4)} ${String(v.byEvidence.formula).padStart(4)}` +
      ` ${String(v.byEvidence.mapping).padStart(4)} ${String(v.byClassification.uncategorized).padStart(4)}` +
      ` ${String(v.byClassification.unmatched).padStart(4)} ${String(v.byClassification.ambiguous).padStart(4)}` +
      ` ${(p.totalCost ?? 0).toFixed(2).padStart(11)}${p.reason ? `   ${p.reason}` : ""}`);
  }
  console.log(
    `\n  groups ${t.groups}  eligible ${plan.eligible.length}  already imported ${plan.alreadyImported.length}  blocked ${plan.blocked.length}` +
    `\n  source rows ${t.sourceRows} = migrated ${t.migrated} + ignored_damaged ${t.ignoredDamaged} + invalid ${t.invalid}` +
    `   -> ${t.sourceRows === t.migrated + t.ignoredDamaged + t.invalid}` +
    `\n  matched ${t.matched}  uncategorized ${t.uncategorized}  unmatched ${t.unmatched}  ambiguous ${t.ambiguous}` +
    `\n  by formula ${t.byFormula}  by mapping ${t.byMapping}` +
    `\n  cost of eligible groups ${t.cost.toFixed(2)}\n`);
}

async function main(): Promise<void> {
  const undated = flag("undated");
  const year = Number(arg("year") ?? "2025");
  if (!undated && !Number.isInteger(year)) throw new Error("--year must be a calendar year");
  const scope: Scope = undated ? { kind: "undated" } : { kind: "year", year };
  const apply = flag("apply");

  requireStaging("orderbook:import");
  const client = await operatorClient();

  console.log(`\n=== PREVIEW — ${ORDER_SHEET}, ${describe(scope)} ===`);
  const preview = await readAndPlan(client, scope);
  report(preview.plan, preview.bytesRead);

  if (!apply) {
    console.log("Preview only. Nothing was written. Re-run with --apply to import.\n");
    return;
  }

  // Apply re-reads and re-classifies: the preview above is a report, not a
  // command, and the file may have changed since it was printed.
  console.log("=== APPLY — re-reading and re-classifying before writing ===");
  const fresh = await readAndPlan(client, scope);
  report(fresh.plan, fresh.bytesRead);

  if (fresh.plan.blocked.length > 0) {
    console.error(`Refusing to apply: ${fresh.plan.blocked.length} group(s) blocked.`);
    process.exit(1);
  }

  const result = await applyBatch(fresh.plan.plans, async (plan: GroupPlan) => {
    const { data, error } = await client.rpc("seller_import_purchase_group", {
      p_purchased_at: plan.date,
      p_total_cost: plan.totalCost,
      p_fingerprint: plan.fingerprint,
      p_note: plan.note,
      p_items: plan.payload,
    });
    if (error) return isDuplicateFingerprint(error) ? { duplicate: true } : { error: error.message };
    return { id: Number(data) };
  });

  console.log("\n  grp    outcome            purchase");
  for (const row of result.results) {
    console.log(`${String(row.headerRow).padStart(5)}    ${row.outcome.padEnd(18)} ` +
      ("purchaseId" in row ? `#${row.purchaseId}` : "message" in row ? row.message : "—"));
  }
  console.log(`\n  imported ${result.imported}  skipped ${result.skipped}` +
    (result.failedAt === null ? "" : `  STOPPED at group ${result.failedAt}`));
  if (result.failedAt !== null) process.exit(1);
  console.log("\nRe-run is safe: every imported group's fingerprint is now taken.\n");
}

await main();
