import Link from "next/link";

import { WorldBackdrop } from "@/components/layout/sky-backdrop";
import { Wordmark } from "@/components/layout/wordmark";
import { de } from "@/lib/i18n/de";

/**
 * Auth shell.
 *
 * Same wordmark as everywhere else, so signing in does not feel like leaving
 * SkyIsles. Deliberately quieter than the main app: no navigation, because a
 * half-finished sign-up is not the moment to offer somewhere else to go.
 *
 * This is where the full world artwork lives now (ADR-0038, V3.2). One small
 * panel and nothing to compete with the view — the catalog and the collection
 * have work to do and get a quiet vitrine instead.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <WorldBackdrop />
      <header className="border-b-2 border-accent/50 bg-deep/85 backdrop-blur-md">
        <Link href="/" className="flex items-center px-4 py-3 md:px-6" aria-label={de.app.name}>
          <Wordmark />
        </Link>
      </header>
      {children}
    </div>
  );
}
