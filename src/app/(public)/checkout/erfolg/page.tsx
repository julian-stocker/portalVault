import type { Metadata } from "next";

import { PaymentStatus } from "@/components/checkout/payment-status";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.checkout.result.title };

/**
 * Where the payment provider sends the customer back (B2.4).
 *
 * A server shell and nothing more. The one question that matters — did the
 * money arrive — is asked by `PaymentStatus` in the browser, because a guest
 * proves ownership with a capability that lives in `sessionStorage` and no
 * server component can read that.
 *
 * WHAT THIS PAGE REFUSES TO DO
 *
 * It does not claim a payment succeeded because Stripe redirected here. The
 * redirect happens when the Checkout Session completes, which is not the same
 * event as money arriving, and the URL is one anybody can type. Only
 * `order_payment_state()` decides what is shown.
 *
 * `session_id` is in the URL because `create-payment` put Stripe's placeholder
 * there, and it stays unread: it authorises nothing and identifies nothing the
 * order number does not already. It is left in place only so a human chasing a
 * support case at Stripe has the reference to hand.
 */
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  const orderNumber = typeof order === "string" ? order.trim() : "";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      <h1
        className="text-2xl font-semibold tracking-tight md:text-3xl"
        style={{ textShadow: "0 2px 20px rgb(10 9 24 / 0.85), 0 1px 3px rgb(10 9 24 / 0.95)" }}
      >
        {de.checkout.result.title}
      </h1>

      <div className="mt-5">
        {orderNumber === "" ? (
          // The product's own panel, not raw `bg-white/5` (F9): this is the
          // screen a customer lands on after paying, and it was the only one
          // that did not look like SkyIsles.
          <div className="rounded-sky-lg bg-deep/90 p-5 ring-1 ring-gold-line backdrop-blur-sm">
            <h2 className="text-lg font-semibold">{de.checkout.result.unknownTitle}</h2>
            <p className="mt-1 text-sm text-on-deep-muted">{de.checkout.result.unknownHint}</p>
          </div>
        ) : (
          <PaymentStatus orderNumber={orderNumber} />
        )}
      </div>
    </main>
  );
}
