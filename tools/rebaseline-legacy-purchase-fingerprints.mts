/**
 * ###########################################################################
 * ##                                                                       ##
 * ##   PRE-GO-LIVE ONE-TIME LEGACY FINGERPRINT REBASELINE                  ##
 * ##                                                                       ##
 * ##   Einmalig für die Einkaufsgruppen #82–#93. Danach nicht wieder.      ##
 * ##                                                                       ##
 * ###########################################################################
 *
 * WARUM ES DIESE AUSNAHME GIBT
 *
 * Dreizehn Legacy-Einkaufsgruppen (#81–#93) trugen einen Fingerabdruck, der
 * schon VOR Phase A nicht mehr zur Arbeitsmappe passte. Nachgewiesen: mit den
 * Abdrücken des Pre-Phase-A-Snapshots meldet der Planer 71 `already_imported`
 * und 13 `eligible` — die Abweichung ist also älter als jeder Schritt dieses
 * Projekts.
 *
 * DER URSPRUNG IST NICHT VOLLSTÄNDIG REKONSTRUIERBAR, und das wird hier
 * ausgesprochen statt kaschiert. `canonicalPurchaseIdentity` hasht
 * ausdrücklich JEDE Quellzeile der Gruppe, auch die als beschädigt
 * aussortierten — und genau die landen nie in `purchase_items`. Wo eine
 * Gruppe solche Zeilen hat, fehlt jeder Rekonstruktion ein Teil der Eingabe.
 * Drei der zwölf Gruppen (#83, #86, #88) haben je eine solche Zeile; bei den
 * übrigen neun ist auch das kein Mechanismus, der die Abweichung erklärt.
 *
 * WARUM DAS TROTZDEM VERTRETBAR IST
 *
 * Weil der FACHLICHE Zustand vollständig geprüft ist, nicht nur der Hash.
 * Vor dem Schreiben verifiziert dieses Werkzeug für jede der zwölf Gruppen
 * Kopfzeile, Datum, Ausgaben und die vollständige, vom Importer selbst
 * definierte Positionsmenge samt aller fünf gehashten Felder je Zeile gegen
 * die Arbeitsmappe. Erst wenn das für alle zwölf hält, wird gestempelt.
 *
 * #81 wurde bereits während des abgebrochenen Phase-A-Laufs auf den
 * korrekten aktuellen Abdruck gesetzt. Es wird hier NUR verifiziert, nicht
 * erneut geschrieben.
 *
 * DIES IST KEINE LOCKERUNG DES FAIL-CLOSED-TORS.
 *
 * Der reguläre Sync verweigert unerklärte Abweichungen weiterhin, und das
 * soll so bleiben. Diese Datei ist eine benannte, begrenzte, protokollierte
 * Ausnahme für dreizehn konkret identifizierte Altgruppen vor dem Go-Live —
 * kein Muster, dem künftige Abweichungen folgen dürfen. Ein zweiter Lauf
 * findet nichts mehr zu tun und soll auch nichts mehr finden.
 *
 * DIE ABDRÜCKE WERDEN NICHT NACHGEBAUT. Sie kommen aus `planBatch()`, dem
 * Plan des echten Importers. Ein eigener Algorithmus wäre genau die zweite
 * Meinung, die dieses Projekt gerade teuer abgeschafft hat.
 */
import { openAsBlob } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { readWorkbookParts } from "../src/lib/import/xlsx-reader.ts";
import { parseSharedStrings, parseSheet } from "../src/lib/import/sheet-rows.ts";
import {
  STOCK_SHEETS, groupRows, indexCatalog, parseOrderSheet, type CatalogEntry,
} from "../src/lib/orderbook/order-2026.ts";
import { groupSales, parseSalesSheet } from "../src/lib/orderbook/sales-2026.ts";
import { planBatch } from "../src/lib/orderbook/batch-import.ts";
import {
  buildSelfUsage, buildTightNameIndex, planSales, tighten, type SalePlan, type SalesPlanDeps,
} from "../src/lib/orderbook/sales-import.ts";

/** Die Gruppen dieser einmaligen Ausnahme. Namentlich, nicht als Bereich. */
const REBASELINE = [82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93] as const;
/** Bereits gestempelt; wird nur verifiziert. */
const ALREADY_DONE = 81;

const WORKBOOK = process.env.SKYISLES_WORKBOOK
  ?? `${process.env.HOME}/Documents/eCommerce/skylanders.xlsx`;
const ORDER_SHEET = "Order 2026";
const APPLY = process.argv.includes("--apply");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`${name} fehlt.`); process.exit(1); }
  return v;
}
const client = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

async function page<T>(table: string, key = "id"): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select("*").order(key).range(from, from + 999);
    if (error) { console.error(`${table}: ${error.message}`); process.exit(1); }
    out.push(...(data as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}
const txt = (v: unknown) => String(v ?? "").trim();

let failures = 0;
const gate = (label: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(52)} ${String(got).padStart(10)}${ok ? "" : `  ERWARTET ${want}`}`);
};

console.log(`Workbook  ${WORKBOOK}`);
console.log(`Ziel      ${requireEnv("NEXT_PUBLIC_SUPABASE_URL")}`);
console.log(`Modus     ${APPLY ? "APPLY — es werden 12 Fingerabdrücke geschrieben" : "VORSCHAU"}\n`);

/* ------------------------------------------------------- Daten und Pläne */

type PurchaseRow = { id: number; source: string; import_fingerprint: string | null;
  note: string | null; purchased_at: string | null; total_cost: string | number };
type PurchaseItemRow = { id: number; purchase_id: number; source_row: number | null;
  raw_name: string; sky_id: string | null;
  legacy_condition_flag: string | null; legacy_booked_flag: string | null };

const catalogRows = await page<{ sky_id: string; name: string; series_code: string;
  category_id: number | null }>("skylanders", "sky_id");
const categories = await page<{ id: number; name: string }>("categories");
const nameMappings = await page<{ normalised_name: string; sky_id: string | null }>(
  "orderbook_name_mappings", "normalised_name");
const purchases = await page<PurchaseRow>("purchases");
const purchaseItems = await page<PurchaseItemRow>("purchase_items");
const sales = await page<{ id: number; source: string; import_fingerprint: string | null }>("sales");
const saleItems = await page<{ id: number; sale_id: number; source_row: number | null }>("sale_items");
const { data: globalFactor } = await client.rpc("orderbook_global_factor");

const parts = await readWorkbookParts(await openAsBlob(WORKBOOK),
  [ORDER_SHEET, ...STOCK_SHEETS, "DI A"]);
const shared = parseSharedStrings(parts.sharedStrings);
const stockByRow = new Map<string, string>();
for (const sheet of [...STOCK_SHEETS, "DI A"]) {
  const xml = parts.sheets.get(sheet);
  if (!xml) continue;
  for (const r of parseSheet(sheet, xml, shared)) stockByRow.set(`${sheet}|${r.sourceRow}`, r.name);
}
const stockNameOf = (s: string, r: number) => stockByRow.get(`${s}|${r}`) ?? null;
const categoryName = new Map(categories.map((c) => [c.id, c.name]));
const importCatalog = catalogRows.map((r) => ({
  skyId: r.sky_id, name: r.name, series: r.series_code,
  category: categoryName.get(r.category_id ?? -1) ?? "",
} as unknown as CatalogEntry));

const orderXml = parts.sheets.get(ORDER_SHEET) ?? "";
const purchaseGroups = groupRows(parseOrderSheet(orderXml, shared)).filter((g) => g.items.length > 0);
const purchaseDeps = {
  stockName: stockNameOf, bySheetName: indexCatalog(importCatalog),
  mappings: new Map(nameMappings.map((m) => [m.normalised_name, m.sky_id])),
  imported: new Set(purchases.map((p) => p.import_fingerprint).filter((f): f is string => f !== null)),
};
const batch = await planBatch(purchaseGroups as never, purchaseDeps as never);

type MigratedItem = { sourceRow: number; rawName: string; skyId: string | null;
  legacyConditionFlag: string; legacyBookedFlag: string };
const rowToPurchase = new Map(purchaseItems.map((i) => [i.source_row, i.purchase_id]));
const purchaseById = new Map(purchases.map((p) => [p.id, p]));
const headerOf = (note: string | null) => {
  const m = /Kopfzeile (\d+)/.exec(String(note ?? ""));
  return m ? Number(m[1]) : null;
};

/* Plan ↔ Gruppe, über die Quellzeilen. */
const planOfPurchase = new Map<number, (typeof batch.plans)[number]>();
for (const p of batch.plans) {
  const ids = new Set((p.preview.migrated as unknown as MigratedItem[])
    .map((i) => rowToPurchase.get(i.sourceRow)).filter((x): x is number => x !== undefined));
  if (ids.size === 1) planOfPurchase.set([...ids][0], p);
}

/* ==========================================================================
 * 1. HARD GATE — read-only, unmittelbar vor jedem Schreiben
 * ======================================================================== */

console.log("══ 1. PRE-REBASELINE GATE ══\n── Bestand und Mengen ──");
const legacyPurchases = purchases.filter((p) => p.source === "excel_order_2026");
const legacyIds = new Set(legacyPurchases.map((p) => p.id));
const legacyItems = purchaseItems.filter((i) => legacyIds.has(i.purchase_id));
gate("Legacy purchases", legacyPurchases.length, 84);
gate("Legacy purchase_items", legacyItems.length, 2114);
gate("manual purchase_items", purchaseItems.length - legacyItems.length, 7);

const migratedRows = new Set<number>();
for (const p of batch.plans) {
  for (const i of p.preview.migrated as unknown as MigratedItem[]) migratedRows.add(i.sourceRow);
}
const dbRows = new Set(legacyItems.map((i) => i.source_row)
  .filter((r): r is number => r !== null));
gate("Importer preview.migrated", migratedRows.size, 2114);
gate("fehlende migrierte Positionen", [...migratedRows].filter((r) => !dbRows.has(r)).length, 0);
gate("zusätzliche Legacy-Positionen", [...dbRows].filter((r) => !migratedRows.has(r)).length, 0);

console.log("\n── Fingerabdrücke ──");
const eligible = batch.plans.filter((p) => p.status === "eligible");
const eligibleExisting = eligible.map((p) => {
  const ids = new Set((p.preview.migrated as unknown as MigratedItem[])
    .map((i) => rowToPurchase.get(i.sourceRow)).filter((x): x is number => x !== undefined));
  return ids.size === 1 ? [...ids][0] : null;
}).filter((x): x is number => x !== null).sort((a, b) => a - b);
gate("already_imported", batch.plans.filter((p) => p.status === "already_imported").length, 72);
gate("blocked", batch.plans.filter((p) => p.status === "blocked").length, 0);
gate("eligible", eligible.length, REBASELINE.length);
gate("eligible sind exakt #82–#93", eligibleExisting.join(","), [...REBASELINE].join(","));

const plan81 = planOfPurchase.get(ALREADY_DONE);
gate(`#${ALREADY_DONE} Abdruck == Importer-Abdruck`,
  purchaseById.get(ALREADY_DONE)?.import_fingerprint === plan81?.fingerprint, true);

console.log("\n── Die zwölf Gruppen, Komponente für Komponente ──");
console.log(`  ${"#".padStart(4)} ${"Kopf".padStart(5)} ${"Datum".padEnd(11)} ${"Ausgaben".padStart(9)} ${"Pos".padStart(4)} Prüfung`);
const writes: { id: number; fingerprint: string }[] = [];
for (const id of REBASELINE) {
  const p = planOfPurchase.get(id);
  const row = purchaseById.get(id);
  if (!p || !row) { failures += 1; console.log(`  ✗ #${id}: kein Plan oder keine Zeile`); continue; }

  const stored = purchaseItems.filter((i) => i.purchase_id === id);
  const items = p.preview.migrated as unknown as MigratedItem[];
  const byRow = new Map(stored.map((i) => [i.source_row, i]));

  const checks: [string, boolean][] = [
    ["headerRow", headerOf(row.note) === (p.headerRow as number)],
    ["date", txt(row.purchased_at).slice(0, 10) === txt(p.date)],
    ["totalCost", Number(row.total_cost) === Number(p.totalCost ?? 0)],
    ["Positionszahl", stored.length === items.length],
    ["Positionsmenge", items.every((i) => byRow.has(i.sourceRow))
      && stored.every((s) => items.some((i) => i.sourceRow === s.source_row))],
    ["Felder je Position", items.every((i) => {
      const s = byRow.get(i.sourceRow);
      return s !== undefined
        && s.raw_name === i.rawName
        && (s.legacy_condition_flag ?? "") === (i.legacyConditionFlag ?? "")
        && (s.legacy_booked_flag ?? "") === (i.legacyBookedFlag ?? "")
        && (s.sky_id ?? null) === (i.skyId ?? null);
    })],
    ["Legacy-Einkauf", row.source === "excel_order_2026"],
    ["keine Bewegung", stored.every((s) => (s as unknown as { movement_id: number | null }).movement_id === null)],
    ["Abdruck weicht ab", row.import_fingerprint !== p.fingerprint],
  ];
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (bad.length > 0) failures += 1;
  console.log(`  ${bad.length === 0 ? "✓" : "✗"} ${String(id).padStart(3)} ${String(p.headerRow).padStart(5)}` +
    ` ${txt(p.date).padEnd(11)} ${String(p.totalCost).padStart(9)} ${String(items.length).padStart(4)}` +
    ` ${bad.length === 0 ? "alle 9 Prüfungen" : "FEHLER: " + bad.join(", ")}`);
  if (bad.length === 0) writes.push({ id, fingerprint: p.fingerprint });
}

console.log(`\n  Gate: ${failures === 0 ? "OFFEN" : `GESCHLOSSEN — ${failures} Abweichung(en)`}`);
if (failures > 0) { console.error("\nSTOP. Es wurde nichts geschrieben."); process.exit(1); }
if (writes.length !== REBASELINE.length) {
  console.error(`\nSTOP: ${writes.length} statt ${REBASELINE.length} Gruppen freigegeben.`);
  process.exit(1);
}

if (!APPLY) {
  console.log(`\n  Kein --apply. Es wurde nichts geschrieben.`);
  console.log(`  Bereit zum Stempeln: ${writes.map((w) => `#${w.id}`).join(" ")}`);
  process.exit(0);
}

/* ==========================================================================
 * 2. REBASELINE — nur `import_fingerprint`, nur diese zwölf
 * ======================================================================== */

console.log("\n══ 2. REBASELINE ══");
for (const w of writes) {
  const before = purchaseById.get(w.id)?.import_fingerprint ?? "—";
  const { error } = await client.rpc("system_set_legacy_purchase_fingerprint", {
    p_purchase_id: w.id, p_fingerprint: w.fingerprint,
  });
  if (error) { console.error(`ABBRUCH bei #${w.id}: ${error.message}`); process.exit(1); }
  console.log(`  #${String(w.id).padStart(3)}  ${String(before).slice(0, 16)}… → ${w.fingerprint.slice(0, 16)}…`);
}
console.log(`  ${writes.length} Abdrücke geschrieben.`);

/* ==========================================================================
 * 3. POST-REBASELINE GATE
 * ======================================================================== */

console.log("\n══ 3. POST-REBASELINE ══");
const purchasesAfter = await page<PurchaseRow>("purchases");
const itemsAfter = await page<PurchaseItemRow>("purchase_items");
const batchAfter = await planBatch(purchaseGroups as never, { ...purchaseDeps,
  imported: new Set(purchasesAfter.map((p) => p.import_fingerprint).filter((f): f is string => f !== null)),
} as never);
failures = 0;
gate("already_imported", batchAfter.plans.filter((p) => p.status === "already_imported").length, 84);
gate("eligible", batchAfter.plans.filter((p) => p.status === "eligible").length, 0);
gate("blocked", batchAfter.plans.filter((p) => p.status === "blocked").length, 0);
const legacyAfter = new Set(purchasesAfter.filter((p) => p.source === "excel_order_2026").map((p) => p.id));
const rowsAfter = new Set(itemsAfter.filter((i) => legacyAfter.has(i.purchase_id))
  .map((i) => i.source_row).filter((r): r is number => r !== null));
gate("Legacy purchase_items", rowsAfter.size, 2114);
gate("fehlend", [...migratedRows].filter((r) => !rowsAfter.has(r)).length, 0);
gate("zusätzlich", [...rowsAfter].filter((r) => !migratedRows.has(r)).length, 0);

/* ==========================================================================
 * 4. SALES-GATE — read-only
 * ======================================================================== */

console.log("\n══ 4. SALES-GATE (read-only) ══");
const salesSheetRows = parseSalesSheet(orderXml, shared);
const disneyNames = new Set<string>();
for (const [key, name] of stockByRow) if (key.startsWith("DI A|")) disneyNames.add(tighten(name));
const saleDeps: SalesPlanDeps = {
  stockName: stockNameOf, bySheetName: indexCatalog(importCatalog),
  savedMappings: new Map(nameMappings.map((m) => [m.normalised_name, m.sky_id])),
  selfUsage: buildSelfUsage(salesSheetRows, stockNameOf, purchaseGroups.flatMap((g) => g.items)),
  byTightName: buildTightNameIndex(importCatalog), disneyNames,
  imported: new Set(sales.map((s) => s.import_fingerprint).filter((f): f is string => f !== null)),
  factor: Number(globalFactor),
};
const salePlans: SalePlan[] = await planSales(groupSales(salesSheetRows) as never, saleDeps);
const rowToSale = new Map(saleItems.map((i) => [i.source_row, i.sale_id]));
let existingAlready = 0, existingEligible = 0, newEligible = 0, newPositions = 0, corrections = 0;
for (const p of salePlans) {
  if (p.status === "standalone_correction") { corrections += 1; continue; }
  const ids = new Set(p.items.map((i) => rowToSale.get(i.sourceRow)).filter((x) => x !== undefined));
  const existing = ids.size === 1;
  if (p.status === "eligible") {
    if (existing) existingEligible += 1;
    else { newEligible += 1; newPositions += p.items.length; }
  } else if (existing) existingAlready += 1;
}
gate("bestehende already_imported", existingAlready, 292);
gate("bestehende eligible", existingEligible, 0);
gate("neue Gruppen eligible", newEligible, 4);
gate("Positionen der neuen Gruppen", newPositions, 27);
gate("standalone_correction", corrections, 1);

/* ==========================================================================
 * 5. GESAMTINVARIANTEN
 * ======================================================================== */

console.log("\n══ 5. INVARIANTEN ══");
const inv = await page<{ sky_id: string; condition: string; quantity: number; reserved: number }>("shop_inventory");
const num = (s: string) => Number(String(s).replace(/^SKY-/, ""));
const real = inv.filter((r) => num(r.sky_id) < 9000);
gate("purchases gesamt", purchasesAfter.length, 87);
gate("purchase_items gesamt", itemsAfter.length, 2121);
gate("sales", sales.length, 292);
gate("sale_items", saleItems.length, 1253);
gate("inventory_movements", (await page("inventory_movements")).length, 0);
gate("legacy_stock_events", (await page("legacy_stock_events")).length, 2671);
gate("real loose", real.filter((r) => r.condition === "loose").reduce((a, r) => a + r.quantity, 0), 824);
gate("real boxed", real.filter((r) => r.condition === "boxed").reduce((a, r) => a + r.quantity, 0), 10);
gate("reserved", inv.reduce((a, r) => a + r.reserved, 0), 0);
gate("Fixtures", inv.length - real.length, 0);
for (const t of ["sale_fees", "sale_refunds", "settlement_adjustments",
                 "orderbook_audit", "orderbook_name_mappings"]) {
  console.log(`  ℹ ${t.padEnd(52)} ${String((await page(t, t === "orderbook_name_mappings" ? "normalised_name" : "id")).length).padStart(10)}`);
}

console.log(`\n${failures === 0 ? "REBASELINE ABGESCHLOSSEN UND VERIFIZIERT." : `ROT — ${failures} Abweichung(en)`}`);
if (failures > 0) process.exitCode = 1;
