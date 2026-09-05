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

export async function signOutAction(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

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

// ------------------------------------------------------------------ username

export async function setUsernameAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const candidate = String(formData.get("username") ?? "").trim();

  const problem = checkUsername(candidate);
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
export async function currentProfile(): Promise<{ id: string; username: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("id", data.user.id)
    .maybeSingle();

  // The signup trigger normally creates this row. If it is missing, the
  // onboarding page creates it through profiles_insert_own.
  return profile ?? { id: data.user.id, username: null };
}
