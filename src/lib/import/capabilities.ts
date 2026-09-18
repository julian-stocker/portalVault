/**
 * Can this browser do the import at all? (ADR-0087)
 *
 * The importer reads a 450 MB workbook in place, which needs four browser APIs
 * that not every browser has. The check belongs HERE — before the file is
 * touched, before anything is parsed, before an import batch exists — for one
 * reason: a browser that cannot inflate a worksheet should be told so, not
 * discovered halfway through by a `DecompressionStream is not defined` in a
 * catch block that renders "Die Datei konnte nicht gelesen werden".
 *
 * The lower-level guards in `xlsx-reader.ts` stay exactly where they are. This
 * is the gate that produces a sentence the owner can act on; those are the
 * assertions that keep a call site honest. Neither replaces the other.
 *
 * WHAT IS ACTUALLY REQUIRED, AND WHY EACH ONE
 *
 *     DecompressionStream    worksheets are deflate-raw inside the ZIP
 *     File.prototype.slice   the reason 0.05% of the file is read; without it
 *                            the whole 450 MB would have to enter memory
 *     crypto.subtle          the content fingerprint
 *     TextDecoder            the sheet XML
 *
 * Feature detection, never a user-agent string: the question is whether the API
 * is here, and the browser answers that directly.
 */

export type Capability = {
  /** Feature-detection name. English, for the log and the test. */
  key: string;
  present: () => boolean;
};

/**
 * `deflate-raw` is checked by construction, not by existence.
 *
 * Safari 16.4 shipped `DecompressionStream` supporting only `gzip` and
 * `deflate`, and a ZIP member is neither. The constructor throws on an unknown
 * format, which makes the useful question answerable directly.
 */
function hasDeflateRaw(): boolean {
  if (typeof DecompressionStream === "undefined") return false;
  try {
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

export const REQUIRED_CAPABILITIES: readonly Capability[] = [
  { key: "DecompressionStream deflate-raw", present: hasDeflateRaw },
  {
    key: "File.prototype.slice",
    present: () => typeof File !== "undefined" && typeof File.prototype.slice === "function",
  },
  {
    key: "crypto.subtle",
    present: () => typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function",
  },
  { key: "TextDecoder", present: () => typeof TextDecoder !== "undefined" },
];

/** The names of everything missing. Empty means the import can proceed. */
export function missingCapabilities(
  capabilities: readonly Capability[] = REQUIRED_CAPABILITIES,
): string[] {
  return capabilities.filter((capability) => !capability.present()).map((c) => c.key);
}
