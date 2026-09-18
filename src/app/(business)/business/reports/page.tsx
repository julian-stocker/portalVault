import type { Metadata } from "next";

import { ReportCreateButton } from "@/components/admin/report-create-button";
import {
  canFinalize,
  reportMonthsForYear,
  reportYears,
  type ReportMonth,
} from "@/lib/admin/report-archive";
import { fetchMonthlyReports, fetchReportYears } from "@/lib/admin/reports";
import { berlinToday, formatDate, formatNumber, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.business.reports.heading };
export const dynamic = "force-dynamic";

/**
 * The monthly order-activity archive (ADR-0082).
 *
 * One row per month, newest first — a list that still reads as a list after
 * ten years of trade, not twelve cards a year.
 *
 * AN EVENT BELONGS TO THE MONTH IT HAPPENED IN
 *
 * An order belongs to the month it was PLACED in. Payment date does not move
 * it, shipping does not move it, and a refund does not reach back into it — a
 * refund is its own event in its own month. So a written report is not "stable
 * for now"; there is nothing that could change it.
 *
 * That is also why the main figure is called Bestellwert. "Umsatz",
 * "Einnahme" and "bezahlt" all claim money arrived, and for an order placed on
 * the 31st and paid on the 2nd every one of them would be false on the day the
 * report is written.
 *
 * WHAT IS NOT ON THIS PAGE, AND WHY IT IS SAID RATHER THAN SHOWN AS ZERO
 *
 * No refund: there is no refund amount, date or table anywhere — only four
 * status values nothing writes. No provider fee: `payment_events` keeps the
 * event id and outcome, never the provider's payload (0012). No VAT: § 19
 * UStG means it is not levied, and a 0,00 € line would claim it was levied at
 * zero (0011). No profit: nothing here knows what the stock cost.
 *
 * Four columns of zeroes would read as "nothing was deducted". Two sentences
 * under the list read as what is true.
 */
export default async function BusinessReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: rawYear } = await searchParams;
  const today = berlinToday();

  const [reports, knownYears] = await Promise.all([fetchMonthlyReports(), fetchReportYears()]);

  const years = reportYears(knownYears, today.year);
  const requested = Number(rawYear);
  // An unknown or missing year falls back to this one — never to a literal.
  const year = years.includes(requested) ? requested : today.year;
  const months = reportMonthsForYear(year, reports, today);
  const copy = de.business.reports;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{copy.heading}</h1>
      <p className="mt-2 text-sm text-muted">{copy.pageHint}</p>

      <form method="get" className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted">{de.business.archive.year}</span>
          <select
            name="year"
            defaultValue={String(year)}
            className="rounded-sky-sm bg-surface px-2 py-1 text-sm ring-1 ring-border/70"
          >
            {years.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-sky-sm bg-surface px-3 py-1 ring-1 ring-border/70 hover:ring-border-strong"
        >
          {de.business.archive.apply}
        </button>
      </form>

      {months.length === 0 ? (
        <p className="mt-8 text-muted">{copy.empty}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {months.map((entry) => (
            <MonthRow key={`${entry.year}-${entry.month}`} entry={entry} />
          ))}
        </ul>
      )}

      {/* What the figures mean, and what they leave out. Said once, under the
          list they apply to. */}
      <p className="mt-8 text-xs text-muted">{copy.limits}</p>
      <p className="mt-2 text-xs text-muted">{copy.limitsMissing}</p>
      {/* No button that does nothing: the export is not built, and the page
          says so rather than offering a link into an empty room (ADR-0080). */}
      <p className="mt-2 text-xs text-muted">{copy.downloadLater}</p>
    </main>
  );
}

function MonthRow({ entry }: { entry: ReportMonth }) {
  const copy = de.business.reports;
  const report = entry.report;

  return (
    <li className="rounded-sky-lg bg-surface/80 px-5 py-4 ring-1 ring-border/70">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <span className="font-medium">{de.business.monthLabel(entry.year, entry.month)}</span>
          <span className="ml-3 text-sm text-muted">{copy.status[entry.status]}</span>
          {entry.status === "running" ? (
            <p className="mt-1 text-sm text-muted">{copy.runningHint}</p>
          ) : null}
          {report === null ? null : (
            <p className="mt-1 text-sm text-muted">
              {copy.finalizedAt(formatDate(report.finalized_at))}
            </p>
          )}
        </div>

        {canFinalize(entry) ? <ReportCreateButton year={entry.year} month={entry.month} /> : null}
      </div>

      {report === null ? null : <Figures report={report} />}
    </li>
  );
}

/**
 * The figures, compact: what was paid on one line, how it splits on the next.
 *
 * `tax_regime` is shown as a NAME, which is the only honest shape for it — the
 * order records "sold under § 19 UStG", not "taxed at 0%" (0011).
 */
function Figures({ report }: { report: NonNullable<ReportMonth["report"]> }) {
  const copy = de.business.reports;
  const regime = report.tax_regime;
  const regimeLabel =
    regime === null
      ? null
      : (copy.taxRegimeNames[regime as keyof typeof copy.taxRegimeNames] ?? regime);

  return (
    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-border/60 pt-3 text-sm">
      <Figure label={copy.orders} value={formatNumber(report.order_count)} strong />
      <Figure label={copy.orderValue} value={formatPrice(Number(report.order_value))} strong />
      <Figure label={copy.merchandise} value={formatPrice(Number(report.merchandise_amount))} />
      <Figure label={copy.shipping} value={formatPrice(Number(report.shipping_amount))} />
      {Number(report.discount_amount) > 0 ? (
        <Figure label={copy.discount} value={formatPrice(Number(report.discount_amount))} />
      ) : null}
      {/* Informational, and only worth a line when something was still open.
          It never redefines the Bestellwert above it. */}
      {report.unpaid_count > 0 ? (
        <Figure label={copy.unpaid} value={formatNumber(report.unpaid_count)} />
      ) : (
        <Figure label={copy.paid} value={formatNumber(report.paid_count)} />
      )}
      {regimeLabel === null ? null : <Figure label={copy.taxRegime} value={regimeLabel} />}
    </dl>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
