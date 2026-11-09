/**
 * Orderbuch — Verkaufsabgleich, the result of one reconciliation
 * (ADR-0174; result view 2026-11-08).
 *
 * Report against SkyIsles, every order filed under exactly one outcome —
 * Identisch, Ergänzen, Abweichung (and "Nicht zugeordnet" apart) — counted
 * and filterable (`?ansicht=`). On an OPEN session one "Abgleichen" per order:
 * missing values preselected, conflicts to choose, everything else a hint.
 * The operator's confirmation applies through 0180 (released, `release.ts`);
 * only the emergency stop `APPLY_RELEASED = false` would lock the button
 * again. A closed or discarded session stays read-only.
 *
 * THE SAME GATES AS THE OVERVIEW, BEFORE THE FIRST QUERY.
 *
 *   1. `(business)/layout.tsx` — the seller operator, else 404 (ADR-0077).
 *   2. here — the Staging project, else 404; a URL segment that is not a
 *      session id, else 404.
 *   3. the reader — not the seller operator, or no such session: 404.
 *
 * The database's own gate (`sales_recon_gate()`) stays the boundary. The URL
 * carries the session id and one filter word — nothing from a report.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CloseSession } from "@/components/business/reconciliation/close-session";
import { ReconcileProvider } from "@/components/business/reconciliation/reconcile-context";
import { ResultList, ResultSummary } from "@/components/business/reconciliation/session-detail";
import { de } from "@/lib/i18n/de";
import { APPLY_RELEASED } from "@/lib/reconciliation/release";
import { parseSessionParam, parseViewParam, RECONCILIATION_PATH, sessionViewHref } from "@/lib/reconciliation/routes";
import { attachLivePieces, attachOrderContext, fetchReconciliationSessionAll, reconciliationEnvironment } from "@/lib/reconciliation/server/queries";

export const metadata: Metadata = { title: de.business.reconciliation.title };

const copy = de.business.reconciliation;
const t = copy.detail;

export default async function ReconciliationSessionPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ ansicht?: string }>;
}) {
  if (!reconciliationEnvironment()) notFound();
  const [{ id: raw }, query] = await Promise.all([params, searchParams ?? Promise.resolve({} as { ansicht?: string })]);
  const id = parseSessionParam(raw);
  if (id === null) notFound();

  const view = parseViewParam(query.ansicht);
  const result = await fetchReconciliationSessionAll(id);
  if (result.status === "unavailable" || result.status === "not_found") notFound();
  const open = result.status === "ok" && result.page.session.state === "open";
  // A sale corrected since the analysis: its current positions, so figures and count are judged again (`live.ts`).
  const matches = result.status === "ok"
    ? await attachOrderContext(result.page.session.channel, await attachLivePieces(result.page.session.channel, result.matches))
    : [];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-10 md:pt-8">
      <Link href={RECONCILIATION_PATH}
            className="focus-ring -ml-2 inline-flex min-h-11 items-center rounded-sky-md px-2 text-sm text-muted hover:text-fg sm:min-h-8">
        <span aria-hidden="true">←&nbsp;</span>{t.backToList}
      </Link>
      <h1 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">{copy.title}</h1>
      <p className="mt-1 max-w-prose text-sm text-muted">{open ? copy.result.intro : copy.result.readOnly}</p>

      {result.status === "error" ? (
        <div role="alert" className="mt-4 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">
          <p className="text-danger">{copy.errors.loadFailed}</p>
          <Link href={sessionViewHref(id, view)}
                className="focus-ring mt-1 inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-8">
            {copy.list.reload}
          </Link>
        </div>
      ) : (
        <ReconcileProvider sessionId={id} sessionOpen={open} applyReleased={APPLY_RELEASED} view={view}>
          <ResultSummary page={result.page} matches={matches} view={view} complete={result.complete} />
          <section aria-labelledby="recon-matches">
            <h2 id="recon-matches" className="sr-only">{t.matchesHeading}</h2>
            <ResultList sessionId={id} matches={matches} view={view} />
          </section>
          {open ? <CloseSession sessionId={id} /> : null}
        </ReconcileProvider>
      )}
    </main>
  );
}
