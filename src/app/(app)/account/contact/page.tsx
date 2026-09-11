import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountHeader } from "@/components/account/account-header";
import { ContactForm } from "@/components/account/contact-form";
import { fetchSavedContact } from "@/lib/account/contacts";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.account.contact.title };

export default async function AccountContactPage() {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  if (!profile.username) redirect(ONBOARDING_PATH);

  // RLS returns this account's row and no other. The reader asks for the
  // signed-in id as well, so a policy change could never widen it silently.
  const contact = await fetchSavedContact();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <AccountHeader title={de.account.contact.title} hint={de.account.contact.hint} />
      <ContactForm contact={contact} />
    </main>
  );
}
