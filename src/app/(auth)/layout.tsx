import Link from "next/link";

import { Wordmark } from "@/components/layout/wordmark";
import { de } from "@/lib/i18n/de";

/**
 * Auth shell.
 *
 * Same wordmark and the same border as everywhere else, so signing in does
 * not feel like leaving SkyIsles. Deliberately quieter than the main app:
 * no navigation, because a half-finished sign-up is not the moment to offer
 * somewhere else to go.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <Link href="/" className="flex items-center px-4 py-3 md:px-6" aria-label={de.app.name}>
          <Wordmark />
        </Link>
      </header>
      {children}
    </div>
  );
}
