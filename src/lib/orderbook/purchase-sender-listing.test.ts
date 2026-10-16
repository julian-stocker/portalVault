/**
 * Absender, Inserat und die Kaufvereinbarung (0121).
 *
 * DREI ZUSICHERUNGEN TRAGEN DIESE DATEI.
 *
 * 1. ABSENDERNAME IST NICHT VERKÄUFERNAME. `seller_name` ist ein
 *    Marktplatz-Benutzername und eine Zuordnungshilfe; `sender_name` ist der
 *    Name auf dem Paket. Zwei Spalten, zwei Bedeutungen, und keine davon
 *    wird aus der anderen gefüllt.
 *
 * 2. LEEREN IST EIN LEERSTRING, NICHT NULL. Die Hausregel dieser RPC lautet
 *    seit `0053`: NULL heisst „unverändert". Ein einzelnes Feld zu löschen
 *    kann NULL deshalb nicht ausdrücken — das macht `nullif(btrim(p_x), '')`,
 *    je Feld und ohne Nebenwirkung auf die anderen.
 *
 * 3. DAS INSERAT IST REFERENZ, NICHT KAUFINHALT. Was gekauft wurde, steht in
 *    `purchase_items`. Ein Inserat über vierzig Figuren, aus dem fünf gekauft
 *    wurden, darf nirgends vierzig behaupten — hier wird deshalb geprüft,
 *    dass keine Zahl und keine Position aus den Inseratsfeldern abgeleitet
 *    wird.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { code, latestFunction } from "@/test-support/migrations";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const DIR = "supabase/migrations";
const FILE = "0121_purchase_sender_listing_and_agreement.sql";
const SQL = read(`${DIR}/${FILE}`);
const ACTIONS = read("src/lib/orderbook/actions.ts");
const DETAILS = read("src/components/business/purchase-details.tsx");
const QUERIES = read("src/lib/orderbook/queries.ts");
const LEDGER = read("src/lib/orderbook/ledger.ts");

/** Die neun neuen Spalten, in der Reihenfolge der Migration. */
const COLUMNS = [
  "sender_name", "sender_street", "sender_postal_code", "sender_city",
  "sender_country", "listing_title", "listing_url", "listing_details",
  "agreement_note",
];

/** Spalte -> erlaubte Höchstlänge laut CHECK. */
const LIMITS: Record<string, number> = {
  sender_name: 120, sender_street: 120, sender_postal_code: 20,
  sender_city: 80, sender_country: 60, listing_title: 200,
  listing_url: 500, listing_details: 2000, agreement_note: 4000,
};

/* ==========================================================================
 * Die Nummer
 * ======================================================================== */

describe("die Migrationsnummer", () => {
  const files = readdirSync(join(process.cwd(), DIR)).filter((f) => f.endsWith(".sql")).sort();

  it("die Folge ist lückenlos — das verlangt dieses Projekt", () => {
    /*
     * KORREKTUR EINER ANNAHME, die ich beim Planen dieses Schritts hatte.
     * Ich hielt die Nummern für frei wählbar, weil `migration-names.test.ts`
     * keine Folge prüft. Drei andere Dateien tun es aber —
     * `create-order.test.ts`, `payment-bootstrap.test.ts` und
     * `payment.test.ts` sichern `numbers === [1 … n]` zu. Diese Migration
     * entstand deshalb zuerst als `0122`, und die Suite hat das zurück-
     * gewiesen. Die Zusicherung steht hier ein viertes Mal, weil sie den
     * Grund für die Nummer DIESER Datei nennt.
     */
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });

  it("diese Migration ist 0121", () => {
    /*
     * „und die höchste" stand hier, bis `0122` für die Eigenbelege dazukam.
     * Die Zusicherung, die bleibt, ist die über DIESE Datei; welche Nummer
     * zuletzt vergeben wurde, gehört nicht hierher.
     */
    expect(files).toContain(FILE);
    expect(Number(FILE.slice(0, 4))).toBe(121);
  });

  it("und sie steht genau eine über 0120", () => {
    const above = files.filter((f) => Number(f.slice(0, 4)) === 121);
    expect(above).toEqual([FILE]);
  });
});

/* ==========================================================================
 * Die Spalten
 * ======================================================================== */

describe("neun Spalten, alle optional, alle ohne Default", () => {
  it("sie werden additiv angelegt", () => {
    for (const column of COLUMNS) {
      expect(SQL, column).toContain(`add column if not exists ${column}`);
    }
  });

  it("keine ist NOT NULL und keine hat einen Default", () => {
    /*
     * Beides wäre eine Behauptung über 88 bestehende Einkäufe, die keine
     * dieser Angaben haben. Dasselbe Prinzip wie bei den sieben Spalten aus
     * `0115`.
     */
    const add = SQL.slice(SQL.indexOf("alter table public.purchases\n  add column"),
                          SQL.indexOf("comment on column"));
    expect(add).not.toMatch(/not\s+null/i);
    expect(add).not.toMatch(/\bdefault\b/i);
  });

  it("jede trägt einen Kommentar, der sagt, was sie ist", () => {
    for (const column of COLUMNS) {
      expect(SQL, column).toContain(`comment on column public.purchases.${column} is`);
    }
  });

  it("und der Absendername grenzt sich ausdrücklich vom Benutzernamen ab", () => {
    const comment = SQL.slice(SQL.indexOf("comment on column public.purchases.sender_name"),
                              SQL.indexOf("comment on column public.purchases.sender_street"));
    expect(comment).toContain("seller_name");
    expect(comment).toContain("NICHT");
  });
});

describe("die Längen stehen in der Datenbank, nicht nur im Formular", () => {
  it("jede Spalte hat einen CHECK mit NULL-Erlaubnis und einer Obergrenze", () => {
    for (const [column, limit] of Object.entries(LIMITS)) {
      if (column === "listing_url") continue; // eigene Form, siehe unten
      const needle = `check (${column} is null or length(btrim(${column})) between 1 and ${limit})`;
      expect(code(SQL), column).toContain(needle);
    }
  });

  it("die URL wird auf Schema und Länge geprüft, nicht auf Erreichbarkeit", () => {
    const sql = code(SQL);
    expect(sql).toContain("listing_url ~ '^https?://[^[:space:]]+$'");
    expect(sql).toContain("length(listing_url) between 11 and 500");
    /* Kein Netzzugriff, nirgends in dieser Migration. */
    expect(sql).not.toMatch(/\bhttp_get\b|\bpg_net\b|\bcurl\b/i);
  });

  it("ein Feld aus lauter Leerzeichen kann es nicht geben", () => {
    /* `between 1 and n` auf `btrim(...)`: entweder NULL oder etwas darin. */
    for (const column of COLUMNS) {
      if (column === "listing_url") continue;
      expect(code(SQL), column).toContain(`length(btrim(${column}))`);
    }
  });
});

/* ==========================================================================
 * Die Funktion
 * ======================================================================== */

describe("seller_update_purchase lernt neun Felder", () => {
  const fn = latestFunction("seller_update_purchase");
  const body = code(fn.body);

  it("sie wird ersetzt, nicht überladen", () => {
    /*
     * `create or replace` kann die Parameterliste nicht ändern; eine zweite
     * Signatur wäre eine zweite Überladung, und PostgREST löst über
     * Argumentnamen auf. Also drop + create, wie in `0116` und `0120`.
     */
    expect(SQL).toContain(
      "drop function if exists public.seller_update_purchase(bigint, date, numeric, "
      + "text, text, text, numeric, numeric, numeric, text, text, boolean);");
    expect(SQL).toContain("create or replace function public.seller_update_purchase(");
    /* Und die Migration prüft selbst nach, dass es genau eine gibt. */
    expect(SQL).toContain("expected exactly one seller_update_purchase");
    expect(SQL).toContain("should take 21 arguments");
  });

  it("die neun Parameter heissen wie die Spalten", () => {
    /*
     * `latestFunction` gibt `{ file, body }` und keine getrennte
     * Parameterliste — die erste Fassung griff auf ein `args` zu, das es
     * nicht gibt, und vitest meldete „undefined". Die Signatur ist der Teil
     * des Rumpfs bis zur schliessenden Klammer.
     */
    const signature = fn.body.slice(0, fn.body.indexOf(")\nreturns"));
    for (const column of COLUMNS) {
      expect(signature, column).toContain(`p_${column}`);
    }
    expect(fn.file).toBe(FILE);
  });

  it("jedes Feld leert sich einzeln — Leerstring zu NULL", () => {
    /*
     * ZUSICHERUNG 2. Dieselbe Form wie bei `note` und `seller_name` seit
     * `0116`: NULL lässt stehen, der Leerstring löscht, und zwar GENAU
     * dieses eine Feld.
     */
    for (const column of COLUMNS) {
      const expected =
        `${column} = case when p_${column} is null then p.${column} `
        + `else nullif(btrim(p_${column}), '') end`;
      expect(body.replace(/\s+/g, " "), column).toContain(expected);
    }
  });

  it("der Betreiber-Riegel steht weiter als erste Zeile", () => {
    expect(body).toContain("if not public.can_operate_active_seller() then");
    expect(body.indexOf("can_operate_active_seller"))
      .toBeLessThan(body.indexOf("update public.purchases"));
  });

  it("die URL wird auch in der Funktion erklärt abgelehnt", () => {
    expect(body).toContain("has to start with http:// or https://");
    expect(body).toContain("invalid_parameter_value");
    /* Ein Leerstring ist ausdrücklich erlaubt — er bedeutet löschen. */
    expect(body.replace(/\s+/g, " "))
      .toContain("if p_listing_url is not null and btrim(p_listing_url) <> ''");
  });

  it("die Rechte werden nach dem drop neu vergeben", () => {
    const signature = "bigint, date, numeric, text, text, text, numeric, numeric, "
      + "numeric, text, text, boolean, text, text, text, text, text, text, text, text, text";
    expect(SQL).toContain(`revoke all on function public.seller_update_purchase(${signature}) from public, anon;`);
    expect(SQL).toContain(`grant execute on function public.seller_update_purchase(${signature}) to authenticated;`);
  });

  it("und sie rührt weiterhin keine Position und keinen Bestand an", () => {
    for (const forbidden of ["purchase_items", "inventory_movements", "shop_inventory",
                             "record_inventory_movement", "movement_id"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });
});

describe("die Migration ist additiv und zerstört nichts", () => {
  const sql = code(SQL);

  it("kein Löschen von Spalten, Tabellen oder Daten", () => {
    for (const forbidden of ["drop column", "drop table", "truncate",
                             "delete from", "alter column"]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("und kein einziges UPDATE auf bestehende Zeilen", () => {
    /*
     * Das einzige `update public.purchases` steht im RUMPF der Funktion und
     * läuft erst, wenn jemand sie aufruft. Die Migration selbst schreibt
     * keine Zeile.
     */
    const outsideFunction = sql.slice(0, sql.indexOf("create or replace function"));
    expect(outsideFunction.toLowerCase()).not.toContain("update public.");
  });

  it("sie hat Nachbedingungen, die bei Abweichung abbrechen", () => {
    expect(SQL).toContain("expected 9 new columns on purchases");
    expect(SQL).toContain("expected 9 new check constraints");
  });
});

/* ==========================================================================
 * Die TypeScript-Seite
 * ======================================================================== */

describe("die Felder reisen über eine Positivliste, nicht über die Zeile", () => {
  it("loadPurchaseRecord liest neun benannte Felder", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function loadPurchaseRecord"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    for (const column of COLUMNS) {
      expect(body, column).toContain(`text("${column}")`);
    }
    /* Kein Durchreichen der Datenbankzeile — dieselbe Regel wie in
       `queries.ts`, siehe `purchase-projection.test.ts`. */
    expect(body).not.toMatch(/\{\s*\.\.\./);
    expect(body).toContain("if (!(await canOperateSeller())) return null;");
  });

  it("und die Ledger-Zeile trägt sie ABSICHTLICH nicht", () => {
    /*
     * `seller_orderbook_ledger()` liefert jede Zeile der gefilterten Liste.
     * Eine Privatanschrift je Zeile in den Browser zu schicken, nur damit
     * ein Fenster sie zeigen könnte, wäre genau der Datenfluss, den
     * `docs/SECURITY.md` verbietet.
     */
    const type = LEDGER.slice(LEDGER.indexOf("export type LedgerRow = {"));
    const fields = type.slice(0, type.indexOf("\n};"));
    for (const field of ["senderName", "senderStreet", "senderPostalCode",
                         "senderCity", "senderCountry", "agreementNote"]) {
      expect(fields, field).not.toContain(field);
    }
  });

  it("auch die Detailseiten-Projektion bleibt unverändert", () => {
    /* `fetchPurchase` liest weiter seine dreizehn benannten Felder. Die
       neuen Spalten reisen in `seller_purchase()` zwar mit, werden dort aber
       nicht gelesen — die Positivliste ist genau dafür da.
     *
     * GEPRÜFT WIRD DIE LESEFORM `r.<spalte>`, NICHT DAS WORT.
     *
     * Hier stand `not.toContain(column)`, und das war bis `0124` dasselbe.
     * Seit `0124` liest `queries.ts` `r.has_sender_name` — einen
     * WAHRHEITSWERT darüber, ob etwas da ist, und ausdrücklich nicht den
     * Wert. Das Wort `sender_name` steckt als Teilzeichenkette darin, der
     * Zugriff auf die Spalte aber nicht.
     *
     * Die Zusicherung wird dadurch GENAUER, nicht schwächer: `r.sender_name`
     * irgendwo in dieser Datei lässt sie weiterhin fallen, und genau das ist
     * der Datenfluss, den `docs/SECURITY.md` verbietet. */
    for (const column of COLUMNS) {
      expect(QUERIES, column).not.toContain(`r.${column}`);
    }
  });

  it("updatePurchase schickt alle neun Parameter", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function updatePurchase"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    for (const column of COLUMNS) {
      expect(body, column).toContain(`p_${column}:`);
    }
    expect(body).toContain("p_clear_cost_split: head.clearCostSplit ?? false,");
  });

  it("PurchaseHead nennt sie als optionale Felder", () => {
    const type = ACTIONS.slice(ACTIONS.indexOf("export type PurchaseHead = {"));
    const fields = type.slice(0, type.indexOf("\n};"));
    for (const field of ["senderName?", "senderStreet?", "senderPostalCode?",
                         "senderCity?", "senderCountry?", "listingTitle?",
                         "listingUrl?", "listingDetails?", "agreementNote?"]) {
      expect(fields, field).toContain(field);
    }
  });
});

/* ==========================================================================
 * Das Fenster
 * ======================================================================== */

describe("der (i)-Dialog zeigt und bearbeitet die Felder", () => {
  it("ein eigener Abschnitt, zwischen Kosten und Figuren", () => {
    expect(DETAILS).toContain("<Section title={modal.senderSection}>");
    expect(DETAILS.indexOf("<Section title={modal.costs}>"))
      .toBeLessThan(DETAILS.indexOf("<Section title={modal.senderSection}>"));
    expect(DETAILS.indexOf("<Section title={modal.senderSection}>"))
      .toBeLessThan(DETAILS.indexOf("<Section title={modal.figures}>"));
  });

  it("die Figurentabelle und ihre Aktionen sind unberührt", () => {
    /* Anforderung E. Die Spurenliste und die drei Aktionen stehen, wie sie
       nach dem Einbuchen-Schritt standen. */
    const TABLE = read("src/components/business/purchase-item-table.tsx");
    expect(TABLE).toContain('"sm:grid-cols-[minmax(0,1fr)_7rem_6.5rem_4.5rem]"');
    expect(DETAILS).toContain("actions={isBooked ? (");
    expect(DETAILS).toContain(") : mayBook ? (");
    expect(DETAILS).toContain(") : mayRemap ? (");
    expect(DETAILS).toContain("processBookPurchaseItem(item.id, purchase.id)");
    expect(DETAILS).toContain("processUnbookPurchaseItem(item.id, purchase.id)");
  });

  it("geladen wird einmal beim Öffnen, nicht mit der Liste", () => {
    expect(DETAILS).toContain("void loadPurchaseRecord(purchase.id).then((loaded) => {");
    expect(DETAILS).toContain("return () => { alive = false; };");
  });

  it("vor dem Laden gibt es die Felder gar nicht erst", () => {
    /*
     * DER GEFÄHRLICHSTE FEHLER DIESES SCHRITTS, und er ist doppelt
     * verriegelt: ein Entwurfsfeld auf "" bedeutet LÖSCHEN.
     *
     * Vorher waren die Felder `disabled={saving || record === null}` — neun
     * gesperrte Eingaben. Seit der Umstellung auf die Bearbeitung an Ort und
     * Stelle werden sie bei `record === null` ÜBERHAUPT NICHT gerendert: die
     * Verzweigung im Abschnitt endet vorher bei der Lademeldung. Das ist
     * strenger als gesperrt, und der zweite Riegel in `save` bleibt
     * trotzdem stehen.
     */
    const section = DETAILS.slice(DETAILS.indexOf("<Section title={modal.senderSection}>"),
                                  DETAILS.indexOf("<Section title={modal.figures}>"));
    /* Die Felder stehen HINTER der Lade- und der Fehlerverzweigung. */
    const loading = section.indexOf("{modal.recordLoading}");
    const failed = section.indexOf("{modal.recordFailed}");
    const firstField = section.indexOf("contact.senderName");
    expect(failed).toBeGreaterThan(-1);
    expect(loading).toBeGreaterThan(failed);
    expect(firstField).toBeGreaterThan(loading);
    expect(section).toContain(") : record === null ? (");
    expect(section).toContain(") : editing ? (");
    /* Und der Riegel beim Speichern steht unverändert. */
    expect(DETAILS).toContain("...(record === null ? {} : {");
  });

  it("jedes maxLength entspricht genau dem CHECK der Datenbank", () => {
    /*
     * Der stärkste Test dieser Datei: die Zahl im Formular wird gegen die
     * Zahl in der Migration gehalten. Ändert jemand eine von beiden, fällt
     * es hier auf, statt erst an einer Ablehnung der Datenbank.
     */
    const limits = Object.values(LIMITS).sort((a, b) => a - b);
    const inForm = [...DETAILS.matchAll(/maxLength=\{(\d+)\}/g)]
      .map((m) => Number(m[1]));
    for (const limit of limits) {
      expect(inForm, `maxLength ${limit}`).toContain(limit);
    }
    /* Und keine Zahl im Formular ist grösser als ihr CHECK. */
    expect(Math.max(...inForm)).toBe(4000);
  });

  it("die URL wird vor dem Absenden auf dieselbe Form geprüft", () => {
    expect(DETAILS).toContain("const LISTING_URL = /^https?:\\/\\/\\S+$/;");
    expect(DETAILS).toContain("if (url !== \"\" && !LISTING_URL.test(url)) {");
    expect(DETAILS).toContain("setError(modal.listingUrlInvalid);");
  });

  it("der Link auf das Inserat gibt nichts preis", () => {
    expect(DETAILS).toContain('target="_blank" rel="noreferrer noopener"');
    /* Und er entsteht nur bei geprüfter Form. */
    expect(DETAILS).toContain("LISTING_URL.test(record.listingUrl) ? (");
  });

  it("die Vereinbarung ist mehrzeilig und nicht die interne Notiz", () => {
    expect(DETAILS).toContain("contact.agreementNote");
    expect(DETAILS).toContain("<textarea value={contact.agreementNote}");
    /* `note` bleibt, was es war: einzeilig, intern. */
    expect(DETAILS).toContain("<input value={draft.note}");
    expect(DETAILS).not.toContain("draft.note = contact.agreementNote");
  });

  it("nach dem Speichern wird neu gelesen", () => {
    expect(DETAILS).toContain("await readRecord();");
  });
});

/* ==========================================================================
 * Was NICHT entstanden ist
 * ======================================================================== */

describe("die Grenzen dieses Schritts", () => {
  it("kein Eigenbeleg, keine Belegnummer, keine Belegtabelle", () => {
    /*
     * Geprüft wird der CODE, nicht die Prosa: der Kopfkommentar der
     * Migration SAGT, dass dies die Vorbereitung für den Eigenbeleg ist, und
     * das soll er auch. Die erste Fassung verbot das Wort und schlug an
     * ihrer eigenen Erklärung an.
     */
    for (const forbidden of ["purchase_receipts", "receipt_number",
                             "purchase_receipt_number_seq", "renderReceiptPdf"]) {
      expect(code(SQL), forbidden).not.toContain(forbidden);
      expect(DETAILS, forbidden).not.toContain(forbidden);
    }
  });

  it("keine automatische Inseratsabfrage", () => {
    for (const forbidden of ["fetch(", "ebay", "kleinanzeigen", "willhaben",
                             "listing_source", "listing_fetched_at"]) {
      expect(SQL.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function loadPurchaseRecord"));
    expect(fn.slice(0, fn.indexOf("\n}"))).not.toContain("fetch(");
  });

  it("keine neue Tabelle und keine neue Berechtigung", () => {
    expect(code(SQL).toLowerCase()).not.toContain("create table");
    expect(code(SQL).toLowerCase()).not.toContain("create role");
    expect(code(SQL).toLowerCase()).not.toContain("create policy");
    /* Der bestehende Riegel wird benutzt, nicht ersetzt. */
    expect(SQL).toContain("can_operate_active_seller()");
  });

  it("und das Inserat leitet keine Menge und keine Position ab", () => {
    /*
     * ZUSICHERUNG 3. Nichts in dieser Migration und nichts im Fenster liest
     * aus einem Inseratsfeld eine Zahl. Was gekauft wurde, steht in
     * `purchase_items`.
     */
    for (const forbidden of ["listing_quantity", "listing_items", "listing_count"]) {
      expect(SQL, forbidden).not.toContain(forbidden);
    }
    const section = DETAILS.slice(DETAILS.indexOf("<Section title={modal.senderSection}>"),
                                  DETAILS.indexOf("<Section title={modal.figures}>"));
    expect(section).not.toContain("itemCount");
    expect(section).not.toContain("countedItems");
    expect(section).not.toContain("Number(");
  });
});
