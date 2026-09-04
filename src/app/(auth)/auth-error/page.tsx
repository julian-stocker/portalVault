import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/form-field";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.auth.authError.title };

export default function AuthErrorPage() {
  return (
    <AuthCard title={de.auth.authError.title}>
      <p className="leading-relaxed text-muted">{de.auth.authError.body}</p>
      <div className="flex flex-col gap-1 text-sm">
        <Link href="/forgot-password" className="underline">
          {de.auth.authError.requestNew}
        </Link>
        <Link href="/login" className="underline">
          {de.auth.authError.backToLogin}
        </Link>
      </div>
    </AuthCard>
  );
}
