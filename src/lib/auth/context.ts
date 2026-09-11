/**
 * Why somebody is looking at a sign-in form.
 *
 * The auth screens have always been silent about it: a visitor taps a figure
 * to collect it, the card links to `/login?next=/?series=…&figure=SKY-0042`
 * (ADR-0027), and what arrives is a bare e-mail and password field. The intent
 * was carried perfectly and then never mentioned.
 *
 * THIS READS `next`. IT DOES NOT CHANGE IT.
 *
 * No new parameter, no new redirect, no change to `safeRedirect()` or to what
 * happens after signing in. The value is inspected to pick one sentence, and
 * that is the whole of it — an unrecognised or absent `next` simply yields
 * `null` and the screens look exactly as they did.
 */

/** The situations the auth screens can name. */
export type AuthContext = "collect" | "collection" | "account" | "cart" | "checkout";

/** Catalog links carry the figure somebody was about to collect (ADR-0027). */
const FIGURE_PARAM = /[?&]figure=SKY-[0-9]{4}(?:&|$)/;

/**
 * What the visitor was doing, from the path they asked for.
 *
 * `collect` is the only one that is not simply "you asked for a protected
 * page": the catalog itself is public, so a `next` pointing at `/` means
 * something else brought them here — and the `figure` parameter says what.
 *
 * `cart` and `checkout` are recognised but no link in the product produces
 * them today: both pages work signed out (ADR-0043), so nothing redirects
 * away from them. They are here because a visitor can still arrive from one
 * by hand, and because leaving a known path unnamed is how the "unknown path
 * highlights nothing" rule in `nav/sections.ts` got written in the first
 * place.
 */
export function authContext(next: string | null | undefined): AuthContext | null {
  if (typeof next !== "string" || next === "") return null;

  // Query string and trailing slash are noise for every case but `collect`,
  // which is the one that reads a parameter.
  const [rawPath = ""] = next.split("#");
  const path = (rawPath.split("?")[0] ?? "").replace(/\/+$/, "") || "/";

  if (path === "/" || path === "/skylanders" || path.startsWith("/skylanders/")) {
    return FIGURE_PARAM.test(rawPath) ? "collect" : null;
  }

  if (path === "/collection" || path === "/dashboard") return "collection";
  if (path === "/settings" || path === "/onboarding") return "account";
  if (path === "/cart") return "cart";
  if (path === "/checkout") return "checkout";

  return null;
}

/**
 * Should "Konto erstellen" be offered as an action rather than a footnote?
 *
 * Only for `collect`. Somebody who tapped a figure has, with high likelihood,
 * no account yet — nobody signs out and then browses a catalog to collect
 * something. Every other context reaches the form from a page that already
 * implies an account exists, and there the sign-in is the likely intent.
 */
export function favoursRegistration(context: AuthContext | null): boolean {
  return context === "collect";
}
