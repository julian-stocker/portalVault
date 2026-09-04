/**
 * Protected area.
 *
 * The middleware already turns anonymous visitors away, but that is
 * convenience. This layout checks the session on the server for itself, and
 * row level security remains the actual boundary (docs/SECURITY.md).
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentProfile } from "@/lib/auth/actions";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <Link href="/" className="text-sm font-medium">
          {de.app.name}
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {profile.username ? (
            <>
              <Link href="/dashboard" className="text-muted hover:text-foreground">
                {de.nav.dashboard}
              </Link>
              <Link href="/settings" className="text-muted hover:text-foreground">
                {de.nav.settings}
              </Link>
            </>
          ) : (
            <Link href={ONBOARDING_PATH} className="text-muted hover:text-foreground">
              {de.auth.onboarding.title}
            </Link>
          )}
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-muted hover:text-foreground">
              {de.nav.signOut}
            </button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}
