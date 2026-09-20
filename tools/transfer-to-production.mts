/**
 * Moves the REAL Orderbuch history from Staging to Production (ADR-0096).
 *
 *   npm run transfer:preview                    Vorschau, schreibt nichts
 *   npm run transfer:apply -- --confirm-production   schreibt
 *
 * EIN EINMALIGES MIGRATIONSWERKZEUG. It ran on 2026-09-19 and is finished.
 * It is kept because a migration one cannot re-read is a migration one cannot
 * audit — not because it is meant to run again. See THE ONE-SHOT LOCK below.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A DUMP
 *
 * A `pg_dump` of Staging would carry its `auth.users`, 31 fixture stock
 * positions, 628 inventory movements belonging to a different ledger, 25
 * sandbox orders, three Staging seller operators and two fixture series. And
 * it would overwrite a Production inventory ledger that is already correct.
 * So this copies rows, not a database.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT MOVES, AND WHAT IT REFUSES TO
 *
 * Only `source = 'excel_order_2026'` — the reconstructed workbook history.
 * Everything else in Staging's Orderbuch is a test:
 *
 *   * three purchases flagged `is_test`
 *   * five sales flagged `is_test`
 *   * TWO MORE sales that are NOT flagged — #15 "temporärer Test" and #19
 *     "UI-Durchlauf (temporär)". Filtering on `is_test` alone would have
 *     carried both into Production as real business. `source` is the filter
 *     that catches them, which is why it is the filter.
 *   * fourteen internal sales belonging to sandbox orders
 *
 * NO INVENTORY. Not one movement, not one quantity. The real stock already
 * matches — 992 pieces on both sides, zero deviations — and Production's
 * ledger is append-only. No row this tool writes references a movement:
 * every class-A item has `movement_id` NULL, which is checked before writing.
 *
 * NO AUTH. `created_by` and `updated_by` are dropped to NULL. The six Staging
 * users behind them do not exist in Production and must not be created; the
 * columns are nullable and `on delete set null` for exactly this reason.
 *
 * IDS ARE NOT PRESERVED. `purchases.id` is `generated always as identity`, so
 * Production assigns its own and this maps the children onto them. Identity
 * travels in `import_fingerprint`, not in a serial.
 *
 * ---------------------------------------------------------------------------
 * THE ONE-SHOT LOCK — and why there is no idempotency logic behind it
 *
 * Fingerprints make the vorgänge repeatable: a second pass over `purchases`
 * and `sales` finds them and writes nothing. `settlement_adjustments` is the
 * exception. Three of the four historical corrections are sale-linked and
 * carry NO fingerprint — only the standalone one does, per 0061 — so a
 * fingerprint comparison cannot recognise them and a second apply would
 * duplicate all three.
 *
 * The fix is NOT to invent a second identity for them out of
 * `(sale_id, amount, reason)`. That would be a permanent synchronisation
 * mechanism, guessing at row identity, built for a migration that happens
 * once and has already happened. Instead the tool refuses to run twice:
 * if any class-A fingerprint is already present in Production, the transfer
 * is done, and `--apply` aborts before reading anything further.
 *
 * The lock is deliberately blunt. It does not ask WHICH rows are missing,
 * because a half-finished transfer is not something a re-run should silently
 * complete — that is a decision for a person looking at the data, not for a
 * filter. The preview still runs, and says so.
 *
 * CATEGORIES ARE RESOLVED BY NAME. All thirty shared categories have
 * different ids in the two projects, so any id copied across would point at
 * the wrong category. Nothing here writes `category_id`, and the catalog step
 * resolves `(series_code, name)`.
 *
 * NO CATALOG WRITES. The preflight compared both catalogs against the
 * canonical sources and found Staging to be the deviating side in both
 * disputed rows — `SKY-0821` and `SKY-0333` — so Production already holds
 * the correct values and there is nothing to correct. `SKY-0822` is left
 * out pending a decision; see the report.
 *
 * ANY AMBIGUITY STOPS THE WHOLE RUN before the first write.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { projectOrigin, projectRef, readEnvFile } from "./lib/staging-guard.mts";

const flag = (name: string) => process.argv.includes(`--${name}`);
const APPLY = flag("apply");
const BATCH = 500;

type Row = Record<string, unknown>;

/* ------------------------------------------------------------------ guard */

const source = readEnvFile(".env.staging");
const target = readEnvFile(".env.local");

function guard(): { S: SupabaseClient; P: SupabaseClient } {
  const s = projectOrigin(source.NEXT_PUBLIC_SUPABASE_URL);
  const t = projectOrigin(target.NEXT_PUBLIC_SUPABASE_URL);
  const fail = (why: string): never => {
    console.error(`\n  TRANSFER GUARD — refusing to run.\n\n  ${why}\n`);
    process.exit(1);
  };
  if (s === null) fail(".env.staging names no project.");
  if (t === null) fail(".env.local names no project.");
  if (s === t) fail("source and target are the SAME project.");
  if (source.SUPABASE_SERVICE_ROLE_KEY === target.SUPABASE_SERVICE_ROLE_KEY) {
    fail("both env files carry the same service-role key.");
  }
  if (APPLY && !flag("confirm-production")) {
    fail("writing to PRODUCTION requires --confirm-production as well as --apply.");
  }
  const mk = (e: Record<string, string>) =>
    createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`  Quelle  ${projectRef(source.NEXT_PUBLIC_SUPABASE_URL)} (Staging)`);
  console.log(`  Ziel    ${projectRef(target.NEXT_PUBLIC_SUPABASE_URL)} (Production)`);
  console.log(`  Modus   ${APPLY ? "APPLY — schreibt nach Production" : "Vorschau, schreibt nichts"}\n`);
  return { S: mk(source), P: mk(target) };
}

const { S, P } = guard();

/* ------------------------------------------------------------------ read */

async function page<T extends Row>(
  db: SupabaseClient, table: string, select = "*", order = "id",
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db.from(table).select(select).order(order).range(from, from + 999);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    out.push(...(r.data as unknown as T[]));
    if ((r.data?.length ?? 0) < 1000) break;
  }
  return out;
}

const problems: string[] = [];
const stop = (why: string) => problems.push(why);

/** Everything except the columns Production must decide for itself. */
function strip(row: Row, drop: readonly string[]): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!drop.includes(k)) out[k] = v;
  return out;
}

/* --------------------------------------------------------------- preflight */

/* ------------------------------------------------------------ class A read */

console.log("\n=== 1. Klasse A aus Staging ===");
const HIST = "excel_order_2026";
const sPurchases = (await page(S, "purchases")).filter((r) => r.source === HIST);
const sSales = (await page(S, "sales")).filter((r) => r.source === HIST);
const histP = new Set(sPurchases.map((r) => r.id as number));
const histS = new Set(sSales.map((r) => r.id as number));
const sPItems = (await page(S, "purchase_items")).filter((r) => histP.has(r.purchase_id as number));
const sSItems = (await page(S, "sale_items")).filter((r) => histS.has(r.sale_id as number));
const sFees = (await page(S, "sale_fees")).filter((r) => histS.has(r.sale_id as number));
const sRefunds = (await page(S, "sale_refunds")).filter((r) => histS.has(r.sale_id as number));
const sAdj = (await page(S, "settlement_adjustments")).filter((r) => r.source === HIST);
const sMappings = await page(S, "orderbook_name_mappings");
const money = (a: Row[], f = "amount") => a.reduce((s, r) => s + Number(r[f] ?? 0), 0).toFixed(2);
console.log(`  purchases ${sPurchases.length} · purchase_items ${sPItems.length}`);
console.log(`  sales ${sSales.length} · sale_items ${sSItems.length}`);
console.log(`  sale_fees ${sFees.length} (${money(sFees)}) · sale_refunds ${sRefunds.length} (${money(sRefunds)})`);
console.log(`  settlement_adjustments ${sAdj.length} (${money(sAdj)}) · name_mappings ${sMappings.length}`);

console.log("\n=== 2. Ausgeschlossen ===");
const allP = await page(S, "purchases"), allS = await page(S, "sales");
for (const r of allP.filter((x) => x.source !== HIST))
  console.log(`  Einkauf #${r.id}  is_test=${r.is_test}  ${JSON.stringify(r.note)}`);
for (const r of allS.filter((x) => x.source !== HIST))
  console.log(`  Verkauf #${r.id}  src=${r.source} is_test=${r.is_test} order=${r.order_id ?? "—"}  ${JSON.stringify(r.note)}`);
console.log(`  Bestellungen/Zeilen/Adressen: nicht übertragen (alle commerce_mode=sandbox)`);

/* ------------------------------------------------------------- validation */

console.log("=== 3. Zielschema (Production) ===");
const SCHEMA_PROBES: [string, string, Row][] = [
  ["0053", "seller_purchase", { p_id: -1 }],
  ["0059", "sale_expected_payout", { p_sale_id: -1 }],
  ["0061", "seller_historical_adjustments", {}],
  ["0062", "seller_sale_audit", { p_sale_id: -1 }],
  ["0063", "seller_set_purchase_test", { p_id: -1, p_is_test: false }],
  ["0064", "seller_create_purchase_with_items", { p_purchased_at: null, p_total_cost: 0, p_note: null, p_is_test: true, p_items: [] }],
  ["0065", "seller_set_sale_item_sky", { p_item_id: -1, p_sky_id: "X" }],
];
for (const [mig, fn, args] of SCHEMA_PROBES) {
  const r = await P.rpc(fn, args);
  const missing = r.error?.code === "PGRST202";
  console.log(`  ${mig}  ${fn.padEnd(34)} ${missing ? "FEHLT" : "vorhanden"}`);
  if (missing) stop(`Migration ${mig} fehlt in Production (${fn}).`);
}
for (const [t, c] of [["purchases", "is_test"], ["sales", "is_test"]] as const) {
  const r = await P.from(t).select(c).limit(1);
  console.log(`  0063  ${`${t}.${c}`.padEnd(34)} ${r.error ? "FEHLT" : "vorhanden"}`);
  if (r.error) stop(`Spalte ${t}.${c} fehlt in Production.`);
}
{
  const r = await P.rpc("seller_orderbook_ledger",
    { p_year: null, p_month: null, p_search: null, p_undated: false, p_status: "open" });
  const ok = r.error?.code !== "PGRST202";
  console.log(`  0066  ${"p_status='open'".padEnd(34)} ${ok ? "Signatur vorhanden" : "FEHLT"}`);
  if (!ok) stop("Migration 0066 fehlt in Production.");
}

console.log("\n=== 4. Prüfungen vor dem Schreiben ===");
// No class-A row may reference an inventory movement.
const withMovement = [...sPItems.filter((r) => r.movement_id !== null),
                      ...sSItems.filter((r) => r.movement_id !== null || r.return_movement_id !== null)];
console.log(`  Positionen mit Lagerbewegung: ${withMovement.length}`);
if (withMovement.length > 0) stop(`${withMovement.length} Klasse-A-Position(en) referenzieren eine Lagerbewegung.`);

// Every referenced figure must exist in the target.
const pSky = new Set((await page(P, "skylanders", "sky_id", "sky_id")).map((r) => r.sky_id as string));
const referenced = new Set<string>();
for (const r of [...sPItems, ...sSItems]) if (r.sky_id) referenced.add(r.sky_id as string);
for (const m of sMappings) if (m.sky_id) referenced.add(m.sky_id as string);
const missingSky = [...referenced].filter((id) => !pSky.has(id));
console.log(`  referenzierte Figuren ${referenced.size} · in Production fehlend ${missingSky.length}`);
if (missingSky.length > 0) stop(`Figuren fehlen in Production: ${missingSky.join(", ")}`);

// Fingerprints: complete on the source, and idempotent against the target.
const noFp = [...sPurchases, ...sSales].filter((r) => !r.import_fingerprint);
console.log(`  Klasse-A-Vorgänge ohne Fingerabdruck: ${noFp.length}`);
if (noFp.length > 0) stop(`${noFp.length} Vorgänge ohne import_fingerprint.`);
/*
 * THE SCHEMA GATE FIRES HERE, before a single target business table is read.
 *
 * Without 0053…0066 those tables do not exist, and asking PostgREST for one
 * raises "Could not find the table" — a confusing way to report a migration
 * that simply has not been applied. Everything above this line reads Staging
 * only, so the preview stays useful before the migrations are in place.
 */
if (problems.length > 0) {
  console.log(`\n=== ABBRUCH — ${problems.length} Problem(e) ===`);
  for (const pr of problems) console.log(`  ${pr}`);
  console.log("\n  Zuerst die fehlenden Migrationen im Production-SQL-Editor anwenden.");
  console.log("  Es wurde nichts geschrieben.\n");
  process.exit(1);
}

const pFpP = new Set((await page(P, "purchases", "id, import_fingerprint")).map((r) => r.import_fingerprint as string));
const pFpS = new Set((await page(P, "sales", "id, import_fingerprint")).map((r) => r.import_fingerprint as string));
const pFpA = new Set((await page(P, "settlement_adjustments", "id, import_fingerprint")).map((r) => r.import_fingerprint as string));
const newPurchases = sPurchases.filter((r) => !pFpP.has(r.import_fingerprint as string));
const newSales = sSales.filter((r) => !pFpS.has(r.import_fingerprint as string));
/*
 * The three sale-linked corrections have no fingerprint, so this call cannot
 * tell whether Production already holds them — it reports them as new. That
 * is exactly why the one-shot lock below exists, and why this filter was left
 * honest rather than taught to guess.
 */
const newAdj = sAdj.filter((r) => !r.import_fingerprint || !pFpA.has(r.import_fingerprint as string));
console.log(`  bereits in Production: Einkäufe ${sPurchases.length - newPurchases.length} · Verkäufe ${sSales.length - newSales.length}`);
console.log(`  neu zu schreiben:      Einkäufe ${newPurchases.length} · Verkäufe ${newSales.length} · Korrekturen ${newAdj.length}`);
const dupP = new Set(sPurchases.map((r) => r.import_fingerprint)).size !== sPurchases.length;
const dupS = new Set(sSales.map((r) => r.import_fingerprint)).size !== sSales.length;
if (dupP || dupS) stop("Doppelte Fingerabdrücke in der Quelle.");
console.log(`  Fingerabdrücke eindeutig: ${!dupP && !dupS ? "ja" : "NEIN"}`);

const stockBefore = await page(P, "shop_inventory", "id, quantity, reserved");
const movesBefore = await P.from("inventory_movements").select("id", { count: "exact", head: true });
console.log(`  Production-Bestand jetzt: ${stockBefore.length} Pos / ${stockBefore.reduce((a, r) => a + Number(r.quantity), 0)} Stück · ${movesBefore.count} Bewegungen`);

if (problems.length > 0) {
  console.log(`\n=== ABBRUCH — ${problems.length} Problem(e) ===`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}

/* ------------------------------------------------------- one-shot lock */

/*
 * IS PRODUCTION ALREADY MIGRATED?
 *
 * One question, asked of the target itself: does any class-A vorgang from
 * Staging already carry its fingerprint in Production? Purchases and sales
 * both, because either alone would answer it — 84 and 292 rows moved in one
 * transaction-shaped run, and a state where one table arrived and the other
 * did not is a broken transfer, not a resumable one.
 *
 * No marker table, no version row, no state this tool has to maintain. The
 * transferred data IS the record that the transfer happened.
 */
const migratedP = sPurchases.filter((r) => pFpP.has(r.import_fingerprint as string)).length;
const migratedS = sSales.filter((r) => pFpS.has(r.import_fingerprint as string)).length;

if (migratedP > 0 || migratedS > 0) {
  console.log("\n=== GESPERRT — Production ist bereits migriert ===");
  console.log(`  Einkäufe mit bekanntem Fingerabdruck: ${migratedP} von ${sPurchases.length}`);
  console.log(`  Verkäufe mit bekanntem Fingerabdruck: ${migratedS} von ${sSales.length}`);
  console.log("\n  Dieses Werkzeug überträgt die Excel-Historie GENAU EINMAL.");
  console.log("  Es ist kein Synchronisationswerkzeug und wird keines.");
  console.log("\n  Ein zweiter Durchlauf würde die drei verkaufsgebundenen");
  console.log("  settlement_adjustments duplizieren — sie tragen keinen");
  console.log("  Fingerabdruck und sind an ihm nicht wiedererkennbar.");
  if (APPLY) {
    console.error("\n  APPLY ABGEBROCHEN. Es wurde nichts geschrieben.\n");
    process.exit(1);
  }
  console.log("\n  Vorschau beendet. Ein Apply ist gesperrt.\n");
  process.exit(0);
}

if (!APPLY) {
  console.log("\n=== 5. Was ein Apply schreiben würde ===");
  const children = (parents: Set<number>, rows: Row[], fk: string) =>
    rows.filter((r) => parents.has(r[fk] as number)).length;
  const newP = new Set(newPurchases.map((r) => r.id as number));
  const newS = new Set(newSales.map((r) => r.id as number));
  console.log(`  purchases                ${newPurchases.length}`);
  console.log(`  purchase_items           ${children(newP, sPItems, "purchase_id")}`);
  console.log(`  sales                    ${newSales.length}`);
  console.log(`  sale_items               ${children(newS, sSItems, "sale_id")}`);
  console.log(`  sale_fees                ${children(newS, sFees, "sale_id")}`);
  console.log(`  sale_refunds             ${children(newS, sRefunds, "sale_id")}`);
  console.log(`  settlement_adjustments   ${newAdj.length}`);
  console.log(`  orderbook_name_mappings  ${sMappings.length} (upsert)`);
  console.log(`  inventory_movements      0`);
  console.log(`  shop_inventory           0`);
  console.log(`  auth.users               0`);
  console.log("\nVorschau. Es wurde nichts geschrieben. Mit --apply --confirm-production übertragen.\n");
  process.exit(0);
}

/* ------------------------------------------------------------------ write */

async function insert(table: string, rows: Row[], drop: readonly string[]): Promise<Row[]> {
  const written: Row[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => strip(r, drop));
    const res = await P.from(table).insert(chunk).select();
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    written.push(...(res.data as Row[]));
  }
  console.log(`  ${table.padEnd(24)} ${written.length} geschrieben`);
  return written;
}

console.log("\n=== 5. Schreiben ===");
const NO_AUTH = ["created_by", "updated_by"] as const;

// Parents first; the source order is kept so the new ids run in the same order.
const wroteP = await insert("purchases", newPurchases, ["id", ...NO_AUTH]);
const pIdMap = new Map<number, number>();
newPurchases.forEach((src, i) => pIdMap.set(src.id as number, wroteP[i].id as number));

const pItemsToWrite = sPItems
  .filter((r) => pIdMap.has(r.purchase_id as number))
  .map((r) => ({ ...r, purchase_id: pIdMap.get(r.purchase_id as number)!, movement_id: null }));
await insert("purchase_items", pItemsToWrite, ["id"]);

const wroteS = await insert("sales", newSales, ["id", ...NO_AUTH]);
const sIdMap = new Map<number, number>();
newSales.forEach((src, i) => sIdMap.set(src.id as number, wroteS[i].id as number));

const remap = (rows: Row[], extra: Row = {}) => rows
  .filter((r) => sIdMap.has(r.sale_id as number))
  .map((r) => ({ ...r, sale_id: sIdMap.get(r.sale_id as number)!, ...extra }));

await insert("sale_items", remap(sSItems, { movement_id: null, return_movement_id: null }), ["id"]);
await insert("sale_fees", remap(sFees), ["id", "created_by"]);
await insert("sale_refunds", remap(sRefunds), ["id", "created_by"]);
// A standalone correction keeps its NULL sale_id; a linked one is remapped.
await insert("settlement_adjustments", newAdj.map((r) => ({
  ...r, sale_id: r.sale_id === null ? null : sIdMap.get(r.sale_id as number) ?? null,
})), ["id", "created_by"]);

for (const m of sMappings) {
  const res = await P.from("orderbook_name_mappings")
    .upsert(strip(m, ["id", "created_by"]), { onConflict: "normalised_name" });
  if (res.error) throw new Error(`orderbook_name_mappings: ${res.error.message}`);
}
console.log(`  orderbook_name_mappings  ${sMappings.length} upserted`);

/* ----------------------------------------------------------------- verify */

console.log("\n=== 6. Nachprüfung ===");
const after = {
  purchases: (await P.from("purchases").select("id", { count: "exact", head: true })).count,
  purchase_items: (await P.from("purchase_items").select("id", { count: "exact", head: true })).count,
  sales: (await P.from("sales").select("id", { count: "exact", head: true })).count,
  sale_items: (await P.from("sale_items").select("id", { count: "exact", head: true })).count,
  sale_fees: (await P.from("sale_fees").select("id", { count: "exact", head: true })).count,
  sale_refunds: (await P.from("sale_refunds").select("id", { count: "exact", head: true })).count,
  settlement_adjustments: (await P.from("settlement_adjustments").select("id", { count: "exact", head: true })).count,
};
for (const [k, v] of Object.entries(after)) console.log(`  ${k.padEnd(24)} ${v}`);
const stockAfter = await page(P, "shop_inventory", "id, quantity, reserved");
const movesAfter = await P.from("inventory_movements").select("id", { count: "exact", head: true });
const qBefore = stockBefore.reduce((a, r) => a + Number(r.quantity), 0);
const qAfter = stockAfter.reduce((a, r) => a + Number(r.quantity), 0);
console.log(`  Bestand    ${qBefore} → ${qAfter}   ${qBefore === qAfter ? "UNVERÄNDERT" : "ABWEICHUNG!"}`);
console.log(`  Bewegungen ${movesBefore.count} → ${movesAfter.count}   ${movesBefore.count === movesAfter.count ? "UNVERÄNDERT" : "ABWEICHUNG!"}`);
const tests = await P.from("sales").select("id", { count: "exact", head: true }).eq("is_test", true);
console.log(`  Verkäufe mit is_test: ${tests.count}`);
console.log("\nFertig.\n");
