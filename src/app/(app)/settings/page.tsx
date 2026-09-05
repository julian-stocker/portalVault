import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { currentProfile, setUsernameAction, updatePasswordAction } from "@/lib/auth/actions";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.auth.settings.title };

export default async function SettingsPage() {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  if (!profile.username) redirect(ONBOARDING_PATH);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-10 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{de.auth.settings.title}</h1>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {de.auth.settings.usernameSection}
        </h2>
        {/* Renaming changes nothing structurally: the UUID is the identity,
            never the name (ADR-0016). */}
        <AuthForm
          action={setUsernameAction}
          submitLabel={de.auth.settings.submitUsername}
          fields={[
            {
              name: "username",
              label: de.auth.fields.username,
              autoComplete: "username",
              defaultValue: profile.username,
              hint: de.auth.onboarding.hint,
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {de.auth.settings.passwordSection}
        </h2>
        <AuthForm
          action={updatePasswordAction}
          submitLabel={de.auth.settings.submitPassword}
          fields={[
            {
              name: "password",
              label: de.auth.fields.newPassword,
              type: "password",
              autoComplete: "new-password",
            },
          ]}
        />
      </section>

      {/* Signing out is not a navigation destination, so it left the main
          navigation and lives here instead (ADR-0036). Same POST route as
          before — no new logout implementation, and nothing is deleted, so
          it carries no danger styling. */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {de.auth.settings.sessionSection}
        </h2>
        <p className="text-sm text-muted">{de.auth.settings.sessionHint}</p>
        <form action="/auth/signout" method="post">
          <button type="submit" className={ACTION_NEUTRAL}>
            {de.nav.signOut}
          </button>
        </form>
      </section>
    </main>
  );
}
