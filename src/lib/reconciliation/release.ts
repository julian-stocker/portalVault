/**
 * THE RELEASE OF THE APPLY (step 6A, ADR-0178).
 *
 * The apply action for 0180 is prepared — and LOCKED until a separate
 * approval. While `APPLY_RELEASED` is `false`, `applySelection` answers
 * with a sentence and calls no database function at all, whatever calls it:
 * no page, no component, no crafted request can take a value over.
 *
 * Changing this is a release, not a setting: a commit, reviewed like any
 * other, after 0180 stands on Staging and the separate approval is given.
 * There is deliberately no environment variable for it — a flag in a
 * deployment would be a switch nobody reviews.
 *
 * Preparing (deciding a note, the preview) is NOT behind this lock: it
 * changes no sale.
 */
export const APPLY_RELEASED = false as boolean;
