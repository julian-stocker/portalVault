/**
 * Belegformate: der eingefrorene und der neue.
 *
 * DREI ZUSICHERUNGEN TRAGEN DIESE DATEI.
 *
 * 1. `SI-E-2026-000001` BLEIBT, WIE ER WAR — Byte für Byte. Der Beleg wurde
 *    auf Staging ausgestellt und heruntergeladen; die Datenbank hat den Abruf
 *    mit 4 506 Bytes bestätigt. Genau diese Zahl und genau dieser SHA-256
 *    stehen unten. Ein neuer Renderer, eine geänderte Beschriftung, eine
 *    Verschiebung in `PdfPage` — was auch immer das Dokument bewegt, fällt
 *    hier auf.
 *
 * 2. DAS FORMAT ENTSCHEIDET DIE DATENBANK, NICHT DER CODE. Jeder Beleg trägt
 *    seine Formatnummer; fehlt sie, weil `0123` noch nicht angewendet ist,
 *    gilt 1. So bekommt kein Beleg still ein Format, das niemand vermerkt hat.
 *
 * 3. DAS ZUSAMMENFASSEN IST DARSTELLUNG, NICHT DATENHALTUNG. Format 2 fasst
 *    gleiche SKY-IDs zu einer Zeile zusammen — die Gesamtstückzahl bleibt die
 *    Summe über ALLE Snapshot-Positionen, und der Snapshot selbst wird nicht
 *    angefasst.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RECEIPT_FORMATS, RECEIPT_FORMAT_CURRENT, formatOf, renderPurchaseReceiptPdf,
  type ReceiptDocument, type ReceiptLine,
} from "./purchase-receipt";
import { groupLines, renderReceiptV2 } from "./receipt-format-v2";
import { renderReceiptV1 } from "./receipt-format-v1";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const latin1 = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join("");

function runs(bytes: Uint8Array) {
  const out: { x: number; y: number; size: number; text: string }[] = [];
  for (const line of latin1(bytes).split("\n")) {
    const m = /^BT \/F[12] ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \((.*)\) Tj ET$/.exec(line);
    if (m) {
      out.push({
        size: Number(m[1]), x: Number(m[2]), y: Number(m[3]),
        text: m[4].replace(/\\([()\\])/g, "$1"),
      });
    }
  }
  return out;
}
const textOf = (b: Uint8Array) => runs(b).map((r) => r.text).join("\n");
const pagesOf = (b: Uint8Array) => Number(/\/Count (\d+)/.exec(latin1(b))?.[1]);

/* ==========================================================================
 * 1. Der echte Beleg, festgenagelt
 * ======================================================================== */

/**
 * Der Snapshot von `SI-E-2026-000001`, wie
 * `seller_purchase_receipt_document()` ihn auf Staging zurückgibt — lesend
 * abgerufen, Feld für Feld. Die Absenderdaten sind fiktiv („Henry Tester"),
 * die Käuferdaten sind die veröffentlichten Geschäftsdaten des Shops.
 */
const ISSUED: ReceiptDocument = {
  id: 1, purchase_id: 105,
  receipt_number: "SI-E-2026-000001",
  issued_at: "2026-10-14T14:26:14.874759+00:00",
  revision: 1, supersedes_id: null,
  buyer_legal_name: "Julian Stocker",
  buyer_trade_name: "yulez.collectibles",
  buyer_street: "Lechhalde 1 1/2",
  buyer_postal_code: "87629",
  buyer_city: "Füssen",
  buyer_country: "Deutschland",
  buyer_email: "yulez.collectibles@gmail.com",
  buyer_vat_id: "DE321022065",
  seller_platform: "kleinanzeigen",
  seller_handle: null,
  sender_name: "Henry Tester",
  sender_street: "Teststraße 3",
  sender_postal_code: "87688",
  sender_city: "Teststadt",
  sender_country: "Deutschland",
  listing_ref: "3883929383",
  listing_title: null, listing_url: null, listing_details: null,
  purchased_at: "2026-10-12",
  items_cost: 13, shipping_cost: 0, buyer_protection_cost: 0,
  total_cost: 13, currency: "EUR", payment_method: "card",
  agreement_note: null,
  lines: [
    { name: "Legendary Bash", sky_id: "SKY-0008", position: 1, condition: "loose" },
    { name: "Legendary Blades", sky_id: "SKY-0344", position: 2, condition: "loose" },
  ],
};

describe("SI-E-2026-000001 bleibt, wie er ausgeliefert wurde", () => {
  /*
   * GEMESSEN, NICHT ANGENOMMEN. Die Datenbank hat den Abruf dieses Belegs
   * mit 4 506 Bytes bestätigt — `purchase_receipt_downloads.byte_count`. Der
   * lokale Renderer erzeugt dieselbe Zahl; damit ist der Determinismus gegen
   * einen ECHTEN Browser-Download belegt und nicht nur gegen sich selbst.
   */
  const BYTES = 4506;
  const SHA = "cc974d993bb29ecdbfb2208add08c6a6434fb069c636cde89ecef354ab66148c";

  it("dieselbe Byte-Zahl wie der bestätigte Abruf", () => {
    expect(renderPurchaseReceiptPdf(ISSUED).byteLength).toBe(BYTES);
  });

  it("und derselbe SHA-256", () => {
    const hash = createHash("sha256")
      .update(renderPurchaseReceiptPdf(ISSUED)).digest("hex");
    expect(hash).toBe(SHA);
  });

  it("der Verteiler schickt ihn an Format 1", () => {
    expect(formatOf(ISSUED)).toBe(1);
    expect(latin1(renderPurchaseReceiptPdf(ISSUED)))
      .toBe(latin1(renderReceiptV1(ISSUED)));
  });

  it("und Format 2 würde ihn anders zeichnen — deshalb die Versionierung", () => {
    /*
     * Die Begründung der ganzen Übung, als Messung: derselbe Snapshot ergibt
     * in zwei Formaten zwei verschiedene Dokumente. Ohne die Formatnummer
     * bekäme der Betreiber beim nächsten Download das falsche.
     */
    expect(latin1(renderReceiptV2(ISSUED))).not.toBe(latin1(renderReceiptV1(ISSUED)));
  });
});

/* ==========================================================================
 * 2. Die Versionierung
 * ======================================================================== */

describe("welches Format gilt", () => {
  it("fehlt die Angabe, ist es 1", () => {
    /* So lange `0123` nicht angewendet ist — und das ist richtig: ohne
       Spalte kann die Datenbank kein Format vermerken. */
    expect(formatOf({ ...ISSUED, format_version: undefined })).toBe(1);
    expect(formatOf({ ...ISSUED, format_version: null })).toBe(1);
  });

  it("eine gesetzte Nummer gewinnt", () => {
    expect(formatOf({ ...ISSUED, format_version: 1 })).toBe(1);
    expect(formatOf({ ...ISSUED, format_version: 2 })).toBe(2);
  });

  it("eine unbekannte Nummer fällt auf 1 zurück, statt zu scheitern", () => {
    for (const unknown of [0, 3, 99, -1]) {
      expect(formatOf({ ...ISSUED, format_version: unknown })).toBe(1);
    }
  });

  it("zu jeder bekannten Nummer gibt es einen Zeichner", () => {
    for (const version of RECEIPT_FORMATS) {
      const bytes = renderPurchaseReceiptPdf({ ...ISSUED, format_version: version });
      expect(bytes.byteLength, `Format ${version}`).toBeGreaterThan(1000);
      expect(latin1(bytes).startsWith("%PDF-1.4"), `Format ${version}`).toBe(true);
    }
  });

  it("neue Belege bekommen das aktuelle Format", () => {
    expect(RECEIPT_FORMAT_CURRENT).toBe(2);
    expect(RECEIPT_FORMATS).toContain(RECEIPT_FORMAT_CURRENT);
  });

  it("Format 1 hängt an nichts, was sich ändern darf", () => {
    /*
     * Eigene Beschriftungen, eigene Hilfsfunktionen. Würde `de.ts` eines
     * Tages umbenannt, stünde sonst auf einem Beleg von 2026 ein anderes
     * Wort als damals.
     */
    const v1 = read("src/lib/business/receipt-format-v1.ts");
    const code = v1.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("@/lib/i18n/de");
    expect(code).not.toContain("de.business");
    expect(code).toContain('const PLATFORMS: Record<string, string> = {');
    expect(code).toContain('const PAYMENTS: Record<string, string> = {');
    /* Und kein Zeitbezug — sonst wäre das Dokument nicht reproduzierbar. */
    expect(code).not.toContain("new Date()");
    expect(code).not.toContain("Date.now()");
  });

  it("und Format 2 ebenso wenig", () => {
    const v2 = read("src/lib/business/receipt-format-v2.ts");
    const code = v2.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("@/lib/i18n/de");
    expect(code).not.toContain("new Date()");
    expect(code).not.toContain("Date.now()");
  });
});

/* ==========================================================================
 * 3. Das Zusammenfassen
 * ======================================================================== */

const line = (position: number, sky: string | null, name: string): ReceiptLine =>
  ({ position, sky_id: sky, name, condition: "loose" });

describe("gleiche Figuren, eine Zeile", () => {
  it("drei gleiche SKY-IDs werden eine Zeile mit Stückzahl 3", () => {
    const rows = groupLines([
      line(1, "SKY-0008", "Legendary Bash"),
      line(2, "SKY-0344", "Legendary Blades"),
      line(3, "SKY-0008", "Legendary Bash"),
      line(4, "SKY-0008", "Legendary Bash"),
    ]);
    expect(rows).toEqual([
      { sky_id: "SKY-0008", name: "Legendary Bash", quantity: 3 },
      { sky_id: "SKY-0344", name: "Legendary Blades", quantity: 1 },
    ]);
  });

  it("die Reihenfolge ist die des ersten Auftretens, nicht alphabetisch", () => {
    const rows = groupLines([
      line(1, "SKY-0900", "Zook"),
      line(2, "SKY-0001", "Spyro"),
      line(3, "SKY-0900", "Zook"),
    ]);
    expect(rows.map((r) => r.sky_id)).toEqual(["SKY-0900", "SKY-0001"]);
  });

  it("Positionen ohne SKY-ID werden über den Namen gruppiert", () => {
    /* Der Name ist die einzige Identität, die der Betreiber vergeben hat. */
    const rows = groupLines([
      line(1, null, "Portal of Power"),
      line(2, null, "Spiel: Giants"),
      line(3, null, "Portal of Power"),
    ]);
    expect(rows).toEqual([
      { sky_id: null, name: "Portal of Power", quantity: 2 },
      { sky_id: null, name: "Spiel: Giants", quantity: 1 },
    ]);
  });

  it("OHNE SKY-ID UND OHNE NAMEN wird NICHT gruppiert", () => {
    /*
     * DER FEHLER DER ERSTEN FASSUNG. Sie setzte den Platzhalter „—" als
     * Namen ein und gruppierte darüber — zwei verschiedene unbenannte
     * Positionen wären zu „— ×2" verschmolzen. Über einen Platzhalter zu
     * gruppieren heisst, eine Identität zu erfinden, die es nicht gibt.
     */
    const rows = groupLines([
      { position: 1, sky_id: null, name: null, condition: "loose" },
      { position: 2, sky_id: null, name: null, condition: "loose" },
      { position: 3, sky_id: null, name: "", condition: "loose" },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.quantity === 1)).toBe(true);
    expect(rows.every((r) => r.name === "—")).toBe(true);
  });

  it("Namen werden nicht normalisiert — Regel 4", () => {
    /*
     * „Portal " und „Portal" sind zwei verschieden getippte Dinge. Sie
     * zusammenzufassen hiesse, den Namen stillschweigend zu korrigieren.
     */
    const rows = groupLines([
      line(1, null, "Portal"),
      line(2, null, "Portal "),
      line(3, null, "portal"),
    ]);
    expect(rows).toHaveLength(3);
  });

  it("eine leere SKY-ID zählt wie keine", () => {
    const rows = groupLines([
      { position: 1, sky_id: "", name: "Portal", condition: "loose" },
      { position: 2, sky_id: "   ", name: "Portal", condition: "loose" },
    ]);
    expect(rows).toEqual([{ sky_id: "", name: "Portal", quantity: 2 }]);
  });

  it("die Gesamtstückzahl bleibt die Summe über ALLE Positionen", () => {
    for (const count of [2, 7, 50, 123]) {
      const lines = Array.from({ length: count }, (_, i) =>
        line(i + 1, `SKY-${String((i % 9) + 1).padStart(4, "0")}`, `Figur ${(i % 9) + 1}`));
      const rows = groupLines(lines);
      expect(rows.reduce((sum, r) => sum + r.quantity, 0), `n=${count}`).toBe(count);
      expect(rows.length).toBeLessThanOrEqual(9);
      /* Und auf dem PDF steht dieselbe Zahl. */
      const text = textOf(renderReceiptV2({ ...ISSUED, format_version: 2, lines }));
      expect(text, `n=${count}`).toContain(`Gesamtstückzahl: ${count}`);
    }
  });

  it("der Snapshot selbst wird dabei nicht angefasst", () => {
    const lines = [line(1, "SKY-0008", "Bash"), line(2, "SKY-0008", "Bash")];
    const before = JSON.stringify(lines);
    groupLines(lines);
    renderReceiptV2({ ...ISSUED, format_version: 2, lines });
    expect(JSON.stringify(lines)).toBe(before);
  });
});

/* ==========================================================================
 * 4. Was Format 2 zeigt — und was nicht
 * ======================================================================== */

describe("Format 2: schlank", () => {
  const doc = { ...ISSUED, format_version: 2 };
  const text = textOf(renderReceiptV2(doc));

  it("die vier Spalten, und nur die", () => {
    expect(text).toContain("Pos");
    expect(text).toContain("SKY-ID");
    expect(text).toContain("Figurenname");
    expect(text).toContain("Stück");
    expect(text).not.toContain("Ausführung");
    expect(text).not.toContain("Bezeichnung");
  });

  it("keine Ausführung, kein Buchungszustand, kein Wert je Figur", () => {
    for (const forbidden of ["lose", "originalverpackt", "Beschädigt", "Angekommen",
                             "Eingebucht", "Marktwert", "Faktor", "Einzelpreis",
                             "Verkaufspreis", "Gewinn", "MwSt", "USt 0"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("keine „nicht erfasst“-Zeilen", () => {
    /* `seller_handle` ist bei diesem Beleg leer — Format 1 schrieb dafür
       „Benutzername nicht erfasst", Format 2 lässt die Zeile weg. */
    expect(text).not.toContain("nicht erfasst");
    expect(text).not.toContain("Benutzername");
    /* Was da ist, steht da. */
    expect(text).toContain("Kleinanzeigen");
    expect(text).toContain("3883929383");
  });

  it("Versand und Käuferschutz nur, soweit angefallen", () => {
    expect(text).not.toContain("Versand");
    expect(text).not.toContain("Käuferschutz");
    const withCosts = textOf(renderReceiptV2({
      ...doc, items_cost: 10, shipping_cost: 4.9, buyer_protection_cost: 1.1, total_cost: 16,
    }));
    expect(withCosts).toContain("Versand");
    expect(withCosts).toContain("4,90 EUR");
    expect(withCosts).toContain("Käuferschutz");
    expect(withCosts).toContain("1,10 EUR");
  });

  it("die Pflichtangaben stehen alle darauf", () => {
    for (const needed of ["SI-E-2026-000001", "14.10.2026", "12.10.2026",
                          "Julian Stocker", "Lechhalde 1 1/2", "87629 Füssen",
                          "Henry Tester", "87688 Teststadt",
                          "Gesamtstückzahl: 2", "Gesamtausgabe", "13,00 EUR",
                          "Kreditkarte", "Ort, Datum", "Unterschrift des Ausstellers"]) {
      expect(text, needed).toContain(needed);
    }
    expect(text).toContain("Ankauf von einer Privatperson");
    expect(text).toContain("Eigenbeleg");
  });

  it("die Kaufvereinbarung nur, wenn es eine gibt", () => {
    expect(text).not.toContain("Anmerkungen zur Kaufvereinbarung");
    const withNote = textOf(renderReceiptV2({
      ...doc, agreement_note: "Nur 5 von 40 Figuren gekauft, Preis im Chat vereinbart.",
    }));
    expect(withNote).toContain("Anmerkungen zur Kaufvereinbarung");
    expect(withNote).toContain("Nur 5 von 40 Figuren gekauft");
  });

  it("kein Fragezeichen, auch mit Umlauten", () => {
    const bytes = renderReceiptV2({
      ...doc, sender_name: "Jörg Müller-Weiß",
      agreement_note: "Größe gemäß Absprache; Zustand überwiegend gut.",
    });
    for (const run of runs(bytes)) expect(run.text, run.text).not.toContain("?");
    expect(latin1(bytes)).not.toContain("€");
  });
});

/* ==========================================================================
 * 5. Grosse Ankäufe
 * ======================================================================== */

describe("2, 50 und 120 Figuren", () => {
  const many = (count: number, distinct = count): ReceiptDocument => ({
    ...ISSUED, format_version: 2,
    lines: Array.from({ length: count }, (_, i) =>
      line(i + 1, `SKY-${String((i % distinct) + 1).padStart(4, "0")}`,
           `Testfigur ${(i % distinct) + 1}`)),
  });

  it("jede Stückzahl ergibt ein gültiges, vollständiges PDF", () => {
    for (const count of [2, 50, 120, 250]) {
      const bytes = renderReceiptV2(many(count));
      const file = latin1(bytes);
      expect(file.startsWith("%PDF-1.4"), `n=${count}`).toBe(true);
      expect(file.endsWith("%%EOF\n"), `n=${count}`).toBe(true);
      const text = textOf(bytes);
      expect(text, `n=${count}`).toContain(`Gesamtstückzahl: ${count}`);
      expect(text, `n=${count}`).toContain("Gesamtausgabe");
      expect(text, `n=${count}`).toContain("Unterschrift des Ausstellers");
    }
  });

  it("nichts wird abgeschnitten — keine Zeile unter der Grundlinie", () => {
    for (const count of [50, 120, 250]) {
      for (const run of runs(renderReceiptV2(many(count)))) {
        if (run.text.includes("Seite ")) continue;
        expect(run.y, `n=${count}: ${run.text}`).toBeGreaterThanOrEqual(56);
      }
    }
  });

  it("die Tabellenüberschrift wiederholt sich auf jeder Seite mit Zeilen", () => {
    const bytes = renderReceiptV2(many(120));
    const file = latin1(bytes);
    const pages = pagesOf(bytes);
    expect(pages).toBeGreaterThan(1);
    /* Je Seite ein Inhaltsstrom; auf jedem, der Positionszeilen trägt, muss
       die Überschrift stehen. */
    const streams: string[] = [];
    for (const m of file.matchAll(/<< \/Length \d+ >>\nstream\n/g)) {
      streams.push(file.slice(m.index + m[0].length, file.indexOf("\nendstream", m.index)));
    }
    expect(streams).toHaveLength(pages);
    for (const [index, stream] of streams.entries()) {
      const hasRows = /\(Testfigur \d+\)/.test(stream);
      if (!hasRows) continue;
      expect(stream, `Seite ${index + 1}`).toContain("(Figurenname)");
      expect(stream, `Seite ${index + 1}`).toContain("(SKY-ID)");
    }
  });

  it("Belegnummer und Seitenzahl stehen auf JEDER Seite", () => {
    for (const count of [2, 120]) {
      const bytes = renderReceiptV2(many(count));
      const pages = pagesOf(bytes);
      const folios = runs(bytes).filter((r) => r.text.includes("Seite "));
      expect(folios, `n=${count}`).toHaveLength(pages);
      folios.forEach((folio, index) => {
        expect(folio.text).toBe(`SI-E-2026-000001 · Seite ${index + 1} von ${pages}`);
        expect(folio.y).toBe(32);
      });
    }
  });

  it("keine Position geht verloren", () => {
    const text = textOf(renderReceiptV2(many(250, 250)));
    for (let i = 1; i <= 250; i += 1) {
      expect(text, `Figur ${i}`).toContain(`SKY-${String(i).padStart(4, "0")}`);
    }
  });

  it("Summen und Hinweis bleiben beisammen", () => {
    /* Sie dürfen nicht über zwei Seiten zerfallen — der Beleg wäre sonst in
       der Mitte unleserlich. */
    const bytes = renderReceiptV2(many(120));
    const file = latin1(bytes);
    const streams: string[] = [];
    for (const m of file.matchAll(/<< \/Length \d+ >>\nstream\n/g)) {
      streams.push(file.slice(m.index + m[0].length, file.indexOf("\nendstream", m.index)));
    }
    const pageOf = (needle: string) => streams.findIndex((s) => s.includes(needle));
    expect(pageOf("(Gesamtausgabe)")).toBe(pageOf("(Ausgabe)"));
    expect(pageOf("(Hinweis)")).toBe(pageOf("(Unterschrift des Ausstellers)"));
  });

  it("und das Format bleibt kompakter als Format 1", () => {
    /* Die Messung, die den Umbau rechtfertigt. */
    const lines = many(120).lines;
    const v1 = pagesOf(renderReceiptV1({ ...ISSUED, lines }));
    const v2 = pagesOf(renderReceiptV2({ ...ISSUED, format_version: 2, lines }));
    expect(v2).toBeLessThanOrEqual(v1);
  });
});
