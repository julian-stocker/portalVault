/**
 * Orderbuch — Verkaufsabgleich (ADR-0174, phase 4 step 2).
 *
 * The list of reconciliation sessions, and above it the report check
 * (`ReportPicker`). Each session opens its comparison page (`[id]`, step 5).
 * No decision, no session action yet: later steps, each released on its own.
 *
 * TWO GATES BEFORE THE FIRST QUERY.
 *
 *   1. `(business)/layout.tsx` — the seller operator, else 404 (ADR-0077).
 *   2. here — the Staging project, else 404. On Production the functions do
 *      not exist (ADR-0174 no. 14); a page that cannot work is not shown.
 *
 * The database's own gate (`sales_recon_gate()`) stays the boundary.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReportPicker } from "@/components/business/reconciliation/report-picker";
import { SessionList } from "@/components/business/reconciliation/session-list";
import { de } from "@/lib/i18n/de";
import { parseSessionParam, RECONCILIATION_PATH } from "@/lib/reconciliation/routes";
import { fetchReconciliationSessions, reconciliationEnvironment } from "@/lib/reconciliation/server/queries";

export const metadata: Metadata = { title: de.business.reconciliation.title };

const copy = de.business.reconciliation;

export default async function ReconciliationPage({ searchParams }: {
  searchParams?: Promise<{ sitzung?: string }>;
} = {}) {
  if (!reconciliationEnvironment()) notFound();
  // `?sitzung=` marks a session (older links; an analysis now opens its own page).
  const marked = parseSessionParam((await searchParams)?.sitzung);

  const result = await fetchReconciliationSessions();
  // Not the seller operator — the layout already answered 404; this is the second gate.
  if (result.status === "unavailable") notFound();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-10 md:pt-8">
      <Link href="/business/orderbuch/verkauf"
            className="focus-ring -ml-2 inline-flex min-h-11 items-center rounded-sky-md px-2 text-sm text-muted hover:text-fg sm:min-h-8">
        <span aria-hidden="true">←&nbsp;</span>{copy.backToSales}
      </Link>
      <h1 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">{copy.title}</h1>
      <p className="mt-1 max-w-prose text-sm text-muted">{copy.intro}</p>

      {/* Choosing and checking reports happens in the browser only (step 3). */}
      <ReportPicker />

      <section aria-labelledby="recon-sessions" className="mt-8">
        <h2 id="recon-sessions" className="text-base font-medium">{copy.list.heading}</h2>
        {result.status === "error" ? (
          <div role="alert" className="mt-4 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">
            <p className="text-danger">{copy.errors.loadFailed}</p>
            <Link href={RECONCILIATION_PATH} className="focus-ring mt-1 inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-8">
              {copy.list.reload}
            </Link>
          </div>
        ) : (
          <SessionList sessions={result.sessions} marked={marked} />
        )}
      </section>
    </main>
  );
}
