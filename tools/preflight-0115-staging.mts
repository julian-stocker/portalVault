/**
 * READ-ONLY-PREFLIGHT UND -POSTFLIGHT FÜR `0115` AUF STAGING.
 *
 *   npm run preflight:0115:staging            -- liest, rechnet, urteilt
 *   npm run preflight:0115:staging -- --out <datei>   -- Zustand sichern
 *   npm run preflight:0115:staging -- --compare <datei>  -- gegen Vorher prüfen
 *
 * ES SCHREIBT NICHTS. Ausschliesslich `select` über PostgREST — kein
 * `insert`, kein `update`, kein `rpc`, kein DDL. Die Migration selbst wird
 * NICHT von hier angewendet: dafür gibt es in diesem Projekt keinen Weg und
 * soll es keinen geben, der Betreiber führt sie im SQL-Editor aus.
 *
 * ZWEI MODI, EINE DATEI, UND DER MODUS WIRD ERKANNT STATT GEWÄHLT.
 *
 * Gefragt wird die Datenbank, nicht der Aufrufer: existiert `daily_index` auf
 * `purchases`? Dann ist 0115 angewendet und dies ist der Postflight; fehlt
 * sie (PostgREST antwortet `42703`), ist es der Preflight. Ein Schalter von
 * Hand wäre die eine Stelle, an der sich ein Mensch irren kann, und ein
 * Postflight, der versehentlich als Preflight läuft, hätte nichts gemerkt.
 *
 * WAS ER FESTHÄLT
 *
 * Fingerabdrücke über die Daten, die 0115 nicht anfassen darf: jeder Einkauf
 * mit Datum, Betrag, Quelle, Referenz, Notiz und Testmarke; jede
 * Einkaufsposition mit Zustand, Zuordnung, Preisschnappschuss und
 * Bewegungsnummer; der ganze Lagerbestand; jede Lagerbewegung. Dazu die
 * Zählwerte, der globale Einkaufsfaktor und — das eigentliche Thema von
 * 0115 — der ERWARTETE `daily_index`-Backfill, Zeile für Zeile, mit genau
 * derselben Arithmetik wie die Migration: `row_number() over (partition by
 * purchased_at order by id)`.
 *
 * Nach der Migration wird derselbe Zustand erneut gelesen und gegen die
 * gesicherte Datei gestellt. Abweichen DARF nur, was 0115 ausdrücklich
 * ändert; der Backfill wird dabei getrennt ausgewiesen und gegen die
 * Vorhersage geprüft, Zeile für Zeile.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";

/** Das Staging-Projekt, dessen Ref im Bericht auftauchen muss. */
const EXPECTED_REF = "qqxcpesbwfxzgytkdsac";

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];
const check = (name: string, passed: boolean, detail = ""): void => {
  checks.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const heading = (text: string) => console.log(`\n${text}\n${"-".repeat(text.length)}`);
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const money = (v: unknown) => Number(v ?? 0).toFixed(2);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) { console.error(`Missing ${name}. Run through npm.`); process.exit(1); }
  return value;
}

/** Jede Tabelle seitenweise, damit kein Standardlimit still kürzt. */
async function readAll<T>(
  client: SupabaseClient, table: string, columns: string, order: string,
): Promise<T[]> {
  const page = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await client.from(table).select(columns)
      .order(order, { ascending: true }).range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.code ?? ""} ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < page) return rows;
  }
}

async function exactCount(client: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`${table} count: ${error.message}`);
  if (count === null) throw new Error(`${table}: kein exakter Zähler`);
  return count;
}

/** Existiert diese Spalte? `42703` heisst nein, und nur das. */
async function hasColumn(client: SupabaseClient, table: string, column: string): Promise<boolean> {
  const { error } = await client.from(table).select(column).limit(1);
  if (error === null) return true;
  if (error.code === "42703") return false;
  throw new Error(`${table}.${column}: unerwartet ${error.code} ${error.message}`);
}

type PurchaseRow = {
  id: number; purchased_at: string | null; total_cost: string; currency: string;
  source: string; external_ref: string | null; note: string | null;
  import_fingerprint: string | null; is_test: boolean;
  created_at: string; updated_at: string;
};
type ItemRow = {
  id: number; purchase_id: number; position: number; sky_id: string | null;
  condition: string; raw_name: string | null; state: string;
  market_price_snapshot: string | null; movement_id: number | null;
  source_row: number | null; note: string | null;
};
type StockRow = { sky_id: string; condition: string; quantity: number; reserved: number };
/*
 * Eine Lagerbewegung hängt an der POSITION, nicht an der SKY-ID: `0003`
 * schreibt `inventory_id` und `delta`, und `reason` ist das, was anderswo
 * „kind" heisst. Zuerst stand hier `sky_id`/`kind`/`quantity` — PostgREST
 * antwortete `42703`, und das war richtig von ihm.
 */
type MovementRow = {
  id: number; inventory_id: number; delta: number; reason: string;
  unit_cost: string | null; created_at: string;
};
type PriceRow = { sky_id: string; market_price: string | null };

const PURCHASE_COLS =
  "id,purchased_at,total_cost,currency,source,external_ref,note,import_fingerprint,is_test,created_at,updated_at";
const ITEM_COLS =
  "id,purchase_id,position,sky_id,condition,raw_name,state,market_price_snapshot,movement_id,source_row,note";

/** Der Zustand, der verglichen wird. Reine Daten, keine Urteile. */
type Snapshot = {
  ref: string;
  takenAt: string;
  applied: boolean;
  counts: Record<string, number>;
  fingerprints: Record<string, string>;
  factor: { all: string; withoutTest: string; knownValue: string; cost: string };
  days: { day: string; count: number; ids: number[] }[];
  undatedIds: number[];
  expectedIndex: Record<string, number>;
  actualIndex: Record<string, number | null>;
};

function fingerprints(
  purchases: PurchaseRow[], items: ItemRow[], stock: StockRow[], movements: MovementRow[],
): Record<string, string> {
  const p = purchases
    .map((r) => [r.id, r.purchased_at ?? "-", money(r.total_cost), r.currency, r.source,
                 r.external_ref ?? "-", r.note ?? "-", r.import_fingerprint ?? "-",
                 r.is_test ? "T" : "F"].join("|"))
    .join("\n");
  /* `updated_at` getrennt: 0115 schreibt den Backfill und darf es bewegen. */
  const pStamps = purchases.map((r) => `${r.id}|${r.created_at}|${r.updated_at}`).join("\n");
  const i = items
    .map((r) => [r.id, r.purchase_id, r.position, r.sky_id ?? "-", r.condition, r.raw_name ?? "-",
                 r.state, r.market_price_snapshot === null ? "-" : money(r.market_price_snapshot),
                 r.movement_id ?? "-", r.source_row ?? "-", r.note ?? "-"].join("|"))
    .join("\n");
  const s = [...stock]
    .sort((a, b) => `${a.sky_id}|${a.condition}`.localeCompare(`${b.sky_id}|${b.condition}`))
    .map((r) => `${r.sky_id}|${r.condition}|${r.quantity}|${r.reserved}`).join("\n");
  const m = movements
    .map((r) => [r.id, r.inventory_id, r.delta, r.reason,
                 r.unit_cost === null ? "-" : money(r.unit_cost), r.created_at].join("|"))
    .join("\n");
  return {
    purchases: md5(p), purchase_stamps: md5(pStamps), purchase_items: md5(i),
    shop_inventory: md5(s), inventory_movements: md5(m),
  };
}

/**
 * Der globale Einkaufsfaktor, mit der Regel von VOR 0116.
 *
 * Bewusst nicht über `orderbook_global_factor()` gelesen: die Funktion hängt
 * an `can_operate_active_seller()`, und ein Service-Key ist kein
 * Betreiberkonto. Nachgerechnet wird deshalb hier — Kosten durch bekannten
 * Marktwert, jede Position mit Katalogpreis oder Schnappschuss, beschädigt
 * und fehlend NOCH mitgezählt (das ändert erst D4 in 0116).
 */
function globalFactor(
  purchases: PurchaseRow[], items: ItemRow[], prices: Map<string, number | null>,
  excludeTest: boolean,
): { factor: string; knownValue: number; cost: number } {
  const keep = new Set(purchases.filter((p) => !(excludeTest && p.is_test)).map((p) => p.id));
  let cost = 0;
  for (const p of purchases) if (keep.has(p.id)) cost += Number(p.total_cost);
  let known = 0;
  for (const it of items) {
    if (!keep.has(it.purchase_id)) continue;
    const snap = it.market_price_snapshot === null ? null : Number(it.market_price_snapshot);
    const live = it.sky_id === null ? null : (prices.get(it.sky_id) ?? null);
    const value = snap ?? live;
    if (value !== null) known += value;
  }
  return {
    factor: known > 0 ? (cost / known).toFixed(6) : "—",
    knownValue: Math.round(known * 100) / 100,
    cost: Math.round(cost * 100) / 100,
  };
}

/**
 * Der Backfill, wie 0115 ihn rechnen wird.
 *
 *     row_number() over (partition by purchased_at order by p.id)
 *
 * Dieselbe Partition, dieselbe Ordnung, dieselbe 1-Basis. Weicht der
 * Postflight hiervon um eine Zeile ab, war die Annahme falsch und nicht die
 * Datenbank.
 */
function expectedBackfill(purchases: PurchaseRow[]): {
  expected: Record<string, number>;
  days: { day: string; count: number; ids: number[] }[];
  undatedIds: number[];
} {
  const byDay = new Map<string, number[]>();
  const undatedIds: number[] = [];
  for (const p of [...purchases].sort((a, b) => a.id - b.id)) {
    if (p.purchased_at === null) { undatedIds.push(p.id); continue; }
    const list = byDay.get(p.purchased_at) ?? [];
    list.push(p.id);
    byDay.set(p.purchased_at, list);
  }
  const expected: Record<string, number> = {};
  for (const [, ids] of byDay) ids.forEach((id, n) => { expected[String(id)] = n + 1; });
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, ids]) => ({ day, count: ids.length, ids }));
  return { expected, days, undatedIds };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const cmpAt = args.indexOf("--compare");
  const out = outAt >= 0 ? args[outAt + 1] : null;
  const compare = cmpAt >= 0 ? args[cmpAt + 1] : null;

  console.log("");
  console.log("  0115 — READ-ONLY-PRÜFUNG AUF STAGING");
  console.log("  ====================================");
  const origin = requireStaging("preflight-0115-staging");
  const ref = origin.replace(/^https?:\/\//, "").split(".")[0];
  if (ref !== EXPECTED_REF) {
    console.error(`\n  ABBRUCH: Ziel ist ${ref}, erwartet ${EXPECTED_REF}.\n`);
    process.exit(1);
  }
  console.log(`  Ziel: ${ref}  ·  nur Lesezugriffe`);

  const client = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
                              requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
                              { auth: { persistSession: false, autoRefreshToken: false } });

  // ---------------------------------------------------------------- 1. Modus
  heading("1. Ist 0115 angewendet?");
  const NEW_COLUMNS = ["items_cost", "shipping_cost", "buyer_protection_cost",
                       "platform", "seller_name", "payment_method", "daily_index"];
  const present: string[] = [];
  for (const c of NEW_COLUMNS) if (await hasColumn(client, "purchases", c)) present.push(c);
  const applied = present.length === NEW_COLUMNS.length;
  if (present.length !== 0 && !applied) {
    check("Spalten vollständig oder gar nicht", false,
          `nur ${present.join(", ")} vorhanden — HALBER STAND, STOP`);
  } else {
    check("Spaltenstand eindeutig", true,
          applied ? "alle sieben vorhanden → POSTFLIGHT" : "keine vorhanden → PREFLIGHT");
  }
  const mode = applied ? "POSTFLIGHT" : "PREFLIGHT";

  // ------------------------------------------------------------- 2. Die Daten
  heading("2. Bestand lesen");
  const purchases = await readAll<PurchaseRow>(client, "purchases", PURCHASE_COLS, "id");
  const items = await readAll<ItemRow>(client, "purchase_items", ITEM_COLS, "id");
  const stock = await readAll<StockRow>(client, "shop_inventory",
                                        "sky_id,condition,quantity,reserved", "sky_id");
  const movements = await readAll<MovementRow>(client, "inventory_movements",
    "id,inventory_id,delta,reason,unit_cost,created_at", "id");
  const prices = await readAll<PriceRow>(client, "skylanders", "sky_id,market_price", "sky_id");
  const priceMap = new Map<string, number | null>(
    prices.map((r) => [r.sky_id, r.market_price === null ? null : Number(r.market_price)]));

  const counts: Record<string, number> = {
    purchases: purchases.length,
    purchase_items: items.length,
    shop_inventory: stock.length,
    inventory_movements: movements.length,
    skylanders: prices.length,
  };
  /* Gegen den exakten Zähler der Datenbank, damit keine Seite fehlt. */
  for (const t of ["purchases", "purchase_items", "inventory_movements"] as const) {
    const exact = await exactCount(client, t);
    check(`${t}: vollständig gelesen`, exact === counts[t], `${counts[t]} von ${exact}`);
  }
  console.log(`  Lager: ${stock.length} Zeilen · Katalog: ${prices.length} Figuren`);

  const fp = fingerprints(purchases, items, stock, movements);
  const dated = purchases.filter((p) => p.purchased_at !== null);
  const undated = purchases.filter((p) => p.purchased_at === null);
  const { expected, days, undatedIds } = expectedBackfill(purchases);

  const all = globalFactor(purchases, items, priceMap, false);
  const noTest = globalFactor(purchases, items, priceMap, true);

  heading("3. Kennzahlen");
  console.log(`  Einkäufe            ${purchases.length}  (${dated.length} datiert · ${undated.length} ohne Datum)`);
  console.log(`  davon Testvorgänge  ${purchases.filter((p) => p.is_test).length}`);
  console.log(`  Positionen          ${items.length}`);
  console.log(`  Tage mit Einkauf    ${days.length}  (max ${Math.max(0, ...days.map((d) => d.count))} an einem Tag)`);
  console.log(`  Kosten gesamt       ${all.cost.toFixed(2)} EUR`);
  console.log(`  Faktor (alle)       ${all.factor}  bei ${all.knownValue.toFixed(2)} EUR bekanntem Marktwert`);
  console.log(`  Faktor (ohne Test)  ${noTest.factor}  bei ${noTest.knownValue.toFixed(2)} EUR`);
  console.log("");
  for (const [k, v] of Object.entries(fp)) console.log(`  md5 ${k.padEnd(20)} ${v}`);

  heading("4. Zustände der Positionen");
  const byState = new Map<string, number>();
  for (const i of items) byState.set(i.state, (byState.get(i.state) ?? 0) + 1);
  for (const [s, n] of [...byState.entries()].sort()) console.log(`  ${s.padEnd(20)} ${n}`);
  /* 0115 erweitert nur die erlaubte Liste — ein unbekannter Zustand wäre ein
     Hinweis, dass hier etwas anderes passiert ist. */
  const KNOWN = ["ordered", "arrived", "damaged", "missing", "booked",
                 "reconciled_legacy", "settled", "showcase"];
  check("nur bekannte Positionszustände",
        [...byState.keys()].every((s) => KNOWN.includes(s)),
        [...byState.keys()].filter((s) => !KNOWN.includes(s)).join(", ") || "alle bekannt");

  // -------------------------------------------------- 5. Konflikte von 0115
  heading("5. Konflikte, die 0115 abweisen würden");
  check("total_cost überall gesetzt und im CHECK-Bereich",
        purchases.every((p) => Number(p.total_cost) >= 0 && Number(p.total_cost) <= 1000000),
        `min ${Math.min(...purchases.map((p) => Number(p.total_cost))).toFixed(2)} · ` +
        `max ${Math.max(...purchases.map((p) => Number(p.total_cost))).toFixed(2)}`);
  check("jedes Datum ist ein reines Datum (kein Zeitstempel)",
        dated.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.purchased_at!)),
        `${dated.length} geprüft`);
  const dups = days.filter((d) => d.count > 1);
  check("Datumsduplikate sind erlaubt und vorhersagbar", true,
        `${dups.length} Tage mit mehr als einem Einkauf · ` +
        `grösste Gruppe ${Math.max(0, ...dups.map((d) => d.count))}`);
  check("erwarteter Backfill ist je Tag lückenlos 1..n",
        days.every((d) => d.ids.map((id) => expected[String(id)]).sort((a, b) => a - b)
          .every((v, n) => v === n + 1)),
        `${Object.keys(expected).length} Plätze für ${dated.length} datierte Einkäufe`);
  check("erwarteter Backfill ist je Tag eindeutig",
        days.every((d) => new Set(d.ids.map((id) => expected[String(id)])).size === d.count));
  check("ohne Datum kein Platz", undatedIds.every((id) => expected[String(id)] === undefined),
        `${undatedIds.length} undatierte Einkäufe: ${undatedIds.join(", ") || "keine"}`);
  check("jeder datierte Einkauf bekommt genau einen Platz",
        dated.every((p) => typeof expected[String(p.id)] === "number"));
  /* Die neuen Kosten- und Kopfspalten entstehen leer. Jeder der sechs CHECKs
     aus 0115 ist für NULL erfüllt — das ist der Grund, warum 0115 keine
     bestehende Zeile umdeutet. */
  check("neue Kopf- und Kostenspalten starten leer (kein Backfill)", true,
        "items_cost · shipping_cost · buyer_protection_cost · platform · " +
        "seller_name · payment_method = NULL für alle " + purchases.length);

  // ------------------------------------------------- 6. Postflight-Vergleich
  let snapshot: Snapshot = {
    ref, takenAt: new Date().toISOString(), applied,
    counts, fingerprints: fp,
    factor: { all: all.factor, withoutTest: noTest.factor,
              knownValue: all.knownValue.toFixed(2), cost: all.cost.toFixed(2) },
    days, undatedIds, expectedIndex: expected, actualIndex: {},
  };

  if (applied) {
    heading("6. Der Platz, wie er jetzt in der Datenbank steht");
    const actual = await readAll<{ id: number; daily_index: number | null }>(
      client, "purchases", "id,daily_index", "id");
    const actualIndex: Record<string, number | null> = {};
    for (const r of actual) actualIndex[String(r.id)] = r.daily_index;
    snapshot = { ...snapshot, actualIndex };

    const datedIds = dated.map((p) => p.id);
    check("jeder datierte Einkauf hat einen Platz",
          datedIds.every((id) => typeof actualIndex[String(id)] === "number"),
          `${datedIds.filter((id) => typeof actualIndex[String(id)] === "number").length} von ${datedIds.length}`);
    check("kein undatierter Einkauf hat einen Platz",
          undatedIds.every((id) => actualIndex[String(id)] === null),
          `${undatedIds.length} geprüft`);
    const wrong = datedIds.filter((id) => actualIndex[String(id)] !== expected[String(id)]);
    check("Platz ist genau der vorhergesagte", wrong.length === 0,
          wrong.length === 0 ? "Zeile für Zeile gleich"
            : `${wrong.length} Abweichungen: ${wrong.slice(0, 10).join(", ")}`);
    check("je Tag lückenlos 1..n und eindeutig",
          days.every((d) => {
            const got = d.ids.map((id) => actualIndex[String(id)]);
            return new Set(got).size === d.count
              && [...got].sort((a, b) => Number(a) - Number(b)).every((v, n) => v === n + 1);
          }));
    const newCols = await readAll<Record<string, unknown>>(client, "purchases",
      "id,items_cost,shipping_cost,buyer_protection_cost,platform,seller_name,payment_method", "id");
    check("die sechs neuen Kopfspalten sind überall leer",
          newCols.every((r) => ["items_cost", "shipping_cost", "buyer_protection_cost",
                                "platform", "seller_name", "payment_method"]
            .every((k) => r[k] === null)),
          `${newCols.length} Zeilen geprüft`);
  }

  if (compare) {
    heading(applied ? "7. Vorher gegen Nachher" : "7. Vergleich mit der gesicherten Datei");
    const before = JSON.parse(readFileSync(compare, "utf8")) as Snapshot;
    check("dasselbe Projekt", before.ref === ref, `${before.ref} → ${ref}`);
    for (const key of ["purchases", "purchase_items", "shop_inventory",
                       "inventory_movements"] as const) {
      check(`md5 ${key} unverändert`, before.fingerprints[key] === fp[key],
            `${before.fingerprints[key]} → ${fp[key]}`);
    }
    for (const [k, v] of Object.entries(before.counts)) {
      check(`Anzahl ${k} unverändert`, counts[k] === v, `${v} → ${counts[k]}`);
    }
    check("Faktor (alle) unverändert", before.factor.all === all.factor,
          `${before.factor.all} → ${all.factor}`);
    check("Faktor (ohne Test) unverändert", before.factor.withoutTest === noTest.factor,
          `${before.factor.withoutTest} → ${noTest.factor}`);
    check("Kosten gesamt unverändert", before.factor.cost === all.cost.toFixed(2),
          `${before.factor.cost} → ${all.cost.toFixed(2)}`);
    /*
     * DER BACKFILL IST DIE EINE ERLAUBTE ÄNDERUNG, und er wird getrennt
     * ausgewiesen: gegen die VOR der Migration berechnete Vorhersage.
     */
    const predicted = before.expectedIndex;
    const got = snapshot.actualIndex;
    const off = Object.keys(predicted).filter((id) => got[id] !== predicted[id]);
    check("Backfill trifft die Vorhersage von vorher", applied && off.length === 0,
          applied ? (off.length === 0 ? `${Object.keys(predicted).length} Plätze gesetzt`
                                      : `${off.length} Abweichungen`)
                  : "0115 ist nicht angewendet");
    /*
     * `updated_at` MUSS stehen bleiben, und das ist keine Nachsicht.
     *
     * Auf `purchases` liegt vor 0115 KEIN Trigger — nachgesehen in den
     * Migrationen 0053 bis 0114 —, und die Spalte wird ausschliesslich von
     * den Schreibfunktionen gesetzt. Der Backfill ist ein `update`, das nur
     * `daily_index` nennt. Bewegt sich hier etwas, hat etwas anderes
     * geschrieben als 0115, und das ist ein Befund.
     */
    check("Zeitstempel unverändert (kein Trigger, kein fremder Schreiber)",
          before.fingerprints.purchase_stamps === fp.purchase_stamps,
          `${before.fingerprints.purchase_stamps} → ${fp.purchase_stamps}`);
  }

  if (out) {
    writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`\n  Zustand gesichert: ${out}`);
  }

  const failed = checks.filter((c) => !c.passed);
  console.log("");
  console.log(`  ${mode}: ${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length > 0) {
    console.log("");
    for (const f of failed) console.log(`  FAIL  ${f.name} — ${f.detail}`);
    console.log("\n  NICHT GRÜN — 0115 nicht anwenden.\n");
    process.exit(1);
  }
  console.log(applied
    ? "\n  Postflight grün.\n"
    : "\n  Preflight grün — 0115 kann auf Staging angewendet werden.\n");
}

main().catch((err) => {
  console.error(`\n  ABBRUCH: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
