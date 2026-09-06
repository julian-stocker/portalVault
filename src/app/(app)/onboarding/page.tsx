import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthCard } from "@/components/auth/form-field";
import { setUsernameAction } from "@/lib/auth/actions";
import { currentProfile } from "@/lib/auth/profile";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.auth.onboarding.title };

export default async function OnboardingPage() {
  const profile = await currentProfile();
  // Nothing to do once a name exists.
  if (profile?.username) redirect(DEFAULT_SIGNED_IN_PATH);

  return (
    <AuthCard title={de.auth.onboarding.title}>
      <p className="text-muted">{de.auth.onboarding.intro}</p>
      <AuthForm
        action={setUsernameAction}
        submitLabel={de.auth.onboarding.submit}
        hidden={{ redirectTo: "onboarding" }}
        fields={[
          {
            name: "username",
            label: de.auth.fields.username,
            autoComplete: "username",
            hint: de.auth.onboarding.hint,
          },
        ]}
      />
    </AuthCard>
  );
}
