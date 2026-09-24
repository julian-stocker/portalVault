/**
 * Der Posteingang des Betriebs.
 *
 * Dieselbe Sortierung wie beim Käufer, aus derselben Funktion: ungelesene
 * zuerst, danach die neueste Aktivität. Bewusst NICHT „älteste unbeantwortete
 * zuerst" — V1 kennt kein „beantwortet", und nach einem Zustand zu sortieren,
 * den es nicht gibt, wäre eine Behauptung (ADR-0108).
 *
 * Der Lesestand gehört dem Betrieb, nicht der Person: wer öffnet, liest für
 * alle. Bei einem Verkäufer ist das die richtige Auflösung.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { de } from "@/lib/i18n/de";
import { fetchSellerConversations } from "@/lib/messages/queries";

export const metadata: Metadata = { title: de.messages.title };
export const dynamic = "force-dynamic";

const copy = de.messages;

export default async function BusinessMessagesPage() {
  if (!(await canOperateSeller())) notFound();
  const conversations = await fetchSellerConversations();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <h1 className="text-3xl font-semibold tracking-tight">{copy.title}</h1>
      <p className="mt-1 text-sm text-muted">{copy.hint}</p>

      {conversations.length === 0 ? (
        <p className="mt-6 rounded-sky-md bg-surface/80 p-4 text-sm text-muted ring-1 ring-border/70">
          {copy.empty}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {conversations.map((one) => (
            <li key={one.orderNumber}>
              <Link
                href={`/business/orders/${one.orderNumber}#nachrichten`}
                className="flex items-baseline justify-between gap-3 rounded-sky-md bg-surface/80 p-4 ring-1 ring-border/70 hover:ring-border-strong"
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
    </main>
  );
}
