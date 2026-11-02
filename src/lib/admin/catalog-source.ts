/**
 * Is this deployment the editorial source of the catalogue? (ADR-0167)
 *
 * Staging is the only place where the catalogue is edited; Production is a
 * published mirror. The admin UI uses this to OFFER an edit only where it
 * belongs — today for "Variante von" in the figure editor.
 *
 * THIS IS NOT A SECURITY BOUNDARY. It hides a control; it does not stop a
 * write. The server-side lock on Production is CAT-13 (ADR-0167). Until then
 * this only makes sure the UI opens no new catalogue write path on
 * Production.
 *
 * FAIL-CLOSED. Only the exact Staging project counts. A missing or unknown
 * Supabase URL — a local `npm run dev` against Production included — is
 * treated as "not the editorial source".
 */

/** The Staging Supabase project (ADR-0149, `.env.staging`). Not a secret. */
export const STAGING_PROJECT_REF = "qqxcpesbwfxzgytkdsac";

/** Pure, so it can be tested without an environment. */
export function isStagingProjectUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === `${STAGING_PROJECT_REF}.supabase.co`;
  } catch {
    return false;
  }
}

/** For server code: reads the Supabase URL this deployment talks to. */
export function isEditorialCatalogSource(): boolean {
  return isStagingProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * May a figure be created AS A VARIANT here? (CAT-20)
 *
 * `admin_create_variant_figure` (`0166`) exists on Staging only — Production
 * deliberately does not get it (ADR-0167: the catalogue is edited on Staging
 * and published). So this is the same answer as `isEditorialCatalogSource()`,
 * named for what it decides: the dialog hides the choice, and
 * `createFigure()` refuses a variant before it reaches the database. If the
 * function were missing on Staging after all, the database refuses too
 * (`PGRST202`, `create-errors.ts`) — a second layer, not the first.
 */
export function canCreateVariants(): boolean {
  return isEditorialCatalogSource();
}
