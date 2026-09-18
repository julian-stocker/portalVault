import type { Metadata } from "next";
import Link from "next/link";

import { OrderTabs } from "@/components/admin/order-tabs";
import { TestOrderButton } from "@/components/admin/test-order-controls";
import { fetchTestOrders, type TestOrderRow } from "@/lib/admin/order-queries";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.business.testOrders.heading };
export const dynamic = "force-dynamic";

/**
 * The shop's test orders (ADR-0084).
 *
 * Sandbox only, and that is enforced in `seller_test_orders()` rather than
 * here. Until 0046 these sat in the middle of `Bestellungen` wearing a badge,
 * so a morning of checkout testing buried the seller's actual work and
 * inflated that month's count.
 *
 * ARCHIVING IS NOT DELETING, and the page says so out loud. SkyIsles does not
 * delete orders — a test order is the record of how the checkout and the
 * payment webhook actually behaved. Archiving writes one timestamp and hides
 * the row from the default list; everything about the order stays, and
 * restoring is one click.
 *
 * Deliberately plainer than the live archive: no month groups, no year
 * selector, no fifteen-day window. A test order is not work and has no
 * history worth navigating — it needs to be identifiable and put away.
 */
export default async function TestOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const orders = await fetchTestOrders(showArchived);
  const copy = de.business.testOrders;

  // Only the ones the bulk action would actually change. An archived row is
  // already away, and offering to archive it again would be a button that
  // reports "0 archiviert".
  const archivable = orders.filter((o) => o.sandbox_archived_at === null).map((o) => o.order_number);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-6 md:pt-12">
      <h1 className="text-3xl font-semibold tracking-tight">{de.admin.orders.title}</h1>
      <OrderTabs current="test" />
      <p className="mt-3 text-sm text-muted">{copy.pageHint}</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={showArchived ? "/business/orders/test" : "/business/orders/test?archived=1"}
          className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          {showArchived ? copy.hideArchived : copy.showArchived}
        </Link>

        {archivable.length > 0 ? (
          /* Reversible, database-validated, and it names what it will do:
             only the rows currently on screen that are not already away. */
          <TestOrderButton orderNumbers={archivable} action="archive" variant="button" />
        ) : null}
      </div>

      {/* Said once, where the buttons are, so "archivieren" is never read as
          "löschen". */}
      <p className="mt-2 text-xs text-muted">{copy.archiveHint}</p>

      {orders.length === 0 ? (
        <p className="mt-8 text-muted">{showArchived ? copy.emptyArchived : copy.empty}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {orders.map((order) => (
            <TestOrderRowView key={order.order_number} order={order} />
          ))}
        </ul>
      )}
    </main>
  );
}

function TestOrderRowView({ order }: { order: TestOrderRow }) {
  const copy = de.admin.orders;
  const test = de.business.testOrders;
  const isArchived = order.sandbox_archived_at !== null;

  return (
    <li
      className={
        "rounded-sky-lg bg-surface/80 px-5 py-4 ring-1 ring-border/70 " +
        (isArchived ? "opacity-60" : "")
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <Link
            href={`/business/orders/${order.order_number}`}
            className="font-medium tabular-nums underline-offset-4 hover:underline"
          >
            {order.order_number}
          </Link>
          {/* The badge stays even here, where every row is a test order: it is
              what the order carries, and the same badge appears on the detail
              page this links to (ADR-0060). */}
          <span className="ml-2 rounded-sky-sm bg-status-ground px-1.5 py-0.5 align-middle text-[0.65rem] tracking-wide text-status-ink">
            {de.admin.commerce.sandboxBadge}
          </span>
          {isArchived ? (
            <span className="ml-2 text-xs text-muted">{test.archivedBadge}</span>
          ) : null}

          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted">
            <time dateTime={order.placed_at}>
              {new Date(order.placed_at).toLocaleDateString(de.locale)}
            </time>
            <span>·</span>
            <span className="tabular-nums">{formatPrice(Number(order.total_amount))}</span>
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
          </div>
        </div>

        <TestOrderButton
          orderNumbers={[order.order_number]}
          action={isArchived ? "restore" : "archive"}
        />
      </div>
    </li>
  );
}
