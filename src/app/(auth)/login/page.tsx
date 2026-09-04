import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthCard } from "@/components/auth/form-field";
import { signInAction } from "@/lib/auth/actions";
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

  return (
    <AuthCard title={de.auth.login.title}>
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
      <div className="flex flex-col gap-1 text-sm text-muted">
        <Link href="/forgot-password" className="underline">
          {de.auth.login.forgot}
        </Link>
        <span>
          {de.auth.login.noAccount}{" "}
          <Link href="/register" className="underline">
            {de.auth.login.registerLink}
          </Link>
        </span>
      </div>
    </AuthCard>
  );
}
