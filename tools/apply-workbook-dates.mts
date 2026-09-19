/**
 * Carries corrected dates from the workbook into records that already exist.
 *
 *   npm run orderbook:dates:staging              Vorschau, schreibt nichts
 *   npm run orderbook:dates:staging -- --apply   schreibt die Datumsfelder
 *
 * WHY THIS EXISTS INSTEAD OF A RE-IMPORT
 *
 * The import fingerprint of a purchase group and of a sale group both include
 * the DATE. Correcting a date in Excel therefore changes the fingerprint, and
 * the importers — which have no update path — would classify the corrected
 * group as new and write a second copy of a record that is already there.
 * Measured on the current workbook that would have been 13 duplicate
 * purchases (943,80 €, ~319 item rows) and one duplicate sale.
 *
 * So the date travels on its own. Nothing else is read from the workbook and
 * nothing else is written: nine other fields of a purchase and fifteen of a
 * sale stay exactly as imported.
 *
 * HOW A WORKBOOK GROUP IS MATCHED TO A RECORD
 *
 * By the header row the importer recorded in the note — `Order 2026,
 * Kopfzeile 1946, …` — which is the one identifier that survives a date
 * correction. The match is then CHECKED against the amount and, for a sale,
 * the buyer reference, and a mismatch stops the whole run. A header row is a
 * coordinate, and a coordinate alone is never trusted here.
 *
 * WHAT IT REFUSES
 *
 * A group whose workbook date is still not a date. Three sale groups carry
 * `""`, `"18"` and `"16.04.206"`; guessing what those meant is the thing this
 * project does not do, and they stay NULL until somebody types the real date.
 */
import { openAsBlob } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";
import { readWorkbookParts } from "../src/lib/import/xlsx-reader.ts";
import { parseSharedStrings } from "../src/lib/import/sheet-rows.ts";
import { groupRows, parseOrderSheet } from "../src/lib/orderbook/order-2026.ts";
import { groupSales, parseSalesSheet } from "../src/lib/orderbook/sales-2026.ts";

const ORDER_SHEET = "Order 2026";
const WORKBOOK = process.env.SKYISLES_WORKBOOK
  ?? `${process.env.HOME}/Documents/eCommerce/skylanders.xlsx`;

const flag = (name: string) => process.argv.includes(`--${name}`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) { console.error(`Missing ${name}. Run through npm.`); process.exit(1); }
  return value;
}

/** Sign in as the operator. The password is read and never printed. */
async function operatorClient(): Promise<SupabaseClient> {
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email: requireEnv("SKYISLES_OPERATOR_EMAIL"),
    password: requireEnv("SKYISLES_OPERATOR_PASSWORD"),
  });
  if (error) { console.error(`Operator sign-in failed: ${error.message}`); process.exit(1); }
  return client;
}

const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const headerOf = (note: string | null): number | null => {
  const m = /Kopfzeile (\d+)/.exec(note ?? "");
  return m ? Number(m[1]) : null;
};

type Change = {
  kind: "Einkauf" | "Verkauf";
  id: number;
  header: number;
  from: string | null;
  to: string;
};

async function main(): Promise<void> {
  requireStaging("orderbook:dates");
  const apply = flag("apply");
  const db = await operatorClient();

  const parts = await readWorkbookParts(await openAsBlob(WORKBOOK), [ORDER_SHEET]);
  const shared = parseSharedStrings(parts.sharedStrings);
  const xml = parts.sheets.get(ORDER_SHEET);
  if (!xml) throw new Error(`Sheet "${ORDER_SHEET}" not found`);

  console.log(`\n=== ${apply ? "APPLY" : "VORSCHAU"} — Datumskorrekturen aus dem Arbeitsbuch ===`);
  console.log(`  Mappe   ${WORKBOOK}`);
  console.log(`  gelesen ${(parts.bytesRead / 1048576).toFixed(2)} MB\n`);

  const changes: Change[] = [];
  const refused: string[] = [];

  // ------------------------------------------------------------- Einkauf
  const purchases = await db.rpc("seller_orderbook_ledger", {
    p_year: null, p_month: null, p_search: null, p_undated: false, p_status: "any",
  });
  if (purchases.error) throw new Error(`seller_orderbook_ledger: ${purchases.error.message}`);
  const pRows = ((purchases.data as Record<string, unknown>).purchases ?? []) as Record<string, unknown>[];
  const pByHeader = new Map<number, Record<string, unknown>>();
  for (const r of pRows) {
    if (String(r.source) !== "excel_order_2026") continue;
    const h = headerOf(r.note as string | null);
    if (h !== null) pByHeader.set(h, r);
  }

  for (const g of groupRows(parseOrderSheet(xml, shared))) {
    if (g.items.length === 0) continue;
    const row = pByHeader.get(g.headerRow);
    if (!row) continue;
    const current = row.purchased_at === null || row.purchased_at === undefined
      ? null : String(row.purchased_at);
    if (g.date === null || current === g.date) continue;

    // The check that makes the header row safe to match on.
    if (money(row.total_cost) !== money(g.totalCost)) {
      refused.push(`Einkauf #${row.id} (Kopfzeile ${g.headerRow}): Ausgaben ${money(row.total_cost)} ≠ Arbeitsbuch ${money(g.totalCost)}`);
      continue;
    }
    changes.push({ kind: "Einkauf", id: Number(row.id), header: g.headerRow, from: current, to: g.date });
  }

  // ------------------------------------------------------------- Verkauf
  const sales = await db.rpc("seller_sales", {
    p_year: null, p_month: null, p_search: null, p_undated: false,
    p_scope: "external", p_open_payout: false, p_status: "any",
  });
  if (sales.error) throw new Error(`seller_sales: ${sales.error.message}`);
  const sRows = ((sales.data as Record<string, unknown>).sales ?? []) as Record<string, unknown>[];
  const sByHeader = new Map<number, Record<string, unknown>>();
  for (const r of sRows) {
    if (String(r.source) !== "excel_order_2026") continue;
    const h = headerOf(r.note as string | null);
    if (h !== null) sByHeader.set(h, r);
  }

  for (const g of groupSales(parseSalesSheet(xml, shared))) {
    const row = sByHeader.get(g.headerRow);
    if (!row) continue;
    const current = row.sold_at === null || row.sold_at === undefined ? null : String(row.sold_at);
    if (g.date === null) {
      if (current === null) {
        refused.push(`Verkauf #${row.id} (Kopfzeile ${g.headerRow}): Arbeitsbuch hat weiterhin kein Datum — roh ${JSON.stringify(g.rawDate)}`);
      }
      continue;
    }
    if (current === g.date) continue;
    if (money(row.items_subtotal) !== money(g.money.U)) {
      refused.push(`Verkauf #${row.id} (Kopfzeile ${g.headerRow}): Summe ${money(row.items_subtotal)} ≠ Arbeitsbuch ${money(g.money.U)}`);
      continue;
    }
    changes.push({ kind: "Verkauf", id: Number(row.id), header: g.headerRow, from: current, to: g.date });
  }

  // ------------------------------------------------------------- Bericht
  console.log(`Zu ändern: ${changes.length}`);
  for (const c of changes) {
    console.log(`  ${c.kind} #${String(c.id).padStart(3)}  Kopfzeile ${String(c.header).padStart(4)}  ${c.from ?? "(kein Datum)"} → ${c.to}`);
  }
  if (refused.length > 0) {
    console.log(`\nUnverändert gelassen: ${refused.length}`);
    for (const r of refused) console.log(`  ${r}`);
  }

  if (!apply) {
    console.log("\nNur Vorschau. Es wurde nichts geschrieben. Mit --apply übernehmen.\n");
    return;
  }

  console.log("\n=== schreibe ===");
  let done = 0;
  for (const c of changes) {
    const result = c.kind === "Einkauf"
      ? await db.rpc("seller_set_purchase_date", { p_id: c.id, p_purchased_at: c.to })
      : await db.rpc("seller_set_sale_date", { p_id: c.id, p_sold_at: c.to });
    if (result.error) {
      console.error(`  FEHLER ${c.kind} #${c.id}: ${result.error.message}`);
      continue;
    }
    done++;
    console.log(`  ok  ${c.kind} #${c.id} → ${c.to}`);
  }
  console.log(`\n${done} von ${changes.length} übernommen.\n`);
  if (done !== changes.length) process.exit(1);
}

void main();
