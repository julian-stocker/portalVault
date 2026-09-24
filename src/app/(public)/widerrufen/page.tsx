import type { Metadata } from "next";
import Link from "next/link";

import { WithdrawalFlow } from "@/components/legal/withdrawal-flow";
import { fetchWithdrawalContext } from "@/lib/legal/withdrawal-context";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.withdrawal.title, description: de.withdrawal.lead };

/**
 * Die elektronische Widerrufsfunktion (§ 356a BGB, ADR-0086).
 *
 * Its own route, linked from the footer on every page, because the statute
 * requires the function to be **continuously available during the withdrawal
 * period, prominently placed and easily accessible** — which a control buried
 * inside an account area would not be.
 *
 * The route is deliberately always reachable rather than gated on a computed
 * deadline. The period runs from the day the goods are received, and this
 * product does not record a delivery date — so a cutoff computed here would be
 * a guess, and a guess that wrongly closed the function would deny a statutory
 * right. Offering it beyond the period costs nothing: the seller assesses the
 * declaration, and an early or late one is still a declaration that reached us.
 */
export default async function WiderrufenPage({ searchParams }: {
  searchParams: Promise<{ bestellung?: string }>;
}) {
  /*
   * Der Zeiger aus „Meine Bestellungen". Er sagt nur, WELCHE Bestellung
   * gemeint ist; ob der Aufrufer sie sehen darf, entscheidet die Datenbank.
   * Ohne Parameter — und für jeden Gast — bleibt alles, wie es war.
   */
  const { bestellung } = await searchParams;
  const context = await fetchWithdrawalContext(bestellung);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-8 pb-16 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
        {de.withdrawal.title}
      </h1>
      <p className="mt-2 text-muted">{de.withdrawal.lead}</p>

      <div className="mt-8">
        <WithdrawalFlow context={context} />
      </div>

      <p className="mt-8 text-sm text-muted">
        <Link href="/widerruf" className="underline underline-offset-4">
          Widerrufsbelehrung und Muster-Widerrufsformular
        </Link>
      </p>
    </main>
  );
}
