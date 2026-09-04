import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthCard } from "@/components/auth/form-field";
import { requestPasswordResetAction } from "@/lib/auth/actions";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.auth.forgotPassword.title };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title={de.auth.forgotPassword.title}>
      <p className="text-muted">{de.auth.forgotPassword.intro}</p>
      <AuthForm
        action={requestPasswordResetAction}
        submitLabel={de.auth.forgotPassword.submit}
        fields={[
          { name: "email", label: de.auth.fields.email, type: "email", autoComplete: "email" },
        ]}
      />
      <Link href="/login" className="text-sm underline">
        {de.auth.forgotPassword.backToLogin}
      </Link>
    </AuthCard>
  );
}
