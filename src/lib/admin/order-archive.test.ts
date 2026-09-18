import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  ACTIVE_WINDOW_DAYS,
  archivedOnly,
  monthCount,
  monthsForView,
  resolveArchiveView,
  showsActiveSection,
  yearsForSelector,
  type OrderMonth,
} from "@/lib/admin/order-archive";
import { de } from "@/lib/i18n/de";
import { latestFunction } from "@/test-support/migrations";

/**
 * The order archive (ADR-0082).
 *
 * The danger in this feature is not that it renders wrongly. It is that a rule
 * meant to tidy a list quietly hides work — so most of what follows is about
 * what must NOT disappear.
 */

const SQL = readFileSync("supabase/migrations/0045_seller_order_archive.sql", "utf8");
const PAGE = readFileSync("src/app/(business)/business/orders/page.tsx", "utf8");
const QUERIES = readFileSync("src/lib/admin/order-queries.ts", "utf8");
const LAYOUT = readFileSync("src/app/(business)/layout.tsx", "utf8");

/**
 * The function as the database actually runs it — the LAST definition in the
 * history, not the one this round happened to write.
 *
 * `0046` redefines four of these to be live-only. A test reading `0045`
 * directly would be asserting against a version Postgres no longer has, and
 * would go on passing while the real behaviour moved.
 */
function fn(name: string): string {
  return latestFunction(name).body;
}

describe("age never hides work", () => {
  it("keeps the active section an OR, not a date", () => {
    const active = fn("seller_orders_active");
    // Two predicates joined by `or`: recent, or still open. Either alone is
    // the bug — a date alone buries the flagged order, and `open` alone is
    // just the filter that already existed.
    expect(active).toContain("r.berlin_date >= ((now() at time zone 'Europe/Berlin')::date - v_days)");
    expect(active).toContain("or r.attention <= 2");
  });

  it("a flagged order stays in the active section at any age", () => {
    // `needs_resolution` is bucket 0, and 0 <= 2. There is no age term on
    // that side of the OR, which is the entire guarantee.
    const active = fn("seller_orders_active");
    const openBranch = active.slice(active.indexOf("or r.attention <= 2"));
    expect(openBranch).not.toContain("berlin_date");
    expect(fn("order_attention")).toContain("when p_needs_resolution then 0");
  });

  it("a paid, unshipped order stays too", () => {
    expect(fn("order_attention")).toContain("when p_payment_status = 'paid'");
    expect(fn("order_attention")).toContain("and p_fulfillment_status = 'unfulfilled' then 1");
  });

  it("an unpaid checkout stays, which is why the boundary is 2 and not 1", () => {
    // ADR-0063: a payment that hung because a webhook never arrived looks
    // exactly like this, and it was once visible nowhere at all.
    expect(fn("order_attention")).toContain("when p_payment_status = 'pending' then 2");
    expect(fn("seller_orders_active")).not.toContain("attention <= 1");
  });

  it("and only a settled order can ever be archived", () => {
    // Every archive predicate in the file requires `attention > 2`.
    const archivePredicates = SQL.match(/and \w+\.attention > 2/g) ?? [];
    expect(archivePredicates.length).toBeGreaterThanOrEqual(2);
    expect(SQL).not.toMatch(/attention > 1\b/);
  });

  it("the month sections exclude exactly what the active section holds", () => {
    // Both use the same two terms. If they drifted, an order would be in
    // both lists or in neither.
    for (const name of ["seller_order_calendar", "seller_orders_month"]) {
      const body = fn(name);
      expect(body, name).toContain("((now() at time zone 'Europe/Berlin')::date - v_days)");
      expect(body, name).toContain("attention > 2");
    }
  });
});

describe("the 15-day boundary", () => {
  it("is fifteen days, in one place", () => {
    expect(ACTIVE_WINDOW_DAYS).toBe(15);
    expect(fn("seller_orders_active")).toContain("p_days   integer default 15");
    expect(QUERIES).toContain("days: number = ACTIVE_WINDOW_DAYS");
  });

  it("is a rolling window and not a calendar month", () => {
    // On the 1st, "this month" would empty the operator's list of everything
    // they were working on the day before.
    const active = fn("seller_orders_active");
    expect(active).not.toContain("date_trunc('month'");
  });

  it("is measured in Berlin calendar dates, not in hours", () => {
    const active = fn("seller_orders_active");
    expect(active).toContain("(o.placed_at at time zone 'Europe/Berlin')::date");
    // Not `now() - interval '15 days'`, which would put the boundary at
    // whatever time of day the page happened to be opened.
    expect(active).not.toContain("interval '15 days'");
  });

  it("is clamped, so a crafted parameter cannot widen it without limit", () => {
    expect(fn("seller_orders_active")).toContain(
      "greatest(0, least(coalesce(p_days, 15), 366))",
    );
  });
});

describe("the default view", () => {
  const view = resolveArchiveView({}, 2026);

  it("is the current year", () => {
    expect(view).toEqual({ kind: "default", year: 2026 });
  });

  it("is all months", () => {
    expect(view.kind).toBe("default");
    expect("month" in view).toBe(false);
  });

  it("never hard-codes a year", () => {
    const source = readFileSync("src/lib/admin/order-archive.ts", "utf8");
    expect(source).not.toMatch(/\b20(2[6-9]|3\d)\b/);
    expect(resolveArchiveView({}, 2031)).toEqual({ kind: "default", year: 2031 });
  });

  it("shows the active section", () => {
    expect(showsActiveSection(view)).toBe(true);
  });

  it("and its month sections repeat nothing from it", () => {
    expect(archivedOnly(view)).toBe(true);
  });
});

describe("the year filter", () => {
  it("selects a past year and drops the active section", () => {
    const view = resolveArchiveView({ year: "2025" }, 2026);
    expect(view).toEqual({ kind: "year", year: 2025 });
    // Brief §15: the filter is the primary view. Injecting this month's
    // orders into a page headed 2025 would make the page a lie.
    expect(showsActiveSection(view)).toBe(false);
  });

  it("shows a past year whole, not only its archived part", () => {
    expect(archivedOnly(resolveArchiveView({ year: "2025" }, 2026))).toBe(false);
  });

  it("choosing the current year IS the default view", () => {
    expect(resolveArchiveView({ year: "2026" }, 2026)).toEqual({ kind: "default", year: 2026 });
  });

  it("falls back rather than failing on nonsense", () => {
    for (const year of ["", "abc", "0", "1999", "99999", "2026.5"]) {
      expect(resolveArchiveView({ year }, 2026).year, year).toBe(2026);
    }
  });

  it("offers every year with orders, plus this one, newest first", () => {
    const calendar: OrderMonth[] = [
      { period_year: 2025, period_month: 3, order_count: 4, archived_count: 4 },
      { period_year: 2024, period_month: 11, order_count: 2, archived_count: 2 },
      { period_year: 2025, period_month: 1, order_count: 1, archived_count: 1 },
    ];
    expect(yearsForSelector(calendar, 2026)).toEqual([2026, 2025, 2024]);
  });

  it("offers the current year even before its first order", () => {
    // Otherwise the selector's own default is missing from its options every
    // January.
    expect(yearsForSelector([], 2026)).toEqual([2026]);
  });
});

describe("the month filter", () => {
  it("selects one month", () => {
    expect(resolveArchiveView({ year: "2026", month: "8" }, 2026)).toEqual({
      kind: "month",
      year: 2026,
      month: 8,
    });
  });

  it("defaults to all months", () => {
    for (const month of [undefined, "", "all"]) {
      expect(resolveArchiveView({ year: "2026", month }, 2026).kind, String(month)).toBe(
        "default",
      );
    }
  });

  it("wins over the collapsed default: a chosen month is shown, not collapsed", () => {
    const view = resolveArchiveView({ year: "2026", month: "8" }, 2026);
    // No month headings at all — the month itself is the list.
    expect(monthsForView([], view)).toEqual([]);
    expect(PAGE).toContain('view.kind === "month"');
    expect(PAGE).toContain("fetchOrdersForMonth(view.year, view.month, archivedOnly(view))");
  });

  it("shows the whole month it names, recent orders included", () => {
    // Brief §15 again, from the other side: a filter that withheld the recent
    // rows would be a filter that lies about the month on its heading.
    expect(archivedOnly(resolveArchiveView({ year: "2026", month: "9" }, 2026))).toBe(false);
    expect(fn("seller_orders_month")).toContain("where not p_archived_only");
  });

  it("and does not inject the active section beside it", () => {
    expect(showsActiveSection(resolveArchiveView({ year: "2026", month: "8" }, 2026))).toBe(false);
  });

  it("refuses a month that is not one", () => {
    for (const month of ["0", "13", "-1", "acht"]) {
      expect(resolveArchiveView({ year: "2026", month }, 2026).kind, month).toBe("default");
    }
    // And the database refuses it again, which is where it matters.
    expect(fn("seller_orders_month")).toContain("p_month < 1 or p_month > 12");
  });
});

describe("month counts", () => {
  const calendar: OrderMonth[] = [
    { period_year: 2026, period_month: 9, order_count: 18, archived_count: 3 },
    { period_year: 2026, period_month: 8, order_count: 42, archived_count: 42 },
    { period_year: 2026, period_month: 7, order_count: 31, archived_count: 31 },
    { period_year: 2025, period_month: 12, order_count: 9, archived_count: 9 },
  ];

  it("count what the section will actually show", () => {
    const view = resolveArchiveView({}, 2026);
    const months = monthsForView(calendar, view);
    // September has 18 orders; 15 of them are still up in "Aktuell", so the
    // heading promises 3. A heading that said 18 and opened onto 3 would be
    // the archive contradicting itself.
    expect(months.map((m) => monthCount(m, view))).toEqual([3, 42, 31]);
  });

  it("count the whole month once a month is asked for by name", () => {
    const view = resolveArchiveView({ year: "2025" }, 2026);
    const months = monthsForView(calendar, view);
    expect(months.map((m) => monthCount(m, view))).toEqual([9]);
  });

  it("leave out a month whose orders are all still current", () => {
    const view = resolveArchiveView({}, 2026);
    const all: OrderMonth[] = [
      { period_year: 2026, period_month: 9, order_count: 5, archived_count: 0 },
    ];
    // Not a section that opens onto nothing.
    expect(monthsForView(all, view)).toEqual([]);
  });

  it("only show the selected year", () => {
    const view = resolveArchiveView({}, 2026);
    expect(monthsForView(calendar, view).every((m) => m.period_year === 2026)).toBe(true);
  });

  it("are computed in the database, not by counting fetched rows", () => {
    expect(QUERIES).toContain('rpc("seller_order_calendar"');
    expect(fn("seller_order_calendar")).toContain("count(*)::integer");
    expect(fn("seller_order_calendar")).toContain("group by 1, 2");
  });
});

describe("nothing loads a lifetime of orders", () => {
  it("the month headings come without their rows", () => {
    // At most twelve rows a year. This is the difference between an archive
    // and a scaling trap.
    const calendar = fn("seller_order_calendar");
    expect(calendar).toContain("returns table (");
    expect(calendar).not.toContain("order_number");
  });

  it("the page opens a month by navigating, not by expanding in place", () => {
    // A `<details>` holding every historical row would still have fetched
    // every historical row.
    expect(PAGE).toContain("/business/orders?year=${entry.period_year}&month=${entry.period_month}");
    expect(PAGE).not.toContain("<details");
  });

  it("every row query is bounded", () => {
    for (const name of ["seller_orders_active", "seller_orders_month", "admin_orders"]) {
      expect(fn(name), name).toContain("limit greatest(1, least(coalesce(p_limit");
      expect(fn(name), name).toContain("offset greatest(0, coalesce(p_offset, 0))");
    }
  });

  it("the default view asks for three things and none of them is history", () => {
    expect(PAGE).toContain("fetchOrderCalendar()");
    expect(PAGE).toContain("fetchActiveOrders()");
    // Month rows only when a month is actually chosen.
    expect(PAGE).toContain('view.kind === "month"\n      ? fetchOrdersForMonth');
  });
});

describe("the attention rule has one definition", () => {
  it("lives in its own function", () => {
    expect(fn("order_attention")).toContain("returns integer");
    expect(SQL).toContain("public.order_attention(o.needs_resolution, o.payment_status");
  });

  it("and the list adopted it instead of keeping a copy", () => {
    // 0018 wrote the warning itself: two copies are two things that must
    // agree and eventually will not. This migration would have made four.
    const list = fn("admin_orders");
    expect(list).toContain("public.order_attention(");
    expect(list).not.toContain("when o.needs_resolution then 0");
  });

  it("without changing what admin_orders() returns or how it sorts", () => {
    const list = fn("admin_orders");
    // A changed return type would need a DROP first — 0040 learned that the
    // hard way. Nothing here changes, which is why `create or replace` is safe.
    for (const unchanged of [
      "p_open_only boolean default false",
      "order_number       text",
      "commerce_mode      text",
      "where not p_open_only or r.attention <= 2",
      "order by r.attention, r.placed_at desc",
    ]) {
      expect(list, unchanged).toContain(unchanged);
    }
  });

  it("and the four buckets still mean what they meant", () => {
    const attention = fn("order_attention");
    expect(attention).toContain("then 0");
    expect(attention).toContain("then 1");
    expect(attention).toContain("then 2");
    expect(attention).toContain("else 3");
  });
});

describe("months are Berlin's", () => {
  it("a month begins at a Berlin midnight, not at a UTC one", () => {
    const month = fn("seller_orders_month");
    expect(month).toContain("at time zone 'Europe/Berlin')");
    expect(month).toContain("make_timestamp(p_year, p_month, 1, 0, 0, 0)");
  });

  it("and ends where the next one begins", () => {
    // Half-open. An order at 23:59:59.7 on the last day belongs to the month,
    // and `<=` with a guessed last instant would drop it.
    const month = fn("seller_orders_month");
    expect(month).toContain("+ interval '1 month'");
    expect(month).toContain("and o.placed_at <  v_end");
  });

  it("the year the page opens on is read in Berlin too", () => {
    const format = readFileSync("src/lib/format.ts", "utf8");
    expect(format).toContain("export function berlinToday");
    expect(format).toContain('timeZone: TIME_ZONE');
    expect(PAGE).toContain("berlinToday()");
    // `new Date().getFullYear()` is the runtime's year, and the runtime is UTC.
    expect(PAGE).not.toContain("getFullYear()");
  });

  it("and the month names are names, not a formatted date", () => {
    expect(de.business.monthNames).toHaveLength(12);
    expect(de.business.monthNames[0]).toBe("Januar");
    expect(de.business.monthLabel(2026, 8)).toContain("August");
    expect(de.business.monthLabel(2026, 8)).toContain("2026");
  });
});

describe("who may read the archive", () => {
  it("every new function asks the seller predicate", () => {
    for (const name of [
      "seller_orders_active",
      "seller_orders_month",
      "seller_order_calendar",
    ]) {
      expect(fn(name), name).toContain("if not public.can_operate_active_seller() then");
      expect(fn(name), name).toContain("insufficient_privilege");
    }
  });

  it("a USER is refused — by the database, not only by the route", () => {
    // A collector holds no seller row, so the predicate is false and the
    // function raises. The 404 in the layout is presentation.
    expect(LAYOUT).toContain("if (!sellerOperator) notFound();");
    expect(SQL).not.toContain("is_collector");
  });

  it("an ADMIN is refused too: running SkyIsles is not running the shop", () => {
    expect(SQL).not.toContain("is_platform_admin");
    expect(SQL).not.toContain("or public.is_shop_admin()");
    expect(LAYOUT).toContain("**NOT `isAdmin()`.**");
  });

  it("and nothing authorizes by a name, an e-mail or a username", () => {
    for (const forbidden of ["display_name", "customer_email =", "auth.email", "username"]) {
      const guards = SQL.slice(0, SQL.indexOf("-- 7. The monthly report"));
      expect(guards, forbidden).not.toContain(forbidden);
    }
  });

  it("nothing is granted to anon", () => {
    // Per statement, not across the file: a lazy match would happily span
    // from one grant to an `anon` in a later revoke and always "pass".
    const grants = [...SQL.matchAll(/grant execute on function public\.\w+\([^)]*\)\s*to ([^;]+);/g)];
    expect(grants.length).toBeGreaterThan(3);
    for (const grant of grants) expect(grant[1], grant[0]).not.toContain("anon");
    for (const name of ["seller_orders_active", "seller_order_calendar", "seller_orders_month"]) {
      expect(SQL, name).toContain(`revoke all on function public.${name}(`);
    }
  });
});

describe("what this round did not disturb", () => {
  it("0043 is untouched", () => {
    const recovery = readFileSync(
      "supabase/migrations/0043_order_review_recovery.sql",
      "utf8",
    );
    expect(recovery).toContain("create or replace function public.seller_resolve_stock_shortfall");
    expect(SQL).not.toContain("seller_resolve_stock_shortfall");
    expect(SQL).not.toContain("seller_order_review");
  });

  it("the recovery action is still on the order detail page", () => {
    const detail = readFileSync(
      "src/app/(business)/business/orders/[orderNumber]/page.tsx",
      "utf8",
    );
    expect(detail).toContain("OrderReviewPanel");
  });

  it("the flagged count covers every order, not just the archive's window", () => {
    // The badge must not start counting only the last fifteen days — the
    // aggregate has no date term at all.
    const counter = fn("seller_open_order_counts");
    expect(counter).not.toContain("berlin_date");
    expect(counter).not.toContain("placed_at");
    expect(counter).toContain("from public.orders o");
    expect(LAYOUT).toContain("fetchOpenOrderCounts()");
  });

  it("the open filter still exists and still means the same thing", () => {
    expect(PAGE).toContain('open === "1"');
    expect(de.admin.orders.openOnly).toBe("Nur offene");
    expect(de.admin.orders.openOnlyHint).toContain("nicht abgeschlossen");
  });

  it("customer purchase history was not touched", () => {
    // `/account/orders` is what this account BOUGHT. Two different lists that
    // happen to share a noun (ADR-0080).
    const account = readFileSync("src/app/(app)/account/orders/page.tsx", "utf8");
    expect(account).not.toContain("order-archive");
    expect(account).not.toContain("seller_orders_active");
  });

  it("no seller_id, no marketplace, no new role", () => {
    expect(SQL).not.toMatch(/orders\s+add column[\s\S]*seller_id/);
    expect(SQL).not.toContain("create role");
    expect(SQL).not.toContain("shop_admins");
  });
});
