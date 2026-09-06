import type { Metadata } from "next";

import { CartView } from "@/components/cart/cart-view";
import { de } from "@/lib/i18n/de";
import { offerRecord } from "@/lib/shop/offer";
import { fetchOffers } from "@/lib/shop/queries";

export const metadata: Metadata = { title: de.cart.title };

/**
 * The cart.
 *
 * The page is a server component that loads one thing: the public shop. What
 * is actually in the cart lives in the visitor's browser and is read there
 * (ADR-0043), so this route needs no session and works signed out.
 *
 * The whole offer list is handed down rather than a lookup for the lines in
 * the cart, for the simple reason that the server cannot know what those
 * lines are — and because the list is small enough that it does not matter.
 */
export default async function CartPage() {
  const offers = await fetchOffers();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      {/* The world runs behind the top of every collector page, and this one
          is short enough that all of it lands there — so the title carries
          its own shadow, exactly as the catalog's and the collection's do
          (ADR-0038, V3.3). */}
      <h1
        className="text-2xl font-semibold tracking-tight md:text-3xl"
        style={{ textShadow: "0 2px 20px rgb(10 9 24 / 0.85), 0 1px 3px rgb(10 9 24 / 0.95)" }}
      >
        {de.cart.title}
      </h1>
      <div className="mt-5">
        <CartView offers={offerRecord(offers)} />
      </div>
    </main>
  );
}
