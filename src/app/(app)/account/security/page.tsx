import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountHeader } from "@/components/account/account-header";
import { AuthForm } from "@/components/auth/auth-form";
import { updatePasswordAction } from "@/lib/auth/actions";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.account.security.title };

/**
 * What can be changed about the account itself.
 *
 * The password today; e-mail and deleting the account belong here when they
 * exist. Signing out deliberately does **not** (ADR-0062): it changes nothing
 * about the account, it ends a session, and it belongs where somebody looks
 * for it — one tap into the account area, not two.
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

      {/* What comes here next: changing the sign-in address, and deleting the
          account. Both are account changes; signing out is not, and lives on
          the account hub instead (ADR-0062). */}
    </main>
  );
}
