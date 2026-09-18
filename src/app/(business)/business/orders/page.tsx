import type { Metadata } from "next";
import Link from "next/link";

import {
  ACTIVE_WINDOW_DAYS,
  archivedOnly,
  monthCount,
  monthsForView,
  resolveArchiveView,
  showsActiveSection,
  yearsForSelector,
  type ArchiveView,
} from "@/lib/admin/order-archive";
import {
  fetchActiveOrders,
  fetchAdminOrders,
  fetchOrderCalendar,
  fetchOrdersForMonth,
} from "@/lib/admin/order-queries";
import { OrderTabs } from "@/components/admin/order-tabs";
import { attentionOf, type AdminOrderRow } from "@/lib/admin/orders";
import { berlinToday, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.admin.orders.title };
export const dynamic = "force-dynamic";

/**
 * The order list — current work first, the past filed by month (ADR-0082).
 *
 * THREE VIEWS, ONE PAGE
 *
 * `?open=1`     unchanged since 0024: everything not finished, sorted by
 *               attention. The shop home links here and still does.
 * default       what this round adds — the active section, then month
 *               headings for the rest of the year.
 * `?year&month` one month, complete.
 *
 * WHAT THE ARCHIVE MAY NOT DO
 *
 * Hide work. A flagged order is paid, has booked no stock, cannot ship, and
 * ages *because* nobody has dealt with it — so age alone must never file it
 * away. The active section is `recent OR still open`, and "still open" is the
 * same `attention <= 2` the "Nur offene" filter above it means (ADR-0063).
 *
 * AND WHAT IT MAY NOT COST
 *
 * The month headings come from `seller_order_calendar()` — one row per month,
 * counts only. Opening a month is a navigation that fetches that month. No
 * view on this page loads a lifetime of orders, and none loads rows it does
 * not draw.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string; year?: string; month?: string }>;
}) {
  const { open, year, month } = await searchParams;

  // The open filter is its own view and predates the archive. It keeps its
  // behaviour exactly: one question, one list, no sections.
  if (open === "1") return <OpenOnlyView />;

  const today = berlinToday();
  const view = resolveArchiveView({ year, month }, today.year);

  const [calendar, active, monthOrders] = await Promise.all([
    fetchOrderCalendar(),
    showsActiveSection(view) ? fetchActiveOrders() : Promise.resolve([]),
    view.kind === "month"
      ? fetchOrdersForMonth(view.year, view.month, archivedOnly(view))
      : Promise.resolve([]),
  ]);

  const copy = de.business.archive;
  const months = monthsForView(calendar, view);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-6 md:pt-12">
      <Header view={view} years={yearsForSelector(calendar, today.year)} />

      {showsActiveSection(view) ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight">{copy.current}</h2>
          <p className="mt-1 text-sm text-muted">{copy.currentHint(ACTIVE_WINDOW_DAYS)}</p>
          {active.length === 0 ? (
            <p className="mt-4 text-muted">{copy.emptyCurrent}</p>
          ) : (
            <OrderList orders={active} />
          )}
        </section>
      ) : null}

      {view.kind === "month" ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">
            {de.business.monthLabel(view.year, view.month)}
          </h2>
          {monthOrders.length === 0 ? (
            <p className="mt-4 text-muted">{copy.empty}</p>
          ) : (
            <OrderList orders={monthOrders} />
          )}
          <p className="mt-6 text-sm">
            <Link href="/business/orders" className="underline underline-offset-4">
              {copy.backToCurrent}
            </Link>
          </p>
        </section>
      ) : (
        <section className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">{copy.older}</h2>
          <p className="mt-1 text-sm text-muted">{copy.olderHint}</p>
          {months.length === 0 ? (
            <p className="mt-4 text-muted">{copy.empty}</p>
          ) : (
            /*
             * Headings, not rows. A month opens as its own page rather than
             * expanding in place: nothing historical is fetched until the
             * seller actually asks for a month, and a shop with ten years of
             * trade renders the same as one with ten weeks.
             */
            <ul className="mt-4 flex flex-col gap-2">
              {months.map((entry) => (
                <li key={`${entry.period_year}-${entry.period_month}`}>
                  <Link
                    href={`/business/orders?year=${entry.period_year}&month=${entry.period_month}`}
                    className="flex items-baseline justify-between gap-4 rounded-sky-lg bg-surface/80 px-5 py-3 ring-1 ring-border/70 hover:ring-border-strong"
                  >
                    <span className="font-medium">
                      {de.business.monthLabel(entry.period_year, entry.period_month)}
                    </span>
                    <span className="text-sm text-muted tabular-nums">
                      {copy.orderCount(monthCount(entry, view))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

/**
 * Title, the two long-standing filter links, and the year/month selector.
 *
 * A plain `<form method="get">`: the whole page is server-rendered and the
 * selection is in the URL, so it survives a reload, a bookmark and the back
 * button. Making it a client component to save one click would trade all three
 * for the click.
 */
function Header({ view, years }: { view: ArchiveView; years: readonly number[] }) {
  const copy = de.business.archive;
  const selectClass =
    "rounded-sky-sm bg-surface px-2 py-1 text-sm ring-1 ring-border/70";

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{de.admin.orders.title}</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/business/orders?open=1" className="text-muted">
            {de.admin.orders.openOnly}
          </Link>
          <Link
            href="/business/orders"
            className="font-semibold underline underline-offset-4"
          >
            {de.admin.orders.all}
          </Link>
        </div>
      </div>

      <OrderTabs current="live" />

      {/* Whose orders these are. "Meine Bestellungen" under Mein Konto means
          the opposite — what this account bought (ADR-0080). */}
      <p className="mt-3 text-sm text-muted">{de.business.ordersPageHint}</p>

      <form method="get" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted">{copy.year}</span>
          <select name="year" defaultValue={String(view.year)} className={selectClass}>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted">{copy.month}</span>
          <select
            name="month"
            defaultValue={view.kind === "month" ? String(view.month) : "all"}
            className={selectClass}
          >
            <option value="all">{copy.allMonths}</option>
            {de.business.monthNames.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-sky-sm bg-surface px-3 py-1 ring-1 ring-border/70 hover:ring-border-strong"
        >
          {copy.apply}
        </button>
      </form>
    </>
  );
}

/** The "Nur offene" view, exactly as it was before the archive existed. */
async function OpenOnlyView() {
  const orders = await fetchAdminOrders(true);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-6 md:pt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{de.admin.orders.title}</h1>
        <div className="flex gap-3 text-sm">
          <Link
            href="/business/orders?open=1"
            className="font-semibold underline underline-offset-4"
          >
            {de.admin.orders.openOnly}
          </Link>
          <Link href="/business/orders" className="text-muted">
            {de.admin.orders.all}
          </Link>
        </div>
      </div>

      <OrderTabs current="live" />

      <p className="mt-3 text-sm text-muted">{de.business.ordersPageHint}</p>
      {/* What "open" means, written where the filter is. The word used to mean
          one thing here and another on the rows below (ADR-0063). */}
      <p className="mt-1 text-sm text-muted">{de.admin.orders.openOnlyHint}</p>

      {orders.length === 0 ? (
        <p className="mt-8 text-muted">{de.admin.orders.empty}</p>
      ) : (
        <OrderList orders={orders} />
      )}
    </main>
  );
}

function OrderList({ orders }: { orders: readonly AdminOrderRow[] }) {
  return (
    <ul className="mt-4 flex flex-col gap-2">
      {orders.map((order) => (
        <OrderRow key={order.order_number} order={order} />
      ))}
    </ul>
  );
}

function OrderRow({ order }: { order: AdminOrderRow }) {
  const attention = attentionOf(order.attention);
  const copy = de.admin.orders;

  // Only the top bucket is loud. Making three levels shout would mean none of
  // them does.
  //
  // `--danger` and `--accent`, not raw `red-*`/`amber-*` (F9): the product has
  // exactly one colour for "this is wrong" and one warm accent, and both
  // already exist as tokens.
  const tone =
    attention === "needs_resolution"
      ? "ring-2 ring-danger/70"
      : attention === "to_ship"
        ? "ring-1 ring-danger/60"
        : "ring-1 ring-border/70";

  return (
    <li>
      <Link
        href={`/business/orders/${order.order_number}`}
        className={`block rounded-sky-lg bg-surface/80 px-5 py-4 hover:ring-border-strong ${tone}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-medium tabular-nums">
            {order.order_number}
            {/* A test order has to be recognisable without opening it, and
                stays recognisable after the shop goes live (ADR-0060). */}
            {order.commerce_mode === "sandbox" ? (
              <span className="ml-2 rounded-sky-sm bg-status-ground px-1.5 py-0.5 align-middle text-[0.65rem] tracking-wide text-status-ink">
                {de.admin.commerce.sandboxBadge}
              </span>
            ) : null}
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {formatPrice(Number(order.total_amount))}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted">
          <span
            className={
              attention === "needs_resolution"
                ? "font-semibold text-danger"
                : attention === "to_ship"
                  ? "font-semibold text-danger"
                  : undefined
            }
          >
            {copy.attention[attention]}
          </span>
          <span>·</span>
          <span>
            {copy.paymentStatus[order.payment_status as keyof typeof copy.paymentStatus] ??
              order.payment_status}
          </span>
          <span>·</span>
          <span>
            {copy.fulfillmentStatus[
              order.fulfillment_status as keyof typeof copy.fulfillmentStatus
            ] ?? order.fulfillment_status}
          </span>
          <span>·</span>
          <span>{copy.lines(order.line_count)}</span>
          <span>·</span>
          <time dateTime={order.placed_at}>
            {new Date(order.placed_at).toLocaleDateString(de.locale)}
          </time>
        </div>
      </Link>
    </li>
  );
}
