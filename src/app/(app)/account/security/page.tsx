import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountHeader } from "@/components/account/account-header";
import { AuthForm } from "@/components/auth/auth-form";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { updatePasswordAction } from "@/lib/auth/actions";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.account.security.title };

/**
 * Password and sign-out, together.
 *
 * Sign-out lives here rather than in the navigation because it is an account
 * action, and because a destructive-feeling control in a bar that is on every
 * screen is a control somebody eventually hits by accident on a phone.
 */
export default async function AccountSecurityPage() {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  if (!profile.username) redirect(ONBOARDING_PATH);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 pt-8 pb-10 md:pt-12">
      <AccountHeader title={de.account.security.title} hint={de.account.security.hint} />

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

      <section className="flex flex-col gap-4 border-t border-border/70 pt-6">
        {/* A POST, not a link: signing out changes state, and a prefetcher
            must never be able to trigger it. */}
        <form action="/auth/signout" method="post">
          <button type="submit" className={ACTION_NEUTRAL}>
            {de.nav.signOut}
          </button>
        </form>
      </section>
    </main>
  );
}
