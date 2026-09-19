/**
 * Reading a few hundred kilobytes out of a 450 MB spreadsheet (ADR-0087).
 *
 * THE MEASUREMENT THIS IS BUILT ON
 *
 * The owner's `skylanders.xlsx` is 450.3 MB. **449.4 MB of that is 554 embedded
 * PNGs** — in-cell pictures he needs for local stock-taking. The inventory
 * numbers are 0.9 MB.
 *
 * A ZIP is random-access: a directory at the end says where every member
 * begins. Measured against the real file, everything this importer needs lives
 * in the first 714 KB plus the last 42 KB:
 *
 *     end-of-central-directory + directory     42.3 KB   (at the very end)
 *     workbook.xml, its rels, sharedStrings    19.2 KB
 *     the six game worksheets                 111.7 KB
 *     ------------------------------------------------
 *     total that has to be read                ~0.75 MB   = 0.17 % of the file
 *
 * So the file never leaves the phone. The browser reads three slices of it and
 * sends the extracted rows — and the 4.5 MB serverless body limit, the private
 * bucket, the temporary-object lifecycle and the server-side decompression bomb
 * all stop being problems, because there is no upload to have them.
 *
 * `File.slice()` returns a view, not a copy: reading the last 64 KB of a 450 MB
 * file costs 64 KB of memory. That is the property the whole design rests on,
 * and it is why this runs on a phone.
 *
 * WHY NO LIBRARY
 *
 * Every XLSX library worth using parses the workbook, which means walking the
 * whole archive — the images included. Feeding one a 450 MB `File` materialises
 * hundreds of megabytes in a mobile browser to read 614 numbers. Inflating nine
 * known members with the platform's own `DecompressionStream` is about a
 * hundred lines and touches nothing else.
 */

/** A member of the archive, located but not yet read. */
type Entry = {
  name: string;
  /** 0 = stored, 8 = deflate. Nothing else appears in an XLSX. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

export type XlsxReadErrorKind = "not-a-zip" | "unsupported" | "missing-part" | "too-large";

export class XlsxReadError extends Error {
  /*
   * Written out rather than declared as a constructor parameter property.
   * Same field, same behaviour — but a parameter property is TypeScript that
   * cannot be erased, and `node --experimental-strip-types` refuses the whole
   * module for it. This reader is now shared with `tools/import-orderbook.mts`,
   * which runs under exactly that.
   */
  readonly kind: XlsxReadErrorKind;

  constructor(message: string, kind: XlsxReadErrorKind) {
    super(message);
    this.name = "XlsxReadError";
    this.kind = kind;
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** The directory lives at the end; 64 KB covers it plus any ZIP comment. */
const TAIL_BYTES = 64 * 1024;

/**
 * A guard against a crafted file, not against this one.
 *
 * The real workbook's largest needed member inflates 7.2×. Anything claiming to
 * expand past this is refused before a byte is decompressed — the one shape of
 * attack a ZIP reader has to care about.
 */
const MAX_MEMBER_BYTES = 32 * 1024 * 1024;

async function slice(file: Blob, start: number, end: number): Promise<DataView> {
  const buffer = await file.slice(start, end).arrayBuffer();
  return new DataView(buffer);
}

/** Read the central directory. Two slices, ~42 KB, whatever the file weighs. */
async function readDirectory(file: Blob): Promise<Map<string, Entry>> {
  const tailStart = Math.max(0, file.size - TAIL_BYTES);
  const tail = await slice(file, tailStart, file.size);

  // Scan backwards for the end-of-central-directory signature.
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i -= 1) {
    if (tail.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new XlsxReadError("Das ist keine .xlsx-Datei.", "not-a-zip");
  }

  const directorySize = tail.getUint32(eocd + 12, true);
  const directoryOffset = tail.getUint32(eocd + 16, true);

  if (directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    // ZIP64. The real workbook is far under 4 GB and never produces one; a file
    // that does is refused rather than silently misread.
    throw new XlsxReadError("Diese Datei ist zu groß für den Import.", "too-large");
  }

  const directory = await slice(file, directoryOffset, directoryOffset + directorySize);
  const decoder = new TextDecoder();
  const entries = new Map<string, Entry>();

  let at = 0;
  while (at + 46 <= directory.byteLength) {
    if (directory.getUint32(at, true) !== CENTRAL_SIGNATURE) break;

    const method = directory.getUint16(at + 10, true);
    const compressedSize = directory.getUint32(at + 20, true);
    const uncompressedSize = directory.getUint32(at + 24, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    const localHeaderOffset = directory.getUint32(at + 42, true);

    const name = decoder.decode(
      new Uint8Array(directory.buffer, directory.byteOffset + at + 46, nameLength),
    );
    entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset });

    at += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Inflate one member.
 *
 * The local header repeats the name and extra-field lengths, and they can
 * differ from the directory's — so the data offset is computed from the local
 * header, never assumed.
 */
async function readMember(file: Blob, entry: Entry): Promise<string> {
  if (entry.uncompressedSize > MAX_MEMBER_BYTES) {
    throw new XlsxReadError(`${entry.name} ist unerwartet groß.`, "too-large");
  }

  const header = await slice(file, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  const nameLength = header.getUint16(26, true);
  const extraLength = header.getUint16(28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;

  const compressed = file.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) {
    return new TextDecoder().decode(await compressed.arrayBuffer());
  }
  if (entry.method !== 8) {
    throw new XlsxReadError(`${entry.name} verwendet ein unbekanntes Format.`, "unsupported");
  }

  if (typeof DecompressionStream === "undefined") {
    /*
     * Available in Safari 16.4+, Chrome 103+, Firefox 113+. On anything older
     * the import cannot run in the browser — and this says so plainly rather
     * than failing in a way that reads like a broken file. The fallback, if it
     * is ever needed, is to post the ~0.75 MB window to the server and inflate
     * it there; that fits a serverless body many times over.
     */
    throw new XlsxReadError(
      "Dieser Browser kann die Datei nicht entpacken. Bitte aktualisiere ihn.",
      "unsupported",
    );
  }

  const stream = compressed.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/**
 * The parts of a workbook this importer reads, and nothing else.
 *
 * `docProps/core.xml` is in the list for one reason: it carries
 * `dcterms:modified`, which Excel rewrites on every save. That is the snapshot
 * time the stale-workbook check turns on.
 */
export type WorkbookParts = {
  workbook: string;
  rels: string;
  sharedStrings: string | null;
  core: string | null;
  /** Sheet name → its worksheet XML, for the sheets that were asked for. */
  sheets: Map<string, string>;
  /** What was actually read, for the import record. */
  bytesRead: number;
};

export async function readWorkbookParts(
  file: Blob,
  wantedSheets: readonly string[],
): Promise<WorkbookParts> {
  const entries = await readDirectory(file);

  const need = (name: string): Entry => {
    const entry = entries.get(name);
    if (!entry) throw new XlsxReadError(`${name} fehlt in der Datei.`, "missing-part");
    return entry;
  };

  const workbookEntry = need("xl/workbook.xml");
  const relsEntry = need("xl/_rels/workbook.xml.rels");

  const [workbook, rels] = await Promise.all([
    readMember(file, workbookEntry),
    readMember(file, relsEntry),
  ]);

  // rId → part path, so a sheet can be found by name rather than by guessing
  // that "SA" is `sheet1.xml`. It is not: in this workbook `SA` is sheet2.
  const target = new Map<string, string>();
  for (const match of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    target.set(match[1], `xl/${match[2].replace(/^\/+/, "").replace(/^\.\//, "")}`);
  }

  const sheets = new Map<string, string>();
  const wanted = new Set(wantedSheets);
  let bytesRead = workbookEntry.compressedSize + relsEntry.compressedSize;

  for (const tag of workbook.match(/<sheet\b[^>]*>/g) ?? []) {
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    const rid = /r:id="([^"]*)"/.exec(tag)?.[1];
    if (!name || !rid || !wanted.has(name)) continue;
    const path = target.get(rid);
    if (!path) continue;
    const entry = need(path);
    bytesRead += entry.compressedSize;
    sheets.set(name, await readMember(file, entry));
  }

  const sharedEntry = entries.get("xl/sharedStrings.xml");
  const coreEntry = entries.get("docProps/core.xml");
  if (sharedEntry) bytesRead += sharedEntry.compressedSize;
  if (coreEntry) bytesRead += coreEntry.compressedSize;

  return {
    workbook,
    rels,
    sharedStrings: sharedEntry ? await readMember(file, sharedEntry) : null,
    core: coreEntry ? await readMember(file, coreEntry) : null,
    sheets,
    bytesRead,
  };
}

/** `dcterms:modified` — when Excel last wrote this file. */
export function workbookModifiedAt(core: string | null): string | null {
  if (core === null) return null;
  const match = /<dcterms:modified[^>]*>([^<]+)<\/dcterms:modified>/.exec(core);
  if (!match) return null;
  const when = new Date(match[1]);
  return Number.isNaN(when.getTime()) ? null : when.toISOString();
}
