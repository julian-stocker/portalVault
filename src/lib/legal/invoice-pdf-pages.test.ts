/**
 * Seitenumbruch im handgeschriebenen PDF.
 *
 * DER FEHLER, DEN DIESE DATEI BEWACHT — gemessen, nicht geschätzt.
 *
 * Die Engine prüfte die Seitenhöhe nirgends. Der Cursor lief einfach weiter,
 * und die `Tm`-Koordinaten im erzeugten Inhaltsstrom sagten:
 *
 *     Positionen   tiefste Grundlinie
 *          11         75,89     noch über dem unteren Rand (56)
 *          12         50,89     im Rand
 *          15        -24,11     NEBEN DEM BLATT
 *          40       -649,11
 *
 * Ab zwölf Positionen stand der Ausstellerfuss im Rand, ab fünfzehn fehlten
 * Gesamtbetrag, der Steuerhinweis und der Aussteller im Dokument. Eine
 * Bestellung mit fünfzehn verschiedenen Figuren ist nichts Besonderes.
 *
 * WAS HIER DIE ALTE AUSGABE FESTHÄLT. Die Laufzahlen und die tiefsten
 * Grundlinien für 1, 5, 10 und 11 Positionen wurden am ALTEN Code gemessen,
 * bevor der Umbruch eingebaut wurde. Sie stehen unten als Zusicherung: wenn
 * eine einseitige Rechnung sich verschiebt, fällt genau das auf.
 */
import { describe, expect, it } from "vitest";

import { renderInvoicePdf, SMALL_BUSINESS_NOTE, type InvoiceDocument } from "./invoice";

/* --------------------------------------------------------------------------
 * Ein Dokument und ein Leser dafür
 * ----------------------------------------------------------------------- */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
/** Die Grundlinie, unter die kein Inhalt darf. */
const BOTTOM = 56;
/** Nur die Seitenzahl darf darunter stehen. */
const FOLIO_Y = 32;

function doc(lineCount: number, options: {
  name?: (i: number) => string; discount?: string; company?: string | null;
  tradeName?: string | null; vatId?: string | null;
} = {}): InvoiceDocument {
  const { name = (i: number) => `Testfigur ${i + 1}`, discount = "0.00" } = options;
  return {
    invoice_number: "SI-R-2026-000001", issued_at: "2026-10-14T10:00:00Z",
    order_number: "SI-2026-0001", placed_at: "2026-10-01T10:00:00Z", paid_at: null,
    shipping_method: "DHL Paket",
    seller: {
      legal_name: "Julian Stocker",
      trade_name: options.tradeName === undefined ? "yulez.collectibles" : options.tradeName,
      street: "Lechhalde 1 1/2", postal_code: "87629", city: "Füssen",
      country: "Deutschland", email: "info@skyisles.de",
      vat_id: options.vatId === undefined ? "DE321022065" : options.vatId,
    },
    customer: {
      name: "Erika Mustermann",
      company: options.company === undefined ? "Mustermann GmbH" : options.company,
      street: "Musterstraße 1", postal_code: "12345", city: "Musterstadt",
      country: "Deutschland", email: "erika@example.org",
    },
    items_subtotal: "100.00", shipping_amount: "4.99", discount_amount: discount,
    total_amount: "104.99", currency: "EUR", tax_regime: "small_business",
    lines: Array.from({ length: lineCount }, (_, i) => ({
      sky_id: `SKY-${String(i + 1).padStart(4, "0")}`,
      name: name(i), condition: i % 2 === 0 ? "loose" : "sealed",
      quantity: 1, unit_price: "10.00", line_total: "10.00",
    })),
  };
}

/** Die Datei als Zeichenkette, ein Zeichen je Byte. */
const latin1 = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join("");

type Run = { x: number; y: number; size: number; bold: boolean; text: string };

/**
 * Die Seiten des erzeugten PDFs, in Dateireihenfolge.
 *
 * Die Inhaltsströme stehen als Objekte hintereinander und in Seitenfolge, und
 * jeder Lauf ist eine eigene Zeile im Strom — deshalb wird zeilenweise
 * gelesen und nicht mit einem Muster über den ganzen Strom. Ein Text wie
 * "Testfigur 1 (lose)" enthält Klammern, und ein gierig-faules Muster hörte
 * an der falschen auf.
 */
function readPdf(bytes: Uint8Array) {
  const file = latin1(bytes);
  const streams: string[] = [];
  const lengths: { declared: number; actual: number }[] = [];
  /*
   * ÜBER DIE /Length-KÖPFE GEHEN, NICHT ÜBER "stream\n".
   *
   * Die erste Fassung suchte `indexOf("stream\n")` — und das trifft auch das
   * `stream\n` INNERHALB von `endstream\n`. Beim letzten Strom fand sie
   * danach kein `\nendstream` mehr, bekam -1, schnitt die halbe Datei als
   * Rumpf heraus und setzte den Zeiger auf 0: eine Endlosschleife, die
   * Zeichenketten anhäufte, bis der Testprozess mit SIGABRT starb. Ein
   * Muster über die Kopfzeilen kann das nicht passieren.
   */
  for (const head of file.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const bodyAt = head.index + head[0].length;
    const close = file.indexOf("\nendstream", bodyAt);
    expect(close).toBeGreaterThan(-1);
    const body = file.slice(bodyAt, close);
    streams.push(body);
    lengths.push({ declared: Number(head[1]), actual: body.length });
  }

  const pages = streams.map((stream) => {
    const runs: Run[] = [];
    const rules: number[] = [];
    for (const line of stream.split("\n")) {
      const text = /^BT \/(F[12]) ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \((.*)\) Tj ET$/
        .exec(line);
      if (text) {
        runs.push({
          bold: text[1] === "F2", size: Number(text[2]),
          x: Number(text[3]), y: Number(text[4]),
          /*
           * Die drei PDF-Escapes zurücknehmen. `pdfString` schreibt `\(`,
           * `\)` und `\\`, und ein Lauf wie `Testfigur 1 \(lose\)` ist nicht
           * der Text, nach dem ein Test sucht. Die Byte-Prüfung oben rechnet
           * weiter mit dem ESCAPED Rumpf — das ist die Dateilänge.
           */
          text: text[5].replace(/\\([()\\])/g, "$1"),
        });
        continue;
      }
      const rule = /m ([\d.-]+) ([\d.-]+) l S$/.exec(line);
      if (rule) rules.push(Number(rule[2]));
    }
    return { runs, rules };
  });

  return {
    file, pages, lengths,
    count: Number(/\/Count (\d+)/.exec(file)?.[1]),
    kids: /\/Kids \[([^\]]*)\]/.exec(file)?.[1] ?? "",
    size: Number(/\/Size (\d+)/.exec(file)?.[1]),
    info: Number(/\/Info (\d+) 0 R/.exec(file)?.[1]),
    objects: [...file.matchAll(/^(\d+) 0 obj$/gm)].map((m) => Number(m[1])),
  };
}

const allRuns = (pdf: ReturnType<typeof readPdf>) => pdf.pages.flatMap((p) => p.runs);
const lowest = (pdf: ReturnType<typeof readPdf>) =>
  Math.min(...allRuns(pdf).map((r) => r.y), ...pdf.pages.flatMap((p) => p.rules));

/* --------------------------------------------------------------------------
 * 1. Die kurze Rechnung ist unverändert
 * ----------------------------------------------------------------------- */

describe("eine Seite bleibt eine Seite — und bleibt, wo sie war", () => {
  /*
   * Diese vier Zeilen sind am alten Code gemessen. Sie sind der eigentliche
   * Schutz für Anforderung 4 und 7: verschiebt der Umbruch irgendetwas an
   * einer Rechnung, die ohnehin passte, fällt es hier auf.
   */
  const MEASURED_BEFORE = [
    { lines: 1, runs: 34, lowest: 325.89 },
    { lines: 5, runs: 54, lowest: 225.89 },
    { lines: 10, runs: 79, lowest: 100.89 },
    { lines: 11, runs: 84, lowest: 75.89 },
  ];

  for (const anchor of MEASURED_BEFORE) {
    it(`${anchor.lines} Positionen: ${anchor.runs} Läufe, tiefster y = ${anchor.lowest}`, () => {
      const pdf = readPdf(renderInvoicePdf(doc(anchor.lines)));
      expect(pdf.count).toBe(1);
      expect(pdf.pages).toHaveLength(1);
      expect(allRuns(pdf)).toHaveLength(anchor.runs);
      expect(lowest(pdf)).toBeCloseTo(anchor.lowest, 2);
    });
  }

  it("und die sieben Objekte heissen weiter 1 bis 7", () => {
    const pdf = readPdf(renderInvoicePdf(doc(3)));
    expect(pdf.objects).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pdf.kids.trim()).toBe("3 0 R");
    expect(pdf.size).toBe(8);
    expect(pdf.info).toBe(7);
    expect(pdf.file).toContain("/F1 5 0 R /F2 6 0 R");
    expect(pdf.file).toContain("/Contents 4 0 R");
  });

  it("keine Seitenzahl auf einem einseitigen Dokument", () => {
    const pdf = readPdf(renderInvoicePdf(doc(5)));
    expect(allRuns(pdf).some((r) => r.text.startsWith("Seite "))).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * 2. /Length — der zweite Fund
 * ----------------------------------------------------------------------- */

describe("/Length ist die Byte-Zahl, nicht die UTF-8-Zahl", () => {
  it("deklariert und tatsächlich stimmen überein, auch mit Umlauten", () => {
    /*
     * Vorher mass `render` mit `TextEncoder` und schrieb die Datei als
     * Latin-1: jedes Zeichen über U+007F zählte doppelt. Bei diesem Dokument
     * waren es sechs Bytes zu viel. Ein Leser, der `/Length` glaubt statt
     * `endstream`, liest über den Strom hinaus.
     */
    for (const n of [1, 12, 40]) {
      const pdf = readPdf(renderInvoicePdf(doc(n)));
      for (const { declared, actual } of pdf.lengths) {
        expect(declared, `n=${n}`).toBe(actual);
      }
    }
  });

  it("und das Dokument enthält wirklich Nicht-ASCII, sonst prüft das nichts", () => {
    const pdf = readPdf(renderInvoicePdf(doc(1)));
    const high = /[-ÿ]/;
    expect(pdf.pages[0].runs.some((r) => high.test(r.text))).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * 3. Der Umbruch
 * ----------------------------------------------------------------------- */

describe("ab zwölf Positionen bricht die Seite um", () => {
  it("zwölf Positionen passen nicht mehr auf eine Seite", () => {
    /* Vorher: eine Seite, tiefster y = 50,89 — also im unteren Rand. */
    const pdf = readPdf(renderInvoicePdf(doc(12)));
    expect(pdf.count).toBe(2);
    expect(pdf.pages).toHaveLength(2);
  });

  it("nichts steht unter der Grundlinie 56 — ausser der Seitenzahl", () => {
    for (const n of [12, 15, 20, 40, 120]) {
      const pdf = readPdf(renderInvoicePdf(doc(n)));
      for (const run of allRuns(pdf)) {
        if (run.text.startsWith("Seite ")) {
          expect(run.y, `n=${n}`).toBe(FOLIO_Y);
          continue;
        }
        expect(run.y, `n=${n}: ${run.text}`).toBeGreaterThanOrEqual(BOTTOM);
      }
      for (const rule of pdf.pages.flatMap((p) => p.rules)) {
        expect(rule, `n=${n}: Linie`).toBeGreaterThanOrEqual(BOTTOM);
      }
    }
  });

  it("und nichts über dem oberen Rand", () => {
    const pdf = readPdf(renderInvoicePdf(doc(40)));
    for (const run of allRuns(pdf)) {
      expect(run.y, run.text).toBeLessThanOrEqual(PAGE_HEIGHT - MARGIN);
    }
  });

  it("die Seiten stehen in der richtigen Reihenfolge", () => {
    const pdf = readPdf(renderInvoicePdf(doc(40)));
    /* /Kids nennt die Seitenobjekte aufsteigend ... */
    const kids = pdf.kids.trim().split(" 0 R").filter(Boolean).map((k) => Number(k.trim()));
    expect(kids).toEqual([...kids].sort((a, b) => a - b));
    expect(kids).toHaveLength(pdf.count);
    /* ... und die Seitenzahlen laufen mit den Inhaltsströmen mit. */
    pdf.pages.forEach((page, index) => {
      const folio = page.runs.find((r) => r.text.startsWith("Seite "));
      expect(folio?.text).toBe(`Seite ${index + 1} von ${pdf.count}`);
    });
  });

  it("die Objektnummern folgen der Formel, für jede Seitenzahl", () => {
    for (const n of [1, 12, 40, 120]) {
      const pdf = readPdf(renderInvoicePdf(doc(n)));
      const total = 2 + 2 * pdf.count + 3;
      expect(pdf.objects, `n=${n}`).toEqual(
        Array.from({ length: total }, (_, i) => i + 1));
      expect(pdf.info, `n=${n}`).toBe(total);
      expect(pdf.size, `n=${n}`).toBe(total + 1);
      /* Jede Seite verweist auf dieselben zwei Schriften. */
      const fontRegular = 3 + 2 * pdf.count;
      expect(pdf.file).toContain(`/F1 ${fontRegular} 0 R /F2 ${fontRegular + 1} 0 R`);
    }
  });

  it("die Querverweistabelle trifft jedes Objekt auf das Byte", () => {
    /*
     * Die eigentliche Gefahr bei mehreren Seiten: ein Versatz um ein Byte,
     * und die Datei öffnet in manchen Lesern und in anderen nicht. Also
     * nachgerechnet statt zugesichert.
     */
    for (const n of [1, 12, 40]) {
      const file = latin1(renderInvoicePdf(doc(n)));
      const xrefAt = Number(/startxref\n(\d+)/.exec(file)?.[1]);
      expect(file.slice(xrefAt, xrefAt + 4), `n=${n}`).toBe("xref");
      const offsets = [...file.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
      expect(offsets.length, `n=${n}`).toBeGreaterThan(6);
      offsets.forEach((offset, index) => {
        expect(file.slice(offset).startsWith(`${index + 1} 0 obj\n`),
          `n=${n}, Objekt ${index + 1} bei ${offset}`).toBe(true);
      });
    }
  });
});

/* --------------------------------------------------------------------------
 * 4. Was zusammengehört, bleibt zusammen
 * ----------------------------------------------------------------------- */

describe("kein Block wird zerschnitten", () => {
  /** Auf welcher Seite steht ein Text? */
  const pageOf = (pdf: ReturnType<typeof readPdf>, needle: string) =>
    pdf.pages.findIndex((p) => p.runs.some((r) => r.text.includes(needle)));

  it("Bezeichnung und SKY-ID einer Position stehen auf derselben Seite", () => {
    for (const n of [12, 15, 20, 40, 120]) {
      const pdf = readPdf(renderInvoicePdf(doc(n)));
      for (let i = 0; i < n; i += 1) {
        const sky = `SKY-${String(i + 1).padStart(4, "0")}`;
        expect(pageOf(pdf, `Testfigur ${i + 1} (`), `n=${n}, ${sky}`)
          .toBe(pageOf(pdf, sky));
      }
    }
  });

  it("die Summenstaffel bleibt beisammen", () => {
    for (const n of [12, 15, 20, 40]) {
      const pdf = readPdf(renderInvoicePdf(doc(n)));
      const sub = pageOf(pdf, "Zwischensumme Ware");
      expect(pageOf(pdf, "Versand"), `n=${n}`).toBe(sub);
      expect(pageOf(pdf, "Gesamtbetrag"), `n=${n}`).toBe(sub);
    }
  });

  it("auch mit Rabattzeile", () => {
    const pdf = readPdf(renderInvoicePdf(doc(13, { discount: "5.00" })));
    const sub = pageOf(pdf, "Zwischensumme Ware");
    expect(pageOf(pdf, "Rabatt")).toBe(sub);
    expect(pageOf(pdf, "Gesamtbetrag")).toBe(sub);
  });

  it("der Steuerhinweis bleibt bei der Zahlungszeile", () => {
    for (const n of [12, 14, 20, 40]) {
      const pdf = readPdf(renderInvoicePdf(doc(n)));
      const first = SMALL_BUSINESS_NOTE.split(" ").slice(0, 3).join(" ");
      expect(pageOf(pdf, "Der Rechnungsbetrag ist bezahlt"), `n=${n}`)
        .toBe(pageOf(pdf, first));
    }
  });

  it("der Ausstellerfuss bleibt beisammen — und steht auf dem Blatt", () => {
    for (const n of [12, 15, 20, 40, 120]) {
      const pdf = readPdf(renderInvoicePdf(doc(n)));
      expect(pageOf(pdf, "yulez.collectibles"), `n=${n}`).toBe(pdf.count - 1);
      expect(pageOf(pdf, "info@skyisles.de"), `n=${n}`).toBe(pdf.count - 1);
      expect(pageOf(pdf, "USt-IdNr."), `n=${n}`).toBe(pdf.count - 1);
    }
  });

  it("und er steht auch ohne Handelsname und ohne Steuernummer richtig", () => {
    const pdf = readPdf(renderInvoicePdf(
      doc(13, { tradeName: null, vatId: null, company: null })));
    expect(allRuns(pdf).some((r) => r.text.includes("USt-IdNr."))).toBe(false);
    for (const run of allRuns(pdf)) {
      if (!run.text.startsWith("Seite ")) expect(run.y).toBeGreaterThanOrEqual(BOTTOM);
    }
  });
});

/* --------------------------------------------------------------------------
 * 5. Lange Bezeichnungen und mehrzeilige Texte
 * ----------------------------------------------------------------------- */

describe("lange Texte laufen nicht aus dem Satzspiegel", () => {
  const LONG = "Hot Streak mit Zubehoer, originalverpackt, aus der Sammlung eines Vorbesitzers";

  it("eine lange Bezeichnung wird gekürzt", () => {
    const pdf = readPdf(renderInvoicePdf(doc(3, { name: () => LONG })));
    const names = allRuns(pdf).filter((r) => r.text.startsWith("Hot Streak"));
    expect(names).toHaveLength(3);
    for (const run of names) {
      /* `truncate(..., 46)` schneidet bei 46 Zeichen samt Auslassungszeichen. */
      expect(run.text.length).toBeLessThanOrEqual(46);
    }
  });

  it("GROSSBUCHSTABEN sind der engste Fall und bleiben links vom Mengenfeld", () => {
    /*
     * 46 Grossbuchstaben sind bei 9,5pt die breiteste Bezeichnung, die
     * `truncate` zulässt. Die Mengenspalte endet bei left+300.
     */
    const pdf = readPdf(renderInvoicePdf(doc(2, { name: () => "A".repeat(90) })));
    const names = allRuns(pdf).filter((r) => r.text.startsWith("AAA"));
    expect(names).toHaveLength(2);
    for (const run of names) {
      expect(run.x).toBe(MARGIN);
      expect(run.text.length).toBeLessThanOrEqual(46);
    }
  });

  it("kein Lauf überschreitet den rechten Rand", () => {
    for (const n of [1, 13, 40]) {
      const pdf = readPdf(renderInvoicePdf(doc(n, { name: () => LONG })));
      for (const run of allRuns(pdf)) {
        expect(run.x, `n=${n}: ${run.text}`).toBeLessThanOrEqual(PAGE_WIDTH - MARGIN);
        expect(run.x, `n=${n}: ${run.text}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("der umgebrochene Hinweis ergibt Zeilen innerhalb der Umbruchbreite", () => {
    const pdf = readPdf(renderInvoicePdf(doc(1)));
    const words = SMALL_BUSINESS_NOTE.split(" ");
    expect(allRuns(pdf).some((r) => r.text.startsWith(words[0]))).toBe(true);
    const noteRuns = allRuns(pdf).filter((r) => r.size === 9 && r.text.length > 0);
    for (const run of noteRuns) expect(run.text.length).toBeLessThanOrEqual(92);
  });
});

/* --------------------------------------------------------------------------
 * 6. Das Wachstum selbst
 * ----------------------------------------------------------------------- */

describe("die Seitenzahl wächst monoton und jede Position erscheint", () => {
  it("mehr Positionen bedeuten nie weniger Seiten", () => {
    let previous = 0;
    for (const n of [1, 11, 12, 20, 40, 80, 120, 240]) {
      const pdf = readPdf(renderInvoicePdf(doc(n)));
      expect(pdf.count, `n=${n}`).toBeGreaterThanOrEqual(previous);
      previous = pdf.count;
    }
  });

  it("keine Position geht verloren, auch bei 240", () => {
    const pdf = readPdf(renderInvoicePdf(doc(240)));
    const texts = allRuns(pdf).map((r) => r.text);
    for (let i = 0; i < 240; i += 1) {
      expect(texts, `Position ${i + 1}`)
        .toContain(`SKY-${String(i + 1).padStart(4, "0")}`);
    }
    /* Und der Beleg endet mit dem Aussteller, nicht mitten in der Tabelle. */
    expect(pdf.pages[pdf.count - 1].runs.some((r) => r.text === "info@skyisles.de"))
      .toBe(true);
  });

  it("jede Seite trägt auch wirklich Inhalt", () => {
    const pdf = readPdf(renderInvoicePdf(doc(120)));
    for (const [index, page] of pdf.pages.entries()) {
      /* Die Seitenzahl allein zählt nicht als Inhalt. */
      const real = page.runs.filter((r) => !r.text.startsWith("Seite "));
      expect(real.length, `Seite ${index + 1}`).toBeGreaterThan(0);
    }
  });
});

/* --------------------------------------------------------------------------
 * 7. Die Zeichenkodierung
 * ----------------------------------------------------------------------- */

describe("WinAnsi: jedes Zeichen wird zu dem Byte, das es sein muss", () => {
  /** Der rohe Inhaltsstrom der ersten Seite, ein Zeichen je Byte. */
  function stream(name: string): string {
    const file = latin1(renderInvoicePdf({
      ...doc(1), customer: { ...doc(1).customer, name },
    }));
    const head = /<< \/Length \d+ >>\nstream\n/.exec(file)!;
    return file.slice(head.index + head[0].length, file.indexOf("\nendstream"));
  }
  const bytes = (text: string) => [...stream(text)].map((c) => c.charCodeAt(0));
  const encoded = (text: string) => {
    const line = stream(text).split("\n")
      .find((l) => l.includes(" Tm (") && l.includes("Tj ET") && l.length > 40
        && !l.includes("Julian") && !l.includes("Rechnung"));
    return line;
  };

  it("· wird 0xB7 und nicht mehr zu einem Fragezeichen", () => {
    /*
     * `invoice.ts:119` setzt dieses Zeichen zwischen Name, Strasse und Ort
     * der Absenderzeile — auf JEDER Rechnung. Vorher stand dort
     * "Julian Stocker ? Lechhalde 1 1/2 ? 87629 Füssen".
     */
    const sender = latin1(renderInvoicePdf(doc(1)))
      .split("\n").find((l) => l.includes("Julian Stocker"))!;
    expect(sender).toContain(String.fromCharCode(0xb7));
    expect(sender).not.toContain("?");
  });

  it("… wird 0x85 und nicht mehr zu einem Fragezeichen", () => {
    /* `truncate()` hängt es an jeden Namen über 46 Zeichen. */
    const file = latin1(renderInvoicePdf(doc(2, {
      name: () => "Hot Streak mit Zubehoer, originalverpackt, aus einer Sammlung",
    })));
    const row = file.split("\n").find((l) => l.includes("Hot Streak"))!;
    expect(row).toContain(String.fromCharCode(0x85));
    expect(row).not.toContain("?");
  });

  it("die bereits unterstützten Sonderzeichen behalten ihr Byte", () => {
    /*
     * Die Tabelle wurde erweitert, nicht umgebaut — das hier beweist es
     * Zeichen für Zeichen. Jede Zeile ist ein Eintrag, der vorher schon da
     * war.
     */
    const EXPECTED: [string, number][] = [
      ["ä", 0xe4], ["ö", 0xf6], ["ü", 0xfc],
      ["Ä", 0xc4], ["Ö", 0xd6], ["Ü", 0xdc],
      ["ß", 0xdf],
      ["é", 0xe9], ["è", 0xe8], ["ê", 0xea],
      ["§", 0xa7], ["°", 0xb0], ["«", 0xab], ["»", 0xbb],
      ["„", 0x84], ["\u201c", 0x93], ["\u201d", 0x94],
      ["–", 0x96], ["—", 0x97], ["’", 0x92], ["‘", 0x91],
    ];
    for (const [char, byte] of EXPECTED) {
      const marked = `X${char}X`;
      expect(bytes(marked), `${char} -> 0x${byte.toString(16)}`)
        .toContain(byte);
      expect(encoded(marked), char).toContain(String.fromCharCode(byte));
    }
  });

  it("und die neuen beiden stehen in derselben Prüfung", () => {
    for (const [char, byte] of [["·", 0xb7], ["…", 0x85]] as [string, number][]) {
      expect(bytes(`X${char}X`), `${char}`).toContain(byte);
    }
  });

  it("die Latin-1-Regel trifft auch Zeichen, die nie in der Tabelle standen", () => {
    /*
     * Der eigentliche Gewinn: eine Kundin namens Nuñez oder Lefèvre bekam
     * vorher ein Fragezeichen in ihren Namen. CP1252 ist ab 0xA0 Latin-1,
     * also IST das Byte der Codepunkt.
     */
    for (const [char, byte] of [["ñ", 0xf1], ["ç", 0xe7], ["á", 0xe1],
                                ["Å", 0xc5], ["ø", 0xf8], ["×", 0xd7],
                                ["©", 0xa9], ["±", 0xb1]] as [string, number][]) {
      expect(bytes(`X${char}X`), `${char} -> 0x${byte.toString(16)}`).toContain(byte);
    }
  });

  it("die beiden geschützten Leerzeichen bleiben absichtlich ein normales", () => {
    /*
     * Die eine Ausnahme von „das Byte ist der Codepunkt". Die Tabelle wird
     * VOR der Bereichsregel befragt, sonst würde U+00A0 jetzt als 0xA0
     * geschrieben und die Absicht wäre still verloren.
     */
    for (const space of ["\u00a0", "\u202f"]) {
      const line = encoded(`X${space}X`)!;
      expect(line).toContain("X X");
      expect(bytes(`X${space}X`)).not.toContain(0xa0);
    }
  });

  it("was WinAnsi wirklich nicht kann, bleibt ein sichtbares Fragezeichen", () => {
    /* Kein kaputter Strom, sondern ein Zeichen, das man sieht. */
    for (const char of ["→", "日", "😀", "\u0100"]) {
      const line = encoded(`X${char}X`);
      expect(line, char).toContain("?");
    }
  });

  it("Klammern und Gegenschrägstrich bleiben maskiert", () => {
    const line = encoded("X(a)\\bX")!;
    expect(line).toContain("\\(");
    expect(line).toContain("\\)");
    expect(line).toContain("\\\\");
  });
});

/* --------------------------------------------------------------------------
 * 8. Der obere Rand auf Folgeseiten
 * ----------------------------------------------------------------------- */

describe("jede Seite beginnt am selben oberen Rand", () => {
  const TOP = PAGE_HEIGHT - MARGIN;

  it("die höchste Grundlinie ist auf JEDER Seite genau der obere Rand", () => {
    /*
     * Vorher begann Seite zwei bei 770,89 statt 785,89: die Zeile einer
     * Position beginnt mit `gap(15)`, und dieser Vorlauf wurde NACH dem
     * Seitenwechsel verbraucht. Gemessen am Muster, nicht gerechnet.
     */
    for (const n of [12, 20, 40, 120, 240]) {
      const pdf = readPdf(renderInvoicePdf(doc(n)));
      pdf.pages.forEach((page, index) => {
        /*
         * Gemessen wird der höchste LAUF, nicht die höchste Linie. Beim
         * ersten Durchlauf stand hier eine Trennlinie bündig am oberen Rand
         * und darunter der Text — der Test meldete 771,89 statt 785,89 und
         * hat damit genau den Rest des Fehlers gefunden.
         */
        const highest = Math.max(...page.runs.map((r) => r.y));
        expect(highest, `n=${n}, Seite ${index + 1}`).toBeCloseTo(TOP, 2);
        for (const rule of page.rules) {
          expect(rule, `n=${n}, Seite ${index + 1}: Linie am Kopf`)
            .toBeLessThan(TOP);
        }
      });
    }
  });

  it("auch die erste Seite — die Regel ist dieselbe, nicht eine zweite", () => {
    for (const n of [1, 5, 11]) {
      const pdf = readPdf(renderInvoicePdf(doc(n)));
      expect(Math.max(...allRuns(pdf).map((r) => r.y)), `n=${n}`).toBeCloseTo(TOP, 2);
    }
  });

  it("und nichts ist dabei nach unten gerutscht oder verloren gegangen", () => {
    const pdf = readPdf(renderInvoicePdf(doc(240)));
    const texts = allRuns(pdf).map((r) => r.text);
    for (let i = 0; i < 240; i += 1) {
      expect(texts).toContain(`SKY-${String(i + 1).padStart(4, "0")}`);
    }
    for (const run of allRuns(pdf)) {
      if (!run.text.startsWith("Seite ")) expect(run.y).toBeGreaterThanOrEqual(BOTTOM);
    }
  });

  it("die Positionen stehen weiter in ihrer Reihenfolge", () => {
    /*
     * Seite für Seite, von oben nach unten: die SKY-IDs müssen aufsteigend
     * durchlaufen. Ein Umbruch, der eine Zeile verschiebt, fiele hier auf.
     */
    const pdf = readPdf(renderInvoicePdf(doc(120)));
    const order: number[] = [];
    for (const page of pdf.pages) {
      for (const run of page.runs) {
        const m = /^SKY-(\d{4})$/.exec(run.text);
        if (m) order.push(Number(m[1]));
      }
    }
    expect(order).toHaveLength(120);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
