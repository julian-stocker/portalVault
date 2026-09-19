import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  canFinalize,
  isComplete,
  reportMonthsForYear,
  reportYears,
  type MonthlyReport,
} from "@/lib/admin/report-archive";
import { de } from "@/lib/i18n/de";
import { latestFunction } from "@/test-support/migrations";

/**
 * The monthly settlement archive (ADR-0082).
 *
 * Two things can go wrong here and both are worse than a layout bug: claiming
 * a month is finished when it is not, and printing a financial figure this
 * system does not actually hold. Most of what follows guards those.
 */

const SQL = readFileSync("supabase/migrations/0045_seller_order_archive.sql", "utf8");
const PAGE = readFileSync("src/app/(business)/business/reports/page.tsx", "utf8");
const READS = readFileSync("src/lib/admin/reports.ts", "utf8");
const ACTION = readFileSync("src/lib/admin/report-actions.ts", "utf8");
const COPY = readFileSync("src/lib/i18n/de.ts", "utf8");
const KPI = readFileSync("supabase/migrations/0044_seller_year_to_date.sql", "utf8");
const HUB = readFileSync("src/app/(business)/business/page.tsx", "utf8");

/** The effective definition, wherever in the history it now lives. */
function fn(name: string): string {
  return latestFunction(name).body;
}

const TODAY = { year: 2026, month: 9 };

const august: MonthlyReport = {
  period_year: 2026,
  period_month: 8,
  finalized_at: "2026-09-01T08:14:00+02:00",
  order_count: 42,
  order_value: "3204.50",
  merchandise_amount: "3054.50",
  shipping_amount: "150.00",
  discount_amount: "0.00",
  paid_count: 41,
  unpaid_count: 1,
  currency: "EUR",
  tax_regime: "small_business_19",
};

describe("only a finished month gets a final report", () => {
  it("the month in progress is not available", () => {
    const months = reportMonthsForYear(2026, [], TODAY);
    const september = months.find((m) => m.month === 9);
    expect(september?.status).toBe("running");
    expect(canFinalize(september!)).toBe(false);
  });

  it("but it is listed, because the seller is living in it", () => {
    expect(reportMonthsForYear(2026, [], TODAY).map((m) => m.month)).toContain(9);
  });

  it("a finished month with no report yet can be made", () => {
    const august2026 = reportMonthsForYear(2026, [], TODAY).find((m) => m.month === 8);
    expect(august2026?.status).toBe("ready");
    expect(canFinalize(august2026!)).toBe(true);
  });

  it("a finished month with a report is available", () => {
    const entry = reportMonthsForYear(2026, [august], TODAY).find((m) => m.month === 8);
    expect(entry?.status).toBe("available");
    expect(entry?.report).toBe(august);
    // Nothing left to do to it.
    expect(canFinalize(entry!)).toBe(false);
  });

  it("a month is over when the next one starts, not after thirty days", () => {
    expect(isComplete(2026, 8, TODAY)).toBe(true);
    expect(isComplete(2026, 9, TODAY)).toBe(false);
    expect(isComplete(2025, 12, TODAY)).toBe(true);
    expect(isComplete(2027, 1, TODAY)).toBe(false);
    // February is complete on 1 March, whether it had 28 days or 29.
    expect(isComplete(2026, 2, { year: 2026, month: 3 })).toBe(true);
  });

  it("future months of this year are not listed at all", () => {
    // Three rows reading "noch nicht verfügbar" say nothing the calendar
    // does not already say.
    expect(reportMonthsForYear(2026, [], TODAY).map((m) => m.month)).toEqual([
      9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
  });

  it("a past year lists all twelve", () => {
    expect(reportMonthsForYear(2025, [], TODAY)).toHaveLength(12);
  });

  it("a future year lists none", () => {
    expect(reportMonthsForYear(2027, [], TODAY)).toEqual([]);
  });

  it("and the database refuses the running month regardless of the page", () => {
    const finalize = fn("seller_finalize_monthly_report");
    expect(finalize).toContain("if v_end > now() then");
    expect(finalize).toContain("the month is not over yet");
  });
});

describe("an order belongs to the month it was placed in", () => {
  const finalize = fn("seller_finalize_monthly_report");

  it("the month is decided by placed_at", () => {
    expect(finalize).toContain("and o.placed_at >= v_start");
    expect(finalize).toContain("and o.placed_at <  v_end");
  });

  it("and by nothing else — not payment, not shipping, not fulfilment", () => {
    // A month keyed on payment would move an order between months depending
    // on when a webhook arrived, and rewrite a closed month every time a late
    // payment landed.
    for (const field of ["paid_at", "shipped_at", "completed_at", "fulfillment_status"]) {
      expect(finalize, field).not.toContain(field);
    }
  });

  it("payment is not a condition of counting it", () => {
    // This is the predicate that changed. The first draft counted `paid`
    // orders, which made August's figure a statement about payments wearing a
    // month's name.
    const predicate = finalize.slice(finalize.indexOf("where o.commerce_mode = 'live'"));
    expect(predicate).toContain("public.order_counts_as_placed(o.payment_status)");
    expect(predicate).not.toContain("o.payment_status = 'paid'");
  });

  it("an August order paid in September is still August's", () => {
    // Nothing in the predicate can express "paid in the same month", so there
    // is no shape this could take.
    expect(finalize).not.toContain("paid_at >=");
    expect(finalize).not.toContain("date_trunc('month', o.paid_at");
  });

  it("and a refunded order stays in the month it was placed", () => {
    // The refund is its own event in its own month. Excluding the order here
    // would reach back into a closed month, which is the thing the model
    // forbids.
    expect(finalize).not.toContain("'refunded'");
    expect(finalize).not.toContain("'partially_refunded'");
  });
});

describe("what counts as an order", () => {
  const finalize = fn("seller_finalize_monthly_report");

  it("an abandoned checkout does not", () => {
    // 'expired' is written by expire_stale_checkouts() when the 20-minute hold
    // lapses and the stock goes back. Nobody ordered anything, so this is not
    // an order that stopped counting — it is a row that was never an order.
    expect(KPI).toContain("select p_payment_status is distinct from 'expired';");
    const payments = readFileSync("supabase/migrations/0012_payment_core.sql", "utf8");
    expect(payments).toContain("set payment_status = 'expired'");
  });

  it("a CANCELLED order does count, and must keep counting", () => {
    /*
     * The correction that made the event model consistent. A cancellation is a
     * real order undone by a LATER event; excluding it here would silently
     * delete an order from a month that had already reported it — the exact
     * retroactive rewriting the model forbids. Nothing writes 'cancelled'
     * today, so this pins the boundary before it can be got wrong.
     */
    const predicate = KPI.slice(
      KPI.indexOf("create or replace function public.order_counts_as_placed"),
      KPI.indexOf("comment on function public.order_counts_as_placed"),
    );
    expect(predicate).not.toContain("cancelled");
    expect(predicate).not.toContain("refunded");
    expect(predicate).toContain("is distinct from 'expired'");
  });

  it("and whoever implements cancellation is told not to reuse 'expired'", () => {
    // One means "never became business", the other "was business, then undone".
    expect(KPI).toContain("Do not reuse 'cancelled' to");
    expect(SQL).toContain("must\n-- NOT be modelled by writing 'cancelled' onto an abandoned checkout");
  });

  it("a cart does not either, because a cart is not in the database", () => {
    const core = readFileSync("supabase/migrations/0010_commerce_core.sql", "utf8");
    expect(core).not.toContain("create table public.carts");
    // The row is written when the customer submits the checkout.
    expect(core).toContain("insert into public.orders");
  });

  it("an order awaiting payment does count", () => {
    // Including the flagged one that the expiry sweep deliberately never
    // touches — a real order waiting for a human.
    expect(finalize).not.toContain("payment_status = 'pending'");
    const payments = readFileSync("supabase/migrations/0012_payment_core.sql", "utf8");
    expect(payments).toContain("and o.needs_resolution = false");
  });

  it("and the states that are actually written are the ones reasoned about", () => {
    // Only 'pending', 'paid' and 'expired' are written anywhere in the schema.
    // 'cancelled', 'failed', 'refunded' and 'partially_refunded' sit in the
    // CHECK unwritten; if that changes, the predicate above is where it lands.
    const core = readFileSync("supabase/migrations/0010_commerce_core.sql", "utf8");
    for (const state of ["'pending'", "'paid'", "'expired'", "'cancelled'"]) {
      expect(core, state).toContain(state);
    }
    const written = /set payment_status = '(\w+)'/g;
    const all = [
      readFileSync("supabase/migrations/0012_payment_core.sql", "utf8"),
      core,
    ].join("\n");
    const states = new Set([...all.matchAll(written)].map((m) => m[1]));
    expect(states.has("cancelled")).toBe(false);
    expect(KPI).toContain("'cancelled' is written by nothing today");
  });
});

describe("a finalized report stops changing", () => {
  it("is stored, not recomputed on read", () => {
    expect(SQL).toContain("create table if not exists public.seller_monthly_reports");
    const reader = fn("seller_monthly_reports");
    // The reader selects from the table. If it summed `orders` it would be a
    // live query wearing a report's name.
    expect(reader).toContain("from public.seller_monthly_reports r");
    expect(reader).not.toContain("from public.orders");
    expect(reader).toContain("stable");
  });

  it("because a written month is final, not merely stable for now", () => {
    // Amounts are frozen by orders_protect_immutable(), and `placed_at` with
    // them — so the month an order belongs to can never change either.
    const immutable = readFileSync("supabase/migrations/0010_commerce_core.sql", "utf8");
    expect(immutable).toMatch(/new\.total_amount\s+is distinct from old\.total_amount/);
    expect(immutable).toMatch(/new\.placed_at\s+is distinct from old\.placed_at/);
  });

  it("a late payment is not a reason to re-issue anything", () => {
    // It does not change which month the order belongs to, so there is
    // nothing for a re-issue to correct.
    expect(SQL).toContain("Under this model a late payment is not a reason to");
    const model = readFileSync("src/lib/admin/report-archive.ts", "utf8");
    expect(model).toContain("never needs re-issuing");
  });

  it("calling it again returns the same report rather than refreshing it", () => {
    const finalize = fn("seller_finalize_monthly_report");
    expect(finalize).toContain("if v_id is null then");
    // The insert is inside that branch, so an existing month is never rewritten.
    const afterExisting = finalize.slice(finalize.indexOf("if v_id is null then"));
    expect(afterExisting).toContain("insert into public.seller_monthly_reports");
    expect(finalize).not.toContain("on conflict");
    expect(finalize).not.toContain("update public.seller_monthly_reports");
    expect(finalize).not.toContain("delete from public.seller_monthly_reports");
  });

  it("records when it was made and by whom", () => {
    expect(SQL).toContain("finalized_at timestamptz not null default now()");
    expect(SQL).toContain("finalized_by uuid");
    expect(fn("seller_finalize_monthly_report")).toContain("auth.uid()");
  });

  it("there is exactly one report per month, enforced and not merely intended", () => {
    /*
     * Versioning was in the first draft, for re-issuing a month after a late
     * payment. Under the event-period model there is no such workflow — a late
     * payment does not move the order, and a refund is a later month's event —
     * so the speculative column went and the invariant got stronger.
     */
    expect(SQL).toContain("unique (period_year, period_month, commerce_mode)");
    expect(SQL).not.toContain("version integer");
    // The comment explains its absence; what must not appear is the clause.
    expect(fn("seller_monthly_reports")).not.toMatch(/select\s+distinct on/);
    // The type carries no version field. The doc comment says so, which is
    // why the code is read rather than the prose.
    const model = readFileSync("src/lib/admin/report-archive.ts", "utf8");
    const type = model.slice(model.indexOf("export type MonthlyReport"));
    expect(type.slice(0, type.indexOf("};"))).not.toContain("version");
  });

  it("names which orders it counted, so the figure can be checked", () => {
    expect(SQL).toContain("included_orders text[] not null default '{}'");
    expect(SQL).toContain("cardinality(included_orders) = order_count");
    expect(fn("seller_finalize_monthly_report")).toContain(
      "array_agg(o.order_number order by o.order_number)",
    );
  });

  it("is made by an explicit act, never as a side effect of opening the page", () => {
    // Otherwise the report would bear the timestamp of a page view.
    expect(READS).not.toContain("seller_finalize_monthly_report");
    expect(ACTION).toContain('"use server"');
    expect(ACTION).toContain("seller_finalize_monthly_report");
    expect(PAGE).not.toContain("finalizeMonthlyReport(");
    expect(PAGE).toContain("ReportCreateButton");
  });

  it("and nothing generates one in the background", () => {
    expect(SQL).not.toContain("pg_cron");
    expect(SQL).not.toContain("create trigger");
  });
});

describe("no financial field this system does not have", () => {
  const forbidden = ["refund_amount", "fee", "net_amount", "payout", "profit", "tax_amount"];

  it("the table holds none of them", () => {
    const table = SQL.slice(
      SQL.indexOf("create table if not exists public.seller_monthly_reports"),
      SQL.indexOf("comment on table public.seller_monthly_reports"),
    );
    for (const column of forbidden) expect(table, column).not.toContain(`${column} `);
  });

  it("because Stripe's fee never reaches SkyIsles", () => {
    // 0012 stores the event id, its type and the outcome — deliberately not
    // the provider's payload. There is no balance transaction to read.
    const payments = readFileSync("supabase/migrations/0012_payment_core.sql", "utf8");
    expect(payments).not.toContain("fee numeric");
    expect(payments).not.toContain("balance_transaction");
    expect(SQL).toContain("NO FEES.");
  });

  it("and because a refund amount is recorded nowhere", () => {
    // The status exists; nothing ever writes it and no amount accompanies it.
    const core = readFileSync("supabase/migrations/0010_commerce_core.sql", "utf8");
    expect(core).toContain("'partially_refunded'");
    expect(core).not.toContain("refund_amount");
    expect(SQL).toContain("NO REFUNDS.");
  });

  it("and because § 19 UStG means no VAT is levied, not levied at zero", () => {
    const tax = readFileSync("supabase/migrations/0011_checkout_shipping_and_tax.sql", "utf8");
    expect(tax).toContain("small_business_19");
    expect(tax).toContain("the column holds a regime");
    // So the report snapshots the regime by NAME.
    expect(SQL).toContain("tax_regime text");
    expect(SQL).not.toContain("tax_rate");
  });

  it("calls the figure Bestellwert, because money may not have arrived", () => {
    /*
     * An order placed on 31 August and paid on 2 September is in August's
     * report. On the day that report is written, "Einnahme", "Umsatz" and
     * "bezahlt" would every one of them be a false claim about it.
     */
    expect(de.business.reports.orderValue).toBe("Bestellwert");
    for (const claim of ["Einnahme", "Eingang", "Bezahlt gesamt", "Umsatz"]) {
      expect(de.business.reports.orderValue, claim).not.toContain(claim);
    }
  });

  it("and the payment counts are labelled as a snapshot, not as the figure", () => {
    // They are informational. They must never read as redefining Bestellwert.
    expect(de.business.reports.paid).toBe("Davon bezahlt");
    expect(de.business.reports.snapshotHint).toContain("Zeitpunkt der Erstellung");
    expect(SQL).toContain("paid_count + unpaid_count = order_count");
    // The order value is summed over every reportable order, not over the paid
    // ones — which is what makes the two independent.
    const finalize = fn("seller_finalize_monthly_report");
    expect(finalize).toContain("coalesce(sum(o.total_amount), 0)");
    expect(finalize).not.toContain("sum(o.total_amount) filter");
  });

  it("the copy calls it none of those words either", () => {
    // The copy, not the comment above it: the comment's job is to explain why
    // these words are wrong, which it cannot do without naming them.
    /*
     * ANCHORED ON THE LINE, NOT THE SUBSTRING.
     *
     * `indexOf("    reports: {")` also matches the SIX-space `reports:` in the
     * navigation block 500 lines earlier, so this slice silently covered half
     * the business copy — and failed the day an unrelated block legitimately
     * used one of these words. The newline pins it to the top-level key this
     * test is actually about.
     */
    const block = COPY.slice(
      COPY.indexOf("\n    reports: {"),
      COPY.indexOf("      downloadLater:"),
    );
    const reports = block.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const word of [
      "Gewinn",
      "Ertrag",
      "Auszahlung",
      "Provision",
      "Nettoumsatz",
      "Einnahme",
    ]) {
      expect(reports, word).not.toContain(word);
    }
  });

  it("and says out loud what is missing instead of showing it as zero", () => {
    // Four columns of 0,00 € would read as "nothing was deducted".
    const missing = de.business.reports.limitsMissing;
    expect(missing).toContain("Gebühren");
    expect(missing).toContain("Rückerstattungen");
    expect(missing).toContain("§ 19 UStG");
    expect(missing).toContain("keine Buchhaltung");
    // And the refund sentence says WHICH month a refund would belong to, so
    // the absence does not read as "no refunds happened".
    expect(missing).toContain("in dem sie stattfinden");
    expect(PAGE).toContain("copy.limits");
    expect(PAGE).toContain("copy.limitsMissing");
  });

  it("the figures it does show are ones an order actually carries", () => {
    for (const column of [
      "order_count",
      "order_value",
      "merchandise_amount",
      "shipping_amount",
      "discount_amount",
    ]) {
      expect(SQL, column).toContain(column);
    }
    // And they add up the way every order does.
    expect(SQL).toContain(
      "check (order_value = merchandise_amount + shipping_amount - discount_amount)",
    );
  });

  it("shares one definition of an order with the year-to-date figure", () => {
    /*
     * Not "the same text in two places" — the same FUNCTION. A seller who adds
     * twelve reports up and compares them to the shop home is comparing two
     * figures that cannot disagree about what an order is, because neither one
     * decides (ADR-0083).
     */
    const finalize = fn("seller_finalize_monthly_report");
    const kpi = readFileSync("supabase/migrations/0044_seller_year_to_date.sql", "utf8");

    expect(finalize).toContain("public.order_counts_as_placed(o.payment_status)");
    expect(kpi).toContain("public.order_counts_as_placed(o.payment_status)");

    // And neither restates it. A copy is what drift is made of.
    expect(finalize).not.toContain("payment_status not in");
    expect(kpi).not.toContain("payment_status not in");
    expect(kpi).not.toContain("o.payment_status = 'paid'");

    // Both exclude sandbox by the same exact discriminator.
    expect(kpi).toContain("o.commerce_mode = 'live'");
    expect(finalize).toContain("o.commerce_mode = 'live'");
  });

  it("and both call the amount a Bestellwert, because neither requires payment", () => {
    expect(de.business.ytdOrderValue).toBe("Bestellwert dieses Jahr");
    expect(de.business.reports.orderValue).toBe("Bestellwert");
    for (const claim of ["Umsatz", "Einnahme", "Bezahlt"]) {
      expect(de.business.ytdOrderValue, claim).not.toContain(claim);
    }
  });
});

describe("no fake files and no dead download", () => {
  it("there is no download route", () => {
    // The word appears once, in the sentence explaining that there is no
    // download. What must not appear is an affordance.
    expect(PAGE).not.toContain("<a download");
    expect(PAGE).not.toContain("createSignedUrl");
    expect(PAGE).not.toContain(".pdf");
    expect(PAGE).not.toContain(".csv");
    expect(PAGE).not.toMatch(/href=\{?["`]\/api\//);
  });

  it("nothing is written to storage", () => {
    expect(SQL).not.toContain("storage.buckets");
    expect(READS).not.toContain("supabase.storage");
    expect(ACTION).not.toContain("supabase.storage");
  });

  it("and the page says so rather than offering a button that does nothing", () => {
    // ADR-0080 settled this for the product: a dead link is worse than a
    // missing one.
    expect(de.business.reports.downloadLater).toContain("noch nicht");
    expect(PAGE).toContain("copy.downloadLater");
  });

  it("the figures are on the page, so the archive is useful without a file", () => {
    expect(PAGE).toContain("formatPrice(Number(report.order_value))");
    expect(PAGE).toContain("formatNumber(report.order_count)");
  });
});

describe("the year filter", () => {
  it("defaults to the current year", () => {
    expect(PAGE).toContain("const year = years.includes(requested) ? requested : today.year;");
    expect(PAGE).toContain("berlinToday()");
  });

  it("never hard-codes one", () => {
    // Comments stripped: a doc comment naming a month to explain a rule is
    // not a hard-coded year, and matching prose would only teach the next
    // author to stop explaining things.
    const withoutComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const model = readFileSync("src/lib/admin/report-archive.ts", "utf8");
    expect(withoutComments(model)).not.toMatch(/\b20(2[6-9]|3\d)\b/);
    expect(withoutComments(PAGE)).not.toMatch(/\b20(2[6-9]|3\d)\b/);
    expect(fn("seller_report_years")).toContain("now() at time zone 'Europe/Berlin'");
  });

  it("offers the years the shop actually sold in, plus this one", () => {
    expect(reportYears([2024, 2025], 2026)).toEqual([2026, 2025, 2024]);
    expect(reportYears([], 2026)).toEqual([2026]);
    expect(reportYears([2026, 2025], 2026)).toEqual([2026, 2025]);
  });

  it("and offers this one even before its first order", () => {
    expect(fn("seller_report_years")).toContain("select v_current as y");
  });

  it("offers a year on the same terms the report counts it", () => {
    /*
     * If the selector asked for paid orders while the report counts placed
     * ones, a year whose orders were all still awaiting payment would be
     * missing from its own selector — and the report for it would be
     * unreachable. Same predicate, both places.
     */
    const years = fn("seller_report_years");
    const finalize = fn("seller_finalize_monthly_report");
    for (const term of [
      "o.commerce_mode = 'live'",
      "public.order_counts_as_placed(o.payment_status)",
    ]) {
      expect(years, term).toContain(term);
      expect(finalize, term).toContain(term);
    }
    expect(years).not.toContain("o.payment_status = 'paid'");
  });

  it("and reads the year off placed_at, like everything else here", () => {
    expect(fn("seller_report_years")).toContain(
      "extract(year from (o.placed_at at time zone 'Europe/Berlin'))",
    );
    expect(fn("seller_report_years")).not.toContain("paid_at");
  });

  it("shows one year at a time", () => {
    const months = reportMonthsForYear(2025, [august], TODAY);
    // August 2026's report must not appear under 2025.
    expect(months.every((m) => m.report === null)).toBe(true);
    expect(months.every((m) => m.year === 2025)).toBe(true);
  });
});

describe("who may read and issue them", () => {
  it("every report function asks the seller predicate", () => {
    for (const name of [
      "seller_monthly_reports",
      "seller_report_years",
      "seller_finalize_monthly_report",
    ]) {
      expect(fn(name), name).toContain("if not public.can_operate_active_seller() then");
    }
  });

  it("the table itself is closed to every client role", () => {
    // So a PostgREST request that skips the functions reads nothing.
    expect(SQL).toContain("alter table public.seller_monthly_reports enable row level security");
    expect(SQL).toContain(
      "revoke all on table public.seller_monthly_reports from public, anon, authenticated",
    );
    expect(SQL).not.toContain("create policy seller_monthly_reports");
  });

  it("the application asks the same question before it asks at all", () => {
    expect(READS).toContain("canOperateSeller()");
    expect(ACTION).toContain("canOperateSeller()");
  });

  it("a USER gets nothing", () => {
    // Not an empty page with a create button: the reads return [] and the
    // route group answers 404 first.
    expect(READS).toContain("if (!(await canOperateSeller())) return [];");
    const layout = readFileSync("src/app/(business)/layout.tsx", "utf8");
    expect(layout).toContain("if (!sellerOperator) notFound();");
  });

  it("an ADMIN gets nothing either", () => {
    expect(SQL).not.toContain("is_platform_admin");
    expect(ACTION).not.toContain("isAdmin");
    expect(READS).not.toContain("isAdmin");
  });

  it("is_shop_admin() is not restored anywhere in this migration", () => {
    expect(SQL).not.toContain("is_shop_admin");
  });

  it("and nothing is authorized by a name, an e-mail or a username", () => {
    for (const forbidden of ["display_name", "auth.email", "username", "seller_name"]) {
      expect(SQL, forbidden).not.toContain(forbidden);
    }
  });

  it("one seller's report cannot be read as another's, because there is one seller", () => {
    /*
     * ADR-0076 fixed that `seller_operators.seller_id` is the only `seller_id`
     * in the schema: orders, inventory and the catalog have none. A report
     * over those orders inherits the same answer, so the boundary here is the
     * capability and nothing else.
     *
     * The day a second seller exists, `orders` gets the column first and this
     * table follows it. Adding one now would be the marketplace data model
     * ADR-0021 stopped, built for a shop that does not exist.
     */
    const table = SQL.slice(
      SQL.indexOf("create table if not exists public.seller_monthly_reports"),
      SQL.indexOf("comment on table public.seller_monthly_reports"),
    );
    expect(table).not.toContain("seller_id");
    expect(SQL).toContain("NO `seller_id`");
  });
});

describe("where reports live in the product", () => {
  it("are the seventh area of the shop", () => {
    expect(HUB).toContain('{ href: "/business/reports", copy: de.business.areas.reports }');
    expect(de.business.areas.reports.title).toBe("Berichte");
  });

  it("are not in Mein Konto and not in Admin", () => {
    const account = readFileSync("src/lib/nav/sections.ts", "utf8");
    expect(account).not.toContain("/business/reports");
    const admin = readFileSync("src/app/(admin)/admin/page.tsx", "utf8");
    expect(admin).not.toContain("reports");
  });

  it("and are not the shop home's live figure wearing another name", () => {
    // The KPI moves as orders arrive; a report does not. Brief §21.
    expect(HUB).toContain("fetchShopYearToDate()");
    expect(HUB).not.toContain("fetchMonthlyReports");
    expect(PAGE).not.toContain("fetchShopYearToDate");
    expect(de.business.ytdOrders).not.toBe(de.business.reports.orders);
  });

  it("the three statuses are the three the code can produce", () => {
    expect(Object.keys(de.business.reports.status).sort()).toEqual([
      "available",
      "ready",
      "running",
    ]);
    // No "wird erstellt" as a stored state: nothing runs in the background,
    // so no month is ever between them.
    expect(COPY).not.toContain('status: { available: "Verfügbar", pending');
  });
});
