import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * DER (i)-KNOPF MUSS ANKLICKBAR SEIN — UND DAS ENTSCHEIDET EIN z-index.
 *
 * WAS SCHIEFGING, UND WARUM KEIN TEST ES SAH.
 *
 * Das (i) steht in der Datumszelle, und die Datumszelle ist die klebende
 * erste Spalte: `position: sticky` MIT eigenem `z-index`. Das macht aus ihr
 * einen STAPELKONTEXT. Über der ganzen Zeile liegt ein durchsichtiger Knopf
 * (`LedgerRow`, `absolute inset-0 z-10`), der das Aufklappen auslöst. Solange
 * die Zelle bei `z-index: 1` lag, lag sie als GANZES unter dieser
 * Überlagerung — und jedes `z-20` an einem Knopf innerhalb der Zelle war
 * wirkungslos, weil ein Stapelkontext seine Kinder einschliesst.
 *
 * Live hiess das: Klick auf das (i) klappte die Zeile auf, das Fenster
 * öffnete nie. `stopPropagation` kam nicht zum Zug, weil das Ereignis den
 * Knopf nie erreichte. Es war also KEIN Bubbling-Fehler.
 *
 * Der alte Test prüfte `relative z-20` und `event.stopPropagation()` im
 * Quelltext. Beide waren da. Beide waren wertlos. Er prüfte das VORHANDENSEIN
 * EINES HEILMITTELS, nicht dessen Wirkung — und ein Texttest kann einen
 * Stapelkontext nicht auswerten.
 *
 * WAS ER STATTDESSEN PRÜFT: die Ungleichung selbst. Beide Zahlen stehen im
 * Quelltext, an zwei verschiedenen Stellen, und genau ihr Verhältnis
 * entscheidet über die Bedienbarkeit. Wandert eine davon, fällt dieser Test.
 */

const CSS = readFileSync("src/app/globals.css", "utf8");

/** `LedgerRow` von der Signatur bis zur nächsten Export-Grenze. */
function rowSource(): string {
  const at = TABLE.indexOf("export function LedgerRow");
  expect(at, "LedgerRow fehlt").toBeGreaterThan(-1);
  const next = TABLE.indexOf("\nexport ", at + 10);
  return TABLE.slice(at, next === -1 ? undefined : next);
}
const TABLE = readFileSync("src/components/business/ledger-table.tsx", "utf8");
const LEDGER = readFileSync("src/components/business/sales-ledger.tsx", "utf8");

/** Der `z-index` der klebenden ersten Zelle, aus der Regel selbst gelesen. */
function stickyZ(): number {
  const at = CSS.indexOf(".ob-row > :first-child");
  expect(at, "die Regel für die klebende erste Spalte fehlt").toBeGreaterThan(-1);
  const rule = CSS.slice(at, CSS.indexOf("}", at));
  expect(rule).toContain("position: sticky");
  const match = /z-index:\s*(\d+)/.exec(rule);
  expect(match, "die klebende Zelle hat keinen z-index").not.toBeNull();
  return Number(match![1]);
}

/** Der `z-index` der durchsichtigen Zeilen-Überlagerung, aus ihrer Klasse. */
function overlayZ(): number {
  const body = rowSource();
  const overlay = body.slice(body.indexOf("<button"));
  expect(overlay).toContain("absolute inset-0");
  const match = /\bz-(\d+)\b/.exec(overlay);
  expect(match, "die Überlagerung hat keine z-Klasse").not.toBeNull();
  return Number(match![1]);
}

describe("die klebende erste Spalte liegt über der Zeilen-Überlagerung", () => {
  it("…und zwar echt grösser, nicht gleich", () => {
    const sticky = stickyZ();
    const overlay = overlayZ();
    expect(sticky, `sticky ${sticky} muss über overlay ${overlay} liegen`)
      .toBeGreaterThan(overlay);
  });

  /*
   * UND DAS DARF SIE, WEIL DIE ZEILE SICH ISOLIERT.
   *
   * `isolate` auf der Zeile schliesst jeden z-index darin ein. Ohne das
   * könnte eine 11 in der Zelle den klebenden TABELLENKOPF (`sticky top-0
   * z-10`) überstimmen und beim senkrechten Scrollen darüber malen — die
   * Sorge, die im Kommentar von `LedgerRow` steht. Mit `isolate` kann der
   * Wert die Zeile nicht verlassen.
   */
  it("die Zeile isoliert ihren Stapel, sonst überstimmte die Zelle den Tabellenkopf", () => {
    expect(rowSource()).toContain("isolate");
    /* Der Kopf liegt ausserhalb dieser Isolation und behält seine 10. */
    const head = TABLE.slice(TABLE.indexOf("export function LedgerHead"),
                             TABLE.indexOf("export function LedgerRow"));
    expect(head).toMatch(/sticky top-0 z-10/);
  });

  it("das (i) steht wirklich in dieser Zelle — sonst gilt die Ungleichung ihm nicht", () => {
    /*
     * Die erste Zelle der Zeile ist das erste Kind von `<LedgerRow>`. Das (i)
     * muss darin liegen, denn nur dafür wurde die Zahl angehoben.
     */
    const row = LEDGER.slice(LEDGER.indexOf("<LedgerRow "), LEDGER.indexOf("</LedgerRow>"));
    const firstCell = row.slice(row.indexOf(">") + 1);
    const cellEnd = firstCell.indexOf("</span>", firstCell.indexOf("onDetails"));
    expect(cellEnd, "das (i) liegt nicht in der ersten Zelle").toBeGreaterThan(-1);
    const cell = firstCell.slice(0, cellEnd);
    expect(cell).toContain("onDetails(sale.id)");
    expect(cell).toContain("formatDate(sale.soldAt)");
  });

  it("und behält Gürtel und Hosenträger: z-20 am Knopf und stopPropagation", () => {
    /*
     * Beide bleiben. Sie waren nicht die Lösung, aber sie kosten nichts und
     * halten, falls die Stapelordnung je wieder wandert.
     */
    const row = LEDGER.slice(LEDGER.indexOf("<LedgerRow "), LEDGER.indexOf("</LedgerRow>"));
    expect(row).toContain("relative z-20");
    expect(row).toContain("event.stopPropagation()");
  });

  it("die CSS-Regel sagt, warum die Zahl so gross ist", () => {
    /* Eine Zahl, auf der eine Bedienbarkeit ruht, braucht ihren Grund neben
       sich — sonst senkt sie der nächste Aufräumer wieder. */
    const at = CSS.indexOf(".ob-row > :first-child");
    const before = CSS.slice(Math.max(0, at - 1600), at);
    expect(before).toContain("STAPELKONTEXT");
    expect(before).toContain("isolate");
  });
});
