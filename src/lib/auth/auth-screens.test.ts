import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

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
  /**
   * EIN UMSCHALTER, UND SONST NICHTS (V4.8).
   *
   * Nach einem Sammelversuch bot /login „Konto erstellen" zusätzlich als
   * eigenen Knopf an (F11). Seit der Umschalter über der Überschrift steht,
   * wäre das ein DRITTER Weg zwischen denselben zwei Seiten. Die Erklärung,
   * warum jemand hier steht, bleibt — das doppelte Angebot ist weg.
   */
  it("offers exactly one way to the other screen", () => {
    expect(login).not.toContain("registerAction");
    expect(login).not.toContain("orSignIn");
    expect(login).not.toContain("favoursRegistration");
    expect(login).not.toContain("ACTION_NEUTRAL");
    const vocabulary = readFileSync("src/lib/i18n/de.ts", "utf8");
    expect(vocabulary).not.toContain("registerAction:");
    expect(vocabulary).not.toContain("orSignIn:");

    // Genau ein Link auf die jeweils andere Route, und der kommt aus dem
    // Umschalter, nicht aus der Seite.
    for (const [name, source] of [["login", login], ["register", register]] as const) {
      expect(source.match(/href=\{?["`]\/(login|register)/g) ?? [], name).toHaveLength(0);
    }
    expect(code(FORM_FIELD).match(/href=\{`\/(login|register)\$\{query\}`\}/g) ?? [])
      .toHaveLength(2);
  });

  it("keeps the sentence that says why somebody is here", () => {
    expect(login).toContain("const context = authContext(target);");
    expect(login).toContain("<AuthContextNote context={context} />");
  });

  /**
   * DER WECHSEL STEHT JETZT OBEN (V4.8).
   *
   * Die beiden Fußzeilen — „Noch kein Konto?" auf /login und „Du hast schon
   * ein Konto?" auf /register — sagten dasselbe wie der Umschalter, nur
   * weiter unten und zweimal. Sie sind ersatzlos weg; der Umschalter ist der
   * eine Weg zwischen den beiden Seiten.
   */
  it("drops the footnote links, because the switch is above the heading", () => {
    for (const source of [login, register]) {
      expect(source).not.toContain("noAccount");
      expect(source).not.toContain("registerLink");
      expect(source).not.toContain("haveAccount");
      expect(source).not.toContain("signInLink");
    }
    const vocabulary = readFileSync("src/lib/i18n/de.ts", "utf8");
    for (const gone of ["noAccount:", "registerLink:", "haveAccount:", "signInLink:"]) {
      expect(vocabulary, gone).not.toContain(gone);
    }
  });

  /**
   * ZWEI LINKS, KEIN CLIENT-TOGGLE.
   *
   * `/login` und `/register` bleiben eigene Routen mit eigenen Server
   * Actions, eigenen Metadaten und eigener `next`-Bedeutung. Der Umschalter
   * navigiert nur — sonst gäbe es „anmelden" zweimal, einmal als Route und
   * einmal als Zustand in einer Komponente.
   */
  it("switches by navigating, and carries `next` both ways", () => {
    expect(login).toContain('tabs={<AuthTabs active="login" target={target} />}');
    expect(register).toContain('tabs={<AuthTabs active="register" target={target} />}');

    const tabs = code(FORM_FIELD);
    expect(tabs).toContain("const query = `?next=${encodeURIComponent(target)}`;");
    expect(tabs).toContain("href={`/login${query}`}");
    expect(tabs).toContain("href={`/register${query}`}");
    // No form and no state: it is navigation, not a second sign-in.
    expect(tabs).not.toContain("useState");
    expect(tabs).not.toContain("signInAction");
    expect(tabs).not.toContain("signUpAction");
  });

  it("says which side is current, not only which side is brighter", () => {
    const tabs = code(FORM_FIELD);
    expect(tabs).toContain('aria-current={active === "login" ? "page" : undefined}');
    expect(tabs).toContain('aria-current={active === "register" ? "page" : undefined}');
    expect(tabs).toContain("aria-label={de.auth.tabs.label}");
    // Two equal segments across the panel, and a touch target on a phone.
    expect(tabs).toContain("grid grid-cols-2");
    expect(tabs).toContain("min-h-11");
  });

  it("sits above the heading, and only where there are two ways in", () => {
    const card = code(FORM_FIELD);
    const at = card.indexOf("{tabs}");
    expect(at).toBeGreaterThan(-1);
    expect(card.indexOf("<h1", at)).toBeGreaterThan(at);
    // Optional: the password screens are not a choice between two doors.
    expect(card).toContain("tabs?: ReactNode;");
    for (const screen of ["src/app/(auth)/forgot-password/page.tsx",
                          "src/app/(auth)/reset-password/page.tsx"]) {
      if (!existsSync(screen)) continue;
      expect(code(screen), screen).not.toContain("AuthTabs");
    }
  });

  it("carries the same next to the registration screen", () => {
    // Jetzt aus dem Umschalter, mit demselben bereinigten Ziel wie zuvor.
    expect(login).toContain('tabs={<AuthTabs active="login" target={target} />}');
    expect(code(FORM_FIELD)).toContain("const query = `?next=${encodeURIComponent(target)}`;");
    expect(code(FORM_FIELD)).toContain("href={`/register${query}`}");
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
