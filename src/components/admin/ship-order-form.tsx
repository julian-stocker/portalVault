"use client";

import { useRef, useState } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { markOrderShipped } from "@/lib/admin/order-actions";
import { normaliseTracking } from "@/lib/admin/orders";
import { de } from "@/lib/i18n/de";

/**
 * Marking one order as shipped.
 *
 * A form, a confirmation, a guard against a double submit, and a German
 * sentence when the database refuses. Everything that decides lives in
 * `admin_mark_order_shipped()`: administrator, paid, unflagged, unshipped.
 *
 * WHY THERE IS A CONFIRMATION NOW
 *
 * This is the only irreversible action in the product.
 * `orders_protect_fulfillment()` allows exactly `unfulfilled → shipped`,
 * refuses the way back, freezes the tracking number afterwards, and
 * `order_events` is append-only — so a click on the wrong row cannot be taken
 * back by anyone, including the database owner. That is not hypothetical: on
 * 2026-09-11 `SI-2026-001022` was marked shipped by exactly that mistake
 * during a smoke test (PROJECT_STATUS.md).
 *
 * So the confirmation names the two things a person checks when they suspect
 * they have the wrong order open — the number and the recipient — and says
 * plainly that it cannot be undone. **Nothing about the rule changed:** no
 * trigger, no function, no status, no guard. The confirmation is a step in
 * front of the same call.
 *
 * THE NUMBER IS NOT ENTERED HERE ANY MORE
 *
 * Since ADR-0062 the parcel reference is its own state with its own control,
 * because a label is often bought before the parcel goes and occasionally
 * cancelled and replaced afterwards. This form names whatever is already
 * recorded in its confirmation — it is one of the two things a person checks
 * when they suspect they have the wrong row open — and ships without touching
 * it.
 */
export function ShipOrderForm({
  orderNumber,
  recipient,
  trackingNumber,
}: {
  orderNumber: string;
  /** Who the parcel is addressed to. Shown in the confirmation, nowhere else. */
  recipient: string;
  /** What is already recorded, if anything. Named in the confirmation. */
  trackingNumber: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True while the confirmation stands. Nothing has been sent at this point. */
  const [confirming, setConfirming] = useState(false);
  // Checked and set before the first await, so two taps in one frame cannot
  // both get through — the same guard the checkout uses.
  const busy = useRef(false);

  const copy = de.admin.orders;
  const normalised = normaliseTracking(trackingNumber);

  async function ship() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      // No number from here: whatever is recorded stays (`coalesce` in
      // `admin_mark_order_shipped()`). The number has its own control.
      const result = await markOrderShipped(orderNumber, null);
      if (!result.ok) {
        setError(result.message);
        setConfirming(false);
        return;
      }
      // On success the server action revalidates and the page re-reads; the
      // form is replaced by the shipped state rather than told to hide.
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (confirming) {
    return (
      <div
        // Announced when it appears: the operator may have got here by
        // keyboard, and a question that is only visible is not a question.
        role="alertdialog"
        aria-label={copy.confirmTitle}
        className="flex flex-col gap-3 rounded-sky-md bg-surface-raised p-4 ring-1 ring-danger/60"
      >
        <p className="font-semibold">{copy.confirmTitle}</p>

        <p className="text-sm tabular-nums">{copy.confirmFor(orderNumber, recipient)}</p>
        <p className="text-sm text-muted tabular-nums">
          {normalised === null
            ? copy.confirmWithoutTracking
            : copy.confirmWithTracking(normalised)}
        </p>

        {/* The sentence that matters. Not styled as an error — nothing has
            gone wrong — but as the fact that makes this worth asking. */}
        <p className="text-sm font-medium text-danger">{copy.confirmIrreversible}</p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void ship()}
            disabled={pending}
            className={`${ACTION_PRIMARY} w-auto disabled:opacity-60`}
          >
            {pending ? copy.shipping_ : copy.confirmYes}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className={`${ACTION_NEUTRAL} w-auto disabled:opacity-60`}
          >
            {copy.confirmNo}
          </button>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  /*
   * No tracking input here any more.
   *
   * Since ADR-0062 the number is its own state with its own control, and two
   * boxes for one value on one page is a question about which of them counts.
   * Shipping without naming a number keeps whatever was recorded — that is
   * what `coalesce` in `admin_mark_order_shipped()` is for.
   */
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{copy.shipUsesRecordedTracking}</p>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {/*
       * Opens the question; it does not ship. The white pill this replaces
       * (`bg-white/90 text-black`) appeared nowhere else in the product and
       * was the loudest thing on the page for the most dangerous action on it.
       */}
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className={`${ACTION_PRIMARY} w-auto self-start`}
      >
        {copy.shipAction}
      </button>
    </div>
  );
}
