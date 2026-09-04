/**
 * Username rules.
 *
 * These mirror the constraints in 0001_initial_schema.sql. The mirror exists
 * so the UI can reject obviously invalid input without a round trip — it is a
 * convenience, never a boundary. The database decides (ADR-0016).
 *
 * IMPORTANT: when this list changes, the CHECK constraint
 * `profiles_username_not_reserved` must change with it, and the other way
 * round. They are two halves of one rule.
 */

/** Mirrors profiles_username_format. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/** Mirrors profiles_username_not_reserved, compared case-insensitively. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin", "administrator", "root", "system", "superuser", "moderator", "mod",
  "api", "auth", "login", "logout", "signin", "signup", "register", "callback",
  "support", "help", "contact", "info", "mail", "email", "noreply", "no-reply",
  "portalvault", "portal", "vault", "skylanders", "skylander", "catalog",
  "collection", "profile", "profiles", "user", "users", "account", "settings",
  "dashboard", "search", "static", "assets", "images", "public", "www", "ftp",
  "about", "legal", "impressum", "datenschutz", "privacy", "terms", "agb",
  "null", "undefined", "me", "new", "edit", "delete", "test",
]);

export type UsernameProblem = "empty" | "too-short" | "too-long" | "invalid-characters" | "reserved";

/**
 * Checks a candidate against the mirrored rules.
 *
 * Returns null when the candidate is acceptable so far. That is deliberately
 * not the same as "available": uniqueness cannot be checked from the client,
 * because RLS lets a user see only their own profile row. Only the write
 * settles it (docs/AUTH.md, section 9.5).
 */
export function checkUsername(candidate: string): UsernameProblem | null {
  const value = candidate.trim();
  if (value === "") return "empty";
  if (value.length < USERNAME_MIN_LENGTH) return "too-short";
  if (value.length > USERNAME_MAX_LENGTH) return "too-long";
  if (!USERNAME_PATTERN.test(value)) return "invalid-characters";
  if (RESERVED_USERNAMES.has(value.toLowerCase())) return "reserved";
  return null;
}

/** True when the candidate passes every mirrored rule. */
export function isUsernameAcceptable(candidate: string): boolean {
  return checkUsername(candidate) === null;
}
