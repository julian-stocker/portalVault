/**
 * Whether issuing self-billed receipts is released for use.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * It is a switch for the SURFACE. It decides whether the dialogue offers to
 * issue a receipt at all. It is **not** the protection — the protection is a
 * database grant: `supabase/operations/lock-receipt-issuance.sql` takes
 * EXECUTE on `seller_issue_purchase_receipt(bigint)` and
 * `seller_issue_purchase_receipt_correction(bigint)` away from every API role
 * (`public`, `anon`, `authenticated`, `service_role`). Even if this constant
 * were flipped by accident, or a request were made by hand, the database would
 * refuse it with 42501.
 *
 * So the order is: the lock decides, this constant spares the operator a
 * button that would only ever answer "Dafür fehlt die Berechtigung."
 *
 * WHY A FILE OF ITS OWN
 *
 * The obvious home would be `purchase-receipt.ts` — but that module imports
 * both PDF renderers, and importing it from a client component would carry
 * the whole PDF code into the browser bundle for the sake of one boolean.
 *
 * WHEN THIS BECOMES `true`
 *
 * Only with release B, and only together with
 * `supabase/operations/unlock-receipt-issuance.sql`. Five preconditions are
 * open and listed in `supabase/checks/release_0126_0131.md`, section 6:
 * privacy notice for private sellers' sender data, retention periods, the tax
 * recognition of the receipt form, proven restorability, and the visual check
 * of receipt format 2. None of them is a code question.
 *
 * Downloading an EXISTING receipt stays available in both states — a document
 * that was issued must remain retrievable. On Production there are none yet.
 */
export const RECEIPT_ISSUANCE_RELEASED = false;
