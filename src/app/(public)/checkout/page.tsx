import type { Metadata } from "next";

import { CheckoutView } from "@/components/checkout/checkout-view";
import { fetchSavedContact } from "@/lib/account/contacts";
import { checkoutAccess } from "@/lib/commerce/access";
import { de } from "@/lib/i18n/de";
import { offerRecord } from "@/lib/shop/offer";
import { fetchOffers } from "@/lib/shop/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: de.checkout.title };

/**
 * The checkout (B1).
 *
 * A server component that loads two things: the public shop, and — if there
 * is a session — the address to prefill the contact field with. What is in
 * the basket still lives in the browser (ADR-0043), so this route works
 * signed out and needs no session.
 *
 * **Opening this page reserves nothing.** The cart is non-binding right up to
 * the moment somebody submits; only then does `create_order()` re-read every
 * price, re-check availability, decide the shipping charge and hold the stock
 * — all in one transaction (ADR-0050).
 *
 * There is no payment here. B1 ends with a created, reserved, unpaid order,
 * and the interface says so rather than implying a completed purchase.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  // Asked before anything is loaded. Not the enforcement — `create_order()`
  // asks the same question in the database — but the reason the page does not
  // offer a form nobody could submit.
  const access = await checkoutAccess();
  const offers = await fetchOffers();

  // Where the payment page sends somebody who cancelled. A hint only: the
  // browser checks it against the order it actually placed, and a number from
  // anywhere else matches nothing.
  const { order } = await searchParams;

  // Only to prefill a field. The address that ends up on the order is the one
  // in the form, snapshotted — never a live link to an account (ADR-0049).
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  // What this account has saved, if anything. RLS returns their row and no
  // other; a guest gets null and is asked for everything, as before.
  const contact = await fetchSavedContact();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      <h1
        className="text-2xl font-semibold tracking-tight md:text-3xl"
        style={{ textShadow: "0 2px 20px rgb(10 9 24 / 0.85), 0 1px 3px rgb(10 9 24 / 0.95)" }}
      >
        {de.checkout.title}
      </h1>
      <div className="mt-5">
        {access.mayCheckout ? (
          <CheckoutView
            offers={offerRecord(offers)}
            email={data.user?.email ?? ""}
            contact={contact}
            saveDefaultAllowed={Boolean(data.user)}
            resumeOrderNumber={typeof order === "string" ? order.trim() : undefined}
          />
        ) : (
          <section className="rounded-xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-base font-semibold">
              {access.reason === "testers_only"
                ? de.checkout.testersOnlyHeading
                : de.checkout.closedHeading}
            </h2>
            <p className="mt-2 text-sm text-white/70">
              {access.reason === "testers_only"
                ? de.checkout.testersOnlyBody
                : de.checkout.closedBody}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
