/**
 * `−  3  +` — the stock control, now a draft (Lager V2).
 *
 * WHAT CHANGED, AND WHY.
 *
 * Until now every tap fired its own `correction` movement. Three taps to go
 * from 3 to 6 wrote three journal rows, and a mis-tap corrected back wrote a
 * fourth and a fifth. The journal stayed honest but it stopped reading like
 * one: five rows for one recount.
 *
 * So the buttons now move a **local draft** and nothing else. A save appears
 * only once the draft differs from what the server holds, and it books
 * exactly one movement for the net difference. Tapping back to where you
 * started writes nothing at all — there is no event to record, because
 * nothing happened.
 *
 * WHAT DID NOT CHANGE.
 *
 * The write is the same one it always was: `bookMovement` →
 * `record_inventory_movement()` → `apply_inventory_movement()`, with
 * `reason = 'correction'`, the actor taken from `auth.uid()` inside the
 * database, and the position's quantity and its journal row written in one
 * transaction. `quantity` is never assigned, `reserved` is never touched,
 * and no second stock mechanism exists.
 *
 * A DELTA, STILL NEVER A TARGET. The server is told `draft − saved`, not
 * `draft`. Two operators saving at once therefore compose instead of
 * overwriting each other, and the database serialises them on
 * `select … for update`. The consequence is visible and correct: if the
 * stock moved underneath you, your saved difference still applies to the new
 * value rather than resetting it to the number on your screen.
 */
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { bookMovement } from "@/lib/admin/actions";
import type { Condition } from "@/lib/admin/inventory-model";
import { draftDelta, draftFloor } from "@/lib/admin/stock-history";
import { formatNumber } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/**
 * Small to look at, large to hit.
 *
 * The visible circle is 28 px because three of these plus a number used to
 * own a third of the card's height. The tap target is still 44: `after`
 * paints nothing and stretches the hit area 8 px past every edge, which is
 * the size a thumb needs and the size the visible button does not have to
 * be. `touch-manipulation` drops the 300 ms double-tap wait.
 */
const STEP =
  "relative flex h-7 w-7 shrink-0 touch-manipulation items-center justify-center rounded-full " +
  "text-base leading-none font-medium ring-1 transition-colors disabled:opacity-40 " +
  "after:absolute after:-inset-2 after:content-['']";

export function StockStepper({
  skyId,
  condition,
  quantity,
  reserved,
  onFailed,
}: {
  skyId: string;
  condition: Condition;
  /** What the server last said. The draft starts here and returns here. */
  quantity: number;
  /** The floor: stock may never fall below what is promised to a checkout. */
  reserved: number;
  onFailed: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(quantity);
  const [atFloor, setAtFloor] = useState(false);

  /*
   * Follow the server when it moves — adjusted during render, not in an
   * effect.
   *
   * After a save `router.refresh()` brings a new `quantity` down and the
   * draft has to land on it, rather than keep showing the number that has
   * just been written. React's documented way to do that is to compare the
   * prop with a remembered copy while rendering; an effect would render
   * once with the stale number first and cascade a second pass.
   *
   * It also means a stock change from elsewhere resets an unsaved draft.
   * That is the honest outcome: the baseline the taps were counted from is
   * gone, and re-tapping against the real number beats saving a difference
   * measured from one that no longer exists.
   */
  const [seen, setSeen] = useState(quantity);
  if (seen !== quantity) {
    setSeen(quantity);
    setDraft(quantity);
  }

  const floor = draftFloor(reserved);
  const delta = draftDelta(draft, quantity);
  const dirty = delta !== 0;

  function bump(step: 1 | -1) {
    onFailed(null);
    if (step === -1 && draft <= floor) {
      setAtFloor(true);
      return;
    }
    setAtFloor(false);
    setDraft((current) => current + step);
  }

  function save() {
    // Nothing happened, so nothing is recorded. Not a no-op movement, not a
    // zero-delta row the database would refuse anyway.
    if (!dirty) return;
    onFailed(null);
    startTransition(async () => {
      const result = await bookMovement({
        skyId,
        condition,
        delta,
        // A recount, either direction. Not a new reason invented for a
        // button — see the header.
        reason: "correction",
      });
      if (!result.ok) {
        onFailed(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => bump(-1)}
          aria-label={de.inventory.decrease}
          disabled={pending || draft <= floor}
          className={`${STEP} bg-danger/15 text-danger ring-danger/40 hover:bg-danger/25`}
        >
          <span aria-hidden="true">−</span>
        </button>

        {/* An unsaved draft is marked by an outline, not by a colour: gold
            is the collection's and never a state or an action (ADR-0053),
            and danger/success already belong to the two buttons beside it.
            The status line and the save button say the rest in words. */}
        <span
          aria-live="polite"
          className={
            "min-w-7 rounded-sky-sm px-1 text-center text-lg font-semibold tabular-nums " +
            "transition-opacity " + (pending ? "opacity-60 " : "") +
            (dirty ? "ring-1 ring-border-strong" : "")
          }
        >
          {formatNumber(draft)}
        </span>

        <button
          type="button"
          onClick={() => bump(1)}
          aria-label={de.inventory.increase}
          disabled={pending}
          className={`${STEP} bg-success/15 text-success ring-success/40 hover:bg-success/25`}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>

      {/* The save appears only when there is something to save, so an
          untouched card carries no button that would do nothing. */}
      {dirty ? (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            aria-busy={pending || undefined}
            className={`${ACTION_PRIMARY} min-h-8 w-auto px-2.5 text-[11px] disabled:opacity-50`}
          >
            {de.inventory.draftSave}
          </button>
          <button
            type="button"
            onClick={() => { setDraft(quantity); setAtFloor(false); onFailed(null); }}
            disabled={pending}
            className="min-h-8 px-1.5 text-[11px] text-muted underline underline-offset-2 disabled:opacity-50"
          >
            {de.inventory.draftDiscard}
          </button>
          <span role="status" className="w-full text-center text-[10px] leading-tight text-muted">
            {de.inventory.draftPending(delta)}
          </span>
        </div>
      ) : null}

      {atFloor ? (
        <span role="status" className="text-center text-[10px] leading-tight text-muted">
          {de.inventory.atFloor}
        </span>
      ) : null}
    </div>
  );
}
