/**
 * The cart, in the header.
 *
 * Deliberately not a fifth entry in the navigation bar (ADR-0043). The bar
 * says where you are — catalog, collection, account — and a cart is not a
 * place in that sense; it is a thing you are carrying. On a phone the bar is
 * four thumb-width targets already, and a fifth would shrink all of them.
 *
 * So it sits in the header row beside the wordmark, in both layouts, and it
 * is a link with a count rather than a panel that opens: /cart is a real
 * page with a real address, which a drawer would not be.
 *
 * The count is 0 until the provider has read `localStorage` (`ready`), which
 * is what keeps the server's markup and the browser's first render identical.
 * The badge is simply absent at zero — an empty cart has nothing to say.
 */
"use client";

import Link from "next/link";

import { useCart } from "@/components/cart/use-cart";
import { CartGlyph } from "@/components/shop/cart-glyph";
import { de } from "@/lib/i18n/de";

export function CartBadge() {
  const { count } = useCart();

  return (
    <Link
      href="/cart"
      aria-label={count > 0 ? `${de.cart.open}, ${de.cart.pieces(count)}` : de.cart.open}
      className={
        "relative flex min-h-11 min-w-11 items-center justify-center rounded-full " +
        "text-on-deep-muted transition-colors hover:text-on-deep"
      }
    >
      <CartGlyph className="h-5 w-5" />
      {count > 0 ? (
        <span
          className={
            "absolute top-1 right-0.5 min-w-4 rounded-full bg-accent px-1 " +
            "text-[10px] leading-4 font-semibold text-on-accent tabular-nums"
          }
        >
          {/* The number is decoration over the icon; the accessible name
              above already says how many. */}
          <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
        </span>
      ) : null}
    </Link>
  );
}
