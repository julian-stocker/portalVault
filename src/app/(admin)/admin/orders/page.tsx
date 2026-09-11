import type { Metadata } from "next";
import Link from "next/link";

import { attentionOf, type AdminOrderRow } from "@/lib/admin/orders";
import { fetchAdminOrders } from "@/lib/admin/order-queries";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.admin.orders.title };
export const dynamic = "force-dynamic";

/**
 * The order list.
 *
 * Sorted by how much attention a row needs, and that ordering is the
 * database's (migration 0018), not this file's. The operator opens this page
 * to find work; the work is at the top.
 *
 * `?open=1` narrows it to the rows that are actually work. Everything stays
 * findable without it — a shipped order is not gone, just further down.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open } = await searchParams;
  const openOnly = open === "1";
  const orders = await fetchAdminOrders(openOnly);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-6 md:pt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{de.admin.orders.title}</h1>
        <div className="flex gap-3 text-sm">
          <Link
            href="/admin/orders?open=1"
            className={openOnly ? "font-semibold underline underline-offset-4" : "text-muted"}
          >
            {de.admin.orders.openOnly}
          </Link>
          <Link
            href="/admin/orders"
            className={openOnly ? "text-muted" : "font-semibold underline underline-offset-4"}
          >
            {de.admin.orders.all}
          </Link>
        </div>
      </div>

      {orders.length === 0 ? (
        <p className="mt-8 text-muted">{de.admin.orders.empty}</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {orders.map((order) => (
            <OrderRow key={order.order_number} order={order} />
          ))}
        </ul>
      )}
    </main>
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
        ? "ring-1 ring-accent/60"
        : "ring-1 ring-border/70";

  return (
    <li>
      <Link
        href={`/admin/orders/${order.order_number}`}
        className={`block rounded-sky-lg bg-surface/80 px-5 py-4 hover:ring-border-strong ${tone}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-medium tabular-nums">{order.order_number}</span>
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
                  ? "font-semibold text-accent"
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
