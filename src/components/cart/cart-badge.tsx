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
import { de } from "@/lib/i18n/de";

/** A basket outline. Decorative; the label carries the meaning. */
function CartGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18l-1.8 9.6a2 2 0 0 1-2 1.6H6.8a2 2 0 0 1-2-1.6L3 6Z" />
      <path d="M8.5 6 10 2.75M15.5 6 14 2.75" />
      <circle cx="9" cy="20.25" r="1.25" />
      <circle cx="16" cy="20.25" r="1.25" />
    </svg>
  );
}

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
      <CartGlyph />
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
