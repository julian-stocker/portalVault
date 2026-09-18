/**
 * A route PATTERN, from a pathname (ADR-0072).
 *
 * The question telemetry answers is "which kind of navigation is slow", so
 * `/skylanders/gold-fire-kraken` and `/skylanders/bash` are one thing:
 * `/skylanders/[slug]`. Aggregating by figure would give 565 samples of one
 * each and answer nothing.
 *
 * It is also the privacy boundary, and the reason normalisation happens HERE
 * rather than in the component: a query string can carry a search term
 * (`/?q=drobot`), so nothing but the pathname is ever looked at, and the
 * pattern that comes out is a fixed vocabulary of route shapes. There is no
 * code path that could emit a name somebody typed.
 */

/**
 * The dynamic segments this application actually has, as the App Router
 * defines them. A prefix, the position of the dynamic part, and its name.
 *
 * Pinned to the real routes rather than guessed from "a segment that looks
 * like an id": `/account/orders` and `/account/orders/SI-2026-001000` are
 * different routes, and a heuristic would have to decide which by shape.
 */
const DYNAMIC: ReadonlyArray<{ prefix: readonly string[]; name: string }> = [
  { prefix: ["skylanders"], name: "[slug]" },
  { prefix: ["account", "orders"], name: "[orderNumber]" },
  { prefix: ["business", "orders"], name: "[orderNumber]" },
  { prefix: ["admin", "catalog"], name: "[skyId]" },
];

/** Segments that are never dynamic, even under a prefix that has one. */
const RESERVED: ReadonlySet<string> = new Set(["categories"]);

/** Everything a pattern may contain once normalisation is done. */
export const ROUTE_PATTERN = /^\/[A-Za-z0-9[\]/_-]{0,63}$/;

/**
 * `/skylanders/gold-fire-kraken?x=1#y` → `/skylanders/[slug]`.
 *
 * Takes a pathname; a full URL would be an invitation to forget the query.
 * Anything unrecognised collapses to `/[unknown]` rather than being passed
 * through — a route this function has not been taught about must not become a
 * way for a path segment to reach the database.
 */
export function normalizeRoute(pathname: string): string {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return "/[unknown]";

  // Query and hash never even enter the comparison.
  const path = pathname.split("?")[0].split("#")[0];
  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return "/";

  for (const route of DYNAMIC) {
    const matchesPrefix = route.prefix.every((part, index) => segments[index] === part);
    if (!matchesPrefix) continue;
    if (segments.length !== route.prefix.length + 1) continue;
    const last = segments[route.prefix.length];
    if (RESERVED.has(last)) break;
    return `/${[...route.prefix, route.name].join("/")}`;
  }

  const rebuilt = `/${segments.join("/")}`;
  // A static route is passed through only if it looks like one. Anything with
  // a character we do not expect is not a route we know.
  return ROUTE_PATTERN.test(rebuilt) ? rebuilt : "/[unknown]";
}

/** Two pathnames that normalise the same are the same navigation target. */
export function sameRoute(a: string, b: string): boolean {
  return normalizeRoute(a) === normalizeRoute(b);
}
