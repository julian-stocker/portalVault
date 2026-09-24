import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderLineActions } from "@/components/admin/order-line-actions";
import { RefundForm } from "@/components/admin/refund-form";
import { OrderLinesTable } from "@/components/admin/order-lines-table";
import { OrderReviewPanel } from "@/components/admin/order-review-panel";
import { OrderMailPanel } from "@/components/admin/order-mail-panel";
import { SandboxOrderPanel } from "@/components/admin/sandbox-order-panel";
import { ConversationThread } from "@/components/messages/conversation-thread";
import { ShipOrderForm } from "@/components/admin/ship-order-form";
import { TrackingForm } from "@/components/admin/tracking-form";
import { TrackingLink } from "@/components/commerce/tracking-link";
import { fetchAdminOrder } from "@/lib/admin/order-queries";
import { fetchOrderReview } from "@/lib/admin/order-review";
import { shipBlocker } from "@/lib/admin/orders";
import { formatDeduction, formatPrice } from "@/lib/format";
import { openLineRefunds, openRefundTotal, openShippingRefund, unattributedRefund }
  from "@/lib/commerce/order-lines";
import { LABEL_KIND, orderMoney } from "@/lib/commerce/order-money";
import { de } from "@/lib/i18n/de";
import { fetchConversation } from "@/lib/messages/queries";

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
  /*
   * Dieselben Bedingungen, die `admin_mark_order_shipped()` prüft — inklusive
   * der beiden aus 0095, die hier gefehlt haben. Beide Angaben stehen bereits
   * in `admin_order()`; es kommt kein Aufruf dazu.
   */
  const blocker = shipBlocker({
    ...order,
    withdrawalDeclared: (detail.withdrawal ?? null) !== null,
    fulfillableTotal: detail.fulfillable_total,
  });

  /*
   * Widerruf, Positionsstand und Geld (0095).
   *
   * Alles aus `admin_order()`, das die Seite ohnehin lädt — kein zusätzlicher
   * Aufruf. Der Erstattungsvorschlag ist die Summe dessen, was die stornierten
   * Mengen laut ihrer Positionen gekostet haben; erstattet wird trotzdem von
   * Hand in Stripe, und was der Operator dort tat, steht in `refunds`.
   */
  const conversation = await fetchConversation(order.order_number);
  const withdrawal = detail.withdrawal ?? null;
  const refunds = detail.refunds ?? [];
  /*
   * EIN VORSCHLAG, EINE AUFTEILUNG, EINE QUELLE.
   *
   * Vorher rechnete die Seite den Betrag gegen ALLE Erstattungen und schickte
   * trotzdem JEDE stornierte Position als Aufteilung mit. Nach dem zweiten
   * Storno standen 1,79 € gegen 4,04 + 1,79 — und die Aktion wies den ganz
   * gewöhnlichen Vorgang „stornieren, erstatten, noch einmal stornieren,
   * erstatten" mit „Die Aufteilung ergibt nicht den Erstattungsbetrag" ab.
   * Beides kommt jetzt aus `openLineRefunds()`: Summe und Posten derselben
   * Liste können nicht auseinanderlaufen.
   */
  const allocations = refunds.flatMap((one) => (one.allocations ?? []).map((part) => ({
    type: part.type,
    orderLineId: part.order_line_id,
    quantity: part.quantity,
    amount: part.amount,
  })));
  const openLines = openLineRefunds(
    lines.flatMap((line) =>
      line.id === undefined ? [] : [{
        id: line.id,
        lineTotal: Number(line.line_total),
        quantity: line.quantity,
        cancelled: line.cancelled ?? 0,
        returned: line.returned ?? 0,
      }]),
    allocations,
  );
  const refundOpen = openRefundTotal(openLines);
  /*
   * Der Versand ist eine eigene Frage (0097) und wird nur dort überhaupt
   * gestellt, wo der Vertrag rückabgewickelt wird: bei einem Widerruf oder
   * einer stornierten Bestellung. Bei einer normalen Teilstornierung geht
   * das Paket trotzdem raus, und die Hinsendekosten bleiben verdient.
   */
  const openShipping = openShippingRefund(order.shipping_amount, allocations);
  const reversed = order.fulfillment_status === "cancelled" || withdrawal !== null;
  const shippingOffer = reversed ? openShipping : 0;
  /* Zurückgezahltes, das keine Aufteilung erklärt — wird gezeigt, nie geraten. */
  const unattributed = unattributedRefund(refunds, allocations);
  /*
   * Die beiden Geldblöcke (0096). Alles aus `admin_order()`, das die Seite
   * ohnehin lädt — `costs` sind die Posten des zugehörigen Verkaufs aus
   * `sale_fees`, und ohne erfassten Posten sind sie 0. Gerechnet wird in
   * ganzen Cent, Storno und Erstattung bleiben getrennte Vorgänge.
   */
  const costs = detail.costs ?? null;
  const money = orderMoney({
    itemsSubtotal: order.items_subtotal,
    shippingAmount: order.shipping_amount,
    discountAmount: order.discount_amount,
    refunds,
    costs: [
      { kind: "fees", amount: costs?.fees ?? 0 },
      { kind: LABEL_KIND, amount: costs?.shipping_label ?? 0 },
    ],
  });
  /* Welche Aktion eine Position überhaupt zulässt — der Server entscheidet
     es noch einmal, dies hält nur unmögliche Knöpfe vom Bildschirm fern. */
  const lineMode: "cancel" | "return" | "none" =
    order.fulfillment_status === "unfulfilled"
      && (order.payment_status === "paid" || order.payment_status === "partially_refunded")
      ? "cancel"
      : order.fulfillment_status === "shipped" ? "return" : "none";
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

      {/*
        Widerruf und Geldstand, über allem anderen (0095).

        Der Banner steht hier und nicht unten, weil er das Einzige ist, das
        eine Handlung VERHINDERT: wer die Seite öffnet, um zu versenden, muss
        ihn vor dem Knopf sehen.
      */}
      {withdrawal ? (
        <p role="status" className="mt-6 rounded-sky-md bg-status-ground px-3 py-2.5 text-sm text-status-ink ring-1 ring-status-line">
          {copy.withdrawalBanner(new Date(withdrawal.received_at).toLocaleString(de.locale))}
          {order.fulfillment_status === "unfulfilled" ? (
            <span className="mt-1 block font-medium">{copy.withdrawalBlocksShipping}</span>
          ) : null}
        </p>
      ) : null}

      {order.fulfillment_status === "cancelled" ? (
        <p role="status" className="mt-4 rounded-sky-md bg-surface px-3 py-2.5 text-sm ring-1 ring-border/70">
          {copy.cancelledBanner}
        </p>
      ) : null}


      {/*
        Die Dokumentation der Erstattung, an der Bestellung statt nur unter
        /business/widerrufe — hier steht ohnehin, wofür sie ist. Der Betrag ist
        vorbelegt, die Zuordnung reist mit, und Geld bewegt sich weiterhin
        ausschließlich in Stripe.
      */}

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
      <OrderLinesTable
        lines={lines}
        action={(line) =>
          line.id === undefined ? null : (
            <OrderLineActions
              orderNumber={order.order_number}
              orderLineId={line.id}
              mode={lineMode}
              open={lineMode === "return"
                ? (line.returnable ?? 0)
                : (line.cancellable ?? 0)}
            />
          )}
      />

      {/* ------------------------------------------------------------- money */}
      {/*
        ZWEI GETRENNTE FRAGEN, ZWEI GETRENNTE BLÖCKE (0096).
        Oben das Geld des Kunden — nur eine Erstattung verändert es, ein
        Storno nicht. Unten, was davon diesem Betrieb bleibt. Der Rabatt wird
        genau einmal abgezogen, nämlich oben.
      */}
      {/*
        DIREKT UNTER DEN POSITIONEN (0097).
        Der Weg des Betreibers ist: Position stornieren, Betrag erstatten.
        Oberhalb der Tabelle stand der Knopf vor der Entscheidung, die er
        beantwortet — und nach jedem Storno musste man nach oben scrollen.
      */}
      {refundOpen > 0 || shippingOffer > 0 ? (
        <RefundForm
          orderNumber={order.order_number}
          withdrawalId={withdrawal?.id}
          withdrawalHandled={(withdrawal?.handled_at ?? null) !== null}
          suggested={refundOpen}
          cancelled={openLines.map((one) => ({
            ...one,
            label: lines.find((line) => line.id === one.orderLineId)?.name,
          }))}
          unattributed={unattributed}
          openShipping={shippingOffer}
        />
      ) : null}

      <section className="mt-4 rounded-sky-md bg-surface/80 p-4 ring-1 ring-border/70">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
          {copy.finance.paidTitle}
        </h2>
        <dl className="mt-2 flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{copy.finance.subtotal}</dt>
            <dd className="tabular-nums">{formatPrice(money.itemsSubtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{copy.finance.shipping}</dt>
            <dd className="tabular-nums">{formatPrice(money.shippingAmount)}</dd>
          </div>
          {/* Nur zeigen, was es gibt: eine Null-Zeile erklärt nichts. */}
          {money.discountAmount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">{copy.finance.discount}</dt>
              <dd className="tabular-nums text-danger">{formatDeduction(money.discountAmount)}</dd>
            </div>
          ) : null}
          {money.refunded > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">{copy.finance.refunded}</dt>
              <dd className="tabular-nums text-danger">{formatDeduction(money.refunded)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-border/70 pt-1">
            <dt className="font-medium">{copy.finance.remaining}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatPrice(money.remaining)}
            </dd>
          </div>
        </dl>
        <p className="mt-1 text-[11px] leading-snug text-muted">{copy.finance.remainingHint}</p>

        {/* Der Vorschlag aus den stornierten Mengen — eine Aufgabe, keine
            Buchung: erstattet wird weiterhin von Hand in Stripe. */}
        {refundOpen > 0 ? (
          <p className="mt-2 flex justify-between gap-3 border-t border-border/70 pt-2 text-sm">
            <span className="text-muted">{copy.money.open}</span>
            <span className="font-semibold tabular-nums text-own-ink">
              {formatPrice(refundOpen)}
            </span>
          </p>
        ) : null}
      </section>

      <section className="mt-3 rounded-sky-md bg-surface/80 p-4 ring-1 ring-border/70">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
          {copy.finance.proceedsTitle}
        </h2>
        <dl className="mt-2 flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{copy.finance.remaining}</dt>
            <dd className="tabular-nums">{formatPrice(money.remaining)}</dd>
          </div>
          <div className="pt-1">
            <p className="text-xs text-muted">{copy.finance.costsTitle}</p>
            {money.costs > 0 ? (
              <>
                <div className="flex justify-between pl-3">
                  <dt className="text-muted">{copy.finance.fees}</dt>
                  <dd className="tabular-nums text-danger">{formatDeduction(money.fees)}</dd>
                </div>
                <div className="flex justify-between pl-3">
                  <dt className="text-muted">{copy.finance.shippingLabel}</dt>
                  <dd className="tabular-nums text-danger">
                    {formatDeduction(money.shippingLabel)}
                  </dd>
                </div>
              </>
            ) : (
              <p className="pl-3 text-xs text-muted">{copy.finance.noCosts}</p>
            )}
          </div>
          <div className="flex justify-between border-t border-border/70 pt-1">
            <dt className="font-medium">{copy.finance.proceeds}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatPrice(money.proceeds)}
            </dd>
          </div>
        </dl>
        <p className="mt-1 text-[11px] leading-snug text-muted">{copy.finance.costsHint}</p>
      </section>

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

      {/* ------------------------------------------------------- Nachrichten */}
      {/*
        Unter dem Versand, über der Mail: die Unterhaltung gehört zur
        Bearbeitung, nicht zum Protokoll. `null` heißt Gastbestellung — dann
        gibt es nichts zu zeigen und keinen Hinweis darauf, dass es etwas gäbe.
      */}
      {conversation === null ? null : (
        <div id="nachrichten" className="scroll-mt-8">
          <ConversationThread conversation={conversation} />
        </div>
      )}

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
