import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountHeader } from "@/components/account/account-header";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { AuthForm } from "@/components/auth/auth-form";
import { setUsernameAction } from "@/lib/auth/actions";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.account.profile.title };

/**
 * The public half of an identity, on its own page — and where a session ends.
 *
 * Renaming changes nothing structurally: the UUID is the identity, never the
 * name (ADR-0016). The existing server action is reused rather than a second
 * one written for the same field.
 *
 * WHY SIGN-OUT IS HERE AND NOWHERE ELSE (ADR-0085)
 *
 * It was on `/account`, the hub — and `/settings` permanently redirects to
 * `/account`, so every visitor looking for settings landed on the page
 * carrying the button. It read as "logout lives in Settings" because, as
 * rendered, it did.
 *
 * This page is the account's own identity: who you are signed in AS. Ending
 * that session belongs at the bottom of it. The same page for a collector, a
 * seller and an administrator — logging out is a session action, not a role
 * one, so it is not duplicated into the Business or Admin areas.
 *
 * A POST to the existing `/auth/signout` route, not a link and not a second
 * implementation: a prefetcher must never be able to end a session.
 */
export default async function AccountProfilePage() {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  if (!profile.username) redirect(ONBOARDING_PATH);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <AccountHeader title={de.account.profile.title} hint={de.account.profile.hint} />
      <AuthForm
        action={setUsernameAction}
        submitLabel={de.auth.settings.submitUsername}
        fields={[
          {
            name: "username",
            label: de.auth.fields.username,
            autoComplete: "username",
            defaultValue: profile.username,
            hint: de.auth.onboarding.hint,
          },
        ]}
      />

      {/* The last thing on the page, separated from the field above it: it is
          the one action here that ends the session rather than changing
          something. */}
      <form action="/auth/signout" method="post" className="border-t border-border/70 pt-6">
        <button type="submit" className={ACTION_NEUTRAL}>
          {de.nav.signOut}
        </button>
      </form>
    </main>
  );
}
