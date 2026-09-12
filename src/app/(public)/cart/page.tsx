import type { Metadata } from "next";

import { CartView } from "@/components/cart/cart-view";
import { currentUser } from "@/lib/auth/user";
import { de } from "@/lib/i18n/de";
import { offerRecord } from "@/lib/shop/offer";
import { fetchOffers } from "@/lib/shop/queries";

export const metadata: Metadata = { title: de.cart.title };

/**
 * The cart.
 *
 * The page is a server component that loads two things: the public shop, and
 * whether anybody is signed in. What is actually in the cart is read in the
 * browser — from `localStorage` for a guest, from `cart_items` for an account
 * (ADR-0043, ADR-0061) — so this route still works signed out.
 *
 * The session is read here rather than in the view because the notice about
 * where the basket is kept has to be right in the FIRST paint. The client
 * cannot answer that during render: `currentPrincipal()` is bound in an
 * effect, so it still reads "guest" while the markup is produced.
 *
 * The whole offer list is handed down rather than a lookup for the lines in
 * the cart, for the simple reason that the server cannot know what those
 * lines are — and because the list is small enough that it does not matter.
 */
export default async function CartPage() {
  const [offers, user] = await Promise.all([fetchOffers(), currentUser()]);

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
        <CartView offers={offerRecord(offers)} guest={user === null} />
      </div>
    </main>
  );
}
