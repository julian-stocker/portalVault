/**
 * The "Abgleich-Historie" (2026-11-08; before: the list of every session).
 *
 * ONLY RECONCILIATIONS THAT CHANGED SOMETHING. A session appears here when at
 * least one value was taken over — `applied`, the rows of
 * `sales_recon_applications` that `seller_recon_sessions()` counts. An upload,
 * an analysis or an open session nobody confirmed stays out (`inHistory`).
 * Uploading the same report again opens its open session, so nothing is lost
 * by not listing it.
 *
 * ONLY WHAT THE DATABASE SAID: the period, the day the reconciliation was
 * started (`createdAt`), the number of changes taken over. No category of the
 * analysis, no protocol, no decision counts.
 *
 * Removing an entry needs a database change (it would have to be remembered
 * and is shared by everyone who sees the list); it is not offered here.
 *
 * ONE LAYOUT FOR BOTH SIZES: one card per entry, the facts stacked on a phone
 * and side by side from `sm:` up.
 */
import Link from "next/link";

import { de } from "@/lib/i18n/de";
import { formatDate } from "@/lib/format";
import { sessionHref } from "@/lib/reconciliation/routes";
import type { SessionListItem } from "@/lib/reconciliation/view";

const copy = de.business.reconciliation;
const h = copy.history;

/** Does a session belong in the history? At least one value taken over. */
export const inHistory = (s: Pick<SessionListItem, "applied">): boolean => s.applied > 0;

function period(s: SessionListItem): string {
  if (!s.coveredFrom && !s.coveredTo) return copy.list.noPeriod;
  return `${formatDate(s.coveredFrom)} – ${formatDate(s.coveredTo)}`;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 sm:block">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm tabular-nums">{children}</dd>
    </div>
  );
}

export function HistoryCard({ session: s, marked = false }: { session: SessionListItem; marked?: boolean }) {
  const headingId = `recon-history-${s.id}`;
  return (
    <article aria-labelledby={headingId} data-state={s.state} data-marked={marked || undefined}
             className={`rounded-sky-md bg-surface/60 p-4 ring-1 ${marked ? "ring-2 ring-fg/60" : "ring-border/70"}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-base font-medium">
          {period(s)}
          <span className="ml-2 text-sm font-normal text-muted">{copy.list.channels[s.channel] ?? s.channel}</span>
          {s.state === "closed" ? <span className="ml-2 text-xs font-normal text-muted">· {h.closed}</span> : null}
        </h3>
        <Link href={sessionHref(s.id)}
              className="focus-ring -mx-1 inline-flex min-h-11 items-center rounded-sky-md px-1 text-sm underline underline-offset-2 sm:min-h-8">
          {h.open}<span className="sr-only"> — {period(s)}</span>
        </Link>
      </header>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
        <Fact label={h.period}>{period(s)}</Fact>
        <Fact label={h.date}>{formatDate(s.createdAt)}</Fact>
        <Fact label={h.applied}><span data-count="applied">{h.appliedCount(s.applied)}</span></Fact>
      </dl>
      {s.snapshotsPurgedAt ? <p className="mt-2 text-xs text-muted">{copy.snapshotsPurged}</p> : null}
    </article>
  );
}

export function HistoryList({ sessions, marked = null }: { sessions: readonly SessionListItem[]; marked?: number | null }) {
  const entries = sessions.filter(inHistory);
  if (entries.length === 0) return <p className="mt-3 text-sm text-muted">{h.empty}</p>;
  return (
    <ul className="mt-3 flex flex-col gap-3" aria-label={h.heading}>
      {entries.map((s) => (
        <li key={s.id}><HistoryCard session={s} marked={s.id === marked} /></li>
      ))}
    </ul>
  );
}
