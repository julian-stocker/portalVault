/**
 * The reconciliation sessions, newest first (ADR-0174, phase 4 step 2).
 *
 * ONLY WHAT THE DATABASE SAID. Every number on a card is a field of
 * `seller_recon_sessions()`, read through `sessionListView`. Nothing is
 * derived: in particular `decided` counts findings with ANY decision —
 * "decide later" included — so it is labelled as exactly that and never as
 * "open" or "applicable" decisions. That number needs `seller_recon_pending`,
 * which does not exist yet.
 *
 * THE HEADING IS THE WAY IN to the session's comparison page
 * (`/abgleich/<id>`, step 5, `sessionHref`). An older link with
 * `?sitzung=<id>` still marks its card.
 *
 * ONE LAYOUT FOR BOTH SIZES. A card per session: stacked on a phone, the
 * facts in two columns from `sm:` up. A table would need sideways scrolling
 * on a phone for a list of a handful of rows.
 *
 * The state is said in words, not only by a tint (WCAG 1.4.1).
 */
import Link from "next/link";

import { de } from "@/lib/i18n/de";
import { formatDate, formatNumber } from "@/lib/format";
import { sessionHref } from "@/lib/reconciliation/routes";
import { CATEGORIES, type SessionListItem, type SessionState } from "@/lib/reconciliation/view";

const copy = de.business.reconciliation;
const list = copy.list;

const STATE_CHIP: Record<SessionState, string> = {
  open: "bg-surface text-fg ring-fg/40",
  closed: "text-muted ring-border/70",
  discarded: "text-muted ring-border/70 line-through decoration-1",
};

function period(s: SessionListItem): string {
  if (!s.coveredFrom && !s.coveredTo) return list.noPeriod;
  return `${formatDate(s.coveredFrom)} – ${formatDate(s.coveredTo)}`;
}

function Fact({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 sm:block">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm tabular-nums">
        {children}
        {hint ? <span className="ml-1 text-xs text-muted">({hint})</span> : null}
      </dd>
    </div>
  );
}

export function SessionCard({ session: s, marked = false }: { session: SessionListItem; marked?: boolean }) {
  const headingId = `recon-session-${s.id}`;
  const ended = s.state === "closed" ? s.closedAt : s.state === "discarded" ? s.discardedAt : null;
  const counts = s.summary
    ? CATEGORIES.filter((c) => (s.summary?.categories[c] ?? 0) > 0).map((c) => [c, s.summary!.categories[c]] as const)
    : null;

  return (
    <article aria-labelledby={headingId} data-state={s.state} data-marked={marked || undefined}
             className={`rounded-sky-md bg-surface/60 p-4 ring-1 ${marked ? "ring-2 ring-fg/60" : "ring-border/70"}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-base font-medium">
          <Link href={sessionHref(s.id)}
                className="focus-ring -mx-1 inline-flex min-h-11 items-center rounded-sky-md px-1 underline underline-offset-2 sm:min-h-8">
            {list.session(s.id)}
          </Link>
          <span className="ml-2 text-sm font-normal text-muted">{list.channels[s.channel] ?? s.channel}</span>
        </h3>
        <span data-testid="state" className={`rounded-sky-md px-2 py-0.5 text-xs ring-1 ${STATE_CHIP[s.state]}`}>
          {copy.states[s.state]}
        </span>
        {marked ? <span className="text-xs font-medium">{list.justAnalysed}</span> : null}
      </header>
      <p className="mt-1 text-xs text-muted">
        {list.stateHints[s.state]}
        {ended ? ` ${s.state === "closed" ? list.closedAt : list.discardedAt} ${formatDate(ended)}.` : null}
      </p>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        <Fact label={list.period}>{period(s)}</Fact>
        <Fact label={list.createdAt}>{formatDate(s.createdAt)}</Fact>
        <Fact label={list.files}>{formatNumber(s.files)}</Fact>
        <Fact label={list.chain}>
          {s.chainComplete ? list.chainComplete : list.chainIncomplete}
        </Fact>
        <Fact label={list.decided} hint={list.decidedHint}>{formatNumber(s.decided)}</Fact>
        <Fact label={list.applied}>{formatNumber(s.applied)}</Fact>
      </dl>

      <div className="mt-3">
        <h4 className="text-xs text-muted">{list.categoriesLabel}</h4>
        {counts === null ? (
          <p className="mt-1 text-sm text-muted">{list.noSummary}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1">
            {counts.map(([c, n]) => (
              <li key={c} className="rounded-sky-md px-2 py-0.5 text-xs ring-1 ring-border/70">
                {copy.categories[c]} <span className="tabular-nums">{formatNumber(n)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {s.snapshotsPurgedAt ? <p className="mt-2 text-xs text-muted">{copy.snapshotsPurged}</p> : null}
    </article>
  );
}

export function SessionList({ sessions, marked = null }: { sessions: readonly SessionListItem[]; marked?: number | null }) {
  if (sessions.length === 0) return <p className="mt-4 text-sm text-muted">{list.empty}</p>;
  return (
    <ul className="mt-4 flex flex-col gap-3" aria-label={list.heading}>
      {sessions.map((s) => (
        <li key={s.id}><SessionCard session={s} marked={s.id === marked} /></li>
      ))}
    </ul>
  );
}
