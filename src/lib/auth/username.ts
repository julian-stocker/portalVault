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

/**
 * Mirrors profiles_username_format for an ordinary account.
 *
 * Letters, digits and underscore — what every account has always been able to
 * use, and still the whole rule for a collector.
 */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Mirrors the widened `profiles_username_format` from `0051`.
 *
 * A dot BETWEEN segments, never at either end and never doubled, so
 * `yulez.collectibles` is a name and `.yulez`, `yulez.` and `yulez..x` are
 * not — for anybody.
 *
 * Syntax only. Whether this account may USE a dot is a separate question that
 * only the database can answer, because it depends on a shop grant the client
 * cannot see (see `checkUsername`).
 */
export const BUSINESS_USERNAME_PATTERN = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/;

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

export type UsernameProblem =
  | "empty"
  | "too-short"
  | "too-long"
  | "invalid-characters"
  /** Syntactically a shop username, on an account that does not run a shop. */
  | "business-only"
  | "reserved";

/**
 * What the account is allowed to type, as far as the SERVER knows.
 *
 * Deliberately not a parameter the browser supplies. The caller passes what
 * `canOperateSeller()` returned — read from `my_capabilities()` in the
 * database over the caller's own session — so a request that asserts
 * `business: true` on its own gets nothing from it. And the database refuses
 * the write regardless: this only decides which message is shown.
 */
export type UsernameContext = { business: boolean };

/**
 * Checks a candidate against the mirrored rules.
 *
 * Returns null when the candidate is acceptable so far. That is deliberately
 * not the same as "available": uniqueness cannot be checked from the client,
 * because RLS lets a user see only their own profile row. Only the write
 * settles it (docs/AUTH.md, section 9.5).
 */
export function checkUsername(
  candidate: string,
  context: UsernameContext = { business: false },
): UsernameProblem | null {
  const value = candidate.trim();
  if (value === "") return "empty";
  if (value.length < USERNAME_MIN_LENGTH) return "too-short";
  if (value.length > USERNAME_MAX_LENGTH) return "too-long";

  if (!USERNAME_PATTERN.test(value)) {
    /*
     * Separating the two failures is the whole point of the context. A
     * collector who types `julian.stocker` has written something that is a
     * valid shop username and not a valid one for them, and telling them
     * "invalid characters" would invite them to try `julian.stocker2`.
     */
    if (!BUSINESS_USERNAME_PATTERN.test(value)) return "invalid-characters";
    if (!context.business) return "business-only";
    // Falls through: a shop name is still subject to every rule below.
  }

  if (RESERVED_USERNAMES.has(value.toLowerCase())) return "reserved";
  return null;
}

/** True when the candidate passes every mirrored rule for this account. */
export function isUsernameAcceptable(
  candidate: string,
  context: UsernameContext = { business: false },
): boolean {
  return checkUsername(candidate, context) === null;
}
