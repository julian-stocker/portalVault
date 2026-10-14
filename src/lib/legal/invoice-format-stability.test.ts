/**
 * Die Kundenrechnung sieht morgen aus wie heute — und wenn nicht, fällt es auf.
 *
 * ---------------------------------------------------------------------------
 * WARUM ES DIESE DATEI GIBT.
 *
 * Eine Rechnung wird NICHT als Datei gespeichert. Sie entsteht bei jedem
 * Download neu aus der unveränderlichen Zeile in `public.invoices` — es gibt
 * weder einen Storage-Aufruf im Rechnungspfad noch eine Spalte, die Bytes
 * hielte. Das ist richtig so (ADR-0086): keine Datei, die in einem Ablageeimer
 * liegen bleiben kann, und der einzige Eimer dieses Projekts ist öffentlich.
 *
 * Es hat aber eine Folge: WER DEN RENDERER ÄNDERT, ÄNDERT JEDE BEREITS
 * AUSGESTELLTE RECHNUNG MIT. Die Daten bleiben, das Dokument nicht.
 *
 * Beim Eigenbeleg wurde das mit einer Formatversion gelöst. Für die Rechnung
 * wurde bewusst anders entschieden (ADR-0123): eine eingefrorene Fassung 1
 * würde einen DEFEKT festschreiben — bis zur Korrektur lief die Engine ab
 * etwa elf Positionen aus dem Blatt, und Gesamtbetrag, § 19-Satz und
 * Ausstellerfuss fehlten im PDF. Das sind Pflichtangaben nach § 34a UStDV
 * Nr. 4 und 5. "Unverändert" wäre dort die schlechtere Lage.
 *
 * Statt einer Versionierung also diese Datei: die Darstellung wird
 * FESTGENAGELT. Ab jetzt ist jede weitere Veränderung an der Rechnung eine
 * bewusste — auch eine, die über `PdfPage` hereinkäme, das die Rechnung sich
 * mit den Eigenbelegen teilt.
 *
 * ---------------------------------------------------------------------------
 * WAS DIE ANKER NICHT KÖNNEN.
 *
 * `invoice.ts` formatiert sein Datum über `Intl.DateTimeFormat("de-DE")`.
 * Anders als der Beleg, der dafür eine eigene Zusammensetzung benutzt, hängt
 * die Rechnung damit an CLDR-Daten. Ändert eine künftige Node-Fassung das
 * deutsche Datumsmuster, verschieben sich die Bytes und diese Prüfungen
 * werden rot — zu Recht, aber ohne dass jemand etwas falsch gemacht hätte.
 * Dann ist zu prüfen, ob sich die DARSTELLUNG geändert hat, und der Anker neu
 * zu setzen, statt ihn zu entfernen.
 *
 * ---------------------------------------------------------------------------
 * ABGRENZUNG ZU `invoice-pdf-pages.test.ts`.
 *
 * Die Nachbardatei prüft die ENGINE: `PdfPage` für sich, mit eigenen
 * Minimaldokumenten — Umbruch, Zeichentabelle, Objektzählung. Diese Datei
 * prüft das DOKUMENT, das am Ende beim Kunden ankommt, durch
 * `renderInvoicePdf` hindurch. Die Zeichen- und `/Length`-Korrekturen sind
 * damit doppelt abgedeckt, und zwar absichtlich: die Engine kann richtig
 * rechnen, während die Rechnung das falsche Zeichen hineingibt.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { renderInvoicePdf, SMALL_BUSINESS_NOTE, type InvoiceDocument } from "./invoice";

/**
 * Die kanonische Rechnung.
 *
 * Bewusst ohne Firmenzeile beim Kunden und ohne Rabatt: beides verschiebt den
 * Satzspiegel, und ein Anker, dessen Vorlage sich nachrechnen lässt, ist
 * leichter zu beurteilen als einer aus einem Zufallsdatensatz. Die
 * Verkäuferangaben sind die veröffentlichten Geschäftsdaten, die
 * Kundenangaben erfunden.
 */
export function invoiceFixture(lines: number, longNames = false): InvoiceDocument {
  return {
    invoice_number: "SI-R-2026-000001",
    issued_at: "2026-09-25T10:00:00+00:00",
    order_number: "SI-2026-0001",
    placed_at: "2026-09-23T12:00:00+00:00",
    paid_at: "2026-09-23T12:01:00+00:00",
    shipping_method: "DHL Paket",
    seller: {
      legal_name: "Julian Stocker",
      trade_name: "yulez.collectibles",
      street: "Lechhalde 1 1/2",
      postal_code: "87629",
      city: "Füssen",
      country: "Deutschland",
      email: "info@skyisles.de",
      vat_id: "DE321022065",
    },
    customer: {
      name: "Erika Mustermann",
      company: null,
      street: "Musterstraße 1",
      postal_code: "12345",
      city: "Musterstadt",
      country: "Deutschland",
      email: "erika@example.org",
    },
    items_subtotal: (lines * 10).toFixed(2),
    shipping_amount: "4.99",
    discount_amount: "0.00",
    total_amount: (lines * 10 + 4.99).toFixed(2),
    currency: "EUR",
    tax_regime: "small_business",
    lines: Array.from({ length: lines }, (_, index) => ({
      sky_id: `SKY-${String(index + 1).padStart(4, "0")}`,
      name: longNames
        ? "Hot Streak mit Zubehör, originalverpackt, aus einer Sammlung"
        : `Testfigur ${index + 1}`,
      condition: index % 2 === 0 ? "loose" : "sealed",
      quantity: 1,
      unit_price: "10.00",
      line_total: "10.00",
    })),
  };
}

/** Die Datei ist Latin-1 geschrieben; ein Byte ist ein Zeichen. */
const latin1 = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

type TextRun = { x: number; y: number; size: number; bold: boolean; text: string };

/** Die Textläufe aus den Inhaltsströmen zurücklesen. */
function runs(bytes: Uint8Array): TextRun[] {
  const out: TextRun[] = [];
  for (const line of latin1(bytes).split("\n")) {
    const match = /^BT \/(F[12]) ([\d.]+) Tf 1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm \((.*)\) Tj ET$/
      .exec(line);
    if (match) {
      out.push({
        bold: match[1] === "F2",
        size: Number(match[2]),
        x: Number(match[3]),
        y: Number(match[4]),
        text: match[5].replace(/\\([()\\])/g, "$1"),
      });
    }
  }
  return out;
}

const textOf = (bytes: Uint8Array) => runs(bytes).map((run) => run.text).join("\n");
/** Der § 19-Satz steht umbrochen im PDF; so liest er sich wieder zusammen. */
const flowOf = (bytes: Uint8Array) => textOf(bytes).replace(/\n/g, " ");
const pagesOf = (bytes: Uint8Array) => Number(/\/Count (\d+)/.exec(latin1(bytes))?.[1]);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/* ==========================================================================
 * 1. Die Anker
 * ======================================================================== */

describe("die Darstellung ist festgenagelt", () => {
  /*
   * Gemessen an dem Stand, der nach Production geht. Jede spätere Abweichung —
   * im Renderer, in `PdfPage` oder in einer Beschriftung — macht genau diese
   * Prüfungen rot. Das ist der Zweck: eine Rechnung soll sich nicht nebenbei
   * ändern.
   */
  const PINNED = [
    { lines: 1, bytes: 3198, sha: "3978dee8703d596ff460957e3f1f129436d5a8b1c15240ed98e5e8ca46408319" },
    { lines: 5, bytes: 4398, sha: "5bc143eb3ef2ef028cd022b2b1e90d9a7464c42b2a65883a231bc6b8cec4f872" },
    { lines: 11, bytes: 6258, sha: "9b1f19a9efbc5cf8910af70f60371f6d52ecf4b6d63a3cdf5d396dd4b0599308" },
  ];

  for (const anchor of PINNED) {
    it(`${anchor.lines} Positionen: ${anchor.bytes} Bytes`, () => {
      const bytes = renderInvoicePdf(invoiceFixture(anchor.lines));
      expect(bytes.byteLength).toBe(anchor.bytes);
      expect(sha(bytes)).toBe(anchor.sha);
    });
  }

  it("und elf Positionen passen noch auf ein Blatt", () => {
    /* Sonst wäre der Anker oben der Anker eines anderen Dokuments. */
    expect(pagesOf(renderInvoicePdf(invoiceFixture(11)))).toBe(1);
  });

  it("zweimal rendern ergibt dasselbe Dokument", () => {
    /* Ohne Determinismus wäre ein Anker nicht zu halten. */
    for (const count of [1, 5, 11, 20]) {
      expect(sha(renderInvoicePdf(invoiceFixture(count))), `n=${count}`)
        .toBe(sha(renderInvoicePdf(invoiceFixture(count))));
    }
  });
});

/* ==========================================================================
 * 2. Die Pflichtangaben nach § 34a UStDV
 * ======================================================================== */

describe("eine Rechnung trägt, was sie tragen muss", () => {
  const bytes = renderInvoicePdf(invoiceFixture(5));
  const text = textOf(bytes);

  it("Nr. 1 und 2: beide Parteien vollständig, und die USt-IdNr.", () => {
    for (const needed of [
      "Julian Stocker", "yulez.collectibles", "Lechhalde 1 1/2, 87629 Füssen, Deutschland",
      "info@skyisles.de", "USt-IdNr. DE321022065",
      "Erika Mustermann", "Musterstraße 1", "12345 Musterstadt", "Deutschland",
    ]) {
      expect(text, needed).toContain(needed);
    }
  });

  it("Nr. 3: das Ausstellungsdatum, und der Bestellbezug dazu", () => {
    expect(text).toContain("Rechnungsnummer   SI-R-2026-000001");
    expect(text).toContain("Rechnungsdatum    25.09.2026");
    expect(text).toContain("Bestellnummer     SI-2026-0001");
    expect(text).toContain("Bestelldatum      23.09.2026");
  });

  it("Nr. 4: Menge und handelsübliche Bezeichnung je Position", () => {
    expect(text).toContain("Bezeichnung");
    expect(text).toContain("Menge");
    expect(text).toContain("Einzelpreis");
    for (let position = 1; position <= 5; position += 1) {
      expect(text, `Position ${position}`).toContain(`Testfigur ${position} (`);
      expect(text, `SKY ${position}`).toContain(`SKY-${String(position).padStart(4, "0")}`);
    }
    expect(text).toContain("(lose)");
    expect(text).toContain("(originalverpackt)");
  });

  it("Nr. 5: das Entgelt in einer Summe, mit dem Hinweis dabei", () => {
    expect(text).toContain("Zwischensumme Ware");
    expect(text).toContain("Versand (DHL Paket)");
    expect(text).toContain("Gesamtbetrag");
    expect(text).toContain("54,99 EUR");
    expect(flowOf(bytes)).toContain(SMALL_BUSINESS_NOTE);
  });

  it("und KEINE erfundene Umsatzsteuer", () => {
    /* § 19-Umsätze sind steuerfrei. Eine Zeile "USt 0,00 EUR" behauptete eine
       Besteuerung zum Satz null — etwas anderes, und unwahr. */
    const whole = latin1(bytes);
    for (const forbidden of ["USt 0", "MwSt", "19 %", "zzgl.", "Vorsteuer", "Netto"]) {
      expect(whole, forbidden).not.toContain(forbidden);
    }
  });
});

/* ==========================================================================
 * 3. Der Seitenumbruch — die eigentliche Korrektur
 * ======================================================================== */

describe("zwanzig Positionen sind vollständig", () => {
  const bytes = renderInvoicePdf(invoiceFixture(20));
  const text = textOf(bytes);

  it("sie passen nicht auf ein Blatt", () => {
    /*
     * VORHER WAR DAS KEIN LAYOUTPROBLEM, SONDERN EIN FEHLENDES DOKUMENT. Die
     * alte Engine zeichnete alles auf eine Seite; die tiefste Grundlinie lag
     * bei y = -136,11, also unter dem Papier. Gesamtbetrag, § 19-Satz und
     * Ausstellerfuss standen nicht im PDF.
     */
    expect(pagesOf(bytes)).toBe(2);
  });

  it("und die drei vorher fehlenden Angaben sind da", () => {
    expect(text).toContain("Gesamtbetrag");
    expect(text).toContain("204,99 EUR");
    expect(flowOf(bytes)).toContain(SMALL_BUSINESS_NOTE);
    expect(text).toContain("USt-IdNr. DE321022065");
  });

  it("nichts steht unter dem unteren Rand", () => {
    for (const run of runs(bytes)) {
      if (run.text.startsWith("Seite ")) continue; // sitzt bewusst im Rand
      expect(run.y, run.text).toBeGreaterThanOrEqual(56);
    }
  });

  it("keine Position geht verloren, und keine wird zerschnitten", () => {
    const all = runs(bytes);
    for (let position = 1; position <= 20; position += 1) {
      const sky = all.find((run) => run.text === `SKY-${String(position).padStart(4, "0")}`);
      const name = all.find((run) => run.text.startsWith(`Testfigur ${position} (`));
      expect(sky, `SKY ${position}`).toBeDefined();
      expect(name, `Name ${position}`).toBeDefined();
      /* Die SKY-ID steht zehn Punkte unter ihrer Bezeichnung. Läge ein
         Seitenumbruch dazwischen, stünde hier eine ganz andere Zahl. */
      expect(name!.y - sky!.y, `Position ${position}`).toBeCloseTo(10, 2);
    }
  });

  it("die Summenstaffel bleibt beisammen", () => {
    const all = runs(bytes);
    const subtotal = all.find((run) => run.text === "Zwischensumme Ware");
    const total = all.find((run) => run.text === "Gesamtbetrag");
    expect(subtotal).toBeDefined();
    expect(total).toBeDefined();
    expect(total!.y).toBeLessThan(subtotal!.y);
  });

  it("die Rechnung trägt keine Belegnummer im Fuss", () => {
    /*
     * Der Stempel in `PdfPage.render()` ist für die Eigenbelege da, die ihre
     * Nummer auf jeder Seite tragen. Die Rechnung übergibt keinen und bekommt
     * deshalb nur "Seite n von m".
     */
    const folios = runs(bytes).filter((run) => run.text.startsWith("Seite "));
    expect(folios.map((folio) => folio.text)).toEqual(["Seite 1 von 2", "Seite 2 von 2"]);
  });

  it("eine einseitige Rechnung bekommt gar keine Seitenzahl", () => {
    expect(textOf(renderInvoicePdf(invoiceFixture(5)))).not.toContain("Seite ");
  });

  it("und das zweiseitige Dokument ist genauso festgenagelt", () => {
    /* Derselbe Anker wie in Abschnitt 1, für den Fall mit Umbruch. */
    expect(bytes.byteLength).toBe(9365);
    expect(sha(bytes))
      .toBe("03f4b8b893750ac8981e730c77e762443cebc61f11b82bb52134664ae2cad308");
  });
});

/* ==========================================================================
 * 4. Die beiden Zeichenkorrekturen
 * ======================================================================== */

describe("Sonderzeichen stehen da, wo vorher Fragezeichen standen", () => {
  it("die Absenderzeile trägt den Mittelpunkt und kein Fragezeichen", () => {
    /*
     * DIE EINZIGE SICHTBARE ÄNDERUNG AN BESTEHENDEN RECHNUNGEN. Vorher stand
     * auf jedem ausgestellten Dokument "Julian Stocker ? Lechhalde 1 1/2 ?
     * 87629 Füssen". Der Mittelpunkt ist U+00B7; WinAnsi ist ab 0xA0 Latin-1,
     * das Byte IST dort der Codepunkt — aber die alte Tabelle deckte den
     * Bereich nicht ab und ersetzte alles, was sie nicht kannte.
     */
    const bytes = renderInvoicePdf(invoiceFixture(1));
    const sender = runs(bytes).find((run) => run.text.startsWith("Julian Stocker ·"));
    expect(sender?.text).toBe("Julian Stocker · Lechhalde 1 1/2 · 87629 Füssen");
    expect(latin1(bytes)).toContain("·");
  });

  it("ein gekürzter Name endet auf die Ellipse und nicht auf ein Fragezeichen", () => {
    /*
     * `truncate(..., 46)` in `invoice.ts` hängt U+2026 an. CP1252 legt das
     * Zeichen auf 0x85 — im 0x80-0x9F-Block, ausserhalb der Latin-1-Regel:
     * es braucht einen Tabelleneintrag, sonst wird es zu 0x3F, also "?".
     *
     * ES STEHT HIER ALS 0x85 UND NICHT ALS U+2026, und das ist Absicht. Der
     * Leser oben dekodiert CP1252 bewusst NICHT zurück — geprüft wird das
     * Byte, das wirklich in der Datei liegt. Ein Zeichen, das Unicode an eine
     * andere Stelle legt, ist genau der Fall, der vorher schiefging.
     */
    const bytes = renderInvoicePdf(invoiceFixture(3, true));
    const name = runs(bytes).find((run) => run.text.startsWith("Hot Streak"));
    expect(name?.text).toBe("Hot Streak mit Zubehör, originalverpackt, aus");
    expect(name?.text.endsWith("?")).toBe(false);
    expect(latin1(bytes)).toContain("");
  });

  it("und in keinem der Dokumente steht ein Fragezeichen", () => {
    for (const count of [1, 5, 11, 20]) {
      for (const run of runs(renderInvoicePdf(invoiceFixture(count)))) {
        expect(run.text, `n=${count}: ${run.text}`).not.toContain("?");
      }
    }
    for (const run of runs(renderInvoicePdf(invoiceFixture(3, true)))) {
      expect(run.text, run.text).not.toContain("?");
    }
  });

  it("das Eurozeichen steht weiterhin als Wort da", () => {
    /*
     * U+20AC liegt in CP1252 bei 0x80 und ist über die Latin-1-Regel NICHT
     * erreichbar; es käme als Fragezeichen heraus. Deshalb schreibt
     * `invoice.ts` "EUR" — und soll es weiter tun.
     */
    const bytes = renderInvoicePdf(invoiceFixture(5));
    expect(latin1(bytes)).not.toContain("€");
    expect(textOf(bytes)).toContain("EUR");
  });

  it("die Umlaute landen als ein Byte, nicht als zwei", () => {
    /* "Füssen" ist 0x46 0xFC 0x73 ... — nicht die UTF-8-Folge 0xC3 0xBC. */
    const bytes = renderInvoicePdf(invoiceFixture(1));
    expect(latin1(bytes)).toContain("Füssen");
    expect(latin1(bytes)).not.toContain("FÃ¼ssen");
    expect(latin1(bytes)).toContain("Musterstraße 1");
  });
});

/* ==========================================================================
 * 5. /Length — die unsichtbare Korrektur
 * ======================================================================== */

describe("/Length ist die Byte-Zahl, nicht die UTF-8-Zahl", () => {
  it("deklariert und tatsächlich stimmen in jedem Strom überein", () => {
    /*
     * Vorher mass `render` mit `TextEncoder` und schrieb die Datei als
     * Latin-1: jedes Zeichen über U+007F zählte doppelt. Eine Rechnung mit
     * "Füssen" und "Musterstraße" deklarierte sechs Bytes zu viel. Ein
     * Leser, der `/Length` glaubt statt `endstream` zu suchen, liest über den
     * Strom hinaus.
     */
    for (const count of [1, 5, 11, 20]) {
      const file = latin1(renderInvoicePdf(invoiceFixture(count)));
      let streams = 0;
      for (const head of file.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
        const from = (head.index ?? 0) + head[0].length;
        const to = file.indexOf("\nendstream", from);
        expect(to, `n=${count}`).toBeGreaterThan(from);
        expect(Number(head[1]), `n=${count}, Strom ${streams + 1}`).toBe(to - from);
        streams += 1;
      }
      expect(streams, `n=${count}`).toBe(count >= 20 ? 2 : 1);
    }
  });

  it("und die Dokumente enthalten wirklich Nicht-ASCII", () => {
    /* Sonst prüfte die Zusicherung oben nichts. */
    const high = /[-ÿ]/;
    const texts = runs(renderInvoicePdf(invoiceFixture(1))).map((run) => run.text);
    expect(texts.filter((text) => high.test(text)).length).toBeGreaterThan(1);
  });

  it("die Querverweistabelle trifft jedes Objekt auf das Byte", () => {
    /* Dieselbe Verwechslung hätte auch die Offsets verschoben. */
    for (const count of [1, 20]) {
      const file = latin1(renderInvoicePdf(invoiceFixture(count)));
      const offsets = [...file.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
      expect(offsets.length, `n=${count}`).toBeGreaterThan(6);
      offsets.forEach((offset, index) => {
        expect(
          file.slice(offset, offset + 40).startsWith(`${index + 1} 0 obj\n`),
          `n=${count}, Objekt ${index + 1}`,
        ).toBe(true);
      });
    }
  });

  it("und die Startadresse zeigt auf die Tabelle", () => {
    const file = latin1(renderInvoicePdf(invoiceFixture(20)));
    const startxref = Number(/startxref\n(\d+)\n/.exec(file)![1]);
    expect(file.slice(startxref).startsWith("xref\n")).toBe(true);
  });
});

/* ==========================================================================
 * 6. Was die Rechnung NICHT geworden ist
 * ======================================================================== */

describe("der Rechnungspfad speichert nach wie vor keine Datei", () => {
  it("kein Storage, kein Eimer, kein signierter Link", () => {
    /*
     * Die Grundlage der ganzen Entscheidung: die maßgebliche Aufzeichnung ist
     * die unveränderliche Zeile in `public.invoices`, nicht das PDF. Fängt
     * jemand an, Dateien abzulegen, ist diese Datei hier nicht mehr die
     * richtige Absicherung — und das soll auffallen.
     */
    for (const path of [
      "src/lib/legal/invoice.ts",
      "src/lib/legal/invoice-pdf.ts",
      "src/app/(public)/rechnung/[orderNumber]/pdf/route.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      for (const forbidden of [
        "storage.from", "createSignedUrl", "getPublicUrl", ".upload(", "writeFile",
      ]) {
        expect(source, `${path} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
