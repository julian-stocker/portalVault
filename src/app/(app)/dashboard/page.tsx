import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { currentProfile } from "@/lib/auth/actions";
import { ONBOARDING_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.nav.dashboard };

export default async function DashboardPage() {
  const profile = await currentProfile();
  if (!profile?.username) redirect(ONBOARDING_PATH);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{de.nav.dashboard}</h1>
      <p className="mt-2 text-muted">
        {de.dashboard.signedInAs}{" "}
        <span className="text-foreground">{profile.username}</span>
      </p>
      {/* The collection lives here from V1.5 onwards (ADR-0023). */}
    </main>
  );
}
