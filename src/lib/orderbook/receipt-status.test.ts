/**
 * Die zwei Belegspalten der Orderbuch-Übersicht (`0124`).
 *
 * WAS HIER GEPRÜFT WIRD, UND WARUM GERADE DAS
 *
 * Die Farbe einer Zelle ist eine Behauptung über einen Einkauf, und zwei der
 * möglichen Behauptungen sind gefährlich:
 *
 *   „grün"  gelesen als „steuerlich in Ordnung"
 *   „grau"  gelesen als „es gibt keinen Beleg", wo es einen gibt
 *
 * Gegen das erste hilft nur Text — jeder Tooltip trägt den Vorbehalt, auch
 * der grüne. Gegen das zweite hilft ein vierter Zustand, und den gibt es
 * genau deshalb: `unknown` ist keine Antwort und sieht auch nicht wie eine
 * aus. Beides hält diese Datei fest.
 *
 * Dazu die Wahrheitstabelle über alle Kombinationen, die Nullwerte, der
 * historische Einkauf — und die strukturellen Zusicherungen an `0124`: dass
 * kein Absenderwert in die Übersicht projiziert wird, dass der Vergleich die
 * BESTEHENDE Fingerabdruck-Funktion benutzt, und dass der Rumpf von `0119`
 * ausser an drei Stellen unangetastet ist.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { code, latestFunction, migrationSource } from "@/test-support/migrations";
import {
  canIssueReceipt, dataStatus, dataTone, receiptStatus, receiptTone,
  type ReceiptFacts,
} from "@/lib/orderbook/receipt-status";

const FILE_0124 = "0124_orderbook_receipt_status.sql";
const sql0124 = migrationSource(FILE_0124);
const exec0124 = code(sql0124);
/*
 * DER FUNKTIONSRUMPF ALLEIN — für die Zusicherungen über das, was PROJIZIERT
 * wird.
 *
 * Hier stand zuerst die ganze Migration, und der Test fiel über seinen
 * eigenen Wächter: der Nachbedingungsblock enthält die Zeichenkette
 * `'content_fingerprint'`, weil er sie verbietet. Eine Zusicherung über die
 * Projektion gehört an die Projektion.
 */
const ledgerFn = latestFunction("seller_orderbook_ledger");
const projection = code(ledgerFn.body);
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const LEDGER = read("src/components/business/orderbook-ledger.tsx");
const TABLE = read("src/components/business/ledger-table.tsx");
const QUERIES = read("src/lib/orderbook/queries.ts");
const LEDGER_TYPES = read("src/lib/orderbook/ledger.ts");
const DE = read("src/lib/i18n/de.ts");

/** Ein Einkauf, der alles hat: ausstellbar, Absender vollständig, Beleg stimmt. */
const good: ReceiptFacts = {
  statusKnown: true,
  isTest: false,
  purchasedAt: "2026-09-01",
  itemCount: 3,
  hasSenderName: true,
  hasSenderStreet: true,
  hasSenderPostalCode: true,
  hasSenderCity: true,
  hasOrigin: true,
  hasAgreement: true,
  receiptNumber: "SI-E-2026-000001",
  receiptIssuedAt: "2026-09-02T10:00:00+00:00",
  receiptRevision: 1,
  receiptStale: false,
};
const f = (over: Partial<ReceiptFacts>): ReceiptFacts => ({ ...good, ...over });

/* ==========================================================================
 * 1. Was die Ausstellung technisch verlangt
 * ======================================================================== */

describe("ausstellbar ist genau das, was die Datenbank verlangt", () => {
  /*
   * DIE DREI ZEILENBEDINGUNGEN AUS `seller_issue_purchase_receipt`, nicht
   * mehr und nicht weniger. Die vierte — eine vollständige Geschäftsadresse
   * des Shops — gilt shopweit und gehört nicht in eine Spalte, die
   * achtundachtzig Mal dasselbe anzeigen würde.
   */
  it("ein Testeinkauf bekommt keinen Beleg", () => {
    expect(canIssueReceipt(f({ isTest: true }))).toBe(false);
  });

  it("ohne Kaufdatum geht es nicht", () => {
    expect(canIssueReceipt(f({ purchasedAt: null }))).toBe(false);
  });

  it("ohne Position geht es nicht", () => {
    expect(canIssueReceipt(f({ itemCount: 0 }))).toBe(false);
  });

  it("und Absenderdaten verlangt die Datenbank NICHT", () => {
    /* Der ganze Grund für drei Farben statt zwei: ohne Absender entsteht der
       Beleg anstandslos, er dokumentiert nur nicht, von wem gekauft wurde. */
    const bare = f({
      hasSenderName: false, hasSenderStreet: false,
      hasSenderPostalCode: false, hasSenderCity: false,
      hasOrigin: false, hasAgreement: false,
    });
    expect(canIssueReceipt(bare)).toBe(true);
    expect(dataStatus(bare).status).toBe("partial");
  });
});

/* ==========================================================================
 * 2. Der Datenstatus, über alle Kombinationen
 * ======================================================================== */

describe("der Datenstatus", () => {
  it("grün, wenn ausstellbar und der Absender vollständig ist", () => {
    expect(dataStatus(good).status).toBe("complete");
    expect(dataTone("complete")).toBe("complete");
  });

  it("grün verlangt KEIN Land", () => {
    /* Entschieden: bei einem deutschen Privatankauf ist das Land implizit,
       und der Zeichner druckt es nur, wenn es da ist. `sender_country` wird
       deshalb gar nicht projiziert. */
    expect(Object.keys(good)).not.toContain("hasSenderCountry");
    expect(exec0124).not.toContain("has_sender_country");
  });

  it("grün verlangt weder Inserat noch Kaufvereinbarung", () => {
    const noExtras = f({ hasOrigin: false, hasAgreement: false });
    expect(dataStatus(noExtras).status).toBe("complete");
    /* Sie stehen trotzdem im Tooltip — als Hinweis, nicht als Mangel. */
    expect(dataStatus(noExtras).reasons).toEqual(["noOrigin", "noAgreement"]);
  });

  it("orange, wenn der Absendername fehlt", () => {
    const r = dataStatus(f({ hasSenderName: false }));
    expect(r.status).toBe("partial");
    expect(r.reasons).toContain("noSenderName");
    expect(dataTone("partial")).toBe("partial");
  });

  it("orange mit „unvollständig“, wenn die Anschrift angefangen ist", () => {
    const r = dataStatus(f({ hasSenderCity: false }));
    expect(r.status).toBe("partial");
    expect(r.reasons).toContain("addressPartial");
    expect(r.reasons).not.toContain("noAddress");
  });

  it("orange mit „fehlt“, wenn von der Anschrift nichts da ist", () => {
    const r = dataStatus(f({
      hasSenderStreet: false, hasSenderPostalCode: false, hasSenderCity: false,
    }));
    expect(r.reasons).toContain("noAddress");
    expect(r.reasons).not.toContain("addressPartial");
  });

  it("jede einzelne fehlende Adresszeile macht aus grün orange", () => {
    for (const key of ["hasSenderStreet", "hasSenderPostalCode", "hasSenderCity"] as const) {
      expect(dataStatus(f({ [key]: false })).status, key).toBe("partial");
    }
  });

  it("grau bei Testeinkauf, fehlendem Datum oder leerer Position", () => {
    expect(dataStatus(f({ isTest: true })).status).toBe("blocked");
    expect(dataStatus(f({ purchasedAt: null })).status).toBe("blocked");
    expect(dataStatus(f({ itemCount: 0 })).status).toBe("blocked");
    expect(dataTone("blocked")).toBe("blocked");
  });

  it("und grau nennt jeden Grund, nicht nur den ersten", () => {
    const r = dataStatus(f({ isTest: true, purchasedAt: null, itemCount: 0 }));
    expect(r.reasons).toEqual(["test", "noDate", "noItems"]);
  });

  it("grau schlägt orange: ein Testeinkauf mit vollständigem Absender bleibt grau", () => {
    expect(dataStatus(f({ isTest: true })).status).toBe("blocked");
  });

  it("ein historischer Einkauf ohne Datum ist grau, nicht orange", () => {
    /* Die dreizehn `#REF!`-Gruppen der Arbeitsmappe tragen kein Datum (0058).
       Sie sind Bestand und bleiben es — aber ein Beleg lässt sich über sie
       nicht ausstellen, und die Spalte sagt das. */
    const historical = f({ purchasedAt: null, itemCount: 54, hasSenderName: false });
    expect(dataStatus(historical).status).toBe("blocked");
    expect(dataStatus(historical).reasons).toEqual(["noDate"]);
  });

  it("negative oder fehlende Positionszahlen gelten als keine", () => {
    expect(dataStatus(f({ itemCount: -1 })).status).toBe("blocked");
  });
});

/* ==========================================================================
 * 3. Der Belegstatus, und der vierte Zustand
 * ======================================================================== */

describe("der Belegstatus", () => {
  it("grün, wenn ein Beleg da ist und die Fingerabdrücke stimmen", () => {
    expect(receiptStatus(good)).toBe("match");
    expect(receiptTone("match")).toBe("complete");
  });

  it("orange, wenn belegrelevante Daten abweichen", () => {
    expect(receiptStatus(f({ receiptStale: true }))).toBe("stale");
    expect(receiptTone("stale")).toBe("partial");
  });

  it("grau, wenn kein Beleg ausgestellt ist", () => {
    const none = f({
      receiptNumber: null, receiptIssuedAt: null, receiptRevision: null, receiptStale: null,
    });
    expect(receiptStatus(none)).toBe("none");
    expect(receiptTone("none")).toBe("blocked");
  });

  /*
   * DER FALL, DER DIESE SPALTE SONST ZUR LÜGE MACHT.
   */
  it("ein vorhandener Beleg ohne Vergleich ist UNBEKANNT — nie grün", () => {
    const s = receiptStatus(f({ receiptStale: null }));
    expect(s).toBe("unknown");
    expect(s).not.toBe("match");
  });

  it("und er ist auch nie „kein Beleg“", () => {
    expect(receiptStatus(f({ receiptStale: null }))).not.toBe("none");
  });

  it("ohne die Migration ist alles unbekannt, nicht „kein Beleg“", () => {
    /*
     * GEGEN EINE DATENBANK AUF `0123` liefert der Ledger diese Felder nicht.
     * `receiptNumber` ist dann null — und das heisst „nicht gefragt", nicht
     * „mit nein beantwortet". Ein vorhandener Beleg, der als nicht vorhanden
     * dargestellt wird, wäre die irreführendste Antwort von allen.
     */
    const old = f({
      statusKnown: false,
      receiptNumber: null, receiptIssuedAt: null, receiptRevision: null, receiptStale: null,
      hasSenderName: false, hasSenderStreet: false,
      hasSenderPostalCode: false, hasSenderCity: false,
      hasOrigin: false, hasAgreement: false,
    });
    expect(receiptStatus(old)).toBe("unknown");
    expect(receiptTone("unknown")).toBe("unknown");
  });

  it("der Unbekannt-Ton ist nicht der Grau-Ton", () => {
    /* Grau heisst „beantwortet, und die Antwort ist nein". Unbekannt heisst
       „nicht beantwortet". Zwei verschiedene Aussagen, zwei Darstellungen. */
    expect(receiptTone("unknown")).not.toBe(receiptTone("none"));
    expect(dataTone("unknown")).not.toBe(dataTone("blocked"));
  });

  it("aber der Datenstatus sagt vor der Migration, was er sagen kann", () => {
    /*
     * Ein Testeinkauf ist auch ohne `0124` ein Testeinkauf: `is_test`,
     * `purchased_at` und `item_count` liefert der Ledger seit `0063`. Nur die
     * Unterscheidung orange/grün braucht die neuen Felder.
     */
    expect(dataStatus(f({ statusKnown: false, isTest: true })).status).toBe("blocked");
    expect(dataStatus(f({ statusKnown: false, purchasedAt: null })).status).toBe("blocked");
    expect(dataStatus(f({ statusKnown: false })).status).toBe("unknown");
    expect(dataStatus(f({ statusKnown: false })).reasons).toEqual([]);
  });
});

/* ==========================================================================
 * 4. Migration 0124 — was sie projiziert und was nicht
 * ======================================================================== */

describe("0124 erweitert den Ledger, ohne ihn umzubauen", () => {
  it("steht auf ihrer eigenen Nummer und ändert keine bestehende Migration", () => {
    expect(sql0124).toContain("0124");
    /* Sie fasst keine Tabelle an. */
    expect(exec0124).not.toMatch(/^\s*alter table/im);
    expect(exec0124).not.toMatch(/^\s*create table/im);
    expect(exec0124).not.toMatch(/^\s*(insert|update|delete|truncate)\s/im);
  });

  it("ersetzt die Funktion bei unveränderter Signatur", () => {
    expect(exec0124).toContain("create or replace function public.seller_orderbook_ledger(");
    expect(exec0124).not.toContain("drop function if exists public.seller_orderbook_ledger");
    expect(exec0124).toContain(
      "revoke all on function public.seller_orderbook_ledger("
      + "integer, integer, text, boolean, text) from public, anon;");
  });

  it("verlangt 0121 und 0122 und die 0119-Fassung", () => {
    expect(exec0124).toContain("0124 setzt 0122 voraus");
    expect(exec0124).toContain("0124 setzt 0121 voraus");
    expect(exec0124).toContain("liegt nicht in der 0119-Fassung vor");
  });

  it("die jüngste Fassung des Ledgers kommt aus 0124", () => {
    expect(ledgerFn.file).toBe(FILE_0124);
  });

  it("projiziert elf Felder", () => {
    for (const key of ["status_known", "has_sender_name", "has_sender_street",
                       "has_sender_postal_code", "has_sender_city", "has_origin",
                       "has_agreement", "receipt_number", "receipt_issued_at",
                       "receipt_revision", "receipt_stale"]) {
      expect(projection, key).toContain(`'${key}'`);
    }
  });

  /*
   * DIE WICHTIGSTE ZUSICHERUNG DIESER DATEI.
   */
  it("und KEINEN Absendernamen und KEINE Anschrift", () => {
    for (const key of ["sender_name", "sender_street", "sender_postal_code",
                       "sender_city", "sender_country", "agreement_note",
                       "listing_details"]) {
      expect(projection, key).not.toContain(`'${key}', m.`);
    }
    /* Und der Fingerabdruck bleibt ebenfalls drinnen. */
    expect(projection).not.toContain("'content_fingerprint'");
    expect(projection).not.toContain("'receipt_fingerprint'");
  });

  it("benutzt die BESTEHENDE Fingerabdruck-Funktion statt einer zweiten", () => {
    /* Zwei Implementierungen desselben Hashes laufen auseinander und warnen
       danach entweder falsch oder falsch nicht. */
    expect(exec0124).toContain("public.purchase_receipt_fingerprint(p_purchase_id)");
    expect(exec0124).not.toContain("create or replace function public.purchase_receipt_fingerprint");
    expect(exec0124).not.toContain("sha256(");
  });

  it("rechnet den Vergleich nur für Zeilen mit Beleg", () => {
    expect(exec0124).toContain("case when m.receipt_id is null then null");
  });

  it("und der Ledger ruft die Schutzhülle, nicht den Fingerabdruck direkt", () => {
    /*
     * DER UNTERSCHIED ZWISCHEN „ZWEI SPALTEN UNBEKANNT" UND „ORDERBUCH LEER".
     *
     * Ein direkter Aufruf liesse eine Ausnahme aus dem Fingerabdruck durch den
     * Ledger durch; der RPC schlüge fehl, und `fetchLedger` macht daraus
     * `return empty` — eine Seite ohne Zeilen, ohne Summen, ohne Filter. Die
     * Hülle fängt es und gibt NULL, und NULL ist `unknown`.
     */
    expect(projection).toContain("public.purchase_receipt_stale(m.id, m.receipt_fingerprint)");
    expect(projection).not.toContain("purchase_receipt_fingerprint");
  });

  it("nimmt den Beleg am Ende der Korrekturkette", () => {
    expect(exec0124).toContain("where s.supersedes_id = r.id");
    expect(exec0124).toContain("order by r.revision desc");
    expect(exec0124).toContain("left join lateral");
  });

  it("und fasst keinen ausgestellten Beleg an", () => {
    expect(exec0124).not.toMatch(/insert\s+into\s+public\.purchase_receipts/i);
    expect(exec0124).not.toMatch(/update\s+public\.purchase_receipts/i);
    expect(exec0124).not.toMatch(/delete\s+from\s+public\.purchase_receipts/i);
  });

  it("die Nachbedingungen prüfen, dass Filter, Summen und Sortierung bleiben", () => {
    for (const kept of ["p_undated", "as damaged_items", "as is_open",
                        "order by m.purchased_at desc nulls last",
                        "public.purchase_market_value(p.id) v",
                        "s.display_name_override ilike"]) {
      expect(exec0124, kept).toContain(kept);
    }
    expect(exec0124).toContain("der Rumpf hat % verloren");
  });

  it("und dass die Funktion lesend und einfach bleibt", () => {
    expect(exec0124).toContain("ist nicht mehr stable");
    expect(exec0124).toContain("ist mehrfach überladen");
    expect(exec0124).toContain("anon darf den Ledger ausführen");
  });
});

/* ==========================================================================
 * 5. Die Leseseite und die Oberfläche
 * ======================================================================== */

describe("der Weg von der Datenbank in die Zelle", () => {
  it("queries.ts liest den Marker und die zehn Felder defensiv", () => {
    expect(QUERIES).toContain("statusKnown: r.status_known === true");
    expect(QUERIES).toContain("hasSenderName: r.has_sender_name === true");
    /* `receiptStale` behält seine drei Zustände — `=== true ? true : === false
       ? false : null`, nicht `Boolean(...)`, sonst wäre „unbekannt" ein
       stilles „stimmt überein". */
    expect(QUERIES).toContain("receiptStale: r.receipt_stale === true ? true");
    expect(QUERIES).toContain(": r.receipt_stale === false ? false");
  });

  it("die Übersicht hat zwei neue Spalten, Kopf und Zelle", () => {
    expect(DE).toContain('data: "Daten"');
    expect(DE).toContain('receipt: "Beleg"');
    expect(LEDGER).toContain("{copy.columns.data}");
    expect(LEDGER).toContain("{copy.columns.receipt}");
    expect(LEDGER).toContain("tone={dataTone(dataStatus(purchase).status)}");
    expect(LEDGER).toContain("tone={receiptTone(receiptStatus(purchase))}");
  });

  it("die zehnte Spur passt in den erklärten Boden", () => {
    const tracks = /const PURCHASE_COLUMNS =\s*\n?\s*"([^"]*)"/.exec(LEDGER)![1];
    const floor = Number(/const PURCHASE_MIN_WIDTH = "([\d.]+)rem"/.exec(LEDGER)![1]);
    const parts = tracks.replace(/minmax\(([^)]*)\)/g, (m) => m.replace(/,\s*/g, ","))
      .split(/\s+/).filter(Boolean);
    expect(parts).toHaveLength(10);
    const sum = parts.reduce((t, p) => {
      const m = /minmax\(\s*([\d.]+)rem/.exec(p) ?? /([\d.]+)rem/.exec(p);
      return t + (/minmax\(\s*0/.test(p) ? 0 : Number(m?.[1] ?? 0));
    }, 0);
    const needed = sum + 0.75 * (parts.length - 1) + 1.5;
    expect(floor, `braucht ${needed}rem`).toBeGreaterThanOrEqual(needed);
  });

  it("und der Boden bleibt breiter als jedes Telefon", () => {
    const floor = Number(/const PURCHASE_MIN_WIDTH = "([\d.]+)rem"/.exec(LEDGER)![1]) * 16;
    expect(floor).toBeGreaterThan(414);
  });

  it("die beiden neuen Spuren stehen vor „Lager“", () => {
    const tracks = /const PURCHASE_COLUMNS =\s*\n?\s*"([^"]*)"/.exec(LEDGER)![1];
    /* Zwei 3,5rem-Spuren direkt vor der 7,5rem-Zustandsspur. */
    expect(tracks).toContain("3.5rem 3.5rem 7.5rem 1.5rem");
    /* Und in der Kopfzeile in derselben Ordnung. */
    const head = LEDGER.indexOf("{copy.columns.data}");
    expect(head).toBeLessThan(LEDGER.indexOf("{copy.columns.receipt}"));
    expect(LEDGER.indexOf("{copy.columns.receipt}"))
      .toBeLessThan(LEDGER.indexOf("{copy.columns.progress}"));
  });
});

/* ==========================================================================
 * 6. Tooltip und Barrierefreiheit
 * ======================================================================== */

describe("der Glyph ist die Abkürzung, nicht die Information", () => {
  it("StatusDot trägt Farbe, Zeichen UND Wörter", () => {
    expect(TABLE).toContain('role="img"');
    expect(TABLE).toContain("title={label}");
    expect(TABLE).toContain("aria-label={label}");
    /* Vier Zeichen für vier Zustände — Farbe allein scheidet aus, wer sie
       nicht unterscheidet. */
    for (const glyph of ["●", "◐", "?", "○"]) {
      expect(TABLE, glyph).toContain(glyph);
    }
  });

  it("der Unbekannt-Zustand hat sein eigenes Zeichen und seinen eigenen Ton", () => {
    /* Zuordnung als ausgeschriebene Tabelle, wie bei `TONE` in
       `sale-indicator.tsx` — Tailwind findet Klassen durch Lesen, und ein
       zur Laufzeit gebauter Name wird nie erzeugt. */
    expect(TABLE).toContain('unknown: "?"');
    expect(TABLE).toContain("const DOT_GLYPH: Record<StatusDotTone, string>");
    expect(TABLE).toContain("const DOT_TONE: Record<StatusDotTone, string>");
  });

  it("und kein --accent: Gold ist Besitz und Marke, nicht Zustand", () => {
    /* `src/lib/design/roles.test.ts` hält das über jede Komponentendatei
       fest, und der erste Entwurf dieser Zelle ist genau daran gescheitert.
       Bernstein ist die Farbe, die das Verkaufsbuch fuer „teilweise" schon
       benutzt. */
    expect(TABLE).not.toMatch(/\b(?:bg|text|ring|border)-accent\b/);
    expect(TABLE).toContain('partial: "text-amber-400"');
    expect(TABLE).toContain('complete: "text-emerald-400"');
  });

  it("jeder Datentooltip trägt den rechtlichen Vorbehalt — auch der grüne", () => {
    expect(DE).toContain("Keine Aussage über steuerliche oder rechtliche Anerkennung");
    expect(LEDGER).toContain("parts.push(rs.noLegalClaim);");
    /* Und er steht NICHT in einem Zweig, sondern hinter allen. */
    const fn = LEDGER.slice(LEDGER.indexOf("function dataTitle"),
                            LEDGER.indexOf("function receiptTitle"));
    expect(fn).toContain("rs.noLegalClaim");
    expect(fn.indexOf("rs.noLegalClaim")).toBeGreaterThan(fn.indexOf("if (status === \"unknown\")"));
  });

  it("orange in der Datenspalte sagt zuerst, dass es GEHT", () => {
    /* Sonst liest der Betreiber eine Sperre, wo eine Empfehlung steht. */
    expect(DE).toContain('partial: "Eigenbeleg möglich, dokumentiert aber den Absender nicht"');
  });

  it("orange in der Belegspalte sagt, dass der Beleg unverändert bleibt", () => {
    expect(DE).toContain("Der ausgestellte Beleg bleibt unverändert");
    expect(LEDGER).toContain("if (status === \"stale\") parts.push(rs.staleKept);");
  });

  it("und der Unbekannt-Tooltip erklärt sich", () => {
    expect(DE).toContain('unknown: "Zustand nicht ermittelbar"');
    expect(DE).toContain("Diese Datenbank liefert den Belegzustand nicht");
  });

  it("die Belegnummer steht auch im Unbekannt-Fall da", () => {
    /* Genau der Zustand, den der Betreiber nicht als „kein Beleg" sehen
       soll: es gibt einen, nur der Vergleich war nicht zu bilden. */
    const fn = LEDGER.slice(LEDGER.indexOf("function receiptTitle"));
    const numberAt = fn.indexOf("rs.issued(row.receiptNumber");
    const statusAt = fn.indexOf("status === \"none\" ? rs.none");
    expect(numberAt).toBeGreaterThan(0);
    expect(numberAt).toBeLessThan(statusAt);
  });
});

/* ==========================================================================
 * 7. Die Schutzhülle: aus „kaputt" wird „unbekannt", nicht „leeres Orderbuch"
 * ======================================================================== */

describe("purchase_receipt_stale begrenzt einen Vergleichsfehler auf die Zelle", () => {
  const stale = exec0124.slice(
    exec0124.indexOf("create or replace function public.purchase_receipt_stale("),
    exec0124.indexOf("create or replace function public.seller_orderbook_ledger("));

  it("sie existiert und nimmt die gespeicherte Prüfsumme mit", () => {
    expect(stale).toContain("p_purchase_id bigint");
    expect(stale).toContain("p_stored      text");
    expect(stale).toContain("returns boolean");
  });

  it("stable — sonst dürfte der stable Ledger sie nicht rufen", () => {
    expect(stale).toContain("\nstable\n");
    expect(stale).not.toContain("\nvolatile\n");
  });

  it("security definer mit leerem search_path", () => {
    expect(stale).toContain("security definer");
    expect(stale).toContain("set search_path = ''");
  });

  it("sie RUFT den Fingerabdruck und ersetzt ihn nicht", () => {
    expect(stale).toContain("public.purchase_receipt_fingerprint(p_purchase_id)");
    expect(stale).not.toContain("sha256");
    expect(stale).not.toContain("jsonb_build_object");
  });

  it("der Ausnahmezweig gibt NULL zurück — nicht true und nicht false", () => {
    /*
     * `true` wäre eine Abweichungsmeldung ohne Grundlage, `false` eine
     * Unbedenklichkeitsbescheinigung ohne Grundlage. Die zweite wäre die
     * schlimmere, weil sie dem Betreiber einen stimmigen Beleg zusichert,
     * den niemand geprüft hat.
     */
    expect(stale).toContain("when others then");
    expect(stale).toContain("return null");
    const zweig = stale.slice(stale.indexOf("when others then"));
    expect(zweig).not.toContain("return true");
    expect(zweig).not.toContain("return false");
  });

  it("und bekommt für niemanden ein EXECUTE-Recht", () => {
    expect(exec0124).toContain(
      "revoke all on function public.purchase_receipt_stale(bigint, text)");
    expect(exec0124).toContain("from public, anon, authenticated;");
    expect(exec0124).not.toContain(
      "grant execute on function public.purchase_receipt_stale");
  });

  it("die Nachbedingung prüft den ACL und nicht nur has_function_privilege", () => {
    /*
     * EIN NULL-ACL HEISST NICHT „KEINE RECHTE", SONDERN „STANDARDRECHTE" —
     * und der Standard für eine Funktion ist EXECUTE für PUBLIC. Erst das
     * `revoke` materialisiert den ACL. `has_function_privilege` allein hätte
     * diesen Zustand nicht gezeigt.
     */
    expect(exec0124).toContain("der Standard waere EXECUTE fuer PUBLIC");
    expect(exec0124).toContain("aclexplode(p.proacl)");
    expect(exec0124).toContain("a.grantee <> p.proowner");
  });

  it("und `public` wird NICHT als Rolle abgefragt", () => {
    /*
     * `has_function_privilege('public', …)` bricht mit `role "public" does
     * not exist` ab: `public` ist ein Pseudo-Empfänger im ACL, kein Eintrag
     * in `pg_roles`. Genau das stand hier und wäre auf Staging gescheitert.
     */
    const code0124 = exec0124.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code0124).not.toContain("has_function_privilege('public'");
    expect(code0124).toContain("array['anon', 'authenticated']");
  });

  it("service_role gilt NICHT als Fehler — das hätte 0124 abgebrochen", () => {
    /*
     * SUPABASE VERGIBT EXECUTE AUTOMATISCH AN DREI ROLLEN.
     *
     * Die Default-Privileges im Schema `public` geben jeder neu erzeugten
     * Funktion EXECUTE für `anon`, `authenticated` und `service_role`. Das
     * `revoke` in `0124` nimmt zwei davon zurück; `service_role` bleibt —
     * ausdrücklich, wie bei `purchase_market_value` (`0053`, `0116`) und bei
     * `purchase_receipt_fingerprint` nach `0125`.
     *
     * Hier stand `a.grantee <> p.proowner` allein. Das hätte die Migration
     * nach dem `create` an ihrer eigenen Nachbedingung abgebrochen.
     */
    expect(exec0124).toContain("a.grantee::regrole::text <> 'service_role'");
    expect(exec0124).toContain("a.grantee = 0");
  });

  it("und PUBLIC bleibt in jedem Fall ein Verstoß", () => {
    /* `a.grantee = 0` ist PUBLIC — kein Rollenname, deshalb über die OID. */
    const block = exec0124.slice(exec0124.indexOf("purchase_receipt_stale liegt ein unerwartetes") - 900);
    expect(block).toContain("a.grantee = 0");
  });

  it("der search_path wird auf Existenz UND Leerheit geprüft", () => {
    /*
     * Hier stand `is distinct from 'search_path='`. PostgreSQL legt den
     * leeren search_path zitiert ab (`search_path=""`), also hätte `0124` die
     * Hülle angelegt und sich danach selbst abgebrochen. Ein Präfixvergleich
     * allein würde dagegen `search_path=public` durchlassen — deshalb beides.
     */
    expect(exec0124).toContain("not like 'search\\_path=%'");
    expect(exec0124).toContain("keinen LEEREN search_path");
    expect(exec0124).not.toContain("is distinct from 'search_path='");
  });

  it("der Eigentümerkontext wird geprüft, nicht angenommen", () => {
    /*
     * Eine `security definer`-Kette trägt nur, solange der Rufer Eigentümer
     * des Gerufenen ist — darauf ruht, dass die Hülle ohne ein einziges
     * `grant` erreichbar ist.
     */
    expect(exec0124).toContain("count(distinct p.proowner)");
    expect(exec0124).toContain("nicht denselben Eigentuemer");
  });

  it("und die bestehende Fingerabdruck-Funktion bleibt unangetastet", () => {
    expect(exec0124).not.toContain("drop function if exists public.purchase_receipt_fingerprint");
    expect(exec0124).not.toContain("create or replace function public.purchase_receipt_fingerprint");
    expect(exec0124).not.toContain("alter function public.purchase_receipt_fingerprint");
  });
});

describe("und NULL kommt im Frontend zuverlässig als unbekannt an", () => {
  it("Beleg vorhanden, Vergleich NULL → unknown", () => {
    /* Die Form, die ein gefangener Vergleichsfehler erzeugt. */
    expect(receiptStatus(f({ receiptStale: null }))).toBe("unknown");
  });

  it("und NIE als stimmt-überein", () => {
    expect(receiptStatus(f({ receiptStale: null }))).not.toBe("match");
  });

  it("und NIE als kein-Beleg", () => {
    expect(receiptStatus(f({ receiptStale: null }))).not.toBe("none");
  });

  it("der Leser macht aus einem fehlenden Feld null, nicht false", () => {
    /*
     * `Boolean(undefined)` wäre `false` — und `false` heisst „stimmt
     * überein". Genau deshalb steht in `queries.ts` eine dreistufige
     * Abfrage und kein Cast.
     */
    expect(QUERIES).toContain("receiptStale: r.receipt_stale === true ? true");
    expect(QUERIES).toContain(": r.receipt_stale === false ? false");
    expect(QUERIES).toContain("      : null,");
    expect(QUERIES).not.toContain("Boolean(r.receipt_stale)");
  });

  it("der Ton von unknown ist nicht der von match und nicht der von none", () => {
    expect(receiptTone("unknown")).not.toBe(receiptTone("match"));
    expect(receiptTone("unknown")).not.toBe(receiptTone("none"));
  });

  it("und die Zelle bekommt ein eigenes Zeichen dafür", () => {
    expect(TABLE).toContain('unknown: "?"');
  });
});

/* ==========================================================================
 * 8. Kommentare sind kein SQL — der Fehlalarm, der 0124 abgebrochen hat
 * ======================================================================== */

/**
 * WAS HIER SCHIEFGING, UND WARUM KEIN TEST ES SAH.
 *
 * `0124` brach beim ersten Staging-Versuch ab:
 *
 *   P0001: 0124 Abbruch: der Ledger ruft den Fingerabdruck direkt
 *
 * Der Ledger tat das nicht. Sein Rumpf enthält `purchase_receipt_fingerprint`
 * genau einmal — in einem Kommentar, der erklärt, warum er ihn NICHT direkt
 * ruft. `pg_get_functiondef` liefert den Rumpf samt Kommentaren, und
 * `position(… in v_def)` kann Prosa nicht von Code unterscheiden.
 *
 * Mein Test prüfte dieselbe Aussage über den falschen Text: `code()` entfernt
 * Kommentare, also war `projection` sauber und die Zusicherung grün — während
 * die Migration im Rohtext suchte. Zusicherung und Nachbedingung haben
 * verschiedene Dinge gemessen und sich gegenseitig bestätigt gefühlt.
 *
 * Die Tests hier prüfen deshalb nicht mehr nur das Ergebnis, sondern das
 * WERKZEUG: dass die Nachbedingung kommentarfrei sucht, und dass von ihren
 * Suchbegriffen keiner sein Ergebnis ändert, wenn man die Kommentare entfernt.
 */

/** Dieselbe Scheibe, die `pg_get_functiondef` liefert: Kopf plus Rumpf, roh. */
const ledgerRaw = ledgerFn.body;

/** Und dieselbe Behandlung, die `0124` darauf anwendet. */
const ledgerStripped = ledgerRaw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/--.*/g, "");

/** Die Suchbegriffe, die die Nachbedingung tatsächlich verwendet. */
function postconditionNeedles(): { needle: string; mustExist: boolean }[] {
  const block = sql0124.slice(sql0124.indexOf("-- 2. Nachbedingungen"));
  const out: { needle: string; mustExist: boolean }[] = [];

  for (const m of block.matchAll(/position\('((?:[^']|'')*)' in v_code\)\s*(=|>)\s*0/g)) {
    out.push({ needle: m[1].replace(/''/g, "'"), mustExist: m[2] === "=" });
  }
  const liste = (marker: string, wrap: (s: string) => string, mustExist: boolean) => {
    const i = block.indexOf(marker);
    if (i === -1) return;
    const j = block.indexOf("] loop", i);
    for (const m of block.slice(i, j).matchAll(/'((?:[^']|'')*)'/g)) {
      const v = m[1].replace(/''/g, "'");
      if (v && !v.startsWith("0124")) out.push({ needle: wrap(v), mustExist });
    }
  };
  liste("Die elf neuen Schlüssel", (s) => `'${s}'`, true);
  liste("ALLES ANDERE UNVERÄNDERT", (s) => s, true);
  liste("KEIN ABSENDERWERT WIRD PROJIZIERT", (s) => `'${s}', m.`, false);
  return out;
}
const needles = postconditionNeedles();

describe("die Nachbedingung von 0124 sucht kommentarfrei", () => {
  it("sie entfernt Block- und Zeilenkommentare, bevor sie etwas sucht", () => {
    expect(exec0124).toContain("v_code := regexp_replace(v_def,");
    expect(exec0124).toContain("v_code := regexp_replace(v_code, '--.*', '', 'gn')");
  });

  it("und keine Inhaltsprüfung liest mehr den Rohtext", () => {
    /*
     * `v_def` darf nur noch für die Existenzprüfung und als Eingang des
     * Strippens vorkommen — nie in einem `position(… in v_def)`.
     */
    const block = exec0124.slice(exec0124.indexOf("KOMMENTARE RAUS") - 400);
    expect(block).not.toMatch(/position\([^)]*in v_def\)/);
  });

  it("sie prüft vorher, dass kein Stringliteral einen Kommentarstarter trägt", () => {
    /*
     * DAS IST DIE EIGENTLICHE ZUSICHERUNG ÜBER DAS WERKZEUG.
     *
     * Naives Entfernen von Kommentaren ist unsicher, sobald ein Literal `--`
     * oder `/*` enthält — dann reißt es echten Code mit. Statt zu hoffen,
     * dass das nie passiert, bricht die Migration ab, wenn es zutrifft.
     */
    expect(exec0124).toContain("regexp_matches(v_def,");
    expect(exec0124).toContain("ein Stringliteral im Ledger-Rumpf enthaelt einen Kommentarstarter");
  });

  it("und danach, dass das Strippen den Rumpf nicht zerlegt hat", () => {
    expect(exec0124).toContain("nach dem Entfernen der Kommentare ist der Rumpf unbrauchbar");
  });

  it("kein Stringliteral im Ledger-Rumpf trägt heute einen Kommentarstarter", () => {
    const literale = [...ledgerStripped.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
    expect(literale.length).toBeGreaterThan(50);
    expect(literale.filter((l) => l.includes("--") || l.includes("/*") || l.includes("*/")))
      .toEqual([]);
  });
});

describe("kein Suchbegriff der Nachbedingung hängt an einem Kommentar", () => {
  it("die Liste ist nicht leer — sonst prüfte dieser Block nichts", () => {
    expect(needles.length).toBeGreaterThanOrEqual(40);
  });

  /*
   * DER TEST, DER DEN ABBRUCH LOKAL GEZEIGT HÄTTE — ALS MENGENVERGLEICH.
   *
   * Zuerst stand hier „für JEDEN Suchbegriff muss der Befund im rohen und im
   * kommentarfreien Rumpf derselbe sein". Diese Zusicherung ist falsch, und
   * sie schlug sofort an: `purchase_receipt_fingerprint` IST
   * kommentarabhängig — der Rumpf erklärt in einem Kommentar, warum er den
   * Fingerabdruck nicht direkt ruft, und genau das hat den Abbruch
   * ausgelöst. Der Kommentar ist aber richtig und soll bleiben.
   *
   * Die tragfähige Zusicherung ist deshalb nicht „keiner", sondern „genau
   * diese und keine anderen". Kommt ein weiterer Begriff dazu, dessen
   * Ergebnis an Prosa hängt, fällt dieser Test — und zwar bevor jemand SQL
   * ausführt. Dass die Migration mit dem bekannten Fall umgehen kann, prüft
   * der Block darunter: dort zählt nur der kommentarfreie Rumpf.
   */
  const kommentarabhaengig = needles
    .filter((n) => ledgerStripped.includes(n.needle) !== ledgerRaw.includes(n.needle))
    .map((n) => n.needle)
    .sort();

  it("genau ein Suchbegriff hängt an einem Kommentar, und es ist der bekannte", () => {
    expect(kommentarabhaengig).toEqual(["purchase_receipt_fingerprint"]);
  });

  it("und er fehlt im Code, steht also wirklich nur in der Prosa", () => {
    expect(ledgerRaw).toContain("purchase_receipt_fingerprint");
    expect(ledgerStripped).not.toContain("purchase_receipt_fingerprint");
  });
});

describe("und jeder Suchbegriff trifft im kommentarfreien Rumpf zu", () => {
  /*
   * Das ist die Vorhersage für den nächsten Staging-Lauf: jede dieser
   * Zusicherungen entspricht einer Zeile der Nachbedingung. Alle grün heisst,
   * dass die Migration ihre eigenen Prüfungen bestehen wird.
   */
  for (const { needle, mustExist } of needles) {
    it(`»${needle.slice(0, 44)}« ${mustExist ? "vorhanden" : "nicht vorhanden"}`, () => {
      expect(ledgerStripped.includes(needle)).toBe(mustExist);
    });
  }

  it("der Fingerabdruck steht NUR im Kommentar, nicht im Code", () => {
    /* Genau der Befund, der den Abbruch ausgelöst hat. */
    expect(ledgerRaw).toContain("purchase_receipt_fingerprint");
    expect(ledgerStripped).not.toContain("purchase_receipt_fingerprint");
  });

  it("und die Schutzhülle wird im Code gerufen, nicht in der Prosa", () => {
    expect(ledgerStripped).toContain("public.purchase_receipt_stale(m.id, m.receipt_fingerprint)");
  });
});

/* ==========================================================================
 * 9. Die Kette Feld für Feld — der letzte stille Fehlerweg
 * ======================================================================== */

describe("jedes der elf Felder kommt vom RPC im Typ an", () => {
  /*
   * WARUM DAS EINE EIGENE PRÜFUNG BRAUCHT.
   *
   * Bisher nannte der Test vier der elf Zuordnungen beim Namen. Die anderen
   * sieben waren ungeprüft — und ein Tippfehler dort ist STUMM: `r.has_sender_city`
   * auf einem Objekt ohne dieses Feld ist `undefined`, `undefined === true` ist
   * `false`, und die Spalte „Daten" stünde für jeden Einkauf auf orange. Kein
   * Typfehler, keine Ausnahme, keine rote Zeile — nur eine Farbe, die immer
   * dasselbe behauptet.
   *
   * Die Erwartung wird nicht von Hand gepflegt, sondern AUS DER MIGRATION
   * abgeleitet: was `0124` projiziert, muss `queries.ts` lesen. Damit prüft
   * der Test den Vertrag und nicht meine Abschrift davon.
   */
  const camel = (snake: string) =>
    snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

  /**
   * Die Schlüssel, die `0124` wirklich in jede Zeile schreibt.
   *
   * Nur der Schlüssel zählt, nicht seine rechte Seite: `'status_known', true`
   * steht anders da als `'has_sender_name',` mit dem Ausdruck in der nächsten
   * Zeile. Mein erster Entwurf verlangte `m.`, `true` oder `case` dahinter und
   * fand deshalb fünf von elf.
   */
  const projizierte = [...projection.matchAll(/'([a-z_]+)',/g)]
    .map((m) => m[1])
    .filter((k) => k.startsWith("has_") || k.startsWith("receipt_") || k === "status_known")
    .filter((k) => k !== "receipt_id" && k !== "receipt_fingerprint");
  const erwartet = [...new Set(projizierte)].sort();

  it("die Migration projiziert genau elf Statusfelder", () => {
    expect(erwartet).toEqual([
      "has_agreement", "has_origin", "has_sender_city", "has_sender_name",
      "has_sender_postal_code", "has_sender_street", "receipt_issued_at",
      "receipt_number", "receipt_revision", "receipt_stale", "status_known",
    ]);
  });

  for (const snake of [
    "status_known", "has_sender_name", "has_sender_street",
    "has_sender_postal_code", "has_sender_city", "has_origin", "has_agreement",
    "receipt_number", "receipt_issued_at", "receipt_revision", "receipt_stale",
  ]) {
    it(`queries.ts liest r.${snake} nach ${camel(snake)}`, () => {
      /* Der Name links, der Name rechts, in derselben Zuweisung. */
      const zuweisung = new RegExp(
        `${camel(snake)}:\\s*r\\.${snake}\\b`);
      expect(QUERIES).toMatch(zuweisung);
    });

    it(`und der Typ kennt ${camel(snake)}`, () => {
      expect(LEDGER_TYPES).toMatch(new RegExp(`^\\s*${camel(snake)}:`, "m"));
    });
  }

  it("und kein Feld wird mit Boolean() gelesen", () => {
    /*
     * `Boolean(undefined)` ist `false`, und `false` heisst bei `receiptStale`
     * „stimmt überein". Ein fehlendes Feld würde damit zu einer Zusicherung,
     * die niemand geprüft hat.
     */
    expect(QUERIES).not.toMatch(/Boolean\(r\.(status_known|has_|receipt_)/);
  });
});

describe("der Vorbehalt steht unter jedem Datenstatus", () => {
  /*
   * „Keine Aussage über steuerliche oder rechtliche Anerkennung der
   * Belegform" — die Testmatrix sagt: fehlt dieser Satz, ist der Test nicht
   * bestanden. Auch unter grün.
   */
  it("er wird unbedingt angehängt, nicht in einem Zweig", () => {
    const fn = LEDGER.slice(LEDGER.indexOf("function dataTitle"),
                            LEDGER.indexOf("function receiptTitle"));
    expect(fn).toContain("parts.push(rs.noLegalClaim);");
    /* Kein `if` zwischen der letzten Bedingung und dem Anhängen. */
    const danach = fn.slice(fn.indexOf("parts.push(rs.noLegalClaim);"));
    expect(danach).not.toContain("if (");
  });

  it("und der Satz steht genau einmal in de.ts", () => {
    expect(DE.match(/Keine Aussage über steuerliche/g)).toHaveLength(1);
  });

  it("die acht Gründe haben acht verschiedene Texte", () => {
    /*
     * `Record<DataReason, string>` erzwingt die Vollständigkeit beim
     * Typecheck — nicht aber, dass zwei Gründe nicht denselben Text tragen.
     * Ein doppelt eingefügter Verweis wäre gültiger Code mit falscher Aussage.
     */
    const map = LEDGER.slice(LEDGER.indexOf("const DATA_REASON_TEXT"),
                             LEDGER.indexOf("function dataTitle"));
    const werte = [...map.matchAll(/^\s*\w+:\s*(rs\.\w+),/gm)].map((m) => m[1]);
    expect(werte).toHaveLength(8);
    expect(new Set(werte).size).toBe(8);
  });
});
