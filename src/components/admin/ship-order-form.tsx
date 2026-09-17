"use client";

import { useRef, useState } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { markOrderShipped, unmarkOrderShipped } from "@/lib/admin/order-actions";
import { de } from "@/lib/i18n/de";

/**
 * The shipping status of one order, in both directions.
 *
 * Everything that decides still lives in the database:
 * `admin_mark_order_shipped()` wants an administrator, a paid order, no
 * resolution flag and an unshipped status; `admin_unmark_order_shipped()`
 * wants an administrator and a shipped one.
 *
 * WHY THE CONFIRMATION IS GONE
 *
 * It was right for what it guarded. Until 0039 this was the only irreversible
 * action in the product — `orders_protect_fulfillment()` allowed exactly
 * `unfulfilled → shipped` and `order_events` is append-only, so a tap on the
 * wrong row could not be taken back by anyone, including the database owner.
 * That happened, on 2026-09-11, to `SI-2026-001022` during a smoke test.
 *
 * 0039 removed the reason rather than the symptom: the status goes both ways
 * now. A mis-tap is one tap to correct, so a modal question in front of it
 * would make a harmless switch feel dangerous and would slow down the work it
 * sits in the middle of. "Versendet" is an informational status for the
 * customer, not a financial or inventory event — nothing about money, stock,
 * payment or the order lines moves in either direction.
 *
 * THE NUMBER IS NOT ENTERED HERE
 *
 * Since ADR-0062 the parcel reference is its own state with its own control,
 * above this one: a label is usually bought before the parcel goes, and
 * occasionally cancelled and replaced afterwards. Shipping without naming a
 * number keeps whatever was recorded, and setting the status back keeps it
 * too — un-shipping does not unbuy a label.
 */
export function ShipOrderForm({
  orderNumber,
  shipped,
  hasTracking,
}: {
  orderNumber: string;
  /** The current status. This component renders one of two states. */
  shipped: boolean;
  /** Whether a parcel reference is recorded, so the hint can be honest. */
  hasTracking: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Checked and set before the first await, so two taps in one frame cannot
  // both get through — the same guard the checkout uses.
  const busy = useRef(false);

  const copy = de.admin.orders;

  async function change() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      // No number from either call: whatever is recorded stays. The number has
      // its own control.
      const result = shipped
        ? await unmarkOrderShipped(orderNumber)
        : await markOrderShipped(orderNumber, null);
      if (!result.ok) setError(result.message);
      // On success the server action revalidates and the page re-reads; this
      // component is replaced by the other state rather than told to switch.
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/*
       * The status first and in words, because that is what the operator came
       * to read. The button underneath names the change, not the state.
       */}
      <p className="text-base font-semibold">
        {shipped ? copy.statusShipped : copy.statusUnfulfilled}
      </p>
      <p className="text-sm text-muted">
        {copy.statusHint}
        {shipped && hasTracking ? ` ${copy.statusKeepsTracking}` : ""}
      </p>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {/*
       * Shipping is the forward move and keeps the primary weight; setting the
       * status back is a correction and takes the neutral one. Neither is
       * styled as destructive, because neither is.
       */}
      <button
        type="button"
        onClick={() => void change()}
        disabled={pending}
        className={`${shipped ? ACTION_NEUTRAL : ACTION_PRIMARY} w-auto self-start disabled:opacity-60`}
      >
        {pending
          ? shipped
            ? copy.unshipping
            : copy.shipping_
          : shipped
            ? copy.unshipAction
            : copy.shipAction}
      </button>
    </div>
  );
}
