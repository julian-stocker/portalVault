/**
 * The result of one reconciliation (2026-11-08; before: an analysis header,
 * a filter by database category and page links).
 *
 * ONE CATEGORY PER ORDER. Every order of the report is filed under exactly one
 * outcome (`orderOutcome`, `plan.ts`): Abweichung before Ergänzen before
 * Identisch, and "Nicht zugeordnet" apart for one-sided rows. The counts and
 * the filter are those outcomes — computed on the server from every match of
 * the session (`fetchReconciliationSessionAll`), never from one page of it.
 * Filter links carry one German word (`?ansicht=`), nothing from a report.
 *
 * A SHORT HEAD. Period, the report file and — only when the session is no
 * longer open — its state. The analysis' technical facts (protocol, record
 * numbers, stored rows) are not shown here any more.
 *
 * THE REPORT'S ORDERS FIRST. The extra candidates (`not_comparable`, sales
 * loaded only because they lie within ±3 days of the report) are never
 * counted or listed among the orders: they wait, collapsed, under their own
 * heading below the list in "Alle".
 */
import Link from "next/link";

import { formatDate, formatNumber } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import {
  bulkOrderNumbers, byOutcome, isRelevant, MAIN_OUTCOMES, orderOutcome, outcomeCounts, planMatch, WORK_STATES, workCounts,
} from "@/lib/reconciliation/plan";
import { type ResultView, sessionViewHref } from "@/lib/reconciliation/routes";
import type { Match, SessionPage } from "@/lib/reconciliation/view";

import { BulkOrderNumbers } from "./bulk-order-numbers";
import { MatchCard } from "./match-comparison";
import { ReconcileButton } from "./reconcile-dialog";

const copy = de.business.reconciliation;
const t = copy.detail;
const r = copy.result;

const PILL = "focus-ring inline-flex min-h-11 items-center gap-1 rounded-sky-md px-3 text-sm ring-1 sm:min-h-8";
const TONE: Record<ResultView, string> = {
  identical: "text-success",
  supplement: "text-fg",
  deviation: "text-danger",
  unmatched: "text-muted",
};

/** The orders of the report — every match but the extra candidates. */
const ordersOf = (matches: readonly Match[]) => matches.filter((m) => orderOutcome(m) !== "extra");

export function ResultSummary({ page: p, matches, view, complete }: {
  page: SessionPage; matches: readonly Match[]; view: ResultView | null; complete: boolean;
}) {
  const s = p.session;
  const counts = outcomeCounts(matches);
  const work = workCounts(matches);
  const orders = ordersOf(matches).length;
  const views: ResultView[] = [...MAIN_OUTCOMES, ...(counts.unmatched > 0 ? (["unmatched"] as const) : [])];
  const item = (key: ResultView | null, label: string, n: number, tone = "text-fg") => {
    const current = key === view;
    return (
      <li key={key ?? "all"}>
        <Link href={sessionViewHref(s.id, key)} aria-current={current ? "page" : undefined}
              data-view={key ?? "all"}
              className={`${PILL} ${current ? "bg-fg/10 font-medium ring-fg/40" : "ring-border/70 hover:text-fg"}`}>
          <span className={tone}>{label}</span>
          <span className="tabular-nums font-medium" data-count={key ?? "all"}>{formatNumber(n)}</span>
        </Link>
      </li>
    );
  };
  return (
    <section aria-labelledby="recon-result" className="mt-4">
      <h2 id="recon-result" className="sr-only">{r.heading}</h2>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-x-2">
          <dt className="text-muted">{r.period}</dt>
          <dd className="tabular-nums">
            {s.coveredFrom || s.coveredTo ? `${formatDate(s.coveredFrom)} – ${formatDate(s.coveredTo)}` : copy.list.noPeriod}
          </dd>
        </div>
        {p.files.length > 0 ? (
          <div className="flex min-w-0 gap-x-2">
            <dt className="text-muted">{r.file}</dt>
            <dd className="min-w-0 break-words">{p.files.map((f) => f.fileName).join(", ")}</dd>
          </div>
        ) : null}
        <div className="flex gap-x-2">
          <dt className="sr-only">{r.orders(orders)}</dt>
          <dd className="text-muted">{r.orders(orders)}</dd>
        </div>
        {s.state !== "open" ? (
          <div className="flex gap-x-2">
            <dt className="sr-only">{t.state}</dt>
            <dd className="text-muted" data-testid="state">{copy.states[s.state]}</dd>
          </div>
        ) : null}
      </dl>
      {!complete ? <p role="alert" className="mt-2 text-sm text-danger">{r.incomplete}</p> : null}

      {/* The work, apart from the data: what is open, partly or fully done. */}
      <p data-work-summary="" className="mt-2 text-xs text-muted">
        <span className="font-medium text-fg">{r.workLabel}:</span>{" "}
        {WORK_STATES.map((w) => r.workCount(work[w], r.work[w])).join(" · ")}
      </p>

      <nav aria-label={r.filterLabel} className="mt-4">
        <ul className="flex flex-wrap gap-2">
          {item(null, r.all, orders)}
          {views.map((v) => item(v, r.outcomes[v], counts[v], TONE[v]))}
        </ul>
      </nav>
      {s.snapshotsPurgedAt ? <p className="mt-2 text-xs text-muted">{copy.snapshotsPurged}</p> : null}
    </section>
  );
}

export function ResultList({ sessionId, matches, view }: {
  sessionId: number; matches: readonly Match[]; view: ResultView | null;
}) {
  // Every card's way into the Orderbuch remembers this session and this filter.
  const back = { sessionId, view };
  const orders = ordersOf(matches);
  if (matches.length === 0) return <p className="mt-4 text-sm text-muted">{t.empty}</p>;
  const shown = byOutcome(view === null ? orders : orders.filter((m) => orderOutcome(m) === view));
  // Extra candidates only under "Alle", collapsed, never among the orders.
  const extra = view === null ? matches.filter((m) => orderOutcome(m) === "extra") : [];
  /*
   * THE TWO BULK ACTIONS (2026-11-09, ADR-0183), kept apart: the order
   * numbers, and the money. Both over EVERY order of the session — never one
   * filter of it. The cards keep their own single actions.
   */
  const relevant = orders.filter((m) => isRelevant(planMatch(m)));
  const numbers = bulkOrderNumbers(orders);
  const showNumbers = numbers.takeable.length > 0 || numbers.skipped.some((c) => c.reason !== "closed");
  return (
    <>
      {showNumbers || relevant.length > 1 ? (
        <div data-bulk-actions="" aria-label={r.bulkActions} role="group" className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {showNumbers ? <BulkOrderNumbers sessionId={sessionId} takeable={numbers.takeable} skipped={numbers.skipped} /> : null}
          {relevant.length > 1 ? <ReconcileButton matches={relevant} label={r.reconcileAll(relevant.length)} /> : null}
        </div>
      ) : null}
      {shown.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3" aria-label={t.matchesHeading}>
          {shown.map((m) => <li key={m.id}><MatchCard match={m} back={back} /></li>)}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">{r.emptyView}</p>
      )}
      {extra.length > 0 ? (
        <details data-extra-candidates="" className="mt-6 rounded-sky-md px-3 py-2 ring-1 ring-border/70">
          <summary className="focus-ring -mx-1 inline-flex min-h-11 cursor-pointer items-center rounded-sky-md px-1 text-sm font-medium sm:min-h-8">
            {t.extraCandidates(extra.length)}
          </summary>
          <p className="mt-1 text-xs text-muted">{t.extraCandidatesHint}</p>
          <ul className="mt-3 flex flex-col gap-3">
            {extra.map((m) => <li key={m.id}><MatchCard match={m} back={back} /></li>)}
          </ul>
        </details>
      ) : null}
    </>
  );
}
