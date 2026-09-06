/**
 * `−  7  +` — the daily stock control (ADR-0047).
 *
 * One tap, one movement. No dialog, no reason field, no note, no
 * confirmation: correcting a shelf count is the thing this page is opened
 * for, and it used to cost six interactions.
 *
 * WHAT IT DOES NOT CHANGE
 *
 * Nothing about the audit trail. Each tap is an ordinary
 * `record_inventory_movement()` call with `reason = 'correction'` and a delta
 * of exactly ±1: the position's quantity and its journal row are written in
 * one database transaction, the actor is `auth.uid()`, and the journal stays
 * append-only. `quantity` is never assigned. The buttons are a faster way to
 * say the same sentence, not a second way to change stock (ADR-0037).
 *
 * `correction` is the right word rather than a new one invented for the
 * interface: the constraint already allows it in both directions, it carries
 * no cost basis, and "I recounted the shelf" is exactly what it means.
 *
 * RAPID TAPS
 *
 * Three taps in a second must produce three movements and land on +3. That
 * works because the server is told a **delta**, not a target: two requests in
 * flight at once cannot overwrite each other, and inside the database they
 * serialise on `select ... for update` in `apply_inventory_movement()`. So
 * every tap is fired immediately rather than debounced or queued.
 *
 * On screen, `useOptimistic` holds the sum of the taps whose transitions have
 * not finished yet and drops it when they have — which is precisely when the
 * refreshed server value arrives. No effect, no manual reconciliation, and no
 * window where the number jumps back before jumping forward again.
 */
"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { bookMovement } from "@/lib/admin/actions";
import type { Condition } from "@/lib/admin/inventory-model";
import { formatNumber } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/** Big enough for a thumb, and the two directions are never adjacent tones. */
const STEP =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl leading-none " +
  "font-medium ring-1 transition-colors disabled:opacity-40";

export function StockStepper({
  skyId,
  condition,
  quantity,
  reserved,
  onFailed,
}: {
  skyId: string;
  condition: Condition;
  /** What the server last said. The optimistic delta is added to it. */
  quantity: number;
  /** The floor: stock may never fall below what is promised to a checkout. */
  reserved: number;
  onFailed: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, addOptimistic] = useOptimistic(quantity, (current, step: number) => current + step);
  const [atFloor, setAtFloor] = useState(false);

  function bump(step: 1 | -1) {
    onFailed(null);
    setAtFloor(false);

    startTransition(async () => {
      addOptimistic(step);
      const result = await bookMovement({
        skyId,
        condition,
        delta: step,
        // A recount, either direction. Not a new reason invented for a
        // button — see the header.
        reason: "correction",
      });
      if (!result.ok) {
        // The optimistic value disappears with this transition, so the number
        // returns to what the server says without anything resetting it.
        onFailed(result.message);
        return;
      }
      router.refresh();
    });
  }

  // The database refuses this too, and its refusal is the one that counts.
  // Disabling here saves a request and explains itself; it does not replace
  // the guard (ADR-0037).
  const canDecrease = shown > reserved;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => (canDecrease ? bump(-1) : setAtFloor(true))}
        aria-label={de.inventory.decrease}
        disabled={!canDecrease}
        className={`${STEP} bg-danger/15 text-danger ring-danger/40 hover:bg-danger/25`}
      >
        <span aria-hidden="true">−</span>
      </button>

      <span
        aria-live="polite"
        className={
          "min-w-8 text-center text-lg font-semibold tabular-nums transition-opacity " +
          (pending ? "opacity-60" : "")
        }
      >
        {formatNumber(shown)}
      </span>

      <button
        type="button"
        onClick={() => bump(1)}
        aria-label={de.inventory.increase}
        className={`${STEP} bg-success/15 text-success ring-success/40 hover:bg-success/25`}
      >
        <span aria-hidden="true">+</span>
      </button>

      {atFloor ? (
        <span role="status" className="text-[11px] leading-tight text-muted">
          {de.inventory.atFloor}
        </span>
      ) : null}
    </div>
  );
}
