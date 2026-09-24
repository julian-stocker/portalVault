/**
 * Der Posteingang der Kundschaft.
 *
 * Eine Liste der eigenen Bestellungen, die eine Unterhaltung haben — nicht
 * aller Bestellungen: eine Zeile ohne Inhalt wäre eine Einladung zu einem
 * leeren Raum. Ungelesene zuerst, danach die neueste Aktivität; die
 * Sortierung entsteht in `my_conversations()`, damit beide Posteingänge
 * dieselbe Regel haben.
 *
 * Gastbestellungen tauchen hier nie auf — sie haben kein Konto und deshalb
 * keine Unterhaltung. Der Hinweis unten sagt das, ohne zu behaupten, dass es
 * eine solche Bestellung gäbe.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountHeader } from "@/components/account/account-header";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";
import { fetchMyConversations } from "@/lib/messages/queries";

export const metadata: Metadata = { title: de.messages.title };
export const dynamic = "force-dynamic";

const copy = de.messages;

export default async function MyMessagesPage() {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  if (!profile.username) redirect(ONBOARDING_PATH);

  const conversations = await fetchMyConversations();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <AccountHeader title={copy.title} hint={copy.hint} />

      {conversations.length === 0 ? (
        <section className="rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70">
          <p className="font-medium">{copy.empty}</p>
          <p className="mt-1 text-sm text-muted">{copy.emptyHint}</p>
        </section>
      ) : (
        <ul className="flex flex-col gap-2">
          {conversations.map((one) => (
            <li key={one.orderNumber}>
              <Link
                href={`/account/orders/${one.orderNumber}#nachrichten`}
                className="flex items-baseline justify-between gap-3 rounded-sky-lg bg-surface/80 p-4 ring-1 ring-border/70 hover:ring-border-strong"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium tabular-nums">{one.orderNumber}</span>
                  <span className="text-xs text-muted">
                    {copy.entries(one.total)} · {new Date(one.lastAt).toLocaleString(de.locale)}
                  </span>
                </span>
                {one.unread > 0 ? (
                  <span className="shrink-0 rounded-full bg-own-subtle px-2 py-0.5 text-xs font-medium text-own-ink ring-1 ring-own-line">
                    {one.unread === 1 ? copy.unreadOne : copy.unreadMany(one.unread)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs leading-snug text-muted">{copy.guestHint}</p>
    </main>
  );
}
