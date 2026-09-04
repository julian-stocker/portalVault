import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/form-field";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.auth.verifyEmail.title };

export default function VerifyEmailPage() {
  return (
    <AuthCard title={de.auth.verifyEmail.title}>
      <p className="leading-relaxed text-muted">{de.auth.verifyEmail.body}</p>
      <Link href="/login" className="text-sm underline">
        {de.auth.verifyEmail.backToLogin}
      </Link>
    </AuthCard>
  );
}
