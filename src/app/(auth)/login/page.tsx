import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthCard, AuthContextNote } from "@/components/auth/form-field";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { signInAction } from "@/lib/auth/actions";
import { authContext, favoursRegistration } from "@/lib/auth/context";
import { safeRedirect } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.auth.login.title };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Sanitised here as well as in the action: the value is rendered into the
  // form and travels with every submission.
  const target = safeRedirect(next);

  /*
   * Why this person is here (F11).
   *
   * Read from the sanitised target, never from the raw parameter — so a
   * redirect `safeRedirect()` rejected can never produce a sentence either.
   * It changes one paragraph and the prominence of one link; the `next`
   * semantics, the action and the redirect are untouched.
   */
  const context = authContext(target);
  const offerRegistration = favoursRegistration(context);
  const registerHref = `/register?next=${encodeURIComponent(target)}`;

  return (
    <AuthCard title={de.auth.login.title}>
      <AuthContextNote context={context} />

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
       * Somebody who just tapped a figure to collect it almost certainly has
       * no account — nobody signs out and then browses a catalog to collect
       * something. So there, and only there, "Konto erstellen" stops being a
       * footnote under the form and becomes an action beside it. Same
       * destination, same flow, carrying the same `next`.
       */}
      {offerRegistration ? (
        <div className="flex flex-col gap-2">
          <Link href={registerHref} className={ACTION_NEUTRAL}>
            {de.auth.login.registerAction}
          </Link>
          <p className="text-center text-xs text-muted">{de.auth.login.orSignIn}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1 text-sm text-muted">
        <Link href="/forgot-password" className="underline">
          {de.auth.login.forgot}
        </Link>
        {offerRegistration ? null : (
          <span>
            {de.auth.login.noAccount}{" "}
            <Link href={registerHref} className="underline">
              {de.auth.login.registerLink}
            </Link>
          </span>
        )}
      </div>
    </AuthCard>
  );
}
