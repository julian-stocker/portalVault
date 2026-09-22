/**
 * Legacy-Orderbuch-Sync (0088/0089).
 *
 * Bringt die bestehende Orderbuchhistorie auf den Stand der aktuellen
 * Arbeitsmappe, ohne bestehende Gruppen zu verdoppeln. Warum die Identität
 * die Quellzeile sein muss: `src/lib/orderbook/legacy-sync.ts`.
 *
 * DIE POSITIONSMENGE KOMMT VOM IMPORTER, NICHT VON DIESEM WERKZEUG.
 *
 * Das ist die wichtigste Regel hier, und sie steht am Anfang, weil ihre
 * Verletzung teuer war: die erste Fassung hielt jede benannte Zeile der
 * Mappe für eine Position und fügte 79 als `IGNORED_DAMAGED` klassifizierte
 * Zeilen ein — Namen wie `chill (B)`, die der Importer bewusst nie
 * übernimmt. Sync und Importer waren unterschiedlicher Meinung darüber, was
 * eine Position ist, und das Ergebnis waren 79 Zeilen Geschäftshistorie, die
 * es nie gegeben hat.
 *
 * Deshalb stammen die Zeilen beider Seiten aus den Plänen der bestehenden
 * Importer — `planBatch(...).preview.migrated` und `planSales(...).items`.
 * Eine abweichende Meinung ist damit konstruktiv ausgeschlossen: es gibt nur
 * noch eine Klassifikation, und sie gehört dem Importer.
 *
 * DIE ARBEITSMAPPE WIRD NUR GELESEN, selektiv aus dem Zip.
 * OHNE `--apply` WIRD NICHTS GESCHRIEBEN.
 */
import { openAsBlob } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { readWorkbookParts } from "../src/lib/import/xlsx-reader.ts";
import { parseSharedStrings, parseSheet } from "../src/lib/import/sheet-rows.ts";
import {
  STOCK_SHEETS, groupRows, indexCatalog, parseOrderSheet, type CatalogEntry,
} from "../src/lib/orderbook/order-2026.ts";
import { groupSales, parseSalesSheet } from "../src/lib/orderbook/sales-2026.ts";
import { planBatch, purchaseFingerprint } from "../src/lib/orderbook/batch-import.ts";
import {
  buildSelfUsage, buildTightNameIndex, planSales, tighten,
  type SalePlan, type SalesPlanDeps,
} from "../src/lib/orderbook/sales-import.ts";
import {
  planLegacySync, planIsClean, planIsEmpty,
  type StoredLine, type SyncPlan, type WorkbookLine,
} from "../src/lib/orderbook/legacy-sync.ts";
import {
  classifyPurchaseGroup, importGateOpen, mayRestampPurchase, planGroups, saleDateDiff,
  type GroupFacts, type HeaderDiff, type PurchaseVerdict,
} from "../src/lib/orderbook/legacy-sync-groups.ts";

const WORKBOOK = process.env.SKYISLES_WORKBOOK
  ?? `${process.env.HOME}/Documents/eCommerce/skylanders.xlsx`;
const ORDER_SHEET = "Order 2026";
const LEGACY_SOURCE = "excel_order_2026";
const APPLY = process.argv.includes("--apply");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) { console.error(`${name} fehlt.`); process.exit(1); }
  return value;
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

console.log(`Workbook  ${WORKBOOK}`);
console.log(`Ziel      ${requireEnv("NEXT_PUBLIC_SUPABASE_URL")}`);
console.log(`Modus     ${APPLY ? "APPLY — es wird geschrieben" : "VORSCHAU — es wird nichts geschrieben"}\n`);

/* ------------------------------------------------------------- Datenbank */

type SaleRow = { id: number; source: string; order_id: number | null;
  import_fingerprint: string | null; note: string | null; sold_at: string | null;
  buyer_ref: string | null; items_subtotal: string | number };
type PurchaseRow = { id: number; source: string; import_fingerprint: string | null };
type SaleItemRow = { id: number; sale_id: number; source_row: number | null; raw_name: string;
  sky_id: string | null; legacy_stock_flag: string | null; legacy_shipped_flag: string | null };
type PurchaseItemRow = { id: number; purchase_id: number; source_row: number | null;
  raw_name: string; sky_id: string | null;
  legacy_condition_flag: string | null; legacy_booked_flag: string | null };

const catalogRows = await page<{ sky_id: string; name: string; series_code: string;
  category_id: number | null }>("skylanders", "sky_id");
const categories = await page<{ id: number; name: string }>("categories");
const nameMappings = await page<{ normalised_name: string; sky_id: string | null }>(
  "orderbook_name_mappings", "normalised_name");
const sales = await page<SaleRow>("sales");
const purchases = await page<PurchaseRow>("purchases");
const saleItems = await page<SaleItemRow>("sale_items");
const purchaseItems = await page<PurchaseItemRow>("purchase_items");
const { data: globalFactor } = await client.rpc("orderbook_global_factor");

/* ----------------------------------------------------------- Arbeitsmappe */

const parts = await readWorkbookParts(await openAsBlob(WORKBOOK),
  [ORDER_SHEET, ...STOCK_SHEETS, "DI A"]);
const shared = parseSharedStrings(parts.sharedStrings);
const stockByRow = new Map<string, string>();
for (const sheet of [...STOCK_SHEETS, "DI A"]) {
  const xml = parts.sheets.get(sheet);
  if (!xml) continue;
  for (const r of parseSheet(sheet, xml, shared)) stockByRow.set(`${sheet}|${r.sourceRow}`, r.name);
}
const stockNameOf = (sheet: string, row: number) => stockByRow.get(`${sheet}|${row}`) ?? null;

/* Genau das, was `seller_import_catalog` liefert: alles, ungefiltert. */
const categoryName = new Map(categories.map((c) => [c.id, c.name]));
const importCatalog = catalogRows.map((r) => ({
  skyId: r.sky_id, name: r.name, series: r.series_code,
  category: categoryName.get(r.category_id ?? -1) ?? "",
} as unknown as CatalogEntry));

const orderXml = parts.sheets.get(ORDER_SHEET) ?? "";
const salesSheetRows = parseSalesSheet(orderXml, shared);
const purchaseGroups = groupRows(parseOrderSheet(orderXml, shared)).filter((g) => g.items.length > 0);
const disneyNames = new Set<string>();
for (const [key, name] of stockByRow) if (key.startsWith("DI A|")) disneyNames.add(tighten(name));

/* ------------------------------------------ die Pläne der echten Importer */

const saleDeps: SalesPlanDeps = {
  stockName: stockNameOf,
  bySheetName: indexCatalog(importCatalog),
  savedMappings: new Map(nameMappings.map((m) => [m.normalised_name, m.sky_id])),
  selfUsage: buildSelfUsage(salesSheetRows, stockNameOf, purchaseGroups.flatMap((g) => g.items)),
  byTightName: buildTightNameIndex(importCatalog),
  disneyNames,
  imported: new Set(sales.map((s) => s.import_fingerprint).filter((f): f is string => f !== null)),
  factor: Number(globalFactor),
};
const saleGroups = groupSales(salesSheetRows) as unknown as
  { headerRow: number; buyer: string; money: Record<string, number> }[];
const salePlans: SalePlan[] = await planSales(saleGroups as never, saleDeps);

const purchaseDeps = {
  stockName: stockNameOf,
  bySheetName: indexCatalog(importCatalog),
  mappings: new Map(nameMappings.map((m) => [m.normalised_name, m.sky_id])),
  imported: new Set(purchases.map((p) => p.import_fingerprint).filter((f): f is string => f !== null)),
};
const purchaseBatch = await planBatch(purchaseGroups as never, purchaseDeps as never);

/*
 * DIE POSITIONEN, WIE DER IMPORTER SIE SIEHT.
 *
 * Nicht "jede benannte Zeile", sondern genau die, die er selbst übernehmen
 * würde. Was er als beschädigt, nicht-figürlich oder unauflösbar aussortiert,
 * erscheint hier gar nicht erst — und kann deshalb auch nicht eingefügt
 * werden.
 */
type MigratedItem = { sourceRow: number; position: number; rawName: string; skyId: string | null;
  legacyConditionFlag: string; legacyBookedFlag: string };

/*
 * `raw_name` WIRD ROH DURCHGEREICHT, NICHT NORMALISIERT.
 *
 * Der Name gehört dem Verkäufer und der Arbeitsmappe (CLAUDE.md, Regel 4):
 * ein Wert mit Rand-Leerzeichen ist der Wert, nicht ein Tippfehler, den
 * dieses Werkzeug stillschweigend aufräumt. Vorher stand hier `txt(...)`,
 * und weil `system_sync_legacy_sale_item` bei jedem Update alle vier
 * Spalten schreibt, verlor `sale_item #1219` sein abschließendes Leerzeichen
 * als Beifang eines Flag-Updates — eine Änderung, die niemand geplant und
 * kein Vergleich angezeigt hat.
 *
 * Verglichen wird weiterhin normalisiert: `planLegacySync` trimmt beide
 * Seiten, damit ein Leerzeichen allein kein Update auslöst. Roh ist nur,
 * was geschrieben wird. Die Flags bleiben normalisiert — sie sind
 * Ein-Zeichen-Marker, deren Rand-Leerzeichen keine Aussage tragen.
 */
const saleLines: WorkbookLine[] = salePlans
  .filter((p) => p.status !== "standalone_correction")
  .flatMap((p) => p.items.map((i) => ({
    sourceRow: i.sourceRow, headerRow: p.headerRow, position: i.position,
    rawName: i.rawName, skyId: i.skyId,
    stockFlag: txt(i.stockFlag), secondFlag: txt(i.shippedFlag),
  })));

const purchaseLines: WorkbookLine[] = purchaseBatch.plans.flatMap((p) =>
  (p.preview.migrated as unknown as MigratedItem[]).map((i) => ({
    sourceRow: i.sourceRow, headerRow: p.headerRow, position: i.position,
    rawName: i.rawName, skyId: i.skyId,
    stockFlag: txt(i.legacyBookedFlag), secondFlag: txt(i.legacyConditionFlag),
  })));

/* -------------------------------------------------- was die Datenbank hält */

/*
 * NUR LEGACY-ZEILEN. Eine operative Bestellung und ein von Hand angelegter
 * Einkauf sind keine Arbeitsmappen-Historie; der Sync hat dort nichts zu
 * suchen, und das Planmodul soll den Unterschied nicht raten müssen.
 */
const legacySaleIds = new Set(sales.filter((s) => s.source === LEGACY_SOURCE && s.order_id === null)
  .map((s) => s.id));
const legacyPurchaseIds = new Set(purchases.filter((p) => p.source === LEGACY_SOURCE).map((p) => p.id));

const storedSales: StoredLine[] = saleItems.filter((i) => legacySaleIds.has(i.sale_id)).map((i) => ({
  id: i.id, groupId: i.sale_id, sourceRow: i.source_row, rawName: i.raw_name, skyId: i.sky_id,
  stockFlag: i.legacy_stock_flag, secondFlag: i.legacy_shipped_flag,
}));
const storedPurchases: StoredLine[] = purchaseItems
  .filter((i) => legacyPurchaseIds.has(i.purchase_id)).map((i) => ({
    id: i.id, groupId: i.purchase_id, sourceRow: i.source_row, rawName: i.raw_name, skyId: i.sky_id,
    stockFlag: i.legacy_booked_flag, secondFlag: i.legacy_condition_flag,
  }));

const salePlan = planLegacySync(saleLines, storedSales);
const purchasePlan = planLegacySync(purchaseLines, storedPurchases);

function report(label: string, plan: SyncPlan, groupWord: string) {
  console.log(`── ${label} ──`);
  console.log(`  unverändert ............................ ${plan.unchanged}`);
  console.log(`  UPDATE ................................. ${plan.updates.length}`);
  console.log(`  INSERT in bestehende ${groupWord.padEnd(9)} ....... ${plan.insertsIntoExistingGroup.length}`);
  console.log(`  neue ${groupWord.padEnd(9)} ........................ ${plan.newGroups.size}` +
    ` mit ${[...plan.newGroups.values()].reduce((s, l) => s + l.length, 0)} Positionen`);
  console.log(`  Probleme ............................... ${plan.problems.length}`);
  if (plan.updates.length > 0) {
    const combos = new Map<string, number>();
    for (const u of plan.updates) {
      const key = `${u.changes.map((c) => `${c.field}:${c.from || "·"}`).join(",")} -> ` +
        `${u.changes.map((c) => `${c.field}:${c.to || "·"}`).join(",")}`;
      combos.set(key, (combos.get(key) ?? 0) + 1);
    }
    for (const [k, n] of [...combos].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`     ${String(n).padStart(4)} ×  ${k}`);
    }
  }
  for (const [header, lines] of [...plan.newGroups].sort((a, b) => a[0] - b[0])) {
    console.log(`     neue Gruppe ab Zeile ${header}: ${lines.length} Positionen` +
      ` (${lines.slice(0, 3).map((l) => l.rawName).join(", ")}${lines.length > 3 ? " …" : ""})`);
  }
  if (plan.problems.length > 0) {
    const byKind = new Map<string, number>();
    for (const p of plan.problems) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
    console.log(`     nach Art: ${[...byKind].map(([k, n]) => `${k} ${n}`).join(" · ")}`);
    for (const p of plan.problems.slice(0, 15)) console.log(`     ! ${p.kind}: ${p.detail}`);
    if (plan.problems.length > 15) console.log(`     … und ${plan.problems.length - 15} weitere`);
  }
  console.log("");
}

console.log(`Arbeitsmappe (Importer-Sicht): ${saleLines.length} Verkaufs- und ${purchaseLines.length} Einkaufspositionen`);
console.log(`Datenbank: ${storedSales.length} Legacy-sale_items in ${legacySaleIds.size} Verkäufen · ` +
  `${storedPurchases.length} Legacy-purchase_items in ${legacyPurchaseIds.size} Einkäufen`);
console.log(`Ausgeklammert: ${saleItems.length - storedSales.length} sale_items und ` +
  `${purchaseItems.length - storedPurchases.length} purchase_items sind nicht Legacy\n`);

report("VERKÄUFE", salePlan, "Verkäufe");
report("EINKÄUFE", purchasePlan, "Einkäufe");

/* --------------------------------------------------- Gruppen und Abdrücke */

const saleById = new Map(sales.map((s) => [s.id, s]));
const itemBySourceRow = new Map(saleItems.map((i) => [i.source_row, i]));
const groupByHeader = new Map(saleGroups.map((g) => [g.headerRow, g]));
const headerOfSale = new Map<number, number>();
for (const s of sales) {
  const m = /Kopfzeile (\d+)/.exec(String(s.note ?? ""));
  if (m) headerOfSale.set(s.id, Number(m[1]));
}

const facts: GroupFacts[] = [];
const brandNewHeaders: number[] = [];
for (const p of salePlans) {
  if (p.status === "standalone_correction") continue;
  const ids = new Set(p.items.map((i) => itemBySourceRow.get(i.sourceRow)?.sale_id)
    .filter((x): x is number => x !== undefined));
  if (ids.size !== 1) { if (ids.size === 0) brandNewHeaders.push(p.headerRow); continue; }
  const saleId = [...ids][0];
  const sale = saleById.get(saleId)!;
  const g = groupByHeader.get(p.headerRow);

  const headerDiffs: HeaderDiff[] = [];
  const knownHeader = headerOfSale.get(saleId);
  if (knownHeader !== undefined && knownHeader !== p.headerRow) {
    headerDiffs.push({ field: "headerRow", from: String(knownHeader), to: String(p.headerRow) });
  }
  const dateDiff = saleDateDiff(txt(sale.sold_at), txt(p.date));
  if (dateDiff !== null) headerDiffs.push(dateDiff);
  if (txt(sale.buyer_ref) !== txt(g?.buyer)) {
    headerDiffs.push({ field: "buyer", from: txt(sale.buyer_ref), to: txt(g?.buyer) });
  }
  if (Number(sale.items_subtotal) !== Number(g?.money?.U ?? 0)) {
    headerDiffs.push({ field: "moneyU", from: String(sale.items_subtotal), to: String(g?.money?.U) });
  }

  const storedRows = saleItems.filter((i) => i.sale_id === saleId);
  const itemsChanged = p.items.some((it) => {
    const stored = itemBySourceRow.get(it.sourceRow);
    if (stored === undefined) return true;
    return txt(stored.raw_name) !== txt(it.rawName)
      || txt(stored.legacy_stock_flag) !== txt(it.stockFlag)
      || txt(stored.legacy_shipped_flag) !== txt(it.shippedFlag)
      || txt(stored.sky_id) !== txt(it.skyId);
  }) || storedRows.length !== p.items.length;

  facts.push({
    saleId, headerRow: p.headerRow,
    fingerprintMatches: sale.import_fingerprint === p.fingerprint,
    headerDiffs, itemsChanged,
    allVerifiableCompared: knownHeader !== undefined && g !== undefined,
  });
}
const groupPlan = planGroups(facts);

/*
 * Dasselbe Prinzip für die Einkäufe: gestempelt wird nur, was durch das
 * erklärt ist, was dieser Lauf tatsächlich schreibt.
 */
const rowToPurchase = new Map(purchaseItems.map((i) => [i.source_row, i.purchase_id]));
const explainedPurchases = new Set<number>([
  ...purchasePlan.updates.map((u) => u.groupId),
  ...purchasePlan.insertsIntoExistingGroup.map((i) => i.groupId as number),
]);
const purchaseRestamp: number[] = [];
const purchaseUnexplained: { purchaseId: number; headerRow: number; reason: string }[] = [];
const purchaseVerdicts = new Map<number, PurchaseVerdict>();
const purchaseById = new Map(purchases.map((r) => [r.id, r]));
const purchaseHeaderOf = (note: unknown) => {
  const m = /Kopfzeile (\d+)/.exec(String(note ?? ""));
  return m ? Number(m[1]) : null;
};
for (const p of purchaseBatch.plans) {
  if (p.status !== "eligible") continue;
  const ids = new Set((p.preview.migrated as unknown as MigratedItem[])
    .map((i) => rowToPurchase.get(i.sourceRow)).filter((x): x is number => x !== undefined));
  if (ids.size !== 1) continue;                        // wirklich neue Gruppe
  const purchaseId = [...ids][0];
  const row = purchaseById.get(purchaseId);

  /*
   * DER BEWEIS FÜR `date_already_applied`, HIER GERECHNET, NICHT GERATEN.
   *
   * Derselbe Abdruck, dieselben Zeilen — nur mit dem Datum, das die Gruppe
   * beim Import hatte: keines. Stimmt er dann mit dem gespeicherten überein,
   * beschreibt der gespeicherte beweisbar den früheren Zustand DIESER
   * Gruppe. Gerechnet wird über `preview.all`, weil der Abdruck das tut.
   */
  const dateless = await purchaseFingerprint(
    { headerRow: p.headerRow, date: null, totalCost: p.totalCost } as never,
    p.preview.all as never);

  const verdict = classifyPurchaseGroup({
    purchaseId,
    headerRow: p.headerRow as number,
    fingerprintMatches: txt(row?.import_fingerprint) === p.fingerprint,
    matchesDatelessFingerprint: txt(row?.import_fingerprint) === dateless,
    workbookDate: txt(p.date),
    storedDate: txt((row as unknown as { purchased_at?: string })?.purchased_at),
    itemsChanged: explainedPurchases.has(purchaseId),
    headerRowMatches: purchaseHeaderOf((row as unknown as { note?: string })?.note) === p.headerRow,
    totalCostMatches: Number((row as unknown as { total_cost?: number })?.total_cost ?? 0)
      === Number(p.totalCost ?? 0),
    legacySource: txt(row?.source) === LEGACY_SOURCE,
    hasMovement: purchaseItems.some((i) => i.purchase_id === purchaseId
      && (i as unknown as { movement_id: number | null }).movement_id !== null),
  });
  purchaseVerdicts.set(purchaseId, verdict);
  if (verdict.kind === "unexplained") {
    purchaseUnexplained.push({ purchaseId, headerRow: p.headerRow, reason: verdict.reason });
  } else if (mayRestampPurchase(verdict)) {
    purchaseRestamp.push(purchaseId);
  }
}

console.log("── GRUPPEN UND FINGERABDRÜCKE ──");
console.log(`  bestehende Verkaufsgruppen ............ ${facts.length}`);
console.log(`  wirklich neue Verkaufsgruppen ......... ${brandNewHeaders.length}` +
  (brandNewHeaders.length ? ` (Kopfzeilen ${brandNewHeaders.join(", ")})` : ""));
const byVerdict = new Map<string, number[]>();
for (const [saleId, v] of groupPlan.verdicts) {
  const list = byVerdict.get(v.kind) ?? []; list.push(saleId); byVerdict.set(v.kind, list);
}
for (const kind of ["in_sync", "item", "sold_at", "item_and_sold_at", "unpersisted", "unexplained"]) {
  const list = byVerdict.get(kind) ?? [];
  const show = kind === "in_sync" || list.length === 0 ? "" :
    `   → ${list.slice(0, 8).map((i) => `#${i}`).join(" ")}${list.length > 8 ? " …" : ""}`;
  console.log(`  ${kind.padEnd(18)} ${String(list.length).padStart(4)}${show}`);
}
console.log(`  Verkaufsabdrücke zu stempeln .......... ${groupPlan.restamp.length}`);
console.log(`  sold_at zu schreiben (0089) ........... ${groupPlan.soldAtWrites.length}` +
  (groupPlan.soldAtWrites.length ? `: ${groupPlan.soldAtWrites.map((w) => `#${w.saleId}→${w.soldAt}`).join(" ")}` : ""));
for (const kind of ["item", "date_already_applied"]) {
  const list = [...purchaseVerdicts].filter(([, v]) => v.kind === kind).map(([id]) => id);
  if (list.length > 0) {
    console.log(`  Einkauf ${kind.padEnd(20)} ${String(list.length).padStart(4)}` +
      `   → ${list.slice(0, 12).map((i) => `#${i}`).join(" ")}${list.length > 12 ? " …" : ""}`);
  }
}
console.log(`  Einkaufsabdrücke zu stempeln .......... ${purchaseRestamp.length}` +
  (purchaseRestamp.length ? `   → ${purchaseRestamp.slice(0, 12).map((i) => `#${i}`).join(" ")}${purchaseRestamp.length > 12 ? " …" : ""}` : ""));
if (groupPlan.unexplained.length > 0) {
  console.log(`  UNERKLÄRTE VERKÄUFE — kein Stempel:`);
  for (const u of groupPlan.unexplained) console.log(`     ! sale #${u.saleId} (Kopf ${u.headerRow}): ${u.reason}`);
}
if (purchaseUnexplained.length > 0) {
  console.log(`  UNERKLÄRTE EINKÄUFE — kein Stempel:`);
  for (const u of purchaseUnexplained)
    console.log(`     ! purchase #${u.purchaseId} (Kopf ${u.headerRow}): ${u.reason}`);
}
console.log("");

const clean = planIsClean(salePlan) && planIsClean(purchasePlan)
  && groupPlan.unexplained.length === 0 && purchaseUnexplained.length === 0;
const empty = planIsEmpty(salePlan) && planIsEmpty(purchasePlan)
  && groupPlan.restamp.length === 0 && groupPlan.soldAtWrites.length === 0
  && purchaseRestamp.length === 0;

console.log("── Ergebnis ──");
console.log(`  Plan ist konfliktfrei .................. ${clean ? "ja" : "NEIN"}`);
console.log(`  nichts mehr zu tun .................... ${empty ? "ja" : "nein"}\n`);

/* ==========================================================================
 * APPLY
 * ======================================================================== */

if (!APPLY) {
  console.log("  Es wurde nichts geschrieben.");
  if (!clean) process.exitCode = 1;
} else {
  if (!clean) { console.error("ABBRUCH: der Plan ist nicht konfliktfrei."); process.exit(1); }
  const fail = (where: string, message: string): never => {
    console.error(`\nABBRUCH in ${where}: ${message}`); process.exit(1);
  };

  /*
   * OPTIMISTISCHE PRÜFUNG VOR DEM ERSTEN SCHREIBVORGANG. Zwischen Lesung und
   * Schreiben kann sich etwas bewegt haben; weicht eine Zeile ab, passiert
   * gar nichts statt die Hälfte.
   */
  const freshSale = new Map((await page<SaleItemRow>("sale_items")).map((i) => [i.id, i]));
  const freshPurchase = new Map((await page<PurchaseItemRow>("purchase_items")).map((i) => [i.id, i]));
  const SALE_COLUMN: Record<string, keyof SaleItemRow> = {
    raw_name: "raw_name", sky_id: "sky_id",
    stock_flag: "legacy_stock_flag", second_flag: "legacy_shipped_flag" };
  const PURCHASE_COLUMN: Record<string, keyof PurchaseItemRow> = {
    raw_name: "raw_name", sky_id: "sky_id",
    stock_flag: "legacy_booked_flag", second_flag: "legacy_condition_flag" };
  const stale: string[] = [];
  for (const u of salePlan.updates) {
    const cur = freshSale.get(u.id);
    if (!cur) { stale.push(`sale_item ${u.id} verschwunden`); continue; }
    for (const c of u.changes) {
      const col = SALE_COLUMN[c.field];
      if (col && txt(cur[col]) !== c.from) {
        stale.push(`sale_item ${u.id}: ${c.field} ist "${txt(cur[col])}", geplant "${c.from}"`);
      }
    }
  }
  for (const u of purchasePlan.updates) {
    const cur = freshPurchase.get(u.id);
    if (!cur) { stale.push(`purchase_item ${u.id} verschwunden`); continue; }
    for (const c of u.changes) {
      const col = PURCHASE_COLUMN[c.field];
      if (col && txt(cur[col]) !== c.from) {
        stale.push(`purchase_item ${u.id}: ${c.field} ist "${txt(cur[col])}", geplant "${c.from}"`);
      }
    }
  }
  if (stale.length > 0) {
    console.error(`ABBRUCH: ${stale.length} Zeile(n) haben sich seit der Planung geändert. Nichts geschrieben.`);
    for (const s of stale.slice(0, 20)) console.error(`  ! ${s}`);
    process.exit(1);
  }
  console.log(`── Optimistische Prüfung: ${salePlan.updates.length + purchasePlan.updates.length} Zeilen unverändert ✓\n`);

  let a = 0;
  for (const u of salePlan.updates) {
    const { error } = await client.rpc("system_sync_legacy_sale_item", {
      p_item_id: u.id, p_raw_name: u.line.rawName,
      p_sky_id: u.line.skyId ?? freshSale.get(u.id)?.sky_id ?? null,
      p_stock_flag: u.line.stockFlag || null, p_shipped_flag: u.line.secondFlag || null });
    if (error) fail("A", `sale_item ${u.id}: ${error.message}`);
    a += 1;
  }
  console.log(`  A  ${a} Sale-Item-Updates`);

  let b = 0;
  for (const u of purchasePlan.updates) {
    const { error } = await client.rpc("system_sync_legacy_purchase_item", {
      p_item_id: u.id, p_raw_name: u.line.rawName,
      p_sky_id: u.line.skyId ?? freshPurchase.get(u.id)?.sky_id ?? null,
      p_condition_flag: u.line.secondFlag || null, p_booked_flag: u.line.stockFlag || null });
    if (error) fail("B", `purchase_item ${u.id}: ${error.message}`);
    b += 1;
  }
  console.log(`  B  ${b} Purchase-Item-Updates`);

  let c = 0;
  for (const i of purchasePlan.insertsIntoExistingGroup) {
    const { error } = await client.rpc("system_add_legacy_purchase_item", {
      p_purchase_id: i.groupId, p_position: i.line.position, p_source_row: i.line.sourceRow,
      p_raw_name: i.line.rawName, p_sky_id: i.line.skyId,
      p_condition_flag: i.line.secondFlag || null, p_booked_flag: i.line.stockFlag || null });
    if (error) fail("C", `Zeile ${i.line.sourceRow} → purchase ${i.groupId}: ${error.message}`);
    c += 1;
  }
  console.log(`  C  ${c} Purchase-Item-Inserts`);

  let d = 0;
  for (const w of groupPlan.soldAtWrites) {
    const { error } = await client.rpc("system_sync_legacy_sale_group", {
      p_sale_id: w.saleId, p_sold_at: w.soldAt });
    if (error) fail("D", `sale ${w.saleId}: ${error.message}`);
    d += 1;
  }
  console.log(`  D  ${d} sold_at geschrieben`);

  /* E — Abdrücke NEU rechnen, aus der jetzt aktualisierten Datenbank. */
  const salesAfter = await page<SaleRow>("sales");
  const purchasesAfter = await page<PurchaseRow>("purchases");
  const plansAfter: SalePlan[] = await planSales(saleGroups as never, { ...saleDeps,
    imported: new Set(salesAfter.map((s) => s.import_fingerprint).filter((f): f is string => f !== null)) });
  const batchAfter = await planBatch(purchaseGroups as never, { ...purchaseDeps,
    imported: new Set(purchasesAfter.map((p) => p.import_fingerprint).filter((f): f is string => f !== null)) } as never);
  console.log(`  E  Pläne neu berechnet (${plansAfter.length} Verkäufe, ${batchAfter.plans.length} Einkäufe)`);

  const rowToSale = new Map((await page<SaleItemRow>("sale_items")).map((i) => [i.source_row, i.sale_id]));
  const allowedSales = new Set(groupPlan.restamp);
  let f = 0;
  for (const p of plansAfter) {
    if (p.status !== "eligible") continue;
    const ids = new Set(p.items.map((i) => rowToSale.get(i.sourceRow)).filter((x) => x !== undefined));
    if (ids.size !== 1) continue;
    const saleId = [...ids][0] as number;
    if (!allowedSales.has(saleId)) fail("F", `sale ${saleId} ist eligible, aber nicht erklärt`);
    const { error } = await client.rpc("system_set_legacy_sale_fingerprint", {
      p_sale_id: saleId, p_fingerprint: p.fingerprint });
    if (error) fail("F", `Abdruck sale ${saleId}: ${error.message}`);
    f += 1;
  }
  console.log(`  F  ${f} Verkaufsabdrücke gestempelt`);

  const rowToPurchaseAfter = new Map((await page<PurchaseItemRow>("purchase_items"))
    .map((i) => [i.source_row, i.purchase_id]));
  const allowedPurchases = new Set(purchaseRestamp);
  let f2 = 0;
  for (const p of batchAfter.plans) {
    if (p.status !== "eligible") continue;
    const ids = new Set((p.preview.migrated as unknown as MigratedItem[])
      .map((i) => rowToPurchaseAfter.get(i.sourceRow)).filter((x) => x !== undefined));
    if (ids.size !== 1) continue;
    const purchaseId = [...ids][0] as number;
    if (!allowedPurchases.has(purchaseId)) fail("F2", `purchase ${purchaseId} ist eligible, aber nicht erklärt`);
    const { error } = await client.rpc("system_set_legacy_purchase_fingerprint", {
      p_purchase_id: purchaseId, p_fingerprint: p.fingerprint });
    if (error) fail("F2", `Abdruck purchase ${purchaseId}: ${error.message}`);
    f2 += 1;
  }
  console.log(`  F2 ${f2} Einkaufsabdrücke gestempelt`);

  /* G — das Tor vor dem Neuimport. */
  const salesFinal = await page<SaleRow>("sales");
  const plansFinal: SalePlan[] = await planSales(saleGroups as never, { ...saleDeps,
    imported: new Set(salesFinal.map((s) => s.import_fingerprint).filter((x): x is string => x !== null)) });
  let existingEligible = 0, newEligible = 0, alreadyExisting = 0, corrections = 0;
  for (const p of plansFinal) {
    if (p.status === "standalone_correction") { corrections += 1; continue; }
    const ids = new Set(p.items.map((i) => rowToSale.get(i.sourceRow)).filter((x) => x !== undefined));
    const isExisting = ids.size === 1;
    if (p.status === "eligible") { if (isExisting) existingEligible += 1; else newEligible += 1; }
    else if (isExisting) alreadyExisting += 1;
  }
  console.log(`\n── G · Tor vor dem Neuimport ──`);
  console.log(`  bestehende already_imported ..... ${alreadyExisting}`);
  console.log(`  bestehende noch eligible ........ ${existingEligible}`);
  console.log(`  neue Gruppen eligible ........... ${newEligible}`);
  console.log(`  standalone_correction ........... ${corrections}`);
  const open = importGateOpen({ existingStillEligible: existingEligible,
    newGroupsEligible: newEligible, expectedNewGroups: salePlan.newGroups.size });
  console.log(`  TOR ${open ? "OFFEN" : "GESCHLOSSEN"}`);
  if (!open) {
    console.error("\nSTOP: die neuen Gruppen dürfen NICHT importiert werden.");
    process.exitCode = 1;
  } else {
    console.log(`\n  Schritt H (${salePlan.newGroups.size} neue Verkaufsgruppen) läuft über den`);
    console.log(`  bestehenden Sales-Importer und braucht eine Operator-Anmeldung.`);
  }
}
