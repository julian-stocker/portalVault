/**
 * Worksheet XML → rows (ADR-0087).
 *
 * Only what the importer reads: the name in column B and the Storage count in
 * column F. Everything else in those sheets — the private-collection block, the
 * market prices, the value aggregates, the in-cell pictures — is left where it
 * is.
 *
 * WHY COLUMN F AND NOT A HEADER LOOKUP
 *
 * The sheets' own header letters read `O / S / D` and the aggregate headings
 * say `DUPLICATES`; only the `Summary` sheet calls the column `STORAGE`. Those
 * labels are inconsistent leftovers, so matching on them would be matching on
 * the least reliable thing in the file. The POSITIONS are stable across all six
 * sheets and have been for the workbook's whole history.
 *
 * WHAT IS SKIPPED, AND WHY EACH ONE MATTERS
 *
 *   rows 1–3       header, totals, blank. Row 2 holds sheet sums — importing it
 *                  would propose a 299-unit "correction".
 *   nameless rows  spacers between sections.
 *   `#VALUE!`      not an error. Column A holds in-cell pictures, which have no
 *                  text form; every figure row looks like this.
 *
 * TOTALS ARE NEVER READ. Beyond row 2 being skipped, this parser has no concept
 * of a total — which is just as well: the SF sheet's own totals row sums from
 * row 6 while its data starts at row 4, so it under-reports by one unit. The
 * importer derives every figure from the data rows and cannot inherit that.
 */

/** One data row, as the importer understands it. */
export type SheetRow = {
  sheet: string;
  /** The spreadsheet row number, so a finding can be pointed at in Excel. */
  sourceRow: number;
  /** Column B, exactly as typed. Never trimmed of meaning, only of spaces. */
  name: string;
  /** Column F. `null` when the cell is empty — which is not the same as 0. */
  storage: number | null;
};

/** Data begins at row 4 on every game sheet. 1 = header, 2 = totals, 3 = blank. */
export const FIRST_DATA_ROW = 4;

/** `<si>` entries, in order. Cells of type `s` index into this. */
export function parseSharedStrings(xml: string | null): string[] {
  if (xml === null) return [];
  const out: string[] = [];
  for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    // An `<si>` can hold several `<t>` runs; the string is their concatenation.
    out.push(
      (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ""))
        .join(""),
    );
  }
  return out.map(unescapeXml);
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

/** The two cells this importer reads, from one `<row>`. */
function readRow(rowXml: string, shared: string[]): { name: string; storage: number | null } {
  let name = "";
  let storage: number | null = null;

  for (const cell of rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
    const ref = /r="([A-Z]+)\d+"/.exec(cell)?.[1];
    if (ref !== "B" && ref !== "F") continue;

    const type = /\bt="([^"]+)"/.exec(cell)?.[1];
    // An error cell (`t="e"`) carries `#VALUE!` and nothing usable. In column A
    // that is a picture; in B or F it is genuinely empty for our purposes.
    if (type === "e") continue;

    if (type === "inlineStr") {
      const inline = (cell.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ""))
        .join("");
      if (ref === "B") name = unescapeXml(inline).trim();
      continue;
    }

    const raw = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
    if (raw === undefined) continue;

    if (ref === "B") {
      name = type === "s" ? (shared[Number(raw)] ?? "").trim() : unescapeXml(raw).trim();
    } else {
      const value = Number(type === "s" ? (shared[Number(raw)] ?? "") : raw);
      // A fractional or negative storage count is not a count. Left null so it
      // surfaces as an invalid row rather than silently rounding.
      storage = Number.isInteger(value) && value >= 0 ? value : null;
    }
  }

  return { name, storage };
}

/** Every data row of one sheet, in order. */
export function parseSheet(sheetName: string, xml: string, shared: string[]): SheetRow[] {
  const rows: SheetRow[] = [];

  for (const rowXml of xml.match(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g) ?? []) {
    const sourceRow = Number(/\br="(\d+)"/.exec(rowXml)?.[1] ?? 0);
    if (sourceRow < FIRST_DATA_ROW) continue;

    const { name, storage } = readRow(rowXml, shared);
    if (name === "") continue;

    rows.push({ sheet: sheetName, sourceRow, name, storage });
  }

  return rows;
}
