import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The auth screens say why somebody is standing in front of them (F11).
 *
 * The logic is `authContext()` and is tested on its own. This checks the
 * wiring — and, more importantly, that the wiring changed nothing about the
 * `next` semantics, the actions or the redirects.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const LOGIN = "src/app/(auth)/login/page.tsx";
const REGISTER = "src/app/(auth)/register/page.tsx";
const FORM_FIELD = "src/components/auth/form-field.tsx";
const ACTIONS = "src/lib/auth/actions.ts";
const REDIRECT = "src/lib/auth/redirect.ts";

const login = code(LOGIN);
const register = code(REGISTER);

describe("both screens explain the context", () => {
  it("renders the note", () => {
    expect(login).toContain("<AuthContextNote context={context} />");
    expect(register).toContain("<AuthContextNote context={context} />");
  });

  it("derives it from the sanitised target, never from the raw parameter", () => {
    // A `next` that `safeRedirect()` rejected must not be able to produce a
    // sentence either.
    for (const source of [login, register]) {
      expect(source).toContain("const target = safeRedirect(next)");
      expect(source).toContain("authContext(target)");
      expect(source).not.toContain("authContext(next)");
    }
  });

  it("renders nothing at all without a context", () => {
    expect(code(FORM_FIELD)).toContain("if (context === null) return null;");
  });
});

describe("registration is offered where it is the likely intent", () => {
  it("promotes it to an action after a collect attempt", () => {
    expect(login).toContain("favoursRegistration(context)");
    expect(login).toContain("de.auth.login.registerAction");
  });

  it("keeps the footnote link when it is not", () => {
    expect(login).toContain("de.auth.login.noAccount");
    expect(login).toContain("de.auth.login.registerLink");
    // One or the other, never both — two routes to the same page on one card
    // is a card that looks unsure.
    expect(login).toContain("offerRegistration ? null : (");
  });

  it("carries the same next to the registration screen", () => {
    expect(login).toContain("/register?next=${encodeURIComponent(target)}");
  });

  it("uses a stronger intro on the registration screen for the same case", () => {
    expect(register).toContain("de.auth.register.introCollect");
    expect(register).toContain("de.auth.register.intro");
  });
});

describe("nothing about the auth flow itself moved", () => {
  it("login still submits next as a hidden field to the same action", () => {
    expect(login).toContain("hidden={{ next: target }}");
    expect(login).toContain("action={signInAction}");
  });

  it("registration still posts to signUpAction and promises no destination", () => {
    expect(register).toContain("action={signUpAction}");
    // `signUpAction` ends at /verify-email and the confirmation returns through
    // /auth/callback; neither has ever carried a destination, and this phase
    // did not add one.
    expect(register).not.toContain("hidden={{ next");
  });

  it("leaves the redirect rules untouched", () => {
    const actions = code(ACTIONS);
    expect(actions).toContain('redirect("/verify-email")');
    expect(actions).toContain('destinationAfterSignIn(hasUsername, String(formData.get("next") ?? ""))');

    const redirect = code(REDIRECT);
    expect(redirect).toContain('export const DEFAULT_SIGNED_IN_PATH = "/"');
    expect(redirect).toContain('export const ONBOARDING_PATH = "/onboarding"');
  });
});
