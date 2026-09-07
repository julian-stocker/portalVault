/**
 * "Zum Warenkorb hinzugefügt" (V10).
 *
 * The buy button used to rename itself for a moment — "Im Warenkorb" — which
 * said the wrong thing twice: it made a control that always does one thing
 * look as though it did two, and it stated the cart's contents on a button
 * that has no business knowing them. The button is constant now, and the
 * confirmation happens here.
 *
 * A pure reader of `lib/cart/toast`, which owns the message and its timer.
 * No effects, so there is nothing to clean up and no timer that can outlive
 * the message it belongs to.
 *
 * WHERE IT SITS
 *
 * Above the round cart button on a phone — the two must never overlap — and
 * both clear the bottom bar and the home indicator. On desktop the bottom
 * bar is gone, so it settles into the corner.
 *
 * It says nothing about stock. Nothing is reserved, nothing is held: the cart
 * is a list in this browser (ADR-0043).
 */
"use client";

import { useSyncExternalStore } from "react";

import { conditionLabel } from "@/components/shop/shop-action";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/cart/toast";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/** A check, drawn rather than typed: no emoji where an icon belongs. */
function CheckGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="mt-0.5 h-4 w-4 shrink-0 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 8.5 3.5 3.5L13 5" />
    </svg>
  );
}

export function CartToast() {
  const toast = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /*
   * The region is always in the tree, and only its contents change. A live
   * region that appears at the same moment as its message is not reliably
   * announced — the reader has to have been watching it already.
   */
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        // Clear of the round cart button (3.25rem) and of the bar and home
        // indicator beneath it, with a gap either side.
        "pointer-events-none fixed right-4 left-4 z-40 " +
        "bottom-[calc(2.75rem+env(safe-area-inset-bottom)+4.5rem)] " +
        "md:right-6 md:left-auto md:bottom-6 md:max-w-sm"
      }
    >
      {toast ? (
        <div
          className={
            "flex items-start gap-2 rounded-sky-md bg-deep/95 px-3.5 py-2.5 " +
            "shadow-raised ring-1 ring-gold-line backdrop-blur-sm"
          }
        >
          <CheckGlyph />
          <div className="min-w-0">
            <p className="text-sm leading-snug font-medium text-on-deep">
              {toast.kind === "increased" ? de.shop.toastIncreased : de.shop.toastAdded}
            </p>
            <p className="truncate text-[11px] leading-tight text-on-deep-muted tabular-nums">
              {toast.kind === "increased"
                ? de.shop.toastQuantityLine(
                    toast.quantity,
                    toast.name,
                    conditionLabel(toast.condition),
                  )
                : de.shop.toastLine(
                    toast.name,
                    conditionLabel(toast.condition),
                    formatPrice(toast.price),
                  )}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
