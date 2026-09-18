/**
 * Which monthly reports exist, which can be made, and which cannot yet
 * (ADR-0082).
 *
 * Pure: no database, no React, no clock of its own. Every function is told
 * what day it is, so "what does December look like from September?" is a test
 * and not a wait.
 *
 * THE ONE RULE WORTH STATING
 *
 * A month gets a final report only once it has finished. A report is a claim
 * about a completed period; issued mid-month it would be a claim about
 * something that has not finished happening, and it would be wrong by the
 * afternoon.
 *
 * AND ONE THAT FOLLOWS FROM THE MODEL. A finished month never becomes
 * unfinished, and never needs re-issuing: the month owns the orders PLACED in
 * it, so a payment arriving in September cannot change August, and a refund in
 * September is September's event. There is no "ready again" state because
 * there is nothing that could put a month back into one.
 *
 * This is also why the current month is NOT shown as "almost ready" or with a
 * running total. A live figure and a finalized document are different kinds of
 * thing, and the shop home already carries the live one (ADR-0081). Putting a
 * moving number in the archive would make the archive look like it changes.
 */

/**
 * A report as `seller_monthly_reports()` returns it.
 *
 * `order_value` is the value of the orders PLACED in the month — not money
 * received. `paid_count` and `unpaid_count` say how many of those had been
 * paid when the report was written, and are informational: neither one
 * decides which orders `order_value` counts.
 *
 * There is no `version`. One report per month is the invariant (ADR-0082).
 */
export type MonthlyReport = {
  period_year: number;
  period_month: number;
  finalized_at: string;
  order_count: number;
  order_value: string | number;
  merchandise_amount: string | number;
  shipping_amount: string | number;
  discount_amount: string | number;
  paid_count: number;
  unpaid_count: number;
  currency: string;
  tax_regime: string | null;
};

/**
 * The three states a month can be in — all three derived from something real.
 *
 * There is deliberately no "in Arbeit" and no "wird erstellt" (nothing runs in
 * the background, so no month is ever between these), and no "veraltet"
 * (nothing can make a written report out of date).
 */
export type ReportStatus =
  /** Finalized, and final. The figures below it are the ones written down. */
  | "available"
  /** The month is over and no report was made yet. One action away. */
  | "ready"
  /** The month has not finished. Nothing to finalize, and nothing pretended. */
  | "running";

export type ReportMonth = {
  year: number;
  month: number;
  status: ReportStatus;
  /** The finalized figures, or null when there are none yet. */
  report: MonthlyReport | null;
};

/**
 * The months to list for one year, newest first.
 *
 * A future month of the current year is not listed at all. "Dezember 2026 —
 * noch nicht verfügbar", read in September, is three months of noise saying
 * nothing the calendar does not already say. The month in progress IS listed,
 * because the seller is living in it and its absence would read as an
 * omission.
 */
export function reportMonthsForYear(
  year: number,
  reports: readonly MonthlyReport[],
  today: { year: number; month: number },
): ReportMonth[] {
  const lastMonth = year < today.year ? 12 : year === today.year ? today.month : 0;
  const months: ReportMonth[] = [];

  for (let month = lastMonth; month >= 1; month--) {
    const report =
      reports.find((r) => r.period_year === year && r.period_month === month) ?? null;
    months.push({ year, month, status: statusOf(year, month, report, today), report });
  }

  return months;
}

function statusOf(
  year: number,
  month: number,
  report: MonthlyReport | null,
  today: { year: number; month: number },
): ReportStatus {
  // A written report outranks everything, and nothing demotes it. Even for
  // the current month, if one somehow existed, the honest answer is that it
  // exists — though the database refuses to create it, which is where that
  // invariant actually lives.
  if (report !== null) return "available";
  return isComplete(year, month, today) ? "ready" : "running";
}

/**
 * Has this calendar month ended?
 *
 * Berlin's calendar, decided by the caller — `berlinToday()` in the page, a
 * literal in the tests. Deliberately not "more than 30 days ago": a month is
 * over when the next one starts, not after a fixed number of days.
 */
export function isComplete(
  year: number,
  month: number,
  today: { year: number; month: number },
): boolean {
  return year < today.year || (year === today.year && month < today.month);
}

/** Only a finished month can be finalized — the same rule the database keeps. */
export function canFinalize(entry: ReportMonth): boolean {
  return entry.status === "ready";
}

/**
 * The years the selector offers, newest first, with the current one always
 * present.
 *
 * Present even before the year's first sale, because it is the year the page
 * opens on: a selector whose default value is missing from its own options is
 * broken every January.
 */
export function reportYears(known: readonly number[], currentYear: number): number[] {
  return [...new Set<number>([currentYear, ...known])].sort((a, b) => b - a);
}
