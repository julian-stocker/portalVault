/**
 * Which sentences an analysis refusal may put on screen.
 *
 * `analyseReconciliation` answers `{ ok: false, message }`, and every
 * `message` it builds is a fixed sentence from `de.ts` — the gate, the upload
 * check, and `message()` for database errors, which falls back to
 * `writeFailed` and keeps the database text in the server log. This list is
 * the second line: the screen shows a refusal only if it is one of these
 * sentences, otherwise the general one. A later change to the action that
 * passed through a raw database text (a SQL error, a report value) would be
 * caught here, not shown.
 */
import { de } from "@/lib/i18n/de";

const errors = de.business.reconciliation.errors;

/** Every sentence `analyseReconciliation` can refuse with (`analyse-messages.test.ts`). */
export const ANALYSE_MESSAGES: ReadonlySet<string> = new Set([
  errors.notAvailable, de.admin.notAllowed,
  errors.invalidUpload, errors.mixedFormats, errors.conflictingOrders, errors.noOrders,
  errors.stale, errors.countChanged, errors.duplicateReference, errors.rejected, errors.notPossible,
  de.admin.writeFailed,
]);

/** The refusal as it may be shown: a known sentence, or `fallback`. */
export function shownRefusal(message: unknown, fallback: string): string {
  return typeof message === "string" && ANALYSE_MESSAGES.has(message) ? message : fallback;
}
