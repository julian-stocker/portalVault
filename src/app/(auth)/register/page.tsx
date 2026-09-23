import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthCard, AuthContextNote, AuthTabs } from "@/components/auth/form-field";
import { signUpAction } from "@/lib/auth/actions";
import { authContext, favoursRegistration } from "@/lib/auth/context";
import { safeRedirect } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.auth.register.title };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeRedirect(next);
  const context = authContext(target);

  /*
   * `next` IS READ HERE, AND IT IS NOT A REDIRECT.
   *
   * Signing up ends at `/verify-email`, and the confirmation link comes back
   * through `/auth/callback` — a round trip that leaves this origin and has
   * never carried a destination. Building one would be a new redirect
   * mechanism in the auth flow, which is out of scope.
   *
   * So the parameter does exactly two things: it picks the explanation above
   * the form, and it travels on the link back to `/login` for somebody who
   * turns out to have an account after all. Both are honest uses; neither
   * promises a landing.
   */
  return (
    <AuthCard title={de.auth.register.title} tabs={<AuthTabs active="register" target={target} />}>
      <AuthContextNote context={context} />

      <p className="text-muted">
        {favoursRegistration(context) ? de.auth.register.introCollect : de.auth.register.intro}
      </p>

      <AuthForm
        action={signUpAction}
        submitLabel={de.auth.register.submit}
        fields={[
          { name: "email", label: de.auth.fields.email, type: "email", autoComplete: "email" },
          {
            name: "password",
            label: de.auth.fields.password,
            type: "password",
            autoComplete: "new-password",
          },
        ]}
      />
    </AuthCard>
  );
}
