/**
 * Is the current request an administrator?
 *
 * Since 0041 this means **platform administrator** and nothing else
 * (ADR-0077): the account runs SkyIsles — catalog, categories, testers,
 * platform settings. It grants nothing commercial. Running the shop is
 * `canOperateSeller()`, and neither capability implies the other.
 *
 * It delegates to `capabilities()` so there is one round trip and one answer
 * per request. `is_shop_admin()` still exists in the database as an alias for
 * `is_platform_admin()`, kept so anything not yet reclassified fails closed
 * for a seller rather than open.
 *
 * Two properties matter:
 *
 * 1. **The answer comes from the database, over the caller's own session.**
 *    Never from a claim the browser sent, never from a cookie the app wrote,
 *    never from component state. `is_shop_admin()` reads `auth.uid()` inside
 *    Postgres and consults a table no client can read or write.
 *
 * 2. **It is a convenience, not the boundary.** Hiding a link or answering
 *    404 is presentation. The boundary is that every editorial write goes
 *    through a `security definer` function that asks the same predicate again
 *    (migration `0004`), so a request that bypasses the UI entirely still
 *    fails in the database.
 *
 * Memoised per request like `currentUser`: a page and its layout both ask.
 */
import { isPlatformAdmin } from "@/lib/auth/capabilities";

export async function isAdmin(): Promise<boolean> {
  return isPlatformAdmin();
}
