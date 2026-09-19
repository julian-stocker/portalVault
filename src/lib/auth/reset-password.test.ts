/**
 * Finishing a password reset ends the recovery session (ADR-0094).
 *
 * WHAT THIS FILE IS DEFENDING
 *
 * 1. THE FLOW ENDS. `updatePasswordAction` saved the new password and left
 *    the browser on the reset form, still holding the temporary session the
 *    mail created. Nothing said it was over, reloading showed the form again,
 *    and the credential that had just changed had never been used.
 *
 * 2. THE SIGN-OUT IS LOAD-BEARING, not tidiness. `/login` is in
 *    `SIGNED_OUT_ONLY_PREFIXES`, so the proxy bounces a signed-in visitor
 *    away from it. Redirecting without ending the recovery session would land
 *    the person on the catalog instead of the login form — the bug replaced
 *    by a quieter one.
 *
 * 3. ORDER. Sign-out and redirect happen only after `updateUser` reports
 *    success. A rejected password must leave the session intact so the person
 *    can fix a typo instead of requesting a new mail.
 *
 * 4. THE OTHER PASSWORD FORM IS UNTOUCHED. `/account/security` uses
 *    `updatePasswordAction`, where staying signed in with a message under the
 *    form is the correct behaviour.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import { PASSWORD_CHANGED_PARAM, SIGN_IN_PATH } from "./redirect.ts";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ACTIONS = read("src/lib/auth/actions.ts");
const RESET_PAGE = read("src/app/(auth)/reset-password/page.tsx");
const LOGIN_PAGE = read("src/app/(auth)/login/page.tsx");
const SECURITY_PAGE = read("src/app/(app)/account/security/page.tsx");
const MIDDLEWARE = read("src/lib/supabase/middleware.ts");

/**
 * The body of one exported action, ending at its own closing brace.
 *
 * NOT "up to the next export": the next function's doc comment sits between
 * the two, and slicing that far pulled `resetPasswordAction`'s explanation of
 * `signOut` into `updatePasswordAction`'s body — which made a
 * `not.toContain("signOut")` fail on prose.
 */
function body(name: string): string {
  const start = ACTIONS.indexOf(`export async function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = ACTIONS.indexOf("\n}\n", start);
  expect(end, name).toBeGreaterThan(start);
  return ACTIONS.slice(start, end + 3);
}

const RESET = body("resetPasswordAction");
const UPDATE = body("updatePasswordAction");

describe("the recovery flow ends at the login form", () => {
  it("the reset page uses the recovery action, not the settings one", () => {
    expect(RESET_PAGE).toContain("resetPasswordAction");
    expect(RESET_PAGE).not.toContain("updatePasswordAction");
  });

  it("SUCCESS signs out and redirects to the login page", () => {
    expect(RESET).toContain("await supabase.auth.signOut()");
    expect(RESET).toContain("redirect(`${SIGN_IN_PATH}?${PASSWORD_CHANGED_PARAM}=1`)");
  });

  it("and it is the LOGIN page, which the proxy only shows to signed-out visitors", () => {
    expect(SIGN_IN_PATH).toBe("/login");
    expect(MIDDLEWARE).toContain('SIGNED_OUT_ONLY_PREFIXES = ["/login"');
    // Which is exactly why the sign-out cannot be dropped.
    expect(RESET.indexOf("signOut()")).toBeLessThan(RESET.indexOf("redirect("));
  });

  it("ORDER: nothing happens before the update reports success", () => {
    const update = RESET.indexOf("updateUser({ password })");
    const guard = RESET.indexOf("if (error) return { error: passwordUpdateError(error) }");
    expect(update).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(update);
    expect(RESET.indexOf("signOut()")).toBeGreaterThan(guard);
  });

  it("A REJECTED PASSWORD keeps the form and the session", () => {
    // Both failure paths return an ActionState; neither redirects or signs out.
    const beforeUpdate = RESET.slice(0, RESET.indexOf("updateUser({ password })"));
    expect(beforeUpdate).toContain('fieldError("password", de.auth.errors.passwordRequired)');
    expect(beforeUpdate).not.toContain("signOut");
    expect(beforeUpdate).not.toContain("redirect(");
    // An empty password never reaches Supabase at all.
    expect(RESET).toContain('if (password === "") return fieldError("password"');
  });

  it("A MISSING RECOVERY SESSION is reported in the form, not redirected away", () => {
    expect(RESET).toContain("const { data } = await supabase.auth.getUser()");
    expect(RESET).toContain("if (!data.user) return fieldError(\"form\", de.auth.errors.sessionExpired)");
    const sessionCheck = RESET.indexOf("if (!data.user)");
    expect(sessionCheck).toBeLessThan(RESET.indexOf("updateUser({ password })"));
    expect(sessionCheck).toBeLessThan(RESET.indexOf("redirect("));
  });

  it("exactly one redirect, so there is nothing to loop between", () => {
    expect(RESET.match(/redirect\(/g)?.length).toBe(1);
    // The destination is a bare login URL: no `next`, nothing that points back.
    expect(RESET).not.toContain("next=");
    expect(RESET).not.toContain("reset-password");
  });
});

describe("the login page says what happened", () => {
  it("reads the parameter the action sets, and only that", () => {
    expect(LOGIN_PAGE).toContain("PASSWORD_CHANGED_PARAM");
    expect(LOGIN_PAGE).toContain(`params[PASSWORD_CHANGED_PARAM] === "1"`);
    expect(PASSWORD_CHANGED_PARAM).toBe("passwort-geaendert");
  });

  it("renders one sentence and changes nothing else", () => {
    expect(LOGIN_PAGE).toContain("de.auth.resetPassword.changed");
    expect(LOGIN_PAGE).toContain('role="status"');
    // The form, its action and `next` are untouched by the notice.
    expect(LOGIN_PAGE).toContain("action={signInAction}");
    expect(LOGIN_PAGE).toContain("hidden={{ next: target }}");
  });

  it("the sentence tells the person what to do next, in German", () => {
    const text = de.auth.resetPassword.changed;
    expect(text).toContain("geändert");
    expect(text).toContain("neuen Passwort");
    expect(text.length).toBeGreaterThan(20);
  });
});

describe("the settings password form is unchanged", () => {
  it("still uses updatePasswordAction", () => {
    expect(SECURITY_PAGE).toContain("updatePasswordAction");
    expect(SECURITY_PAGE).not.toContain("resetPasswordAction");
  });

  it("which still stays put and still keeps the session", () => {
    expect(UPDATE).toContain("return { error: null, success: de.auth.settings.passwordSaved }");
    expect(UPDATE).not.toContain("signOut");
    expect(UPDATE).not.toContain("redirect(");
  });

  it("so the two actions differ in exactly one thing: how they end", () => {
    for (const shared of [
      'if (password === "") return fieldError("password", de.auth.errors.passwordRequired);',
      "const { data } = await supabase.auth.getUser();",
      "await supabase.auth.updateUser({ password });",
      'revalidatePath("/", "layout");',
    ]) {
      expect(RESET, shared).toContain(shared);
      expect(UPDATE, shared).toContain(shared);
    }
  });
});
