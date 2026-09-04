import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthCard } from "@/components/auth/form-field";
import { signUpAction } from "@/lib/auth/actions";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.auth.register.title };

export default function RegisterPage() {
  return (
    <AuthCard title={de.auth.register.title}>
      <p className="text-muted">{de.auth.register.intro}</p>
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
      <p className="text-sm text-muted">
        {de.auth.register.haveAccount}{" "}
        <Link href="/login" className="underline">
          {de.auth.register.signInLink}
        </Link>
      </p>
    </AuthCard>
  );
}
