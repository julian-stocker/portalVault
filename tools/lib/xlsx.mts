/**
 * A read-only reader for the legacy workbook.
 *
 * Enough of the XLSX format to read cells, and deliberately nothing else: no
 * dependency, no write path, no formula evaluation, no styles. The workbook is
 * opened for reading exactly once and is never written — `../webpage` is
 * strictly read-only (CLAUDE.md, rule 1), and a reader that cannot write is a
 * stronger guarantee than a rule that says it must not.
 *
 * An .xlsx file is a ZIP archive of XML parts. Both halves below are small:
 *
 *   the ZIP — walk the central directory, inflate the stored/deflated entries
 *   the XML — the sheet grammar is machine-generated and regular, so cells are
 *             scanned rather than parsed by a general XML parser
 *
 * This lives under `tools/` on purpose. Nothing in `src/` may import it: the
 * legacy workbook is internal data that never reaches the application, the
 * repository or the browser bundle (docs/SECURITY.md).
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/** Reads every entry out of a ZIP archive by walking its central directory. */
function unzip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();

  // The end-of-central-directory record is at the end of the file, behind a
  // comment of unknown length, so it has to be searched for backwards.
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("not a zip archive: no end-of-central-directory record");

  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    // The local header repeats name and extra field with its own lengths, and
    // those are the ones that say where the data actually starts.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);

    files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    // Last, so that "&amp;lt;" decodes to the text "&lt;" and not to "<".
    .replace(/&amp;/g, "&");
}

/** "A" → 0, "BC" → 54. Column letters are base-26 with A = 1. */
export function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference)?.[1] ?? "";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** One spreadsheet row. `cells` is keyed by zero-based column index. */
export type SheetRow = {
  /** The 1-based row number Excel shows, so a problem can be pointed at. */
  row: number;
  cells: Map<number, string>;
};

export class Workbook {
  private readonly files: Map<string, Buffer>;
  private readonly shared: string[] = [];
  /** Sheet name → path of its XML part, in the workbook's own order. */
  readonly sheets = new Map<string, string>();

  constructor(buffer: Buffer) {
    this.files = unzip(buffer);

    // Most text lives in one shared table, referenced by index from the cells.
    const strings = this.files.get("xl/sharedStrings.xml")?.toString("utf8");
    if (strings) {
      for (const [, item] of strings.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        // A string may be split across several formatting runs; the value is
        // all of their texts concatenated.
        const parts = [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]);
        this.shared.push(decodeXml(parts.join("")));
      }
    }

    const workbook = this.files.get("xl/workbook.xml")?.toString("utf8") ?? "";
    const relationships = this.files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";

    const targets = new Map<string, string>();
    for (const [, id, target] of relationships.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      targets.set(id, target.replace(/^\//, ""));
    }

    for (const [, attributes] of workbook.matchAll(/<sheet\s([^>]+?)\/?>/g)) {
      const name = /name="([^"]+)"/.exec(attributes)?.[1];
      const id = /r:id="([^"]+)"/.exec(attributes)?.[1];
      if (!name || !id) continue;
      const target = targets.get(id) ?? "";
      this.sheets.set(decodeXml(name), target.startsWith("xl/") ? target : `xl/${target}`);
    }
  }

  has(sheetName: string): boolean {
    return this.sheets.has(sheetName);
  }

  /** Every row of one sheet. Only the named sheet is decoded. */
  rows(sheetName: string): SheetRow[] {
    const path = this.sheets.get(sheetName);
    if (!path) throw new Error(`unknown sheet: ${sheetName}`);
    const xml = this.files.get(path)?.toString("utf8") ?? "";
    const rows: SheetRow[] = [];

    for (const [, attributes, body] of xml.matchAll(/<row\s([^>]*?)>([\s\S]*?)<\/row>/g)) {
      const number = Number(/r="(\d+)"/.exec(attributes)?.[1] ?? "0");
      const cells = new Map<number, string>();

      for (const [, cellAttributes, cellBody] of body.matchAll(
        /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      )) {
        const reference = /r="([A-Z]+\d+)"/.exec(cellAttributes)?.[1];
        if (!reference || cellBody === undefined) continue;
        const type = /t="([^"]+)"/.exec(cellAttributes)?.[1];
        let value: string | null = null;

        if (type === "inlineStr") {
          const parts = [...cellBody.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]);
          value = decodeXml(parts.join(""));
        } else {
          // For a formula cell this is the cached result, which is what the
          // legacy sheet's business columns are.
          const raw = /<v>([\s\S]*?)<\/v>/.exec(cellBody)?.[1];
          if (raw !== undefined) {
            value = type === "s" ? (this.shared[Number(raw)] ?? "") : decodeXml(raw);
          }
        }

        if (value !== null && value !== "") cells.set(columnIndex(reference), value);
      }

      rows.push({ row: number, cells });
    }

    return rows;
  }
}

/** Reads a workbook from disk. Read-only: the path is never opened for writing. */
export function readWorkbook(path: string): Workbook {
  return new Workbook(readFileSync(path));
}
