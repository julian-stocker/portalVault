/**
 * The frame of a session's comparison page (ADR-0174, phase 4 step 5):
 * the overview, the category filter, the page links and the list of matches.
 *
 * ONLY WHAT THE DATABASE SAID. The counts are the stored summary
 * (`summarize()` at analysis); the page arithmetic is `PageInfo`, computed
 * from the answer's `total`. Filter and paging are LINKS: the next page is
 * the server's next answer (`seller_recon_session` with offset and limit),
 * never a slice of a list the browser already holds.
 *
 * THE REPORT'S ORDERS FIRST. In "Alle" the extra candidates — SkyIsles sales
 * loaded only because they lie within ±3 days of the report
 * (`not_comparable`) — are not shown as orders: they wait, collapsed, under
 * their own heading below the list. Their own filter still lists them.
 */
import Link from "next/link";

import { formatDate, formatNumber } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { sessionPageHref } from "@/lib/reconciliation/routes";
import { isExtraCandidate, isRelevant, planMatch } from "@/lib/reconciliation/plan";
import { CATEGORIES, type Category, pairingCounts, type SessionPage } from "@/lib/reconciliation/view";

import { MatchCard } from "./match-comparison";
import { ReconcileButton } from "./reconcile-dialog";

const copy = de.business.reconciliation;
const t = copy.detail;

const DEVIATION_FIELDS = ["sold_on", "items_net", "shipping", "total", "pieces", "figure"] as const;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 sm:block">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm tabular-nums">{children}</dd>
    </div>
  );
}

export function SessionOverview({ page: p }: { page: SessionPage }) {
  const s = p.session;
  const summary = s.summary;
  // The stored rows, split into real pairs and the one-sided rows (`pairingCounts`).
  const counts = summary ? pairingCounts(summary.categories) : null;
  return (
    <section aria-labelledby="recon-overview" className="mt-4 rounded-sky-md bg-surface/60 p-4 ring-1 ring-border/70">
      <h2 id="recon-overview" className="sr-only">{t.overview}</h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
        <Fact label={t.platform}>{copy.list.channels[s.channel] ?? s.channel}</Fact>
        <Fact label={t.state}><span data-testid="state">{copy.states[s.state]}</span></Fact>
        <Fact label={t.createdAt}>{formatDate(s.createdAt)}</Fact>
        <Fact label={t.period}>
          {s.coveredFrom || s.coveredTo ? `${formatDate(s.coveredFrom)} – ${formatDate(s.coveredTo)}` : copy.list.noPeriod}
        </Fact>
        {counts === null ? (
          <Fact label={t.matches}>{copy.list.noSummary}</Fact>
        ) : (
          <>
            <Fact label={t.pairs}><span data-count="pairs">{formatNumber(counts.pairs)}</span></Fact>
            {summary ? <Fact label={t.deviatingMatches}>{formatNumber(summary.categories.deviating)}</Fact> : null}
            <Fact label={t.reportOnlyCount}><span data-count="report-only">{formatNumber(counts.reportOnly)}</span></Fact>
            <Fact label={t.ledgerOnlyCount}><span data-count="ledger-only">{formatNumber(counts.ledgerOnly)}</span></Fact>
          </>
        )}
      </dl>
      <p className="mt-2 text-xs text-muted">{copy.list.stateHints[s.state]}</p>

      <details className="mt-2">
        <summary className="focus-ring -mx-1 inline-flex min-h-11 cursor-pointer items-center rounded-sky-md px-1 text-sm underline underline-offset-2 sm:min-h-8">
          {t.moreFacts}
        </summary>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Fact label={t.chain}>{s.chainComplete ? copy.list.chainComplete : copy.list.chainIncomplete}</Fact>
          {s.recordFirst !== null && s.recordLast !== null ? (
            <Fact label={t.records}>{t.recordRange(String(s.recordFirst), String(s.recordLast))}</Fact>
          ) : null}
          {counts ? (
            <>
              <Fact label={t.unpairedCount}><span data-count="unpaired">{formatNumber(counts.unpaired)}</span></Fact>
              <Fact label={t.matchRecords}><span data-count="records">{formatNumber(counts.records)}</span></Fact>
            </>
          ) : null}
        </dl>
        {counts && counts.unpaired > 0 ? <p className="mt-2 text-xs text-muted">{t.unpairedHint}</p> : null}
        {summary ? (
          <div className="mt-3">
            <h3 className="text-xs text-muted">{t.deviationsByField}</h3>
            <ul className="mt-1 flex flex-wrap gap-1">
              {DEVIATION_FIELDS.map((f) => (
                <li key={f} className="rounded-sky-md px-2 py-0.5 text-xs ring-1 ring-border/70">
                  {copy.fields[f]} <span className="tabular-nums">{formatNumber(summary.deviations[f])}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>

      <div className="mt-3">
        <h3 className="text-xs text-muted">{t.filesHeading}</h3>
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {p.files.map((f) => (
            <li key={f.id} className="break-words">
              {f.fileName}
              <span className="ml-1 text-xs text-muted">
                · {t.fileOrders(f.orders)}
                {f.firstSoldOn || f.lastSoldOn ? ` · ${formatDate(f.firstSoldOn)} – ${formatDate(f.lastSoldOn)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {s.snapshotsPurgedAt ? <p className="mt-2 text-xs text-muted">{copy.snapshotsPurged}</p> : null}
    </section>
  );
}

const PILL = "focus-ring inline-flex min-h-11 items-center rounded-sky-md px-3 text-sm ring-1 sm:min-h-8";

export function CategoryFilter({ page: p }: { page: SessionPage }) {
  const id = p.session.id;
  const counts = p.session.summary?.categories ?? null;
  const active = p.page.category;
  const item = (category: Category | null, label: string, n: number | null) => {
    const current = category === active;
    return (
      <li key={category ?? "all"}>
        <Link href={sessionPageHref(id, { category })} aria-current={current ? "page" : undefined}
              className={`${PILL} ${current ? "bg-fg/10 font-medium ring-fg/40" : "ring-border/70 hover:text-fg"}`}>
          {label}{n !== null ? <span className="ml-1 tabular-nums text-muted">{formatNumber(n)}</span> : null}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label={t.filterLabel} className="mt-6">
      <ul className="flex flex-wrap gap-2">
        {item(null, t.all, null)}
        {CATEGORIES.filter((c) => counts === null || counts[c] > 0 || c === active)
          .map((c) => item(c, copy.categories[c], counts ? counts[c] : null))}
      </ul>
    </nav>
  );
}

export function Pagination({ page: p }: { page: SessionPage }) {
  const { page, pages, previousOffset, nextOffset, limit, category } = p.page;
  if (pages <= 1 && previousOffset === null) return null;
  const at = (offset: number) => sessionPageHref(p.session.id, { category, page: Math.floor(offset / limit) + 1 });
  return (
    <nav aria-label={t.pagination} className="mt-4 flex flex-wrap items-center justify-between gap-2">
      {previousOffset !== null
        ? <Link href={at(previousOffset)} rel="prev" className={`${PILL} ring-border/70`}>← {t.previous}</Link>
        : <span />}
      <span className="text-sm text-muted tabular-nums">{t.pageOf(page, pages)}</span>
      {nextOffset !== null
        ? <Link href={at(nextOffset)} rel="next" className={`${PILL} ring-border/70`}>{t.next} →</Link>
        : <span />}
    </nav>
  );
}

export function MatchList({ page: p }: { page: SessionPage }) {
  const { total, offset, category } = p.page;
  if (total > 0 && p.matches.length === 0 && offset >= total) {
    return (
      <div className="mt-4 text-sm">
        <p className="text-muted">{t.beyondEnd}</p>
        <Link href={sessionPageHref(p.session.id, { category })}
              className="focus-ring mt-1 inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-8">
          {t.firstPage}
        </Link>
      </div>
    );
  }
  if (p.matches.length === 0) {
    return <p className="mt-4 text-sm text-muted">{category ? t.emptyCategory : t.empty}</p>;
  }
  // In "Alle" the report's orders come first; extra candidates are listed apart, collapsed.
  const extra = category === null ? p.matches.filter(isExtraCandidate) : [];
  const main = category === null ? p.matches.filter((m) => !isExtraCandidate(m)) : p.matches;
  const relevant = main.filter((m) => isRelevant(planMatch(m)));
  return (
    <>
      {relevant.length > 1 ? (
        <div className="mt-4"><ReconcileButton matches={relevant} label={copy.reconcile.all(relevant.length)} /></div>
      ) : null}
      {main.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3" aria-label={t.matchesHeading}>
          {main.map((m) => <li key={m.id}><MatchCard match={m} /></li>)}
        </ul>
      ) : null}
      {extra.length > 0 ? (
        <details data-extra-candidates="" className="mt-6 rounded-sky-md px-3 py-2 ring-1 ring-border/70">
          <summary className="focus-ring -mx-1 inline-flex min-h-11 cursor-pointer items-center rounded-sky-md px-1 text-sm font-medium sm:min-h-8">
            {t.extraCandidates(extra.length)}
          </summary>
          <p className="mt-1 text-xs text-muted">{t.extraCandidatesHint}</p>
          <ul className="mt-3 flex flex-col gap-3">
            {extra.map((m) => <li key={m.id}><MatchCard match={m} /></li>)}
          </ul>
        </details>
      ) : null}
    </>
  );
}
