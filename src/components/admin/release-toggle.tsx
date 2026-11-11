/**
 * A release switch that asks before it releases (Lagerverwaltung V2, AP4).
 *
 * ONE DIRECTION IS A DECISION, THE OTHER IS NOT. Releasing puts an article on
 * public sale, so it takes a second, explicit step: the switch opens a small
 * confirmation in place, and only its "Freigeben" calls `onChange(true)`.
 * Taking a release back hides an article and loses nothing — it goes through
 * at once, without a dialog in the way of the safer direction.
 *
 * The component writes nothing itself. It decides WHEN `onChange` is called;
 * the caller decides what that call does, through the action it always used.
 */
"use client";

import { useState } from "react";

import { de } from "@/lib/i18n/de";

const copy = de.inventory;

export function ReleaseToggle({
  on,
  onLabel,
  offLabel,
  name,
  pending,
  onChange,
  size = "compact",
}: {
  /** Whether the release is currently granted. */
  on: boolean;
  onLabel: string;
  offLabel: string;
  /** The article's name, for the confirmation sentence. */
  name: string;
  pending: boolean;
  /** Called with `false` at once, with `true` only after the confirmation. */
  onChange: (next: boolean) => void;
  /** `compact` for a card header, `touch` for a 44 px target on the phone. */
  size?: "compact" | "touch";
}) {
  const [confirming, setConfirming] = useState(false);

  const height = size === "touch" ? "min-h-11 sm:min-h-9 px-3" : "min-h-7 px-2.5";

  if (confirming && !on) {
    return (
      <div
        role="group"
        aria-label={copy.confirmListing}
        className="flex flex-col gap-1.5 rounded-sky-md bg-surface-raised p-2 text-[11px] ring-1 ring-border-strong"
      >
        <p className="font-medium">{copy.confirmListing}</p>
        <p className="leading-tight text-muted">{copy.confirmListingHint(name)}</p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() => {
              setConfirming(false);
              onChange(true);
            }}
            className="min-h-9 rounded-full bg-status-ground px-3 font-medium text-status-ink ring-1 ring-status-line disabled:opacity-40"
          >
            {copy.confirmListingYes}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => setConfirming(false)}
            className="min-h-9 rounded-full px-3 text-muted ring-1 ring-border/70"
          >
            {copy.confirmListingNo}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => (on ? onChange(false) : setConfirming(true))}
      aria-pressed={on}
      aria-busy={pending || undefined}
      disabled={pending}
      className={
        `${height} shrink-0 rounded-full text-[11px] font-medium whitespace-nowrap ring-1 disabled:opacity-40 ` +
        (on ? "bg-status-ground text-status-ink ring-status-line" : "bg-surface text-muted ring-border/70")
      }
    >
      {on ? onLabel : offLabel}
    </button>
  );
}
