import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthCard, AuthContextNote, AuthTabs } from "@/components/auth/form-field";
import { signInAction } from "@/lib/auth/actions";
import { authContext } from "@/lib/auth/context";
import { PASSWORD_CHANGED_PARAM, safeRedirect } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.auth.login.title };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; [PASSWORD_CHANGED_PARAM]?: string }>;
}) {
  const params = await searchParams;
  const next = params.next;
  /* Set by `resetPasswordAction` after a successful reset, and by nothing
     else. One sentence; it changes no behaviour. */
  const passwordChanged = params[PASSWORD_CHANGED_PARAM] === "1";
  // Sanitised here as well as in the action: the value is rendered into the
  // form and travels with every submission.
  const target = safeRedirect(next);

  /*
   * Why this person is here (F11).
   *
   * Read from the sanitised target, never from the raw parameter — so a
   * redirect `safeRedirect()` rejected can never produce a sentence either.
   * It changes one paragraph and nothing else; the `next` semantics, the
   * action and the redirect are untouched.
   *
   * It used to change more: after a collect attempt the screen also promoted
   * "Konto erstellen" to a button of its own. Since the switch sits above the
   * heading (V4.8) that was a THIRD route between the same two pages, and a
   * card that offers one thing three times reads as unsure. The sentence
   * stays, the duplicate offer is gone.
   */
  const context = authContext(target);

  return (
    <AuthCard title={de.auth.login.title} tabs={<AuthTabs active="login" target={target} />}>
      {passwordChanged ? (
        <p role="status"
           className="mb-4 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">
          {de.auth.resetPassword.changed}
        </p>
      ) : null}

      <AuthContextNote context={context} />

      <p className="text-muted">{de.auth.login.intro}</p>

      <AuthForm
        action={signInAction}
        submitLabel={de.auth.login.submit}
        hidden={{ next: target }}
        fields={[
          { name: "email", label: de.auth.fields.email, type: "email", autoComplete: "email" },
          {
            name: "password",
            label: de.auth.fields.password,
            type: "password",
            autoComplete: "current-password",
          },
        ]}
      />

      {/*
       * Nur noch der vergessene Zugang. Der Wechsel zur Registrierung steht
       * oben im Umschalter und braucht keine zweite Fußzeile — zwei Wege zur
       * selben Seite auf einer Karte ist eine Karte, die sich unsicher ist.
       */}
      <div className="flex flex-col gap-1 text-sm text-muted">
        <Link href="/forgot-password" className="underline">
          {de.auth.login.forgot}
        </Link>
      </div>
    </AuthCard>
  );
}
