/**
 * What makes two uploads the same inventory snapshot (ADR-0087).
 *
 * NOT A HASH OF THE FILE. Hashing `skylanders.xlsx` would mean reading 450 MB
 * to identify 614 numbers — undoing the selective read the whole importer is
 * built on — and it would answer the wrong question besides. Re-saving the
 * workbook, replacing one figure's photograph or Excel choosing a different
 * compression level all change the bytes while changing nothing about the
 * stock. A fingerprint that called those "a different workbook" would be
 * measuring the wrong thing.
 *
 * WHAT IS FINGERPRINTED: the inventory content, canonicalised.
 *
 *     version           so a change to this format is never mistaken for a
 *                       change to the stock
 *     sheet             the game, which is half of a row's identity
 *     name              column B, trimmed, exactly as typed
 *     storage           column F, or null for a cell that holds no count
 *
 * Sorted by sheet then name, so inserting a row above another does not make an
 * unchanged workbook look new.
 *
 * DELIBERATELY BEFORE RESOLUTION. No SKY-ID, no classification. Those are
 * SkyIsles' reading of the workbook, and they move when the catalog gains a
 * figure or the owner saves a mapping — neither of which changes what is on
 * the shelf. A fingerprint that shifted when the catalog was edited could not
 * answer "is this the same stock-take as last time?", which is the only
 * question it has.
 *
 * WHAT IT IS FOR, AND NOT FOR. History, recognising a repeat, and telling the
 * owner he may have picked the file he already imported. **It never blocks an
 * import.** The spreadsheet is the truth about physical stock, and re-importing
 * the same one is harmless anyway — reconciliation against an absolute target
 * is idempotent: the second run computes nothing to do.
 */

/** Bumping this changes every fingerprint, which is the point. */
export const FINGERPRINT_VERSION = "skyisles-inventory-1";

/** One parsed row, reduced to what identifies the snapshot. */
export type FingerprintRow = {
  sheet: string;
  name: string;
  storage: number | null;
};

/**
 * The exact text that gets hashed.
 *
 * Exported because a fingerprint nobody can reproduce by hand is a fingerprint
 * nobody can debug. `JSON.stringify` does the escaping, so a name containing a
 * separator — or a newline, or a quote — cannot shift a field boundary.
 */
export function canonicalise(rows: readonly FingerprintRow[]): string {
  const lines = rows
    .map((row) => [row.sheet, row.name.trim(), row.storage] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1], "en") : a[0].localeCompare(b[0], "en")))
    .map((entry) => JSON.stringify(entry));

  return [FINGERPRINT_VERSION, ...lines].join("\n");
}

/**
 * SHA-256 of that text, as 64 lowercase hex characters.
 *
 * `crypto.subtle` is available wherever this runs; the input is well under a
 * megabyte, so there is nothing to stream.
 */
export async function fingerprint(rows: readonly FingerprintRow[]): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalise(rows));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
