/**
 * The cart, always within reach on a phone (V10).
 *
 * The header badge is the cart's home, and on a phone the header scrolls away
 * after the first row of figures. This is the same cart, reachable from
 * wherever you are — a round button in the corner, the shape a floating
 * action has.
 *
 * ALWAYS THERE, NOT ONLY WHEN FULL
 *
 * V9 hid it while the cart was empty, on the theory that a catalog nobody is
 * shopping in should stay quiet. That made the cart hard to find at exactly
 * the moment somebody first wants it — you cannot open a control that only
 * appears once you have used it. The button is always there below `md:`; the
 * **badge** is what appears with the first article.
 *
 * WHERE IT SITS
 *
 * Directly above the bottom navigation, not over it. That bar is 44 px plus
 * the phone's safe-area inset — the same expression `NavSpacer` reserves —
 * and this clears both by 10 px, close enough to read as one cluster with the
 * bar and far enough never to cover a label or sit under a home indicator.
 */
"use client";

import Link from "next/link";

import { useCart } from "@/components/cart/use-cart";
import { CartGlyph } from "@/components/shop/cart-glyph";
import { formatNumber } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export function FloatingCart() {
  const { count } = useCart();

  return (
    <Link
      href="/cart"
      aria-label={count > 0 ? de.cart.openWith(count) : de.cart.open}
      className={
        "fixed right-4 bottom-[calc(2.75rem+env(safe-area-inset-bottom)+0.625rem)] z-30 " +
        // 52 px: a real floating action, and well past the 44 px target.
        "flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full " +
        // A real dark edge, not a hint of one (V3.1a). The button is
        // `fixed` and scrolls over whatever is beneath it — including ivory
        // cards, where the silver fill alone measures 1.39:1. The pair covers
        // every ground: the fill carries the dark sky at 11.7:1, the ring
        // carries a light card at 14.6:1.
        "focus-ring bg-trade-solid text-on-trade shadow-raised ring-2 ring-on-trade " +
        "transition-colors hover:bg-trade-solid-hover md:hidden"
      }
    >
      <CartGlyph className="h-6 w-6" />

      {/* `count` is 0 until the stored cart has been read, so the badge is
          absent on the server and on the first browser frame alike — the
          button itself never flickers, because it does not depend on it. */}
      {count > 0 ? (
        <span
          aria-hidden="true"
          className={
            "absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center " +
            "rounded-full bg-deep px-1 text-[11px] leading-none font-semibold " +
            "text-on-deep ring-2 ring-trade-solid tabular-nums"
          }
        >
          {count > 99 ? "99+" : formatNumber(count)}
        </span>
      ) : null}
    </Link>
  );
}
