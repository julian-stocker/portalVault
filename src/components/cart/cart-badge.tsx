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
import { COMMERCE_INK } from "@/components/ui/action";
import { de } from "@/lib/i18n/de";

export function CartBadge() {
  const { count } = useCart();

  return (
    <Link
      href="/cart"
      aria-label={count > 0 ? `${de.cart.open}, ${de.cart.pieces(count)}` : de.cart.open}
      className={
        "relative flex min-h-11 min-w-11 items-center justify-center rounded-full " +
        /*
         * AMBER, BECAUSE THIS IS A COMMERCE ACTION (V3.2).
         *
         * It was `text-on-deep-muted` — the ink of something present but not
         * being pointed at, the same weight as a secondary nav item. That is
         * what a cart looks like when it is filed under navigation. It is not
         * navigation: it is the way to the purchase, and the role for that
         * already exists.
         *
         * The role is worn as ink rather than as a filled pill. There is no
         * surface here to fill — the control is a glyph on the header's own
         * dark ground — and giving it one would make it a button in a row of
         * links, which is a layout decision nobody asked for.
         *
         * Contrast on `bg-deep/80`: 6.83:1 by day, 7.28:1 at night; pressed,
         * the darkest of the three, still 5.40:1 and 5.76:1. Measured in
         * `roles.test.ts` rather than asserted here.
         *
         * Hover and press stay classes, the resting colour is carried inline
         * — the same split `COMMERCE_SURFACE` makes, and for the same reason.
         */
        "focus-ring transition-colors hover:text-commerce-hover active:text-commerce-pressed"
      }
      style={COMMERCE_INK}
    >
      <CartGlyph className="h-5 w-5" />
      {count > 0 ? (
        <span
          className={
            /*
             * The count stays silver, deliberately. Amber marks the action;
             * silver is what trade information is made of, and "three
             * articles" is information. It also keeps the bubble legible
             * against the amber glyph behind it, which a second amber would
             * not.
             */
            "absolute top-1 right-0.5 min-w-4 rounded-full bg-trade-solid px-1 " +
            "text-[10px] leading-4 font-semibold text-on-trade tabular-nums"
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
