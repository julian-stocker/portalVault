import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthCard } from "@/components/auth/form-field";
import { updatePasswordAction } from "@/lib/auth/actions";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: de.auth.resetPassword.title };

export default async function ResetPasswordPage() {
  // Reaching this page requires the temporary session the reset link created.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/auth-error");

  return (
    <AuthCard title={de.auth.resetPassword.title}>
      <AuthForm
        action={updatePasswordAction}
        submitLabel={de.auth.resetPassword.submit}
        fields={[
          {
            name: "password",
            label: de.auth.fields.newPassword,
            type: "password",
            autoComplete: "new-password",
          },
        ]}
      />
    </AuthCard>
  );
}
