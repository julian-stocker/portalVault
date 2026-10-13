/**
 * READ-ONLY-PREFLIGHT UND -POSTFLIGHT FÜR `0116` AUF STAGING.
 *
 *   npm run preflight:0116:staging -- --out <datei>
 *   npm run preflight:0116:staging -- --compare <datei>
 *
 * ES SCHREIBT NICHTS. Ausschliesslich `select` über PostgREST. Die Migration
 * wird nicht von hier angewendet — dafür gibt es in diesem Projekt keinen Weg.
 *
 * ---------------------------------------------------------------------------
 * WAS DIESES WERKZEUG KANN, WAS DER SQL-BLOCK NICHT KANN
 *
 * Es rechnet die FAKTORREGEL BEIDER FASSUNGEN auf denselben Daten nach — die
 * alte (jede Zeile zählt, `missing` ausgeschlossen, `damaged` mit vollem
 * Wert) und die neue aus D4/D5 (`damaged`/`missing` mit 0 EUR, Testeinkäufe
 * ganz heraus). Damit steht die Wirkung von 0116 als ZAHL fest, bevor die
 * Migration läuft, und der Postflight vergleicht nicht gegen eine Erwartung,
 * sondern gegen eine Vorhersage.
 *
 * 0116 schreibt keine Zeile. Jeder Daten-Fingerabdruck muss danach deshalb
 * unverändert sein — ohne jede Ausnahme, anders als bei 0115, wo der
 * Tagesindex-Backfill die eine erlaubte Änderung war.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";

const EXPECTED_REF = "qqxcpesbwfxzgytkdsac";

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];
const check = (name: string, passed: boolean, detail = ""): void => {
  checks.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const heading = (t: string) => console.log(`\n${t}\n${"-".repeat(t.length)}`);
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const env = (n: string) => { const v = process.env[n]; if (!v) throw new Error(`Missing ${n}`); return v; };
const money = (v: unknown) => Number(v ?? 0).toFixed(2);

async function readAll<T>(c: SupabaseClient, t: string, cols: string, order = "id"): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await c.from(t).select(cols)
      .order(order, { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${t}: ${error.code ?? ""} ${error.message}`);
    rows.push(...(data as T[]));
    if ((data as T[]).length < 1000) return rows;
  }
}

async function exactCount(c: SupabaseClient, t: string): Promise<number> {
  const { count, error } = await c.from(t).select("id", { count: "exact", head: true });
  if (error) throw new Error(`${t}: ${error.message}`);
  if (count === null) throw new Error(`${t}: kein exakter Zähler`);
  return count;
}

type P = {
  id: number; purchased_at: string | null; daily_index: number | null; total_cost: string;
  currency: string; source: string; external_ref: string | null; note: string | null;
  import_fingerprint: string | null; is_test: boolean; created_at: string; updated_at: string;
  items_cost: string | null; shipping_cost: string | null;
  buyer_protection_cost: string | null; platform: string | null;
  seller_name: string | null; payment_method: string | null;
};
type I = {
  id: number; purchase_id: number; position: number; sky_id: string | null; condition: string;
  raw_name: string | null; state: string; market_price_snapshot: string | null;
  movement_id: number | null; source_row: number | null; note: string | null;
};
type S = { sky_id: string; condition: string; quantity: number; reserved: number };
type M = { id: number; inventory_id: number; delta: number; reason: string;
           unit_cost: string | null; created_at: string };

const P_COLS = "id,purchased_at,daily_index,total_cost,currency,source,external_ref,note,"
  + "import_fingerprint,is_test,created_at,updated_at,items_cost,shipping_cost,"
  + "buyer_protection_cost,platform,seller_name,payment_method";
const I_COLS = "id,purchase_id,position,sky_id,condition,raw_name,state,"
  + "market_price_snapshot,movement_id,source_row,note";

/** Der anrechenbare Wert einer Position — beide Regeln, eine Funktion. */
function itemValue(
  it: I, prices: Map<string, number | null>, rule: "old" | "new",
): { value: number | null; counts: boolean } {
  const known = it.market_price_snapshot !== null ? Number(it.market_price_snapshot)
    : it.sky_id === null ? null : (prices.get(it.sky_id) ?? null);
  if (rule === "old") {
    /* Vor 0116: `missing` fiel ganz heraus, `damaged` zählte voll mit. */
    if (it.state === "missing") return { value: null, counts: false };
    return { value: known, counts: true };
  }
  /* Ab 0116 (D4): beschädigt und fehlend tragen 0 EUR, bleiben aber dabei. */
  if (it.state === "damaged" || it.state === "missing") return { value: 0, counts: true };
  return { value: known, counts: true };
}

function factorOf(
  purchases: P[], items: I[], prices: Map<string, number | null>,
  rule: "old" | "new", excludeTest: boolean,
): { factor: string | null; cost: number; known: number } {
  const keep = new Set(purchases.filter((p) => !(excludeTest && p.is_test)).map((p) => p.id));
  let cost = 0;
  for (const p of purchases) if (keep.has(p.id)) cost += Number(p.total_cost);
  let known = 0;
  for (const it of items) {
    if (!keep.has(it.purchase_id)) continue;
    const v = itemValue(it, prices, rule);
    if (v.counts && v.value !== null) known += v.value;
  }
  cost = Math.round(cost * 100) / 100;
  known = Math.round(known * 100) / 100;
  return { factor: known > 0 ? (cost / known).toFixed(6) : null, cost, known };
}

type Snapshot = {
  ref: string; takenAt: string;
  counts: Record<string, number>;
  fingerprints: Record<string, string>;
  states: Record<string, number>;
  factors: Record<string, { factor: string | null; cost: number; known: number }>;
  placedPurchases: number;
  dayGroups: number;
  splitPurchases: number;
  perPurchaseValue: Record<string, { oldValue: number; newValue: number }>;
};

function fingerprints(p: P[], i: I[], s: S[], m: M[]): Record<string, string> {
  return {
    /* Dieselben Rezepte wie im 0115-Werkzeug, damit die Familien vergleichbar
       bleiben — plus eines über die neuen Spalten aus 0115. */
    purchases: md5(p.map((r) => [r.id, r.purchased_at ?? "-", money(r.total_cost), r.currency,
      r.source, r.external_ref ?? "-", r.note ?? "-", r.import_fingerprint ?? "-",
      r.is_test ? "T" : "F"].join("|")).join("\n")),
    purchase_head: md5(p.map((r) => [r.id, r.daily_index ?? "-",
      r.items_cost === null ? "-" : money(r.items_cost),
      r.shipping_cost === null ? "-" : money(r.shipping_cost),
      r.buyer_protection_cost === null ? "-" : money(r.buyer_protection_cost),
      r.platform ?? "-", r.seller_name ?? "-", r.payment_method ?? "-"].join("|")).join("\n")),
    purchase_stamps: md5(p.map((r) => `${r.id}|${r.created_at}|${r.updated_at}`).join("\n")),
    purchase_items: md5(i.map((r) => [r.id, r.purchase_id, r.position, r.sky_id ?? "-",
      r.condition, r.raw_name ?? "-", r.state,
      r.market_price_snapshot === null ? "-" : money(r.market_price_snapshot),
      r.movement_id ?? "-", r.source_row ?? "-", r.note ?? "-"].join("|")).join("\n")),
    shop_inventory: md5([...s].sort((a, b) =>
      `${a.sky_id}|${a.condition}`.localeCompare(`${b.sky_id}|${b.condition}`))
      .map((r) => `${r.sky_id}|${r.condition}|${r.quantity}|${r.reserved}`).join("\n")),
    inventory_movements: md5(m.map((r) => [r.id, r.inventory_id, r.delta, r.reason,
      r.unit_cost === null ? "-" : money(r.unit_cost), r.created_at].join("|")).join("\n")),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out = args.indexOf("--out") >= 0 ? args[args.indexOf("--out") + 1] : null;
  const compare = args.indexOf("--compare") >= 0 ? args[args.indexOf("--compare") + 1] : null;

  console.log("\n  0116 — READ-ONLY-PRÜFUNG AUF STAGING");
  console.log("  ====================================");
  const origin = requireStaging("preflight-0116-staging");
  const ref = origin.replace(/^https?:\/\//, "").split(".")[0];
  if (ref !== EXPECTED_REF) {
    console.error(`\n  ABBRUCH: Ziel ist ${ref}, erwartet ${EXPECTED_REF}.\n`);
    process.exit(1);
  }
  console.log(`  Ziel: ${ref}  ·  nur Lesezugriffe`);

  const c = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"),
                          { auth: { persistSession: false, autoRefreshToken: false } });

  // ------------------------------------------------- 1. Steht 0115 wirklich?
  heading("1. Voraussetzung: der Stand nach 0115");
  const probe = await c.from("purchases").select(
    "items_cost,shipping_cost,buyer_protection_cost,platform,seller_name,payment_method,daily_index"
  ).limit(1);
  check("die sieben Spalten aus 0115 sind lesbar", probe.error === null,
        probe.error ? `${probe.error.code} ${probe.error.message}` : "alle sieben");
  if (probe.error) { console.log("\n  0115 fehlt — 0116 nicht vorbereiten.\n"); process.exit(1); }

  const purchases = await readAll<P>(c, "purchases", P_COLS);
  const items = await readAll<I>(c, "purchase_items", I_COLS);
  const stock = await readAll<S>(c, "shop_inventory", "sky_id,condition,quantity,reserved", "sky_id");
  const movements = await readAll<M>(c, "inventory_movements",
    "id,inventory_id,delta,reason,unit_cost,created_at");
  const prices = await readAll<{ sky_id: string; market_price: string | null }>(
    c, "skylanders", "sky_id,market_price", "sky_id");
  const priceMap = new Map<string, number | null>(
    prices.map((r) => [r.sky_id, r.market_price === null ? null : Number(r.market_price)]));

  for (const [t, n] of [["purchases", purchases.length], ["purchase_items", items.length],
                        ["inventory_movements", movements.length]] as const) {
    check(`${t}: vollständig gelesen`, (await exactCount(c, t)) === n, `${n} Zeilen`);
  }

  const dated = purchases.filter((p) => p.purchased_at !== null);
  const placed = purchases.filter((p) => p.daily_index !== null);
  check("jeder datierte Einkauf trägt seinen Platz aus 0115",
        placed.length === dated.length && placed.every((p) => p.purchased_at !== null),
        `${placed.length} Plätze zu ${dated.length} datierten Einkäufen`);
  const days = new Map<string, number[]>();
  for (const p of dated) days.set(p.purchased_at!, [...(days.get(p.purchased_at!) ?? []), p.daily_index!]);
  check("je Tag lückenlos 1..n und eindeutig",
        [...days.values()].every((v) => new Set(v).size === v.length
          && [...v].sort((a, b) => a - b).every((x, n) => x === n + 1)),
        `${days.size} Tage`);
  check("keine Kostenaufteilung und keine Plattform vorhanden",
        purchases.every((p) => p.items_cost === null && p.platform === null
          && p.payment_method === null && p.seller_name === null),
        "alle Kopffelder NULL — 0116 deutet also nichts um");

  // -------------------------------------------- 2. Zustände und Mengen
  heading("2. Zustandsverteilung der Positionen");
  const states: Record<string, number> = {};
  for (const i of items) states[i.state] = (states[i.state] ?? 0) + 1;
  for (const [s, n] of Object.entries(states).sort()) console.log(`  ${s.padEnd(20)} ${n}`);
  const KNOWN = ["ordered", "arrived", "damaged", "missing", "booked",
                 "reconciled_legacy", "settled", "showcase"];
  check("nur bekannte Zustände", Object.keys(states).every((s) => KNOWN.includes(s)));
  check("`showcase` ist noch nirgends gesetzt", (states.showcase ?? 0) === 0,
        "0116 macht es erst setzbar");
  /* Eine gebuchte Position MUSS eine Bewegung haben und umgekehrt — die
     Zusicherung, auf der „Eingebucht ✓" beruht. */
  check("booked ⇔ movement_id",
        items.every((i) => (i.state === "booked") === (i.movement_id !== null)),
        `${items.filter((i) => i.movement_id !== null).length} Positionen mit Bewegung`);
  check("kein Sonderzustand trägt eine Lagerbewegung",
        items.filter((i) => ["damaged", "missing", "showcase", "settled"].includes(i.state))
          .every((i) => i.movement_id === null));

  // ------------------------------------- 3. Die Faktorregel, beide Fassungen
  heading("3. Einkaufsfaktor — alte Regel gegen neue");
  const factors = {
    old_all: factorOf(purchases, items, priceMap, "old", false),
    old_noTest: factorOf(purchases, items, priceMap, "old", true),
    new_all: factorOf(purchases, items, priceMap, "new", false),
    new_noTest: factorOf(purchases, items, priceMap, "new", true),
  };
  for (const [k, v] of Object.entries(factors)) {
    console.log(`  ${k.padEnd(12)} ${String(v.factor).padEnd(10)} ` +
                `Kosten ${v.cost.toFixed(2)} · anrechenbar ${v.known.toFixed(2)}`);
  }
  console.log("");
  console.log(`  0116 liefert künftig: ${factors.new_noTest.factor}` +
              `  (heute ${factors.old_all.factor})`);
  const damaged = items.filter((i) => i.state === "damaged").length;
  const missing = items.filter((i) => i.state === "missing").length;
  check("D4 ohne Rückwirkung, weil es nichts Beschädigtes gibt",
        damaged === 0 && missing === 0, `damaged ${damaged} · missing ${missing}`);
  check("D4 allein ändert den Faktor nicht",
        factors.old_all.factor === factors.new_all.factor,
        `${factors.old_all.factor} → ${factors.new_all.factor}`);
  check("D5 ist die einzige messbare Wirkung",
        factors.new_noTest.factor === factors.old_noTest.factor
          && factors.new_noTest.factor !== factors.old_all.factor,
        `${factors.old_all.factor} → ${factors.new_noTest.factor} ` +
        `(${purchases.filter((p) => p.is_test).length} Testeinkäufe, ` +
        `${(factors.old_all.cost - factors.new_noTest.cost).toFixed(2)} EUR)`);
  check("keine Division durch null möglich", factors.new_noTest.known > 0,
        `anrechenbarer Wert ${factors.new_noTest.known.toFixed(2)} EUR > 0`);

  /* Je Einkauf: welche Zeile ändert ihren Wert? Erwartung: keine. */
  const perPurchaseValue: Record<string, { oldValue: number; newValue: number }> = {};
  for (const p of purchases) {
    const mine = items.filter((i) => i.purchase_id === p.id);
    const sum = (rule: "old" | "new") => Math.round(mine.reduce((t, i) => {
      const v = itemValue(i, priceMap, rule);
      return t + (v.counts && v.value !== null ? v.value : 0);
    }, 0) * 100) / 100;
    perPurchaseValue[String(p.id)] = { oldValue: sum("old"), newValue: sum("new") };
  }
  const movedRows = Object.entries(perPurchaseValue).filter(([, v]) => v.oldValue !== v.newValue);
  check("kein einzelner Einkauf ändert seinen Marktwert", movedRows.length === 0,
        movedRows.length === 0 ? `${purchases.length} Einkäufe gleich`
          : movedRows.slice(0, 8).map(([id, v]) => `#${id} ${v.oldValue}→${v.newValue}`).join(" · "));

  // --------------------------------------------- 4. Fingerabdrücke
  heading("4. Daten-Fingerabdrücke (nach 0116 ALLE unverändert)");
  const fp = fingerprints(purchases, items, stock, movements);
  for (const [k, v] of Object.entries(fp)) console.log(`  md5 ${k.padEnd(22)} ${v}`);

  const counts: Record<string, number> = {
    purchases: purchases.length, purchase_items: items.length,
    shop_inventory: stock.length, inventory_movements: movements.length,
    skylanders: prices.length,
    test_purchases: purchases.filter((p) => p.is_test).length,
  };
  const snapshot: Snapshot = {
    ref, takenAt: new Date().toISOString(), counts, fingerprints: fp, states, factors,
    placedPurchases: placed.length, dayGroups: days.size,
    splitPurchases: purchases.filter((p) => p.items_cost !== null).length,
    perPurchaseValue,
  };

  if (compare) {
    heading("5. Vorher gegen Nachher");
    const before = JSON.parse(readFileSync(compare, "utf8")) as Snapshot;
    check("dasselbe Projekt", before.ref === ref, `${before.ref} → ${ref}`);
    for (const k of Object.keys(before.fingerprints)) {
      check(`md5 ${k} unverändert`, before.fingerprints[k] === fp[k],
            `${before.fingerprints[k]} → ${fp[k]}`);
    }
    for (const [k, v] of Object.entries(before.counts)) {
      check(`Anzahl ${k} unverändert`, counts[k] === v, `${v} → ${counts[k]}`);
    }
    check("Zustandsverteilung unverändert",
          JSON.stringify(before.states) === JSON.stringify(states),
          JSON.stringify(states));
    check("Tagesplätze unverändert", before.placedPurchases === placed.length
          && before.dayGroups === days.size,
          `${placed.length} Plätze · ${days.size} Tage`);
    /*
     * Die Vorhersage: `new_noTest` ist, was `orderbook_global_factor()` nach
     * 0116 liefern MUSS. Nachgerechnet wird sie hier wieder lokal — die
     * Funktion selbst ist für jede Clientrolle entzogen und auch für den
     * Service-Key nicht aufrufbar, weil sie hinter dem Betreibertor steht.
     */
    check("Faktorvorhersage steht unverändert",
          JSON.stringify(before.factors) === JSON.stringify(factors),
          `neu ohne Test: ${factors.new_noTest.factor}`);
  }

  if (out) {
    writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`\n  Zustand gesichert: ${out}`);
  }

  const failed = checks.filter((x) => !x.passed);
  console.log(`\n  ${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  FAIL  ${f.name} — ${f.detail}`);
    console.log("\n  NICHT GRÜN.\n");
    process.exit(1);
  }
  console.log("\n  Grün.\n");
}

main().catch((e) => {
  console.error(`\n  ABBRUCH: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
