/**
 * A small, strict CSV reader (RFC 4180 plus what real exports do).
 *
 * The project had no CSV reader — CSV was only ever written. This one reads
 * exactly what the reconciliation needs and nothing it does not:
 *
 *   * a UTF-8 byte order mark at the start is dropped;
 *   * the delimiter is a parameter (eBay's German reports use `;`);
 *   * a field may be quoted; inside quotes the delimiter and line breaks are
 *     data, and `""` is one quote;
 *   * `\r\n`, `\n` and a lone `\r` all end a record.
 *
 * It returns every record, empty ones included, because in a report the
 * position of an empty line can mean something (eBay puts one between the
 * header and the data). Interpreting records is the caller's job.
 *
 * Pure and dependency-free: it runs unchanged in the browser, where a report
 * is read, and in Vitest.
 */

export type CsvRecord = {
  /** 1-based line number on which the record starts. */
  line: number;
  fields: string[];
};

export type CsvResult = {
  records: CsvRecord[];
  /** A quote opened and never closed — the last record ran to the end of the file. */
  unterminatedQuote: boolean;
};

export function parseCsv(text: string, delimiter = ","): CsvResult {
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\n" || delimiter === "\r") {
    throw new Error("parseCsv: the delimiter must be one character other than a quote or a line break");
  }
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  // Whether anything at all has been read for the current record. Without it a
  // file ending in a line break would yield one phantom empty record.
  let started = false;

  const endField = () => {
    fields.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push({ line: recordLine, fields });
    fields = [];
    started = false;
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (!started) {
      started = true;
      recordLine = line;
    }

    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n" || (ch === "\r" && source[i + 1] !== "\n")) line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === "") {
      // A quote opens a quoted field only at its start; elsewhere it is data,
      // which is what spreadsheet exports produce for `5" Figur`.
      quoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      endRecord();
      line += 1;
    } else {
      field += ch;
    }
  }

  const unterminatedQuote = quoted;
  if (started) endRecord();
  return { records, unterminatedQuote };
}

/** True when a record has no content at all (`;;;;` counts as empty). */
export const isEmptyRecord = (fields: readonly string[]): boolean =>
  fields.every((field) => field.trim() === "");
