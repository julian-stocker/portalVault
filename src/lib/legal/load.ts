/**
 * The seller data for the legal pages and the footer, once per request
 * (ADR-0184, AP5).
 *
 * `fetchSellerLegal()` reads and classifies the row; `resolveLegalTexts()`
 * checks it against what the texts state. This wrapper only adds the log line
 * for a mismatch — codes, never values — and the per-request memo, so the page
 * and the footer agree on one answer.
 */
import { cache } from "react";

import { fetchSellerLegal } from "@/lib/identity/public";
import { resolveLegalTexts, type LegalTextsResult } from "@/lib/legal/seller-text";

export const loadLegalTexts = cache(async (): Promise<LegalTextsResult> => {
  const result = resolveLegalTexts(await fetchSellerLegal());
  if (result.status === "unavailable" && result.cause === "mismatch") {
    console.error(`[legal] seller data does not match the current texts: ${result.codes.join(", ")}`);
  }
  return result;
});
