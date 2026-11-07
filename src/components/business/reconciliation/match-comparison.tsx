/**
 * One order of a session as a compact card (ADR-0174, simplified CSV
 * reconciliation): the eBay order number, the SkyIsles sale, how many
 * differences there are, one short line per relevant difference — and one
 * action, "Abgleichen" (`reconcile-dialog.tsx`). The sale links to its page
 * in the Orderbuch, the only place where a date, a position, a refund or a
 * cancellation is corrected. The full field table stays behind "Einzelheiten".
 *
 * An order without a relevant difference is one line and its details.
 *
 * WHAT THE COLOURS MEAN comes from `compareMatch` — green only for a value the
 * database PROVED equal, red only for a recorded deviation of a certain pair.
 * Every other state is neutral and said in words (WCAG 1.4.1); `unbekannt`
 * is never written as 0 or as a dash that could pass for "nothing".
 *
 * ONE LAYOUT FOR BOTH SIZES. The field table is a list of rows: stacked with
 * its labels on a phone, one line of five columns from `lg:` up — nothing
 * scrolls sideways. The details, and each value's origin hint, open with
 * `<details>`, which needs no script and no button.
 *
 * Every value is text through React — nothing from a report is rendered as HTML.
 */
import Link from "next/link";

import { formatDate, formatNumber, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import {
  compareMatch, toneOf, type ComparisonField, type FieldStatus, type MatchComparison, type Tone, type ValueKind,
} from "@/lib/reconciliation/compare";
import { orderbookSaleHref } from "@/lib/reconciliation/decide";
import { isRelevant, type MatchPlan, planMatch } from "@/lib/reconciliation/plan";
import type { AtAnalysisValue, JsonScalar, Match } from "@/lib/reconciliation/view";

import { EntryValues, reasonText } from "./plan-values";
import { ReconcileButton } from "./reconcile-dialog";

const copy = de.business.reconciliation;
const t = copy.detail;

const TONE_RING: Record<Tone, string> = {
  match: "ring-success/40",
  deviation: "ring-danger/60",
  neutral: "ring-border/70",
};
const TONE_CHIP: Record<Tone, string> = {
  match: "text-success ring-success/40",
  deviation: "text-danger ring-danger/40",
  neutral: "text-muted ring-border/70",
};

/** A value as text. Null means "not there" (—); `unbekannt` is said by the caller. */
export function valueText(kind: ValueKind, value: JsonScalar): string {
  if (value === null) return t.noValue;
  const n = typeof value === "number" ? value : Number(value);
  switch (kind) {
    case "date": return typeof value === "string" ? formatDate(value) : String(value);
    case "money": return Number.isFinite(n) ? formatPrice(n) : String(value);
    case "count": return Number.isFinite(n) ? formatNumber(n) : String(value);
    case "text": return String(value);
  }
}

function StatusChip({ status }: { status: FieldStatus }) {
  return (
    <span data-status={status} className={`inline-block rounded-sky-md px-2 py-0.5 text-xs ring-1 ${TONE_CHIP[toneOf(status)]}`}>
      {t.statuses[status]}
    </span>
  );
}

type Basis = AtAnalysisValue["basis"];
const BASES: readonly Basis[] = ["derived", "stored", "unknown"];

/**
 * The mark of where a value at analysis comes from. Three different SHAPES,
 * so the difference never rests on colour alone (WCAG 1.4.1):
 *
 *   derived   a check in a circle — the database PROVED the value
 *   stored    a sheet of paper — the value the analysis wrote down; no
 *             check, because it is not independently proven
 *   unknown   a question mark — no value, and none is guessed
 */
function BasisIcon({ basis }: { basis: Basis }) {
  return (
    <svg data-basis-icon={basis} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"
         className="shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.4"
         strokeLinecap="round" strokeLinejoin="round">
      {basis === "derived" ? (
        <><circle cx="8" cy="8" r="6.2" /><path d="M5.2 8.3l1.9 1.9 3.8-4.2" /></>
      ) : basis === "stored" ? (
        <><path d="M4.5 1.8h4.8l2.2 2.2v10.2h-7z" /><path d="M6.4 7.2h3.2M6.4 9.7h3.2M6.4 12.2h2" /></>
      ) : (
        <><circle cx="8" cy="8" r="6.2" /><path d="M6.3 6.3a1.8 1.8 0 1 1 2.5 1.6c-.5.3-.8.7-.8 1.2v.3" />
          <circle cx="8" cy="11.6" r=".5" fill="currentColor" stroke="none" /></>
      )}
    </svg>
  );
}

/**
 * The value at analysis, its mark next to it on ONE line. The explanation is
 * the existing hint text, behind a `<summary>`: focusable with the keyboard,
 * tappable on a phone, no script and no button. `unknown` stays written out.
 */
function AtAnalysis({ kind, at }: { kind: ValueKind; at: AtAnalysisValue | null }) {
  if (at === null) return <span className="text-muted">{t.noValue}</span>;
  return (
    <details data-basis={at.basis} className="min-w-0">
      <summary title={t.bases[at.basis]}
               className="focus-ring -mx-1 inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sky-md px-1 lg:min-h-6 [&::-webkit-details-marker]:hidden">
        {at.basis === "unknown"
          ? <span className="italic text-muted">{t.unknownValue}</span>
          : <span className="tabular-nums">{valueText(kind, at.value)}</span>}
        <BasisIcon basis={at.basis} />
        <span className="sr-only">{t.basisLabel(t.bases[at.basis])}</span>
      </summary>
      <p className="mt-1 text-left text-xs text-muted">
        <span className="font-medium text-fg">{t.bases[at.basis]}:</span> {t.basisHints[at.basis]}
      </p>
    </details>
  );
}

function BasisLegend() {
  return (
    <div className="mt-3 text-xs text-muted">
      <p>{t.basisLegend}</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {BASES.map((b) => (
          <li key={b} className="inline-flex items-center gap-1"><BasisIcon basis={b} />{t.bases[b]}</li>
        ))}
      </ul>
    </div>
  );
}

/*
 * ONE LINE PER FIELD FROM `lg:` UP. At 768 px a 14-digit eBay order number
 * already wraps in a value column; below `lg:` the row stacks with its labels.
 * The result column is 13.5rem (216 px), so that the longest status
 * ("Abweichung, Zuordnung unsicher", 207 px) stays on one line.
 */
const ROW_GRID = "lg:grid lg:grid-cols-[8rem_repeat(3,minmax(0,1fr))_13.5rem] lg:gap-3";

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  // On a phone label and value share a line; an opened origin hint is wider
  // than the space beside the label, so the value wraps onto its own full line.
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 lg:block lg:min-w-0">
      <dt className="shrink-0 text-xs text-muted lg:sr-only">{label}</dt>
      <dd className="ml-auto min-w-0 text-right text-sm break-words lg:ml-0 lg:text-left">{children}</dd>
    </div>
  );
}

function FieldRow({ f }: { f: ComparisonField }) {
  return (
    <li data-field={f.field} data-status={f.status}
        className={`border-t border-border/50 py-2 first:border-t-0 lg:items-center lg:py-1 ${ROW_GRID}`}>
      <p className="text-sm font-medium lg:font-normal">{copy.fields[f.field]}</p>
      <dl className="mt-1 flex flex-col gap-1 lg:contents">
        <Cell label={t.csvValue}><span className="tabular-nums">{valueText(f.kind, f.csv)}</span></Cell>
        <Cell label={t.atAnalysis}><AtAnalysis kind={f.kind} at={f.atAnalysis} /></Cell>
        <Cell label={t.current}><span className="tabular-nums">{valueText(f.kind, f.current)}</span></Cell>
        <Cell label={t.result}><StatusChip status={f.status} /></Cell>
      </dl>
    </li>
  );
}

function Figures({ c, hasOrder }: { c: MatchComparison; hasOrder: boolean }) {
  const { lines, findings, status } = c.figures;
  return (
    <div data-field="figure" data-status={status} className="mt-3 border-t border-border/50 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{t.figures}</h4>
        <StatusChip status={status} />
      </div>
      {!hasOrder ? (
        // No order, so no lines to show — not "purged" (that is only true of an order whose lines were thinned).
        <p className="mt-1 text-xs text-muted">{t.noReportLines}</p>
      ) : lines === null ? (
        <p className="mt-1 text-xs text-muted">{t.linesPurged}</p>
      ) : lines.length === 0 ? (
        <p className="mt-1 text-xs text-muted">{t.noLines}</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5 text-sm">
          {lines.map((l, i) => (
            <li key={`${l.lineRef ?? "line"}-${i}`} className="break-words">
              {t.figureLine(l.quantity, l.name)}
              {l.variant ? <span className="text-muted"> · {l.variant}</span> : null}
              <span className="ml-1 tabular-nums text-muted">{formatPrice(l.value)}</span>
            </li>
          ))}
        </ul>
      )}
      {findings.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs">
          {findings.map((f) => (
            <li key={f.id} className="break-words">
              {t.figureFinding(f.shown.ledger === null ? t.figureMissing : String(f.shown.ledger),
                               f.shown.external === null ? t.figureMissing : String(f.shown.external))}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const BADGE: Record<string, string> = {
  MISSING_IN_SKYISLES: "text-success ring-success/40",
  CONFLICT: "text-danger ring-danger/40",
  UNCERTAIN: "text-muted ring-border/70",
  READ_ONLY_DIFFERENCE: "text-muted ring-border/70",
};

/** One short line per difference that matters — additions, conflicts, checks. */
function PlanLines({ plan }: { plan: MatchPlan }) {
  const entries = [...plan.supplements, ...plan.conflicts, ...plan.checks];
  if (entries.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1" aria-label={copy.reconcile.dialogTitle}>
      {entries.map((e) => (
        <li key={e.finding.id} data-plan={e.state} data-plan-field={e.finding.field}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">{copy.fields[e.finding.field]}</span>
          <EntryValues entry={e} />
          <span title={reasonText(e.reason) ?? undefined}
                className={`rounded-sky-md px-2 py-0.5 text-xs ring-1 ${BADGE[e.state] ?? BADGE.UNCERTAIN}`}>
            {copy.reconcile.badges[e.state]}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function MatchCard({ match: m }: { match: Match }) {
  const c = compareMatch(m);
  const plan = planMatch(m);
  const headingId = `recon-match-${m.id}`;
  const cur = m.ledger?.current ?? null;
  return (
    <article aria-labelledby={headingId} data-category={m.category} data-tone={c.tone}
             className={`rounded-sky-md bg-surface/60 p-3 ring-1 sm:p-4 ${TONE_RING[c.tone]}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 id={headingId} className="text-sm font-medium break-words">
            {m.order ? t.order(m.order.orderRef) : m.sale ? t.sale(m.sale.id) : t.noOrder}
          </h3>
          <p className="text-xs text-muted tabular-nums break-words">
            {m.order && m.sale ? <>{t.sale(m.sale.id)} · </> : null}
            {m.order && !m.sale ? <>{t.noSale} · </> : null}
            {!m.order && m.category !== "not_comparable" ? <>{t.noOrder} · </> : null}
            {cur ? <>{copy.reconcile.ledger} {formatDate(cur.soldOn)} · {formatPrice(cur.expectedTotal)}</> : null}
            {m.order && cur ? " · " : null}
            {m.order ? <>{copy.reconcile.csv} {formatDate(m.order.soldOn)} · {formatPrice(m.order.total)}</> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span title={copy.categoryHints[m.category]}
                className={`rounded-sky-md px-2 py-0.5 text-xs ring-1 ${TONE_CHIP[c.tone]}`}>
            {copy.categories[m.category]}
          </span>
          {c.deviations > 0 ? <span className="text-xs text-danger">{t.deviationCount(c.deviations)}</span> : null}
          {plan.supplements.length > 0 ? <span className="text-xs text-success">{t.additionCount(plan.supplements.length)}</span> : null}
          {c.state && c.state !== "unchanged" ? <span className="text-xs text-muted">{t.ledgerStates[c.state]}</span> : null}
          {/* Why it is not compared — in the head, not only in the details (0169: a reason exists only here). */}
          {m.category === "not_comparable" && m.reason ? (
            <span data-reason={m.reason} className="rounded-sky-md px-2 py-0.5 text-xs ring-1 ring-border/70">
              {copy.notComparableReasons[m.reason]}
            </span>
          ) : null}
          {cur?.isTest ? <span className="text-xs text-muted">{t.testSale}</span> : null}
        </div>
      </header>
      {m.category === "not_comparable" && m.reason ? (
        <p className="mt-1 text-xs text-muted">{t.notCompared}. {t.reasonHints[m.reason]}</p>
      ) : null}

      <PlanLines plan={plan} />

      {isRelevant(plan) || m.sale ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          {isRelevant(plan) ? <ReconcileButton matches={[m]} /> : null}
          {m.sale ? (
            <Link href={orderbookSaleHref(m.sale.id)} data-orderbook=""
                  className="focus-ring -mx-1 inline-flex min-h-11 items-center rounded-sky-md px-1 text-sm underline underline-offset-2 sm:min-h-8">
              {copy.reconcile.orderbook}
            </Link>
          ) : null}
        </div>
      ) : null}

      <details data-match-details="" className="mt-2">
        <summary className="focus-ring -mx-1 inline-flex min-h-11 cursor-pointer items-center rounded-sky-md px-1 text-sm underline underline-offset-2 sm:min-h-8">
          {t.details}
        </summary>
        <div className="mt-2">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {m.certainty ? (
              <div><dt className="inline text-muted">{t.certainty}: </dt><dd className="inline">{copy.certainties[m.certainty]}
                {m.dateDelta !== null ? ` · ${t.dateDelta(m.dateDelta)}` : ""}</dd></div>
            ) : null}
            {m.reason ? (
              <div><dt className="inline text-muted">{t.reason}: </dt><dd className="inline">{copy.notComparableReasons[m.reason]}</dd></div>
            ) : null}
          </dl>
          {c.state ? <p className="mt-1 text-xs">{t.ledgerStateHints[c.state]}</p> : null}
          {cur?.cancelledOn ? <p className="mt-1 text-xs">{t.cancelled(formatDate(cur.cancelledOn))}</p> : null}
          {cur && cur.refundsTotal > 0 ? <p className="mt-1 text-xs">{t.refunds(formatPrice(cur.refundsTotal))}</p> : null}

          {m.competitors.length > 0 ? (
            <div className="mt-2 text-xs">
              <p className="text-muted">{t.competitors}</p>
              <ul className="mt-0.5 flex flex-wrap gap-1">
                {m.competitors.map((x) => (
                  <li key={`${x.saleId}-${x.orderRef}`} className="rounded-sky-md px-2 py-0.5 ring-1 ring-border/70">
                    {t.competitor(x.saleId)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {c.fields.some((f) => f.atAnalysis !== null) ? <BasisLegend /> : null}
          <div className={`mt-3 hidden text-xs text-muted ${ROW_GRID}`} aria-hidden="true">
            <span>{t.field}</span><span>{t.csvValue}</span><span>{t.atAnalysis}</span><span>{t.current}</span><span>{t.result}</span>
          </div>
          <ul className="mt-1">
            {c.fields.map((f) => <FieldRow key={f.field} f={f} />)}
          </ul>
          <Figures c={c} hasOrder={m.order !== null} />
        </div>
      </details>
    </article>
  );
}
