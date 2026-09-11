"use client";

import { useRef, useState } from "react";

import { markOrderShipped } from "@/lib/admin/order-actions";
import { TRACKING_MAX_LENGTH } from "@/lib/admin/orders";
import { de } from "@/lib/i18n/de";

/**
 * Marking one order as shipped.
 *
 * A form, a guard against a double submit, and a German sentence when the
 * database refuses. Everything that decides lives in
 * `admin_mark_order_shipped()`: administrator, paid, unflagged, unshipped.
 *
 * The tracking number is optional and is stored exactly as pasted, minus
 * surrounding whitespace. No carrier detection, no link, no format check —
 * carriers disagree, and a validator that knows DHL would reject Hermes.
 */
export function ShipOrderForm({ orderNumber }: { orderNumber: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Checked and set before the first await, so two taps in one frame cannot
  // both get through — the same guard the checkout uses.
  const busy = useRef(false);

  async function submit(formData: FormData) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const tracking = String(formData.get("tracking") ?? "");
      const result = await markOrderShipped(orderNumber, tracking);
      if (!result.ok) setError(result.message);
      // On success the server action revalidates and the page re-reads; the
      // form is replaced by the shipped state rather than told to hide.
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">{de.admin.orders.trackingLabel}</span>
        <input
          name="tracking"
          type="text"
          maxLength={TRACKING_MAX_LENGTH}
          autoComplete="off"
          className="rounded-sky bg-surface px-3 py-2 ring-1 ring-border/70"
        />
        <span className="text-xs text-muted">{de.admin.orders.trackingHint}</span>
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-auto self-start rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
      >
        {pending ? de.admin.orders.shipping_ : de.admin.orders.shipAction}
      </button>
    </form>
  );
}
