/**
 * Which part of the product a route belongs to.
 *
 * The navigation has three destinations but the app has more routes than
 * that: a figure detail page is still "the catalog", and onboarding is still
 * "the account area". Mapping that in one pure function keeps it out of the
 * layouts, where the previous version simply passed `null` for every
 * protected route and left the active state broken.
 *
 * Deliberately exhaustive rather than clever: no prefix guessing beyond the
 * one nested route that exists, and an unknown path highlights nothing
 * instead of guessing wrong.
 */
export type NavSection = "catalog" | "collection" | "account" | "admin" | "inventory" | "cart";

/** Route prefix of the figure detail pages. */
const DETAIL_PREFIX = "/skylanders/";

export function activeSection(pathname: string): NavSection | null {
  // Trailing slashes and query strings never reach here — usePathname()
  // returns a clean path — but a defensive trim costs nothing.
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/") return "catalog";
  if (path === "/skylanders" || path.startsWith(DETAIL_PREFIX)) return "catalog";

  // /dashboard redirects to /collection; both belong to the same section, so
  // the highlight does not flicker during the redirect.
  if (path === "/collection" || path === "/dashboard") return "collection";

  // The cart is reached from the header badge, not from the bar (ADR-0043),
  // so nothing in the bar lights up for it — but it is still its own section
  // rather than "the catalog", which is what it would default to otherwise.
  if (path === "/cart") return "cart";

  if (path === "/settings" || path === "/onboarding") return "account";

  // Stock has its own destination in the bar, so it lights up on its own
  // rather than as part of the administration area (ADR-0037).
  if (path === "/admin/inventory" || path.startsWith("/admin/inventory/")) return "inventory";

  // The administration area, including everything under it.
  if (path === "/admin" || path.startsWith("/admin/")) return "admin";

  return null;
}
