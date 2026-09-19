/**
 * Server Actions for authentication.
 *
 * Everything that writes goes through here rather than through the browser
 * client, so the session is read from httpOnly cookies and validated on the
 * server. No action trusts a user id sent from the client: it always comes
 * from `getUser()`.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { currentProfile as readProfile, type Profile } from "@/lib/auth/profile";
import { canOperateSeller } from "@/lib/auth/capabilities";
import { checkUsername } from "@/lib/auth/username";
import {
  passwordUpdateError,
  profileWriteError,
  signInError,
  signUpOutcome,
  type FieldError,
} from "@/lib/auth/errors";
import {
  DEFAULT_SIGNED_IN_PATH,
  PASSWORD_CHANGED_PARAM,
  SIGN_IN_PATH,
  destinationAfterSignIn,
  safeOrigin,
  safeRedirect,
} from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error: FieldError | null; success?: string };

// A "use server" module may only export async functions, so constants and
// re-exports live in the modules they belong to.
function fieldError(field: FieldError["field"], message: string): ActionState {
  return { error: { field, message } };
}

/** Minimal shape check. Real validation is Supabase's job. */
function readEmail(formData: FormData): string | null {
  const value = String(formData.get("email") ?? "").trim();
  if (value === "" || !value.includes("@") || value.startsWith("@") || value.endsWith("@")) {
    return null;
  }
  return value;
}

function usernameMessage(problem: NonNullable<ReturnType<typeof checkUsername>>): string {
  switch (problem) {
    case "empty":
      return de.auth.errors.usernameEmpty;
    case "too-short":
      return de.auth.errors.usernameTooShort;
    case "too-long":
      return de.auth.errors.usernameTooLong;
    case "invalid-characters":
      return de.auth.errors.usernameInvalid;
    case "business-only":
      return de.auth.errors.usernameBusinessOnly;
    case "reserved":
      return de.auth.errors.usernameReserved;
  }
}

// ------------------------------------------------------------------- sign up

export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = readEmail(formData);
  if (!email) return fieldError("email", de.auth.errors.emailInvalid);

  const password = String(formData.get("password") ?? "");
  if (password === "") return fieldError("password", de.auth.errors.passwordRequired);

  const supabase = await createClient();
  const origin = safeOrigin(formData.get("origin") as string | null);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // Without a usable origin the option is left out rather than sent as a
    // relative string: Supabase then uses its configured Site URL.
    options: origin ? { emailRedirectTo: `${origin}/auth/callback` } : undefined,
  });

  // The whole response decides, not just `error` — an address that already has
  // an account comes back without one (docs/AUTH.md, section 9.13).
  const problem = signUpOutcome(data, error);
  if (problem) return { error: problem };

  // The project requires email confirmation, so signUp returns no session
  // (proven in V1.2C). Never pretend the user is signed in here.
  redirect("/verify-email");
}

// ------------------------------------------------------------------- sign in

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = readEmail(formData);
  if (!email) return fieldError("email", de.auth.errors.emailInvalid);

  const password = String(formData.get("password") ?? "");
  if (password === "") return fieldError("password", de.auth.errors.passwordRequired);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: signInError(error) };

  const { data } = await supabase.auth.getUser();
  let hasUsername = false;
  if (data.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", data.user.id)
      .maybeSingle();
    hasUsername = Boolean(profile?.username);
  }

  revalidatePath("/", "layout");
  redirect(destinationAfterSignIn(hasUsername, String(formData.get("next") ?? "")));
}

// ------------------------------------------------------------------ sign out
//
// There is no `signOutAction()` here, and its absence is deliberate (ADR-0085).
//
// One existed, exported and imported by nothing — a second way to end a
// session, sitting beside the `/auth/signout` route that actually does it. A
// spare implementation of an auth action is not harmless: the next person to
// need a sign-out button finds two and picks one, and then there are two in
// the interface as well.
//
// The one mechanism is `POST /auth/signout`, rendered once, at the bottom of
// `/account/profile`.

// ------------------------------------------------------------ password reset

export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = readEmail(formData);
  if (!email) return fieldError("email", de.auth.errors.emailInvalid);

  const supabase = await createClient();
  const origin = safeOrigin(formData.get("origin") as string | null);
  await supabase.auth.resetPasswordForEmail(
    email,
    // Same rule as the sign-up: a relative redirect is worse than none.
    origin
      ? { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}` }
      : undefined,
  );

  // The same answer whether or not the address exists. Reporting the real
  // outcome would turn this form into an account checker.
  return { error: null, success: de.auth.forgotPassword.sent };
}

export async function updatePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  if (password === "") return fieldError("password", de.auth.errors.passwordRequired);

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fieldError("form", de.auth.errors.sessionExpired);

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: passwordUpdateError(error) };

  revalidatePath("/", "layout");
  return { error: null, success: de.auth.settings.passwordSaved };
}

/**
 * The same change, but at the end of a RECOVERY (ADR-0094).
 *
 * WHY THIS IS NOT `updatePasswordAction`
 *
 * That one serves `/account/security`, where the person is signed in on
 * purpose and must STAY signed in: a success message under the form is the
 * whole of the right behaviour there.
 *
 * A reset is the other situation. The link put the browser into a temporary
 * recovery session, and `updatePasswordAction` left it there — new password
 * saved, and the screen still the reset form, still holding the session the
 * mail created. Nothing said the flow was over, reloading showed the form
 * again, and the one credential that had just changed had never been used.
 *
 * So: end the recovery session and hand the person the ordinary login, where
 * the new password is the thing that gets them in. `signOut()` is what makes
 * it the ordinary login and not a half-authenticated one — without it the
 * recovery session would survive the redirect and `/login` would bounce a
 * signed-in visitor straight back out.
 *
 * ORDER MATTERS AND IS THE POINT. The sign-out and the redirect happen only
 * after `updateUser` reports success. A failed update returns a field error
 * and the form stays exactly where it is, session intact, so the person can
 * try again — losing the recovery session on a rejected password would mean
 * asking for a new mail to fix a typo.
 *
 * `redirect()` throws `NEXT_REDIRECT`, so it is called last and outside any
 * try/catch.
 */
export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  if (password === "") return fieldError("password", de.auth.errors.passwordRequired);

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  // No recovery session: the link expired or was already used. Saying so in
  // the form is better than a redirect that looks like success.
  if (!data.user) return fieldError("form", de.auth.errors.sessionExpired);

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: passwordUpdateError(error) };

  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect(`${SIGN_IN_PATH}?${PASSWORD_CHANGED_PARAM}=1`);
}

// ------------------------------------------------------------------ username

export async function setUsernameAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const candidate = String(formData.get("username") ?? "").trim();

  /*
   * Whether this account may use a dot is asked of the SERVER, never of the
   * form. `canOperateSeller()` reads `my_capabilities()` over the caller's own
   * session, so a request that sets its own flag learns nothing from it — and
   * the database refuses the write anyway. This only decides the message.
   */
  const business = await canOperateSeller();

  const problem = checkUsername(candidate, { business });
  if (problem) return fieldError("username", usernameMessage(problem));

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fieldError("form", de.auth.errors.sessionExpired);

  // Uniqueness cannot be checked beforehand: RLS shows a user only their own
  // row, so a lookup always comes back empty. The unique index on
  // lower(username) decides, and the error code carries the answer
  // (docs/AUTH.md, section 9.5).
  const { error } = await supabase
    .from("profiles")
    .update({ username: candidate })
    .eq("id", data.user.id);

  if (error) return { error: profileWriteError(error, candidate) };

  revalidatePath("/", "layout");
  const redirectTo = String(formData.get("redirectTo") ?? "");
  if (redirectTo === "onboarding") {
    redirect(safeRedirect(String(formData.get("next") ?? ""), DEFAULT_SIGNED_IN_PATH));
  }
  return { error: null, success: de.auth.settings.usernameSaved };
}

/** Used by protected layouts to decide whether onboarding is still pending. */
export async function currentProfile(): Promise<Profile | null> {
  // The implementation lives in `profile.ts`, where it can be memoised per
  // request. A `"use server"` module may only export plain async functions,
  // so this stays a thin pass-through for anything that imports it from here.
  return readProfile();
}
