/**
 * Which reader understands a file.
 *
 * One entry per report format. A second platform (Kleinanzeigen, a different
 * eBay locale) is one more entry that turns its own file into the same
 * `ExternalReport` — nothing downstream (coverage, matching, diff) knows which
 * platform a report came from beyond `ExternalOrder.channel`.
 */

import { EBAY_PARSER_ID, looksLikeEbayOrdersReport, parseEbayOrdersReport } from "./ebay/parse";
import type { ParseResult } from "./types";

export type SalesReportParser = {
  id: string;
  /** A cheap sniff over the text; true means "this reader should try". */
  detect: (text: string) => boolean;
  parse: (text: string, fileName: string) => ParseResult;
};

export const REPORT_PARSERS: readonly SalesReportParser[] = [
  { id: EBAY_PARSER_ID, detect: looksLikeEbayOrdersReport, parse: parseEbayOrdersReport },
];

/** Parse with the first reader that recognises the file. */
export function parseSalesReport(text: string, fileName: string): ParseResult {
  const parser = REPORT_PARSERS.find((p) => p.detect(text));
  if (!parser) return { ok: false, error: { code: "not_this_format" } };
  return parser.parse(text, fileName);
}
