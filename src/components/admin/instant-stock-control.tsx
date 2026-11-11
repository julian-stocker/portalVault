/**
 * `[−] 3 [+]` in the Bestand column of the desktop table — every click is a
 * booking (Lagerverwaltung V2, 2026-11-11).
 *
 * THE OPERATOR'S CHOICE FOR THE TABLE. On a desktop a recount is a few quick
 * clicks, and a draft with "Speichern" in a 52 px row was one step too many.
 * So here each click books exactly one movement of ±1, through the same path
 * every stock change takes: `bookMovement` → `record_inventory_movement()` →
 * `apply_inventory_movement()`, `reason = 'correction'`, actor from
 * `auth.uid()` inside the database. Nothing is written anywhere else. The
 * mobile card keeps its draft (`StockStepper`).
 *
 * ONE BOOKING AT A TIME. While a click is on its way both buttons are
 * disabled, and a ref catches a second click inside the same tick, before
 * the disabled state has rendered. Rapid clicks therefore become sequential
 * bookings, never overlapping ones.
 *
 * THE NUMBER. After a booking the control shows the booked value at once and
 * keeps it until the refresh brings the server's quantity; from then on it
 * is the server's number again — derived while rendering, like the stepper.
 * A refused booking leaves the number as it was and puts the reason in the
 * row.
 *
 * AND THE CARD'S DRAFT. The mobile card for the same position keeps a draft
 * (`useStockDraft`, shared). A booking here changes the quantity that draft
 * was counted from, so it drops it first — the rule the stepper already has
 * for a stock change from elsewhere, applied at once rather than after the
 * refresh. And while the card is saving its draft, this control waits.
 *
 * THE FLOOR is the stepper's: stock may never fall below what is reserved
 * (`draftFloor`). The database checks the same and refuses otherwise.
 */
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { useStockDraft } from "@/components/admin/stock-drafts";
import { STEP } from "@/components/admin/stock-stepper";
import { bookMovement } from "@/lib/admin/actions";
import type { Condition } from "@/lib/admin/inventory-model";
import { positionKey } from "@/lib/admin/position-key";
import { draftFloor } from "@/lib/admin/stock-history";
import { formatNumber } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export function InstantStockControl({
  skyId,
  condition,
  quantity,
  reserved,
  name,
  onFailed,
}: {
  skyId: string;
  condition: Condition;
  /** What the server last said. */
  quantity: number;
  reserved: number;
  /** For the accessible names: "Bestand von Bash um 1 erhöhen". */
  name: string;
  onFailed: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /* The value booked since the server last spoke — valid while `base` is
     still the quantity on the page. */
  const [booked, setBooked] = useState<{ base: number; value: number } | null>(null);
  const inFlight = useRef(false);
  const [draft, setDraft] = useStockDraft(positionKey(skyId, condition), quantity);
  /* The card is booking its draft for this position right now. */
  const cardSaving = draft !== null && draft.state === "saving";
  const busy = pending || cardSaving;
  /* What the server will say once the refresh lands: a draft the card has
     already booked counts, as does anything booked here. */
  const settled = draft !== null && draft.state === "saved" ? draft.draft : quantity;
  const shown = booked !== null && booked.base === quantity ? booked.value : settled;


  const floor = draftFloor(reserved);

  function book(step: 1 | -1) {
    if (inFlight.current || cardSaving) return;
    if (step === -1 && shown <= floor) return;
    inFlight.current = true;
    onFailed(null);
    /* An unsaved draft counted from the old number is void now. */
    if (draft !== null && draft.state === "draft") setDraft(null);
    const from = shown;
    startTransition(async () => {
      try {
        const result = await bookMovement({ skyId, condition, delta: step, reason: "correction" });
        if (!result.ok) {
          onFailed(result.message);
          return;
        }
        setBooked({ base: quantity, value: from + step });
        router.refresh();
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => book(-1)}
        aria-label={de.inventory.decreaseBooked(name)}
        title={shown <= floor ? de.inventory.atFloor : undefined}
        disabled={busy || shown <= floor}
        className={`${STEP} bg-danger/15 text-danger ring-danger/40 hover:bg-danger/25`}
      >
        <span aria-hidden="true">−</span>
      </button>
      <span
        aria-live="polite"
        className={"min-w-6 text-center font-medium tabular-nums " + (busy ? "opacity-60" : "")}
      >
        {formatNumber(shown)}
      </span>
      <button
        type="button"
        onClick={() => book(1)}
        aria-label={de.inventory.increaseBooked(name)}
        disabled={busy}
        className={`${STEP} bg-success/15 text-success ring-success/40 hover:bg-success/25`}
      >
        <span aria-hidden="true">+</span>
      </button>
    </span>
  );
}
