/**
 * THE RELEASE OF THE APPLY (ADR-0178, Ergänzung 2026-11-08).
 *
 * RELEASED. The operator's "Abgleich bestätigen" in the dialog IS the
 * explicit authorisation to take the selected values over — there is no
 * second approval, no admin switch, no extra confirmation step. What it
 * sends still goes through the whole 0180 chain: each decision recorded
 * with the values shown, a preview of exactly the take-overs, the shown
 * values checked against that preview, the apply with the preview's token,
 * judged again by the database under lock (`server/actions.ts`).
 *
 * STAGING ONLY, AND NOT BECAUSE OF THIS FLAG. Every reconciliation action
 * passes `reconciliationAvailable()` first: unless the server talks to the
 * Staging project it answers with a sentence and calls nothing. On
 * Production the 0180 functions do not exist either. Releasing here
 * therefore changes nothing on Production; a Production release needs 0180
 * there and its own decision.
 *
 * WHAT REMAINS OF THE FLAG is an emergency stop: committing `false` brings
 * back the locked state — the actions refuse before any database call and
 * the dialog's button stays disabled. Changing it is a commit, reviewed like
 * any other. There is deliberately no environment variable for it — a flag
 * in a deployment would be a switch nobody reviews.
 */
export const APPLY_RELEASED = true as boolean;
