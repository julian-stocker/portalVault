/**
 * Orderbuch — Verkaufsabgleich, one session (ADR-0174, phase 4 step 5).
 *
 * The comparison of one session, report against SkyIsles, page by page.
 * READ-ONLY: no decision, no application, no new analysis — later steps,
 * each released on its own.
 *
 * THE SAME GATES AS THE OVERVIEW, BEFORE THE FIRST QUERY.
 *
 *   1. `(business)/layout.tsx` — the seller operator, else 404 (ADR-0077).
 *   2. here — the Staging project, else 404; a URL segment that is not a
 *      session id, else 404.
 *   3. the reader — not the seller operator, or no such session: 404.
 *
 * The database's own gate (`sales_recon_gate()`) stays the boundary. The URL
 * carries the session id, a category word and a page number — nothing from a
 * report.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CategoryFilter, MatchList, Pagination, SessionOverview } from "@/components/business/reconciliation/session-detail";
import { de } from "@/lib/i18n/de";
import { parseSessionParam, RECONCILIATION_PATH, sessionPageHref } from "@/lib/reconciliation/routes";
import { fetchReconciliationSession, reconciliationEnvironment } from "@/lib/reconciliation/server/queries";
import { pageRequest } from "@/lib/reconciliation/view";

export const metadata: Metadata = { title: de.business.reconciliation.title };

const copy = de.business.reconciliation;
const t = copy.detail;

export default async function ReconciliationSessionPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ kategorie?: string; seite?: string }>;
}) {
  if (!reconciliationEnvironment()) notFound();
  const [{ id: raw }, query] = await Promise.all([params, searchParams ?? Promise.resolve({})]);
  const id = parseSessionParam(raw);
  if (id === null) notFound();

  const request = pageRequest(query);
  const result = await fetchReconciliationSession(id, request);
  if (result.status === "unavailable" || result.status === "not_found") notFound();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-10 md:pt-8">
      <Link href={RECONCILIATION_PATH}
            className="focus-ring -ml-2 inline-flex min-h-11 items-center rounded-sky-md px-2 text-sm text-muted hover:text-fg sm:min-h-8">
        <span aria-hidden="true">←&nbsp;</span>{t.backToList}
      </Link>
      <h1 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
        {copy.title} · {t.title(id)}
      </h1>
      <p className="mt-1 max-w-prose text-sm text-muted">{t.readOnly}</p>

      {result.status === "error" ? (
        <div role="alert" className="mt-4 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">
          <p className="text-danger">{copy.errors.loadFailed}</p>
          <Link href={sessionPageHref(id, { category: request.category })}
                className="focus-ring mt-1 inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-8">
            {copy.list.reload}
          </Link>
        </div>
      ) : (
        <>
          <SessionOverview page={result.page} />
          <section aria-labelledby="recon-matches">
            <h2 id="recon-matches" className="sr-only">{t.matchesHeading}</h2>
            <CategoryFilter page={result.page} />
            <p className="mt-3 text-xs text-muted">{t.legend}</p>
            <MatchList page={result.page} />
            <Pagination page={result.page} />
          </section>
        </>
      )}
    </main>
  );
}
