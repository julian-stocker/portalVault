/**
 * How the shop's order list is divided into "now" and "then" (ADR-0082).
 *
 * Pure: no database, no React, no clock of its own — every function takes the
 * day it should reason about. The decisions worth testing are here, so they
 * can be exercised without a fixture and without waiting for a month to pass.
 *
 * THE RULE, IN ONE LINE
 *
 *     active  =  recent  OR  still open
 *
 * The OR is the whole design. A rule that archived by age alone would hide the
 * one row that matters most: a flagged order is paid, has booked no stock,
 * cannot ship, and gets older every day *because* nobody has dealt with it. By
 * day 16 the tidiest possible list would be the one missing the work.
 *
 * "Still open" is not a new definition invented here. It is `attention <= 2`,
 * which is what `p_open_only` has meant since migration 0024 and what the
 * "Nur offene" filter above the list still means (ADR-0063). One definition of
 * open, read by the badge, the filter and the archive.
 *
 * Note the narrower sibling it is NOT: `hasOpenWork()` counts only buckets 0
 * and 1, because a checkout awaiting payment needs nobody. That question is
 * "must a person act?"; this one is "is this finished?" — and an unfinished
 * order must not be filed away no matter how quiet it is.
 */

/**
 * How long an order stays in the active section on age alone.
 *
 * A rolling window, deliberately not "this month": on the 1st, a calendar
 * month would empty the operator's list of everything they were working on the
 * day before.
 */
export const ACTIVE_WINDOW_DAYS = 15;

/*
 * There is deliberately no `isStillOpen()` here. The `recent OR open` rule is
 * applied in `seller_orders_active()` and nowhere else: a TypeScript copy of
 * `attention <= 2` would be a second place the definition lives, and the one
 * nobody remembers to change.
 */

/* ------------------------------------------------------------------ views */

/**
 * Which of the three things the page is showing.
 *
 * `default`  the working view: recent and open orders, then month headings.
 * `year`     one year, all its months — no active section injected.
 * `month`    one month, complete.
 *
 * The distinction matters for one reason, and it is the reason the type
 * exists: in `default` the month sections must NOT repeat what is already in
 * the active section, and in `year`/`month` they must NOT withhold it. A
 * filter that quietly dropped the recent rows would be a filter that lies
 * about the month it names.
 */
export type ArchiveView =
  | { kind: "default"; year: number }
  | { kind: "year"; year: number }
  | { kind: "month"; year: number; month: number };

/** The month sections repeat nothing only in the working view. */
export function archivedOnly(view: ArchiveView): boolean {
  return view.kind === "default";
}

/** The active section belongs to the working view and nowhere else. */
export function showsActiveSection(view: ArchiveView): boolean {
  return view.kind === "default";
}

/**
 * Read the view out of the query string.
 *
 * Defaults to the current year and all months — never to a hard-coded year
 * (brief §7/§13). Anything unparseable falls back to the default rather than
 * erroring: a mistyped URL should show the shop, not a stack trace.
 *
 * Choosing the current year with all months IS the default view, and is not
 * distinguished from it. There is nothing a separate state could show.
 */
export function resolveArchiveView(
  params: { year?: string; month?: string },
  currentYear: number,
): ArchiveView {
  const year = parseYear(params.year) ?? currentYear;
  const month = parseMonth(params.month);

  if (month !== null) return { kind: "month", year, month };
  if (year !== currentYear) return { kind: "year", year };
  return { kind: "default", year };
}

function parseYear(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  // The lower bound is the schema's (`seller_monthly_reports_year_sane`), so a
  // year the database would refuse never reaches it.
  return Number.isInteger(value) && value >= 2020 && value <= 2200 ? value : null;
}

function parseMonth(raw: string | undefined): number | null {
  if (raw === undefined || raw === "" || raw === "all") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 12 ? value : null;
}

/* --------------------------------------------------------------- calendar */

/** One month that has orders, as `seller_order_calendar()` returns it. */
export type OrderMonth = {
  period_year: number;
  period_month: number;
  /** Every order placed in that Berlin month. */
  order_count: number;
  /** Those not already shown in the active section. */
  archived_count: number;
};

/**
 * The month headings to draw, for one year and one view.
 *
 * In the working view a month whose orders are all still in the active section
 * has nothing of its own to show, so it is left out rather than drawn as a
 * section that opens onto nothing. In an explicit year view every month with
 * any order is listed — the seller asked for the year, so the year is what
 * they get.
 */
export function monthsForView(calendar: readonly OrderMonth[], view: ArchiveView): OrderMonth[] {
  if (view.kind === "month") return [];
  const wantsArchivedOnly = archivedOnly(view);
  return calendar
    .filter((m) => m.period_year === view.year)
    .filter((m) => (wantsArchivedOnly ? m.archived_count > 0 : m.order_count > 0));
}

/** How many orders a heading announces — which count depends on the view. */
export function monthCount(month: OrderMonth, view: ArchiveView): number {
  return archivedOnly(view) ? month.archived_count : month.order_count;
}

/**
 * The years the selector offers: every year with an order, plus the current
 * one, newest first.
 *
 * The current year is always present even before its first order, because it
 * is the year the page opens on. A selector whose default value is missing
 * from its own options is broken on the day a shop takes its first order of
 * the year.
 */
export function yearsForSelector(
  calendar: readonly OrderMonth[],
  currentYear: number,
): number[] {
  const years = new Set<number>([currentYear]);
  for (const month of calendar) years.add(month.period_year);
  return [...years].sort((a, b) => b - a);
}
