/**
 * Recording and correcting the parcel reference.
 *
 * Its own control, separate from "mark as shipped", because it is its own
 * action (ADR-0062). The operator buys a label first and ships later;
 * sometimes a label is cancelled and replaced, and then the number on an
 * order that has already gone out is wrong and has to be corrected.
 *
 * Available before **and** after shipping. It changes no fulfilment state, it
 * does not move `shipped_at`, and it sends no second confirmation — none of
 * which this component enforces: `admin_set_tracking_number()` does, and it
 * is the only thing this calls.
 */
"use client";

import { useRef, useState } from "react";

import { ACTION_NEUTRAL } from "@/components/ui/action";
import { TrackingLink } from "@/components/commerce/tracking-link";
import { setTrackingNumber } from "@/lib/admin/order-actions";
import { normaliseTracking, TRACKING_MAX_LENGTH, trackingTooLong } from "@/lib/admin/orders";
import { de } from "@/lib/i18n/de";

export function TrackingForm({
  orderNumber,
  shippingMethodCode,
  trackingNumber,
  shipped,
}: {
  orderNumber: string;
  shippingMethodCode: string | null;
  trackingNumber: string | null;
  shipped: boolean;
}) {
  const copy = de.admin.orders;
  const [value, setValue] = useState(trackingNumber ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const normalised = normaliseTracking(value);
  const unchanged = normalised === (trackingNumber ?? null);

  async function save() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setNote(null);
    setError(null);
    try {
      if (trackingTooLong(normalised)) {
        setError(copy.trackingTooLong);
        return;
      }
      const result = await setTrackingNumber(orderNumber, value);
      if (result.ok) setNote(copy.trackingSaved);
      else setError(result.message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <section className="mt-5 rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70">
      <h2 className="font-medium">{copy.trackingHeading}</h2>
      <p className="mt-1 text-sm text-muted">
        {shipped ? copy.trackingAfterShippingHint : copy.trackingBeforeShippingHint}
      </p>

      {trackingNumber ? (
        <p className="mt-3 text-sm">
          <span className="text-muted">{copy.trackingCurrent} </span>
          <TrackingLink
            shippingMethodCode={shippingMethodCode}
            trackingNumber={trackingNumber}
          />
        </p>
      ) : null}

      <label className="mt-3 flex flex-col gap-1 text-sm">
        <span className="text-muted">{copy.trackingNumber}</span>
        <input
          name="tracking"
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setNote(null);
            setError(null);
          }}
          maxLength={TRACKING_MAX_LENGTH}
          autoComplete="off"
          className="min-h-11 rounded-sky-md bg-surface px-3 py-2 ring-1 ring-border/70 focus:ring-accent"
        />
        <span className="text-xs text-muted">{copy.trackingEditHint}</span>
      </label>

      <button
        type="button"
        disabled={pending || unchanged}
        onClick={() => void save()}
        className={`${ACTION_NEUTRAL} mt-3 disabled:opacity-40`}
      >
        {trackingNumber === null ? copy.trackingSave : copy.trackingReplace}
      </button>

      {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
