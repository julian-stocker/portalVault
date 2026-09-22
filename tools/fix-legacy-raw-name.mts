/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  EINMALIGE KORREKTUR — EINE ZEILE, EIN FELD                          ║
 * ║  STAGING ONLY · EXECUTED 2026-09-22 · DO NOT RUN AGAIN               ║
 * ║  Quellzeile 1506 der Arbeitsmappe                                    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * WAS PASSIERT IST
 *
 * Die Arbeitsmappe schreibt diese Position `"Eruptor "` — mit abschließendem
 * Leerzeichen. Der Phase-A-Sync korrigierte an ihr `legacy_stock_flag`
 * (null → "x"); weil `system_sync_legacy_sale_item` bei jedem Update alle
 * vier Spalten schreibt und das Werkzeug den Namen damals durch `txt()`
 * schickte, wurde `raw_name` dabei auf `"Eruptor"` getrimmt. Niemand hat das
 * geplant, und kein Vergleich hat es angezeigt: der Planer normalisiert beide
 * Seiten, ein Leerzeichen allein ist für ihn kein Unterschied.
 *
 * Die Ursache ist im Sync behoben — `raw_name` wird jetzt roh durchgereicht.
 * Dieses Werkzeug holt nur den einen bereits getrimmten Wert zurück. Genau
 * deshalb KANN der Sync das nicht selbst: für ihn sind `"Eruptor"` und
 * `"Eruptor "` gleich, er würde die Zeile nie anfassen.
 *
 * WARUM EIN EIGENES WERKZEUG UND KEIN SQL
 *
 * Geschrieben wird über `system_sync_legacy_sale_item` — denselben Pfad wie
 * der Sync, mit denselben Prüfungen (Legacy-Verkauf, keine Bestellung,
 * Quellzeile vorhanden). Kein direkter UPDATE, kein zweiter Schreibweg.
 *
 * DER SOLLWERT WIRD NICHT GETIPPT. Er kommt aus `planSales()`, also aus dem
 * Importer selbst, der die Mappe liest. Ein hier hineingeschriebener String
 * wäre eine Behauptung; der Plan ist die Quelle.
 *
 * NACH DEM LAUF IST DIESES WERKZEUG ERLEDIGT. Ein zweiter Lauf findet den
 * DB-Wert bereits korrekt vor und bricht am Gate ab. Auf PRODUCTION wurde es
 * nie gebraucht: dort lief der Sync erst, nachdem die Ursache behoben war,
 * und kein Name hat je ein Leerzeichen verloren.
 *
 *   npm run fix:legacy-raw-name:staging              # Vorschau
 *   npm run fix:legacy-raw-name:staging -- --apply   # schreibt eine Zeile
 */
import { openAsBlob } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";
import { readWorkbookParts } from "../src/lib/import/xlsx-reader.ts";
import { parseSharedStrings, parseSheet } from "../src/lib/import/sheet-rows.ts";
import {
  STOCK_SHEETS, groupRows, indexCatalog, parseOrderSheet, type CatalogEntry,
} from "../src/lib/orderbook/order-2026.ts";
import { groupSales, parseSalesSheet } from "../src/lib/orderbook/sales-2026.ts";
import {
  buildSelfUsage, buildTightNameIndex, planSales, tighten,
  type SalePlan, type SalesPlanDeps,
} from "../src/lib/orderbook/sales-import.ts";

/** Der Umfang dieser Ausnahme, namentlich. Keine Schleife, keine Liste. */
const ITEM_ID = 1219;
const SALE_ID = 303;
const SOURCE_ROW = 1506;
const LEGACY_SOURCE = "excel_order_2026";

const WORKBOOK = process.env.SKYISLES_WORKBOOK
  ?? `${process.env.HOME}/Documents/eCommerce/skylanders.xlsx`;
const ORDER_SHEET = "Order 2026";
const APPLY = process.argv.includes("--apply");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`${name} fehlt.`); process.exit(1); }
  return v;
}
const url = requireStaging("fix:legacy-raw-name");
const client = createClient(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } });

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
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(46)} ${JSON.stringify(got)}` +
    `${ok ? "" : `   ERWARTET ${JSON.stringify(want)}`}`);
};

console.log(`Workbook  ${WORKBOOK}`);
console.log(`Ziel      ${url}`);
console.log(`Modus     ${APPLY ? "APPLY — eine Zeile, ein Feld" : "VORSCHAU — es wird nichts geschrieben"}\n`);

/* ---------------------------------------------------------- Datenbestand */

type SaleRow = { id: number; source: string; order_id: number | null; import_fingerprint: string | null };
type SaleItemRow = { id: number; sale_id: number; source_row: number | null; raw_name: string;
  sky_id: string | null; legacy_stock_flag: string | null; legacy_shipped_flag: string | null;
  movement_id: number | null; settled_at: string | null };

const catalogRows = await page<{ sky_id: string; name: string; series_code: string;
  category_id: number | null }>("skylanders", "sky_id");
const categories = await page<{ id: number; name: string }>("categories");
const nameMappings = await page<{ normalised_name: string; sky_id: string | null }>(
  "orderbook_name_mappings", "normalised_name");
const sales = await page<SaleRow>("sales");
const saleItems = await page<SaleItemRow>("sale_items");
const { data: globalFactor } = await client.rpc("orderbook_global_factor");

/* ------------------------------ der Sollwert, aus dem Plan des Importers */

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
const salesSheetRows = parseSalesSheet(orderXml, shared);
const purchaseGroups = groupRows(parseOrderSheet(orderXml, shared)).filter((g) => g.items.length > 0);
const disneyNames = new Set<string>();
for (const [k, n] of stockByRow) if (k.startsWith("DI A|")) disneyNames.add(tighten(n));

const deps: SalesPlanDeps = {
  stockName: stockNameOf, bySheetName: indexCatalog(importCatalog),
  savedMappings: new Map(nameMappings.map((m) => [m.normalised_name, m.sky_id])),
  selfUsage: buildSelfUsage(salesSheetRows, stockNameOf, purchaseGroups.flatMap((g) => g.items)),
  byTightName: buildTightNameIndex(importCatalog), disneyNames,
  imported: new Set(sales.map((s) => s.import_fingerprint).filter((f): f is string => f !== null)),
  factor: Number(globalFactor),
};
const plans: SalePlan[] = await planSales(groupSales(salesSheetRows) as never, deps);

type PlanItem = { sourceRow: number; rawName: string; skyId: string | null;
  stockFlag: string; shippedFlag: string };
const planItems = plans.filter((p) => p.status !== "standalone_correction")
  .flatMap((p) => p.items as unknown as PlanItem[]);
const wanted = planItems.filter((i) => i.sourceRow === SOURCE_ROW);

/* ============================================================== DAS GATE */

console.log("══ GATE ══");
const item = saleItems.find((i) => i.id === ITEM_ID);
const sale = sales.find((s) => s.id === SALE_ID);

gate("sale_item existiert", item !== undefined, true);
gate("sale existiert", sale !== undefined, true);
gate("Quellzeile genau einmal im Plan", wanted.length, 1);
if (failures > 0 || item === undefined || sale === undefined || wanted.length !== 1) {
  console.error("\nSTOP. Es wurde nichts geschrieben.\n");
  process.exit(1);
}
const plan = wanted[0];

gate("sale_item.id", item.id, ITEM_ID);
gate("sale_item.sale_id", item.sale_id, SALE_ID);
gate("sale_item.source_row", item.source_row, SOURCE_ROW);
gate("sales.source", sale.source, LEGACY_SOURCE);
gate("sales.order_id", sale.order_id, null);
gate("DB-Wert jetzt", item.raw_name, "Eruptor");
gate("Mappenwert (aus planSales)", plan.rawName, "Eruptor ");
gate("Unterschied ist NUR Rand-Leerzeichen", txt(item.raw_name) === txt(plan.rawName), true);
gate("sky_id stimmt bereits", txt(item.sky_id) === txt(plan.skyId), true);
gate("stock_flag stimmt bereits", txt(item.legacy_stock_flag) === txt(plan.stockFlag), true);
gate("shipped_flag stimmt bereits", txt(item.legacy_shipped_flag) === txt(plan.shippedFlag), true);
gate("keine Bewegung an der Zeile", item.movement_id, null);
/*
 * `settled_at` wird NICHT zurückgesetzt und auch nicht geprüft-erzwungen:
 * die Funktion fasst es nicht an. Es wird nur berichtet, damit sichtbar
 * bleibt, dass an dieser Zeile abgerechnete Historie hängt.
 */
console.log(`  ℹ settled_at bleibt unangetastet: ${item.settled_at ?? "—"}`);

/* Kein anderer Datensatz darf in denselben Zustand geraten sein. */
const others = saleItems.filter((i) => i.id !== ITEM_ID)
  .filter((i) => {
    const p = planItems.find((x) => x.sourceRow === i.source_row);
    return p !== undefined && p.rawName !== i.raw_name;
  });
gate("weitere Zeilen mit abweichendem Namen", others.map((i) => i.id), []);

console.log(`\n  Gate: ${failures === 0 ? "OFFEN" : `GESCHLOSSEN — ${failures} Abweichung(en)`}`);
if (failures > 0) { console.error("\nSTOP. Es wurde nichts geschrieben.\n"); process.exit(1); }

if (!APPLY) {
  console.log("\n  Kein --apply. Es wurde nichts geschrieben.");
  console.log(`  Bereit: #${ITEM_ID} ${JSON.stringify(item.raw_name)} → ${JSON.stringify(plan.rawName)}\n`);
  process.exit(0);
}

/* ============================================================ DIE ZEILE */

console.log("\n══ KORREKTUR ══");
const { error } = await client.rpc("system_sync_legacy_sale_item", {
  p_item_id: ITEM_ID,
  // Der Name roh aus dem Plan; die drei übrigen Spalten unverändert aus der
  // Datenbank, damit dieser Aufruf nichts anderes bewegt als das Leerzeichen.
  p_raw_name: plan.rawName,
  p_sky_id: item.sky_id,
  p_stock_flag: item.legacy_stock_flag,
  p_shipped_flag: item.legacy_shipped_flag,
});
if (error) { console.error(`  ABBRUCH: ${error.code ?? ""} ${error.message}`.trim()); process.exit(1); }

const { data: after, error: readError } = await client.from("sale_items")
  .select("id, sale_id, source_row, raw_name, sky_id, legacy_stock_flag, legacy_shipped_flag, settled_at")
  .eq("id", ITEM_ID).single();
if (readError) { console.error(`  Nachlesen fehlgeschlagen: ${readError.message}`); process.exit(1); }

console.log("\n══ NACHPRÜFUNG ══");
failures = 0;
gate("raw_name", after.raw_name, plan.rawName);
gate("sky_id unverändert", after.sky_id, item.sky_id);
gate("stock_flag unverändert", after.legacy_stock_flag, item.legacy_stock_flag);
gate("shipped_flag unverändert", after.legacy_shipped_flag, item.legacy_shipped_flag);
gate("settled_at unverändert", after.settled_at, item.settled_at);
gate("sale_id unverändert", after.sale_id, item.sale_id);
gate("source_row unverändert", after.source_row, item.source_row);

console.log(`\n${failures === 0 ? "KORREKTUR ABGESCHLOSSEN." : `ROT — ${failures} Abweichung(en)`}`);
if (failures > 0) process.exitCode = 1;
