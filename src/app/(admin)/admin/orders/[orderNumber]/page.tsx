import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ShipOrderForm } from "@/components/admin/ship-order-form";
import { fetchAdminOrder } from "@/lib/admin/order-queries";
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

  const { order, address, lines, events } = detail;
  const copy = de.admin.orders;
  const blocker = shipBlocker(order);

  // What the confirmation names. Falls back to the contact address when there
  // is no delivery address at all — never to an empty string, which would make
  // the question read "Bestellung … an ."
  const recipient =
    [address?.first_name, address?.last_name].filter(Boolean).join(" ").trim() ||
    order.customer_email;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <Link href="/admin/orders" className="text-sm text-muted underline underline-offset-4">
        ← {copy.title}
      </Link>

      <h1 className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
        {order.order_number}
      </h1>

      {/* Loud, and above everything else: this is the state in which shipping
          would hand over goods the ledger still counts as present. */}
      {order.needs_resolution ? (
        // `--danger` and its tints, not raw `red-*`: the product has one
        // colour for "this is wrong" and this is it (F9).
        <div className="mt-5 rounded-sky-lg bg-danger/10 p-5 ring-2 ring-danger/70">
          <h2 className="font-semibold text-danger">{copy.needsResolutionTitle}</h2>
          <p className="mt-1 text-sm text-foreground/90">{copy.needsResolutionHint}</p>
        </div>
      ) : null}

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
            <dd className="tabular-nums">{order.tracking_number}</dd>
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
      <h2 className="mt-8 text-lg font-semibold">{copy.linesHeading}</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {lines.map((line, index) => (
          <li
            key={`${line.sky_id}-${line.condition}-${index}`}
            // `rounded-sky` is not a class: the scale is -sm/-md/-lg, so these
            // rows rendered square-cornered among rounded panels (F16).
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-sky-md bg-surface/60 px-4 py-3 text-sm"
          >
            <span>
              <span className="font-medium">{line.name}</span>
              <span className="ml-2 text-muted tabular-nums">
                {line.sky_id} · {line.condition}
              </span>
            </span>
            <span className="tabular-nums">
              {line.quantity} × {formatPrice(Number(line.unit_price))}
              <span className="ml-3 font-semibold">{formatPrice(Number(line.line_total))}</span>
            </span>
          </li>
        ))}
      </ul>

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
      <h2 className="mt-8 text-lg font-semibold">{copy.shipHeading}</h2>
      <div className="mt-2 rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70">
        {blocker === null ? (
          <ShipOrderForm
            orderNumber={order.order_number}
            // Named in the confirmation, because the recipient is the other
            // thing a person recognises when they have the wrong row open.
            recipient={recipient}
          />
        ) : order.fulfillment_status === "shipped" ? (
          /*
           * Visible success, and it survives a reload (F6).
           *
           * Not a toast: the state is on the order, so it is read back from
           * the order. Whoever comes to this page tomorrow sees the same
           * sentence the person who shipped it saw.
           */
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-success">
              {copy.shipSucceeded(order.order_number)}
            </p>
            {order.shipped_at ? (
              <p className="text-sm text-muted tabular-nums">
                {copy.shippedAt}: {new Date(order.shipped_at).toLocaleString(de.locale)}
              </p>
            ) : null}
            <p className="text-sm text-muted tabular-nums">
              {order.tracking_number
                ? `${copy.trackingNumber}: ${order.tracking_number}`
                : copy.noTracking}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">{copy.blocker[blocker]}</p>
        )}
      </div>

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
