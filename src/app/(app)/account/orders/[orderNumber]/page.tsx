import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AccountHeader } from "@/components/account/account-header";
import { ConversationThread } from "@/components/messages/conversation-thread";
import { TrackingLink } from "@/components/commerce/tracking-link";
import { fetchMyOrder } from "@/lib/account/orders";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { formatDate, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { fetchConversation } from "@/lib/messages/queries";
import { WITHDRAWAL_PATH } from "@/lib/legal/widerruf";

export const metadata: Metadata = { title: de.account.orders.title };

type Detail = {
  order: Record<string, unknown>;
  address: Record<string, string | null> | null;
  lines: { sky_id: string; condition: string; name: string; quantity: number; line_total: string | number }[];
};

/**
 * One of the customer's own orders.
 *
 * `my_order()` matches on `user_id`, so somebody else's order number returns
 * null and this page is a 404 — an unknown order and one that is not yours
 * answer the same, exactly as `order_payment_state()` has since 0017.
 *
 * The address shown is the **snapshot** from `order_addresses`, never what
 * the account has saved today. Editing a saved default does not rewrite what
 * was agreed, and the page says so out loud.
 */
export default async function MyOrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  if (!profile.username) redirect(ONBOARDING_PATH);

  const { orderNumber } = await params;
  const document = (await fetchMyOrder(orderNumber)) as Detail | null;
  if (!document?.order) notFound();

  const order = document.order as Record<string, string | number | boolean | null>;
  const conversation = await fetchConversation(String(order.order_number));
  const copy = de.account.orders;
  const address = document.address;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <AccountHeader title={String(order.order_number)} />

      {order.commerce_mode === "sandbox" ? (
        <p className="rounded-sky-md bg-status-ground px-3 py-2 text-sm text-status-ink ring-1 ring-status-line">
          {copy.testBadge} — {de.admin.commerce.sandboxOrderHint}
        </p>
      ) : null}

      <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
        <dt className="text-muted">{copy.placedAt}</dt>
        {/* Not `String(...)`: that turns a missing value into the literal
            "undefined", which formatDate then has to reject by accident
            rather than on purpose. The field is typed as unknown here, so it
            is narrowed instead. */}
        <dd>{formatDate(typeof order.placed_at === "string" ? order.placed_at : null)}</dd>
        <dt className="text-muted">{copy.shippingMethod}</dt>
        <dd>{String(order.shipping_method ?? "–")}</dd>
        {/*
         * The CURRENT status, not the highest one ever reached (ADR-0074).
         *
         * `my_order()` has always returned `fulfillment_status`; this page
         * simply never showed it, so the customer inferred the state from
         * whether a tracking number had appeared. Since 0039 an administrator
         * can set a mistaken "Versendet" back, and an inference would then be
         * wrong in the one case that matters.
         *
         * Read fresh on every render, so unfulfilled → shipped → unfulfilled
         * → shipped each show as themselves.
         */}
        <dt className="text-muted">{copy.shipmentStatus}</dt>
        <dd>
          {copy.fulfillmentStatus[String(order.fulfillment_status ?? "")] ??
            copy.fulfillmentStatus.unfulfilled}
        </dd>
        {order.tracking_number ? (
          <>
            <dt className="text-muted">{copy.tracking}</dt>
            <dd>
              {/* The same component the operator's page uses, so the two
                  cannot disagree about what is clickable (ADR-0062). */}
              <TrackingLink
                shippingMethodCode={
                  order.shipping_method_code === null ? null : String(order.shipping_method_code)
                }
                trackingNumber={String(order.tracking_number)}
              />
            </dd>
          </>
        ) : null}
        <dt className="text-muted">{copy.total}</dt>
        <dd className="font-semibold tabular-nums">{formatPrice(Number(order.total_amount))}</dd>
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {copy.articles(document.lines.length)}
        </h2>
        <ul className="flex flex-col gap-2">
          {document.lines.map((line) => (
            <li
              key={`${line.sky_id}/${line.condition}`}
              className="flex items-baseline justify-between gap-4 rounded-sky-md bg-surface/80 px-4 py-3 text-sm ring-1 ring-border/70"
            >
              <span>
                {line.quantity} × {line.name}
                <span className="ml-2 text-muted">
                  {line.condition === "boxed" ? "OVP" : "Lose"}
                </span>
              </span>
              <span className="tabular-nums">{formatPrice(Number(line.line_total))}</span>
            </li>
          ))}
        </ul>
      </section>

      {address ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
            {copy.shippingAddress}
          </h2>
          <address className="text-sm not-italic">
            {[
              [address.first_name, address.last_name].filter(Boolean).join(" "),
              address.company,
              [address.street, address.house_number].filter(Boolean).join(" "),
              address.address_line_2,
              [address.postal_code, address.city].filter(Boolean).join(" "),
            ]
              .filter((part) => typeof part === "string" && part !== "")
              .map((part) => (
                <span key={String(part)} className="block">
                  {part}
                </span>
              ))}
          </address>
          {/* The one sentence that keeps the two tables apart in a reader's
              head: this is history, not a setting. */}
          <p className="text-xs text-muted">{copy.snapshotNote}</p>
        </section>
      ) : null}

      {/*
       * The documents and rights attached to this order (ADR-0086).
       *
       * A signed-in customer needs no capability token — `invoice_document()`
       * recognises the owner. A guest reaches the same two things from the
       * order-status page, which holds their token.
       */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {de.account.orders.documents}
        </h2>
        <div className="flex flex-col gap-2">
          {order.payment_status === "paid" ||
          order.payment_status === "refunded" ||
          order.payment_status === "partially_refunded" ? (
            <Link
              href={`/rechnung/${order.order_number}`}
              className="rounded-sky-md bg-surface/80 px-4 py-3 text-sm ring-1 ring-border/70 hover:ring-border-strong"
            >
              {de.invoice.openLink}
            </Link>
          ) : (
            <p className="text-sm text-muted">{de.invoice.pending}</p>
          )}

          {/*
           * § 356a BGB. Offered on the order it belongs to as well as in the
           * footer, because that is where somebody looks for it.
           */}
          <Link
            href={`${WITHDRAWAL_PATH}?bestellung=${encodeURIComponent(String(order.order_number))}`}
            className="rounded-sky-md bg-surface/80 px-4 py-3 text-sm ring-1 ring-border/70 hover:ring-border-strong"
          >
            {de.withdrawal.orderEntry}
          </Link>
        </div>
      </section>

      {/*
        Die Unterhaltung zur Bestellung — dort, wo die Frage entsteht.
        `null` heißt Gastbestellung; dann steht hier nichts, und zwar ohne
        Hinweis darauf, dass hier etwas stehen könnte.
      */}
      {conversation === null ? null : (
        <div id="nachrichten" className="scroll-mt-8">
          <ConversationThread conversation={conversation} />
        </div>
      )}
    </main>
  );
}
