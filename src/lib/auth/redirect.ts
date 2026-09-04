/**
 * Where to send someone after they sign in.
 *
 * The `next` parameter comes from the URL, so it is attacker-controlled. An
 * unchecked redirect would let a link that looks like PortalVault deposit a
 * visitor on someone else's site right after they typed their password.
 */

/** Where a signed-in user without a username has to go first. */
export const ONBOARDING_PATH = "/onboarding";
/** Default landing page after signing in: the visitor's own collection. */
export const DEFAULT_SIGNED_IN_PATH = "/collection";
/** Where the middleware sends anonymous visitors. */
export const SIGN_IN_PATH = "/login";

/**
 * Accepts only same-site paths.
 *
 * Rejected: absolute URLs, protocol-relative URLs ("//evil.example"), anything
 * that is not rooted at "/", and backslash forms some browsers normalise into
 * a host. Everything questionable falls back to the default.
 */
export function safeRedirect(next: string | null | undefined, fallback = DEFAULT_SIGNED_IN_PATH): string {
  if (!next) return fallback;

  const value = next.trim();
  if (value === "") return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.startsWith("/\\")) return fallback;
  if (value.includes("\\")) return fallback;
  // A colon before the first slash would mean a scheme slipped through.
  if (/^\/[^/]*:/.test(value)) return fallback;

  return value;
}

/**
 * The destination after a successful sign-in or confirmation.
 *
 * Onboarding wins over any requested target: without a username the app has
 * no display identity to work with.
 */
export function destinationAfterSignIn(
  hasUsername: boolean,
  next?: string | null,
): string {
  if (!hasUsername) return ONBOARDING_PATH;
  return safeRedirect(next);
}

/** Builds the sign-in URL the middleware redirects to, preserving the target. */
export function signInUrlFor(pathname: string, search = ""): string {
  const target = `${pathname}${search}`;
  if (target === "/" || target === SIGN_IN_PATH) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(target)}`;
}
