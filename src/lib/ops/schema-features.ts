/**
 * Features whose database half is NOT on every environment (Production release F0, 2026-11-12).
 *
 * Production stands at 0167 plus, after the release, 0190 and 0191. The
 * migrations 0168–0189 are on Staging only, by decision: they are not part of
 * the smallest Production release. Most of what they serve is already locked
 * to Staging where it is used — the CSV reconciliation
 * (`reconciliationEnvironment()`), the family clean-up and variant creation
 * (`isEditorialCatalogSource()`). Two operator features were not, and this
 * file is their switch:
 *
 *   legacySaleItemCorrectionsAvailable  0181 — correcting the items of an
 *       imported sale (`seller_correct_legacy_sale_item`,
 *       `seller_add_legacy_sale_item`, `seller_remove_legacy_added_item`,
 *       `seller_sale_item_corrections`)
 *   saleWithoutHoldAvailable            0184 — creating a sale WITHOUT a
 *       reservation (`seller_create_sale_with_details(…, p_hold)`)
 *
 * Without this switch the screen offered controls that could only end in an
 * error (PGRST202). With it, a Production deployment shows exactly what it
 * showed before these features existed, and the server actions refuse with
 * a sentence before any database call.
 *
 * STAGING ONLY, FAIL-CLOSED. The same rule as the two existing locks: only the
 * exact Staging project counts. A missing or unknown URL — `npm run dev`
 * against Production included — is "not available". When 0181 or 0184 is
 * rolled out to Production, the answer here changes in the same commit,
 * reviewed like any other; there is deliberately no environment variable.
 *
 * NOT A SECURITY BOUNDARY. It keeps the application from offering what the
 * database cannot do. The database stays the boundary: on Production the
 * functions do not exist, so nothing could be written anyway.
 */
import { isStagingProjectUrl } from "@/lib/admin/catalog-source";

function onStaging(): boolean {
  return isStagingProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/** 0181: the items of an imported sale may be corrected here. */
export function legacySaleItemCorrectionsAvailable(): boolean {
  return onStaging();
}

/** 0184: a sale may be created without reserving stock here. */
export function saleWithoutHoldAvailable(): boolean {
  return onStaging();
}
