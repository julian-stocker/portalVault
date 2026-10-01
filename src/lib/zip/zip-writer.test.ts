import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { readWorkbookParts } from "@/lib/import/xlsx-reader";
import { crc32 } from "./crc32";
import { isSafeZipPath, ZipPathError } from "./zip-path";
import { ZipLimitError, zipBytes, zipStream, type ZipEntry } from "./zip-writer";

/**
 * Der ZIP-Schreiber.
 *
 * Zwei Arten von Prüfung, beide nötig. Der **Roundtrip** öffnet ein
 * erzeugtes Archiv mit dem Leser, den das Projekt seit ADR-0087 hat — wenn
 * beide Seiten sich einig sind, stimmt das Format in der Praxis. Die
 * **Strukturtests** sehen in die Bytes: ein Archiv kann sich lesen lassen
 * und trotzdem ein falsches CRC oder ein fehlendes Verzeichnis tragen, und
 * das merkt erst der fremde Entpacker beim Kunden.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();
const text = (s: string) => enc.encode(s);

/** Ein kleines, gültiges WebP — echte Binärbytes mit Nullen darin. */
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x4c, 0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00,
  0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0x00, 0x00, 0x00,
]);

/* ------------------------------------------------------ ein Minimalleser */

type Found = { name: string; method: number; crc: number; comp: number; raw: number };

/** Liest das zentrale Verzeichnis — unabhängig vom Schreiber implementiert. */
function directory(zip: Uint8Array): Found[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  expect(eocd, "kein EOCD gefunden").toBeGreaterThanOrEqual(0);

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out: Found[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true), "keine Central-Signatur").toBe(0x02014b50);
    const nameLen = view.getUint16(at + 28, true);
    out.push({
      name: dec.decode(zip.subarray(at + 46, at + 46 + nameLen)),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      comp: view.getUint32(at + 20, true),
      raw: view.getUint32(at + 24, true),
    });
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
}

/** Holt den Inhalt eines Eintrags über seinen lokalen Kopf. */
async function member(zip: Uint8Array, name: string): Promise<Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(at + 28, true);
    const found = dec.decode(zip.subarray(at + 46, at + 46 + nameLen));
    const method = view.getUint16(at + 10, true);
    const comp = view.getUint32(at + 20, true);
    const local = view.getUint32(at + 42, true);
    if (found === name) {
      expect(view.getUint32(local, true), "keine Local-Signatur").toBe(0x04034b50);
      const start = local + 30 + view.getUint16(local + 26, true)
        + view.getUint16(local + 28, true);
      const body = zip.subarray(start, start + comp);
      if (method === 0) return body;
      const stream = new Blob([body as BlobPart]).stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  throw new Error(`${name} nicht im Archiv`);
}

/* ------------------------------------------------------------- Laufzeit */

describe("die Laufzeit kann, was der Schreiber braucht", () => {
  it("kennt deflate-raw in beide Richtungen", async () => {
    // Ohne das gäbe es keinen Schreiber ohne Abhängigkeit — deshalb steht
    // die Prüfung hier und nicht in einer Annahme.
    expect(typeof CompressionStream).toBe("function");
    const data = text("x".repeat(1000));
    const packed = new Uint8Array(await new Response(
      new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw")),
    ).arrayBuffer());
    expect(packed.length).toBeLessThan(data.length);
    const back = new Uint8Array(await new Response(
      new Blob([packed as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
    ).arrayBuffer());
    expect(back).toEqual(data);
  });
});

/* ------------------------------------------------------------- CRC32 */

describe("CRC32", () => {
  it("trifft die bekannten Prüfvektoren", () => {
    expect(crc32(text(""))).toBe(0);
    expect(crc32(text("123456789")).toString(16)).toBe("cbf43926");
    expect(crc32(text("a")).toString(16)).toBe("e8b7be43");
  });

  it("liefert nie eine negative Zahl", () => {
    // Bitoperationen sind in JavaScript vorzeichenbehaftet; ohne `>>> 0`
    // schriebe `setUint32` still den falschen Wert.
    for (const s of ["", "a", "Grüße", "\u0000\u00ff", "x".repeat(5000)]) {
      expect(crc32(text(s))).toBeGreaterThanOrEqual(0);
    }
  });

  it("und steht so auch im Archiv", async () => {
    const zip = await zipBytes([{ path: "a.txt", bytes: text("123456789") }]);
    expect(directory(zip)[0].crc).toBe(crc32(text("123456789")));
  });
});

/* ---------------------------------------------------------- Pfadprüfung */

describe("Archivpfade", () => {
  const verboten = ["", "/abs.json", "C:/x.json", "a\\b.json", "../x.json",
                    "a/../b.json", "a/./b.json", "a//b.json", "dir/", "x\u0000y.json",
                    "a\nb.json", "a\u007fb.json"];

  it("weist jeden gefährlichen Pfad zurück", () => {
    for (const p of verboten) {
      expect(isSafeZipPath(p), `${JSON.stringify(p)} wurde erlaubt`).toBe(false);
    }
  });

  it("und der Schreiber legt einen solchen Eintrag gar nicht erst an", async () => {
    for (const p of verboten) {
      await expect(zipBytes([{ path: p, bytes: text("x") }])).rejects.toBeInstanceOf(ZipPathError);
    }
  });

  it("erlaubt normale, auch Unicode-Pfade", () => {
    for (const p of ["a.json", "storage/catalog/SKY-0007/x.webp", "Grüße/Ünicöde.json"]) {
      expect(isSafeZipPath(p), `${p} wurde abgelehnt`).toBe(true);
    }
  });

  it("weist einen doppelten Pfad zurück", async () => {
    // Welcher Eintrag gilt, entschiede sonst der Entpacker.
    await expect(zipBytes([
      { path: "a.json", bytes: text("1") },
      { path: "a.json", bytes: text("2") },
    ])).rejects.toBeInstanceOf(ZipLimitError);
  });
});

/* ------------------------------------------------------- Strukturtests */

describe("die Bytes eines erzeugten Archivs", () => {
  const entries: ZipEntry[] = [
    { path: "manifest.json", bytes: text('{"format":"test"}') },
    { path: "leer.txt", bytes: new Uint8Array(0) },
    { path: "storage/catalog/SKY-0007/bild.webp", bytes: WEBP },
    { path: "Grüße/Ünicöde.json", bytes: text('{"ä":"ö"}') },
    { path: "gross.json", bytes: text("x".repeat(20000)) },
  ];

  it("beginnt mit einer lokalen Signatur und endet mit dem EOCD", async () => {
    const zip = await zipBytes(entries);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });

  it("führt genau die erwarteten Einträge, keinen mehr", async () => {
    const found = directory(await zipBytes(entries));
    expect(found.map((f) => f.name)).toEqual(entries.map((e) => e.path));
    expect(found).toHaveLength(entries.length);
  });

  it("nennt je Eintrag die richtige Prüfsumme und die richtige Rohgröße", async () => {
    const found = directory(await zipBytes(entries));
    for (const [i, e] of entries.entries()) {
      expect(found[i].crc, `${e.path}: CRC`).toBe(crc32(e.bytes));
      expect(found[i].raw, `${e.path}: Größe`).toBe(e.bytes.length);
    }
  });

  it("komprimiert, wo es lohnt, und speichert, wo nicht", async () => {
    const found = directory(await zipBytes(entries));
    const by = (n: string) => found.find((f) => f.name === n)!;
    // 20 000 gleiche Zeichen: deflate gewinnt deutlich.
    expect(by("gross.json").method).toBe(8);
    expect(by("gross.json").comp).toBeLessThan(by("gross.json").raw / 10);
    // Eine leere Datei wird nie deflatiert.
    expect(by("leer.txt").method).toBe(0);
    expect(by("leer.txt").comp).toBe(0);
    expect(by("leer.txt").raw).toBe(0);
  });

  it("setzt das UTF-8-Bit, damit Umlaute nicht als CP437 gelesen werden", async () => {
    const zip = await zipBytes(entries);
    const view = new DataView(zip.buffer);
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
  });

  it("schreibt kein Zip64 und braucht bei dieser Größe auch keines", async () => {
    const zip = await zipBytes(entries);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(zip.length - 22 + 12, true)).not.toBe(0xffffffff);
    expect(view.getUint32(zip.length - 22 + 16, true)).not.toBe(0xffffffff);
  });
});

/* ------------------------------------------------------------ Inhalte */

describe("Inhalte kommen unverändert wieder heraus", () => {
  it("Text bleibt Text", async () => {
    const body = '{"format":"skyisles","zahl":"7.85","null":null}';
    const zip = await zipBytes([{ path: "database.json", bytes: text(body) }]);
    expect(dec.decode(await member(zip, "database.json"))).toBe(body);
  });

  it("Binärdaten bleiben byte-identisch", async () => {
    // Der Fall, an dem ein Schreiber scheitert, der Bytes als Text behandelt.
    const zip = await zipBytes([{ path: "storage/catalog/a.webp", bytes: WEBP }]);
    expect(await member(zip, "storage/catalog/a.webp")).toEqual(WEBP);
  });

  it("eine leere Datei bleibt leer", async () => {
    const zip = await zipBytes([{ path: "leer.txt", bytes: new Uint8Array(0) }]);
    expect((await member(zip, "leer.txt")).length).toBe(0);
  });

  it("ein Unicode-Name kommt unversehrt zurück", async () => {
    const zip = await zipBytes([{ path: "Grüße/Ünicöde.json", bytes: text("ä") }]);
    expect(directory(zip)[0].name).toBe("Grüße/Ünicöde.json");
    expect(dec.decode(await member(zip, "Grüße/Ünicöde.json"))).toBe("ä");
  });

  it("alle Bytewerte von 0 bis 255 überstehen die Runde", async () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    const zip = await zipBytes([{ path: "bytes.bin", bytes: all }]);
    expect(await member(zip, "bytes.bin")).toEqual(all);
  });

  it("auch ohne Kompression", async () => {
    const zip = await zipBytes([{ path: "a.json", bytes: text("x".repeat(5000)) }],
                               { compress: false });
    expect(directory(zip)[0].method).toBe(0);
    expect(dec.decode(await member(zip, "a.json"))).toBe("x".repeat(5000));
  });
});

/* ------------------------------------------------------- Determinismus */

describe("Determinismus", () => {
  it("gleiche Eingabe ergibt Byte für Byte dasselbe Archiv", async () => {
    const make = () => zipBytes([
      { path: "a.json", bytes: text("eins") },
      { path: "b/c.json", bytes: text("zwei") },
    ]);
    expect(await make()).toEqual(await make());
  });

  it("der Schreiber fragt die Uhr nicht selbst", async () => {
    /*
     * Ohne diese Eigenschaft wären zwei Sicherungen desselben Zustands
     * nicht vergleichbar. Ohne Kommentare geprüft: die Prosa des Moduls
     * erklärt genau diese Regel und nennt die verbotenen Aufrufe dabei
     * beim Namen.
     */
    const source = readFileSync("src/lib/zip/zip-writer.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(source).not.toContain("Date.now()");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("crypto.randomUUID");
    // Der einzige erlaubte Zeitbezug ist der übergebene Wert.
    expect(source).toContain("options.modifiedAt ?? DOS_EPOCH");
  });

  it("eine mitgegebene Zeit landet im Kopf", async () => {
    const zip = await zipBytes([{ path: "a.json", bytes: text("x") }],
                               { modifiedAt: new Date(Date.UTC(2026, 8, 30, 14, 30, 12)) });
    const view = new DataView(zip.buffer);
    // 2026 = 46 Jahre nach 1980, September = 9, Tag 30.
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (9 << 5) | 30);
    expect(view.getUint16(10, true)).toBe((14 << 11) | (30 << 5) | 6);
  });

  it("die Reihenfolge der Einträge bleibt die des Aufrufers", async () => {
    const paths = ["z.json", "a.json", "m/b.json"];
    const found = directory(await zipBytes(paths.map((p) => ({ path: p, bytes: text(p) }))));
    expect(found.map((f) => f.name)).toEqual(paths);
  });
});

/* ---------------------------------------------------------- Streaming */

describe("gestreamt statt gepuffert", () => {
  it("gibt das Archiv in Blöcken aus", async () => {
    const blocks: Uint8Array[] = [];
    for await (const b of zipStream([
      { path: "a.json", bytes: text("eins") },
      { path: "b.json", bytes: text("zwei") },
    ])) blocks.push(b);
    // Je Eintrag Kopf und Daten, dazu zwei Verzeichniseinträge und das EOCD.
    expect(blocks.length).toBeGreaterThanOrEqual(7);
  });

  it("die Blöcke ergeben zusammengesetzt genau das gepufferte Archiv", async () => {
    const entries: ZipEntry[] = [
      { path: "a.json", bytes: text("eins") },
      { path: "bild.webp", bytes: WEBP },
      { path: "leer.txt", bytes: new Uint8Array(0) },
    ];
    const blocks: Uint8Array[] = [];
    for await (const b of zipStream(entries)) blocks.push(b);
    const joined = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of blocks) { joined.set(b, at); at += b.length; }
    expect(joined).toEqual(await zipBytes(entries));
  });

  it("hält nie mehr als einen Eintrag im Speicher", async () => {
    /*
     * Die Eigenschaft, auf der der spätere Download beruht: der Generator
     * gibt den ersten Block heraus, bevor der letzte Eintrag überhaupt
     * gelesen wurde. Geprüft, indem nur ein Block abgeholt wird.
     */
    let gelesen = 0;
    const entries = Array.from({ length: 50 }, (_, i) => ({
      get path() { return `datei-${i}.json`; },
      get bytes() { gelesen++; return text(`Inhalt ${i}`); },
    }));
    const iterator = zipStream(entries as ZipEntry[])[Symbol.asyncIterator]();
    await iterator.next();
    expect(gelesen).toBeLessThan(5);
    await iterator.return?.(undefined);
  });
});

/* ---------------------------------------- Roundtrip mit dem echten Leser */

describe("der vorhandene xlsx-Leser öffnet ein erzeugtes Archiv", () => {
  /*
   * Die härteste Prüfung: nicht mein Schreiber gegen meinen Leser, sondern
   * gegen den, den dieses Projekt seit ADR-0087 einsetzt. Er sucht das EOCD
   * rückwärts, liest das zentrale Verzeichnis, springt an den lokalen Kopf
   * und entpackt mit `DecompressionStream`. Stimmt eines davon nicht, findet
   * er die Teile nicht.
   */
  const SHEET = '<worksheet><sheetData><row r="1"><c t="inlineStr">'
    + "<is><t>Bestand</t></is></c></row></sheetData></worksheet>";
  const WORKBOOK = '<?xml version="1.0"?><workbook><sheets>'
    + '<sheet name="SA" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const RELS = '<?xml version="1.0"?><Relationships>'
    + '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';

  async function workbook(): Promise<Blob> {
    const zip = await zipBytes([
      { path: "xl/workbook.xml", bytes: text(WORKBOOK) },
      { path: "xl/_rels/workbook.xml.rels", bytes: text(RELS) },
      { path: "xl/worksheets/sheet1.xml", bytes: text(SHEET) },
    ]);
    return new Blob([zip as BlobPart]);
  }

  it("findet Verzeichnis, Teile und Inhalte wieder", async () => {
    const parts = await readWorkbookParts(await workbook(), ["SA"]);
    expect(parts.workbook).toBe(WORKBOOK);
    expect(parts.rels).toBe(RELS);
    expect(parts.sheets.get("SA")).toBe(SHEET);
  });

  it("auch wenn ein Teil gespeichert statt komprimiert wurde", async () => {
    const zip = await zipBytes([
      { path: "xl/workbook.xml", bytes: text(WORKBOOK) },
      { path: "xl/_rels/workbook.xml.rels", bytes: text(RELS) },
      { path: "xl/worksheets/sheet1.xml", bytes: text(SHEET) },
    ], { compress: false });
    const parts = await readWorkbookParts(new Blob([zip as BlobPart]), ["SA"]);
    expect(parts.sheets.get("SA")).toBe(SHEET);
  });

  it("und meldet ein fehlendes Teil, statt still etwas Falsches zu liefern", async () => {
    const zip = await zipBytes([{ path: "xl/workbook.xml", bytes: text(WORKBOOK) }]);
    await expect(readWorkbookParts(new Blob([zip as BlobPart]), ["SA"])).rejects.toThrow();
  });
});

describe("die Einträge dürfen auch faul kommen", () => {
  /**
   * Erweiterung für den Plattform-Export: `zipStream` nimmt neben einem Array
   * auch ein `AsyncIterable`. Der Grund ist Speicher — ein Archiv mit
   * hunderten Storage-Dateien soll nicht erst vollständig im RAM entstehen.
   * `zipStream` sieht jeden Eintrag genau einmal und behält danach nur seine
   * Kopfdaten, also ist der Spitzenbedarf EIN Eintrag.
   */
  async function* lazy(entries: ZipEntry[]): AsyncGenerator<ZipEntry> {
    for (const entry of entries) yield entry;
  }

  const drei: ZipEntry[] = [
    { path: "a.txt", bytes: enc.encode("eins") },
    { path: "b/c.txt", bytes: enc.encode("zwei") },
    { path: "d.bin", bytes: new Uint8Array([0, 1, 2, 255]) },
  ];

  it("erzeugt byteweise dasselbe Archiv wie aus einem Array", async () => {
    const ausArray = await zipBytes(drei);
    const ausGenerator = await zipBytes(lazy([...drei]));
    expect([...ausGenerator]).toEqual([...ausArray]);
  });

  it("verlangt die Einträge erst, wenn sie gebraucht werden", async () => {
    const gefragt: string[] = [];
    async function* zaehlend(): AsyncGenerator<ZipEntry> {
      for (const entry of drei) {
        gefragt.push(entry.path);
        yield entry;
      }
    }
    const stream = zipStream(zaehlend());
    // Ein Eintrag ergibt zwei Blöcke: Kopf und Inhalt.
    await stream.next();
    expect(gefragt).toEqual(["a.txt"]);
    await stream.next();
    expect(gefragt).toEqual(["a.txt"]);
  });

  it("prüft Pfade und Dopplungen auch bei fauler Quelle", async () => {
    await expect(zipBytes(lazy([
      { path: "a.txt", bytes: enc.encode("x") },
      { path: "a.txt", bytes: enc.encode("y") },
    ]))).rejects.toThrow(ZipLimitError);
    await expect(zipBytes(lazy([
      { path: "../weg.txt", bytes: enc.encode("x") },
    ]))).rejects.toThrow(ZipPathError);
  });

  /*
   * Ein eigener Roundtrip steht hier absichtlich nicht: die Byte-Gleichheit
   * oben ist der stärkere Beweis. Sind die Archive identisch, liest der
   * Leser des Projekts beide gleich — und für den Array-Weg gibt es den
   * Roundtrip schon.
   */
});
