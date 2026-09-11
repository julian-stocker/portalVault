import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.account.title };

/**
 * The account area, as one place.
 *
 * Before this, "the account" was a single `/settings` page with a username
 * field, a password field and a sign-out button stacked on top of each other,
 * and there was nowhere at all to see one's own orders or keep a delivery
 * address. Four destinations, named for what a person is looking for rather
 * than for how the data is stored (ADR-0061).
 *
 * Mobile-first: a single column of full-width rows, each a thumb-sized target
 * with its own one-line explanation. No tabs, no sidebar — on a phone both
 * are a row of things too small to hit, and on a desktop one column of four
 * is not a layout problem.
 */
const SECTIONS = [
  { href: "/account/profile", copy: de.account.profile },
  { href: "/account/contact", copy: de.account.contact },
  { href: "/account/orders", copy: de.account.orders },
  { href: "/account/security", copy: de.account.security },
] as const;

export default async function AccountPage() {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  if (!profile.username) redirect(ONBOARDING_PATH);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{de.account.title}</h1>
        <p className="text-sm text-muted">{profile.username}</p>
      </header>

      <nav className="flex flex-col gap-2">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="min-h-16 rounded-sky-lg bg-surface/80 px-5 py-4 ring-1 ring-border/70 hover:ring-border-strong"
          >
            <span className="block font-medium">{section.copy.title}</span>
            <span className="mt-0.5 block text-sm text-muted">{section.copy.hint}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
