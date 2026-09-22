/**
 * Historical Verkauf import (ADR-0089).
 *
 *   npm run orderbook:sales-import:staging               Vorschau
 *   npm run orderbook:sales-import:staging -- --apply --confirm-staging
 *   npm run orderbook:sales-import:prod                  Vorschau
 *   npm run orderbook:sales-import:prod -- --apply
 *
 * ZWEI UMGEBUNGEN, KEINE VORAUSWAHL. Das Werkzeug lief lange nur gegen
 * Staging und rief `requireStaging()` unbedingt auf. Für den Cutover muss es
 * auch Production bedienen — aber Production wird gewählt, nie geerbt:
 * `--env production --confirm-production`, beides wörtlich, sonst passiert
 * nichts. Welche Umgebung wirklich am anderen Ende hängt, entscheidet danach
 * derselbe Identitätsvergleich wie bisher (`requireStaging` /
 * `requireProduction`) — das Flag sagt nur, was gemeint war.
 *
 * Same discipline as the Einkauf importer: selective workbook read, a real
 * Seller Operator session, preview by default, and an apply that re-reads the
 * file rather than trusting what a preview printed.
 *
 * It writes no inventory movement, and could not: the database refuses one on
 * any sale item whose sale came from the workbook.
 */
import { openAsBlob } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { chooseEnvironment, requireProduction, requireStaging } from "./lib/staging-guard.mts";
import { readWorkbookParts } from "../src/lib/import/xlsx-reader.ts";
import { parseSharedStrings, parseSheet } from "../src/lib/import/sheet-rows.ts";
import { STOCK_SHEETS, groupRows, indexCatalog, parseOrderSheet, type CatalogEntry } from "../src/lib/orderbook/order-2026.ts";
import { groupSales, parseSalesSheet } from "../src/lib/orderbook/sales-2026.ts";
import { buildSelfUsage, buildTightNameIndex, planSales, tighten,
         type SalePlan, type SalesPlanDeps } from "../src/lib/orderbook/sales-import.ts";

const WORKBOOK = process.env.SKYISLES_WORKBOOK ?? `${process.env.HOME}/Documents/eCommerce/skylanders.xlsx`;
const ORDER_SHEET = "Order 2026";
const flag = (name: string) => process.argv.includes(`--${name}`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) { console.error(`Missing ${name}.`); process.exit(1); }
  return value;
}

async function operatorClient(): Promise<SupabaseClient> {
  const client = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email: requireEnv("SKYISLES_OPERATOR_EMAIL"), password: requireEnv("SKYISLES_OPERATOR_PASSWORD") });
  if (error) { console.error(`Operator sign-in failed: ${error.message}`); process.exit(1); }
  return client;
}

/**
 * The Buy-In factor the WORKBOOK used, not the one the shop uses today.
 *
 * `Markt G` (Q) is a group's market value and `Buy In` (R) what it cost, and
 * across all 265 groups that carry both the ratio is one constant to within
 * 1.1e-16 — the owner applied a single factor to the whole book. Today's
 * `orderbook_global_factor()` is a different number (0.376347 against
 * 0.343293) and belongs to new sales; stamping it on 2026 history would
 * restate what those sales cost.
 */
export function workbookBuyInFactor(groups: readonly { money: Record<string, number> }[]): number {
  const q = groups.reduce((sum, g) => sum + (g.money.Q ?? 0), 0);
  const r = groups.reduce((sum, g) => sum + (g.money.R ?? 0), 0);
  return q === 0 ? 0 : r / q;
}

async function readAndPlan(client: SupabaseClient): Promise<{
  plans: SalePlan[]; bytes: number; factor: number; importedAdjustments: Set<string>;
}> {
  const blob = await openAsBlob(WORKBOOK);
  const parts = await readWorkbookParts(blob, [ORDER_SHEET, ...STOCK_SHEETS, "DI A"]);
  const shared = parseSharedStrings(parts.sharedStrings);

  const stock = new Map<string, string>();
  for (const sheet of [...STOCK_SHEETS, "DI A"]) {
    const xml = parts.sheets.get(sheet);
    if (!xml) continue;
    for (const r of parseSheet(sheet, xml, shared)) stock.set(`${sheet}|${r.sourceRow}`, r.name);
  }
  const stockName = (sheet: string, row: number) => stock.get(`${sheet}|${row}`) ?? null;

  const [catalog, mappings, fingerprints, factor, adjustments] = await Promise.all([
    client.rpc("seller_import_catalog"),
    client.rpc("seller_orderbook_mappings"),
    client.rpc("seller_sale_fingerprints"),
    client.rpc("orderbook_global_factor"),
    // 0061. A historical identity may have become an adjustment rather than a
    // sale, and the importer has to know that before offering to write it.
    client.rpc("seller_historical_adjustments"),
  ]);
  for (const [label, r] of [["catalog", catalog], ["mappings", mappings],
                            ["fingerprints", fingerprints], ["factor", factor],
                            ["adjustments", adjustments]] as const) {
    if (r.error) throw new Error(`${label}: ${r.error.message}`);
  }
  const importedAdjustments = new Set<string>(
    (adjustments.data as { import_fingerprint: string | null }[])
      .map((r) => r.import_fingerprint).filter((f): f is string => f !== null));

  const entries: CatalogEntry[] = (catalog.data as { sky_id: string; name: string; series_code: string }[])
    .map((r) => ({ skyId: r.sky_id, name: r.name, series: r.series_code }));
  const saved = new Map<string, string | null>(
    (mappings.data as { normalised_name: string; sky_id: string | null }[])
      .map((m) => [m.normalised_name, m.sky_id]));
  const imported = new Set<string>(
    (fingerprints.data as { import_fingerprint: string }[]).map((r) => r.import_fingerprint));

  const rows = parseSalesSheet(parts.sheets.get(ORDER_SHEET)!, shared);
  // The purchase side of the same sheet is evidence too — one workbook, one
  // person's shorthand.
  const purchaseRows = groupRows(parseOrderSheet(parts.sheets.get(ORDER_SHEET)!, shared))
    .flatMap((g) => g.items);
  const disneyNames = new Set<string>();
  for (const [key, name] of stock) if (key.startsWith("DI A|")) disneyNames.add(tighten(name));

  const deps: SalesPlanDeps = {
    stockName, bySheetName: indexCatalog(entries), savedMappings: saved,
    selfUsage: buildSelfUsage(rows, stockName, purchaseRows),
    byTightName: buildTightNameIndex(entries),
    disneyNames,
    imported, factor: Number(factor.data),
  };
  const groups = groupSales(rows);
  return {
    plans: await planSales(groups, deps),
    bytes: parts.bytesRead,
    factor: workbookBuyInFactor(groups),
    importedAdjustments,
  };
}

function report(plans: SalePlan[], bytes: number, importedAdjustments: Set<string>): void {
  const real = plans.filter((p) => p.status !== "standalone_correction");
  const corrections = plans.filter((p) => p.status === "standalone_correction");
  const eligible = plans.filter((p) => p.status === "eligible");
  const already = plans.filter((p) => p.status === "already_imported");
  const blocked = plans.filter((p) => p.status === "blocked");

  const items = real.flatMap((p) => p.items);
  const by = (f: (i: (typeof items)[number]) => boolean) => items.filter(f).length;
  const sum = (f: (p: SalePlan) => number) => plans.reduce((s, p) => s + f(p), 0);
  const feeSum = (kind: string, settled: string) =>
    plans.reduce((s, p) => s + p.fees.filter((x) => x.kind === kind && x.settled_by === settled)
      .reduce((t, x) => t + x.amount, 0), 0);

  const eur = (n: number) => n.toFixed(2).padStart(10);
  console.log(`\nread ${(bytes / 1048576).toFixed(2)} MB of the workbook\n`);
  console.log("=== GRUPPEN ===");
  console.log(`  source groups            ${plans.length}`);
  console.log(`  real sales               ${real.length}`);
  console.log(`  standalone corrections   ${corrections.length}`);
  console.log(`  eligible                 ${eligible.length}`);
  console.log(`  already imported         ${already.length}`);
  console.log(`  blocked                  ${blocked.length}`);

  console.log("\n=== POSITIONEN ===");
  console.log(`  source item rows         ${plans.reduce((s, p) => s + p.sourceRows, 0)}`);
  console.log(`  in real sales            ${items.length}`);
  console.log(`  in corrections           ${corrections.reduce((s, p) => s + p.sourceRows, 0)}`);
  console.log(`    source-row override    ${by((i) => i.evidence === "override" && i.skyId !== null)}`);
  console.log(`    formula resolved       ${by((i) => i.evidence === "formula" && i.skyId !== null)}`);
  console.log(`    workbook self-resolved ${by((i) => i.evidence === "self" && i.skyId !== null)}`);
  console.log(`    owner mapping          ${by((i) => i.evidence === "owner" && i.skyId !== null)}`);
  console.log(`    saved mapping          ${by((i) => i.evidence === "mapping" && i.skyId !== null)}`);
  // Steps 9/10: the catalog carries exactly this name, or the name plus a
  // series marker. Listed so the breakdown adds up to the figure total.
  console.log(`    canonical name         ${by((i) => i.evidence === "name" && i.skyId !== null)}`);
  console.log(`    ---------------------- ${by((i) => i.skyId !== null)} figures`);
  console.log(`    intentional non-figure ${by((i) => i.skyId === null && i.classification === "uncategorized")}`);
  console.log(`      of which Battlecast  ${by((i) => i.evidence === "battlecast")}`);
  console.log(`    unresolved             ${by((i) => i.classification === "unmatched")}`);
  console.log(`    ambiguous              ${by((i) => i.classification === "ambiguous")}`);
  console.log(`    invalid                ${by((i) => i.classification === "invalid")}`);

  console.log("\n=== DATEN ===");
  console.log(`  with a date              ${real.filter((p) => p.date).length}`);
  console.log(`  NULL (malformed/missing) ${real.filter((p) => !p.date).length}`);
  for (const p of real.filter((x) => !x.date))
    console.log(`     Kopfzeile ${p.headerRow}  rohes Datum ${JSON.stringify(p.rawDate)}`);

  console.log("\n=== BETRÄGE ===");
  console.log(`  Summe                 ${eur(sum((p) => p.subtotal))}`);
  console.log(`  Versand               ${eur(sum((p) => p.shipping))}`);
  console.log(`  Rabatt                ${eur(sum((p) => p.discount))}`);
  console.log(`  Refunds               ${eur(sum((p) => p.refunds.reduce((s, r) => s + r.amount, 0)))}`);
  console.log(`  Transaktionsgebühr    ${eur(feeSum("payment", "channel"))}`);
  console.log(`  Marktplatzgebühr      ${eur(feeSum("marketplace", "channel"))}`);
  console.log(`  Label über Kanal      ${eur(feeSum("shipping_label", "channel"))}`);
  console.log(`  Label extern          ${eur(feeSum("shipping_label", "external"))}`);
  console.log(`  Abrechnungskorrekturen${eur(sum((p) => p.adjustments.reduce((s, a) => s + a.amount, 0)))}`);
  console.log(`  erwartete Auszahlung  ${eur(sum((p) => p.expectedPayout))}`);
  console.log(`  Excel Auszahlung      ${eur(sum((p) => p.workbookPayout))}`);

  let exact = 0, near = 0, off = 0, maxd = 0, totald = 0;
  const bad: SalePlan[] = [];
  for (const p of plans) {
    const d = p.expectedPayout - p.workbookPayout;
    totald += d; maxd = Math.max(maxd, Math.abs(d));
    if (Math.abs(d) < 1e-9) exact += 1;
    else if (Math.abs(d) < 0.005) near += 1;
    else { off += 1; bad.push(p); }
  }
  console.log("\n=== AUSZAHLUNGS-REPRODUKTION ===");
  console.log(`  exact        ${exact}`);
  console.log(`  rounding     ${near}`);
  console.log(`  mismatches   ${off}`);
  console.log(`  max |Δ|      ${maxd.toFixed(10)}`);
  console.log(`  total Δ      ${totald.toFixed(10)}`);
  for (const p of bad.slice(0, 5))
    console.log(`    Kopfzeile ${p.headerRow}: erwartet ${p.expectedPayout.toFixed(2)} vs Excel ${p.workbookPayout.toFixed(2)}`);

  const returned = items.filter((i) => i.stockFlag.toLowerCase() === "r" || i.shippedFlag.toLowerCase() === "r");
  const returnSales = new Set(real.filter((p) => p.items.some(
    (i) => i.stockFlag.toLowerCase() === "r" || i.shippedFlag.toLowerCase() === "r")).map((p) => p.headerRow));
  const refundSales = real.filter((p) => p.refunds.length > 0);
  console.log("\n=== RETOUREN ===");
  console.log(`  returned item rows       ${returned.length}`);
  console.log(`  sales containing one     ${returnSales.size}`);
  console.log(`  sales with a refund      ${refundSales.length}`);
  console.log(`  refund AND return        ${refundSales.filter((p) => returnSales.has(p.headerRow)).length}`);
  console.log(`  refund WITHOUT return    ${refundSales.filter((p) => !returnSales.has(p.headerRow)).length}`);

  const prints = plans.map((p) => p.fingerprint);
  /*
   * One identity universe, two destinations.
   *
   * All 297 source groups are fingerprinted the same way; 296 of them became
   * sales and one became a standalone settlement adjustment (0061). Counting
   * only the sales would make the book look one short forever.
   */
  const correctionDone = corrections.filter((c) => importedAdjustments.has(c.fingerprint));
  console.log("\n=== FINGERABDRÜCKE ===");
  console.log(`  distinct                 ${new Set(prints).size} of ${prints.length}`);
  console.log(`  als Verkauf importiert   ${already.length}`);
  console.log(`  als Korrektur importiert ${correctionDone.length}`);
  console.log(`  historische Identitäten  ${already.length + correctionDone.length} von ${prints.length}`);
  console.log(`  offen                    ${prints.length - already.length - correctionDone.length}`);

  const open = new Map<string, number>();
  for (const i of items) if (i.classification === "unmatched")
    open.set(i.rawName, (open.get(i.rawName) ?? 0) + 1);
  if (open.size) {
    /*
     * Named row by row, not just counted.
     *
     * These are the only positions the import cannot decide, and the owner is
     * the one who has to decide them — so the preview prints where each one
     * lives in the workbook and what the row itself says, rather than a tally
     * he would then have to go and look up. No candidate is suggested here:
     * proposing one would be the guess this importer refuses to make.
     */
    console.log("\n=== OFFENE IDENTITÄTEN ===");
    for (const [name, n] of [...open].sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(n).padStart(3)}x ${JSON.stringify(name)}`);
    console.log("  ---");
    for (const plan of plans)
      for (const i of plan.items)
        if (i.classification === "unmatched")
          console.log(`  Zeile ${String(i.sourceRow).padStart(4)}` +
            ` · Kopfzeile ${String(plan.headerRow).padStart(4)}` +
            ` · ${plan.date ?? "ohne Datum"}` +
            ` · ${plan.buyer || "kein Käufer"}` +
            ` · ${JSON.stringify(i.rawName)}` +
            ` · ${i.note}`);
  }

  /*
   * The row-specific owner decisions, each naming the row it resolved.
   *
   * These outrank every automatic rule, so the preview has to show exactly
   * which rows they touched — an override that silently hit the wrong row
   * would otherwise look like a correct resolution.
   */
  const overridden = items.filter((i) => i.evidence === "override");
  if (overridden.length) {
    console.log("\n=== ZEILENENTSCHEIDUNGEN DES INHABERS ===");
    for (const plan of plans)
      for (const i of plan.items)
        if (i.evidence === "override")
          console.log(`  Zeile ${String(i.sourceRow).padStart(4)}` +
            ` · Kopfzeile ${String(plan.headerRow).padStart(4)}` +
            ` · ${plan.date ?? "ohne Datum"}` +
            ` · ${plan.buyer || "kein Käufer"}` +
            ` · ${JSON.stringify(i.rawName).padEnd(12)} → ${i.skyId ?? "kein Katalogartikel"}`);
  }

  /*
   * Every global owner decision, with the rows it actually carried.
   *
   * These are the only identities in the whole import that no evidence in the
   * workbook decides — the owner decided them — so the preview names each one
   * and shows what it moved, rather than folding them into a single count.
   */
  const owner = items.filter((i) => i.evidence === "owner");
  if (owner.length) {
    console.log("\n=== EIGENTÜMER-ENTSCHEIDUNGEN ===");
    const byKey = new Map<string, number>();
    for (const i of owner) {
      const key = `${i.rawName} → ${i.skyId ?? "kein Katalogartikel"}`;
      byKey.set(key, (byKey.get(key) ?? 0) + 1);
    }
    for (const [key, n] of [...byKey].sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(n).padStart(3)}x ${key}`);
  }
}

/**
 * The conditions under which history may be written at all.
 *
 * Read from the plan that is about to be applied, not from a remembered
 * report: a preview printed ten minutes ago is not evidence about this
 * workbook. Any failure refuses the whole run rather than importing the part
 * that happens to be clean — a half-imported book is worse than none.
 */
function applyInvariants(plans: SalePlan[]): string[] {
  const real = plans.filter((p) => p.status !== "standalone_correction");
  const corrections = plans.filter((p) => p.status === "standalone_correction");
  const items = plans.flatMap((p) => p.items);
  const payout = plans.filter((p) => Math.abs(p.expectedPayout - p.workbookPayout) >= 0.005);
  const fingerprints = new Set(plans.map((p) => p.fingerprint));
  const failures: string[] = [];

  const expect = (what: string, actual: number, wanted: number) => {
    if (actual !== wanted) failures.push(`${what}: ${actual}, erwartet ${wanted}`);
  };
  /*
   * The two dataset counts are a measured snapshot, not a rule the workbook
   * may rewrite. They read 293/292 for the book as it stood at the first
   * import. The owner has since added four sales — header rows 1553, 1561,
   * 1567 and 1577, 27 positions, 2026-09-19 to 2026-09-21 — and nothing else
   * moved: the 292 older sales are all still `already_imported` and the one
   * standalone correction is still matched by its fingerprint, so every
   * header value and every position row behind those 293 groups is
   * unchanged. Raising these two numbers by four is the whole of that.
   *
   * The next sale the owner writes will fail this gate again. That is what
   * it is for: a dataset count that follows the file explains nothing.
   */
  expect("Quellgruppen", plans.length, 297);
  expect("echte Verkäufe", real.length, 296);
  expect("eigenständige Korrekturen", corrections.length, 1);
  expect("unaufgelöste Positionen", items.filter((i) => i.classification === "unmatched").length, 0);
  expect("mehrdeutige Positionen", items.filter((i) => i.classification === "ambiguous").length, 0);
  expect("ungültige Positionen", items.filter((i) => i.classification === "invalid").length, 0);
  expect("Auszahlungsabweichungen", payout.length, 0);
  expect("Fingerabdruck-Kollisionen", plans.length - fingerprints.size, 0);
  expect("blockierte Gruppen", plans.filter((p) => p.status === "blocked").length, 0);
  return failures;
}

/**
 * Writes one historical sale, as one transaction.
 *
 * `seller_import_sale_group` is a single `security definer` function, so the
 * sale, its items, its fees, its refunds and its adjustments all commit or
 * none of them do — there is no path that leaves half a sale behind. It
 * creates no inventory movement and cannot: the items it writes carry no
 * `movement_id`, and a trigger refuses one on a historical row.
 */
async function importGroup(
  client: SupabaseClient, plan: SalePlan, factor: number,
): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  const { data, error } = await client.rpc("seller_import_sale_group", {
    p_channel: "ebay",
    p_sold_at: plan.date,
    p_country: plan.country || null,
    p_buyer_ref: plan.buyer || null,
    p_external_ref: null,
    p_fingerprint: plan.fingerprint,
    p_note: plan.note || null,
    p_subtotal: plan.subtotal,
    p_shipping: plan.shipping,
    p_discount: plan.discount,
    // The workbook's own factor, never `orderbook_global_factor()`.
    p_factor: Number(factor.toFixed(6)),
    p_items: plan.items.map((i) => ({
      position: i.position,
      sky_id: i.skyId,
      raw_name: i.rawName,
      condition: "loose",
      legacy_stock_flag: i.stockFlag || null,
      legacy_shipped_flag: i.shippedFlag || null,
      source_row: i.sourceRow,
    })),
    p_fees: plan.fees,
    p_refunds: plan.refunds,
    p_adjustments: plan.adjustments,
  });
  if (error) return { ok: false, message: `${error.code ?? ""} ${error.message}`.trim() };
  if (typeof data !== "number") return { ok: false, message: "keine Verkaufs-ID zurückgegeben" };
  return { ok: true, id: data };
}

async function apply(client: SupabaseClient, plans: SalePlan[], factor: number): Promise<void> {
  const failures = applyInvariants(plans);
  if (failures.length > 0) {
    console.error("\n  APPLY ABGEBROCHEN — die Vorschau erfüllt die Bedingungen nicht:");
    for (const f of failures) console.error(`    · ${f}`);
    console.error("\n  Nichts wurde geschrieben.\n");
    process.exit(1);
  }

  const eligible = plans.filter((p) => p.status === "eligible");
  const already = plans.filter((p) => p.status === "already_imported");
  console.log(`\n=== APPLY ===`);
  console.log(`  Buy-In-Faktor (Arbeitsmappe) ${factor.toFixed(6)}`);
  console.log(`  bereits importiert           ${already.length}`);
  console.log(`  zu importieren               ${eligible.length}`);

  let written = 0;
  for (const plan of eligible) {
    const result = await importGroup(client, plan, factor);
    if (!result.ok) {
      /*
       * Stop on the first refusal and say exactly which group it was. The
       * unique index on `import_fingerprint` means a repeat is rejected rather
       * than duplicated, so the safe move is always to look before rerunning.
       */
      console.error(`\n  ABBRUCH bei Kopfzeile ${plan.headerRow} (${plan.fingerprint.slice(0, 12)}…)`);
      console.error(`    ${result.message}`);
      console.error(`\n  ${written} Verkäufe wurden geschrieben, danach nichts mehr.`);
      console.error("  Vor einem erneuten Lauf den Bestand prüfen.\n");
      process.exit(1);
    }
    written += 1;
    if (written % 50 === 0) console.log(`  … ${written}/${eligible.length}`);
  }

  console.log(`  geschrieben                  ${written}`);

  /*
   * The standalone correction, through 0061.
   *
   * `Korrektur >` is a channel-level adjustment with no sale: a 5,19 €
   * shipping label the channel billed against no order. It gets
   * `sale_id = NULL` — attaching it to a neighbouring sale would silently
   * reduce that sale's payout by money it never cost.
   *
   * The amount is the normalized model's own payout effect, not a re-reading
   * of the fee cell: the workbook records a POSITIVE 5,19 € label, and its
   * effect on the settlement is NEGATIVE.
   */
  const correction = plans.find((p) => p.status === "standalone_correction");
  if (correction) {
    console.log("\n=== EIGENSTÄNDIGE KORREKTUR ===");
    const { data, error } = await client.rpc("seller_import_settlement_adjustment", {
      p_fingerprint: correction.fingerprint,
      p_channel: "ebay",
      p_amount: correction.expectedPayout,
      p_reason: "versandlabel_ohne_verkauf",
      p_note: `Order 2026, Kopfzeile ${correction.headerRow} — ${correction.rawDate}`,
      p_occurred_at: correction.date,
      p_external_ref: null,
    });
    if (error) {
      console.error(`  ABBRUCH: ${error.code ?? ""} ${error.message}`.trim());
      process.exit(1);
    }
    const result = data as { id: number; inserted: boolean };
    console.log(`  Kopfzeile ${correction.headerRow} · ${JSON.stringify(correction.rawDate)}` +
      ` · ${correction.buyer} · ${correction.expectedPayout.toFixed(2)} €`);
    console.log(`  ${result.inserted ? "geschrieben" : "bereits vorhanden"} · id ${result.id}` +
      ` · Fingerabdruck ${correction.fingerprint.slice(0, 12)}…`);
  }
}

async function main(): Promise<void> {
  const choice = chooseEnvironment(process.argv.slice(2));
  if (!choice.ok) {
    console.error("\n  ENVIRONMENT GUARD — refusing to run.");
    console.error(`  ${choice.message}`);
    console.error("  Nothing has been written.\n");
    process.exit(1);
  }
  const url = choice.environment === "production"
    ? requireProduction("orderbook:sales-import")
    : requireStaging("orderbook:sales-import");
  const client = await operatorClient();
  console.log(`\n=== PREVIEW — ${ORDER_SHEET}, historische Verkäufe ===`);
  const { plans, bytes, factor, importedAdjustments } = await readAndPlan(client);
  report(plans, bytes, importedAdjustments);

  if (!flag("apply")) {
    console.log("\nPreview only. Nothing was written.\n");
    return;
  }

  /*
   * Apply is authorised, but not by `--apply` alone.
   *
   * `--apply` is one word away from `--preview` in a shell history, and this
   * one writes historical sales. The second flag names the environment out
   * loud, so the command cannot be arrived at by editing the end of the
   * previous one. Auf Production ist dieses Wort bereits gefallen —
   * `--confirm-production` wählt die Umgebung überhaupt erst aus.
   */
  const confirmation = choice.environment === "production"
    ? "confirm-production" : "confirm-staging";
  if (!flag(confirmation)) {
    console.error(`\n  Apply requires --${confirmation} as well as --apply.`);
    console.error(`  Target would be: ${new URL(url).hostname.split(".")[0]}`);
    console.error("  Nothing was written.\n");
    process.exit(1);
  }

  await apply(client, plans, factor);
  console.log("\nApply abgeschlossen.\n");
}

await main();
