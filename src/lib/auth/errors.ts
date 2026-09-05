/**
 * Translates authentication and database failures into messages a person can
 * act on.
 *
 * Two rules shape this file:
 *
 *   1. Sign-in and password-reset failures stay deliberately vague. Telling a
 *      visitor that an address is unknown, or that it exists but is not yet
 *      confirmed, hands them a way to enumerate accounts.
 *   2. Raw SQL errors, constraint names and stack traces never reach the UI.
 */
import { de } from "@/lib/i18n/de";

/** PostgreSQL error codes the profile writes can produce. */
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

export type FieldError = { field: "username" | "email" | "password" | "form"; message: string };

type MaybeError = { code?: string; message?: string; status?: number } | null | undefined;

/**
 * Maps a failed profile write to a field error.
 *
 * The unique index on lower(username) is what actually answers "is this name
 * taken" — there is no way to ask beforehand (docs/AUTH.md, section 9.5).
 * The two check constraints cannot be told apart by code alone, so the
 * mirrored rules in username.ts decide which message fits.
 */
export function profileWriteError(error: MaybeError, candidate: string): FieldError {
  if (error?.code === UNIQUE_VIOLATION) {
    return { field: "username", message: de.auth.errors.usernameTaken };
  }
  if (error?.code === CHECK_VIOLATION) {
    const reserved = error.message?.includes("not_reserved") ?? false;
    return {
      field: "username",
      message: reserved ? de.auth.errors.usernameReserved : de.auth.errors.usernameInvalid,
    };
  }
  void candidate;
  return { field: "form", message: de.auth.errors.generic };
}

/** Sign-in failures. Always the same message, whatever went wrong. */
export function signInError(error: MaybeError): FieldError {
  if (error?.status === 429) {
    return { field: "form", message: de.auth.errors.rateLimited };
  }
  return { field: "form", message: de.auth.errors.invalidCredentials };
}

/**
 * What `signUp` actually reported, beyond the error field.
 *
 * Only `user` and its `identities` are read, because those are the two the
 * confirmation flow depends on. A missing session is deliberately not treated
 * as a problem: with email confirmation switched on, no session is exactly
 * what a successful sign-up returns.
 */
type SignUpData =
  | {
      user?: { identities?: unknown[] | null } | null;
      /** Part of the real response, deliberately not read — see above. */
      session?: unknown;
    }
  | null
  | undefined;

/**
 * Decides whether a sign-up may show "check your inbox". `null` means it may.
 *
 * Supabase answers a sign-up for an address that already has an account
 * **without an error** when email confirmation is on: it returns a user whose
 * `identities` array is empty. That is its defence against account
 * enumeration, and it is right — but reading only `error` turns it into a
 * screen that promises a mail nobody will receive (docs/AUTH.md, section 9.13).
 *
 * `identities` being absent is not the same as being empty. Older responses
 * and other flows simply omit the field, and treating that as a failure would
 * break real sign-ups, so only an array that is present and empty counts.
 */
export function signUpOutcome(data: SignUpData, error: MaybeError): FieldError | null {
  if (error) return signUpError(error);

  const user = data?.user;
  // No error and no user at all: unexpected. Never announce success for a
  // response nobody planned for.
  if (!user) return { field: "form", message: de.auth.errors.generic };

  const identities = user.identities;
  if (Array.isArray(identities) && identities.length === 0) {
    return { field: "form", message: de.auth.errors.signUpNotCompleted };
  }

  return null;
}

/** Sign-up failures. Rate limits are worth naming; nothing else is. */
export function signUpError(error: MaybeError): FieldError {
  if (error?.status === 429) {
    return { field: "form", message: de.auth.errors.rateLimited };
  }
  if (error?.message?.toLowerCase().includes("password")) {
    return { field: "password", message: de.auth.errors.weakPassword };
  }
  return { field: "form", message: de.auth.errors.generic };
}

/** Setting a new password after a reset link, or from the settings page. */
export function passwordUpdateError(error: MaybeError): FieldError {
  if (error?.status === 429) {
    return { field: "form", message: de.auth.errors.rateLimited };
  }
  if (error?.message?.toLowerCase().includes("password")) {
    return { field: "password", message: de.auth.errors.weakPassword };
  }
  return { field: "form", message: de.auth.errors.sessionExpired };
}
