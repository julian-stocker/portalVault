import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderLinesTable } from "@/components/admin/order-lines-table";
import { OrderReviewPanel } from "@/components/admin/order-review-panel";
import { OrderMailPanel } from "@/components/admin/order-mail-panel";
import { SandboxOrderPanel } from "@/components/admin/sandbox-order-panel";
import { ShipOrderForm } from "@/components/admin/ship-order-form";
import { TrackingForm } from "@/components/admin/tracking-form";
import { TrackingLink } from "@/components/commerce/tracking-link";
import { fetchAdminOrder } from "@/lib/admin/order-queries";
import { fetchOrderReview } from "@/lib/admin/order-review";
import { shipBlocker } from "@/lib/admin/orders";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}): Promise<Metadata> {
  const { orderNumber } = await params;
  return { title: de.admin.orders.detailTitle(orderNumber) };
}

/**
 * One order, everything the operator needs to send it.
 *
 * Read through `admin_order()`, which asks `is_shop_admin()` itself. The
 * projection deliberately carries no abuse fingerprint, no capability hash and
 * no internal id — none of them help anybody pack a parcel.
 *
 * The lines are immutable snapshots taken when the order was placed. They show
 * what was bought at the price that was charged, whatever the catalog says
 * today.
 */
export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;
  const detail = await fetchAdminOrder(orderNumber);
  if (!detail) notFound();

  const { order, address, lines, events, mail } = detail;
  const copy = de.admin.orders;
  const blocker = shipBlocker(order);
  // Only asked when there is something to explain; the reader returns
  // "not flagged" without a round trip for everybody else.
  const review = order.needs_resolution
    ? await fetchOrderReview(order.order_number)
    : ({ flagged: false } as const);


  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <Link href="/business/orders" className="text-sm text-muted underline underline-offset-4">
        ← {copy.title}
      </Link>

      <h1 className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
        {order.order_number}
      </h1>

      {/* Before anything about the order itself: an operator must not read a
          test order as a real one, today or in three years. */}
      {order.commerce_mode === "sandbox" ? (
        <SandboxOrderPanel
          orderNumber={order.order_number}
          stockReverted={order.stock_reverted}
        />
      ) : null}

      {/* Loud, and above everything else: this is the state in which shipping
          would hand over goods the ledger still counts as present.

          Since 0043 it also says WHY and, where the cause allows it, offers
          the repair (ADR-0079). A blocked order with no way forward was a
          seller with no workflow. */}
      <OrderReviewPanel orderNumber={order.order_number} review={review} />

      <dl className="mt-6 grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
        <dt className="text-muted">{copy.placedAt}</dt>
        <dd>{new Date(order.placed_at).toLocaleString(de.locale)}</dd>

        <dt className="text-muted">{copy.payment}</dt>
        <dd>
          {copy.paymentStatus[order.payment_status as keyof typeof copy.paymentStatus] ??
            order.payment_status}
          {order.paid_at ? ` · ${new Date(order.paid_at).toLocaleString(de.locale)}` : ""}
        </dd>

        <dt className="text-muted">{copy.fulfillment}</dt>
        <dd>
          {copy.fulfillmentStatus[
            order.fulfillment_status as keyof typeof copy.fulfillmentStatus
          ] ?? order.fulfillment_status}
          {order.shipped_at ? ` · ${new Date(order.shipped_at).toLocaleString(de.locale)}` : ""}
        </dd>

        <dt className="text-muted">{copy.customer}</dt>
        <dd>
          {order.customer_email}
          <span className="ml-2 text-muted">{order.is_guest ? copy.guest : copy.account}</span>
        </dd>

        <dt className="text-muted">{copy.shipping}</dt>
        <dd>
          {order.shipping_method ?? "—"} · {formatPrice(Number(order.shipping_amount))}
        </dd>

        {order.tracking_number ? (
          <>
            <dt className="text-muted">{copy.trackingNumber}</dt>
            <dd>
              <TrackingLink
                shippingMethodCode={order.shipping_method_code}
                trackingNumber={order.tracking_number}
              />
            </dd>
          </>
        ) : null}
      </dl>

      {/* ------------------------------------------------------------ address */}
      <h2 className="mt-8 text-lg font-semibold">{copy.addressHeading}</h2>
      {address ? (
        <address className="mt-2 not-italic text-sm leading-relaxed">
          {address.first_name} {address.last_name}
          <br />
          {address.company ? (
            <>
              {address.company}
              <br />
            </>
          ) : null}
          {address.street} {address.house_number}
          <br />
          {address.address_line_2 ? (
            <>
              {address.address_line_2}
              <br />
            </>
          ) : null}
          {address.postal_code} {address.city}
          <br />
          {address.country_code}
          {address.phone ? (
            <>
              <br />
              {address.phone}
            </>
          ) : null}
        </address>
      ) : (
        <p className="mt-2 text-sm text-muted">—</p>
      )}

      {/* -------------------------------------------------------------- lines */}
      {/* A structured table rather than prose rows: this is the part of the
          page somebody works from while picking figures off a shelf. Every
          field is a snapshot from the order (ADR-0074). */}
      <h2 className="mt-8 text-lg font-semibold">{copy.linesHeading}</h2>
      <OrderLinesTable lines={lines} />

      <dl className="mt-4 flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">{copy.subtotal}</dt>
          <dd className="tabular-nums">{formatPrice(Number(order.items_subtotal))}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{copy.shipping}</dt>
          <dd className="tabular-nums">{formatPrice(Number(order.shipping_amount))}</dd>
        </div>
        <div className="flex justify-between border-t border-border/70 pt-1">
          <dt className="font-medium">{copy.total}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatPrice(Number(order.total_amount))}
          </dd>
        </div>
      </dl>

      {/* ----------------------------------------------------------- shipping */}
      {/*
       * SENDUNGSNUMMER FIRST, THEN VERSANDSTATUS (ADR-0074).
       *
       * The order on the page follows the order of the work: the operator buys
       * a label, records its number, and then says the parcel has gone. The
       * reverse arrangement asked for the last step first.
       */}
      {/* Its own control, before and after the parcel goes (ADR-0062): a label
          is often bought first and occasionally cancelled and replaced. It
          changes no fulfilment state and sends no second confirmation. */}
      <TrackingForm
        orderNumber={order.order_number}
        shippingMethodCode={order.shipping_method_code}
        trackingNumber={order.tracking_number}
        shipped={order.fulfillment_status === "shipped"}
      />


      <h2 className="mt-8 text-lg font-semibold">{copy.statusHeading}</h2>
      <div className="mt-2 rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70">
        {blocker === null ? (
          <div className="flex flex-col gap-3">
            <ShipOrderForm
              orderNumber={order.order_number}
              shipped={order.fulfillment_status === "shipped"}
              hasTracking={order.tracking_number !== null}
            />
            {/*
             * When it went out, read back from the order rather than shown as
             * a toast: whoever opens this page tomorrow sees what the person
             * who shipped it saw. Cleared by `admin_unmark_order_shipped()`,
             * so it disappears with the status instead of outliving it.
             */}
            {order.fulfillment_status === "shipped" && order.shipped_at ? (
              <p className="text-sm text-muted tabular-nums">
                {copy.shippedAt}: {new Date(order.shipped_at).toLocaleString(de.locale)}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">{copy.blocker[blocker]}</p>
        )}
      </div>

      {/* --------------------------------------------------------------- mail */}
      <OrderMailPanel orderNumber={order.order_number} mail={mail ?? []} />

      {/* ------------------------------------------------------------- events */}
      <h2 className="mt-8 text-lg font-semibold">{copy.eventsHeading}</h2>
      <ol className="mt-2 flex flex-col gap-1 text-sm">
        {events.map((event, index) => (
          <li key={`${event.created_at}-${index}`} className="flex gap-3">
            <time className="shrink-0 tabular-nums text-muted" dateTime={event.created_at}>
              {new Date(event.created_at).toLocaleString(de.locale)}
            </time>
            <span>
              {event.event_type}
              <span className="ml-2 text-muted">{event.actor_kind}</span>
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}
