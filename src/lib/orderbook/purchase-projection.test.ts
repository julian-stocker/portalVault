/**
 * Die Browsergrenze des Einkaufs: nur, was benannt ist.
 *
 * WARUM ES DIESE DATEI GIBT.
 *
 * `seller_purchase` gibt `to_jsonb(p) - 'created_by' - 'updated_by'` zurück,
 * also JEDE übrige Spalte von `public.purchases`. Seit `0120` sind das zwei
 * mehr: `client_token` und `client_request_fingerprint`. Was davon im Browser
 * ankommt, entscheidet nicht die Datenbank, sondern `fetchPurchase` — und
 * zwar dadurch, dass es dreizehn Felder NAMENTLICH liest und die Rohzeile nie
 * weitergibt.
 *
 * Diese Grenze ist eine Zeile breit. Ein `...p` an der Stelle, an der heute
 * `id: Number(p.id)` steht, würde beide Felder mitsamt `import_fingerprint`
 * an die Oberfläche schicken, und zwar lautlos: die Typen wären weiter
 * erfüllt, kein Test würde rot, und niemand sähe es im Review. Deshalb steht
 * es hier.
 *
 * ES GEHT NICHT UM EIN GEHEIMNIS. Der Entwurfstoken wird vom Browser selbst
 * erzeugt, und der Fingerabdruck ist ein Hash über Daten, die der Browser
 * gesendet hat. Es geht um die FORM: eine Projektion mit Positivliste bleibt
 * vorhersehbar, wenn die Tabelle wächst. Eine durchgereichte Zeile wird mit
 * jeder neuen Spalte etwas, das niemand entschieden hat.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { latestFunction } from "@/test-support/migrations";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const QUERIES = read("src/lib/orderbook/queries.ts");

/** Der Rumpf einer `export const name = cache(async …)`-Projektion. */
function projection(name: string): string {
  const start = QUERIES.indexOf(`export const ${name} = `);
  expect(start, name).toBeGreaterThan(-1);
  const next = QUERIES.indexOf("\nexport ", start + 1);
  return QUERIES.slice(start, next === -1 ? undefined : next);
}

/**
 * Die Schlüssel der ersten `return {`-Ebene — Tiefe 1, nichts darunter.
 *
 * Die Tiefe wird am ZEILENANFANG gemessen, nicht am Zeilenende: `items:`
 * öffnet seinen Wert in derselben Zeile, und am Ende der Zeile stünde die
 * Tiefe schon bei drei. Gemeint ist, auf welcher Ebene der Schlüssel steht.
 */
function returnedKeys(body: string): string[] {
  const at = body.indexOf("return {");
  expect(at).toBeGreaterThan(-1);
  const keys: string[] = [];
  let depth = 0;
  let depthAtLineStart = 0;
  let line = "";
  for (let i = at + "return ".length; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      if (depth === 0) break;
    }
    if (ch === "\n") {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
      if (m && depthAtLineStart === 1) keys.push(m[1]);
      line = "";
      depthAtLineStart = depth;
    } else {
      line += ch;
    }
  }
  /* Die letzte Zeile vor der schliessenden Klammer hat kein `\n` mehr. */
  const last = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
  if (last && depthAtLineStart === 1) keys.push(last[1]);
  return keys;
}

const ALLOWED = [
  "id", "purchasedAt", "isTest", "totalCost", "currency", "source", "note",
  "knownValue", "knownItems", "countedItems", "bookedItems", "factor", "items",
];

/**
 * Spalten von `public.purchases`, die den Browser NICHT erreichen dürfen.
 *
 * Die ersten zwei sind neu (0120). `import_fingerprint` reist seit `0055` auf
 * demselben Weg und wurde genauso nie gelesen — es steht hier, damit der Test
 * nicht nur die neuen Felder bewacht, sondern die Regel.
 */
const WITHHELD = [
  "client_token", "client_request_fingerprint", "import_fingerprint",
  "created_by", "updated_by",
];

describe("fetchPurchase reicht keine Datenbankzeile durch", () => {
  const body = projection("fetchPurchase");

  it("liefert genau die dreizehn benannten Felder", () => {
    expect(returnedKeys(body)).toEqual(ALLOWED);
  });

  it("und der Typ, der an die Oberfläche geht, nennt dieselben", () => {
    const type = QUERIES.slice(QUERIES.indexOf("export type PurchaseDetail = {"));
    const fields = [...type.slice(0, type.indexOf("\n};")).matchAll(/^\s{2}([A-Za-z]+)[?]?:/gm)]
      .map((m) => m[1]);
    expect(fields).toEqual(ALLOWED);
  });

  it("KEIN Spread der Rohzeile — nirgends in dieser Datei", () => {
    /*
     * Die eigentliche Prüfung. `...p`, `...root`, `...raw`, `...i`, `...r`
     * und `...data` sind die Namen, unter denen die ungefilterte Zeile in
     * dieser Datei auftritt; `queries.ts` verteilt sie an mehrere Mapper.
     */
    for (const spread of ["...p", "...root", "...raw", "...data", "...(data",
                          "...i,", "...r,", "...v"]) {
      expect(QUERIES, spread).not.toContain(spread);
    }
    /* Und generisch: überhaupt kein Objekt-Spread in dieser Datei. */
    expect(QUERIES).not.toMatch(/\{\s*\.\.\./);
  });

  it("die zurückgehaltenen Spalten kommen in der Datei nicht vor", () => {
    for (const column of WITHHELD) {
      expect(QUERIES, column).not.toContain(column);
    }
  });

  it("jedes Feld wird einzeln aus `p` gelesen, nicht gesammelt", () => {
    /* Dreizehn Zuweisungen, dreizehn Entscheidungen. */
    expect(body).toContain("id: Number(p.id)");
    expect(body).toContain("isTest: p.is_test === true");
    expect(body).toContain("totalCost: Number(p.total_cost)");
    expect(body).toContain("note: (p.note as string) ?? null");
  });
});

describe("dieselbe Regel für die Ledger-Projektion", () => {
  const body = projection("fetchLedger");

  it("fetchLedger liest ebenfalls benannte Felder", () => {
    for (const named of ["id: Number(r.id)", "totalCost: Number(r.total_cost)",
                         "isTest:", "source: String(r.source)"]) {
      expect(body, named).toContain(named);
    }
  });

  it("und reicht die Zeile nicht durch", () => {
    expect(body).not.toMatch(/\{\s*\.\.\./);
  });
});

describe("warum die Grenze in TypeScript liegt und nicht in SQL", () => {
  it("seller_purchase gibt weiter die ganze Zeile minus zwei Spalten", () => {
    /*
     * Das ist KEIN Mangel, der behoben werden müsste. Die Funktion aus `0119`
     * ist ein `to_jsonb(p)`, und sie in jeder Migration um eine neue
     * Ausnahmeliste zu erweitern hiesse, denselben Rumpf von sechzig Zeilen
     * jedes Mal neu zu schreiben. Die Positivliste oben ist die Grenze, und
     * sie ist eine Stelle statt einer wachsenden Liste.
     *
     * Diese Prüfung hält den Zusammenhang fest: SOLANGE die SQL die Zeile
     * breit zurückgibt, MUSS die Projektion eine Positivliste sein. Ändert
     * jemand die SQL, soll er hier lesen, warum.
     */
    const sql = latestFunction("seller_purchase").body;
    expect(sql).toContain("to_jsonb(p) - 'created_by' - 'updated_by'");
  });

  it("und 0120 hat zwei Spalten hinzugefügt, die dadurch mitreisen", () => {
    const sql = read("supabase/migrations/0120_purchase_states_and_idempotency.sql");
    expect(sql).toContain("add column if not exists client_token text");
    expect(sql).toContain("add column if not exists client_request_fingerprint text");
    /* Beide sind in der Projektion nicht erwähnt — siehe oben. */
    expect(ALLOWED).not.toContain("clientToken");
  });
});
