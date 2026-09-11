import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountHeader } from "@/components/account/account-header";
import { AuthForm } from "@/components/auth/auth-form";
import { setUsernameAction } from "@/lib/auth/actions";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.account.profile.title };

/**
 * The public half of an identity, on its own page.
 *
 * Renaming changes nothing structurally: the UUID is the identity, never the
 * name (ADR-0016). The existing server action is reused rather than a second
 * one written for the same field.
 */
export default async function AccountProfilePage() {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  if (!profile.username) redirect(ONBOARDING_PATH);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <AccountHeader title={de.account.profile.title} hint={de.account.profile.hint} />
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
    </main>
  );
}
