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
