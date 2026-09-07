/**
 * The cart, within reach while scrolling (V9).
 *
 * The header badge is the cart's home, and on a phone the header scrolls
 * away after the first row of figures. Putting three things in the basket
 * over 100 cards meant scrolling back to the top to check on them. This is
 * the same cart, reachable from wherever you are.
 *
 * MOBILE ONLY, AND ONLY WHEN IT HAS SOMETHING TO SAY
 *
 * Hidden from `md:` upwards, where the header never leaves the screen and a
 * floating button would be a second control for a destination already in
 * view. Hidden while the cart is empty, so a catalog nobody is shopping in
 * stays quiet. It appears the moment the first article goes in.
 *
 * WHERE IT SITS
 *
 * Above the bottom navigation, not over it. The bar is 44 px plus the phone's
 * safe-area inset — the same expression `NavSpacer` uses — and this clears
 * both with a gap, so it never covers a navigation label or lands under a
 * home indicator.
 *
 * It shows the count rather than the total: how many things are in the basket
 * is the question somebody scrolling actually has, and a sum needs more width
 * than a floating control should take from a 390 px screen.
 */
"use client";

import Link from "next/link";

import { useCart } from "@/components/cart/use-cart";
import { CartGlyph } from "@/components/shop/cart-glyph";
import { formatNumber } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export function FloatingCart() {
  const { count } = useCart();

  // `count` is 0 until the stored cart has been read, so this renders
  // nothing on the server and nothing during hydration — no flash, and no
  // mismatch between the two.
  if (count === 0) return null;

  return (
    <Link
      href="/cart"
      aria-label={de.cart.openWith(count)}
      className={
        // Clear of the bottom bar (2.75rem) and of the home indicator, with
        // a 0.75rem gap. The same numbers NavSpacer reserves.
        "fixed right-4 bottom-[calc(2.75rem+env(safe-area-inset-bottom)+0.75rem)] z-30 " +
        "flex min-h-11 items-center gap-2 rounded-full px-4 " +
        "bg-accent text-on-accent shadow-raised ring-1 ring-on-accent/10 " +
        "transition-colors hover:bg-accent-hover md:hidden"
      }
    >
      <CartGlyph className="h-5 w-5" />
      {/* The number is decoration beside the glyph; the accessible name above
          already says how many articles are in the cart. */}
      <span aria-hidden="true" className="text-sm font-semibold tabular-nums">
        {formatNumber(count)}
      </span>
    </Link>
  );
}
