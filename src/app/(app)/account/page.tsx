import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AttentionBadge } from "@/components/ui/attention-badge";
import { SignOutForm } from "@/components/account/sign-out-form";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { de } from "@/lib/i18n/de";
import { fetchMyUnread } from "@/lib/messages/queries";
import { fetchMyAttentionTotal } from "@/lib/attention/queries";
import { capabilities } from "@/lib/auth/capabilities";

/** Welche Zahl an einer Kachel steht — oder 0, wenn sie keinen Kanal hat. */
function badgeFor(
  section: { readonly channel?: "orders" | "messages" },
  unread: number,
  attention: number,
): number {
  if (section.channel === "messages") return unread;
  if (section.channel === "orders") return attention;
  return 0;
}

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
  { href: "/account/profile", copy: de.account.profile, channel: undefined },
  { href: "/account/contact", copy: de.account.contact, channel: undefined },
  /*
   * DIE ZWEI KÄUFERKACHELN — und nur für ein Käuferkonto (0099).
   *
   * Ein Konto ist genau eines von user, business oder admin (ADR-0078); ein
   * Betrieb kauft nicht bei sich selbst. Für ihn wären beide Kacheln
   * strukturell leer, und seine eigene Perspektive liegt seit 0099 unter
   * `/business`. Profil, Kontakt und Sicherheit bleiben allen, weil sie zum
   * Login gehören und nicht zur Rolle.
   */
  { href: "/account/orders", copy: de.account.orders, channel: "orders", buyer: true },
  {
    href: "/account/nachrichten",
    copy: de.account.messages,
    channel: "messages",
    buyer: true,
  },
  { href: "/account/security", copy: de.account.security, channel: undefined },
] as const;

export default async function AccountPage() {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  if (!profile.username) redirect(ONBOARDING_PATH);

  /*
   * Kein zusätzlicher Aufruf: `fetchMyUnread` ist `cache()`-gebunden, und das
   * Layout hat sie für dieselbe Anfrage bereits geholt. Beide teilen sich
   * denselben Rundgang zur Datenbank — die Kachel und die Zahl am Kopf
   * können deshalb gar nicht auseinanderlaufen.
   */
  const [unread, attention, caps] = await Promise.all([
    fetchMyUnread(),
    fetchMyAttentionTotal(),
    capabilities(),
  ]);
  /* Käuferkacheln nur für ein Käuferkonto. Kein Redirect für den Betrieb:
     Passwort und Benutzername liegen hier, und die braucht er auch. */
  const sections = SECTIONS.filter((s) => !("buyer" in s) || !caps.sellerOperator);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{de.account.title}</h1>
        <p className="text-sm text-muted">{profile.username}</p>
      </header>

      <nav className="flex flex-col gap-2">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="flex min-h-16 items-center gap-3 rounded-sky-lg bg-surface/80 px-5 py-4 ring-1 ring-border/70 hover:ring-border-strong"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{section.copy.title}</span>
              <span className="mt-0.5 block text-sm text-muted">{section.copy.hint}</span>
            </span>
            {/* Die Marke der Karte ist die Zahl IHRES Kanals — dieselbe
                Aufteilung wie im Betrieb, damit beide Rollen dasselbe
                Verhalten haben (0099). */}
            {badgeFor(section, unread, attention) > 0 ? (
              <AttentionBadge
                count={badgeFor(section, unread, attention)}
                label={
                  "channel" in section && section.channel === "messages"
                    ? de.messages.unreadBadgeLabel(badgeFor(section, unread, attention))
                    : de.account.newOrdersBadgeLabel(badgeFor(section, unread, attention))
                }
              />
            ) : null}
          </Link>
        ))}
      </nav>

      {/*
       * ABMELDEN, UNTEN UND ABGETRENNT (ADR-0085 wird hiermit umgekehrt).
       *
       * Die frühere Begründung lautete: Abmelden ist keine Sicherheits-
       * einstellung und gehört nicht unter „Konto & Sicherheit" — richtig —,
       * und deshalb auch nicht auf diese Seite, weil `/settings` hierher
       * umleitet und ein Knopf hier ein Knopf unter Einstellungen wäre.
       *
       * Das galt, solange der Kopf zwei Türen ins Konto hatte und das Profil
       * eine eigene war. Seit es nur noch eine gibt, ist diese Seite der
       * Bereich, und der Ausgang gehört an sein Ende.
       *
       * Seit ADR-0111 hat der Betrieb seinen eigenen Kontobereich, und der
       * Knopf steht dort ebenfalls — dieselbe Komponente, nicht ein zweites
       * Formular.
       */}
      <SignOutForm />
    </main>
  );
}
